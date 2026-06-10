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
const { parseStockReport, parseAkibetExcel, parsePurchaseExcel, parsePurchaseWithPrices, parseSalesOrdersReport, parseOverheadExcel, parseSuppliesExcel } = require("./parsers");
const { saveReport, appendAutomationLog, saveUnitCostPartitions, saveOverheadReport, saveCurrencyRates, saveMonthlyInventorySnapshot, readAppDoc } = require("./firestore");
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
        // Monthly rapor (ayda bir VIO tarafından gönderilen) için mail yokluğu fail sayılmaz
        if (item.status !== "no_recent_monthly") {
          overallSuccess = false;
          logger.warn(`[VIO] ${item.label}: ${item.status}`, { error: item.error });
        } else {
          logger.info(`[VIO] ${item.label}: ${item.status} (monthly — beklenen)`);
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
          (item.type === "supplies" && (parserResult.totalItems === 0 || (parserResult.monthsList?.length || 0) === 0));

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
