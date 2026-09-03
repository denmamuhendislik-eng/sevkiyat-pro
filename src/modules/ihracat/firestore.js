// İhracat Modülü — Firestore katmanı.
//
// Koleksiyonlar (tamamı yeni; hiçbir mevcut doküman değiştirilmez):
//   appData/exportSalesOrders    → ihracat siparişleri (3-tuple ID)
//   appData/containerAllocations → konteyner kalemi ↔ sipariş tahsisleri
//   appData/exportSettings       → müşteri default'ları, ödeme etiket havuzu, kod haritası
//
// Kırmızı çizgiler:
//   - Motor'a bağlanmaz. Sadece sipariş kaydı + tahsis.
//   - Mevcut salesOrders/state/yearsData/planOverrides'a dokunulmaz.
//   - Bakiye türetilir, saklanmaz: kalan = orijinalMiktar - sevkedilenBaslangic - tahsisEdilen

import {
  doc, onSnapshot, setDoc, updateDoc, deleteField, getDoc, runTransaction,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../../firebase";

const APP_COL = "appData";
const EXPORT_ORDERS_DOC = "exportSalesOrders";
const ALLOCATIONS_DOC = "containerAllocations";
const EXPORT_SETTINGS_DOC = "exportSettings";
const INVOICE_SETTINGS_DOC = "invoiceSettings";
const EXPORT_INVOICES_DOC = "exportInvoices";
const EXPORT_SHIPMENTS_DOC = "exportShipments"; // v23 — motor dışı sevkiyat kayıtları

// ============================================================
// exportSalesOrders — { orders: { [3tupleId]: {...} }, updatedAt }
// ============================================================

export function subscribeExportSalesOrders(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || { orders: {} }) : { orders: {} }),
    (err) => { console.error("exportSalesOrders listener:", err); callback({ orders: {} }); }
  );
}

// Tek sipariş kaydet (yeni veya üzerine yaz)
export async function saveExportOrder(order, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!order?.id) throw new Error("id zorunlu (belgeNo_stokKodu_teslimTarihi)");
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  const now = new Date().toISOString();
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.orders || {}) : {};
  const existing = current[order.id] || {};
  const next = {
    ...existing,
    ...order,
    updatedAt: now,
    updatedBy: userEmail || "",
    createdAt: existing.createdAt || order.createdAt || now,
    createdBy: existing.createdBy || order.createdBy || userEmail || "",
  };
  await setDoc(ref, {
    orders: { ...current, [order.id]: next },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return next;
}

// Toplu import — mode: 'skip' (aynı 3-tuple varsa atla), 'overwrite' (üzerine yaz).
// Dönüş: { added, skipped, overwritten }
export async function bulkImportExportOrders(orders, { canEdit, userEmail = "", mode = "skip" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!Array.isArray(orders) || orders.length === 0) return { added: 0, skipped: 0, overwritten: 0 };
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.orders || {}) : {};
  const now = new Date().toISOString();
  const next = { ...current };
  const result = { added: 0, skipped: 0, overwritten: 0 };
  for (const o of orders) {
    if (!o?.id) continue;
    const exists = !!current[o.id];
    if (exists && mode === "skip") { result.skipped++; continue; }
    const prev = current[o.id] || {};
    next[o.id] = {
      ...prev,
      ...o,
      updatedAt: now,
      updatedBy: userEmail || "",
      createdAt: prev.createdAt || o.createdAt || now,
      createdBy: prev.createdBy || o.createdBy || userEmail || "",
    };
    if (exists) result.overwritten++; else result.added++;
  }
  await setDoc(ref, {
    orders: next,
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return result;
}

export async function deleteExportOrder(id, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!id) throw new Error("id zorunlu");
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  await updateDoc(ref, {
    [`orders.${id}`]: deleteField(),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  });
}

// Status update (open/closed/cancelled)
export async function updateExportOrderStatus(id, status, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!id) throw new Error("id zorunlu");
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  await updateDoc(ref, {
    [`orders.${id}.status`]: status,
    [`orders.${id}.updatedAt`]: new Date().toISOString(),
    [`orders.${id}.updatedBy`]: userEmail || "",
  });
}

