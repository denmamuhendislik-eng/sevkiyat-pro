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
const UNIT_COSTS_DOC = "unitCosts";
const LABOR_COSTS_DOC = "laborCosts";
const OVERHEAD_MAPPINGS_DOC = "overheadCategoryMappings";
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
async function saveReport(db, type, parserResult, fileName, opts = {}) {
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
  } else if (type === "overhead") {
    // Özel akış: çoklu ay yazımı + kategori mapping tahmin + mail tarihi bazlı kısmi-ay kontrolü
    const overheadOut = await saveOverheadReport(db, parserResult, { messageDate: opts.messageDate });
    return { docId: LABOR_COSTS_DOC, payload: null, overheadMeta: overheadOut };
  } else if (type === "supplies") {
    // Özel akış: monthlySupplies.{ym} dot-notation çoklu ay yazımı + mail tarihi bazlı kısmi-ay kontrolü
    const suppliesOut = await saveSuppliesReport(db, parserResult, { messageDate: opts.messageDate });
    return { docId: LABOR_COSTS_DOC, payload: null, suppliesMeta: suppliesOut };
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

// unitCosts'a FIFO partilerini merge eder. Aynı belgeNo+date+qty+price kombinasyonu varsa atla.
async function saveUnitCostPartitions(db, newPartitions) {
  if (!Array.isArray(newPartitions) || newPartitions.length === 0) {
    return { added: 0, skipped: 0, stockCount: 0 };
  }
  const ref = db.collection(APP_COL).doc(UNIT_COSTS_DOC);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};
  const byStock = { ...(existing.byStock || {}) };
  let added = 0, skipped = 0;
  const importStamp = new Date().toISOString();

  for (const p of newPartitions) {
    if (!p.code) { skipped++; continue; }
    const slot = byStock[p.code] || { partitions: [], lastImport: null };
    const isDup = slot.partitions.some(ep =>
      ep.belgeNo === p.belgeNo &&
      ep.orderDate === p.orderDate &&
      ep.originalQty === p.originalQty &&
      ep.unitPriceTl === p.unitPriceTl
    );
    if (isDup) { skipped++; continue; }
    slot.partitions.push({
      belgeNo: p.belgeNo || "",
      orderDate: p.orderDate || null,
      teslimDate: p.teslimDate || null,
      name: p.name || "",
      originalQty: p.originalQty || 0,
      shippedQty: p.shippedQty || 0,
      remainingQty: p.remainingQty || 0,
      unitPriceTl: p.unitPriceTl || 0,
      unitPriceDvz: p.unitPriceDvz || 0,
      currency: p.currency || "TRY",
      currencyGuess: p.currencyGuess || null,
      supplierCode: p.supplierCode || "",
      supplier: p.supplier || "",
      _rawPrice: p._rawPrice || 0,
      _rawDvzPrice: p._rawDvzPrice || 0,
      importedAt: importStamp,
      importSource: "vio-mail",
    });
    slot.partitions.sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    slot.lastImport = importStamp;
    if (p.name) slot.lastName = p.name;
    byStock[p.code] = slot;
    added++;
  }

  await ref.set({
    byStock,
    lastImport: importStamp,
    importCount: (existing.importCount || 0) + 1,
  });

  return { added, skipped, stockCount: Object.keys(byStock).length };
}

