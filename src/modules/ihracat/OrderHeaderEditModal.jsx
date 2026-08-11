// Sipariş header düzenleme modal'ı — bir belge no'daki TÜM kalemlere
// aynı teslim şekli / ödeme planı / currency / opsiyonel termin yazar.
//
// Kullanım: OrderList grup satırının "✏ Siparişi Düzenle" butonundan açılır.
// Data modeli değişmez (her kalem yine ayrı Firestore doc); sadece header
// alanları toplu güncellenir.

import React, { useState, useEffect } from "react";
import {
  bulkUpdateOrdersByBelge, addDeliveryTerm, addPaymentLabel,
  savePaymentPlanTemplate, deletePaymentPlanTemplate,
} from "./firestore";
import { validatePaymentPlan } from "./allocationCalc";

const CURRENCIES = ["EUR", "USD", "TL", "GBP"];

export default function OrderHeaderEditModal({
  group,           // { customerCode, customerName, belgeNo, items: [order], ... }
  settings,        // exportSettings — deliveryTermsList, paymentLabels, paymentPlanTemplates
  canEdit,
  userEmail,
  onClose,
  onSaved,
}) {
  const firstItem = group?.items?.[0] || {};
  const [deliveryTerms, setDeliveryTerms] = useState(firstItem.deliveryTerms || "");
  const [paymentPlan, setPaymentPlan] = useState(
    Array.isArray(firstItem.paymentPlan) && firstItem.paymentPlan.length > 0
      ? firstItem.paymentPlan
      : [{ label: "", pct: 100 }]
  );
  const [currency, setCurrency] = useState(firstItem.currency || "EUR");
  // Termin toplu uygulanır sadece seçilirse
  const [applyTermin, setApplyTermin] = useState(false);
  const [teslimTarihi, setTeslimTarihi] = useState(firstItem.teslimTarihi || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [saveTemplateName, setSaveTemplateName] = useState("");

  const deliveryTermsList = Array.isArray(settings?.deliveryTermsList) ? settings.deliveryTermsList : [];
  const paymentLabels = Array.isArray(settings?.paymentLabels) ? settings.paymentLabels : [];
  const templates = Array.isArray(settings?.paymentPlanTemplates) ? settings.paymentPlanTemplates : [];

  const paymentValidation = validatePaymentPlan(paymentPlan);

  const addPlanRow = () => setPaymentPlan([...paymentPlan, { label: "", pct: 0 }]);
  const removePlanRow = (i) => setPaymentPlan(paymentPlan.filter((_, idx) => idx !== i));
  const updatePlanRow = (i, key, val) => setPaymentPlan(paymentPlan.map((p, idx) => idx === i ? { ...p, [key]: key === "pct" ? Number(val) || 0 : val } : p));

  const applyTemplate = (name) => {
    setSelectedTemplate(name);
    const tpl = templates.find(t => t.name === name);
    if (tpl && Array.isArray(tpl.plan)) {
      setPaymentPlan(tpl.plan.map(p => ({ ...p })));
    }
  };

  const handleSaveTemplate = async () => {
    if (!saveTemplateName.trim()) { alert("Şablon adı gir"); return; }
    const validPlan = paymentPlan.filter(p => (p.label || "").trim() || Number(p.pct) > 0);
    if (validPlan.length === 0) { alert("Boş plan şablon olarak kaydedilemez"); return; }
    try {
      await savePaymentPlanTemplate(saveTemplateName, validPlan, { canEdit, userEmail });
      alert("✓ Şablon kaydedildi: " + saveTemplateName);
      setSaveTemplateName("");
    } catch (e) {
      alert("Şablon kaydedilemedi: " + e.message);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return;
    if (!confirm(`"${selectedTemplate}" şablonunu sil?`)) return;
    try {
      await deletePaymentPlanTemplate(selectedTemplate, { canEdit, userEmail });
      setSelectedTemplate("");
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      const cleanPlan = paymentPlan.filter(p => (p.label || "").trim() || Number(p.pct) > 0);
      const patch = {
        deliveryTerms: deliveryTerms.trim(),
        paymentPlan: cleanPlan,
        currency,
      };
      if (applyTermin && teslimTarihi) patch.teslimTarihi = teslimTarihi;
      const res = await bulkUpdateOrdersByBelge({
        customerCode: group.customerCode,
        belgeNo: group.belgeNo,
        patch,
      }, { canEdit, userEmail });
      // Havuza öğret
      if (deliveryTerms.trim()) await addDeliveryTerm(deliveryTerms, { canEdit, userEmail });
      for (const p of cleanPlan) {
        if (p.label?.trim()) await addPaymentLabel(p.label, { canEdit, userEmail });
      }
      alert(`✓ ${res.updated} kalem güncellendi`);
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBg} onClick={() => !saving && onClose && onClose()}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        {/* Başlık */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>✏ Sipariş Düzenle</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              {group.customerName} · Belge #{group.belgeNo} · {group.items.length} kalem
            </div>
          </div>
          <button onClick={onClose} disabled={saving} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {error && <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}

        {/* Teslim Şekli — datalist ile öneri */}
        <Field label="Teslim Şekli">
          <input list="ih-delivery-terms" value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)}
            placeholder="Örn. DDP / TREZZO SULL / ADDA (MI)"
            style={inp} />
          <datalist id="ih-delivery-terms">
            {deliveryTermsList.map(t => <option key={t} value={t} />)}
          </datalist>
          {deliveryTermsList.length > 0 && (
            <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>
              💡 Kayıtlı teslim şekillerinden seçebilirsin ({deliveryTermsList.length})
            </div>
          )}
        </Field>

        {/* Currency */}
        <Field label="Para Birimi">
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...inp, background: "#fff" }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>

        {/* Ödeme Planı — şablon dropdown + serbest satırlar */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            Ödeme Planı
            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 500,
              color: paymentValidation.valid ? "#166534" : "#92400e" }}>
              Toplam: %{paymentValidation.total}
              {paymentValidation.warning && <> · ⚠ {paymentValidation.warning}</>}
            </span>
          </div>

          {/* Şablon seçici */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 10, color: "#78716c" }}>Şablondan yükle:</label>
            <select value={selectedTemplate} onChange={e => e.target.value ? applyTemplate(e.target.value) : setSelectedTemplate("")}
              style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3 }}>
              <option value="">— seç —</option>
              {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            {selectedTemplate && (
              <button onClick={handleDeleteTemplate}
                title="Bu şablonu sil"
                style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }}>
                🗑
              </button>
            )}
            <div style={{ borderLeft: "1px solid #d6d3d1", height: 18, margin: "0 4px" }} />
            <input value={saveTemplateName} onChange={e => setSaveTemplateName(e.target.value)}
              placeholder="Yeni şablon adı..." style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, width: 140 }} />
            <button onClick={handleSaveTemplate}
              title="Mevcut planı bu isimle şablon olarak kaydet"
              style={{ padding: "3px 8px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
              💾 Şablon kaydet
            </button>
          </div>

          {/* Plan satırları */}
          {paymentPlan.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 80px 30px", gap: 6, marginBottom: 4, alignItems: "center" }}>
              <input list="ih-payment-labels" value={p.label} onChange={e => updatePlanRow(i, "label", e.target.value)}
                placeholder="Örn. IN ADVANCE WITH ORDER" style={inp} />
              <input type="number" step="0.1" value={p.pct} onChange={e => updatePlanRow(i, "pct", e.target.value)}
                placeholder="%" style={{ ...inp, textAlign: "right" }} />
              <button onClick={() => removePlanRow(i)} disabled={paymentPlan.length <= 1}
                style={{ padding: "3px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: paymentPlan.length > 1 ? "pointer" : "not-allowed", opacity: paymentPlan.length > 1 ? 1 : 0.5 }}>🗑</button>
            </div>
          ))}
          <datalist id="ih-payment-labels">
            {paymentLabels.map(l => <option key={l} value={l} />)}
          </datalist>
          <button onClick={addPlanRow}
            style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
            + Ödeme Satırı Ekle
          </button>
        </div>

        {/* Termin toplu uygulanabilir */}
        <div style={{ marginBottom: 12, padding: 8, background: "#fafaf9", border: "1px dashed #d6d3d1", borderRadius: 4 }}>
          <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={applyTermin} onChange={e => setApplyTermin(e.target.checked)} />
            <b>Termini de topluca güncelle</b> — tüm kalemlere aynı tarih uygulanır
          </label>
          {applyTermin && (
            <input type="date" value={teslimTarihi} onChange={e => setTeslimTarihi(e.target.value)}
              style={{ ...inp, marginTop: 4 }} />
          )}
        </div>

        {/* Kaydet */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Vazgeç
          </button>
          <button onClick={handleSave} disabled={saving || !canEdit}
            style={{ padding: "6px 14px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "wait" : "pointer", fontWeight: 500 }}>
            {saving ? "Kaydediliyor…" : `💾 ${group.items.length} Kalemi Güncelle`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.15)" };
