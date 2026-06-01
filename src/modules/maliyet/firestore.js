import { doc, onSnapshot, setDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const LABOR_DOC = "laborCosts";
const WC_DOC = "workCenters";
const UNIT_COSTS_DOC = "unitCosts";
const PRODUCT_COSTS_LATEST_DOC = "productCostsLatest";

// laborCosts doc yapısı:
// {
//   monthlyOverheads: {
//     "2026-05": {
//       source: "manual" | "vio-mail",
//       receivedAt: "ISO date",
//       items: [{ id, category, amount, weightKey }],
//       totalTl: ...
//     }
//   },
//   machineRates: { [machineId]: { ratePerMin, currency, asOf } } // sonraki adım
// }

export function subscribeLaborCosts(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, LABOR_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("laborCosts listener:", err); callback({}); }
  );
}

// Tek ayın gider verisini yazar — diğer aylar/field'lar korunur (merge:true).
// Dot-notation ile sadece o ayın değeri update edilir.
export async function saveMonthlyOverhead(yearMonth, data, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — maliyet düzenleme sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error("Geçersiz ay formatı: " + yearMonth);
  const ref = doc(db, APP_COL, LABOR_DOC);
  try {
    await updateDoc(ref, { [`monthlyOverheads.${yearMonth}`]: data });
  } catch (e) {
    // Doc yoksa create et (merge:true ile diğer alanlar korunur)
    await setDoc(ref, { monthlyOverheads: { [yearMonth]: data } }, { merge: true });
  }
}

// Çoklu ay tek yükleme — VIO Hizmet Total Raporu Excel'inden gelen tüm aylar tek seferde yazılır.
// Mevcut ay verisi üzerine yazılır (kullanıcı kuralı: "üzerine yaz mantıklı").
export async function saveMonthlyOverheadsBulk(updates, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — maliyet düzenleme sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!updates || Object.keys(updates).length === 0) return { written: 0 };
  const ref = doc(db, APP_COL, LABOR_DOC);
  const dotMap = {};
  for (const [ym, data] of Object.entries(updates)) {
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    dotMap[`monthlyOverheads.${ym}`] = data;
  }
  try {
    await updateDoc(ref, dotMap);
  } catch (e) {
    // Doc yoksa create
    const monthlyOverheads = {};
    for (const [ym, data] of Object.entries(updates)) monthlyOverheads[ym] = data;
    await setDoc(ref, { monthlyOverheads }, { merge: true });
  }
  return { written: Object.keys(updates).length };
}

// Dağıtım politikası — 4 ağırlık (satınAlma/alan/kuruluKw/operator) + WC-bazlı maaş mapping
// Yeni model (eski categoryMappings yerine):
//   weights: { satinAlma: 0.40, alan: 0.30, kuruluKw: 0.10, operator: 0.20 }  (toplam 1.0)
//   wcSalaryMapping: { "730101": ["TORNA_CODE", "ISLEME_CODE"], ... }
export function subscribeOverheadPolicy(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "overheadDistributionPolicy");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("overheadPolicy listener:", err); callback({}); }
  );
}

export async function saveOverheadPolicy(data, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, "overheadDistributionPolicy");
  await setDoc(ref, { ...data, updatedAt: new Date().toISOString() }, { merge: false });
}

// Bir ayın verisini siler — diğer aylar korunur.
export async function deleteMonthlyOverhead(yearMonth, { canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Silme sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, LABOR_DOC);
  await updateDoc(ref, { [`monthlyOverheads.${yearMonth}`]: deleteField() });
}

// ==================== STOK SARF HAREKETLERİ (kesici takım, kesme yağı vs.) ====================
// laborCosts.monthlySupplies.{ay} → ayrı veri akışı, ayrı dağıtım (talaşlı imalat WC'leri)
// items: [{ code, name, kg, amountTl, unitCost }]
// totalTl: aylık toplam (Ciro Bedeli toplamı)
// Hizmet Total ile karışmasın diye ayrı field.

export async function saveMonthlySupplies(yearMonth, data, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error("Geçersiz ay formatı: " + yearMonth);
  const ref = doc(db, APP_COL, LABOR_DOC);
  try {
    await updateDoc(ref, { [`monthlySupplies.${yearMonth}`]: data });
  } catch (e) {
    await setDoc(ref, { monthlySupplies: { [yearMonth]: data } }, { merge: true });
  }
}

