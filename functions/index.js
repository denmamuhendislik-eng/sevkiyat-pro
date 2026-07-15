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

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const XLSX = require("xlsx");

const { createOAuthClient, fetchAllVioReports } = require("./gmail");
const { parseStockReport, parseAkibetExcel, parsePurchaseExcel, parsePurchaseWithPrices, parseSalesOrdersReport, parseOverheadExcel, parseSuppliesExcel, parseCariEkstreExcel, parseCocPartsKonf, parseCocCertificatesListesi, TRACKED_CUSTOMERS } = require("./parsers");
const { saveReport, appendAutomationLog, saveUnitCostPartitions, saveOverheadReport, saveCariEkstreReport, saveCocPartsReport, saveCocCertificatesReport, saveQuoteMasterData, saveQuoteArchive, saveQuoteParts, saveQuoteCustomers, promoteQuoteStaging, saveCurrencyRates, saveMonthlyInventorySnapshot, readAppDoc } = require("./firestore");
const { parseQuoteMasterData, parseQuoteArchive, extractQuotePartsFromArchive, extractQuoteCustomersFromArchive } = require("./quoteParser");
const { fetchTcmbRates } = require("./tcmb");
const { calculateSimpleInventoryValue } = require("./inventoryCalcSimple");

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
// COC Drive entegrasyonu — Secret Manager'da JSON SA key
const COC_DRIVE_SA_KEY = defineSecret("coc-drive-sa-key");

// Region — düşük gecikme için Avrupa
const REGION = "europe-west1";

/**
 * Type'a göre uygun parser'ı çağır
 */
