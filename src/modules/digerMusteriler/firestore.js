import { doc, onSnapshot, setDoc, updateDoc, deleteField, deleteDoc } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const SALES_ORDERS_DOC = "salesOrders";
const PLAN_OVERRIDES_DOC = "planOverrides";
const BOM_MODELS_DOC = "bomModels";
const SHIPMENTS_DOC = "shipments";
const AUTOMATION_LOG_DOC = "automationLog";

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

// Çoklu override yazımı — atomik (tek setDoc, merge:true). Otomatik sıralama gibi
// birden fazla override'ı tek seferde yazmak için. Yarım yazım riski yok.
export async function savePlanOverrides(updatesMap, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — override sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!updatesMap || Object.keys(updatesMap).length === 0) return;
  const ref = doc(db, APP_COL, PLAN_OVERRIDES_DOC);
  await setDoc(ref, updatesMap, { merge: true });
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
