import { useState, useEffect, useMemo, useRef } from "react";
import {
  subscribeQuoteMaterials, subscribeQuoteFasonWorks, subscribeQuoteOptions,
  subscribeQuotePolicy, subscribeQuoteParts, subscribeQuoteCustomers,
  suggestNextQuoteNo, saveNewQuote, saveQuotePart,
} from "./firestore";
import { calculateQuoteTotal, paymentTermToGroup } from "./quoteCalc";

// Modül ana giriş: yeni teklif oluşturma formu (tek uzun sayfa).
export default function NewQuoteView({ canEdit, isAdmin, onSaved }) {
  const [materials, setMaterials] = useState({ materials: {} });
  const [fasonWorks, setFasonWorks] = useState({ works: [] });
  const [options, setOptions] = useState({});
  const [policy, setPolicy] = useState({});
  const [partsLib, setPartsLib] = useState({ parts: {} });
  const [customersData, setCustomersData] = useState({ customers: {} });
  const [staging, setStaging] = useState(false);

  // Form state
  const [quoteNo, setQuoteNo] = useState("");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [shipping, setShipping] = useState("");
  const [shippingCost, setShippingCost] = useState(0);
  const [shippingIncluded, setShippingIncluded] = useState(true);
  const [currency, setCurrency] = useState("TL");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [quoteType, setQuoteType] = useState("Yurtiçi Satış");
  const [term, setTerm] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const u1 = subscribeQuoteMaterials(d => setMaterials(d || { materials: {} }), { staging });
    const u2 = subscribeQuoteFasonWorks(d => setFasonWorks(d || { works: [] }), { staging });
    const u3 = subscribeQuoteOptions(d => setOptions(d || {}), { staging });
    const u4 = subscribeQuotePolicy(d => setPolicy(d || {}), { staging });
    const u5 = subscribeQuoteParts(d => setPartsLib(d || { parts: {} }), { staging });
    const u6 = subscribeQuoteCustomers(d => setCustomersData(d || { customers: {} }), { staging });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, [staging]);

  // İlk yüklemede quote no otomatik önerisi
  useEffect(() => {
    if (!quoteNo) {
      suggestNextQuoteNo().then(setQuoteNo).catch(() => {});
    }
  }, [quoteNo]);

  // Malzeme adları currency için USD kuru
  useEffect(() => {
    if (currency === "DOLAR" && materials?.currencyRateUsd > 0) {
      setExchangeRate(materials.currencyRateUsd);
    } else if (currency === "TL") {
      setExchangeRate(1);
    }
  }, [currency, materials]);

  // Müşteri seçilince default alanları doldur
  const applyCustomer = (name) => {
    setCustomerName(name);
    const c = customersData?.customers?.[name];
    if (c) {
      setCustomerPhone(c.phone || "");
      setCustomerEmail(c.email || "");
      if (c.defaultPaymentTerm) setPaymentTerm(c.defaultPaymentTerm);
      if (c.defaultShipping) setShipping(c.defaultShipping);
      if (c.defaultCurrency) setCurrency(c.defaultCurrency);
    }
  };

  // Kalem ekle (boş)
  const addBlankLine = () => {
    setLines(prev => [...prev, makeBlankLine()]);
  };

  // Kütüphaneden parça ekle — tüm alanları önceden doldur
  const addFromLibrary = (part) => {
    setLines(prev => [...prev, {
      stockCode: part.stokKodu || "",
      musteriKodu: part.musteriKodu || "",
      stockName: part.stokAdi || "",
      quantity: 1,
      unit: "ADET",
      materialType: part.hammadde?.tur || "",
      dimensions: parseDimensions(part.hammadde?.ebat),
      weightKg: part.hammadde?.agirlikKg || 0,
      machines: parseMachinesString(part.operasyonlar?.makineler, part.operasyonlar?.toplamSureDk),
      fasonWorks: parseFasonString(part.fason?.isler),
      specialToolCost: 0,
      technicalNote: `Kütüphaneden (kullanım: ${part.kullanimSayisi})`,
      fromLibrary: true,
      libraryStokKodu: part.stokKodu,
    }]);
  };

  const removeLine = (idx) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const updateLineDim = (idx, field, value) => {
    setLines(prev => {
      const next = [...prev];
      const dims = { ...(next[idx].dimensions || {}) };
      dims[field] = Number(value) || 0;
      next[idx] = { ...next[idx], dimensions: dims };
      return next;
    });
  };

  // Anlık hesap
  const calc = useMemo(() => {
    return calculateQuoteTotal({
      lines,
      materials: materials?.materials || {},
      policy: policy || {},
      paymentTerm,
      currency,
      exchangeRate,
    });
  }, [lines, materials, policy, paymentTerm, currency, exchangeRate]);

  const handleSave = async () => {
    if (!canEdit) return;
    if (!customerName) { setSaveError("Müşteri seç"); return; }
    if (!quoteNo) { setSaveError("Teklif no boş"); return; }
    if (lines.length === 0) { setSaveError("En az 1 kalem ekle"); return; }
    setSaving(true); setSaveError("");
    try {
      const quotePayload = {
        quoteNo,
        quoteDate,
        customerName,
        customerPhone,
        customerEmail,
        paymentTerm,
        shipping,
        shippingCost,
        shippingIncluded,
        currency,
        exchangeRate,
        quoteType,
        term,
        notes,
        status,
        lines: lines.map((l, i) => {
          const r = calc.lineResults[i];
          return {
            stockCode: l.stockCode,
            musteriKodu: l.musteriKodu,
            stockName: l.stockName,
            quantity: l.quantity,
            unit: l.unit,
            materialType: l.materialType,
            dimensions: l.dimensions,
            weightKg: r.weightKg,
            machines: l.machines,
            fasonWorks: l.fasonWorks,
            specialToolCost: l.specialToolCost,
            technicalNote: l.technicalNote,
            costPerUnit: r.perUnit.totalCost,
            salePricePerUnit: r.perUnit.salePrice,
            linePrice: r.total.salePrice,
            profit: r.total.profit,
          };
        }),
        totalCostTl: calc.totalCostTl,
        totalPriceTl: calc.totalSaleTl,
        totalProfitTl: calc.totalProfitTl,
        source: "ui",
      };
      const out = await saveNewQuote(quotePayload, { canEdit, staging });

      // Yeni parça(lar) kütüphaneye eklensin (fromLibrary değilse)
      for (const line of lines) {
        if (line.fromLibrary) continue;
        if (!line.stockCode || !line.stockCode.trim()) continue;
        try {
          await saveQuotePart(line.stockCode, {
            stokKodu: line.stockCode,
            stokAdi: line.stockName,
            musteriKodu: line.musteriKodu || "",
            hammadde: {
              tur: line.materialType,
              ebat: `EN:${line.dimensions?.en || 0} × BOY:${line.dimensions?.boy || 0} × UZ:${line.dimensions?.uzunluk || 0}`,
              agirlikKg: 0,
            },
            operasyonlar: {
              makineler: (line.machines || []).map(m => m.name).join(","),
              toplamSureDk: (line.machines || []).reduce((s, m) => s + (Number(m.timeMin) || 0), 0),
            },
            fason: {
              isler: (line.fasonWorks || []).map(f => f.name).join(","),
              tahminiToplam: (line.fasonWorks || []).reduce((s, f) => s + ((Number(f.unitPriceTl) || 0) * (Number(f.quantity) || line.quantity)), 0),
            },
            aparat: { varMi: (line.specialToolCost > 0), aciklama: "", maliyet: Number(line.specialToolCost) || 0 },
            sonTeklifNo: quoteNo,
            sonTeklifTarihi: quoteDate,
            sonMusteri: customerName,
            createdBy: "ui",
          }, { canEdit, staging });
        } catch (e) {
          console.warn("Parça kütüphaneye eklenemedi:", line.stockCode, e.message);
        }
      }

      setSaveResult({ ok: true, ...out, message: `Teklif kaydedildi: ${quoteNo}` });
      onSaved && onSaved();
    } catch (e) {
      setSaveError(e.message || "Kaydetme hatası");
    } finally {
      setSaving(false);
    }
  };

  const materialList = Object.values(materials?.materials || {});
  const fasonList = fasonWorks?.works || [];
  const customerList = Object.values(customersData?.customers || {}).sort((a, b) =>
    (a.name || "").localeCompare(b.name || "")
  );

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
        💡 <b>Yeni Teklif</b> — üstte müşteri + meta, aşağıda parça arama / ekleme. Kaydettiğinde her yeni stok kodu otomatik kütüphaneye yazılır.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging'e kaydet (test)
        </label>
      </div>

      {/* META */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>1️⃣ Müşteri & Teklif Bilgileri</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <div>
            <label style={labelStyle}>Müşteri *</label>
            <input list="customerList" value={customerName} onChange={e => applyCustomer(e.target.value)}
              placeholder="Müşteri seç veya yeni yaz" style={inputStyle} />
            <datalist id="customerList">
              {customerList.map(c => (
                <option key={c.name} value={c.name}>
                  {c.totalQuotes} teklif · son: {c.lastQuoteDate || "—"}
                </option>
              ))}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Telefon</label>
            <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>E-mail</label>
            <input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Teklif No</label>
            <input value={quoteNo} onChange={e => setQuoteNo(e.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
          </div>
          <div>
            <label style={labelStyle}>Teklif Tarihi</label>
            <input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Ödeme Şekli</label>
            <input list="paymentList" value={paymentTerm} onChange={e => setPaymentTerm(e.target.value)} style={inputStyle} />
            <datalist id="paymentList">
              {(options?.odemeSekli || []).map(o => <option key={o} value={o} />)}
            </datalist>
            <div style={{ fontSize: 10, color: "#a8a29e", marginTop: 2 }}>Marj grubu: <b>{paymentTermToGroup(paymentTerm)}</b></div>
          </div>
          <div>
            <label style={labelStyle}>Nakliye</label>
            <input list="shippingList" value={shipping} onChange={e => setShipping(e.target.value)} style={inputStyle} />
            <datalist id="shippingList">
              {(options?.nakliye || []).map(o => <option key={o} value={o} />)}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Nakliye Ücreti</label>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="number" value={shippingCost} onChange={e => setShippingCost(Number(e.target.value) || 0)} style={{ ...inputStyle, flex: 1 }} />
              <label style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 2 }}>
                <input type="checkbox" checked={shippingIncluded} onChange={e => setShippingIncluded(e.target.checked)} />
                Dahil
              </label>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Döviz</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)} style={inputStyle}>
              <option value="TL">TL</option>
              <option value="DOLAR">DOLAR</option>
              <option value="EURO">EURO</option>
            </select>
            {currency !== "TL" && (
              <div style={{ fontSize: 10, marginTop: 2 }}>
                Kur: <input type="number" step="0.01" value={exchangeRate} onChange={e => setExchangeRate(Number(e.target.value) || 1)} style={{ width: 60, padding: "2px 4px", fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 3 }} />
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Termin</label>
            <input value={term} onChange={e => setTerm(e.target.value)} placeholder="örn. 45 GÜN" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Teklif Tipi</label>
            <select value={quoteType} onChange={e => setQuoteType(e.target.value)} style={inputStyle}>
              <option value="Yurtiçi Satış">Yurtiçi Satış</option>
              <option value="Yurtdışı Satış">Yurtdışı Satış</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Durum</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
              <option value="draft">📝 Taslak</option>
              <option value="sent">📤 Gönderildi</option>
              <option value="accepted">✅ Kabul</option>
              <option value="rejected">❌ Red</option>
            </select>
          </div>
        </div>
      </div>

      {/* PARÇA ARAMA */}
      <PartsSearchBox partsLib={partsLib} onSelect={addFromLibrary} />

      {/* KALEMLER */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>3️⃣ Kalemler ({lines.length})</div>
          <button onClick={addBlankLine} style={btnSmall}>+ Boş Kalem Ekle</button>
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 12, border: "1px dashed #d6d3d1", borderRadius: 4 }}>
            Yukarıdan parça ara veya "Boş Kalem Ekle" ile başla.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {lines.map((line, idx) => (
              <LineEditor
                key={idx} idx={idx} line={line} calcResult={calc.lineResults[idx]}
                materialList={materialList} fasonList={fasonList} optionsData={options}
                update={updateLine} updateDim={updateLineDim} onRemove={() => removeLine(idx)}
              />
            ))}
          </div>
        )}
      </div>

      {/* NOTLAR */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>4️⃣ Genel Notlar</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Teklife dair genel notlar, özel şartlar..."
          style={{ width: "100%", minHeight: 60, padding: 8, fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 4, boxSizing: "border-box" }} />
      </div>

      {/* TOPLAM ÖZET */}
      <div style={{ ...cardStyle, background: "#f0fdf4", border: "1px solid #86efac" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>5️⃣ Toplam Özet</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 12 }}>
          <div><span style={{ color: "#78716c" }}>Toplam Maliyet:</span> <b>{fmt(calc.totalCostTl)} TL</b></div>
          <div><span style={{ color: "#78716c" }}>Toplam Satış (TL):</span> <b>{fmt(calc.totalSaleTl)} TL</b></div>
          <div><span style={{ color: "#78716c" }}>Toplam Kâr:</span> <b style={{ color: "#16a34a" }}>{fmt(calc.totalProfitTl)} TL</b></div>
          <div><span style={{ color: "#78716c" }}>Kâr Marjı:</span> <b>%{calc.overallMarginPct.toFixed(1)}</b></div>
          {currency !== "TL" && (
            <>
              <div><span style={{ color: "#78716c" }}>Satış ({currency}):</span> <b>{fmt(calc.totalSaleDisplay)}</b></div>
              <div><span style={{ color: "#78716c" }}>Kur:</span> {exchangeRate}</div>
            </>
          )}
        </div>
      </div>

      {/* KAYDET */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button onClick={handleSave} disabled={!canEdit || saving} style={btnSave}>
          {saving ? "Kaydediliyor..." : "💾 Teklifi Kaydet"}
        </button>
        {saveError && <span style={{ fontSize: 11, color: "#dc2626" }}>⚠ {saveError}</span>}
        {saveResult?.ok && <span style={{ fontSize: 11, color: "#16a34a" }}>✓ {saveResult.message}</span>}
      </div>
    </div>
  );
}

