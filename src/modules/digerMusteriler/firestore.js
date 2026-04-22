import { doc, onSnapshot, setDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const SALES_ORDERS_DOC = "salesOrders";
const PLAN_OVERRIDES_DOC = "planOverrides";
const BOM_MODELS_DOC = "bomModels";

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

// Tek override yazar — planOverrides doc'undaki diğer override'lar korunur (setDoc merge).
// Doc yoksa yaratır.
export async function savePlanOverride(orderId, data, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — override sadece admin/üretim rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, PLAN_OVERRIDES_DOC);
  await setDoc(ref, { [orderId]: data }, { merge: true });
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
