import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";

export function subscribeQuoteMaterials(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = "quoteMaterials" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : null));
}

export function subscribeQuoteFasonWorks(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = "quoteFasonWorks" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : null));
}

export function subscribeQuoteOptions(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = "quoteOptions" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : null));
}

export function subscribeQuotePolicy(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = "quotePolicy" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : null));
}

export function subscribeQuotesForYear(year, callback, { staging = false } = {}) {
  if (!db || !year) return () => {};
  const name = `quotes_${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : { quotes: {} }));
}

export function subscribeQuoteParts(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = "quoteParts" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : { parts: {} }));
}

// Admin: marj politikasını update et (miktar aralığı, vade, malzeme türü marjları)
export async function saveQuotePolicyUpdate(newPolicyData, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok — sadece admin");
  const name = "quotePolicy" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await setDoc(ref, {
    ...newPolicyData,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}
