// İhracat Sipariş Formu — yeni giriş / düzenleme
// Müşteri seçince (customerDefaults) currency + paymentPlan önerileri yüklenir.
// Ödeme planı satırları serbestçe ekle/çıkar, label + pct.

import React, { useState, useEffect, useMemo } from "react";
import { saveExportOrder, addPaymentLabel, saveCustomerDefaults, addDeliveryTerm } from "./firestore";
import { validatePaymentPlan } from "./allocationCalc";

const CURRENCIES = ["EUR", "USD", "TL", "GBP"];

function buildId(belgeNo, stokKodu, teslimTarihi) {
  const key = (teslimTarihi || "").trim() || "notarih";
  return `${String(belgeNo || "").trim()}_${String(stokKodu || "").trim()}_${key}`;
}

export default function OrderForm({ editingOrder, settings, products, canEdit, userEmail, onSaved, onCancel, motorSync, combRules = [], ordersData }) {
  // Alanlar
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerCountry, setCustomerCountry] = useState("");
  const [belgeNo, setBelgeNo] = useState("");
  const [stokKodu, setStokKodu] = useState("");
  const [stokAdi, setStokAdi] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [pid, setPid] = useState(null);
  const [orijinalMiktar, setOrijinalMiktar] = useState("");
  const [sevkedilenBaslangic, setSevkedilenBaslangic] = useState(""); // opsiyonel — Excel import'ta dolu, manuel'de 0
  const [birimFiyat, setBirimFiyat] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [teslimTarihi, setTeslimTarihi] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [paymentPlan, setPaymentPlan] = useState([{ label: "", pct: 100 }]);
  const [status, setStatus] = useState("open");
  const [saveDefaultsForCustomer, setSaveDefaultsForCustomer] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Düzenleme modunda alanları doldur
  useEffect(() => {
    if (editingOrder) {
      setCustomerCode(editingOrder.customerCode || "");
      setCustomerName(editingOrder.customerName || "");
      setCustomerAddress(editingOrder.customerAddress || "");
      setCustomerCity(editingOrder.customerCity || "");
      setCustomerCountry(editingOrder.customerCountry || "");
      setBelgeNo(editingOrder.belgeNo || "");
      setStokKodu(editingOrder.stokKodu || "");
      setStokAdi(editingOrder.stokAdi || "");
      setDescriptionEn(editingOrder.descriptionEn || "");
      setPid(editingOrder.pid != null ? editingOrder.pid : null);
      setOrijinalMiktar(String(editingOrder.orijinalMiktar || ""));
      setSevkedilenBaslangic(String(editingOrder.sevkedilenBaslangic || ""));
      setBirimFiyat(String(editingOrder.birimFiyat || ""));
      setCurrency(editingOrder.currency || "EUR");
      setTeslimTarihi(editingOrder.teslimTarihi || "");
      setDeliveryTerms(editingOrder.deliveryTerms || "");
      setPaymentPlan(Array.isArray(editingOrder.paymentPlan) && editingOrder.paymentPlan.length > 0 ? editingOrder.paymentPlan : [{ label: "", pct: 100 }]);
      setStatus(editingOrder.status || "open");
    } else {
      // Yeni form — temiz başlat
      setCustomerCode(""); setCustomerName("");
      setCustomerAddress(""); setCustomerCity(""); setCustomerCountry("");
      setBelgeNo(""); setStokKodu(""); setStokAdi("");
      setDescriptionEn(""); setPid(null); setOrijinalMiktar(""); setSevkedilenBaslangic("");
      setBirimFiyat(""); setCurrency("EUR"); setTeslimTarihi(""); setDeliveryTerms("");
      setPaymentPlan([{ label: "", pct: 100 }]); setStatus("open");
    }
    setError("");
  }, [editingOrder]);

  // Müşteri seçilince default'ları yükle (yeni sipariş için)
  const customerDefaults = settings?.customerDefaults || {};
  const applyCustomerDefaults = (code, name) => {
    setCustomerCode(code);
    setCustomerName(name);
    if (!editingOrder) {
      const d = customerDefaults[code];
      if (d) {
        if (d.currency) setCurrency(d.currency);
        if (Array.isArray(d.paymentPlan) && d.paymentPlan.length > 0) setPaymentPlan(d.paymentPlan);
        if (d.address) setCustomerAddress(d.address);
        if (d.city) setCustomerCity(d.city);
        if (d.country) setCustomerCountry(d.country);
        if (d.deliveryTerms) setDeliveryTerms(d.deliveryTerms);
      }
    }
  };

  // Bilinen müşteri listesi (mevcut ihracat siparişlerinden + customerDefaults'tan)
  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const [code, d] of Object.entries(customerDefaults)) {
      map.set(code, d.customerName || code);
    }
    return Array.from(map, ([code, name]) => ({ code, name }));
  }, [customerDefaults]);

  // Ürün seçici — products.vioCode ile eşleşme (fiyat auto-fill aşağıda useEffect'te)
  const applyProductByCode = (code) => {
    setStokKodu(code);
    const found = (products || []).find(p => p.vioCode === code);
    if (found) {
      setPid(found.id);
      setStokAdi(found.nameTR || "");
      if (!descriptionEn && found.nameEN) setDescriptionEn(found.nameEN);
    }
  };

  // Fiyat auto-fill: aynı customerCode + aynı pid için önceki siparişin birim fiyatı
  // Sadece yeni sipariş modunda ve alan boşsa doldurur (elle girdiğin değeri ezmez)
  useEffect(() => {
    if (editingOrder) return;
    if (!customerCode || pid == null) return;
    if (birimFiyat) return; // elle girildi, dokunma
    const prior = Object.values(ordersData?.orders || {})
      .filter(o => o.customerCode === customerCode && Number(o.pid) === Number(pid) && Number(o.birimFiyat) > 0)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0];
    if (prior) {
      setBirimFiyat(String(prior.birimFiyat || ""));
      if (prior.currency) setCurrency(prior.currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerCode, pid, ordersData]);

  // Cascade preview — pid seçilince combRules'e göre bağlı child ürünleri liste olarak göster
  const cascadeChildren = useMemo(() => {
    if (pid == null) return [];
    const rules = (combRules || []).filter(r => Number(r.parent) === Number(pid));
    if (rules.length === 0) return [];
    const childIds = [...new Set(rules.flatMap(r => (r.children || []).map(Number)))];
    return childIds.map(cid => {
      const cp = (products || []).find(p => Number(p.id) === cid);
      return {
        pid: cid,
        vioCode: cp?.vioCode || "",
        nameTR: cp?.nameTR || `pid ${cid}`,
      };
    });
  }, [pid, combRules, products]);

  // Ödeme planı satırları
  const addPlanRow = () => setPaymentPlan([...paymentPlan, { label: "", pct: 0 }]);
  const removePlanRow = (i) => setPaymentPlan(paymentPlan.filter((_, idx) => idx !== i));
  const updatePlanRow = (i, key, val) => setPaymentPlan(paymentPlan.map((p, idx) => idx === i ? { ...p, [key]: key === "pct" ? Number(val) || 0 : val } : p));

  const paymentValidation = validatePaymentPlan(paymentPlan);

  const canSave = customerCode && belgeNo && stokKodu && Number(orijinalMiktar) > 0;

  const handleSave = async () => {
    if (!canSave) { setError("Müşteri, belge no, stok kodu ve miktar zorunlu"); return; }
    setSaving(true);
    setError("");
    try {
      const id = buildId(belgeNo, stokKodu, teslimTarihi);
      const payload = {
        id,
        customerCode: customerCode.trim(),
        customerName: customerName.trim(),
        customerAddress: customerAddress.trim(),
        customerCity: customerCity.trim(),
        customerCountry: customerCountry.trim(),
        belgeNo: String(belgeNo).trim(),
        stokKodu: stokKodu.trim(),
        stokAdi: stokAdi.trim(),
        descriptionEn: descriptionEn.trim(),
        pid: pid != null ? Number(pid) : null,
        orijinalMiktar: Number(orijinalMiktar) || 0,
        sevkedilenBaslangic: Number(sevkedilenBaslangic) || 0,
        birimFiyat: Number(birimFiyat) || 0,
        currency,
        teslimTarihi: teslimTarihi || "",
        deliveryTerms: deliveryTerms.trim(),
        paymentPlan: paymentPlan.filter(p => (p.label || "").trim() || (Number(p.pct) || 0) > 0),
        status,
        source: editingOrder?.source || "manual",
      };
      await saveExportOrder(payload, { canEdit, userEmail });
      // Motor sync — Sevkiyat Planı'na delta uygula
      // Destekler: yeni sipariş, miktar güncelleme, iptal ↔ aktifleştirme,
      //            pid değişimi (stokKodu değişince), yıl değişimi (teslim tarihi değişince)
      if (motorSync?.enabled && motorSync.apply) {
        const wasActive = editingOrder ? (editingOrder.status || "open") !== "cancelled" : false;
        const isActive = (payload.status || "open") !== "cancelled";
        // Eski state
        const oldPid = editingOrder ? editingOrder.pid : null;
        const oldYear = editingOrder && editingOrder.teslimTarihi
          ? Number(String(editingOrder.teslimTarihi).slice(0, 4))
          : null;
        const oldNet = (editingOrder && wasActive)
          ? Math.max(0, (Number(editingOrder.orijinalMiktar) || 0) - (Number(editingOrder.sevkedilenBaslangic) || 0))
          : 0;
        // Yeni state
        const newPid = payload.pid;
        const newYear = payload.teslimTarihi
          ? Number(String(payload.teslimTarihi).slice(0, 4))
          : new Date().getFullYear();
        const newNet = isActive
          ? Math.max(0, (Number(payload.orijinalMiktar) || 0) - (Number(payload.sevkedilenBaslangic) || 0))
          : 0;
        const validYear = (y) => Number.isFinite(y) && y > 2020;
        const samePidYear = oldPid != null && newPid != null
          && Number(oldPid) === Number(newPid)
          && oldYear != null && Number(oldYear) === Number(newYear);
        if (samePidYear) {
          const delta = newNet - oldNet;
          if (delta !== 0 && validYear(newYear)) {
            motorSync.apply({ pid: newPid, deltaQty: delta, year: newYear, cascade: true });
          }
        } else {
          // Farklı pid veya yıl: eski yerden düş, yeni yere ekle
          if (oldPid != null && oldNet > 0 && validYear(oldYear)) {
            motorSync.apply({ pid: oldPid, deltaQty: -oldNet, year: oldYear, cascade: true });
          }
          if (newPid != null && newNet > 0 && validYear(newYear)) {
            motorSync.apply({ pid: newPid, deltaQty: +newNet, year: newYear, cascade: true });
          }
        }
      }
      // Teslim şekli + ödeme etiketleri havuzuna ekle
      if (payload.deliveryTerms) await addDeliveryTerm(payload.deliveryTerms, { canEdit, userEmail });
      for (const p of payload.paymentPlan) {
        if (p.label?.trim()) await addPaymentLabel(p.label, { canEdit, userEmail });
      }
      // Müşteri default'larını güncelle (checkbox açıksa)
      if (saveDefaultsForCustomer && customerCode) {
        const existing = customerDefaults[customerCode] || {};
        await saveCustomerDefaults(customerCode, {
          ...existing,
          customerName: customerName.trim() || existing.customerName || "",
          address: customerAddress.trim() || existing.address || "",
          city: customerCity.trim() || existing.city || "",
          country: customerCountry.trim() || existing.country || "",
          deliveryTerms: deliveryTerms.trim() || existing.deliveryTerms || "",
          currency,
          paymentPlan: payload.paymentPlan,
        }, { canEdit, userEmail });
      }
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 12, background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        {editingOrder ? "✏ Sipariş Düzenle" : "➕ Yeni İhracat Siparişi"}
      </div>
      {error && (
        <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>
      )}

      {/* Müşteri */}
      <Section title="Müşteri">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <Field label="Müşteri Kodu *">
            <input list="ih-customer-list" value={customerCode}
              onChange={e => {
                const val = e.target.value;
                const found = customerOptions.find(c => c.code === val);
                if (found) applyCustomerDefaults(found.code, found.name);
                else setCustomerCode(val);
              }}
              placeholder="Örn. 120-0003" style={inp} />
            <datalist id="ih-customer-list">
              {customerOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </datalist>
          </Field>
          <Field label="Müşteri Adı *">
            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Örn. OFMER SRL." style={inp} />
          </Field>
        </div>
        <div style={{ marginTop: 6 }}>
          <Field label="Adres (fatura için — opsiyonel)">
            <input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)}
              placeholder="Örn. VIA ROMA 45" style={inp} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
          <Field label="Şehir">
            <input value={customerCity} onChange={e => setCustomerCity(e.target.value)}
              placeholder="Örn. 20090 TREZZANO SUL NAVIGLIO (MI)" style={inp} />
          </Field>
          <Field label="Ülke">
            <input value={customerCountry} onChange={e => setCustomerCountry(e.target.value)}
              placeholder="Örn. ITALY" style={inp} />
          </Field>
        </div>
        {customerCode && (
          <label style={{ fontSize: 10, color: "#57534e", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6 }}>
            <input type="checkbox" checked={saveDefaultsForCustomer} onChange={e => setSaveDefaultsForCustomer(e.target.checked)} />
            Bu müşteri için varsayılanları kaydet (adres, şehir, ülke, para birimi, teslim şekli, ödeme planı)
          </label>
        )}
      </Section>

      {/* Sipariş bilgisi */}
      <Section title="Sipariş">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Field label="Belge No *">
            <input value={belgeNo} onChange={e => setBelgeNo(e.target.value)} placeholder="Örn. 378" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
          </Field>
          <Field label="Termin (opsiyonel)">
            <input type="date" value={teslimTarihi} onChange={e => setTeslimTarihi(e.target.value)} style={inp} />
          </Field>
          <Field label="Durum">
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inp, background: "#fff" }}>
              <option value="open">Açık</option>
              <option value="closed">Kapalı</option>
              <option value="cancelled">İptal</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* Ürün */}
      <Section title="Ürün">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <Field label="Stok Kodu (VIO) *">
            <input list="ih-product-list" value={stokKodu}
              onChange={e => applyProductByCode(e.target.value)}
              placeholder="Örn. 152-0104" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
            <datalist id="ih-product-list">
              {(products || []).filter(p => p.vioCode).map(p => (
                <option key={p.id} value={p.vioCode}>{p.nameTR}</option>
              ))}
            </datalist>
            {pid != null && <div style={{ fontSize: 9, color: "#166534", marginTop: 2 }}>✓ Ürün eşleşti (pid={pid})</div>}
          </Field>
          <Field label="Ürün Adı (TR)">
            <input value={stokAdi} onChange={e => setStokAdi(e.target.value)} style={inp} />
          </Field>
        </div>
        <Field label="Ürün Adı (İngilizce — fatura için) — opsiyonel">
          <input value={descriptionEn} onChange={e => setDescriptionEn(e.target.value)}
            placeholder="Örn. GEAR SET C54ST — bu isim Paket B'de faturada basılacak" style={inp} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          <Field label="Miktar *">
            <input type="number" value={orijinalMiktar} onChange={e => setOrijinalMiktar(e.target.value)} style={inp} />
          </Field>
          <Field label="Başlangıç Sevk (VIO)">
            <input type="number" value={sevkedilenBaslangic} onChange={e => setSevkedilenBaslangic(e.target.value)}
              title="Excel import'ta VIO'daki geçmiş sevk miktarı. Manuel girişte genellikle 0."
              style={inp} />
          </Field>
          <Field label="Birim Fiyat">
            <input type="number" step="0.01" value={birimFiyat} onChange={e => setBirimFiyat(e.target.value)} style={inp} />
          </Field>
          <Field label="Para Birimi">
            <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...inp, background: "#fff" }}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {/* Cascade önizleme — parent seçildiyse bağlı child ürünlerini göster */}
        {cascadeChildren.length > 0 && (
          <div style={{ marginTop: 8, padding: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#1e40af", marginBottom: 4 }}>
              🔗 Bu ürün kombine parent — kayıt sonrası Sevkiyat Planı'na aşağıdaki bağlı ürünler de aynı miktarda eklenir:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cascadeChildren.map(c => (
                <div key={c.pid} style={{ padding: "3px 8px", fontSize: 10, background: "#fff", border: "1px solid #bfdbfe", borderRadius: 3 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{c.vioCode || `#${c.pid}`}</span>
                  <span style={{ marginLeft: 6, color: "#57534e" }}>{c.nameTR}</span>
                  {Number(orijinalMiktar) > 0 && (
                    <span style={{ marginLeft: 6, fontWeight: 700, color: "#166534" }}>
                      +{(Number(orijinalMiktar) - (Number(sevkedilenBaslangic) || 0)) || 0}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: "#78716c", marginTop: 4 }}>
              💡 Not: İhracat sipariş listesinde bu bağlı ürünler görünmez — sadece parent kaydedilir. Bağlı ürünler yalnızca Sevkiyat Planı motor tarafına yansır (cascade rules).
            </div>
          </div>
        )}
      </Section>

      {/* Teslim & Ödeme */}
      <Section title="Teslim & Ödeme">
        <Field label="Teslim Şekli">
          <input list="ih-delivery-terms-form" value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)}
            placeholder="Örn. DDP / TREZZO SULL / ADDA (MI)" style={inp} />
          <datalist id="ih-delivery-terms-form">
            {(settings?.deliveryTermsList || []).map(t => <option key={t} value={t} />)}
          </datalist>
          {(settings?.deliveryTermsList || []).length > 0 && (
            <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>
              💡 Kayıtlı teslim şekillerinden seçebilirsin ({(settings?.deliveryTermsList || []).length})
            </div>
          )}
        </Field>
        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 600 }}>
              Ödeme Planı
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 500,
                color: paymentValidation.valid ? "#166534" : "#92400e" }}>
                Toplam: %{paymentValidation.total}
                {paymentValidation.warning && <> · ⚠ {paymentValidation.warning}</>}
              </span>
            </div>
            {Array.isArray(settings?.paymentPlanTemplates) && settings.paymentPlanTemplates.length > 0 && (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <label style={{ fontSize: 10, color: "#78716c" }}>Şablondan yükle:</label>
                <select value="" onChange={e => {
                  const tpl = (settings?.paymentPlanTemplates || []).find(t => t.name === e.target.value);
                  if (tpl && Array.isArray(tpl.plan)) setPaymentPlan(tpl.plan.map(p => ({ ...p })));
                }} style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3 }}>
                  <option value="">— seç —</option>
                  {settings.paymentPlanTemplates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
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
            {(settings?.paymentLabels || []).map(l => <option key={l} value={l} />)}
          </datalist>
          <button onClick={addPlanRow}
            style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
            + Ödeme Satırı Ekle
          </button>
        </div>
      </Section>

      {/* Kaydet */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
        <button onClick={onCancel} disabled={saving}
          style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
          Vazgeç
        </button>
        <button onClick={handleSave} disabled={saving || !canEdit || !canSave}
          style={{ padding: "6px 14px", fontSize: 12, background: canSave ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (saving || !canSave) ? "not-allowed" : "pointer", fontWeight: 500 }}>
          {saving ? "Kaydediliyor…" : (editingOrder ? "💾 Güncelle" : "💾 Kaydet")}
        </button>
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
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
