// FAI (First Article Inspection) — Firestore katmanı.
//
// Doküman: appData/faiRecords_{YYYY}
//   { year: "2026", records: { [faiNo]: {...} } }
//
// faiNo formatı: YYAAGG-XX (örn. 260720-01) — yapılabilirlik ile aynı desen

import {
  doc, onSnapshot, setDoc, getDoc, updateDoc, deleteField,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../../../firebase";
import { FAI_STATUSES } from "./schema";

const APP_COL = "appData";
const YEAR_DOC_PREFIX = "faiRecords_";

// ============================================================
// Subscribe / Read
// ============================================================

export function subscribeFaiForYear(year, callback, { staging = false } = {}) {
  if (!db || !year) return () => {};
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : { records: {} }),
    (err) => { console.error("fai listener:", err); callback({ records: {} }); }
  );
}

// ============================================================
// FAI No üret — YYAAGG-XX
// ============================================================

async function getFaiNosForDate(yy, ay, gg, { staging = false } = {}) {
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const snap = await getDoc(doc(db, APP_COL, name));
  if (!snap.exists()) return [];
  const records = snap.data()?.records || {};
  const prefix = `${yy}${ay}${gg}-`;
  return Object.values(records)
    .map(r => String(r.faiNo || ""))
    .filter(n => n.startsWith(prefix));
}

export async function suggestNextFaiNo(date = new Date(), { staging = false } = {}) {
  const yy = String(date.getFullYear()).slice(2);
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const gg = String(date.getDate()).padStart(2, "0");
  const existing = await getFaiNosForDate(yy, ay, gg, { staging });
  const seqs = existing.map(n => {
    const parts = n.split("-");
    return Number(parts[1]);
  }).filter(x => Number.isFinite(x));
  const nextSeq = (seqs.length > 0 ? Math.max(...seqs) : 0) + 1;
  return `${yy}${ay}${gg}-${String(nextSeq).padStart(2, "0")}`;
}

// ============================================================
// Kaydet — yeni veya update
// ============================================================

export async function saveFaiRecord(record, { canEdit, staging = false, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!record?.faiNo) throw new Error("faiNo zorunlu");
  if (!record.partNumber && !record.partName) throw new Error("Parça No veya Adı zorunlu");
  const yy = record.faiNo.slice(0, 2);
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  const patch = {
    ...record,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  };
  if (!record.createdAt) patch.createdAt = patch.updatedAt;
  if (!record.createdBy) patch.createdBy = userEmail || "";
  await setDoc(ref, {
    year,
    records: {
      [record.faiNo]: patch,
    },
  }, { merge: true });
  return { faiNo: record.faiNo, year };
}

// ============================================================
// Statü güncelleme + history
// ============================================================

