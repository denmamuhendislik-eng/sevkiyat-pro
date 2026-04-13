/**
 * index.js — Sevkiyat Pro VIO Mail Otomasyonu
 *
 * İki Cloud Function expose eder:
 *
 *  1. fetchVioReportsHttp (HTTPS endpoint)
 *     - Manuel tetikleme için. Tarayıcıdan veya curl'la çağrılır.
 *     - Test ve hata ayıklama amaçlı. Production'da scheduled olan çalışır.
 *     - URL deploy sonrası verilir.
 *     - Auth: Sadece çağrı yapan kişi proje ownerı ise erişebilir
 *       (Firebase Functions varsayılan IAM kuralları).
 *
 *  2. fetchVioReportsScheduled (Pub/Sub scheduled)
 *     - Cloud Scheduler tarafından otomatik tetiklenir.
 *     - Cron: hibrit (sabah yoğun + öğle/ikindi)
 *       Cron 1: "* /10 8-9 * * 1-5"  → Pzt-Cum 08:00-09:50, 10 dk arayla
 *       Cron 2: "0 15,19 * * 1-5"     → Pzt-Cum 12:00 ve 15:00
 *
 * Her iki fonksiyon da aynı `runVioImport()` ana akışını çalıştırır.
 *
 * Akış:
 *   1. Gmail OAuth client kur (refresh token ile)
 *   2. 3 VIO raporu için son maili bul + attachment indir
 *   3. Her attachment'ı uygun parser'a ver
 *   4. Parser çıktısını Firestore'a yaz
 *   5. automationLog'a entry ekle
 *
 * Hata toleransı: Bir rapor başarısız olursa diğerleri devam eder.
 * Sonuç response/log'da rapor bazında durum bildirilir.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const XLSX = require("xlsx");

const { createOAuthClient, fetchAllVioReports } = require("./gmail");
const { parseStockReport, parseAkibetExcel, parsePurchaseExcel } = require("./parsers");
const { saveReport, appendAutomationLog } = require("./firestore");

// Firebase Admin tek seferlik init
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Secrets — Firebase Functions secrets ile yönetilir
// Set komutları (deploy öncesi):
//   firebase functions:secrets:set GMAIL_CLIENT_ID
//   firebase functions:secrets:set GMAIL_CLIENT_SECRET
//   firebase functions:secrets:set GMAIL_REFRESH_TOKEN
const GMAIL_CLIENT_ID = defineSecret("GMAIL_CLIENT_ID");
const GMAIL_CLIENT_SECRET = defineSecret("GMAIL_CLIENT_SECRET");
const GMAIL_REFRESH_TOKEN = defineSecret("GMAIL_REFRESH_TOKEN");

// Region — düşük gecikme için Avrupa
const REGION = "europe-west1";

/**
 * Type'a göre uygun parser'ı çağır
 */
function runParser(type, workbook) {
  if (type === "stock") return parseStockReport(workbook);
  if (type === "akibet") return parseAkibetExcel(workbook);
  if (type === "purchase") return parsePurchaseExcel(workbook);
  throw new Error(`Bilinmeyen tip: ${type}`);
}

/**
 * Parser sonucundan özet sayı çıkar (log için)
 */
function summarizeResult(type, result) {
  if (type === "stock") {
    return {
      totalCodes: result.totalCodes,
      totalRows: result.totalRows,
    };
  }
  if (type === "akibet") {
    return {
      totalParts: result.totalParts,
      withInternal: result.withInternal,
      withFason: result.withFason,
      anomalies: (result.anomalies || []).length,
    };
  }
  if (type === "purchase") {
    return {
      totalParts: result.totalParts,
      totalItems: result.totalItems,
      supplierCount: result.supplierCount,
    };
  }
  return {};
}

/**
 * Ana iş akışı — HTTP ve scheduled function'lar bunu çağırır.
 *
 * @param {string} source - "http" veya "scheduled" (log için)
 * @param {object} secrets - { clientId, clientSecret, refreshToken }
 * @returns {Promise<{success, results, error?}>}
 */
