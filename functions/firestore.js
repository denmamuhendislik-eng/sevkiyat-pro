/**
 * firestore.js — Parser çıktılarını Firestore'a yazma
 *
 * KRİTİK: App.jsx'teki saveStock/saveAkibet/savePurchase fonksiyonlarının
 * yazdığı format ile BIREBIR aynı şema kullanılır. Sevkiyat Pro'nun
 * mevcut listener'ları bu doc'ları okuyup arayüzü tazeler.
 *
 * Doc yolları (App.jsx'ten):
 *   appData/mrpStock     → Stok raporu
 *   appData/mrpAkibet    → Bekleyen Operasyonlar (Ürünlü)
 *   appData/mrpPurchase  → Sipariş Kontrol Listesi
 *   appData/automationLog → her çalıştırma için entry (bu modülde yeni)
 */

const admin = require("firebase-admin");

const APP_COL = "appData";
const STOCK_DOC = "mrpStock";
const AKIBET_DOC = "mrpAkibet";
const PURCH_DOC = "mrpPurchase";
const AUTOMATION_LOG_DOC = "automationLog";

/**
 * Stock parser çıktısını Sevkiyat Pro'nun beklediği compact formata çevir.
 * App.jsx satır 5048-5056 ile birebir aynı dönüşüm.
 */
function transformStockForFirestore(parserResult, fileName) {
  const partsObj = {};
  parserResult.parts.forEach((p) => {
    partsObj[p.code] = {
      n: p.name,
      u: p.unit,
      g: p.group,
      a: p.ambar,
      r: p.uretim,
      f: p.fason,
      h: p.haric,
      t: p.total,
      lc: p.locs.length,
    };
  });
  return {
    importedAt: new Date().toISOString(),
    fileName,
    totalCodes: parserResult.totalCodes,
    totalRows: parserResult.totalRows,
    categories: parserResult.categories,
    fasonCompanies: parserResult.fasonCompanies,
    parts: partsObj,
  };
}

/**
 * Akibet parser zaten doğru formatta, doğrudan yazılır
 * (App.jsx saveAkibet → setDoc(..., result))
 */
function transformAkibetForFirestore(parserResult) {
  return parserResult;
}

/**
 * Purchase parser zaten doğru formatta, doğrudan yazılır
 */
function transformPurchaseForFirestore(parserResult) {
  return parserResult;
}

/**
 * Tek bir rapor için Firestore yazma — type'a göre uygun dönüşümü uygular
 */
async function saveReport(db, type, parserResult, fileName) {
  let docId, payload;
  if (type === "stock") {
    docId = STOCK_DOC;
    payload = transformStockForFirestore(parserResult, fileName);
  } else if (type === "akibet") {
    docId = AKIBET_DOC;
    payload = transformAkibetForFirestore(parserResult);
  } else if (type === "purchase") {
    docId = PURCH_DOC;
    payload = transformPurchaseForFirestore(parserResult);
  } else {
    throw new Error(`Bilinmeyen rapor tipi: ${type}`);
  }

  await db.collection(APP_COL).doc(docId).set(payload);
  return { docId, payload };
}

/**
 * Otomasyon log entry'si ekle. Her çalıştırma için bir entry tutulur.
 * Maksimum 50 entry — eski olanlar otomatik silinir (FIFO).
 *
 * Format:
 * appData/automationLog = {
 *   entries: [
 *     { runAt, source, results: [{ type, status, ... }], success: bool, error?: string },
 *     ...
 *   ]
 * }
 */
async function appendAutomationLog(db, entry) {
  const ref = db.collection(APP_COL).doc(AUTOMATION_LOG_DOC);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : { entries: [] };
  const entries = data.entries || [];
  entries.push(entry);
  // FIFO trim
  const MAX_ENTRIES = 50;
  const trimmed = entries.slice(-MAX_ENTRIES);
  await ref.set({ entries: trimmed }, { merge: false });
}

/**
 * Son otomasyon log entry'sini çek (UI'da göstermek için)
 */
async function getLatestAutomationLog(db) {
  const ref = db.collection(APP_COL).doc(AUTOMATION_LOG_DOC);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  const entries = data.entries || [];
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

module.exports = {
  APP_COL,
  STOCK_DOC,
  AKIBET_DOC,
  PURCH_DOC,
  AUTOMATION_LOG_DOC,
  saveReport,
  appendAutomationLog,
  getLatestAutomationLog,
  transformStockForFirestore,
};