export async function updateFaiStatus(faiNo, newStatus, { canEdit, staging = false, userEmail = "", note = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!faiNo) throw new Error("faiNo zorunlu");
  const validStatuses = FAI_STATUSES.map(s => s.key);
  if (!validStatuses.includes(newStatus)) throw new Error(`Geçersiz statü: ${newStatus}`);

  const yy = faiNo.slice(0, 2);
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data()?.records?.[faiNo] : null;
  const currentStatus = current?.status || "draft";
  const history = Array.isArray(current?.statusHistory) ? current.statusHistory.slice() : [];
  history.push({
    from: currentStatus,
    to: newStatus,
    at: new Date().toISOString(),
    by: userEmail || "",
    note: note || "",
  });
  await setDoc(ref, {
    records: {
      [faiNo]: {
        status: newStatus,
        statusHistory: history.slice(-20),
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
  return { faiNo, from: currentStatus, to: newStatus };
}

// ============================================================
// İmza — roleKey: preparedBy | reviewedBy | customerApprovedBy
// ============================================================

export async function signFaiRole(faiNo, roleKey, { canEdit, staging = false, userEmail = "", roleLabel = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!faiNo || !roleKey) throw new Error("faiNo ve roleKey zorunlu");
  const yy = faiNo.slice(0, 2);
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  const now = new Date().toISOString();
  await setDoc(ref, {
    records: {
      [faiNo]: {
        signatures: {
          [roleKey]: {
            signedAt: now,
            signedBy: userEmail || "",
            signedRoleLabel: roleLabel || "",
          },
        },
        updatedAt: now,
      },
    },
  }, { merge: true });
  return { faiNo, roleKey, signedAt: now };
}

export async function unsignFaiRole(faiNo, roleKey, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const yy = faiNo.slice(0, 2);
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await updateDoc(ref, {
    [`records.${faiNo}.signatures.${roleKey}`]: deleteField(),
    [`records.${faiNo}.updatedAt`]: new Date().toISOString(),
  });
  return { faiNo, roleKey };
}

// ============================================================
// Silme
// ============================================================

export async function deleteFaiRecord(faiNo, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!faiNo) throw new Error("faiNo zorunlu");
  const yy = faiNo.slice(0, 2);
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await setDoc(ref, {
    records: { [faiNo]: deleteField() },
  }, { merge: true });
  return { faiNo };
}

// ============================================================
// Belge yükleme (Storage) — COC ile aynı desen
// ============================================================

export async function uploadFaiAttachment(faiNo, category, file, { canEdit } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!faiNo || !category || !file) throw new Error("faiNo, category, file zorunlu");
  const yy = faiNo.slice(0, 2);
  const year = "20" + yy;
  const safeName = String(file.name).replace(/[^\w.\-]/g, "_");
  const safeCat = String(category).replace(/[^\w.\-]/g, "_");
  const path = `fai/${year}/${faiNo}/${safeCat}_${Date.now()}_${safeName}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return {
    url, path,
    name: file.name,
    size: file.size,
    category,
    uploadedAt: new Date().toISOString(),
  };
}

export async function deleteFaiAttachment(storagePath) {
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!storagePath) throw new Error("storagePath zorunlu");
  try {
    await deleteObject(storageRef(storage, storagePath));
  } catch (e) {
    if (e?.code !== "storage/object-not-found") throw e;
  }
}

// ============================================================
// Helper — durum hesabı
// ============================================================

// ============================================================
// FAI Arşiv (F-9B) — Drive'dan toplu import edilen eski FAI kayıtları
// ============================================================
// Ayrı bir doc'ta tutulur: appData/faiRecords_archive
// faiNo herhangi bir format olabilir (Drive klasör adından geldi)
// { records: { [archiveKey]: {...} } }
// archiveKey = safeString(stokKodu + "_" + faiNo) — çakışma önleyici

const ARCHIVE_DOC = "faiRecords_archive";

export function subscribeFaiArchive(callback, { staging = false } = {}) {
  if (!db) return () => {};
  const name = ARCHIVE_DOC + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : { records: {} }),
    (err) => { console.error("faiArchive listener:", err); callback({ records: {} }); }
  );
}

// Toplu arşiv kayıt yazma — aynı stok+FAI için mevcut varsa merge (attachments birleşir)
export async function saveFaiArchiveRecords(records, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!Array.isArray(records) || records.length === 0) return { count: 0 };
  const name = ARCHIVE_DOC + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  const now = new Date().toISOString();
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data()?.records || {}) : {};
  const patchRecords = {};
  for (const r of records) {
    const key = archiveKey(r.stockCode || r.partNumber, r.faiNo);
    if (!key) continue;
    const prev = existing[key] || {};
    // Attachments birleşir (multi cat'lerde list, single'da son yazan)
    const prevAtt = prev.attachments || {};
    const newAtt = r.attachments || {};
    const merged = { ...prevAtt };
    for (const [k, v] of Object.entries(newAtt)) {
      if (Array.isArray(v)) {
        const p = Array.isArray(merged[k]) ? merged[k] : [];
        merged[k] = [...p, ...v];
      } else if (v) {
        merged[k] = v;
      }
    }
    patchRecords[key] = {
      ...prev,
      ...r,
      attachments: merged,
      archiveKey: key,
      importedAt: prev.importedAt || now,
      updatedAt: now,
    };
  }
  await setDoc(ref, { records: patchRecords }, { merge: true });
  return { count: Object.keys(patchRecords).length };
}

// archiveKey oluştur: stokKodu ve faiNo birleşik güvenli string
export function archiveKey(stokKodu, faiNo) {
  if (!stokKodu && !faiNo) return "";
  const safe = (s) => String(s || "").replace(/[^\w.-]/g, "_").substring(0, 60);
  return `${safe(stokKodu)}__${safe(faiNo)}`;
}

// Drive klasör adından parse: "{stokKodu} (FAİ-XXX)" veya "{stokKodu}-(FAİ-XXX)"
export function parseFaiArchiveFolderName(folderName) {
  if (!folderName) return null;
  // Türkçe İ karakteri hem "İ" hem "I" olabilir; regex ikisini de kabul et
  const re = /^(.+?)[\s\-]*\((?:FA[İI])-?(\d+)\)\s*$/i;
  const m = folderName.trim().match(re);
  if (!m) return null;
  const stokKodu = m[1].replace(/[-\s]+$/, "").trim(); // sondaki tire/boşluk temizle
  const faiNo = m[2].trim();
  return { stokKodu, faiNo };
}

// Silme (admin)
export async function deleteFaiArchiveRecord(archiveKeyStr, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const name = ARCHIVE_DOC + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await setDoc(ref, { records: { [archiveKeyStr]: deleteField() } }, { merge: true });
  return { archiveKey: archiveKeyStr };
}

export function computeFaiStatus(record) {
  return record?.status || "draft";
}

export function countFaiSignatures(record) {
  const sigs = record?.signatures || {};
  let signed = 0;
  if (sigs.preparedBy?.signedAt) signed++;
  if (sigs.reviewedBy?.signedAt) signed++;
  if (sigs.customerApprovedBy?.signedAt) signed++;
  return { signed, total: 3 };
}
