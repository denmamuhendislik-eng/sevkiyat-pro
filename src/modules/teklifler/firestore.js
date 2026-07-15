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

/**
 * 10 bucket'a bölünmüş parça kütüphanesine subscribe et.
 * Her bucket ayrı Firestore doc → 10 paralel listener, birleşik { parts: {...} } döner.
 * Firestore 1MB doc limitini aşmamak için partition yapısı.
 */
export function subscribeQuoteParts(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const suffix = staging ? "_staging" : "";
  const bucketData = {}; // { "0": {parts: {}}, ... }
  let loadedCount = 0;

  const merge = () => {
    const merged = {};
    let summary = { partCount: 0, totalUsages: 0 };
    for (const bucket of Object.values(bucketData)) {
      Object.assign(merged, bucket.parts || {});
    }
    summary.partCount = Object.keys(merged).length;
    for (const p of Object.values(merged)) summary.totalUsages += (p.kullanimSayisi || 0);
    callback({ parts: merged, summary, loaded: loadedCount >= 10 });
  };

  const unsubs = [];
  for (let i = 0; i < 10; i++) {
    const ref = doc(db, APP_COL, `quoteParts_${i}${suffix}`);
    unsubs.push(onSnapshot(ref, (snap) => {
      bucketData[i] = snap.exists() ? snap.data() : { parts: {} };
      loadedCount = Object.keys(bucketData).length;
      merge();
    }));
  }
  return () => unsubs.forEach(fn => fn && fn());
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