// Numune onay/red — sipariş satırındaki isSample=true kayıt için.
// status: "pending" | "approved" | "rejected"
export async function updateExportOrderSampleStatus(id, sampleStatus, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!id) throw new Error("id zorunlu");
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  const now = new Date().toISOString();
  const patch = {
    [`orders.${id}.sampleStatus`]: sampleStatus,
    [`orders.${id}.updatedAt`]: now,
    [`orders.${id}.updatedBy`]: userEmail || "",
  };
  if (sampleStatus === "approved") {
    patch[`orders.${id}.sampleApprovedAt`] = now;
  }
  await updateDoc(ref, patch);
}

// ============================================================
// containerAllocations — { allocations: { [year_containerId_pid]: {...} } }
// ============================================================

export function subscribeContainerAllocations(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, ALLOCATIONS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || { allocations: {} }) : { allocations: {} }),
    (err) => { console.error("containerAllocations listener:", err); callback({ allocations: {} }); }
  );
}

export async function saveContainerAllocation(alloc, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!alloc?.year || !alloc?.containerId || !alloc?.pid) throw new Error("year, containerId, pid zorunlu");
  const key = `${alloc.year}_${alloc.containerId}_${alloc.pid}`;
  const ref = doc(db, APP_COL, ALLOCATIONS_DOC);
  const now = new Date().toISOString();
  await setDoc(ref, {
    allocations: {
      [key]: {
        ...alloc,
        updatedAt: now,
        updatedBy: userEmail || "",
      },
    },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
}

export async function deleteContainerAllocation(year, containerId, pid, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const key = `${year}_${containerId}_${pid}`;
  const ref = doc(db, APP_COL, ALLOCATIONS_DOC);
  await updateDoc(ref, {
    [`allocations.${key}`]: deleteField(),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  });
}

// ============================================================
// exportSettings — müşteri default'ları, ödeme etiket havuzu, kod haritası
// ============================================================
// Yapı:
//   {
//     paymentLabels: ["IN ADVANCE WITH ORDER", "T/T 60 DAYS", ...],
//     codeMap: { [vioCode]: pid, ... },
//     customerDefaults: {
//       [customerCode]: {
//         customerName: "OFMER SRL.",
//         currency: "EUR",
//         paymentPlan: [{ label, pct }, ...]
//       }
//     }
//   }

export function subscribeExportSettings(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("exportSettings listener:", err); callback({}); }
  );
}