// ==================== Alt component: Parça Arama Kutusu ====================

function PartsSearchBox({ partsLib, onSelect }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr-TR");
    if (!s || s.length < 2) return [];
    const arr = Object.values(partsLib?.parts || {});
    return arr.filter(p =>
      (p.stokKodu || "").toLocaleLowerCase("tr-TR").includes(s) ||
      (p.stokAdi || "").toLocaleLowerCase("tr-TR").includes(s) ||
      (p.musteriKodu || "").toLocaleLowerCase("tr-TR").includes(s)
    ).sort((a, b) => (b.kullanimSayisi || 0) - (a.kullanimSayisi || 0)).slice(0, 12);
  }, [q, partsLib]);

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>2️⃣ Parça Arama</div>
      <input
        type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder="🔎 Stok kodu / müşteri kodu / parça adı — daha önce çalışılan parçayı bul, hızlı yol ile ekle"
        style={{ width: "100%", padding: "8px 12px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 13, boxSizing: "border-box", marginBottom: 8 }}
      />
      {q.length >= 2 && (
        <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #e7e5e4", borderRadius: 4 }}>
          {results.length === 0 ? (
            <div style={{ padding: 12, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>
              Sonuç yok — yeni parça olarak eklemek için aşağıdan "+ Boş Kalem Ekle" kullan
            </div>
          ) : (
            results.map(p => (
              <div key={p.stokKodu} style={{ padding: 8, borderBottom: "1px solid #f5f5f4", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                onClick={() => { onSelect(p); setQ(""); }}
                onMouseEnter={e => e.currentTarget.style.background = "#f5f5f4"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, fontFamily: "ui-monospace, monospace" }}>{p.stokKodu}
                    {p.musteriKodu && <span style={{ marginLeft: 6, fontSize: 10, color: "#a8a29e" }}>· müş: {p.musteriKodu}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#57534e" }}>{p.stokAdi}</div>
                  <div style={{ fontSize: 10, color: "#78716c", marginTop: 2 }}>
                    {p.hammadde?.tur || "—"} · {p.operasyonlar?.makineler || "—"} · son: {p.sonTeklifTarihi || "—"} ({p.sonMusteri || "?"})
                  </div>
                </div>
                <span style={{ padding: "2px 6px", background: "#dcfce7", color: "#166534", borderRadius: 3, fontSize: 10, fontWeight: 600 }}>
                  {p.kullanimSayisi} kez · Hızlı Yol ↵
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Alt component: Kalem Editörü ====================

function LineEditor({ idx, line, calcResult, materialList, fasonList, optionsData, update, updateDim, onRemove }) {
  const addMachine = () => update(idx, "machines", [...(line.machines || []), { name: "", timeMin: 0, ratePerMin: 0 }]);
  const updateMachine = (mi, field, value) => {
    const m = [...(line.machines || [])];
    m[mi] = { ...m[mi], [field]: field === "name" ? value : (Number(value) || 0) };
    update(idx, "machines", m);
  };
  const removeMachine = (mi) => update(idx, "machines", (line.machines || []).filter((_, i) => i !== mi));

  const addFason = () => update(idx, "fasonWorks", [...(line.fasonWorks || []), { name: "", unitPriceTl: 0, quantity: 0 }]);
  const updateFason = (fi, field, value) => {
    const f = [...(line.fasonWorks || [])];
    f[fi] = { ...f[fi], [field]: field === "name" ? value : (Number(value) || 0) };
    update(idx, "fasonWorks", f);
  };
  const removeFason = (fi) => update(idx, "fasonWorks", (line.fasonWorks || []).filter((_, i) => i !== fi));

  return (
    <div style={{ padding: 12, border: "1px solid #d6d3d1", borderRadius: 6, background: line.fromLibrary ? "#f0fdf4" : "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#57534e" }}>Kalem #{idx + 1}</span>
        {line.fromLibrary && <span style={{ padding: "2px 6px", background: "#dcfce7", color: "#166534", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>KÜTÜPHANEDEN</span>}
        <button onClick={onRemove} style={{ marginLeft: "auto", padding: "3px 8px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 3, fontSize: 10, cursor: "pointer" }}>🗑 Sil</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 10 }}>
        <div>
          <label style={miniLabel}>Stok Kodu (opsiyonel)</label>
          <input value={line.stockCode || ""} onChange={e => update(idx, "stockCode", e.target.value)} style={{ ...miniInput, fontFamily: "ui-monospace, monospace" }} />
        </div>
        <div>
          <label style={miniLabel}>Müşteri Parça Kodu</label>
          <input value={line.musteriKodu || ""} onChange={e => update(idx, "musteriKodu", e.target.value)} style={{ ...miniInput, fontFamily: "ui-monospace, monospace" }} />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label style={miniLabel}>Parça Adı *</label>
          <input value={line.stockName || ""} onChange={e => update(idx, "stockName", e.target.value)} style={miniInput} />
        </div>
        <div>
          <label style={miniLabel}>Miktar</label>
          <input type="number" value={line.quantity || 1} onChange={e => update(idx, "quantity", Number(e.target.value) || 1)} style={miniInput} />
        </div>
        <div>
          <label style={miniLabel}>Birim</label>
          <select value={line.unit || "ADET"} onChange={e => update(idx, "unit", e.target.value)} style={miniInput}>
            {(optionsData?.birim || ["ADET", "KG", "METRE"]).map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {/* Hammadde */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>🧱 Hammadde (Teknik ekip)</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr repeat(3, 1fr) 1fr", gap: 6 }}>
          <div>
            <label style={miniLabel}>Malzeme Türü</label>
            <input list="materialList" value={line.materialType || ""} onChange={e => update(idx, "materialType", e.target.value)} style={miniInput} />
            <datalist id="materialList">
              {materialList.map(m => <option key={m.name} value={m.name}>{m.shape} · {m.priceTlPerKg}TL/kg</option>)}
            </datalist>
          </div>
          <div><label style={miniLabel}>EN (mm)</label><input type="number" value={line.dimensions?.en || 0} onChange={e => updateDim(idx, "en", e.target.value)} style={miniInput} /></div>
          <div><label style={miniLabel}>BOY (mm)</label><input type="number" value={line.dimensions?.boy || 0} onChange={e => updateDim(idx, "boy", e.target.value)} style={miniInput} /></div>
          <div><label style={miniLabel}>UZUNLUK (mm)</label><input type="number" value={line.dimensions?.uzunluk || 0} onChange={e => updateDim(idx, "uzunluk", e.target.value)} style={miniInput} /></div>
          <div><label style={miniLabel}>Ağırlık kg</label>
            <div style={{ padding: "6px 4px", fontSize: 11, background: "#f5f5f4", borderRadius: 3, textAlign: "right" }}>
              {calcResult?.weightKg?.toFixed(3) || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Makineler */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>⚙️ Makineler (Teknik ekip)
          <button onClick={addMachine} style={{ marginLeft: 8, padding: "1px 6px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>+ Makine</button>
        </div>
        {(line.machines || []).map((m, mi) => (
          <div key={mi} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 30px", gap: 6, marginBottom: 4 }}>
            <input value={m.name || ""} onChange={e => updateMachine(mi, "name", e.target.value)} placeholder="Makine adı" style={miniInput} />
            <input type="number" value={m.timeMin || 0} onChange={e => updateMachine(mi, "timeMin", e.target.value)} placeholder="Süre (dk)" style={miniInput} />
            <input type="number" step="0.01" value={m.ratePerMin || 0} onChange={e => updateMachine(mi, "ratePerMin", e.target.value)} placeholder="TL/dk" style={miniInput} />
            <button onClick={() => removeMachine(mi)} style={{ background: "transparent", color: "#dc2626", border: "none", cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {(line.machines || []).length === 0 && <div style={{ fontSize: 10, color: "#a8a29e", padding: 4 }}>+ Makine eklemek için üstteki butona bas</div>}
      </div>

      {/* Fason */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>🔥 Fason İşler (Satış ekibi)
          <button onClick={addFason} style={{ marginLeft: 8, padding: "1px 6px", fontSize: 10, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 3, cursor: "pointer" }}>+ Fason</button>
        </div>
        {(line.fasonWorks || []).map((f, fi) => (
          <div key={fi} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 30px", gap: 6, marginBottom: 4 }}>
            <input list={`fasonList_${idx}_${fi}`} value={f.name || ""} onChange={e => updateFason(fi, "name", e.target.value)} placeholder="Fason iş" style={miniInput} />
            <datalist id={`fasonList_${idx}_${fi}`}>
              {fasonList.map(w => <option key={w.id} value={w.name} />)}
            </datalist>
            <input type="number" value={f.unitPriceTl || 0} onChange={e => updateFason(fi, "unitPriceTl", e.target.value)} placeholder="Birim TL" style={miniInput} />
            <input type="number" value={f.quantity || 0} onChange={e => updateFason(fi, "quantity", e.target.value)} placeholder={`Miktar (varsayılan: ${line.quantity})`} style={miniInput} />
            <button onClick={() => removeFason(fi)} style={{ background: "transparent", color: "#dc2626", border: "none", cursor: "pointer" }}>✕</button>
          </div>
        ))}
      </div>

      {/* Aparat/kalıp */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 6, marginBottom: 10 }}>
        <div>
          <label style={miniLabel}>Aparat/Kalıp Maliyeti (TL)</label>
          <input type="number" value={line.specialToolCost || 0} onChange={e => update(idx, "specialToolCost", Number(e.target.value) || 0)} style={miniInput} />
          <div style={{ fontSize: 9, color: "#a8a29e", marginTop: 2 }}>Adet başına: {((line.specialToolCost || 0) / (line.quantity || 1)).toFixed(2)} TL</div>
        </div>
        <div>
          <label style={miniLabel}>Teknik Not</label>
          <input value={line.technicalNote || ""} onChange={e => update(idx, "technicalNote", e.target.value)} placeholder="Özel işlem, tolerans, notlar..." style={miniInput} />
        </div>
      </div>

      {/* HESAP ÖZETİ (yan panel gibi) */}
      {calcResult && calcResult.total.totalCost > 0 && (
        <div style={{ padding: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, fontSize: 10, color: "#166534" }}>
          <b>Bu Kalem:</b>
          Adet Maliyet: {fmt(calcResult.perUnit.totalCost)} · Adet Satış: <b>{fmt(calcResult.perUnit.salePrice)}</b>
          · Toplam: <b>{fmt(calcResult.total.salePrice)}</b>
          · Marj: %{calcResult.margins.profitPct.toFixed(1)}
          · Aralık: {calcResult.margins.quantityBracket} · Grup: {calcResult.margins.paymentGroup}
        </div>
      )}
    </div>
  );
}

// ==================== Yardımcı fonksiyonlar ====================

function makeBlankLine() {
  return {
    stockCode: "",
    musteriKodu: "",
    stockName: "",
    quantity: 1,
    unit: "ADET",
    materialType: "",
    dimensions: { en: 0, boy: 0, uzunluk: 0 },
    weightKg: 0,
    machines: [],
    fasonWorks: [],
    specialToolCost: 0,
    technicalNote: "",
    fromLibrary: false,
  };
}

function parseDimensions(ebatStr) {
  if (!ebatStr) return { en: 0, boy: 0, uzunluk: 0 };
  const s = String(ebatStr);
  const m = s.match(/EN[:\s]*([0-9.,]+).*BOY[:\s]*([0-9.,]+).*UZ[:\s]*([0-9.,]+)/i);
  if (m) return { en: Number(m[1].replace(",", ".")) || 0, boy: Number(m[2].replace(",", ".")) || 0, uzunluk: Number(m[3].replace(",", ".")) || 0 };
  const m2 = s.match(/ÇAP[:\s]*([0-9.,]+).*UZUNLUK[:\s]*([0-9.,]+)/i);
  if (m2) return { en: Number(m2[1].replace(",", ".")) || 0, boy: 0, uzunluk: Number(m2[2].replace(",", ".")) || 0 };
  return { en: 0, boy: 0, uzunluk: 0 };
}

function parseMachinesString(str, totalMin) {
  if (!str) return [];
  const names = String(str).split(/[,;/]/).map(s => s.trim()).filter(Boolean);
  if (names.length === 0) return [];
  const perMachineMin = (Number(totalMin) || 0) / names.length;
  return names.map(name => ({ name, timeMin: perMachineMin, ratePerMin: 0 }));
}

function parseFasonString(str) {
  if (!str) return [];
  const names = String(str).split(/[,;/]/).map(s => s.trim()).filter(Boolean);
  return names.map(name => ({ name, unitPriceTl: 0, quantity: 0 }));
}

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const cardStyle = { padding: 14, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff", marginBottom: 12 };
const labelStyle = { display: "block", fontSize: 11, color: "#57534e", marginBottom: 3, fontWeight: 500 };
const inputStyle = { width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
const miniLabel = { display: "block", fontSize: 10, color: "#78716c", marginBottom: 2 };
const miniInput = { width: "100%", padding: "5px 8px", border: "1px solid #d6d3d1", borderRadius: 3, fontSize: 11, boxSizing: "border-box" };
const sectionStyle = { padding: 8, background: "#fafaf9", borderRadius: 4, marginBottom: 8 };
const sectionTitle = { fontSize: 11, fontWeight: 600, color: "#44403c", marginBottom: 6 };
const btnSmall = { padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" };
const btnSave = { padding: "10px 24px", fontSize: 13, fontWeight: 600, background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" };
