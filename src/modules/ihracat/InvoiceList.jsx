// Faturalar Sekmesi — İhracat modülü altında liste + arama + PDF/iptal.
// COC deseni: kilit yok, düzenlenebilir; iptal edilen VOID kalır.

import React, { useState, useEffect, useMemo } from "react";
import {
  subscribeExportInvoices, subscribeInvoiceSettings, cancelExportInvoice,
  deleteExportInvoice,
} from "./firestore";
import { generateInvoicePdf } from "./invoicePdf";
import InvoiceCreateModal from "./InvoiceCreateModal";
import InvoiceEditModal from "./InvoiceEditModal";
import PaymentRequestModal from "./PaymentRequestModal";

const STATUS_META = {
  issued: { label: "Kesildi", bg: "#dbeafe", fg: "#1e40af" },
  cancelled: { label: "İPTAL (VOID)", bg: "#fef2f2", fg: "#991b1b" },
};

export default function InvoiceList({ canEdit, userEmail, products, ordersData, allocationsData }) {
  const [data, setData] = useState({ invoices: {} });
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailInvoice, setDetailInvoice] = useState(null);
  const [editInvoice, setEditInvoice] = useState(null); // ✏ düzenleme modalı
  const [showBlank, setShowBlank] = useState(false); // "Yeni Boş Fatura" modal
  const [showPaymentRequest, setShowPaymentRequest] = useState(false);

  useEffect(() => {
    const u1 = subscribeExportInvoices(d => { setData(d || { invoices: {} }); setLoaded(true); });
    const u2 = subscribeInvoiceSettings(d => setSettings(d || {}));
    return () => { u1 && u1(); u2 && u2(); };
  }, []);

  const invoices = useMemo(() => Object.values(data?.invoices || {}), [data]);

  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const i of invoices) if (i.customerCode) map.set(i.customerCode, i.customerName || i.customerCode);
    return Array.from(map, ([code, name]) => ({ code, name }));
  }, [invoices]);

  const list = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return invoices
      .filter(i => {
        if (customerFilter !== "all" && i.customerCode !== customerFilter) return false;
        if (statusFilter !== "all" && (i.status || "issued") !== statusFilter) return false;
        if (!q) return true;
        const hay = `${i.invoiceNo || ""} ${i.customerName || ""} ${i.orderNr || ""} ${(i.lines || []).map(l => l.description).join(" ")}`.toLocaleLowerCase("tr-TR");
        return hay.includes(q);
      })
      .sort((a, b) => (b.invoiceNo || "").localeCompare(a.invoiceNo || ""));
  }, [invoices, search, customerFilter, statusFilter]);

  const handleDownload = async (inv) => {
    try {
      await generateInvoicePdf(inv, settings);
    } catch (e) {
      alert("PDF üretilemedi: " + e.message);
    }
  };

  const handleCancel = async (inv) => {
    if (!canEdit) return;
    if ((inv.status || "issued") === "cancelled") { alert("Zaten iptal"); return; }
    const reason = prompt(`${inv.invoiceNo} numaralı fatura iptal edilecek.\nNumara VOID kalır, tekrar kullanılamaz.\n\nİptal sebebi:`);
    if (reason == null) return; // vazgeçti
    try {
      await cancelExportInvoice(inv.invoiceNo, reason, { canEdit, userEmail });
    } catch (e) {
      alert("İptal edilemedi: " + e.message);
    }
  };

  const handleDelete = async (inv) => {
    if (!canEdit) return;
    const ok = confirm(
      `${inv.invoiceNo} numaralı faturayı SİLMEK istediğinden emin misin?\n\n` +
      `• Kayıt tamamen silinir (kurtarma yok).\n` +
      `• Bu numara yılın son numarasıysa sayaç geri alınır.\n` +
      `• Denetim izi gerekiyorsa SİL yerine 🚫 İPTAL (VOID) kullan.`
    );
    if (!ok) return;
    try {
      const res = await deleteExportInvoice(inv.invoiceNo, { canEdit, userEmail });
      if (res.counterRolledBack) {
        alert(`✓ ${inv.invoiceNo} silindi.\nSayaç ${res.newCounterValue}'e geri alındı — yeni fatura aynı numarayı alabilir.`);
      } else {
        alert(`✓ ${inv.invoiceNo} silindi.\n(Daha sonra basılmış numaralar olduğu için sayaç geri alınmadı.)`);
      }
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  return (
    <div>
      {/* KPI + Yeni Boş Fatura */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="🔎 Fatura no / müşteri / order no / kalem ara..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
        <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
          <option value="all">Tüm Müşteriler ({customerOptions.length})</option>
          {customerOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
          <option value="all">Tümü</option>
          <option value="issued">Kesildi</option>
          <option value="cancelled">İptal</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{list.length} fatura</span>
        <button onClick={() => setShowPaymentRequest(true)}
          style={{ marginLeft: "auto", padding: "6px 12px", fontSize: 12, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
          📋 Ödeme Talep Tablosu
        </button>
        <button onClick={() => setShowBlank(true)} disabled={!canEdit}
          style={{ padding: "6px 12px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500 }}>
          + Yeni Boş Fatura
        </button>
      </div>

      {!loaded ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e" }}>Yükleniyor…</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8, fontSize: 12 }}>
          {invoices.length === 0
            ? "Henüz fatura oluşturulmadı. Sevkiyat Detay'daki konteyner tahsis panelinden veya + Yeni Boş Fatura ile başla."
            : "Filtreye uyan fatura yok."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "var(--color-background-secondary)" }}>
              <tr>
                <th style={th}>Fatura No</th>
                <th style={th}>Tarih</th>
                <th style={th}>Müşteri</th>
                <th style={th}>Order NR.</th>
                <th style={{ ...th, textAlign: "right" }}>Toplam</th>
                <th style={th}>Currency</th>
                <th style={{ ...th, textAlign: "center" }}>Durum</th>
                <th style={{ ...th, textAlign: "center", width: 120 }}>Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {list.map(i => {
                const st = STATUS_META[i.status || "issued"];
                const isVoid = (i.status || "issued") === "cancelled";
                return (
                  <tr key={i.invoiceNo} style={{ borderTop: "1px solid #f5f5f4", background: isVoid ? "#fafaf9" : "transparent", opacity: isVoid ? 0.65 : 1 }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{i.invoiceNo}</td>
                    <td style={td}>{i.invoiceDate || "—"}</td>
                    <td style={td}>{i.customerName || "—"}</td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>{i.orderNr || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                      {Number(i.totalAmount || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={td}>{i.currency || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ padding: "1px 6px", fontSize: 9, fontWeight: 600, borderRadius: 3, background: st.bg, color: st.fg }}>{st.label}</span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button onClick={() => setDetailInvoice(i)}
                        style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>👁</button>
                      <button onClick={() => handleDownload(i)}
                        title="PDF indir"
                        style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>📄</button>
                      {!isVoid && (
                        <button onClick={() => setEditInvoice(i)} disabled={!canEdit}
                          title="Düzenle"
                          style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#fefce8", color: "#854d0e", border: "1px solid #fde68a", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>✏</button>
                      )}
                      {!isVoid && (
                        <button onClick={() => handleDelete(i)} disabled={!canEdit}
                          title="Sil (sayaç geri alınabilir)"
                          style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                      )}
                      {!isVoid && (
                        <button onClick={() => handleCancel(i)} disabled={!canEdit}
                          title="İptal (VOID) — numara tutulur"
                          style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🚫</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detay modal — basit görüntüleme */}
      {detailInvoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
          onClick={() => setDetailInvoice(null)}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>👁 {detailInvoice.invoiceNo}</div>
              <button onClick={() => setDetailInvoice(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.6 }}>
              <div><b>Tarih:</b> {detailInvoice.invoiceDate}</div>
              <div><b>Müşteri:</b> {detailInvoice.customerName}</div>
              <div><b>Adres:</b> {detailInvoice.customerAddress}, {detailInvoice.customerCity}, {detailInvoice.customerCountry}</div>
              <div><b>Order NR.:</b> {detailInvoice.orderNr}</div>
              <div><b>Teslim:</b> {detailInvoice.deliveryTerms}</div>
              <div><b>Banka:</b> {detailInvoice.bankAccount?.label} — {detailInvoice.bankAccount?.iban}</div>
              <div><b>Toplam:</b> {Number(detailInvoice.totalAmount || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {detailInvoice.currency}</div>
            </div>
            <div style={{ marginTop: 10, borderTop: "1px solid #e7e5e4", paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Kalemler ({(detailInvoice.lines || []).length}):</div>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead style={{ background: "#f5f5f4" }}>
                  <tr>
                    <th style={{ padding: "3px 5px", textAlign: "left" }}>Description</th>
                    <th style={{ padding: "3px 5px", textAlign: "right", width: 40 }}>Qty</th>
                    <th style={{ padding: "3px 5px", width: 30 }}>UM</th>
                    <th style={{ padding: "3px 5px", textAlign: "right", width: 60 }}>Price</th>
                    <th style={{ padding: "3px 5px", textAlign: "right", width: 70 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailInvoice.lines || []).map((l, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                      <td style={{ padding: "3px 5px" }}>{l.description}</td>
                      <td style={{ padding: "3px 5px", textAlign: "right" }}>{l.qty}</td>
                      <td style={{ padding: "3px 5px" }}>{l.unit}</td>
                      <td style={{ padding: "3px 5px", textAlign: "right" }}>{Number(l.unitPrice).toFixed(2)}</td>
                      <td style={{ padding: "3px 5px", textAlign: "right", fontWeight: 600 }}>{Number(l.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detailInvoice.cancelReason && (
              <div style={{ marginTop: 10, padding: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
                <b>🚫 İPTAL EDİLDİ:</b> {detailInvoice.cancelReason}
                {detailInvoice.cancelledAt && <div style={{ fontSize: 9 }}>{new Date(detailInvoice.cancelledAt).toLocaleString("tr-TR")}</div>}
              </div>
            )}
            <div style={{ marginTop: 10, textAlign: "right" }}>
              <button onClick={() => handleDownload(detailInvoice)}
                style={{ padding: "5px 12px", fontSize: 11, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>📄 PDF İndir</button>
            </div>
          </div>
        </div>
      )}

      {/* Düzenleme */}
      {editInvoice && (
        <InvoiceEditModal
          invoice={editInvoice}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setEditInvoice(null)}
          onSaved={() => { /* liste subscription ile kendini günceller — modalı açık bırak */ }}
        />
      )}

      {/* Ödeme Talep Tablosu */}
      {showPaymentRequest && (
        <PaymentRequestModal
          invoices={invoices}
          customerOptions={customerOptions}
          initialCustomer={customerFilter}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setShowPaymentRequest(false)}
        />
      )}

      {/* Yeni Boş Fatura */}
      {showBlank && (
        <InvoiceCreateModal
          mode="blank"
          products={products}
          ordersData={ordersData}
          allocationsData={allocationsData}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setShowBlank(false)}
          onCreated={() => setShowBlank(false)}
        />
      )}
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
