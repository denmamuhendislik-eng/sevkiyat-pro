import { doc, onSnapshot, setDoc, updateDoc, deleteField, deleteDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject, getBlob } from "firebase/storage";
import { db, storage } from "../../firebase";

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
  // cocParts master'a iskelet ekleme — paralel, hata salesOrders'ı bozmaz
  try {
    await upsertCocPartsSkeletonsFromOrders(ordersMap);
  } catch (err) {
    console.error("[cocParts skeleton] Hata:", err);
  }
}

// salesOrders'tan unique stokKodu'ları çıkarıp cocParts master'a iskelet ekler.
// Idempotent — mevcut parçaları korur, sadece yeni stokKodu için iskelet yazar.
// Tüm müşteriler için çalışır (A+R sınırı yok).
async function upsertCocPartsSkeletonsFromOrders(ordersMap) {
  if (!ordersMap || Object.keys(ordersMap).length === 0) return { added: 0 };
  if (!db) return { added: 0 };
  const ref = doc(db, APP_COL, COC_PARTS_DOC);
  // Mevcut master'ı oku (tek seferlik, listener kullanmıyoruz)
  const { getDoc } = await import("firebase/firestore");
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() || {}) : { parts: {} };
  const existingParts = existing.parts || {};

  const newSkeletons = {};
  for (const o of Object.values(ordersMap)) {
    if (!o?.stokKodu) continue;
    const key = String(o.stokKodu).trim();
    if (!key) continue;
    if (existingParts[key]) continue;
    if (newSkeletons[key]) continue;
    newSkeletons[key] = {
      stokKodu: key,
      description: String(o.stokAdi || "").trim(),
      faiNo: null,
      revisions: [],
      customerCode: o.customerCode || "",
      isSkeleton: true,
      createdAt: new Date().toISOString(),
      source: "auto-from-salesOrders",
    };
  }

  const added = Object.keys(newSkeletons).length;
  if (added === 0) return { added: 0 };
  await setDoc(ref, {
    parts: { ...existingParts, ...newSkeletons },
    totalCount: Object.keys(existingParts).length + added,
    lastSkeletonImportAt: new Date().toISOString(),
  }, { merge: true });
  return { added };
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

// COC sertifikasını günceller (düzenleme). Mevcut kaydı overwrite eder, updatedAt damgalar.
// Sertifika no değişimi desteklenmez (yıl/ID değişir, ayrı doc'a taşıma gerekir).
export async function updateCocCertificate(cert, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
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
        updatedAt: new Date().toISOString(),
      },
    },
    year,
  }, { merge: true });
  return { id, year };
}

