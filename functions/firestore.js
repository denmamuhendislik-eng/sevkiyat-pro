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
const SALES_ORDERS_DOC = "salesOrders";
const SHIPMENTS_DOC = "shipments";
const PLAN_OVERRIDES_DOC = "planOverrides";
const AUTOMATION_LOG_DOC = "automationLog";

/**
 * Stock parser çıktısını Sevkiyat Pro'nun beklediği compact formata çevir.
 * App.jsx satır 5057-5060 ile birebir aynı dönüşüm.
 *
 * v13: pl[] = sadece üretim hattı (PRES/KAYNAK/TALAŞ/Üretim Hattı/Lazer Mamül Ambarı)
 * lokasyon detayı — Sevkiyat Bazlı İhtiyaç ekranındaki "🔍 Kontrol Önerilir" rozeti için.
 * Diğer lokasyonlar (ambar/fason/haric) kompakt total'larda zaten var, detay tutmaya gerek yok.
 */
function transformStockForFirestore(parserResult, fileName) {
  const partsObj = {};
  parserResult.parts.forEach((p) => {
    const pl = (p.locs || [])
      .filter((l) => l.c === "uretim")
      .map((l) => ({ l: l.l, q: l.q, o: l.o || null, n: l.n || null }));
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
      ...(pl.length > 0 ? { pl } : {}),
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
  } else if (type === "salesOrders") {
    // Özel akış: önce eski salesOrders ile diff hesapla, shipments güncelle, sonra yaz.
    const diffResult = await saveSalesOrdersWithDiff(db, parserResult);
    return { docId: SALES_ORDERS_DOC, payload: parserResult.ordersMap || {}, diffMeta: diffResult };
  } else {
    throw new Error(`Bilinmeyen rapor tipi: ${type}`);
  }

  await db.collection(APP_COL).doc(docId).set(payload);
  return { docId, payload };
}

/**
 * salesOrders + shipments birleşik yazımı — sevk geçmişi diff hesabı.
 *
 * VIO sadece aktif siparişleri verir; tam teslim olunca rapordan düşer. Diff:
 *   1. Eskide var, yenide var, sevkEdilen artmış → "vio-update" event
 *   2. Eskide var, yenide yok → "vio-removed" final event (kalan miktar tam sevk varsayımı)
 *   3. Eskide yok, yenide var (sevkEdilen>0) → initial "vio-update" event
 *
 * DigerMusteriler.jsx handleFile içindeki logic'in CommonJS aynası — frontend
 * manuel yükleme ile cloud function mail otomasyonu BİREBİR aynı diff üretir.
 *
 * @returns {Promise<{eventCount, salesOrdersCount}>}
 */
async function saveSalesOrdersWithDiff(db, parserResult) {
  const importedAt = new Date().toISOString();
  const newOrdersMap = parserResult.ordersMap || {};

  // Eski salesOrders + shipments + planOverrides oku.
  // planOverrides: deferred-aware diff için — kullanıcı bir siparişi "Akibeti Belirsiz"
  // işaretlediyse, VIO'dan kaybolması iptal sayılır (sahte sevk event yazılmaz).
  const ordersRef = db.collection(APP_COL).doc(SALES_ORDERS_DOC);
  const shipmentsRef = db.collection(APP_COL).doc(SHIPMENTS_DOC);
  const overridesRef = db.collection(APP_COL).doc(PLAN_OVERRIDES_DOC);
  const [ordersSnap, shipmentsSnap, overridesSnap] = await Promise.all([
    ordersRef.get(), shipmentsRef.get(), overridesRef.get()
  ]);
  const oldOrders = ordersSnap.exists ? (ordersSnap.data() || {}) : {};
  const newShipments = shipmentsSnap.exists ? { ...(shipmentsSnap.data() || {}) } : {};
  const oldOverrides = overridesSnap.exists ? (overridesSnap.data() || {}) : {};
  const overrideUpdates = {}; // status değişen override'lar (deferred → cancelled)
  let cancelledCount = 0;

  // ID şeması {belgeNo}_{stokKodu}_{teslimTarihi} → VIO'da teslim tarihi güncellenirse
  // eski ID kaybolur, yeni ID gelir. Sahte vio-removed event yazmamak için (belgeNo, stokKodu)
  // → yeni ID listesi indeksi kuruyoruz. Eski ID kayıpsa ama aynı belge+stok yeni VIO'da varsa
  // teslim güncellemesi varsay, event yazma.
  const newBelgeStokIndex = {};
  for (const [id, o] of Object.entries(newOrdersMap)) {
    if (!o || !o.belgeNo || !o.stokKodu) continue;
    const key = `${o.belgeNo}|${o.stokKodu}`;
    if (!newBelgeStokIndex[key]) newBelgeStokIndex[key] = [];
    newBelgeStokIndex[key].push(id);
  }
  const hasReplacementInVio = (oldO) => {
    if (!oldO?.belgeNo || !oldO?.stokKodu) return false;
    const arr = newBelgeStokIndex[`${oldO.belgeNo}|${oldO.stokKodu}`];
    return !!(arr && arr.length > 0);
  };

  // Override migration — VIO'da teslim tarihi değişerek 3-tuple ID'si değişen sipariş için
  // eski ID'nin planOverrides kaydını yeni ID'ye taşır. Sadece 1-1 replacement durumunda
  // çalışır (birden fazla aday varsa belirsizlik → orphan bırakılır, kullanıcı UI'dan
  // müdahale eder). Yeni ID'de zaten override varsa çakışma korunur.
  // Hem deferred hem diğer override türleri (note, manuel hafta) için aynı şekilde çalışır.
  let migratedCount = 0;
  const migrateOverrideIfReplacement = (oldId, oldO) => {
    const ov = oldOverrides[oldId];
    if (!ov) return;
    const arr = newBelgeStokIndex[`${oldO.belgeNo}|${oldO.stokKodu}`] || [];
    if (arr.length !== 1) return; // belirsizlik — orphan bırak
    const newId = arr[0];
    if (oldOverrides[newId] || overrideUpdates[newId] !== undefined) return; // çakışma
    overrideUpdates[newId] = {
      ...ov,
      migratedFrom: oldId,
      migratedAt: importedAt,
    };
    overrideUpdates[oldId] = admin.firestore.FieldValue.delete();
    migratedCount++;
  };

  let eventCount = 0;
  const ensureShipmentDoc = (id, o) => {
    if (!newShipments[id]) {
      newShipments[id] = {
        customerCode: o.customerCode || "",
        customerName: o.customerName || "",
        stokKodu: o.stokKodu || "",
        stokAdi: o.stokAdi || "",
        belgeNo: o.belgeNo || "",
        orijinalMiktar: o.orijinalMiktar || 0,
        teslimTarihi: o.teslimTarihi || "",
        events: [],
        totalShipped: 0,
        fullyDelivered: false,
        firstShipAt: "",
        finalShipAt: "",
        lastUpdate: importedAt,
      };
    }
    return newShipments[id];
  };
  const pushEvent = (id, event) => {
    const sh = newShipments[id];
    sh.events.push(event);
    sh.totalShipped = event.cumulative;
    sh.lastUpdate = importedAt;
    if (!sh.firstShipAt) sh.firstShipAt = event.at;
    sh.finalShipAt = event.at;
    if (event.final) sh.fullyDelivered = true;
    eventCount++;
  };

  // 1) Eskide var olanları işle
  for (const [id, oldO] of Object.entries(oldOrders)) {
    if (!oldO || typeof oldO !== "object") continue;
    const ov = oldOverrides[id];
    const isDeferred = ov?.status === "deferred";
    const newO = newOrdersMap[id];

    if (isDeferred) {
      // Deferred sipariş — diff'ten muaf, sahte sevk event yazma
      if (!newO) {
        if (hasReplacementInVio(oldO)) {
          // Teslim tarihi VIO'da güncellenmiş — iptal değil. Override'ı yeni ID'ye taşı
          // (1-1 replacement varsa). Belirsizlik/çakışma varsa orphan kalır.
          migrateOverrideIfReplacement(id, oldO);
          continue;
        }
        // Gerçekten kayboldu + deferred idi → İPTAL kabul et
        overrideUpdates[id] = { ...ov, status: "cancelled", cancelledAt: importedAt };
        cancelledCount++;
      }
      // else: hala VIO'da, kalanMiktar otomatik güncellenir (salesOrders setDoc), event yazma
      continue;
    }

    if (newO) {
      const oldShip = Number(oldO.sevkEdilen || 0);
      const newShip = Number(newO.sevkEdilen || 0);
      const delta = newShip - oldShip;
      if (delta > 0) {
        ensureShipmentDoc(id, newO);
        pushEvent(id, { at: importedAt, deltaQty: delta, cumulative: newShip, source: "vio-update" });
      }
    } else {
      // VIO'dan kayboldu — gerçek kayıp mı yoksa teslim tarihi güncellemesi mi?
      // Aynı (belgeNo, stokKodu) yeni VIO'da varsa: teslim güncellemesi → sahte event yazma.
      if (hasReplacementInVio(oldO)) {
        // Deferred olmayan override'lar (note / manuel hafta) için de migration çalışır.
        // ov undefined ise helper kendi içinde no-op döner.
        migrateOverrideIfReplacement(id, oldO);
        continue;
      }
      // Gerçekten kayboldu → kalan miktar tam sevk varsayımı
      const oldRemaining = Number(oldO.kalanMiktar || 0);
      if (oldRemaining > 0) {
        ensureShipmentDoc(id, oldO);
        const cumulative = Number(oldO.orijinalMiktar || 0);
        pushEvent(id, { at: importedAt, deltaQty: oldRemaining, cumulative, source: "vio-removed", final: true });
      } else if (newShipments[id]) {
        newShipments[id].fullyDelivered = true;
        newShipments[id].lastUpdate = importedAt;
      }
    }
  }
  // 2) Yenide olup eskide olmayan siparişler
  for (const [id, newO] of Object.entries(newOrdersMap)) {
    if (oldOrders[id]) continue;
    const newShip = Number(newO.sevkEdilen || 0);
    if (newShip > 0) {
      ensureShipmentDoc(id, newO);
      pushEvent(id, { at: importedAt, deltaQty: newShip, cumulative: newShip, source: "vio-update" });
    }
  }

  // Yaz: salesOrders her zaman, shipments sadece event üretildiyse,
  // planOverrides cancelled geçişi VEYA migration olduysa (merge ile diğerleri korunur).
  await ordersRef.set(newOrdersMap);
  if (eventCount > 0) {
    await shipmentsRef.set(newShipments);
  }
  if (Object.keys(overrideUpdates).length > 0) {
    await overridesRef.set(overrideUpdates, { merge: true });
  }
  return { eventCount, cancelledCount, migratedCount, salesOrdersCount: Object.keys(newOrdersMap).length };
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
  SALES_ORDERS_DOC,
  SHIPMENTS_DOC,
  AUTOMATION_LOG_DOC,
  saveReport,
  saveSalesOrdersWithDiff,
  appendAutomationLog,
  getLatestAutomationLog,
  transformStockForFirestore,
};
