// Fatura Düzenleme Modal
// Kayıtlı bir faturayı serbestçe düzenler (numara sabit kalır).
// Kullanım: InvoiceList → ✏ Düzenle butonundan açılır.
// Kaydet → saveExportInvoice upsert (updatedAt/updatedBy güncellenir).

import React, { useState, useMemo, useEffect } from "react";
import {
  saveExportInvoice, subscribeInvoiceSettings,
} from "./firestore";
import { generateInvoicePdf } from "./invoicePdf";

const CURRENCIES = ["EUR", "USD", "TL", "GBP"];

export default function InvoiceEditModal({ invoice, canEdit, userEmail, onClose, onSaved }) {
  const [settings, setSettings] = useState({});
  useEffect(() => {
    const u = subscribeInvoiceSettings(d => setSettings(d || {}));
    return () => u && u();
  }, []);

  // Alanlar — invoice'tan hydrate
  const [invoiceDate, setInvoiceDate] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerCountry, setCustomerCountry] = useState("");
  const [orderNr, setOrderNr] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [deliveryTermsShort, setDeliveryTermsShort] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [paymentPlan, setPaymentPlan] = useState([{ label: "", pct: 100 }]);
  const [lines, setLines] = useState([]);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [savedOk, setSavedOk] = useState(false);

  const bankAccounts = useMemo(() => {
    const list = Array.isArray(settings?.bankAccounts) ? settings.bankAccounts : [];
    if (list.length === 0 && settings?.bankInfo) {
      return [{ id: "legacy_1", label: "Ana Hesap", ...settings.bankInfo, isDefault: true }];
    }
    return list;
  }, [settings]);

  useEffect(() => {
    if (!invoice) return;
    setInvoiceDate(invoice.invoiceDate || "");
    setCustomerCode(invoice.customerCode || "");
    setCustomerName(invoice.customerName || "");
    setCustomerAddress(invoice.customerAddress || "");
    setCustomerCity(invoice.customerCity || "");
    setCustomerCountry(invoice.customerCountry || "");
    setOrderNr(invoice.orderNr || "");
    setDeliveryTerms(invoice.deliveryTerms || "");
    setDeliveryTermsShort(invoice.deliveryTermsShort || "");
    setCurrency(invoice.currency || "EUR");
    setPaymentPlan(Array.isArray(invoice.paymentPlan) && invoice.paymentPlan.length > 0
      ? invoice.paymentPlan.map(p => ({ label: p.label || "", pct: Number(p.pct) || 0 }))
      : [{ label: "", pct: 100 }]);
    setLines(Array.isArray(invoice.lines)
      ? invoice.lines.map(l => ({
          description: l.description || "",
          qty: Number(l.qty) || 0,
          unit: l.unit || "AD",
          unitPrice: Number(l.unitPrice) || 0,
          amount: (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
          isExtra: !!l.isExtra,
          sourceOrderId: l.sourceOrderId || null,
          sourceContainerAllocKey: l.sourceContainerAllocKey || null,
        }))
      : []);
    setSelectedBankId(invoice.bankAccount?.id || "");
  }, [invoice]);

  // İlk banka default'a düş
  useEffect(() => {
    if (!selectedBankId && bankAccounts.length > 0) {
      const def = bankAccounts.find(a => a.isDefault) || bankAccounts[0];
      setSelectedBankId(def.id);
    }
  }, [bankAccounts, selectedBankId]);

  // Kalem güncelleme
  const updateLine = (idx, field, value) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, [field]: (field === "description" || field === "unit") ? value : (Number(value) || 0) };
      next.amount = (Number(next.qty) || 0) * (Number(next.unitPrice) || 0);
      return next;
    }));
  };
  const addLine = () => setLines(prev => [...prev, { description: "", qty: 1, unit: "AD", unitPrice: 0, amount: 0, isExtra: true }]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));

  // Ödeme planı satırları
  const updatePlanRow = (i, key, val) => setPaymentPlan(prev => prev.map((p, idx) => idx === i ? { ...p, [key]: key === "pct" ? Number(val) || 0 : val } : p));
  const addPlanRow = () => setPaymentPlan(prev => [...prev, { label: "", pct: 0 }]);
  const removePlanRow = (i) => setPaymentPlan(prev => prev.filter((_, idx) => idx !== i));

  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0), [lines]);

  const isCancelled = (invoice?.status || "issued") === "cancelled";

  const handleSave = async () => {
    if (!canEdit) return;
    if (isCancelled) { setError("İptal edilmiş fatura düzenlenemez"); return; }
    if (!customerName.trim()) { setError("Müşteri adı zorunlu"); return; }
    if (lines.length === 0) { setError("En az bir kalem gerekli"); return; }
    const bank = bankAccounts.find(a => a.id === selectedBankId);
    if (!bank) { setError("Banka hesabı seçilmedi"); return; }
    setProcessing(true);
    setError("");
    try {
      const updated = {
        ...invoice, // linkedOrderIds, containerId, year, source vs. korunsun
        invoiceNo: invoice.invoiceNo, // sabit
        invoiceDate: invoiceDate || invoice.invoiceDate,
        customerCode: customerCode.trim(),
        customerName: customerName.trim(),
        customerAddress: customerAddress.trim(),
        customerCity: customerCity.trim(),
        customerCountry: customerCountry.trim(),
        orderNr: orderNr.trim(),
        deliveryTerms: deliveryTerms.trim(),
        deliveryTermsShort: deliveryTermsShort.trim(),
        currency,
        paymentPlan: paymentPlan.filter(p => (p.label || "").trim() || Number(p.pct) > 0),
        lines: lines.map(l => ({
          description: l.description,
          qty: Number(l.qty) || 0,
          unit: l.unit || "AD",
          unitPrice: Number(l.unitPrice) || 0,
          amount: (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
          ...(l.isExtra ? { isExtra: true } : {}),
          ...(l.sourceOrderId ? { sourceOrderId: l.sourceOrderId } : {}),
          ...(l.sourceContainerAllocKey ? { sourceContainerAllocKey: l.sourceContainerAllocKey } : {}),
        })),
        totalAmount,
        bankAccount: {
          id: bank.id,
          label: bank.label,
          branchName: bank.branchName,
          iban: bank.iban,
          swift: bank.swift,
          currency: bank.currency,
        },
      };
      const saved = await saveExportInvoice(updated, { canEdit, userEmail });
      setSavedOk(true);
      onSaved && onSaved(saved);
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveAndPdf = async () => {
    await handleSave();
    if (!error) {
      try {
        // handleSave sonrası state'i güncel yapıyla PDF üret
        const bank = bankAccounts.find(a => a.id === selectedBankId);
        const invForPdf = {
          ...invoice,
          invoiceDate, customerCode, customerName, customerAddress, customerCity, customerCountry,
          orderNr, deliveryTerms, deliveryTermsShort, currency,
          paymentPlan: paymentPlan.filter(p => (p.label || "").trim() || Number(p.pct) > 0),
          lines, totalAmount,
          bankAccount: bank ? { id: bank.id, label: bank.label, branchName: bank.branchName, iban: bank.iban, swift: bank.swift, currency: bank.currency } : invoice.bankAccount,
        };
        await generateInvoicePdf(invForPdf, settings);
      } catch (pdfErr) {
        console.warn("PDF üretilemedi:", pdfErr.message);
      }
    }
  };

  if (!invoice) return null;

  return (
    <div style={modalBg} onClick={() => !processing && onClose && onClose()}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>✏ Fatura Düzenle — {invoice.invoiceNo}</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              Oluşturulma: {invoice.createdAt ? new Date(invoice.createdAt).toLocaleString("tr-TR") : "—"}
              {invoice.updatedAt && invoice.updatedAt !== invoice.createdAt && (
                <> · Son güncelleme: {new Date(invoice.updatedAt).toLocaleString("tr-TR")}</>
              )}
            </div>
          </div>
          <button onClick={onClose} disabled={processing} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {isCancelled && (
          <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
            🚫 Bu fatura iptal edilmiş (VOID) — düzenleme kapalı
          </div>
        )}
        {error && <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}
        {savedOk && <div style={{ padding: 8, marginBottom: 8, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, fontSize: 11 }}>✓ Kaydedildi</div>}

        {/* Müşteri */}
        <Section title="Müşteri">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Müşteri Kodu">
              <input value={customerCode} onChange={e => setCustomerCode(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
            <Field label="Müşteri Adı *">
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
          </div>
          <Field label="Adres">
            <input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} style={inp} disabled={isCancelled} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Şehir">
              <input value={customerCity} onChange={e => setCustomerCity(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
            <Field label="Ülke">
              <input value={customerCountry} onChange={e => setCustomerCountry(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
          </div>
        </Section>

        {/* Fatura başlığı */}
        <Section title="Fatura Bilgisi">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Field label="Tarih">
              <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
            <Field label="ORDER NR.">
              <input value={orderNr} onChange={e => setOrderNr(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
            <Field label="Para Birimi">
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...inp, background: "#fff" }} disabled={isCancelled}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Teslim Şekli (uzun)">
              <input value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
            <Field label="Teslim Kısaltma (TOTAL yanında)">
              <input value={deliveryTermsShort} onChange={e => setDeliveryTermsShort(e.target.value)} style={inp} disabled={isCancelled} />
            </Field>
          </div>
        </Section>

        {/* Banka */}
        <Section title="Banka Hesabı">
          <select value={selectedBankId} onChange={e => setSelectedBankId(e.target.value)}
            style={{ padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, minWidth: 240 }} disabled={isCancelled}>
            <option value="">— seç —</option>
            {bankAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.label} ({a.currency}) {a.isDefault ? "— default" : ""}</option>
            ))}
          </select>
        </Section>

        {/* Kalemler */}
        <Section title={`Kalemler (${lines.length})`}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "#f5f5f4" }}>
              <tr>
                <th style={{ ...th, minWidth: 200 }}>Description</th>
                <th style={{ ...th, textAlign: "right", width: 70 }}>Qty</th>
                <th style={{ ...th, width: 50 }}>UM</th>
                <th style={{ ...th, textAlign: "right", width: 90 }}>Unit Price</th>
                <th style={{ ...th, textAlign: "right", width: 100 }}>Amount</th>
                <th style={{ ...th, width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={td}>
                    <input value={l.description} onChange={e => updateLine(i, "description", e.target.value)} style={inp} disabled={isCancelled} />
                  </td>
                  <td style={td}>
                    <input type="number" step="0.01" value={l.qty} onChange={e => updateLine(i, "qty", e.target.value)} style={{ ...inp, textAlign: "right" }} disabled={isCancelled} />
                  </td>
                  <td style={td}>
                    <input value={l.unit} onChange={e => updateLine(i, "unit", e.target.value)} style={inp} disabled={isCancelled} />
                  </td>
                  <td style={td}>
                    <input type="number" step="0.01" value={l.unitPrice} onChange={e => updateLine(i, "unitPrice", e.target.value)} style={{ ...inp, textAlign: "right" }} disabled={isCancelled} />
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                    {Number(l.amount).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={td}>
                    <button onClick={() => removeLine(i)} disabled={isCancelled}
                      style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: isCancelled ? "not-allowed" : "pointer" }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #d6d3d1", background: "#fafaf9" }}>
                <td style={{ ...td, fontWeight: 600 }} colSpan={4}>TOPLAM ({currency})</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 12 }}>
                  {totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td style={td}></td>
              </tr>
            </tfoot>
          </table>
          <button onClick={addLine} disabled={isCancelled}
            style={{ marginTop: 6, padding: "4px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: isCancelled ? "not-allowed" : "pointer" }}>
            + Kalem Ekle
          </button>
        </Section>

        {/* Ödeme planı */}
        <Section title="Ödeme Planı">
          {paymentPlan.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 80px 30px", gap: 6, marginBottom: 4, alignItems: "center" }}>
              <input value={p.label} onChange={e => updatePlanRow(i, "label", e.target.value)}
                placeholder="Örn. IN ADVANCE WITH ORDER" style={inp} disabled={isCancelled} />
              <input type="number" step="0.1" value={p.pct} onChange={e => updatePlanRow(i, "pct", e.target.value)}
                placeholder="%" style={{ ...inp, textAlign: "right" }} disabled={isCancelled} />
              <button onClick={() => removePlanRow(i)} disabled={paymentPlan.length <= 1 || isCancelled}
                style={{ padding: "3px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: (paymentPlan.length > 1 && !isCancelled) ? "pointer" : "not-allowed", opacity: (paymentPlan.length > 1 && !isCancelled) ? 1 : 0.5 }}>🗑</button>
            </div>
          ))}
          <button onClick={addPlanRow} disabled={isCancelled}
            style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: isCancelled ? "not-allowed" : "pointer" }}>
            + Ödeme Satırı Ekle
          </button>
        </Section>

        {/* Kaydet */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14, borderTop: "1px solid #e7e5e4", paddingTop: 10 }}>
          <button onClick={onClose} disabled={processing}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Kapat
          </button>
          <button onClick={handleSave} disabled={processing || !canEdit || isCancelled}
            style={{ padding: "6px 14px", fontSize: 12, background: (canEdit && !isCancelled) ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (processing || !canEdit || isCancelled) ? "not-allowed" : "pointer", fontWeight: 500 }}>
            {processing ? "Kaydediliyor…" : "💾 Kaydet"}
          </button>
          <button onClick={handleSaveAndPdf} disabled={processing || !canEdit || isCancelled}
            style={{ padding: "6px 14px", fontSize: 12, background: (canEdit && !isCancelled) ? "#1e40af" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (processing || !canEdit || isCancelled) ? "not-allowed" : "pointer", fontWeight: 500 }}>
            💾 Kaydet + 📄 PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px dashed #e7e5e4" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#44403c", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const modalBg = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};
const modalBox = {
  background: "#fff", borderRadius: 8, padding: 16,
  width: "100%", maxWidth: 900, maxHeight: "92vh", overflow: "auto",
};
const inp = { width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "4px 6px", fontSize: 11, verticalAlign: "middle" };
