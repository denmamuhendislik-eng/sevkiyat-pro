// Order Confirmation Form Modal
// Müşteri PDF üretmeden önce açılır — bilgi + teklif şartları girişi.
// Değerler taslak Firestore'a saklanır (pdfSettings alanı), sonraki sefer default gelir.

import React, { useState } from "react";

export default function OrderConfirmationFormModal({
  initial,       // taslaktan gelen pdfSettings (varsa)
  currency,      // taslak currency'si
  itemCount,     // adet > 0 kalem sayısı
  grandTotal,    // toplam bedel (aktif currency'de)
  fmtMoney,      // format helper — sayı görüntüsü için
  customerOptions = [], // ihracat müşteri listesi (opsiyonel)
  onCancel,
  onSubmit,      // (settings) => void
}) {
  // Belge No default: OFR-YYMMDD-NNN
  const defaultDocNo = (() => {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900 + 100);
    return `OFR-${yy}${mm}${dd}-${rand}`;
  })();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [docNo, setDocNo] = useState(initial?.docNo || defaultDocNo);
  const [docDate, setDocDate] = useState(initial?.docDate || todayIso);
  const [validityDays, setValidityDays] = useState(initial?.validityDays || 30);
  const [customerName, setCustomerName] = useState(initial?.customerName || "");
  const [customerAttention, setCustomerAttention] = useState(initial?.customerAttention || "");
  const [customerAddress, setCustomerAddress] = useState(initial?.customerAddress || "");
  const [customerCity, setCustomerCity] = useState(initial?.customerCity || "");
  const [customerCountry, setCustomerCountry] = useState(initial?.customerCountry || "");
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");
  const [payment, setPayment] = useState(initial?.payment || "");
  const [delivery, setDelivery] = useState(initial?.delivery || "");
  const [deliveryTime, setDeliveryTime] = useState(initial?.deliveryTime || "");
  const [packing, setPacking] = useState(initial?.packing || "");
  const [shipping, setShipping] = useState(initial?.shipping || "");
  const [notes, setNotes] = useState(initial?.notes || "");

  const canSubmit = customerName.trim() && docNo.trim() && docDate;

  const handleCustomerPick = (code) => {
    setSelectedCustomerCode(code);
    if (!code) return; // "manuel giriş" seçildi → alanları temizleme, kullanıcı düzenlesin
    const c = customerOptions.find(x => x.code === code);
    if (!c) return;
    setCustomerName(c.name || "");
    setCustomerAddress(c.address || "");
    setCustomerCity(c.city || "");
    setCustomerCountry(c.country || "");
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      docNo: docNo.trim(),
      docDate,
      validityDays: Number(validityDays) || 0,
      customerName: customerName.trim(),
      customerAttention: customerAttention.trim(),
      customerAddress: customerAddress.trim(),
      customerCity: customerCity.trim(),
      customerCountry: customerCountry.trim(),
      payment: payment.trim(),
      delivery: delivery.trim(),
      deliveryTime: deliveryTime.trim(),
      packing: packing.trim(),
      shipping: shipping.trim(),
      notes: notes.trim(),
    });
  };

  return (
    <div style={modalBg} onClick={onCancel}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#166534" }}>📄 Order Confirmation Form</div>
            <div style={{ fontSize: 10, color: "#78716c", marginTop: 2 }}>
              {itemCount} kalem · Toplam: {fmtMoney(grandTotal)} · {currency}
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <Section title="Doküman Bilgisi">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <Field label="Belge / Ref. No *">
              <input value={docNo} onChange={e => setDocNo(e.target.value)}
                placeholder="OFR-YYMMDD-NNN" style={inp} />
            </Field>
            <Field label="Tarih *">
              <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} style={inp} />
            </Field>
            <Field label="Geçerlilik (gün)">
              <input type="number" min="1" value={validityDays} onChange={e => setValidityDays(e.target.value)} style={inp} />
            </Field>
          </div>
        </Section>

        <Section title="Müşteri Bilgisi">
          {customerOptions.length > 0 && (
            <Field label={`🔍 Kayıtlı müşteriden seç (${customerOptions.length} müşteri) — veya boş bırakıp elle yazın`}>
              <select value={selectedCustomerCode} onChange={e => handleCustomerPick(e.target.value)} style={inp}>
                <option value="">— Manuel giriş —</option>
                {customerOptions.map(c => (
                  <option key={c.code} value={c.code}>{c.name} {c.city ? `· ${c.city}` : ""} {c.country ? `· ${c.country}` : ""}</option>
                ))}
              </select>
            </Field>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
            <Field label="Firma Adı *">
              <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="Company Name" style={inp} />
            </Field>
            <Field label="Attention (İlgili Kişi)">
              <input value={customerAttention} onChange={e => setCustomerAttention(e.target.value)}
                placeholder="Mr./Ms. ..." style={inp} />
            </Field>
          </div>
          <Field label="Adres">
            <textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)}
              rows={2} placeholder="Street, No, Postcode" style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Şehir">
              <input value={customerCity} onChange={e => setCustomerCity(e.target.value)} style={inp} />
            </Field>
            <Field label="Ülke">
              <input value={customerCountry} onChange={e => setCustomerCountry(e.target.value)} style={inp} />
            </Field>
          </div>
        </Section>

        <Section title="Teklif Şartları — Terms & Conditions">
          <Field label="Payment Terms (Ödeme Şekli)">
            <input value={payment} onChange={e => setPayment(e.target.value)}
              placeholder="Örn: %50 in advance with order, %50 with delivery" style={inp} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Delivery Terms (Teslim Şekli)">
              <input value={delivery} onChange={e => setDelivery(e.target.value)}
                placeholder="Örn: EXW / FOB / CIF ..." style={inp} />
            </Field>
            <Field label="Delivery Time (Teslim Süresi)">
              <input value={deliveryTime} onChange={e => setDeliveryTime(e.target.value)}
                placeholder="Örn: 60-90 iş günü" style={inp} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Packing (Ambalaj)">
              <input value={packing} onChange={e => setPacking(e.target.value)}
                placeholder="Örn: Ahşap palet, streç film" style={inp} />
            </Field>
            <Field label="Shipping (Nakliye)">
              <input value={shipping} onChange={e => setShipping(e.target.value)}
                placeholder="Örn: Konteyner, karayolu" style={inp} />
            </Field>
          </div>
          <Field label="Notlar / Ek Açıklama">
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} placeholder="Serbest metin — teklifle ilgili ek bilgi"
              style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
          </Field>
        </Section>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12, paddingTop: 10, borderTop: "1px solid #e7e5e4" }}>
          <button onClick={onCancel}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Vazgeç
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            style={{ padding: "6px 16px", fontSize: 12, background: canSubmit ? "#166534" : "#a8a29e",
              color: "#fff", border: "none", borderRadius: 4, cursor: canSubmit ? "pointer" : "not-allowed",
              fontWeight: 600 }}>
            📄 PDF Üret
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14, paddingBottom: 8, borderBottom: "1px dashed #e7e5e4" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#44403c", marginBottom: 6 }}>{title}</div>
      {children}
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

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1050, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 780, maxHeight: "94vh", overflow: "auto" };
const inp = { width: "100%", padding: "6px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
