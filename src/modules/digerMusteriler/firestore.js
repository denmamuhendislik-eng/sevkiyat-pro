import { doc, onSnapshot, setDoc, updateDoc, deleteField, deleteDoc } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const SALES_ORDERS_DOC = "salesOrders";
const PLAN_OVERRIDES_DOC = "planOverrides";
const BOM_MODELS_DOC = "bomModels";
const SHIPMENTS_DOC = "shipments";
const AUTOMATION_LOG_DOC = "automationLog";
const COC_PARTS_DOC = "cocParts";
const COC_CERTIFICATES_DOC = "cocCertificates"; // year suffix eklenir: cocCertificates_2026

export function subscribeSalesOrders(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, SALES_ORDERS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("salesOrders listener:", err); callback({}); }
  );
}

export function subscribePlanOverrides(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, PLAN_OVERRIDES_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("planOverrides listener:", err); callback({}); }
  );
}

// READ-ONLY — bomModels doc'una yazma YOK (v19 Seviye 1 izolasyon)
export function subscribeBomModels(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, BOM_MODELS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("bomModels listener:", err); callback({}); }
  );
}

export async function saveSalesOrders(ordersMap, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — yükleme sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, SALES_ORDERS_DOC);
  await setDoc(ref, ordersMap);
}

// shipments — sevk geçmişi (orderId → { events: [...], totalShipped, fullyDelivered, ... }).
// VIO diff sonucu üretilir; ileride manuel sevk girişiyle de zenginleşebilir (events[].source = "manual-shipment").
export function subscribeShipments(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, SHIPMENTS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : {}),
    (err) => { console.error("shipments listener:", err); callback({}); }
  );
}

export async function saveShipments(shipmentsMap, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — yükleme sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, SHIPMENTS_DOC);
  await setDoc(ref, shipmentsMap);
}

// ====================================================================
// COC (Uygunluk Belgesi) — parça master + year-bazlı sertifika arşivi
// ====================================================================

// cocParts subscribe — parça master ({ parts: { [stokKodu]: {description, faiNo, revisions, customerCode} } })
export function subscribeCocParts(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, COC_PARTS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : { parts: {} }),
    (err) => { console.error("cocParts listener:", err); callback({ parts: {} }); }
  );
}

// cocCertificates year-bazlı subscribe — appData/cocCertificates_{YYYY}
// Yapı: { certificates: { [id]: {...} }, year, totalCount }
export function subscribeCocCertificates(year, callback) {
  if (!db || !year) return () => {};
  const ref = doc(db, APP_COL, `${COC_CERTIFICATES_DOC}_${year}`);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : { certificates: {}, year }),
    (err) => { console.error(`cocCertificates_${year} listener:`, err); callback({ certificates: {}, year }); }
  );
}

// Yeni COC sertifikası yaz (UI'dan oluşturulan).
// ID şeması: `${certNo}_${siraNo}` (Excel import ile aynı), siraNo default "1".
// Year-bazlı doc'a yazar. Mevcut sertifika no çakışırsa hata fırlatır (override engelle).
export async function saveCocCertificate(cert, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — COC oluşturma sadece admin/üretim/satış rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!cert.certNo || !cert.stokKodu) throw new Error("certNo ve stokKodu zorunlu");
  const year = cert.certNo.substring(0, 4);
  if (!/^\d{4}$/.test(year)) throw new Error(`Geçersiz sertifika no formatı: ${cert.certNo}`);
  const siraNo = String(cert.siraNo || "1").trim() || "1";
  const id = `${cert.certNo}_${siraNo}`;
  const ref = doc(db, APP_COL, `${COC_CERTIFICATES_DOC}_${year}`);
  await setDoc(ref, {
    certificates: {
      [id]: {
        ...cert,
        siraNo,
        source: cert.source || "ui",
        createdAt: cert.createdAt || new Date().toISOString(),
      },
    },
    year,
  }, { merge: true });
  return { id, year };
}

// Sertifika no auto-suggest helper — verilen yıl+ay için mevcut sertifikalardan
// en yüksek sıra no'yu bul ve +1 öner. Format: YYYYAA-NNN (NNN 3 digit padding).
export function suggestNextCertNo(certificatesMap, year, month) {
  const prefix = `${year}${String(month).padStart(2, '0')}`;
  let maxSeq = 0;
  for (const c of Object.values(certificatesMap || {})) {
    if (!c?.certNo) continue;
    // Yeni format: YYYYAA-NNN
    const mNew = c.certNo.match(/^(\d{4})(\d{2})-(\d{3,})$/);
    if (mNew && mNew[1] === year && mNew[2] === String(month).padStart(2, '0')) {
      maxSeq = Math.max(maxSeq, parseInt(mNew[3], 10) || 0);
      continue;
    }
    // Eski format: YYYYAA/NNN (geriye dönük)
    const mOld = c.certNo.match(/^(\d{4})(\d{2})\/(\d{3,})$/);
    if (mOld && mOld[1] === year && mOld[2] === String(month).padStart(2, '0')) {
      maxSeq = Math.max(maxSeq, parseInt(mOld[3], 10) || 0);
    }
  }
  return `${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;
}

// Cloud Function çalıştırma log'u — son salesOrders güncelleme zamanını gösteren rozet için.
// Doc: appData/automationLog = { entries: [{ runAt, source, success, results: [...] }] }
export function subscribeAutomationLog(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, AUTOMATION_LOG_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => { console.error("automationLog listener:", err); callback(null); }
  );
}

// Geçici — mail formatı parser bug'ından kaynaklı sahte vio-removed event'leri temizlemek için
// 27 Nisan 2026 hotfix. Yeni mail otomasyonu doğru parser ile çalıştıktan sonra tekrar dolar.
export async function resetShipments({ canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Sıfırlama sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, SHIPMENTS_DOC);
  await deleteDoc(ref);
}

// Tek override yazar — planOverrides doc'undaki diğer override'lar korunur (setDoc merge).
// Doc yoksa yaratır.
export async function savePlanOverride(orderId, data, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — override sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, PLAN_OVERRIDES_DOC);
  await setDoc(ref, { [orderId]: data }, { merge: true });
}

// Çoklu override yazımı — atomik (tek setDoc, merge:true). Otomatik sıralama,
// otomatik plan ve toplu temizleme için. Yarım yazım riski yok.
// Value `null` ise o orderId silinir (FieldValue.delete()) — yazma + silme aynı batch'te.
export async function savePlanOverrides(updatesMap, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — override sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!updatesMap || Object.keys(updatesMap).length === 0) return;
  const ref = doc(db, APP_COL, PLAN_OVERRIDES_DOC);
  const finalMap = {};
  for (const [k, v] of Object.entries(updatesMap)) {
    finalMap[k] = (v === null) ? deleteField() : v;
  }
  await setDoc(ref, finalMap, { merge: true });
}

// Tek override siler — diğer override'lar korunur. Doc yoksa sessizce geçer.
export async function removePlanOverride(orderId, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — override sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, PLAN_OVERRIDES_DOC);
  try {
    await updateDoc(ref, { [orderId]: deleteField() });
  } catch (e) {
    if (e?.code === "not-found") return;
    throw e;
  }
}