// Payment etiketini ekle (unique). Kullanıcı her sipariş girişinde önerilere düşer.
export async function addPaymentLabel(label, { canEdit, userEmail = "" } = {}) {
  if (!canEdit || !label?.trim()) return;
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data() || {}) : {};
  const labels = Array.isArray(current.paymentLabels) ? current.paymentLabels : [];
  const trimmed = label.trim();
  if (labels.includes(trimmed)) return;
  await setDoc(ref, {
    paymentLabels: [...labels, trimmed],
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Müşteri default currency + paymentPlan kaydet
// v22 Motor Sync feature flag — appData/exportSettings.motorSyncEnabled
export async function setMotorSyncEnabled(enabled, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  await setDoc(ref, {
    motorSyncEnabled: !!enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// v23 Motor'a bağlı müşteri kodları — sevkiyat sekmesinde bunlar hariç
// tutulur (çünkü OFMER gibi müşteriler motor'un Sevkiyat Detay ekranında
// zaten yönetiliyor).
export async function saveMotorLinkedCustomers(codes, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!Array.isArray(codes)) throw new Error("codes array olmalı");
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  await setDoc(ref, {
    motorLinkedCustomers: codes.filter(Boolean),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

export async function saveCustomerDefaults(customerCode, defaults, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!customerCode) throw new Error("customerCode zorunlu");
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  await setDoc(ref, {
    customerDefaults: {
      [customerCode]: {
        ...defaults,
        updatedAt: new Date().toISOString(),
      },
    },
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Teslim şekli havuzu — her yeni giriş biriktirilir (unique)
export async function addDeliveryTerm(term, { canEdit, userEmail = "" } = {}) {
  if (!canEdit || !term?.trim()) return;
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data() || {}) : {};
  const list = Array.isArray(current.deliveryTermsList) ? current.deliveryTermsList : [];
  const trimmed = term.trim();
  if (list.includes(trimmed)) return;
  await setDoc(ref, {
    deliveryTermsList: [...list, trimmed],
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Ödeme planı şablonu (kullanıcı isim verir, planı kaydeder — sonra dropdown'da seçer)
// name: "Standart 30/70" gibi
// plan: [{ label, pct }, ...]
export async function savePaymentPlanTemplate(name, plan, { canEdit, userEmail = "" } = {}) {
  if (!canEdit || !name?.trim() || !Array.isArray(plan) || plan.length === 0) return;
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data() || {}) : {};
  const templates = Array.isArray(current.paymentPlanTemplates) ? current.paymentPlanTemplates : [];
  const trimmed = name.trim();
  // Aynı isimli şablon varsa üstüne yaz
  const filtered = templates.filter(t => t?.name !== trimmed);
  await setDoc(ref, {
    paymentPlanTemplates: [...filtered, { name: trimmed, plan }],
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

export async function deletePaymentPlanTemplate(name, { canEdit, userEmail = "" } = {}) {
  if (!canEdit || !name) return;
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data() || {}) : {};
  const templates = Array.isArray(current.paymentPlanTemplates) ? current.paymentPlanTemplates : [];
  await setDoc(ref, {
    paymentPlanTemplates: templates.filter(t => t?.name !== name),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Sipariş bazlı toplu güncelleme — aynı belgeNo + customerCode'daki tüm kalemlerin
// header alanlarına (deliveryTerms, paymentPlan, currency, opsiyonel teslimTarihi/status)
// aynı patch'i uygular.
// Dönüş: { updated: N }
export async function bulkUpdateOrdersByBelge({ customerCode, belgeNo, patch }, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!customerCode || !belgeNo) throw new Error("customerCode ve belgeNo zorunlu");
  const ref = doc(db, APP_COL, EXPORT_ORDERS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.orders || {}) : {};
  const now = new Date().toISOString();
  const next = { ...current };
  let count = 0;
  for (const [id, o] of Object.entries(current)) {
    if (!o) continue;
    if (String(o.belgeNo) !== String(belgeNo)) continue;
    if (o.customerCode !== customerCode) continue;
    next[id] = {
      ...o,
      ...patch,
      updatedAt: now,
      updatedBy: userEmail || "",
    };
    count++;
  }
  if (count === 0) return { updated: 0 };
  await setDoc(ref, {
    orders: next,
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return { updated: count };
}

// VIO code → products.id eşleşme haritası (öğrenilir, sonraki import'ta atla)
export async function saveCodeMapEntry(vioCode, pid, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) return;
  if (!vioCode || pid == null) return;
  const ref = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  await setDoc(ref, {
    codeMap: { [vioCode]: pid },
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// ============================================================
// Fatura Ayarları — appData/invoiceSettings
// ============================================================
// Yapı:
//   {
//     counters: { "2026": 77, "2027": 0, ... },  // yıl bazlı, atomik counter
//     bankInfo: { branchName, iban, swift, currency },
//     companyInfo: { name, address, phone, taxOffice, website, email },
//     stampImage: { url, path, uploadedAt },
//     logoImage: { url, path, uploadedAt },  // opsiyonel — mevcut PDF antet imajı için
//   }

export function subscribeInvoiceSettings(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || {}) : {}),
    (err) => { console.error("invoiceSettings listener:", err); callback({}); }
  );
}

export async function saveInvoiceSettings(patch, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  await setDoc(ref, {
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Multi-bank hesap listesi kaydet — {accounts: [{id, label, branchName, iban, swift, currency, isDefault}]}
// Yeni: birden fazla banka hesabı desteği (EUR, USD, farklı bankalar).
// Backward-compat: eski bankInfo (tek hesap) hala okunur.
export async function saveBankAccounts(accounts, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const list = Array.isArray(accounts) ? accounts : [];
  // Tek default zorunlu — kullanıcı işaretlemediyse ilkini default yap
  const hasDefault = list.some(a => a?.isDefault);
  const normalized = list.map((a, i) => ({
    ...a,
    isDefault: hasDefault ? !!a.isDefault : i === 0,
  }));
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  await setDoc(ref, {
    bankAccounts: normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Sayacı elle ayarla (kullanıcı bir kez başlangıç değeri gireceği için)
// counter[year] = son basılan numara; sıradaki = counter+1
export async function setInvoiceCounter(year, value, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const y = String(year);
  const n = Number(value) || 0;
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  await setDoc(ref, {
    counters: { [y]: n },
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  }, { merge: true });
}

// Atomik sonraki fatura numarası — Firestore transaction
// Format: CI + YYYY + NN (2 basamak; 100+ için otomatik genişler)
// Yıl her Ocak sıfırlanır (counters[yeni_yıl] yoksa 0'dan başlar).
export async function getNextInvoiceNumber({ canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const year = String(new Date().getFullYear());
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const counters = data.counters || {};
    const current = Number(counters[year]) || 0;
    const next = current + 1;
    tx.set(ref, {
      counters: { ...counters, [year]: next },
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail || "",
    }, { merge: true });
    return { year, next };
  });
  const nn = String(result.next).padStart(2, "0");
  return `CI${result.year}${nn}`;
}

// Kaşe imajı yükle. Dosya: PNG/JPG. Storage yolu: ihracat/stamp/stamp_{ts}.{ext}
export async function uploadStampImage(file, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!file) throw new Error("Dosya zorunlu");
  const ext = String(file.name || "png").split(".").pop().toLowerCase();
  const path = `ihracat/stamp/stamp_${Date.now()}.${ext}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  await saveInvoiceSettings({
    stampImage: { url, path, uploadedAt: new Date().toISOString() },
  }, { canEdit, userEmail });
  return { url, path };
}

export async function deleteStampImage({ canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const path = data?.stampImage?.path;
  if (path) {
    try { await deleteObject(storageRef(storage, path)); }
    catch (e) { if (e?.code !== "storage/object-not-found") console.warn("stamp silinemedi:", e.message); }
  }
  await updateDoc(ref, {
    stampImage: deleteField(),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  });
}

// Logo imajı yükle (fatura antetinde kullanılır).
export async function uploadLogoImage(file, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!file) throw new Error("Dosya zorunlu");
  const ext = String(file.name || "png").split(".").pop().toLowerCase();
  const path = `ihracat/logo/logo_${Date.now()}.${ext}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  await saveInvoiceSettings({
    logoImage: { url, path, uploadedAt: new Date().toISOString() },
  }, { canEdit, userEmail });
  return { url, path };
}

export async function deleteLogoImage({ canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  const ref = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const path = data?.logoImage?.path;
  if (path) {
    try { await deleteObject(storageRef(storage, path)); }
    catch (e) { if (e?.code !== "storage/object-not-found") console.warn("logo silinemedi:", e.message); }
  }
  await updateDoc(ref, {
    logoImage: deleteField(),
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  });
}

// ============================================================
// Fatura Kayıtları — appData/exportInvoices
// ============================================================
// Yapı: { invoices: { [invoiceNo]: { ... } } }

export function subscribeExportInvoices(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, EXPORT_INVOICES_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || { invoices: {} }) : { invoices: {} }),
    (err) => { console.error("exportInvoices listener:", err); callback({ invoices: {} }); }
  );
}

// Fatura kaydet (yeni veya güncelle — C7 kararı: düzenlenebilir).
// invoice.invoiceNo zorunlu (getNextInvoiceNumber ile alınmış olmalı).
// status: "issued" | "cancelled"
export async function saveExportInvoice(invoice, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!invoice?.invoiceNo) throw new Error("invoiceNo zorunlu");
  const ref = doc(db, APP_COL, EXPORT_INVOICES_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.invoices || {}) : {};
  const existing = current[invoice.invoiceNo] || {};
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...invoice,
    updatedAt: now,
    updatedBy: userEmail || "",
    createdAt: existing.createdAt || invoice.createdAt || now,
    createdBy: existing.createdBy || invoice.createdBy || userEmail || "",
    status: existing.status === "cancelled" ? "cancelled" : (invoice.status || existing.status || "issued"),
  };
  await setDoc(ref, {
    invoices: { ...current, [invoice.invoiceNo]: next },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return next;
}

// Hard delete — fatura kaydı tamamen silinir. Eğer bu numara, ilgili yılın en son
// verilen numarasıysa (counter[year] === num), sayaç 1 azaltılır — böylece yeniden
// oluşturulan fatura aynı numarayı alır. Aksi halde numara gap olarak kalır.
// Kullanım senaryosu: yeni oluşturulmuş bir faturada hata varsa sil ve yeniden yap.
// Denetim izi gereken iptaller için cancelExportInvoice (VOID) kullanılmalı.
export async function deleteExportInvoice(invoiceNo, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!invoiceNo) throw new Error("invoiceNo zorunlu");
  const invRef = doc(db, APP_COL, EXPORT_INVOICES_DOC);
  const setRef = doc(db, APP_COL, INVOICE_SETTINGS_DOC);
  const shipRef = doc(db, APP_COL, EXPORT_SHIPMENTS_DOC);
  const now = new Date().toISOString();

  // Silmeden önce faturayı oku (shipment bağı var mı?)
  const invSnap = await getDoc(invRef);
  const invMap = invSnap.exists() ? (invSnap.data()?.invoices || {}) : {};
  const invBefore = invMap[invoiceNo];
  if (!invBefore) throw new Error(`Fatura bulunamadı: ${invoiceNo}`);
  const linkedShipmentId = invBefore.linkedShipmentId || invBefore.shipmentId || null;

  // Fatura silinsin
  await updateDoc(invRef, {
    [`invoices.${invoiceNo}`]: deleteField(),
    updatedAt: now,
    updatedBy: userEmail || "",
  });

  // Counter rollback — sadece bu numara ilgili yılın son numarasıysa
  let counterRolledBack = false;
  let newCounterValue = null;
  const match = String(invoiceNo).match(/^CI(\d{4})(\d+)$/);
  if (match) {
    const year = match[1];
    const num = parseInt(match[2], 10);
    const setSnap = await getDoc(setRef);
    const counters = setSnap.exists() ? (setSnap.data()?.counters || {}) : {};
    if (typeof counters[year] === "number" && counters[year] === num) {
      newCounterValue = Math.max(0, num - 1);
      await updateDoc(setRef, {
        [`counters.${year}`]: newCounterValue,
        updatedAt: now,
        updatedBy: userEmail || "",
      });
      counterRolledBack = true;
    }
  }

  // v23 Faz 3.3.1 — Shipment rollback: fatura shipment'a bağlıysa
  // linkedInvoiceIds'ten çıkar; kalan fatura yoksa status "shipped"'a geri döner.
  // (Fatura kesilirken status "invoiced" olmuştu; iptal edildiğinde kullanıcı
  // aynı sevkiyat için yeni fatura kesebilmeli.)
  let shipmentRolledBack = false;
  if (linkedShipmentId) {
    const shipSnap = await getDoc(shipRef);
    const shipMap = shipSnap.exists() ? (shipSnap.data()?.shipments || {}) : {};
    const ship = shipMap[linkedShipmentId];
    if (ship) {
      const prevIds = Array.isArray(ship.linkedInvoiceIds) ? ship.linkedInvoiceIds.map(String) : [];
      const nextIds = prevIds.filter(x => x !== String(invoiceNo));
      const shouldRevertStatus = nextIds.length === 0 && ship.status === "invoiced";
      const nextShip = {
        ...ship,
        linkedInvoiceIds: nextIds,
        ...(shouldRevertStatus ? { status: "shipped" } : {}),
        updatedAt: now,
        updatedBy: userEmail || "",
      };
      await setDoc(shipRef, {
        shipments: { ...shipMap, [linkedShipmentId]: nextShip },
        updatedAt: now,
        updatedBy: userEmail || "",
      }, { merge: true });
      shipmentRolledBack = true;
    }
  }

  return { deleted: true, counterRolledBack, newCounterValue, shipmentRolledBack };
}

// Ödeme kaydı ekle — invoice.paymentHistory'ye push + paidAmount/paymentStatus günceller
// Kısmi/tam ödeme ayrımı otomatik: paidAmount >= totalAmount → paid, > 0 → partial, = 0 → unpaid
export async function recordPayment(invoiceNo, { amount, date, notes }, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!invoiceNo) throw new Error("invoiceNo zorunlu");
  const amt = Number(amount) || 0;
  if (amt <= 0) throw new Error("Tutar pozitif olmalı");
  const ref = doc(db, APP_COL, EXPORT_INVOICES_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.invoices || {}) : {};
  const inv = current[invoiceNo];
  if (!inv) throw new Error(`Fatura bulunamadı: ${invoiceNo}`);
  if ((inv.status || "issued") === "cancelled") throw new Error("İptal edilmiş fatura için ödeme kaydı eklenemez");
  const now = new Date().toISOString();
  const history = Array.isArray(inv.paymentHistory) ? [...inv.paymentHistory] : [];
  const newEntry = {
    id: `pmt_${Date.now()}`,
    amount: amt,
    date: date || now.slice(0, 10),
    notes: String(notes || "").trim(),
    by: userEmail || "",
    recordedAt: now,
  };
  history.push(newEntry);
  const paidAmount = history.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const total = Number(inv.totalAmount) || 0;
  const paymentStatus = paidAmount >= total - 0.005 ? "paid" : (paidAmount > 0 ? "partial" : "unpaid");
  await setDoc(ref, {
    invoices: {
      [invoiceNo]: {
        ...inv,
        paymentHistory: history,
        paidAmount,
        paymentStatus,
        paidAt: now,
        paidBy: userEmail || "",
        updatedAt: now,
        updatedBy: userEmail || "",
      },
    },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return { paidAmount, paymentStatus, entry: newEntry };
}

// Ödeme kaydını iptal et — history'den kaldırır, tutarları yeniden hesaplar
export async function revertPayment(invoiceNo, paymentId, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!invoiceNo) throw new Error("invoiceNo zorunlu");
  if (!paymentId) throw new Error("paymentId zorunlu");
  const ref = doc(db, APP_COL, EXPORT_INVOICES_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.invoices || {}) : {};
  const inv = current[invoiceNo];
  if (!inv) throw new Error(`Fatura bulunamadı: ${invoiceNo}`);
  const history = Array.isArray(inv.paymentHistory) ? inv.paymentHistory.filter(p => p.id !== paymentId) : [];
  const paidAmount = history.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const total = Number(inv.totalAmount) || 0;
  const paymentStatus = paidAmount >= total - 0.005 ? "paid" : (paidAmount > 0 ? "partial" : "unpaid");
  const now = new Date().toISOString();
  await setDoc(ref, {
    invoices: {
      [invoiceNo]: {
        ...inv,
        paymentHistory: history,
        paidAmount,
        paymentStatus,
        updatedAt: now,
        updatedBy: userEmail || "",
      },
    },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return { paidAmount, paymentStatus };
}

// İptal (soft) — numara VOID, tekrar kullanılmaz. Kayıt silinmez, status: cancelled.
export async function cancelExportInvoice(invoiceNo, reason, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!invoiceNo) throw new Error("invoiceNo zorunlu");
  const ref = doc(db, APP_COL, EXPORT_INVOICES_DOC);
  const now = new Date().toISOString();
  await setDoc(ref, {
    invoices: {
      [invoiceNo]: {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: userEmail || "",
        cancelReason: String(reason || "").trim(),
        updatedAt: now,
        updatedBy: userEmail || "",
      },
    },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
}

// ============================================================
// exportShipments — { shipments: { [id]: {...} } }
// v23: Motor dışı ihracat sevkiyatları (OFMER dışı müşteriler için)
// ============================================================
// Yapı:
//   shipmentId: `SHP_${timestamp}_${random}` (uniq)
//   customerCode, customerName
//   shipmentDate: "YYYY-MM-DD" (fiziksel sevk tarihi)
//   plannedDate: opsiyonel (planlanan tarih)
//   items: [{ pid, stokKodu, stokAdi, descriptionEn, qty, allocations: [{orderId, belgeNo, qty}], notes }]
//   status: "planned" | "packed" | "shipped" | "invoiced" | "cancelled"
//   linkedInvoiceIds: [invoiceNo, ...] (fatura kesildiğinde eklenir)
//   notes: genel açıklama

export function subscribeExportShipments(callback) {
  if (!db) return () => {};
  const ref = doc(db, APP_COL, EXPORT_SHIPMENTS_DOC);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? (snap.data() || { shipments: {} }) : { shipments: {} }),
    (err) => { console.error("exportShipments listener:", err); callback({ shipments: {} }); }
  );
}

export async function saveExportShipment(shipment, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!shipment?.id) throw new Error("id zorunlu");
  const ref = doc(db, APP_COL, EXPORT_SHIPMENTS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.shipments || {}) : {};
  const existing = current[shipment.id] || {};
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...shipment,
    updatedAt: now,
    updatedBy: userEmail || "",
    createdAt: existing.createdAt || shipment.createdAt || now,
    createdBy: existing.createdBy || shipment.createdBy || userEmail || "",
  };
  await setDoc(ref, {
    shipments: { ...current, [shipment.id]: next },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return next;
}

export async function deleteExportShipment(shipmentId, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!shipmentId) throw new Error("shipmentId zorunlu");
  const ref = doc(db, APP_COL, EXPORT_SHIPMENTS_DOC);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    [`shipments.${shipmentId}`]: deleteField(),
    updatedAt: now,
    updatedBy: userEmail || "",
  });
}

export async function updateExportShipmentStatus(shipmentId, status, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!shipmentId) throw new Error("shipmentId zorunlu");
  const ref = doc(db, APP_COL, EXPORT_SHIPMENTS_DOC);
  const now = new Date().toISOString();
  await setDoc(ref, {
    shipments: { [shipmentId]: { status, updatedAt: now, updatedBy: userEmail || "" } },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
}

// v23 Faz 3 — Fatura kesildikten sonra shipment'a bağla:
//   * status → "invoiced"
//   * linkedInvoiceIds → yeni invoiceNo'ları push (idempotent)
// Modal onCreated callback'inden çağrılır.
export async function attachInvoicesToShipment(shipmentId, invoiceNos, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!shipmentId) throw new Error("shipmentId zorunlu");
  const nos = (Array.isArray(invoiceNos) ? invoiceNos : [invoiceNos]).filter(Boolean).map(String);
  if (nos.length === 0) return;
  const ref = doc(db, APP_COL, EXPORT_SHIPMENTS_DOC);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data()?.shipments || {}) : {};
  const existing = current[shipmentId];
  if (!existing) throw new Error("Sevkiyat bulunamadı: " + shipmentId);
  const now = new Date().toISOString();
  const prevIds = Array.isArray(existing.linkedInvoiceIds) ? existing.linkedInvoiceIds.map(String) : [];
  const merged = [...prevIds];
  for (const n of nos) if (!merged.includes(n)) merged.push(n);
  const next = {
    ...existing,
    linkedInvoiceIds: merged,
    status: "invoiced",
    updatedAt: now,
    updatedBy: userEmail || "",
  };
  await setDoc(ref, {
    shipments: { ...current, [shipmentId]: next },
    updatedAt: now,
    updatedBy: userEmail || "",
  }, { merge: true });
  return next;
}

// ============================================================
// Ürün bazlı doküman ekleri (teknik resim, PO, sertifika vb.)
// ============================================================
// Storage path: appData/exportProductDocs/{stokKodu}/{ts}_{filename}
// Firestore path: exportSettings.productDocuments[stokKodu].files[]
// Aynı stok kodunun tüm siparişleri aynı dosya listesini paylaşır.

const MAX_PRODUCT_DOC_BYTES = 20 * 1024 * 1024; // 20 MB

// Storage'a path-safe stok kodu (slash / boşluk vb. escape) — dosya adı için de
function sanitizePathSegment(s) {
  return String(s || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function uploadProductDocument(stokKodu, file, category, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!stokKodu) throw new Error("stokKodu zorunlu");
  if (!file) throw new Error("Dosya zorunlu");
  if (file.size > MAX_PRODUCT_DOC_BYTES) {
    throw new Error(`Dosya çok büyük (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_PRODUCT_DOC_BYTES / 1024 / 1024} MB.`);
  }
  const codeSeg = sanitizePathSegment(stokKodu);
  const nameSeg = sanitizePathSegment(file.name || "file");
  const ts = Date.now();
  const path = `appData/exportProductDocs/${codeSeg}/${ts}_${nameSeg}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(ref);

  // Firestore meta — exportSettings.productDocuments[stokKodu].files array'ine ekle
  const settingsRef = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  const snap = await getDoc(settingsRef);
  const settings = snap.exists() ? (snap.data() || {}) : {};
  const productDocs = settings.productDocuments || {};
  const forStock = productDocs[stokKodu] || { files: [] };
  const now = new Date().toISOString();
  const newFile = {
    fileName: file.name || "file",
    storagePath: path,
    url,
    category: (category || "").trim() || "Diğer",
    size: file.size,
    uploadedAt: now,
    uploadedBy: userEmail || "",
  };
  const nextFiles = [...(forStock.files || []), newFile];
  await setDoc(settingsRef, {
    productDocuments: {
      ...productDocs,
      [stokKodu]: { files: nextFiles, updatedAt: now, updatedBy: userEmail || "" },
    },
  }, { merge: true });
  return newFile;
}

export async function deleteProductDocument(stokKodu, storagePath, { canEdit, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!storage) throw new Error("Storage bağlantısı hazır değil");
  if (!stokKodu || !storagePath) throw new Error("stokKodu ve storagePath zorunlu");
  // Storage sil (yoksa sessiz)
  try {
    await deleteObject(storageRef(storage, storagePath));
  } catch (e) {
    if (e?.code !== "storage/object-not-found") console.warn("Storage sil hatası:", e.message);
  }
  // Firestore meta güncelle
  const settingsRef = doc(db, APP_COL, EXPORT_SETTINGS_DOC);
  const snap = await getDoc(settingsRef);
  if (!snap.exists()) return;
  const settings = snap.data() || {};
  const productDocs = settings.productDocuments || {};
  const forStock = productDocs[stokKodu];
  if (!forStock) return;
  const nextFiles = (forStock.files || []).filter(f => f.storagePath !== storagePath);
  const now = new Date().toISOString();
  await setDoc(settingsRef, {
    productDocuments: {
      ...productDocs,
      [stokKodu]: nextFiles.length > 0
        ? { files: nextFiles, updatedAt: now, updatedBy: userEmail || "" }
        : { files: [], updatedAt: now, updatedBy: userEmail || "" },
    },
  }, { merge: true });
}