export async function saveMonthlySuppliesBulk(updates, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!updates || Object.keys(updates).length === 0) return { written: 0 };
  const ref = doc(db, APP_COL, LABOR_DOC);
  const dotMap = {};
  for (const [ym, data] of Object.entries(updates)) {
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    dotMap[`monthlySupplies.${ym}`] = data;
  }
  try {
    await updateDoc(ref, dotMap);
  } catch (e) {
    const monthlySupplies = {};
    for (const [ym, data] of Object.entries(updates)) monthlySupplies[ym] = data;
    await setDoc(ref, { monthlySupplies }, { merge: true });
  }
  return { written: Object.keys(updates).length };
}

export async function deleteMonthlySupplies(yearMonth, { canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Silme sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, LABOR_DOC);
  await updateDoc(ref, { [`monthlySupplies.${yearMonth}`]: deleteField() });
}

// Fason ücretleri — geçici tablo (fason takip modülü gelene kadar)
// Yapı:
//   opDefaults: { [opCode]: { name, unit: "AD"|"KG", unitPriceTl, note } }
//   partWeights: { [stokKodu]: { kg, name } }
//   partOverrides: { "opCode_stokKodu": { unit, unitPriceTl, name, note } }
export function subscribeFasonRates(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "fasonRates");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("fasonRates listener:", err); callback({}); }
  );
}

export async function saveFasonRates(data, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, "fasonRates");
  await setDoc(ref, { ...data, updatedAt: new Date().toISOString() }, { merge: false });
}

// MRP stok raporu subscribe — envanter değer hesabı için
export function subscribeMrpStock(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "mrpStock");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("mrpStock listener:", err); callback({}); }
  );
}

// Envanter snapshot'ları — çeyrek bazlı (manuel + otomatik cron)
// Yapı: { snapshots: { "2026-Q1": { takenAt, source, totalValue, ... }, ... } }
export function subscribeInventorySnapshots(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "inventorySnapshots");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("inventorySnapshots listener:", err); callback({}); }
  );
}

export async function saveInventorySnapshot(quarterKey, snapshotData, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, "inventorySnapshots");
  try {
    await updateDoc(ref, { [`snapshots.${quarterKey}`]: snapshotData });
  } catch (e) {
    await setDoc(ref, { snapshots: { [quarterKey]: snapshotData } }, { merge: true });
  }
}

export async function deleteInventorySnapshot(quarterKey, { canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Silme sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, "inventorySnapshots");
  await updateDoc(ref, { [`snapshots.${quarterKey}`]: deleteField() });
}

// productCostsLatest: en güncel mamul/yarı mamul rootCost map'i.
// ProductCostsTab hesap tamamlandığında çağırır → Cloud Function takeMonthlySnapshot
// bu doc'u okuyup mrpStock'taki mamul/yarı mamul stoklarını rootCost ile değerler.
// Aksi takdirde snapshot sadece BUY/RAW (unitCosts.byStock) sayar, mamul stokları 0 TL düşer.
// Yapı: { byStockCode: { [stockCode]: rootCost }, calculatedAt, monthRef, modelCount }
export async function saveProductCostsLatest(payload) {
  if (!db) return;
  const ref = doc(db, APP_COL, PRODUCT_COSTS_LATEST_DOC);
  await setDoc(ref, payload);
}

// BOM modelleri subscribe (read-only) — mamul maliyet hesabı için
export function subscribeBomModels(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "bomModels");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("bomModels listener:", err); callback({}); }
  );
}

// Mamul tespiti için yardımcı subscribe'lar:
// - products: appData/state doc'unun products array'i (vioCode → kayıtlı mamul listesi)
// - salesOrders: müşteri satış siparişlerindeki stokKodu (BOM dışı satılan mamuller — örn. yedek parçalar)
// Envanter kategorisi BUY/BOM Dışı çıkan ama satılıyor olan stokları "Mamul" olarak işaretler.
export function subscribeProducts(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "state");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data()?.products || []) : []),
    (err) => { console.error("products listener:", err); callback([]); }
  );
}

export function subscribeSalesOrders(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "salesOrders");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("salesOrders listener:", err); callback({}); }
  );
}

// TCMB döviz kurları — günlük 16:30 cron tarafından doldurulur
// Yapı: { rates: { "2026-05-13": { usd, eur, source, fetchedAt } }, lastFetch, lastDate }
export function subscribeCurrencyRates(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "currencyRates");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("currencyRates listener:", err); callback({}); }
  );
}

// MRP modülündeki manuel kategori override'ları — App.jsx:5730 (appData/mrpBomMapping)
// _catOverrides: { stockCode: "raw_dokum" | "buy_rulman" | ... } — kullanıcı isteğiyle
// otomatik isim regex'inin önüne geçer. Envanter Değeri sekmesinden de yazılabilir
// (tek kaynak, çift giriş noktası — MRP ↔ Envanter aynı doc'a yazıyor).
export function subscribeBomMapping(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, "mrpBomMapping");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("bomMapping listener:", err); callback({}); }
  );
}

