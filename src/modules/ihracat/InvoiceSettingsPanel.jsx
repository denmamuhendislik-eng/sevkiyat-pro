// İhracat > Ayarlar sekmesi — fatura oluşturma öncesi sistem ayarları.
// Sadece admin görür.
//
// İçerik:
//   1. Kaşe/İmza imajı upload (Storage: ihracat/stamp/)
//   2. Banka bilgisi (branch, IBAN, SWIFT) — Denma varsayılan
//   3. Şirket bilgisi (adres, iletişim) — fatura antetinde kullanılır
//   4. Yıllık numara sayacı — son basılan numara + sıradaki

import React, { useState, useEffect, useRef } from "react";
import {
  subscribeInvoiceSettings, saveInvoiceSettings, setInvoiceCounter,
  uploadStampImage, deleteStampImage, saveBankAccounts,
} from "./firestore";

// Denma default bilgileri (referans PDF'ten)
const DEFAULT_COMPANY = {
  name: "DENMA DIŞ TİCARET LTD.ŞTİ.",
  address: "Fevzi Çakmak Mah. 10670 Sk. No:31/B Karatay - KONYA / TURKEY",
  phone: "+90 332 606 29 83",
  taxOffice: "Selçuk V.D. 292 139 2109",
  website: "www.denma.com.tr",
  email: "bilgi@denma.com.tr",
};
const DEFAULT_BANK_ACCOUNTS = [{
  id: "default_1",
  label: "Ziraat EUR",
  branchName: "T.C. ZİRAAT BANKASI A.Ş. / MERAM",
  iban: "TR45 0001 0021 7397 9930 1950 02",
  swift: "TCZBTR2A",
  currency: "EUR",
  isDefault: true,
}];