function runParser(type, workbook, opts = {}) {
  if (type === "stock") return parseStockReport(workbook);
  if (type === "akibet") return parseAkibetExcel(workbook);
  if (type === "purchase") return parsePurchaseExcel(workbook);
  if (type === "salesOrders") return parseSalesOrdersReport(workbook);
  if (type === "overhead") return parseOverheadExcel(workbook);
  if (type === "supplies") return parseSuppliesExcel(workbook, opts.fallbackYear);
  if (type === "cariEkstre") return parseCariEkstreExcel(workbook);
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
  if (type === "salesOrders") {
    return {
      orderCount: result.orderCount,
      customerCount: result.customerCount,
      aggregateCount: result.aggregateCount,
    };
  }
  if (type === "overhead") {
    return {
      year: result.year,
      monthCount: result.monthsList?.length || 0,
      itemCount: result.itemCount,
      uniqueCodeCount: result.uniqueCodeCount,
      grandTotal: Math.round(result.grandTotal || 0),
    };
  }
  if (type === "supplies") {
    return {
      monthCount: result.monthsList?.length || 0,
      totalItems: result.totalItems,
      grandTotalTl: Math.round(result.grandTotalTl || 0),
    };
  }
  if (type === "cariEkstre") {
    return {
      itemCount: result.itemCount,
      customerCount: result.customerCount,
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
        // Monthly/weekly rapor için mail yokluğu fail sayılmaz
        if (item.status !== "no_recent_monthly" && item.status !== "no_recent_weekly") {
          overallSuccess = false;
          logger.warn(`[VIO] ${item.label}: ${item.status}`, { error: item.error });
        } else {
          logger.info(`[VIO] ${item.label}: ${item.status} (periodic — beklenen)`);
        }
        continue;
      }

      try {
        // Buffer → Workbook
        const workbook = XLSX.read(item.buffer, { type: "buffer" });
        // Supplies parser yıl bilgisi metadata'da olmadığı için mail tarihinden fallback
        const fallbackYear = item.internalDate
          ? new Date(item.internalDate).getFullYear()
          : new Date().getFullYear();
        const parserResult = runParser(item.type, workbook, { fallbackYear });

        // Sıfır sonuç kontrolü — parser hata vermedi ama veri çıkmadı
        const isEmpty =
          (item.type === "stock" && parserResult.totalCodes === 0) ||
          (item.type === "akibet" && parserResult.totalParts === 0) ||
          (item.type === "purchase" && parserResult.totalParts === 0) ||
          (item.type === "salesOrders" && parserResult.orderCount === 0) ||
          (item.type === "overhead" && (parserResult.itemCount === 0 || (parserResult.monthsList?.length || 0) === 0)) ||
          (item.type === "supplies" && (parserResult.totalItems === 0 || (parserResult.monthsList?.length || 0) === 0)) ||
          (item.type === "cariEkstre" && parserResult.itemCount === 0);

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

        // Firestore'a yaz — overhead için mail tarihi gerekiyor (kısmi-ay kontrolü)
        const saveOut = await saveReport(db, item.type, parserResult, item.filename, { messageDate: item.internalDate });

        const summary = summarizeResult(item.type, parserResult);
        // salesOrders için diff sayılarını da summary'ye ekle
        if (item.type === "salesOrders" && saveOut?.diffMeta) {
          summary.shipmentEvents = saveOut.diffMeta.eventCount;
          summary.cancelledOrders = saveOut.diffMeta.cancelledCount || 0;
        }
        if (item.type === "overhead" && saveOut?.overheadMeta) {
          summary.overheadMonthsWritten = saveOut.overheadMeta.monthsWritten;
          summary.overheadCodesGuessed = saveOut.overheadMeta.codesGuessed;
          summary.overheadSkippedPartial = saveOut.overheadMeta.skippedPartialMonths || [];
        }
        if (item.type === "supplies" && saveOut?.suppliesMeta) {
          summary.suppliesMonthsWritten = saveOut.suppliesMeta.monthsWritten;
          summary.suppliesItemCount = saveOut.suppliesMeta.itemCount;
          summary.suppliesSkippedPartial = saveOut.suppliesMeta.skippedPartialMonths || [];
        }
        if (item.type === "cariEkstre" && saveOut?.ekstreMeta) {
          summary.ekstreAdded = saveOut.ekstreMeta.added;
          summary.ekstreSkipped = saveOut.ekstreMeta.skipped;
          summary.ekstreDeletedNonExtre = saveOut.ekstreMeta.deletedNonExtre;
        }
        // purchase için paralel fiyat çıkarımı → unitCosts FIFO partileri
        if (item.type === "purchase") {
          try {
            const priceResult = parsePurchaseWithPrices(workbook);
            const unitOut = await saveUnitCostPartitions(db, priceResult.partitions);
            summary.unitCostsAdded = unitOut.added;
            summary.unitCostsSkipped = unitOut.skipped;
            summary.unitCostsStockCount = unitOut.stockCount;
            logger.info(`[VIO] unitCosts güncelleme: +${unitOut.added}, atlanan ${unitOut.skipped}`);
          } catch (priceErr) {
            // Fiyat parse hatası ana sevkiyat akışını engellemesin
            logger.warn(`[VIO] unitCosts parse/save uyarısı`, { error: priceErr.message });
            summary.unitCostsError = priceErr.message;
          }
        }
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
    cors: true,  // Cloud Run varsayılan auth'unu açar — manuel tetikleme browser'dan
    invoker: "public",
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

// ==================== TCMB DÖVİZ KURLARI ====================
// TCMB resmi kurları 15:30 sonrası açıklanır → cron 16:30 Pzt-Cum.
// Hafta sonu çalışmaz (zaten o günler kur açıklanmaz, en son cuma kuru geçerli).

async function runTcmbFetch(source) {
  const runAt = new Date().toISOString();
  logger.info(`[TCMB] Çalıştırma başladı`, { source, runAt });
  try {
    const rates = await fetchTcmbRates();
    if (!rates) {
      logger.warn(`[TCMB] Kur çekilemedi (TCMB API yanıtsız veya format değişti)`);
      return { success: false, runAt, source, error: "TCMB API yanıtsız" };
    }
    await saveCurrencyRates(db, rates);
    logger.info(`[TCMB] ✓ Kur kaydedildi`, { date: rates.date, usd: rates.usd, eur: rates.eur });
    return { success: true, runAt, source, ...rates };
  } catch (err) {
    logger.error(`[TCMB] Hata`, { error: err.message, stack: err.stack });
    return { success: false, runAt, source, error: err.message };
  }
}

exports.fetchTcmbRatesDaily = onSchedule(
  {
    region: REGION,
    schedule: "30 16 * * 1-5",
    timeZone: "Europe/Istanbul",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async () => {
    await runTcmbFetch("scheduled-daily");
  },
);

// Manuel tetik — geçmiş tarih için kur çekmek veya hemen test için
// GET /fetchTcmbRatesHttp?date=2026-03-31 (opsiyonel; verilmezse bugün)
exports.fetchTcmbRatesHttp = onRequest(
  { region: REGION, timeoutSeconds: 60, memory: "256MiB", cors: true },
  async (req, res) => {
    const dateParam = req.query?.date;
    const targetDate = dateParam ? new Date(dateParam) : null;
    if (dateParam && isNaN(targetDate?.getTime())) {
      res.status(400).json({ error: "Geçersiz date parametresi (örn. ?date=2026-03-31)" });
      return;
    }
    try {
      const rates = await fetchTcmbRates(targetDate);
      if (!rates) {
        res.status(404).json({ error: "TCMB kuru bulunamadı (hafta sonu/tatil ise birkaç gün geriye gidildi)" });
        return;
      }
      await saveCurrencyRates(db, rates);
      res.json({ success: true, ...rates });
    } catch (err) {
      logger.error("[TCMB HTTP] Hata", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// ==================== AYLIK ENVANTER SNAPSHOT ====================
// Her ayın 1'i sabah 11:00 — VIO Son Stok Raporu cron'u (09:00) sonrası çalışır.
// Önceki ayın kapanış stoğu için snapshot alır. Basit hesap (BUY/RAW × son alış).
// Snapshot anında TCMB kuru da kayıt altına alınır → tarihsel USD/EUR sabit.

function previousMonthKey(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();  // 0-11; bu ay
  // Önceki ay
  const prev = new Date(y, m - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

async function runMonthlySnapshot(source, monthKey = null) {
  const takenAt = new Date().toISOString();
  const targetMonth = monthKey || previousMonthKey();
  logger.info(`[Snapshot] Başladı`, { source, targetMonth, takenAt });

  try {
    const [stock, unitCosts, currencyRates, productCosts] = await Promise.all([
      readAppDoc(db, "mrpStock"),
      readAppDoc(db, "unitCosts"),
      readAppDoc(db, "currencyRates"),
      readAppDoc(db, "productCostsLatest"),  // ProductCostsTab tarafından yazılır
    ]);

    if (!stock || !stock.parts) {
      logger.warn(`[Snapshot] mrpStock yok veya boş`);
      return { success: false, error: "mrpStock yok" };
    }

    const result = calculateSimpleInventoryValue({ mrpStock: stock, unitCosts, productCosts });

    // O ayın TCMB kuru — currencyRates.rates'ten en yakın geçmiş tarih
    let ratesAt = null;
    const ratesMap = currencyRates?.rates || {};
    const keys = Object.keys(ratesMap).sort();
    if (keys.length > 0) {
      // En son kayıtlı kur (snapshot anında)
      const lastKey = keys[keys.length - 1];
      const r = ratesMap[lastKey];
      ratesAt = {
        usd: Number(r?.usd) || 0,
        eur: Number(r?.eur) || 0,
        source: r?.source || `tcmb-${lastKey}`,
        date: lastKey,
      };
    }

    const snapshot = {
      takenAt,
      monthKey: targetMonth,
      source,  // "auto-cron-monthly" | "manual-monthly" | "manual"
      totalValue: result.totalValue,
      totalQty: result.totalQty,
      stockCount: result.stockCount,
      missingPriceCount: result.missingPriceCount,
      totalAmbar: result.totalAmbar,
      totalUretim: result.totalUretim,
      totalFason: result.totalFason,
      ratesAt,
      totalValueUsd: ratesAt?.usd > 0 ? Math.round((result.totalValue / ratesAt.usd) * 100) / 100 : null,
      totalValueEur: ratesAt?.eur > 0 ? Math.round((result.totalValue / ratesAt.eur) * 100) / 100 : null,
      mrpStockImportedAt: stock?.importedAt || null,
      unitCostsLastImport: unitCosts?.lastImport || null,
      productCostsFallbackCount: result.productCostsFallbackCount || 0,
      productCostsCalculatedAt: result.productCostsCalculatedAt || null,
    };

    await saveMonthlyInventorySnapshot(db, targetMonth, snapshot);
    logger.info(`[Snapshot] ✓ ${targetMonth} kaydedildi`, { totalValue: snapshot.totalValue, stockCount: snapshot.stockCount });
    return { success: true, monthKey: targetMonth, ...snapshot };
  } catch (err) {
    logger.error(`[Snapshot] Hata`, { error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  }
}

// Her ayın 1'inde 11:00 (VIO Son Stok Raporu cron'undan sonra)
exports.takeMonthlySnapshot = onSchedule(
  {
    region: REGION,
    schedule: "0 11 1 * *",
    timeZone: "Europe/Istanbul",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async () => {
    await runMonthlySnapshot("auto-cron-monthly");
  },
);

// Manuel tetik — geçmiş ay için snapshot veya test için
// GET /takeMonthlySnapshotHttp?month=2026-04 (opsiyonel; verilmezse önceki ay)
// GET /takeMonthlySnapshotHttp?month=2026-03&manualTl=20441855.66 — geçmiş envanter
//     manuel TL ile override (anlık mrpStock atla, kullanıcının verdiği değer yazılır,
//     kur ay sonu TCMB'den otomatik çekilir).
exports.takeMonthlySnapshotHttp = onRequest(
  { region: REGION, timeoutSeconds: 120, memory: "512MiB", cors: true },
  async (req, res) => {
    const monthParam = req.query?.month;
    const manualTlParam = req.query?.manualTl;
    if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
      res.status(400).json({ error: "Geçersiz month parametresi (örn. ?month=2026-04)" });
      return;
    }
    try {
      // Manuel TL override modu — geçmiş tarih için kullanıcının elindeki değer
      if (manualTlParam) {
        const tl = Number(manualTlParam);
        if (!(tl > 0)) {
          res.status(400).json({ error: "manualTl pozitif olmalı" });
          return;
        }
        const targetMonth = monthParam;
        if (!targetMonth) {
          res.status(400).json({ error: "manualTl ile birlikte month zorunlu" });
          return;
        }
        // Ay sonu tarihi: ?date verilirse onu, verilmezse ayın son günü
        let endDateIso;
        if (req.query?.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
          endDateIso = req.query.date;
        } else {
          const [yy, mm] = targetMonth.split("-").map(Number);
          const lastDay = new Date(yy, mm, 0);
          endDateIso = lastDay.toISOString().slice(0, 10);
        }
        // TCMB kuru — fetch et + Firestore'a kaydet (zaten varsa upsert)
        const rateRecord = await fetchTcmbRates(new Date(endDateIso));
        if (rateRecord) {
          await saveCurrencyRates(db, rateRecord);
        }
        const ratesAt = rateRecord
          ? { usd: rateRecord.usd, eur: rateRecord.eur, source: rateRecord.source, date: rateRecord.date }
          : null;
        const snapshot = {
          takenAt: new Date().toISOString(),
          monthKey: targetMonth,
          source: "manual-historical",
          totalValue: tl,
          ratesAt,
          totalValueUsd: ratesAt?.usd > 0 ? Math.round((tl / ratesAt.usd) * 100) / 100 : null,
          totalValueEur: ratesAt?.eur > 0 ? Math.round((tl / ratesAt.eur) * 100) / 100 : null,
          note: `Manuel girilmiş geçmiş envanter (${endDateIso} TCMB kuru)`,
        };
        await saveMonthlyInventorySnapshot(db, targetMonth, snapshot);
        logger.info(`[Snapshot] ✓ Manuel ${targetMonth}`, { tl, ratesAt });
        res.json({ success: true, ...snapshot });
        return;
      }
      // Normal mod — anlık hesap
      const result = await runMonthlySnapshot("manual-http", monthParam || null);
      if (!result.success) {
        res.status(500).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error("[Snapshot HTTP] Hata", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// Silme endpoint — geçici/hatalı snapshot'ı kaldır
// GET /deleteMonthlySnapshotHttp?month=2026-02
exports.deleteMonthlySnapshotHttp = onRequest(
  { region: REGION, timeoutSeconds: 30, memory: "256MiB", cors: true },
  async (req, res) => {
    const monthParam = req.query?.month;
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      res.status(400).json({ error: "month zorunlu (örn. ?month=2026-02)" });
      return;
    }
    try {
      const ref = db.collection("appData").doc("inventorySnapshots");
      const admin = require("firebase-admin");
      await ref.update({ [`snapshots.${monthParam}`]: admin.firestore.FieldValue.delete() });
      logger.info(`[Snapshot] ✓ Silindi: ${monthParam}`);
      res.json({ success: true, monthKey: monthParam });
    } catch (err) {
      logger.error("[Snapshot delete] Hata", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// ====================================================================
// CLEANUP: A+R DIŞI SHIPMENTS KAYITLARI SİL
// appData/shipments içinden Aselsan (120-0107) ve Roketsan (120-116)
// dışındaki tüm kayıtları kaldırır. salesOrders'a DOKUNMAZ (MRP talebi
// için kritik). Default dry-run; gerçek silme için ?execute=true gerekli.
// ====================================================================
exports.cleanupNonTrackedShipmentsHttp = onRequest(
  { region: REGION, timeoutSeconds: 60, memory: "512MiB", cors: true, invoker: "public" },
  async (req, res) => {
    const execute = req.query?.execute === "true";
    // mode=purgeNonExtreAR → EKSTRE_ olmayan A+R kayıtlarını sil (cari ekstre authoritative)
    const mode = req.query?.mode || "nonTracked";
    try {
      const shipmentsRef = db.collection("appData").doc("shipments");
      const shipSnap = await shipmentsRef.get();
      const shipments = shipSnap.exists ? (shipSnap.data() || {}) : {};

      const breakdown = {};
      const toDelete = [];
      for (const [id, v] of Object.entries(shipments)) {
        const code = (v && v.customerCode) || "(boş)";
        const name = (v && v.customerName) || "";
        if (!breakdown[code]) breakdown[code] = { code, name, count: 0, willDelete: 0, sampleIds: [] };
        breakdown[code].count++;
        const isAR = TRACKED_CUSTOMERS.has((v && v.customerCode) || "");
        const isEkstre = id.startsWith("EKSTRE_");
        // Yeni format: EKSTRE_{customerCode}_..., eski format: EKSTRE_{tarih}_...
        const isNewFormatEkstre = isEkstre && (id.startsWith("EKSTRE_120-0107") || id.startsWith("EKSTRE_120-116"));
        const isOldFormatEkstre = isEkstre && !isNewFormatEkstre;
        let shouldDelete = false;
        if (mode === "purgeNonExtreAR") {
          shouldDelete = isAR && !isEkstre; // non-EKSTRE A+R kayıtlarını sil
        } else if (mode === "purgeOldEkstreFormat") {
          shouldDelete = isOldFormatEkstre; // EKSTRE_ ama yeni format değil → eski kayıt
        } else {
          shouldDelete = !isAR; // tracked olmayanları sil (default)
        }
        if (shouldDelete) {
          toDelete.push(id);
          breakdown[code].willDelete++;
          if (breakdown[code].sampleIds.length < 3) breakdown[code].sampleIds.push(id);
        }
      }
      const customerBreakdown = Object.values(breakdown).sort((a, b) => b.count - a.count);

      if (!execute) {
        // Debug: prefix breakdown
        const prefixBreakdown = { EKSTRE_: 0, "vio (other)": 0 };
        const sampleNonEkstre = [];
        for (const [id, v] of Object.entries(shipments)) {
          if (id.startsWith("EKSTRE_")) prefixBreakdown.EKSTRE_++;
          else {
            prefixBreakdown["vio (other)"]++;
            if (sampleNonEkstre.length < 5) sampleNonEkstre.push({ id, customerCode: v?.customerCode, totalShipped: v?.totalShipped });
          }
        }
        res.json({
          mode: `dry-run (${mode})`,
          tracked: TRACKED_CUSTOMERS.prefixes,
          totalBefore: Object.keys(shipments).length,
          willDelete: toDelete.length,
          willKeep: Object.keys(shipments).length - toDelete.length,
          prefixBreakdown,
          sampleNonEkstre,
          customerBreakdown,
          hint: "Gerçek silme için ?execute=true ekleyin (mode=purgeNonExtreAR de eklenebilir)",
        });
        return;
      }

      // Execute mode
      const FV = admin.firestore.FieldValue;
      const update = {};
      for (const id of toDelete) update[id] = FV.delete();

      // Firestore 1 MB limit — büyük update'leri parçala
      const ids = Object.keys(update);
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = {};
        for (const k of ids.slice(i, i + CHUNK)) slice[k] = update[k];
        if (Object.keys(slice).length > 0) await shipmentsRef.update(slice);
      }

      logger.info(`[Cleanup] ✓ shipments A+R dışı silindi: ${toDelete.length}`);
      res.json({
        mode: "executed",
        tracked: TRACKED_CUSTOMERS.prefixes,
        deleted: toDelete.length,
        remaining: Object.keys(shipments).length - toDelete.length,
      });
    } catch (err) {
      logger.error("[Cleanup] Hata", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// ====================================================================
// CARİ EKSTRE — HAFTALIK CRON (Pzt 08:30 Europe/Istanbul)
// VIO her Pazartesi sabah "FR - Cari Ekstre Dövizli Alt Hesaplı + REFNO A4"
// subject'li maili gönderir. Cron Gmail'i tarar, parse eder, smart merge yapar.
// İdempotent: aynı EKSTRE_* ID varsa atlar, idle haftada no-op.
// ====================================================================
exports.fetchCariEkstreWeekly = onSchedule(
  {
    region: REGION,
    schedule: "30 8 * * 1",
    timeZone: "Europe/Istanbul",
    secrets: [GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    await runVioImport("scheduled-cari-ekstre-weekly", {
      clientId: GMAIL_CLIENT_ID.value(),
      clientSecret: GMAIL_CLIENT_SECRET.value(),
      refreshToken: GMAIL_REFRESH_TOKEN.value(),
    });
  },
);

// ====================================================================
// CARİ EKSTRE — MANUEL TEK SEFERLİK DOLUM (HTTP)
// Mevcut A+R shipments kayıtlarını siler + cari ekstreden Ocak-Haziran dolumu.
// İlk kurulumda Excel POST ile, sonraki çalıştırmalarda Gmail'den otomatik.
// Body: multipart/form-data ile file alanında .xlsx | .xls dosyası
// ?purgeNonExtre=true → mevcut A+R shipments silinir (ilk dolum için)
// ====================================================================
exports.uploadCariEkstreHttp = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST gerekli — body olarak Excel dosyası gönderin" });
      return;
    }
    try {
      // req.rawBody (Cloud Functions otomatik populate eder, binary)
      const buffer = req.rawBody;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: "Body boş — Excel dosyası gönderilmedi" });
        return;
      }
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const parserResult = parseCariEkstreExcel(workbook);
      if (parserResult.itemCount === 0) {
        res.status(400).json({ error: "Parser 0 satır çıkardı — dosya formatı doğru mu?" });
        return;
      }
      const purgeNonExtre = req.query?.purgeNonExtre === "true";
      const ekstreOut = await saveCariEkstreReport(db, parserResult, { purgeNonExtreForTracked: purgeNonExtre });
      logger.info(`[CariEkstre Manuel] ✓ ${parserResult.itemCount} item parse edildi`, ekstreOut);
      res.json({
        success: true,
        parsed: {
          itemCount: parserResult.itemCount,
          customerCount: parserResult.customerCount,
          byCustomer: parserResult.byCustomer,
        },
        written: ekstreOut,
      });
    } catch (err) {
      logger.error("[CariEkstre Manuel] Hata", { error: err.message, stack: err.stack });
      res.status(500).json({ error: err.message });
    }
  },
);

// ====================================================================
// COC (Uygunluk Belgesi) — MANUEL EXCEL YÜKLEME (HTTP)
// FR-70 Uygunluk Belgesi.xlsm dosyasını alıp:
//   1) ASELSAN KONF + ROKETSAN KONF → cocParts master
//   2) "Uygunluk Belgesi Listesi" → cocCertificates geçmiş arşiv
// İdempotent: aynı sertifika no'su atlanır, mevcut parça master merge edilir.
// ====================================================================
exports.uploadCocFileHttp = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST gerekli — body olarak Excel dosyası gönderin" });
      return;
    }
    try {
      const buffer = req.rawBody;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: "Body boş — Excel dosyası gönderilmedi" });
        return;
      }
      const workbook = XLSX.read(buffer, { type: "buffer" });

      // 1) KONF master parse
      const partsResult = parseCocPartsKonf(workbook);
      const partsOut = await saveCocPartsReport(db, partsResult);

      // 2) Liste (geçmiş arşiv) parse
      const certResult = parseCocCertificatesListesi(workbook);
      const certOut = await saveCocCertificatesReport(db, certResult);

      logger.info("[COC Manuel] ✓ Yüklendi", { partsOut, certOut });
      res.json({
        success: true,
        parts: {
          parsed: partsResult.totalCount,
          aselsan: partsResult.aselsanCount,
          roketsan: partsResult.roketsanCount,
          ...partsOut,
        },
        certificates: {
          parsed: certResult.count,
          ...certOut,
        },
      });
    } catch (err) {
      logger.error("[COC Manuel] Hata", { error: err.message, stack: err.stack });
      res.status(500).json({ error: err.message });
    }
  },
);

// ====================================================================
// COC Drive Entegrasyonu
// 1) searchCocDriveHttp — kategori bazlı stok kodu araması, top N sonuç
// 2) importCocDriveFileHttp — seçilen Drive dosyasını indirip Firebase
//    Storage'a yükler, COC'a metadata döner
// Auth: Firebase ID token (Authorization: Bearer ...) zorunlu
// ====================================================================
const { searchDriveCategory, downloadDriveFile } = require("./drive");
const crypto = require("crypto");

// Firebase Storage download URL üretici (signed URL yerine — iam.signBlob izni gerektirmez).
// Token bazlı access — frontend'in getDownloadURL() ile aldığı URL ile aynı format.
async function uploadWithDownloadToken(bucket, path, buffer, contentType) {
  const token = crypto.randomUUID();
  const file = bucket.file(path);
  await file.save(buffer, {
    contentType: contentType || "application/octet-stream",
    resumable: false,
    metadata: {
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const encodedPath = encodeURIComponent(path);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
  return url;
}

async function readDriveConfig() {
  const ref = db.collection("appData").doc("driveConfig");
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Giriş yapmalısınız");
  }
}

exports.searchCocDrive = onCall(
  {
    region: REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: true,
    secrets: [COC_DRIVE_SA_KEY],
  },
  async (request) => {
    requireAuth(request);
    const { category, stokKodu, altName } = request.data || {};
    if (!category || !stokKodu) {
      throw new HttpsError("invalid-argument", "category ve stokKodu zorunlu");
    }
    const driveConfig = await readDriveConfig();
    if (!driveConfig) {
      throw new HttpsError("failed-precondition", "Drive yapılandırması yok (appData/driveConfig)");
    }
    try {
      const saKey = COC_DRIVE_SA_KEY.value();
      const out = await searchDriveCategory(saKey, { category, stokKodu, altName, driveConfig });
      return { success: true, ...out };
    } catch (err) {
      logger.error("[COC Drive Search] Hata", { error: err.message });
      throw new HttpsError("internal", err.message);
    }
  },
);

exports.importCocDriveFile = onCall(
  {
    region: REGION,
    timeoutSeconds: 120,
    memory: "1GiB",
    cors: true,
    secrets: [COC_DRIVE_SA_KEY],
  },
  async (request) => {
    requireAuth(request);
    const { fileId, certNo, certYear, category, stokKodu } = request.data || {};
    if (!fileId || !certNo || !certYear || !category || !stokKodu) {
      throw new HttpsError("invalid-argument", "fileId, certNo, certYear, category, stokKodu zorunlu");
    }
    try {
      const saKey = COC_DRIVE_SA_KEY.value();
      // 1) Drive'dan indir
      const file = await downloadDriveFile(saKey, fileId);
      // 2) Firebase Storage'a yükle (COC path)
      const timestamp = Date.now();
      const safe = (s) => String(s || "").replace(/[^\w.\-]/g, "_").substring(0, 120);
      const safeName = safe(file.filename);
      const cocPath = `appData/cocCertificates/${certYear}/${safe(certNo)}/${category}_${timestamp}_${safeName}`;
      const bucket = admin.storage().bucket();
      const downloadUrl = await uploadWithDownloadToken(bucket, cocPath, file.buffer, file.contentType);
      // 3) Master path
      const masterPath = `appData/cocParts/${safe(stokKodu)}/${category}/${timestamp}_${safeName}`;
      const masterDownloadUrl = await uploadWithDownloadToken(bucket, masterPath, file.buffer, file.contentType);

      const now = new Date().toISOString();
      return {
        success: true,
        coc: {
          storagePath: cocPath,
          downloadUrl,
          filename: file.filename,
          size: file.size,
          contentType: file.contentType,
          uploadedAt: now,
          source: "drive",
          sourceFileId: fileId,
        },
        master: {
          storagePath: masterPath,
          downloadUrl: masterDownloadUrl,
          filename: file.filename,
          size: file.size,
          contentType: file.contentType,
          uploadedAt: now,
          source: "drive",
          sourceFileId: fileId,
        },
      };
    } catch (err) {
      logger.error("[COC Drive Import] Hata", { error: err.message, stack: err.stack });
      throw new HttpsError("internal", err.message);
    }
  },
);

// ====================================================================
// TEKLİF MODÜLÜ — Master Data + Arşiv Import (HTTP endpoints)
// Tek seferlik Excel yüklemesi (Teklif Verme Son Versiyon .xlsm).
// Staging modu ile önce test doc'larına yazılır, doğrulandıktan sonra
// promote endpoint'i ile prod doc'larına geçirilir.
// ====================================================================

exports.importQuoteExcelHttp = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST gerekli — body olarak Excel dosyası gönderin" });
      return;
    }
    try {
      const buffer = req.rawBody;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: "Body boş — Excel dosyası gönderilmedi" });
        return;
      }
      // Query parametreleri: ?staging=true&mode=master|archive|both
      const staging = req.query.staging !== "false"; // default true (güvenli)
      const mode = String(req.query.mode || "both"); // master | archive | both

      const workbook = XLSX.read(buffer, { type: "buffer" });
      const results = {};

      if (mode === "master" || mode === "both") {
        const masterParsed = parseQuoteMasterData(workbook);
        const masterOut = await saveQuoteMasterData(db, masterParsed, { staging });
        results.master = { ...masterOut, summary: masterParsed.summary };
      }
      if (mode === "archive" || mode === "both") {
        const archiveParsed = parseQuoteArchive(workbook);
        const archiveOut = await saveQuoteArchive(db, archiveParsed, { staging });
        results.archive = { ...archiveOut, summary: archiveParsed.summary };
        // Arşivden parça kütüphanesi çıkar — quoteParts iskeleti
        const partsExtract = extractQuotePartsFromArchive(archiveParsed);
        const partsOut = await saveQuoteParts(db, partsExtract, { staging });
        results.parts = { ...partsOut, summary: partsExtract.summary };
        // Arşivden müşteri master çıkar
        const customersExtract = extractQuoteCustomersFromArchive(archiveParsed);
        const customersOut = await saveQuoteCustomers(db, customersExtract, { staging });
        results.customers = { ...customersOut, summary: customersExtract.summary };
      }

      logger.info("[QuoteImport] ✓ Yüklendi", { staging, mode, results });
      res.json({ success: true, staging, mode, ...results });
    } catch (err) {
      logger.error("[QuoteImport] Hata", { error: err.message, stack: err.stack });
      res.status(500).json({ error: err.message });
    }
  },
);

// Staging → prod promote (admin manuel çağırır, tarayıcıdan tetiklenir).
exports.promoteQuoteStagingHttp = onRequest(
  {
    region: REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST gerekli" });
      return;
    }
    try {
      const out = await promoteQuoteStaging(db);
      logger.info("[QuotePromote] ✓ Staging → prod", out);
      res.json({ success: true, ...out });
    } catch (err) {
      logger.error("[QuotePromote] Hata", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);