// Envanter sekmesinden BUY/RAW alt kategori override yazıcısı.
// catKey null → override sil (otomatik mantığa dön)
export async function saveCatOverride(stockCode, catKey, { canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Kategori override sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!stockCode) throw new Error("Stok kodu zorunlu");
  const ref = doc(db, APP_COL, "mrpBomMapping");
  const fieldPath = `_catOverrides.${stockCode}`;
  try {
    await updateDoc(ref, { [fieldPath]: catKey === null ? deleteField() : catKey });
  } catch (e) {
    // Doc yoksa create et
    if (catKey !== null) {
      await setDoc(ref, { _catOverrides: { [stockCode]: catKey } }, { merge: true });
    }
  }
}

// workCenters subscribe — Maliyet modülü tezgah meta verilerine erişir.
// MRP modülü ile aynı doc, MRP yazarken merge:true olmasa bile maliyet field'ları
// state'te korunur (subscribe sayesinde) → setDoc tüm doc'u yazınca dahil olur.
export function subscribeWorkCenters(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, WC_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("workCenters listener:", err); callback({}); }
  );
}

// Tek WC'nin tezgah listesini günceller (machines array dot-notation ile replace).
// Diğer WC'ler ve top-level field'lar (shiftHours, efficiency, fason vs.) korunur.
export async function saveMachinesForWc(wcCode, newMachines, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — tezgah meta düzenleme sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!wcCode) throw new Error("WC kodu gerekli");
  const ref = doc(db, APP_COL, WC_DOC);
  await updateDoc(ref, { [`centers.${wcCode}.machines`]: newMachines });
}

// WC bazlı manuel default cycle süresi (dk). BOM'da cycleTime girilmemiş op'lar için kullanılır.
// 0 veya null → temizle (BOM ortalamasına veya global default'a düşsün).
export async function saveWcManualCycle(wcCode, minutes, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!wcCode) throw new Error("WC kodu gerekli");
  const ref = doc(db, APP_COL, WC_DOC);
  const val = (minutes === null || minutes === "" || Number(minutes) <= 0) ? deleteField() : Number(minutes);
  await updateDoc(ref, { [`centers.${wcCode}.manualCycleMin`]: val });
}

// unitCosts — stok kodu bazında FIFO parti tarihçesi
// Yapı: { byStock: { [stokKodu]: { partitions: [...], lastImport, ... } }, lastImport, importCount }
export function subscribeUnitCosts(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, UNIT_COSTS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("unitCosts listener:", err); callback({}); }
  );
}

// Yeni partileri kaydet — stok bazında merge.
// Mevcut partition aynı belgeNo+orderDate+code ile varsa atla (duplicate önleme).
// existing: subscribeUnitCosts'tan gelen mevcut data (read-modify-write için)
export async function saveUnitCostPartitions(existing, newPartitions, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — birim maliyet kayıt sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!Array.isArray(newPartitions) || newPartitions.length === 0) return { added: 0, skipped: 0 };

  const byStock = { ...(existing?.byStock || {}) };
  let added = 0, skipped = 0;
  const importStamp = new Date().toISOString();

  for (const p of newPartitions) {
    if (!p.code) { skipped++; continue; }
    const slot = byStock[p.code] || { partitions: [], lastImport: null };
    // Duplicate kontrolü: belgeNo + orderDate + originalQty eşleşirse atla
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
      _rawTotalBedel: p._rawTotalBedel || 0,
      _has2ndUnitDiscrepancy: !!p._has2ndUnitDiscrepancy,
      importedAt: importStamp,
    });
    // Slot seviyesinde de en son ad'ı tut (hızlı arama için, partitions'dan bağımsız)
    if (p.name) slot.lastName = p.name;
    // FIFO: orderDate'e göre sırala
    slot.partitions.sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    slot.lastImport = importStamp;
    byStock[p.code] = slot;
    added++;
  }

  const ref = doc(db, APP_COL, UNIT_COSTS_DOC);
  await setDoc(ref, {
    byStock,
    lastImport: importStamp,
    importCount: (existing?.importCount || 0) + 1,
  }, { merge: false });

  return { added, skipped };
}

// Tüm unitCosts doc'unu sıfırla (admin only — başlangıç hatası için).
export async function clearUnitCosts({ canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Sıfırlama sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, UNIT_COSTS_DOC);
  await setDoc(ref, { byStock: {}, lastImport: null, importCount: 0 });
}
