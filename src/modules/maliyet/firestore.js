import { doc, onSnapshot, setDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const LABOR_DOC = "laborCosts";
const WC_DOC = "workCenters";
const UNIT_COSTS_DOC = "unitCosts";

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
