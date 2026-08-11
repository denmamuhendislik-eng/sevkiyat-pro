// Ödeme Kayıt Modalı
// Fatura üzerinde ödemeleri kaydeder, geçmişi gösterir, revert eder.
// Kısmi/tam ödeme mantığı: firestore.recordPayment içinde otomatik hesaplanır.

import React, { useState } from "react";
import { recordPayment, revertPayment } from "./firestore";

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentModal({ invoice, canEdit, userEmail, onClose }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!invoice) return null;

  const total = Number(invoice.totalAmount) || 0;
  const paid = Number(invoice.paidAmount) || 0;
  const remaining = Math.max(0, total - paid);
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  const history = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [];
  const currency = invoice.currency || "EUR";

  const canRecord = Number(amount) > 0 && Number(amount) <= remaining + 0.01;

  const handleRecord = async () => {
    if (!canEdit) return;
    if (!canRecord) { setError("Tutar 0'dan büyük ve kalan tutarı aşmamalı"); return; }
    setSaving(true); setError("");
    try {
      await recordPayment(invoice.invoiceNo, {
        amount: Number(amount),
        date,
        notes,
      }, { canEdit, userEmail });
      setAmount(""); setNotes("");
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleRevert = async (paymentId) => {
    if (!canEdit) return;
    if (!confirm("Bu ödeme kaydı silinsin mi? Tutar geri alınır.")) return;
    setSaving(true); setError("");
    try {
      await revertPayment(invoice.invoiceNo, paymentId, { canEdit, userEmail });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>💰 Ödeme Kaydı — {invoice.invoiceNo}</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>{invoice.customerName} · {invoice.invoiceDate}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {/* Özet + bar */}
        <div style={{ padding: 12, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: "#57534e" }}>Fatura Toplamı</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(total)} {currency}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#166534" }}>Ödenen</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>{fmt(paid)} {currency}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: remaining > 0 ? "#dc2626" : "#166534" }}>Kalan</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: remaining > 0 ? "#dc2626" : "#166534" }}>{fmt(remaining)} {currency}</div>
            </div>
          </div>
          <div style={{ height: 8, background: "#dbeafe", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#166534" : "#1e40af", transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 9, color: "#78716c", marginTop: 4 }}>
            Durum: {invoice.paymentStatus === "paid" ? "✅ Ödendi" : invoice.paymentStatus === "partial" ? "🟡 Kısmi Ödendi" : "🔵 Ödeme Bekliyor"} (%{pct.toFixed(0)})
          </div>
        </div>

        {error && <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}

        {/* Yeni ödeme formu */}
        {remaining > 0.005 && (
          <div style={{ padding: 10, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 6, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>➕ Yeni Ödeme Kaydet</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label={`Tutar (max ${fmt(remaining)} ${currency})`}>
                <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder={fmt(remaining)} style={inp} />
              </Field>
              <Field label="Ödeme Tarihi">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
              </Field>
            </div>
            <Field label="Not (opsiyonel)">
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Örn. Ziraat 15.09 havale — TR12..." style={inp} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
              <button onClick={() => setAmount(String(remaining.toFixed(2)))} type="button"
                style={{ padding: "5px 10px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>
                Kalanı Öde
              </button>
              <button onClick={handleRecord} disabled={saving || !canEdit || !canRecord}
                style={{ padding: "5px 14px", fontSize: 11, background: canRecord ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 3, cursor: (saving || !canRecord) ? "not-allowed" : "pointer", fontWeight: 500 }}>
                {saving ? "Kaydediliyor…" : "💰 Ödeme Kaydet"}
              </button>
            </div>
          </div>
        )}

        {/* Ödeme geçmişi */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>📜 Ödeme Geçmişi ({history.length})</div>
          {history.length === 0 ? (
            <div style={{ padding: 10, fontSize: 10, color: "#a8a29e", textAlign: "center", border: "1px dashed #d6d3d1", borderRadius: 4 }}>
              Henüz kaydedilmiş ödeme yok.
            </div>
          ) : (
            <div style={{ border: "1px solid #e7e5e4", borderRadius: 4, overflow: "hidden" }}>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead style={{ background: "#f5f5f4" }}>
                  <tr>
                    <th style={th}>Tarih</th>
                    <th style={{ ...th, textAlign: "right" }}>Tutar</th>
                    <th style={th}>Not</th>
                    <th style={th}>Kaydeden</th>
                    <th style={{ ...th, textAlign: "center", width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice().reverse().map(p => (
                    <tr key={p.id} style={{ borderTop: "1px solid #f5f5f4" }}>
                      <td style={td}>{p.date}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#166534" }}>+{fmt(p.amount)} {currency}</td>
                      <td style={td}>{p.notes || "—"}</td>
                      <td style={{ ...td, fontSize: 9, color: "#78716c" }}>{p.by || "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <button onClick={() => handleRevert(p.id)} disabled={!canEdit || saving}
                          title="Bu ödeme kaydını sil"
                          style={{ padding: "1px 5px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, borderTop: "1px solid #e7e5e4", paddingTop: 10 }}>
          <button onClick={onClose}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 700, maxHeight: "92vh", overflow: "auto" };
const inp = { width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "middle" };