export default function InvoiceSettingsPanel({ canEdit, userEmail }) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const fileInputRef = useRef(null);

  // Editable state (form)
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [bankAccounts, setBankAccounts] = useState(DEFAULT_BANK_ACCOUNTS);
  const [counterYear, setCounterYear] = useState(String(new Date().getFullYear()));
  const [counterValue, setCounterValue] = useState("");
  const loadedRef = useRef(false);

  useEffect(() => {
    const u = subscribeInvoiceSettings(d => {
      setSettings(d || {});
      setLoaded(true);
      if (!loadedRef.current) {
        loadedRef.current = true;
        if (d?.companyInfo) setCompany({ ...DEFAULT_COMPANY, ...d.companyInfo });
        // Multi-bank: bankAccounts array öncelikli; yoksa legacy bankInfo → tek hesap
        if (Array.isArray(d?.bankAccounts) && d.bankAccounts.length > 0) {
          setBankAccounts(d.bankAccounts);
        } else if (d?.bankInfo) {
          setBankAccounts([{
            id: "legacy_1",
            label: "Ana Hesap",
            branchName: d.bankInfo.branchName || "",
            iban: d.bankInfo.iban || "",
            swift: d.bankInfo.swift || "",
            currency: d.bankInfo.currency || "EUR",
            isDefault: true,
          }]);
        }
        const y = String(new Date().getFullYear());
        const counters = d?.counters || {};
        if (typeof counters[y] === "number") setCounterValue(String(counters[y]));
      }
    });
    return () => u && u();
  }, []);

  const addBankAccount = () => {
    const newId = `acc_${Date.now()}`;
    setBankAccounts([...bankAccounts, {
      id: newId, label: "", branchName: "", iban: "", swift: "", currency: "EUR", isDefault: bankAccounts.length === 0,
    }]);
  };
  const updateBankAccount = (i, key, val) => {
    setBankAccounts(bankAccounts.map((a, idx) => idx === i ? { ...a, [key]: val } : a));
  };
  const removeBankAccount = (i) => {
    if (bankAccounts.length <= 1) { alert("En az bir banka hesabı olmalı"); return; }
    if (!confirm("Bu banka hesabı silinsin mi?")) return;
    setBankAccounts(bankAccounts.filter((_, idx) => idx !== i));
  };
  const setDefaultBank = (i) => {
    setBankAccounts(bankAccounts.map((a, idx) => ({ ...a, isDefault: idx === i })));
  };

  const handleSaveCompany = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      await saveInvoiceSettings({ companyInfo: company }, { canEdit, userEmail });
      alert("✓ Şirket bilgisi kaydedildi");
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleSaveBanks = async () => {
    if (!canEdit) return;
    // Doğrulama
    const invalid = bankAccounts.some(a => !a.label?.trim() || !a.iban?.trim());
    if (invalid) { alert("Her hesap için Etiket ve IBAN zorunlu"); return; }
    setSaving(true);
    setError("");
    try {
      await saveBankAccounts(bankAccounts, { canEdit, userEmail });
      alert("✓ Banka hesapları kaydedildi");
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleSaveCounter = async () => {
    if (!canEdit) return;
    if (!counterYear.match(/^\d{4}$/)) { alert("Yıl 4 haneli olmalı"); return; }
    const n = Number(counterValue);
    if (!Number.isFinite(n) || n < 0) { alert("Geçerli sayı gir"); return; }
    if (!confirm(`${counterYear} yılı sayacı ${n} olarak ayarlanacak.\nBir sonraki fatura CI${counterYear}${String(n + 1).padStart(2, "0")} olacak.\n\nOnaylıyor musun?`)) return;
    setSaving(true);
    setError("");
    try {
      await setInvoiceCounter(counterYear, n, { canEdit, userEmail });
      alert("✓ Sayaç güncellendi");
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleStampUpload = async (file) => {
    if (!file || !canEdit) return;
    setUploadingStamp(true);
    setError("");
    try {
      await uploadStampImage(file, { canEdit, userEmail });
    } catch (e) { setError("Kaşe yüklenemedi: " + e.message); } finally { setUploadingStamp(false); }
  };

  const handleStampDelete = async () => {
    if (!canEdit) return;
    if (!confirm("Kaşe imajı silinsin mi?")) return;
    setUploadingStamp(true);
    setError("");
    try {
      await deleteStampImage({ canEdit, userEmail });
    } catch (e) { setError("Kaşe silinemedi: " + e.message); } finally { setUploadingStamp(false); }
  };

  if (!loaded) return <div style={{ padding: 30, textAlign: "center", color: "#a8a29e" }}>Yükleniyor…</div>;

  const currentCounter = Number(settings?.counters?.[counterYear]) || 0;
  const nextCI = `CI${counterYear}${String(currentCounter + 1).padStart(2, "0")}`;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {error && <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}

      {/* Kaşe/imza */}
      <Section title="🖋 Kaşe / İmza İmajı">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ width: 180, height: 100, border: "1px dashed #d6d3d1", borderRadius: 4, background: "#fafaf9", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {settings?.stampImage?.url ? (
              <img src={settings.stampImage.url} alt="Kaşe" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: 10, color: "#a8a29e", textAlign: "center" }}>Kaşe yüklü değil</div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={e => handleStampUpload(e.target.files?.[0])} disabled={!canEdit || uploadingStamp} style={{ display: "none" }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={!canEdit || uploadingStamp} style={btnPri}>
              {uploadingStamp ? "Yükleniyor…" : (settings?.stampImage?.url ? "📤 Değiştir" : "📤 Yükle")}
            </button>
            {settings?.stampImage?.url && (
              <button onClick={handleStampDelete} disabled={!canEdit || uploadingStamp} style={{ ...btnDanger, marginLeft: 6 }}>
                🗑 Sil
              </button>
            )}
            <div style={{ fontSize: 10, color: "#78716c", marginTop: 8 }}>
              PNG veya JPG formatında yükle. Faturalarda sağ üstte otomatik basılacak.
              {settings?.stampImage?.uploadedAt && (
                <div>Son yükleme: {new Date(settings.stampImage.uploadedAt).toLocaleString("tr-TR")}</div>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Banka hesapları (multi) */}
      <Section title="🏦 Banka Hesapları (fatura altında basılır — fatura oluştururken seçilir)">
        <div style={{ fontSize: 10, color: "#78716c", marginBottom: 8 }}>
          Birden fazla banka hesabı ekleyebilirsin (örn. Ziraat EUR, İş Bankası USD). Fatura oluştururken hangisini basılacağını seçersin.
          Default hesap her fatura için ön seçili gelir.
        </div>
        {bankAccounts.map((a, i) => (
          <div key={a.id} style={{ padding: 10, background: a.isDefault ? "#f0fdf4" : "#fafaf9", border: `1px solid ${a.isDefault ? "#86efac" : "#e7e5e4"}`, borderRadius: 6, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input type="radio" name="defaultBank" checked={!!a.isDefault} onChange={() => setDefaultBank(i)} disabled={!canEdit} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>Default</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#78716c" }}>#{i + 1}</span>
              <button onClick={() => removeBankAccount(i)} disabled={!canEdit || bankAccounts.length <= 1}
                title={bankAccounts.length <= 1 ? "En az bir hesap olmalı" : "Bu hesabı sil"}
                style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: (canEdit && bankAccounts.length > 1) ? "pointer" : "not-allowed", opacity: bankAccounts.length > 1 ? 1 : 0.4 }}>🗑</button>
            </div>
            <Grid cols={2}>
              <Field label="Etiket (dropdown'da görünen isim) *">
                <input value={a.label} onChange={e => updateBankAccount(i, "label", e.target.value)}
                  placeholder="Örn. Ziraat EUR" style={inp} />
              </Field>
              <Field label="Para Birimi">
                <select value={a.currency} onChange={e => updateBankAccount(i, "currency", e.target.value)} style={{ ...inp, background: "#fff" }}>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="TL">TL</option>
                  <option value="GBP">GBP</option>
                </select>
              </Field>
              <Field label="Şube / Banka Adı">
                <input value={a.branchName} onChange={e => updateBankAccount(i, "branchName", e.target.value)}
                  placeholder="Örn. T.C. ZİRAAT BANKASI A.Ş. / MERAM" style={inp} />
              </Field>
              <Field label="IBAN *">
                <input value={a.iban} onChange={e => updateBankAccount(i, "iban", e.target.value)}
                  placeholder="TR..." style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
              </Field>
              <Field label="SWIFT Kodu">
                <input value={a.swift} onChange={e => updateBankAccount(i, "swift", e.target.value)}
                  placeholder="TCZBTR2A" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
              </Field>
            </Grid>
          </div>
        ))}
        <button onClick={addBankAccount} disabled={!canEdit}
          style={{ padding: "6px 12px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed" }}>
          + Yeni Banka Hesabı Ekle
        </button>
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button onClick={handleSaveBanks} disabled={!canEdit || saving} style={btnPri}>💾 Banka Hesaplarını Kaydet</button>
        </div>
      </Section>

      {/* Şirket bilgisi */}
      <Section title="🏢 Şirket Bilgisi (fatura antetinde basılır)">
        <Field label="Şirket Adı">
          <input value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} style={inp} />
        </Field>
        <Field label="Adres">
          <input value={company.address} onChange={e => setCompany({ ...company, address: e.target.value })} style={inp} />
        </Field>
        <Grid cols={2}>
          <Field label="Telefon">
            <input value={company.phone} onChange={e => setCompany({ ...company, phone: e.target.value })} style={inp} />
          </Field>
          <Field label="Vergi Dairesi">
            <input value={company.taxOffice} onChange={e => setCompany({ ...company, taxOffice: e.target.value })} style={inp} />
          </Field>
          <Field label="Web Sitesi">
            <input value={company.website} onChange={e => setCompany({ ...company, website: e.target.value })} style={inp} />
          </Field>
          <Field label="E-mail">
            <input value={company.email} onChange={e => setCompany({ ...company, email: e.target.value })} style={inp} />
          </Field>
        </Grid>
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button onClick={handleSaveCompany} disabled={!canEdit || saving} style={btnPri}>💾 Şirket Bilgisini Kaydet</button>
        </div>
      </Section>

      {/* Numara sayacı */}
      <Section title="🔢 Yıllık Fatura Numara Sayacı">
        <div style={{ padding: 12, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 6, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#78716c", marginBottom: 4 }}>Aktif durum:</div>
          <div style={{ fontSize: 14 }}>
            {counterYear} yılında son basılan: <b>{currentCounter}</b>
            <span style={{ marginLeft: 8, color: "#166534" }}>· Bir sonraki: <b>{nextCI}</b></span>
          </div>
        </div>
        <Grid cols={2}>
          <Field label="Yıl">
            <input value={counterYear} onChange={e => setCounterYear(e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
          </Field>
          <Field label="Son basılan numara (sayaç değeri)">
            <input type="number" value={counterValue} onChange={e => setCounterValue(e.target.value)}
              placeholder="Örn. 77 → sıradaki CI202678 olur"
              style={inp} />
          </Field>
        </Grid>
        <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
          💡 Sayaç <b>son basılan</b> fatura numarasını tutar. Yeni fatura kesildiğinde otomatik +1 artar.
          Yılbaşında yeni yıl için otomatik 0'dan başlar (elle ayarlamak istersen yıl değiştirip değeri gir).
        </div>
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button onClick={handleSaveCounter} disabled={!canEdit || saving} style={btnPri}>💾 Sayacı Ayarla</button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16, padding: 14, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#44403c" }}>{title}</div>
      {children}
    </div>
  );
}

function Grid({ cols, children }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10, marginBottom: 8 }}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const btnPri = { padding: "6px 14px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 };
const btnDanger = { padding: "6px 14px", fontSize: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" };