// Genel gider raporu (Hizmet Total) çoklu ay yazımı + kategori mapping akıllı tahmin.
// opts.messageDate (Gmail internalDate, unix ms) verilirse mail ay sonundan önce gelmişse
// o ay "kısmi" sayılıp skip edilir — VIO bazen ay-içi (örn. 10 Mayıs) interim raporu atıyor.
async function saveOverheadReport(db, parserResult, opts = {}) {
  if (!parserResult?.byMonth || Object.keys(parserResult.byMonth).length === 0) {
    return { monthsWritten: 0, codesGuessed: 0 };
  }
  // Mevcut kategori mapping'lerini çek (saved overrides)
  const mappingsRef = db.collection(APP_COL).doc(OVERHEAD_MAPPINGS_DOC);
  const mappingsSnap = await mappingsRef.get();
  const savedMappings = mappingsSnap.exists ? (mappingsSnap.data()?.mappings || {}) : {};

  // Anahtar kelime tahmin (frontend ile aynı)
  const KEYWORDS = [
    { weightKey: "power", words: ["elektrik"] },
    { weightKey: "area",  words: ["bina", "doğalgaz", "doğal gaz", "su giderleri", "su gideri", "kira", "ısıtma", "isitma", "aydınlatma"] },
    { weightKey: "amortization", words: ["makine", "demirbaş", "demirbas", "tamir", "bakım", "bakim", "amortisman"] },
  ];
  function guessWeight(code, name) {
    if (savedMappings[code]) return savedMappings[code];
    const txt = `${code || ""} ${name || ""}`.toLocaleLowerCase("tr-TR");
    for (const rule of KEYWORDS) {
      if (rule.words.some(w => txt.includes(w))) return rule.weightKey;
    }
    return "machineCount";
  }

  const importedAt = parserResult.importedAt || new Date().toISOString();
  // Bugünün ayı — kısmi/eksik olduğu için atlanır (VIO her ayın 10'unda gönderdiğinde o ay henüz bitmemiş)
  const currentMonth = new Date().toISOString().slice(0, 7);
  // Mail tarihi (Gmail internalDate, unix ms) — ay sonundan önce geldiyse o ay kısmi sayılır.
  // Cron her gün çalıştığı için bir sonraki ayın 1+'inde aynı mail görüldüğünde mevcut
  // ym >= currentMonth kuralı geçilebiliyordu ama içerik 10 günlük olabilirdi → bu kontrol kapatıyor.
  const messageDateMs = Number(opts?.messageDate) || null;
  const monthlyOverheads = {};
  const updatedMappings = { ...savedMappings };
  let codesGuessed = 0;
  const skippedMonths = [];
  const skippedPartialMonths = [];

  for (const [ym, m] of Object.entries(parserResult.byMonth)) {
    if (ym >= currentMonth) {
      skippedMonths.push(ym);
      continue;
    }
    // Yeni kural: mail ay sonundan SONRA gelmeli (ay tamamlanmış demek). Aksi takdirde kısmi.
    if (messageDateMs) {
      const [yy, mm] = ym.split("-").map(Number);
      // Ayın son gününün gece yarısı — mail bu tarihten önce geldiyse içerik tamamlanmamış
      const lastDayOfYmMs = new Date(yy, mm, 0, 23, 59, 59, 999).getTime();
      if (messageDateMs <= lastDayOfYmMs) {
        skippedPartialMonths.push(ym);
        continue;
      }
    }
    // Aynı kod birden çok satırda olursa birleştir (ay içi)
    const merged = {};
    for (const it of m.items) {
      const key = it.code;
      if (!merged[key]) {
        const weightKey = guessWeight(it.code, it.name);
        if (!savedMappings[it.code]) codesGuessed++;
        merged[key] = { id: it.code, category: it.name, amount: 0, weightKey };
      }
      merged[key].amount += Number(it.amount) || 0;
    }
    const items = Object.values(merged).filter(it => it.amount > 0);
    const totalTl = items.reduce((s, it) => s + it.amount, 0);
    monthlyOverheads[ym] = {
      source: "vio-mail",
      receivedAt: importedAt,
      items,
      totalTl,
    };
    for (const it of items) updatedMappings[it.id] = it.weightKey;
  }

  // Tek update — dot-notation ile sadece yeni ayları yaz (diğer aylar korunur)
  const laborRef = db.collection(APP_COL).doc(LABOR_COSTS_DOC);
  const dotMap = {};
  for (const [ym, data] of Object.entries(monthlyOverheads)) dotMap[`monthlyOverheads.${ym}`] = data;
  try {
    await laborRef.update(dotMap);
  } catch (e) {
    await laborRef.set({ monthlyOverheads }, { merge: true });
  }
  // Mapping'leri kaydet — sadece yazılacak ay varsa (boş kayıt mevcut mapping'leri silmesin)
  if (Object.keys(monthlyOverheads).length > 0) {
    await mappingsRef.set({ mappings: updatedMappings, updatedAt: importedAt }, { merge: false });
  }

  return {
    monthsWritten: Object.keys(monthlyOverheads).length,
    codesGuessed,
    totalTl: Object.values(monthlyOverheads).reduce((s, m) => s + (m.totalTl || 0), 0),
    skippedMonths,
    skippedPartialMonths,
  };
}

/**
 * Stok Sarf Hareketleri (Özet - Aylık Alışlar) — laborCosts.monthlySupplies field'ına
 * çoklu ay dot-notation yazımı + mail tarihi bazlı kısmi-ay koruması (overhead ile aynı pattern).
 *
 * parserResult.months: { "YYYY-MM": { items: [{code, name, kg, amountTl, unitCost}], totalTl, itemCount } }
 * opts.messageDate: Gmail internalDate (unix ms) — ay sonundan önce geldiyse o ay skip
 */
