// İhracat Sevkiyat Listesi — motor dışı sevkiyatlar
// Faz 1: liste + arama + filtre + yeni ekle + düzenle/sil
// Faz 2: PDF (çeki listesi, etiket)
// Faz 3: Fatura entegrasyonu

import React, { useState, useEffect, useMemo } from "react";
import {
  subscribeExportShipments, updateExportShipmentStatus, deleteExportShipment,
  subscribeInvoiceSettings, attachInvoicesToShipment,
} from "./firestore";
import ExportShipmentForm from "./ExportShipmentForm";
import InvoiceCreateModal from "./InvoiceCreateModal";
import { generatePackingListPdf, generateShipmentLabelPdf } from "./shipmentPdfs";

const STATUS_META = {
  planned: { label: "Planlandı", bg: "#dbeafe", fg: "#1e40af" },
  packed: { label: "Paketlendi", bg: "#fef3c7", fg: "#92400e" },
  shipped: { label: "Sevk Edildi", bg: "#dcfce7", fg: "#166534" },
  invoiced: { label: "Faturalı", bg: "#f0fdf4", fg: "#0e7490" },
  cancelled: { label: "İptal", bg: "#fef2f2", fg: "#991b1b" },
};

const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR");

export default function ExportShipmentList({ canEdit, userEmail, products, ordersData, allocationsData, exportSettings }) {
  const [data, setData] = useState({ shipments: {} });
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingShipment, setEditingShipment] = useState(null);
  const [invoicingShipment, setInvoicingShipment] = useState(null); // fatura modal için seçili shipment
  const [invoiceSettings, setInvoiceSettings] = useState({});

  useEffect(() => {
    const u = subscribeExportShipments(d => { setData(d || { shipments: {} }); setLoaded(true); });
    const u2 = subscribeInvoiceSettings(d => setInvoiceSettings(d || {}));
    return () => { u && u(); u2 && u2(); };
  }, []);

  // v23 — Motor'a bağlı müşterileri (OFMER vb) burada gösterme
  const motorLinkedCustomers = Array.isArray(exportSettings?.motorLinkedCustomers) ? exportSettings.motorLinkedCustomers : [];

  const shipments = useMemo(() =>
    Object.values(data?.shipments || {}).filter(s => !motorLinkedCustomers.includes(s.customerCode)),
  [data, motorLinkedCustomers]);

  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const s of shipments) if (s.customerCode) map.set(s.customerCode, s.customerName || s.customerCode);
    return Array.from(map, ([code, name]) => ({ code, name }));
  }, [shipments]);

  const list = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return shipments
      .filter(s => {
        if (customerFilter !== "all" && s.customerCode !== customerFilter) return false;
        if (statusFilter !== "all" && (s.status || "planned") !== statusFilter) return false;
        if (!q) return true;
        const hay = `${s.customerName || ""} ${s.customerCode || ""} ${s.notes || ""} ${(s.items || []).map(i => `${i.stokKodu} ${i.stokAdi}`).join(" ")}`.toLocaleLowerCase("tr-TR");
        return hay.includes(q);
      })
      .sort((a, b) => String(b.shipmentDate || b.createdAt || "").localeCompare(String(a.shipmentDate || a.createdAt || "")));
  }, [shipments, search, customerFilter, statusFilter]);

  const openNew = () => { setEditingShipment(null); setShowForm(true); };
  const openEdit = (s) => { setEditingShipment(s); setShowForm(true); };
  const closeForm = () => { setEditingShipment(null); setShowForm(false); };

  const handleDelete = async (s) => {
    if (!canEdit) return;
    if (!confirm(`${s.customerName} · ${s.shipmentDate} sevkiyatı silinsin mi?\n\n(Fatura kesilmişse fatura kaydı silinmez, sadece sevkiyat kaydı silinir.)`)) return;
    try {
      await deleteExportShipment(s.id, { canEdit, userEmail });
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  const handleStatusChange = async (s, newStatus) => {
    if (!canEdit) return;
    try {
      await updateExportShipmentStatus(s.id, newStatus, { canEdit, userEmail });
    } catch (e) {
      alert("Durum güncellenemedi: " + e.message);
    }
  };

  const customerDefaults = exportSettings?.customerDefaults || {};
  const pdfOpts = { products, invoiceSettings, customerDefaults };

  const handleDownloadPackingList = async (s) => {
    try {
      await generatePackingListPdf(s, pdfOpts);
    } catch (e) {
      alert("Çeki listesi üretilemedi: " + e.message);
    }
  };

  const handleDownloadLabel = async (s) => {
    try {
      await generateShipmentLabelPdf(s, pdfOpts);
    } catch (e) {
      alert("Etiket üretilemedi: " + e.message);
    }
  };

  const openInvoiceModal = (s) => {
    if (!canEdit) return;
    setInvoicingShipment(s);
  };
  const closeInvoiceModal = () => setInvoicingShipment(null);

  // Modal başarılı fatura oluşturduğunda: shipment'a linkedInvoiceIds ekle + status → invoiced
  const handleInvoicesCreated = async (created) => {
    if (!invoicingShipment) return;
    const invoiceNos = (created || []).map(c => c.invoiceNo).filter(Boolean);
    if (invoiceNos.length === 0) { closeInvoiceModal(); return; }
    try {
      await attachInvoicesToShipment(invoicingShipment.id, invoiceNos, { canEdit, userEmail });
    } catch (e) {
      alert("Sevkiyata fatura bağlanamadı: " + e.message);
    }
    closeInvoiceModal();
  };

  return (
    <div>
      {/* Üst araç barı */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="🔎 Müşteri / ürün / not ara..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
        <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
          <option value="all">Tüm Müşteriler ({customerOptions.length})</option>
          {customerOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
          <option value="all">Tüm Durumlar</option>
          <option value="planned">🔵 Planlandı</option>
          <option value="packed">🟡 Paketlendi</option>
          <option value="shipped">🟢 Sevk Edildi</option>
          <option value="invoiced">✅ Faturalı</option>
          <option value="cancelled">🚫 İptal</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{list.length} sevkiyat</span>
        <button onClick={openNew} disabled={!canEdit}
          style={{ marginLeft: "auto", padding: "6px 12px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500 }}>
          + Yeni Sevkiyat
        </button>
      </div>

      {!loaded ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e" }}>Yükleniyor…</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8, fontSize: 12 }}>
          {shipments.length === 0
            ? "Henüz sevkiyat yok. + Yeni Sevkiyat ile başla."
            : "Filtreye uyan sevkiyat yok."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "var(--color-background-secondary)" }}>
              <tr>
                <th style={th}>Sevk Tarihi</th>
                <th style={th}>Müşteri</th>
                <th style={{ ...th, textAlign: "right" }}>Kalem</th>
                <th style={{ ...th, textAlign: "right" }}>Toplam Adet</th>
                <th style={{ ...th, textAlign: "center" }}>Durum</th>
                <th style={{ ...th, textAlign: "center", width: 200 }}>Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => {
                const st = STATUS_META[s.status || "planned"] || STATUS_META.planned;
                const totalItems = (s.items || []).length;
                const totalQty = (s.items || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
                const isCancelled = (s.status || "planned") === "cancelled";
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid #f5f5f4", background: isCancelled ? "#fafaf9" : "transparent", opacity: isCancelled ? 0.65 : 1 }}>
                    <td style={td}>{s.shipmentDate || "—"}</td>
                    <td style={td}>
                      <div>{s.customerName || "—"}</div>
                      {s.customerCode && <div style={{ fontSize: 9, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>{s.customerCode}</div>}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{totalItems}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmt0(totalQty)}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {!isCancelled ? (
                        <select value={s.status || "planned"} onChange={e => handleStatusChange(s, e.target.value)} disabled={!canEdit}
                          style={{ padding: "2px 6px", fontSize: 9, fontWeight: 600, border: "1px solid " + st.fg, borderRadius: 3, background: st.bg, color: st.fg, cursor: canEdit ? "pointer" : "not-allowed" }}>
                          <option value="planned">Planlandı</option>
                          <option value="packed">Paketlendi</option>
                          <option value="shipped">Sevk Edildi</option>
                          <option value="invoiced">Faturalı</option>
                          <option value="cancelled">İptal</option>
                        </select>
                      ) : (
                        <span style={{ padding: "2px 6px", fontSize: 9, fontWeight: 600, borderRadius: 3, background: st.bg, color: st.fg }}>{st.label}</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button onClick={() => handleDownloadPackingList(s)}
                        title="Çeki Listesi PDF"
                        style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>📋</button>
                      <button onClick={() => handleDownloadLabel(s)}
                        title="Sevkiyat Etiketi PDF"
                        style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>🏷</button>
                      {!isCancelled && (s.status || "planned") !== "invoiced" && (
                        <button onClick={() => openInvoiceModal(s)} disabled={!canEdit}
                          title="Fatura Oluştur"
                          style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#f5f3ff", color: "#5b21b6", border: "1px solid #ddd6fe", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🧾</button>
                      )}
                      <button onClick={() => openEdit(s)} disabled={!canEdit}
                        title="Detay / Düzenle"
                        style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#fefce8", color: "#854d0e", border: "1px solid #fde68a", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>✏</button>
                      <button onClick={() => handleDelete(s)} disabled={!canEdit}
                        title="Sil"
                        style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <ExportShipmentForm
          editingShipment={editingShipment}
          products={products}
          ordersData={ordersData}
          allocationsData={allocationsData}
          shipmentsData={data}
          exportSettings={exportSettings}
          canEdit={canEdit}
          userEmail={userEmail}
          onSaved={closeForm}
          onCancel={closeForm}
        />
      )}

      {/* Fatura Oluştur modal — sevkiyat kalemlerinden */}
      {invoicingShipment && (
        <InvoiceCreateModal
          mode="shipment"
          shipmentId={invoicingShipment.id}
          shipmentItems={invoicingShipment.items || []}
          products={products}
          ordersData={ordersData}
          allocationsData={allocationsData}
          shipmentsData={data}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={closeInvoiceModal}
          onCreated={handleInvoicesCreated}
          presetTitle={`🧾 Fatura Oluştur — ${invoicingShipment.customerName || ""}`}
        />
      )}
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
