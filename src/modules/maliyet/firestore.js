import { doc, onSnapshot, setDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const LABOR_DOC = "laborCosts";

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

// Bir ayın verisini siler — diğer aylar korunur.
export async function deleteMonthlyOverhead(yearMonth, { canEdit, isAdmin }) {
  if (!isAdmin) throw new Error("Silme sadece admin rolüne açık");
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  const ref = doc(db, APP_COL, LABOR_DOC);
  await updateDoc(ref, { [`monthlyOverheads.${yearMonth}`]: deleteField() });
}
