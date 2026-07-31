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

// ============================================================
// Form 2 Malzeme/Süreç Master — appData/faiForm2Master
// ============================================================
// Yapı: { items: { [id]: {...} }, updatedAt, updatedBy }
// id: crypto.randomUUID() ile üretilir.

const FORM2_MASTER_DOC = "faiForm2Master";

export function subscribeFaiForm2Master(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, FORM2_MASTER_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || { items: {} }) : { items: {} }),
    (err) => { console.error("form2Master listener:", err); callback({ items: {} }); }
  );
}

function makeMasterId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Tek item kaydet — id yoksa üret. name+code zorunlu.
export async function saveFaiForm2MasterItem(item, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!item?.name || !item?.code) throw new Error("Ad ve Kod zorunlu");
  const ref = doc(db, APP_COL, FORM2_MASTER_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.items || {}) : {};
  const id = item.id || makeMasterId();
  const now = new Date().toISOString();
  const existing = current[id] || {};
  const next = {
    ...existing,
    name: String(item.name || "").trim(),
    code: String(item.code || "").trim(),
    specNumber: String(item.specNumber || "").trim(),
    supplier: String(item.supplier || "").trim(),
    customerApproval: item.customerApproval || "",
    category: item.category || existing.category || "process",
    createdAt: existing.createdAt || now,
    updatedAt: now,
    updatedBy: userEmail || "",
  };
  await setDoc(ref, { items: { ...current, [id]: next }, updatedAt: now, updatedBy: userEmail || "" }, { merge: true });
  return { id, ...next };
}

export async function deleteFaiForm2MasterItem(id, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!id) throw new Error("id zorunlu");
  const ref = doc(db, APP_COL, FORM2_MASTER_DOC);
  await updateDoc(ref, {
    [`items.${id}`]: deleteField(),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  });
}

// Toplu import — items dizisindeki her satır için {id?, name, code, ...}
// mode: 'skip' (aynı name+code varsa atla) | 'overwrite' (varsa üstüne yaz)
// Dönüş: { added, skipped, overwritten, errors: [{row, reason}] }
export async function bulkImportFaiForm2Master(items, { canEdit, mode = "skip", userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Boş liste");
  const ref = doc(db, APP_COL, FORM2_MASTER_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.items || {}) : {};
  // Mevcut (name+code) → id map, duplicate kontrolü için.
  const keyToId = {};
  for (const [id, it] of Object.entries(current)) {
    const k = `${(it.name || "").trim().toLocaleLowerCase("tr-TR")}|${(it.code || "").trim().toLocaleLowerCase("tr-TR")}`;
    keyToId[k] = id;
  }
  const now = new Date().toISOString();
  const next = { ...current };
  const result = { added: 0, skipped: 0, overwritten: 0, errors: [] };
  items.forEach((raw, i) => {
    const name = String(raw.name || "").trim();
    const code = String(raw.code || "").trim();
    if (!name || !code) {
      result.errors.push({ row: i + 1, reason: "Ad veya Kod boş" });
      return;
    }
    const k = `${name.toLocaleLowerCase("tr-TR")}|${code.toLocaleLowerCase("tr-TR")}`;
    const existId = keyToId[k];
    if (existId && mode === "skip") { result.skipped++; return; }
    const id = existId || makeMasterId();
    const existing = existId ? current[existId] : {};
    next[id] = {
      name, code,
      specNumber: String(raw.specNumber || "").trim(),
      supplier: String(raw.supplier || "").trim(),
      customerApproval: raw.customerApproval || "",
      category: raw.category || existing.category || "process",
      createdAt: existing.createdAt || now,
      updatedAt: now,
      updatedBy: userEmail || "",
    };
    if (existId) result.overwritten++;
    else result.added++;
  });
  await setDoc(ref, { items: next, updatedAt: now, updatedBy: userEmail || "" }, { merge: true });
  return result;
}

// ============================================================
// Tedarikçi Master — appData/faiSupplierMaster
// ============================================================
// Yapı: { items: { [id]: {name, notes, ...} } }

const SUPPLIER_MASTER_DOC = "faiSupplierMaster";

export function subscribeFaiSupplierMaster(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, SUPPLIER_MASTER_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || { items: {} }) : { items: {} }),
    (err) => { console.error("supplierMaster listener:", err); callback({ items: {} }); }
  );
}

export async function saveFaiSupplierMasterItem(item, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!item?.name || !String(item.name).trim()) throw new Error("Ad zorunlu");
  const ref = doc(db, APP_COL, SUPPLIER_MASTER_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.items || {}) : {};
  const id = item.id || makeMasterId();
  const now = new Date().toISOString();
  const existing = current[id] || {};
  const next = {
    ...existing,
    name: String(item.name || "").trim(),
    notes: String(item.notes || "").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    updatedBy: userEmail || "",
  };
  await setDoc(ref, { items: { ...current, [id]: next }, updatedAt: now, updatedBy: userEmail || "" }, { merge: true });
  return { id, ...next };
}

export async function deleteFaiSupplierMasterItem(id, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!id) throw new Error("id zorunlu");
  const ref = doc(db, APP_COL, SUPPLIER_MASTER_DOC);
  await updateDoc(ref, {
    [`items.${id}`]: deleteField(),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  });
}