// COC parça master upsert — yeni parça ekler veya mevcut revizyonları günceller.
// stokKodu top-level key olarak appData/cocParts.parts içine yazılır.
export async function saveCocPart(part, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!part.stokKodu) throw new Error("stokKodu zorunlu");
  if (!part.customerCode) throw new Error("customerCode zorunlu");
  const ref = doc(db, APP_COL, COC_PARTS_DOC);
  await setDoc(ref, {
    parts: {
      [part.stokKodu]: {
        stokKodu: part.stokKodu,
        description: part.description || '',
        faiNo: part.faiNo || null,
        revisions: Array.isArray(part.revisions) ? part.revisions : [],
        customerCode: part.customerCode,
        updatedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
  return { stokKodu: part.stokKodu };
}

// COC parça master kaydını siler.
export async function deleteCocPart(stokKodu, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!stokKodu) throw new Error("stokKodu zorunlu");
  const ref = doc(db, APP_COL, COC_PARTS_DOC);
  await updateDoc(ref, { [`parts.${stokKodu}`]: deleteField() });
  return { stokKodu };
}

// COC sertifikasını siler (year-bazlı doc'tan FieldValue.delete ile kaldır).
export async function deleteCocCertificate(certNo, siraNo, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok — silme sadece admin/üretim/satış rolüne açık");
  if (!db) throw new Error("Firestore bağlantısı hazır değil");
  if (!certNo) throw new Error("certNo zorunlu");
  const year = certNo.substring(0, 4);
  if (!/^\d{4}$/.test(year)) throw new Error(`Geçersiz sertifika no formatı: ${certNo}`);
  const sira = String(siraNo || "1").trim() || "1";
  const id = `${certNo}_${sira}`;
  const ref = doc(db, APP_COL, `${COC_CERTIFICATES_DOC}_${year}`);
  await updateDoc(ref, { [`certificates.${id}`]: deleteField() });
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

// ====================================================================
// COC ATTACHMENT (Doküman) YÖNETİMİ — Firebase Storage + Firestore meta
// ====================================================================
//
// Storage path yapısı:
//   appData/cocCertificates/{year}/{certNo}/{category}_{timestamp}_{filename}
//   appData/cocParts/{stokKodu}/standardAttachments/{category}/{revision?}_{timestamp}_{filename}
//
// Kategori listesi (UI'da görünen):
//   Sabit: rawMaterialCert, measurement, bubbleDrawing, waiver, fai, surfaceTreatment
//   Serbest: others[] (kullanıcı isim verir)
//
// Tekrar kullanım stratejisi:
//   - rawMaterialCert: stok bazlı (revision ile karıştırılmaz) — master'da tek snapshot
//   - bubbleDrawing: stok + revision bazlı (revision değişirse farklı dosya)
//   - Diğerleri: COC kaydına özel, master'da tutulmaz

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
// Tüm sabit kategoriler için master tekrar kullanım aktif (kullanıcı kararı 2026-06-26).
// Yeni dosya yüklendiğinde master da güncellenir → her zaman son sürüm master'da.
// reuseScope: "stok" = revize bağımsız, "stok+revizyon" = revizyon bazlı ayrı dosya.
export const COC_ATTACHMENT_CATEGORIES = [
  { key: "rawMaterialCert", label: "Hammadde Kalite Sertifikası", icon: "🧪", reuseScope: "stok" },
  { key: "measurement",     label: "Ölçüm Raporu",                icon: "📏", reuseScope: "stok+revizyon" },
  { key: "bubbleDrawing",   label: "Balonlu Resim",               icon: "🎈", reuseScope: "stok+revizyon" },
  { key: "fai",             label: "FAİ Raporu",                  icon: "📋", reuseScope: "stok" },
  { key: "surfaceTreatment",label: "Isıl İşlem / Kaplama / Boya", icon: "🔥", reuseScope: "stok" },
  { key: "waiver",          label: "Feragat",                     icon: "⚠️", reuseScope: "stok+revizyon" },
];

const safeFilename = (s) => String(s || "").replace(/[^\w.\-]/g, "_").substring(0, 120);

// COC sertifikası için doküman yükle. Cert kaydındaki attachments.{category} field'ı güncellenir.
export async function uploadCocAttachment(certNo, year, category, file, opts = {}) {
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!certNo || !year || !category || !file) throw new Error("certNo, year, category ve file zorunlu");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Dosya çok büyük (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
  }
  const timestamp = Date.now();
  const filename = safeFilename(file.name);
  const path = `appData/cocCertificates/${year}/${certNo}/${category}_${timestamp}_${filename}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(ref);
  return {
    storagePath: path,
    downloadUrl: url,
    filename: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
    sourceType: "upload",
  };
}

// Doküman silme — Storage + (varsa) Firestore field'ı.
export async function deleteCocAttachment(storagePath, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!storagePath) return;
  try {
    await deleteObject(storageRef(storage, storagePath));
  } catch (e) {
    // Storage'da yoksa sessizce geç
    if (e?.code !== "storage/object-not-found") throw e;
  }
}

// Storage'dan dosyayı Blob olarak indir — ZIP üretimi için (fetch CORS sorununu aşar).
export async function downloadCocAttachmentBlob(storagePath) {
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!storagePath) throw new Error("storagePath gerekli");
  return await getBlob(storageRef(storage, storagePath));
}

// Sertifika kategorisine yeni dosya EKLE — array yapısı (birden fazla dosya/kategori).
// Geriye dönük uyumluluk: mevcut field obje (tekli) ise array'e çevrilir, sonra eklenir.
export async function appendCocCertificateAttachment(certNo, siraNo, category, attachmentMeta, currentList, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  const year = certNo.substring(0, 4);
  const id = `${certNo}_${String(siraNo || "1").trim() || "1"}`;
  const ref = doc(db, APP_COL, `${COC_CERTIFICATES_DOC}_${year}`);
  // currentList: mevcut attachments[category] — obje veya array veya yok
  let list = [];
  if (Array.isArray(currentList)) list = [...currentList];
  else if (currentList && typeof currentList === "object") list = [currentList];
  list.push(attachmentMeta);
  await setDoc(ref, {
    certificates: {
      [id]: {
        attachments: { [category]: list },
      },
    },
  }, { merge: true });
}

// Sertifika kategorisinin tüm dosya listesini overwrite (silme sonrası).
export async function setCocCertificateAttachmentList(certNo, siraNo, category, list, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  const year = certNo.substring(0, 4);
  const id = `${certNo}_${String(siraNo || "1").trim() || "1"}`;
  const ref = doc(db, APP_COL, `${COC_CERTIFICATES_DOC}_${year}`);
  await setDoc(ref, {
    certificates: {
      [id]: {
        attachments: { [category]: Array.isArray(list) ? list : [] },
      },
    },
  }, { merge: true });
}

// "others" listesine ekleme/silme (free-form kategori).
export async function setCocCertificateOthers(certNo, siraNo, othersList, { canEdit }) {
  if (!canEdit) throw new Error("Yetki yok");
  const year = certNo.substring(0, 4);
  const id = `${certNo}_${String(siraNo || "1").trim() || "1"}`;
  const ref = doc(db, APP_COL, `${COC_CERTIFICATES_DOC}_${year}`);
  await setDoc(ref, {
    certificates: {
      [id]: {
        attachments: { others: othersList },
      },
    },
  }, { merge: true });
}

// Parça master'a "standart" doküman yükle — yeni COC oluştururken tekrar kullanım için.
// rawMaterialCert: stok bazlı tek snapshot (revizyon önemsiz)
// bubbleDrawing: stok + revizyon bazlı (her revizyon ayrı dosya)
export async function uploadCocPartStandardAttachment(stokKodu, category, file, opts = {}) {
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!stokKodu || !category || !file) throw new Error("stokKodu, category ve file zorunlu");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Dosya çok büyük (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
  }
  const timestamp = Date.now();
  const filename = safeFilename(file.name);
  const safeStok = safeFilename(stokKodu);
  let path;
  if (category === "bubbleDrawing" && opts.revision) {
    const safeRev = safeFilename(opts.revision);
    path = `appData/cocParts/${safeStok}/${category}/${safeRev}/${timestamp}_${filename}`;
  } else {
    path = `appData/cocParts/${safeStok}/${category}/${timestamp}_${filename}`;
  }
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(ref);
  return {
    storagePath: path,
    downloadUrl: url,
    filename: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  };
}

// Parça master'a standart attachment listesi ekle/overwrite.
// Stok+revizyon scope'da: byRevision[rev] = array
// Stok scope'da: [category] = array
export async function setCocPartStandardAttachmentList(stokKodu, category, list, { canEdit, revision, scope }) {
  if (!canEdit) throw new Error("Yetki yok");
  const ref = doc(db, APP_COL, COC_PARTS_DOC);
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  if (scope === "stok+revizyon" && revision) {
    await setDoc(ref, {
      parts: {
        [stokKodu]: {
          standardAttachments: {
            [category]: { byRevision: { [revision]: arr } },
          },
        },
      },
    }, { merge: true });
  } else {
    await setDoc(ref, {
      parts: {
        [stokKodu]: {
          standardAttachments: { [category]: arr },
        },
      },
    }, { merge: true });
  }
}

// Parça master'dan tekrar kullanım listesi (array).
// Geriye dönük: tek obje varsa array'e dönüştür.
export function getReusableAttachmentList(cocParts, stokKodu, category, revision, scope) {
  const part = cocParts?.parts?.[stokKodu];
  if (!part?.standardAttachments) return [];
  let raw;
  if (scope === "stok+revizyon" && revision) {
    raw = part.standardAttachments?.[category]?.byRevision?.[revision];
  } else {
    raw = part.standardAttachments?.[category];
  }
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return [raw];
  return [];
}

// COC kategorisinin mevcut dosya listesini al (array veya obje → array).
export function getCocAttachmentList(cert, category) {
  const raw = cert?.attachments?.[category];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return [raw];
  return [];
}