async function runVioImport(source, secrets) {
  const runAt = new Date().toISOString();
  logger.info(`[VIO] Çalıştırma başladı`, { source, runAt });

  const reportResults = [];
  let overallSuccess = true;

  try {
    const auth = createOAuthClient({
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
      refreshToken: secrets.refreshToken,
    });

    const fetched = await fetchAllVioReports(auth, 24);

    for (const item of fetched) {
      if (item.status !== "ok") {
        reportResults.push({
          type: item.type,
          label: item.label,
          status: item.status,
          error: item.error,
        });
        overallSuccess = false;
        logger.warn(`[VIO] ${item.label}: ${item.status}`, { error: item.error });
        continue;
      }

      try {
        // Buffer → Workbook
        const workbook = XLSX.read(item.buffer, { type: "buffer" });
        const parserResult = runParser(item.type, workbook);

        // Sıfır sonuç kontrolü — parser hata vermedi ama veri çıkmadı
        const isEmpty =
          (item.type === "stock" && parserResult.totalCodes === 0) ||
          (item.type === "akibet" && parserResult.totalParts === 0) ||
          (item.type === "purchase" && parserResult.totalParts === 0);

        if (isEmpty) {
          reportResults.push({
            type: item.type,
            label: item.label,
            status: "empty",
            error: "Parser çalıştı ama 0 kayıt çıktı (format değişmiş olabilir)",
            filename: item.filename,
            subject: item.subject,
          });
          overallSuccess = false;
          logger.warn(`[VIO] ${item.label}: parser 0 kayıt döndü`, { filename: item.filename });
          continue;
        }

        // Firestore'a yaz
        await saveReport(db, item.type, parserResult, item.filename);

        const summary = summarizeResult(item.type, parserResult);
        reportResults.push({
          type: item.type,
          label: item.label,
          status: "ok",
          filename: item.filename,
          subject: item.subject,
          mailDate: new Date(item.internalDate).toISOString(),
          summary,
        });
        logger.info(`[VIO] ${item.label}: başarılı`, summary);
      } catch (parseErr) {
        reportResults.push({
          type: item.type,
          label: item.label,
          status: "parse_error",
          error: parseErr.message,
          filename: item.filename,
        });
        overallSuccess = false;
        logger.error(`[VIO] ${item.label}: parse hatası`, { error: parseErr.message });
      }
    }
  } catch (fatalErr) {
    logger.error(`[VIO] Fatal hata`, { error: fatalErr.message, stack: fatalErr.stack });
    overallSuccess = false;
    return {
      success: false,
      runAt,
      source,
      results: reportResults,
      error: fatalErr.message,
    };
  }

  // automationLog'a entry ekle
  try {
    await appendAutomationLog(db, {
      runAt,
      source,
      success: overallSuccess,
      results: reportResults.map((r) => ({
        type: r.type,
        label: r.label,
        status: r.status,
        ...(r.error ? { error: r.error } : {}),
        ...(r.summary ? { summary: r.summary } : {}),
        ...(r.mailDate ? { mailDate: r.mailDate } : {}),
      })),
    });
  } catch (logErr) {
    logger.error(`[VIO] automationLog yazma hatası`, { error: logErr.message });
    // Ana sonuç başarılıysa log hatası overall success'i bozmaz
  }

  logger.info(`[VIO] Çalıştırma bitti`, { success: overallSuccess, count: reportResults.length });
  return {
    success: overallSuccess,
    runAt,
    source,
    results: reportResults,
  };
}

// ==================== HTTP FONKSIYONU (manuel tetikleme) ====================

exports.fetchVioReportsHttp = onRequest(
  {
    region: REGION,
    secrets: [GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    timeoutSeconds: 540, // 9 dakika — büyük dosyalar için yeterli
    memory: "512MiB",
  },
  async (req, res) => {
    // Basit guard: sadece GET ve POST kabul et
    if (!["GET", "POST"].includes(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const result = await runVioImport("http", {
      clientId: GMAIL_CLIENT_ID.value(),
      clientSecret: GMAIL_CLIENT_SECRET.value(),
      refreshToken: GMAIL_REFRESH_TOKEN.value(),
    });

    res.status(result.success ? 200 : 207).json(result);
  },
);

// ==================== SCHEDULED FONKSIYONU (Cloud Scheduler) ====================

// Hibrit cron 1: Pzt-Cum, 08:00-09:50, her 10 dakikada bir
exports.fetchVioReportsMorning = onSchedule(
  {
    region: REGION,
    schedule: "*/15 9-11 * * 1-5",
    timeZone: "Europe/Istanbul",
    secrets: [GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    await runVioImport("scheduled-morning", {
      clientId: GMAIL_CLIENT_ID.value(),
      clientSecret: GMAIL_CLIENT_SECRET.value(),
      refreshToken: GMAIL_REFRESH_TOKEN.value(),
    });
  },
);

// Hibrit cron 2: Pzt-Cum, 12:00 ve 15:00 (gün içi düzeltme yakalama)
exports.fetchVioReportsMidday = onSchedule(
  {
    region: REGION,
    schedule: "0 15,19 * * 1-5",
    timeZone: "Europe/Istanbul",
    secrets: [GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    await runVioImport("scheduled-midday", {
      clientId: GMAIL_CLIENT_ID.value(),
      clientSecret: GMAIL_CLIENT_SECRET.value(),
      refreshToken: GMAIL_REFRESH_TOKEN.value(),
    });
  },
);
