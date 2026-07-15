import { doc, onSnapshot, setDoc, getDoc, updateDoc } from "firebase/firestore";
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

// ============================================================
// MÜŞTERİ MASTER
// ============================================================

export function subscribeQuoteCustomers(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = "quoteCustomers" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : { customers: {} }));
}

// Yeni müşteri ekle veya mevcut düzenle. customerKey = müşteri adı (unique).
export async function saveQuoteCustomer(customerKey, customerData, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!customerKey || !customerKey.trim()) throw new Error("Müşteri adı zorunlu");
  const name = "quoteCustomers" + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await setDoc(ref, {
    customers: {
      [customerKey.trim()]: {
        ...customerData,
        name: customerKey.trim(),
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
}

// ============================================================
// YENİ TEKLİF — Firestore'a kayıt
// ============================================================

// Belirli yıldaki teklif no'larını topla (auto-suggest için)
export async function getQuoteNosForDate(yy, ay, gg) {
  const year = "20" + yy;
  const name = `quotes_${year}`;
  const snap = await getDoc(doc(db, APP_COL, name));
  if (!snap.exists()) return [];
  const quotes = snap.data()?.quotes || {};
  const prefix = `${yy}${ay}${gg}`;
  return Object.values(quotes)
    .map(q => String(q.quoteNo || ""))
    .filter(n => n.startsWith(prefix));
}

// Yeni teklif no üret — YYAAGGXX (sıra otomatik)
export async function suggestNextQuoteNo(date = new Date()) {
  const yy = String(date.getFullYear()).slice(2);
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const gg = String(date.getDate()).padStart(2, "0");
  const existing = await getQuoteNosForDate(yy, ay, gg);
  const seqs = existing.map(n => Number(n.slice(6, 8))).filter(x => Number.isFinite(x));
  const nextSeq = (seqs.length > 0 ? Math.max(...seqs) : 0) + 1;
  return `${yy}${ay}${gg}${String(nextSeq).padStart(2, "0")}`;
}

// Yeni teklif kaydet. quoteNo'dan yılı çıkarır, quotes_YYYY doc'una yazar.
// groupKey formatı: teklifNo + "__" + normalize(müşteri) — aynı no farklı müşteride ayrı kayıt
export async function saveNewQuote(quote, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!quote.quoteNo) throw new Error("quoteNo zorunlu");
  if (!quote.customerName) throw new Error("customerName zorunlu");
  const year = "20" + String(quote.quoteNo).slice(0, 2);
  const suffix = staging ? "_staging" : "";
  const docName = `quotes_${year}${suffix}`;
  const customerKey = String(quote.customerName).replace(/\s+/g, "_").substring(0, 40);
  const groupKey = `${quote.quoteNo}__${customerKey}`;
  const ref = doc(db, APP_COL, docName);
  await setDoc(ref, {
    year,
    quotes: {
      [groupKey]: {
        ...quote,
        createdAt: quote.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
  return { docName, groupKey };
}

// Parça kütüphanesine yeni parça ekle veya güncelle
export async function saveQuotePart(stokKodu, partData, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!stokKodu) throw new Error("stokKodu zorunlu");
  const suffix = staging ? "_staging" : "";
  // Bucket hesabı (aynı algoritma backend ile)
  let hash = 0;
  for (let i = 0; i < stokKodu.length; i++) hash = ((hash << 5) - hash + stokKodu.charCodeAt(i)) | 0;
  const bid = String(Math.abs(hash) % 10);
  const ref = doc(db, APP_COL, `quoteParts_${bid}${suffix}`);
  await setDoc(ref, {
    parts: {
      [stokKodu]: {
        ...partData,
        stokKodu,
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
}