async function saveSuppliesReport(db, parserResult, opts = {}) {
  if (!parserResult?.months || Object.keys(parserResult.months).length === 0) {
    return { monthsWritten: 0, itemCount: 0 };
  }
  const importedAt = parserResult.importedAt || new Date().toISOString();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const messageDateMs = Number(opts?.messageDate) || null;
  const monthlySupplies = {};
  const skippedMonths = [];
  const skippedPartialMonths = [];

  for (const [ym, m] of Object.entries(parserResult.months)) {
    if (ym >= currentMonth) {
      skippedMonths.push(ym);
      continue;
    }
    if (messageDateMs) {
      const [yy, mm] = ym.split("-").map(Number);
      const lastDayOfYmMs = new Date(yy, mm, 0, 23, 59, 59, 999).getTime();
      if (messageDateMs <= lastDayOfYmMs) {
        skippedPartialMonths.push(ym);
        continue;
      }
    }
    // Aynı kod ay içinde birden fazla satırda olabilir — birleştir
    const merged = {};
    for (const it of m.items) {
      if (!merged[it.code]) {
        merged[it.code] = { code: it.code, name: it.name, kg: 0, amountTl: 0, unitCost: it.unitCost || 0 };
      }
      merged[it.code].kg += Number(it.kg) || 0;
      merged[it.code].amountTl += Number(it.amountTl) || 0;
    }
    const items = Object.values(merged).filter(it => it.amountTl > 0);
    const totalTl = items.reduce((s, it) => s + it.amountTl, 0);
    monthlySupplies[ym] = {
      source: "vio-mail",
      receivedAt: importedAt,
      items,
      totalTl: Math.round(totalTl * 100) / 100,
      itemCount: items.length,
    };
  }

  if (Object.keys(monthlySupplies).length === 0) {
    return { monthsWritten: 0, itemCount: 0, skippedMonths, skippedPartialMonths };
  }

  // Tek update — dot-notation ile sadece yeni ayları yaz (mevcut aylar korunur)
  const laborRef = db.collection(APP_COL).doc(LABOR_COSTS_DOC);
  const dotMap = {};
  for (const [ym, data] of Object.entries(monthlySupplies)) dotMap[`monthlySupplies.${ym}`] = data;
  try {
    await laborRef.update(dotMap);
  } catch (e) {
    await laborRef.set({ monthlySupplies }, { merge: true });
  }

  return {
    monthsWritten: Object.keys(monthlySupplies).length,
    itemCount: Object.values(monthlySupplies).reduce((s, m) => s + (m.itemCount || 0), 0),
    totalTl: Object.values(monthlySupplies).reduce((s, m) => s + (m.totalTl || 0), 0),
    skippedMonths,
    skippedPartialMonths,
  };
}

/**
 * TCMB döviz kurlarını Firestore'a yaz — günlük cron için.
 * appData/currencyRates doc'una rates.{YYYY-MM-DD} field'ı eklenir (deep merge).
 * Not: set() + merge:true ile NESTED map yazılır; dot-notation string key olarak
 * yazılır ve frontend okuyamaz. update() dot notation'ı nested olarak yorumlar.
 */
async function saveCurrencyRates(db, rateRecord) {
  if (!rateRecord || !rateRecord.date) return;
  const ref = db.collection(APP_COL).doc("currencyRates");
  const entry = {
    usd: rateRecord.usd,
    eur: rateRecord.eur,
    source: rateRecord.source,
    fetchedAt: rateRecord.fetchedAt,
  };
  try {
    // update → dot notation'ı NESTED yorumlar (rates.{date} alt-objeye yazar)
    await ref.update({
      [`rates.${rateRecord.date}`]: entry,
      lastFetch: rateRecord.fetchedAt,
      lastDate: rateRecord.date,
    });
  } catch (e) {
    // Doc yoksa create et (yeni doc, ilk yazım)
    await ref.set({
      rates: { [rateRecord.date]: entry },
      lastFetch: rateRecord.fetchedAt,
      lastDate: rateRecord.date,
    });
  }
}

/**
 * Önceki ayın aylık envanter snapshot'ını yaz — cron için.
 * monthKey: "YYYY-MM" (örn. "2026-04" → Nisan kapanış)
 * inventorySnapshots.snapshots.{monthKey} alanına nested kayıt (deep merge).
 */
async function saveMonthlyInventorySnapshot(db, monthKey, snapshot) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error("Geçersiz monthKey: " + monthKey);
  }
  const ref = db.collection(APP_COL).doc("inventorySnapshots");
  try {
    await ref.update({
      [`snapshots.${monthKey}`]: snapshot,
      lastAutoSnapshot: snapshot.takenAt,
    });
  } catch (e) {
    // Doc yoksa create et (ilk yazım)
    await ref.set({
      snapshots: { [monthKey]: snapshot },
      lastAutoSnapshot: snapshot.takenAt,
    });
  }
}

/**
 * Bir doc'tan tek field oku (snapshot cron için mrpStock/unitCosts/currencyRates).
 */
async function readAppDoc(db, docName) {
  const snap = await db.collection(APP_COL).doc(docName).get();
  return snap.exists ? snap.data() : null;
}

module.exports = {
  APP_COL,
  STOCK_DOC,
  AKIBET_DOC,
  PURCH_DOC,
  SALES_ORDERS_DOC,
  SHIPMENTS_DOC,
  AUTOMATION_LOG_DOC,
  UNIT_COSTS_DOC,
  LABOR_COSTS_DOC,
  saveReport,
  saveSalesOrdersWithDiff,
  saveUnitCostPartitions,
  saveOverheadReport,
  saveSuppliesReport,
  appendAutomationLog,
  getLatestAutomationLog,
  saveCurrencyRates,
  saveMonthlyInventorySnapshot,
  readAppDoc,
  transformStockForFirestore,
};
