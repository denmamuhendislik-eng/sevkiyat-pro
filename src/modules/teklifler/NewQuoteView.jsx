import { useState, useEffect, useMemo, useRef } from "react";
import {
  subscribeQuoteMaterials, subscribeQuoteFasonWorks, subscribeQuoteOptions,
  subscribeQuotePolicy, subscribeQuoteParts, subscribeQuoteCustomers,
  suggestNextQuoteNo, saveNewQuote, saveQuotePart,
} from "./firestore";
import { calculateQuoteTotal, paymentTermToGroup } from "./quoteCalc";
import { useMachineRatesForQuote } from "./machineRates";
import { generateQuotePdf } from "./quotePdf";

// Modül ana giriş: yeni teklif oluşturma formu (tek uzun sayfa).
// Props:
//   initialQuote: dolu quote obj — düzenleme/revizyon modunda dışarıdan gelir
//   readOnly: true ise input'lar kilitli (eski revizyon görüntüleme)
export default function NewQuoteView({ canEdit, isAdmin, onSaved, initialQuote = null, readOnly = false }) {
  const [materials, setMaterials] = useState({ materials: {} });
  const [fasonWorks, setFasonWorks] = useState({ works: [] });
  const [options, setOptions] = useState({});
  const [policy, setPolicy] = useState({});
  const [partsLib, setPartsLib] = useState({ parts: {} });
  const [customersData, setCustomersData] = useState({ customers: {} });
  const [staging, setStaging] = useState(false);
  // Sevkiyat Pro'dan güncel makine dakika ücretleri
  const machineRatesData = useMachineRatesForQuote();

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
  // Revizyon field'ları
  const [revNo, setRevNo] = useState(0);
  const [baseQuoteNo, setBaseQuoteNo] = useState("");
  const [parentQuoteNo, setParentQuoteNo] = useState(null);
  const [revisionReason, setRevisionReason] = useState("");
  const [feasibilityNo, setFeasibilityNo] = useState(""); // yapılabilirlik bağlantısı (Faz Y-5, tek study — badge için)
  const [feasibilityNos, setFeasibilityNos] = useState([]); // birden fazla study'den geldiyse liste (Faz F4)
  const isRevision = revNo > 0;
  const isLocked = readOnly;
  const canEditForm = canEdit && !isLocked;

  useEffect(() => {
    const u1 = subscribeQuoteMaterials(d => setMaterials(d || { materials: {} }), { staging });
    const u2 = subscribeQuoteFasonWorks(d => setFasonWorks(d || { works: [] }), { staging });
    const u3 = subscribeQuoteOptions(d => setOptions(d || {}), { staging });
    const u4 = subscribeQuotePolicy(d => setPolicy(d || {}), { staging });
    const u5 = subscribeQuoteParts(d => setPartsLib(d || { parts: {} }), { staging });
    const u6 = subscribeQuoteCustomers(d => setCustomersData(d || { customers: {} }), { staging });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, [staging]);

  // İlk yüklemede quote no otomatik önerisi — feasibility'den gelirse
  // initialQuote var ama quoteNo boş; o zaman da öneri fetch et
  useEffect(() => {
    if (!quoteNo && (!initialQuote || !initialQuote.quoteNo)) {
      suggestNextQuoteNo().then(setQuoteNo).catch(() => {});
    }
  }, [quoteNo, initialQuote]);

  // initialQuote geldi mi? state'i onunla doldur (düzenleme veya revizyon modu)
  useEffect(() => {
    if (!initialQuote) return;
    setQuoteNo(initialQuote.quoteNo || "");
    setQuoteDate(initialQuote.quoteDate || new Date().toISOString().slice(0, 10));
    setCustomerName(initialQuote.customerName || "");
    setCustomerPhone(initialQuote.customerPhone || "");
    setCustomerEmail(initialQuote.customerEmail || "");
    setPaymentTerm(initialQuote.paymentTerm || "");
    setShipping(initialQuote.shipping || "");
    setShippingCost(initialQuote.shippingCost || 0);
    setShippingIncluded(initialQuote.shippingIncluded !== false);
    setCurrency(initialQuote.currency || "TL");
    setExchangeRate(initialQuote.exchangeRate || 1);
    setQuoteType(initialQuote.quoteType || "Yurtiçi Satış");
    setTerm(initialQuote.term || "");
    setNotes(initialQuote.notes || "");
    setLines(normalizeIncomingLines(initialQuote.lines));
    setStatus(initialQuote.status || "draft");
    setRevNo(Number(initialQuote.revNo) || 0);
    setBaseQuoteNo(initialQuote.baseQuoteNo || initialQuote.quoteNo || "");
    setParentQuoteNo(initialQuote.parentQuoteNo || null);
    setRevisionReason(initialQuote.revisionReason || "");
    setFeasibilityNo(initialQuote.feasibilityNo || "");
    setFeasibilityNos(
      Array.isArray(initialQuote.feasibilityNos) && initialQuote.feasibilityNos.length > 0
        ? initialQuote.feasibilityNos
        : (initialQuote.feasibilityNo ? [initialQuote.feasibilityNo] : [])
    );
  }, [initialQuote]);

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

  // Kütüphaneden parça ekle — tüm alanları önceden doldur + makine oranları otomatik
  const addFromLibrary = (part) => {
    try {
      const p = part || {};
      const hammadde = p.hammadde || {};
      const operasyonlar = p.operasyonlar || {};
      const fason = p.fason || {};
      const aparat = p.aparat || {};
      const rawMachines = parseMachinesString(operasyonlar.makineler, operasyonlar.toplamSureDk);
      const machinesWithRate = rawMachines.map(m => ({
        ...m,
        ratePerMin: (machineRatesData?.ratesByName?.[m.name]) || 0,
      }));
      setLines(prev => [...prev, {
        stockCode: p.stokKodu || "",
        musteriKodu: p.musteriKodu || "",
        stockName: p.stokAdi || "",
        quantity: 1,
        unit: "ADET",
        materialType: hammadde.tur || "",
        dimensions: parseDimensions(hammadde.ebat),
        weightKg: Number(hammadde.agirlikKg) || 0,
        machines: machinesWithRate,
        fasonWorks: parseFasonString(fason.isler),
        specialToolCost: Number(aparat.maliyet) || 0,
        specialToolDescription: aparat.aciklama || "",
        specialToolMode: "spread",
        technicalNote: `Kütüphaneden (kullanım: ${p.kullanimSayisi || 0})`,
        fromLibrary: true,
        libraryStokKodu: p.stokKodu,
      }]);
    } catch (e) {
      console.error("addFromLibrary hata:", e, "part:", part);
      alert("Parça eklenirken hata: " + e.message);
    }
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
    if (isLocked) { setSaveError("Bu revizyon kilitli — yeni revizyon oluştur"); return; }
    if (!customerName) { setSaveError("Müşteri seç"); return; }
    if (!quoteNo) { setSaveError("Teklif no boş"); return; }
    if (lines.length === 0) { setSaveError("En az 1 kalem ekle"); return; }
    if (isRevision && !revisionReason.trim()) { setSaveError("Revizyon nedeni zorunlu"); return; }
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
        // Revizyon field'ları — R0 için default 0
        revNo,
        baseQuoteNo: baseQuoteNo || quoteNo,
        parentQuoteNo: parentQuoteNo || null,
        revisionReason: isRevision ? revisionReason.trim() : null,
        // Yapılabilirlik bağlantısı (Faz Y-5 tek, Faz F4 çoklu)
        feasibilityNo: feasibilityNo || null,
        feasibilityNos: feasibilityNos.length > 0 ? feasibilityNos : null,
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
            specialToolMode: l.specialToolMode || "spread",
            specialToolDescription: l.specialToolDescription || "",
            overrides: l.overrides || {},  // satır bazlı marj override
            term: l.term || "",
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

      // Yapılabilirlik bağlantısı — teklif kaydedildikten sonra her feasibility'ye linkedQuoteNo yaz
      const feasibilityLinks = feasibilityNos.length > 0 ? feasibilityNos : (feasibilityNo ? [feasibilityNo] : []);
      if (feasibilityLinks.length > 0) {
        try {
          const { linkFeasibilityToQuote } = await import("../yapilabilirlik/firestore");
          for (const fno of feasibilityLinks) {
            await linkFeasibilityToQuote(fno, quoteNo, { canEdit, staging });
          }
        } catch (e) {
          console.warn("Yapılabilirlik'e teklif bağlanamadı:", feasibilityLinks, e.message);
        }
      }

      const linkMsg = feasibilityLinks.length === 0
        ? ""
        : feasibilityLinks.length === 1
          ? ` (yapılabilirlik ${feasibilityLinks[0]} bağlandı)`
          : ` (${feasibilityLinks.length} yapılabilirlik bağlandı)`;
      setSaveResult({ ok: true, ...out, message: `Teklif kaydedildi: ${quoteNo}${linkMsg}` });
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
      {/* REVİZYON BANNER — R{n} veya R{n} kilitli görüntüleme */}
      {isRevision && (
        <div style={{ marginBottom: 12, padding: 12, background: isLocked ? "#fef2f2" : "#fef3c7", border: `1px solid ${isLocked ? "#fecaca" : "#fde68a"}`, borderRadius: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isLocked ? "#991b1b" : "#92400e", marginBottom: 6 }}>
            {isLocked ? "🔒" : "🔄"} <b>Revizyon {revNo}</b>
            {" — "}Ana teklif: <span style={{ fontFamily: "ui-monospace, monospace" }}>{baseQuoteNo}</span>
            {parentQuoteNo && <> · Önceki: <span style={{ fontFamily: "ui-monospace, monospace" }}>{parentQuoteNo}</span></>}
            {isLocked && <span style={{ marginLeft: 10, padding: "2px 8px", background: "#dc2626", color: "#fff", borderRadius: 3, fontSize: 10 }}>KİLİTLİ</span>}
          </div>
          {isLocked ? (
            <div style={{ fontSize: 11, color: "#991b1b" }}>
              Bu revizyon önceki bir sürümdür — düzenleme yasak. Yeni revizyon oluşturmak için <b>Teklif Listesi</b>'ne git ve aktif revizyon üzerinden "🔄 Revizyon Oluştur" tıkla.
            </div>
          ) : (
            <>
              <label style={{ fontSize: 11, fontWeight: 500, color: "#92400e", display: "block", marginBottom: 4 }}>
                Revizyon Nedeni <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea value={revisionReason} onChange={e => setRevisionReason(e.target.value)}
                placeholder="Örn: Aselsan %8 iskonto talep etti — labor marjı düşürüldü / Malzeme fiyatı arttı — hammadde marjı güncellendi"
                style={{ width: "100%", minHeight: 40, padding: 6, fontSize: 11, border: "1px solid #fde68a", borderRadius: 4, background: "#fff", boxSizing: "border-box" }} />
              {!revisionReason.trim() && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>⚠ Kaydetmek için neden yazılmalı</div>}
            </>
          )}
        </div>
      )}

      {/* YAPILABILIRLIK BAĞLANTI BANNER (Faz Y-5 tek, Faz F4 çoklu) */}
      {(feasibilityNo || feasibilityNos.length > 0) && !isRevision && (
        <div style={{ marginBottom: 12, padding: 10, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, fontSize: 11, color: "#166534" }}>
          {feasibilityNos.length > 1 ? (
            <>
              🔬 <b>{feasibilityNos.length} yapılabilirlikten oluşturuldu</b> — <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{feasibilityNos.join(", ")}</span>
            </>
          ) : (
            <>
              🔬 <b>Yapılabilirlik'ten oluşturuldu</b> — <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{feasibilityNo || feasibilityNos[0]}</span>
            </>
          )}
          <br /><span style={{ fontSize: 10, color: "#15803d" }}>Kalem detayları otomatik dolduruldu. Kaydettiğinde yapılabilirlik{feasibilityNos.length > 1 ? "ler" : ""} "💼 Teklife Dönüştü" durumuna geçer.</span>
        </div>
      )}

      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
        💡 <b>{isRevision ? `Revizyon ${revNo}` : (feasibilityNo ? "Teklif (Yapılabilirlik'ten)" : "Yeni Teklif")}</b> — üstte müşteri + meta, aşağıda parça arama / ekleme. {!isRevision && "Kaydettiğinde her yeni stok kodu otomatik kütüphaneye yazılır."}
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
                machineRatesData={machineRatesData} partsLib={partsLib} paymentTerm={paymentTerm}
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

      {/* AYRI SATIR APARATLAR — kalemlerin altında, teklif toplamı öncesi */}
      {(calc.separateToolItems || []).length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>🛠 Aparat/Kalıp — Ayrı Satırlar</div>
          <div style={{ fontSize: 11, color: "#78716c", marginBottom: 8 }}>
            Bu kalemler müşteriye tekliftte ayrı satır olarak gösterilecek (parça birim fiyatına yayılmayacak).
          </div>
          {(() => {
            const thS = { padding: "6px 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 };
            const tdS = { padding: "6px 8px" };
            return (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                    <th style={thS}>Açıklama</th>
                    <th style={{ ...thS, textAlign: "right" }}>Maliyet</th>
                    <th style={{ ...thS, textAlign: "right" }}>Satış</th>
                    <th style={{ ...thS, textAlign: "right" }}>Kâr</th>
                    <th style={thS}>Kaynak</th>
                  </tr>
                </thead>
                <tbody>
                  {(calc.separateToolItems || []).map((t, i) => {
                    const srcIdx = Number(t?.sourceLineIdx) || 0;
                    const srcLine = lines[srcIdx] || {};
                    const srcCalc = calc.lineResults[srcIdx]?.margins || {};
                    const isOv = !!srcCalc?.overrideActive?.specialTool;
                    const defPct = (srcCalc?.defaults?.specialTool || 0) * 100;
                    const curOv = srcLine.overrides?.specialToolMarginPct;
                    const setOv = (val) => {
                      const next = { ...(srcLine.overrides || {}) };
                      if (val === "" || val === null || val === undefined) delete next.specialToolMarginPct;
                      else next.specialToolMarginPct = Number(val);
                      updateLine(srcIdx, "overrides", next);
                    };
                    return (
                    <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                      <td style={tdS}>{t?.description || "—"}</td>
                      <td style={{ ...tdS, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(t?.cost || 0)}</td>
                      <td style={{ ...tdS, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(t?.sale || 0)}</td>
                      <td style={{ ...tdS, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#16a34a" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <span>+{fmt(t?.profit || 0)}</span>
                          <span style={{ fontSize: 10, color: "#78716c" }}>(</span>
                          <input
                            type="number"
                            step="0.1"
                            value={isOv ? curOv : ""}
                            placeholder={defPct.toFixed(1)}
                            onChange={e => setOv(e.target.value)}
                            style={{ width: 50, padding: "1px 3px", fontSize: 11, textAlign: "right", border: `1px solid ${isOv ? "#3b82f6" : "#cbd5e1"}`, borderRadius: 3 }}
                            title={isOv ? "Override aktif — auto'ya döndürmek için sıfırla" : `Auto: %${defPct.toFixed(2)} (bracket materialFasonPct)`}
                          />
                          <span style={{ fontSize: 10, color: "#78716c" }}>%)</span>
                          {isOv && <button onClick={() => setOv("")} style={{ padding: "0 4px", fontSize: 9, border: "1px solid #cbd5e1", background: "#fff", borderRadius: 3, cursor: "pointer" }} title="Auto'ya döndür">↺</button>}
                        </div>
                      </td>
                      <td style={{ ...tdS, fontSize: 10, color: "#78716c" }}>Kalem #{srcIdx + 1}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {/* TOPLAM ÖZET */}
      <div style={{ ...cardStyle, background: "#f0fdf4", border: "1px solid #86efac" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>6️⃣ Toplam Özet</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 12 }}>
          <div><span style={{ color: "#78716c" }}>Toplam Maliyet:</span> <b>{fmt(calc.totalCostTl)} TL</b></div>
          <div><span style={{ color: "#78716c" }}>Toplam Satış (TL):</span> <b>{fmt(calc.totalSaleTl)} TL</b></div>
          <div><span style={{ color: "#78716c" }}>Toplam Kâr:</span> <b style={{ color: "#16a34a" }}>{fmt(calc.totalProfitTl)} TL</b></div>
          <div><span style={{ color: "#78716c" }}>Kâr Marjı:</span> <b>%{calc.overallMarginPct.toFixed(1)}</b></div>
          {(calc.separateToolItems || []).length > 0 && (
            <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#78716c", paddingTop: 6, borderTop: "1px dashed #86efac" }}>
              Toplam içinde: <b>{(calc.separateToolItems || []).length}</b> ayrı aparat/kalıp satırı ·
              maliyet {fmt((calc.separateToolItems || []).reduce((s, t) => s + (Number(t?.cost) || 0), 0))} TL,
              satış {fmt((calc.separateToolItems || []).reduce((s, t) => s + (Number(t?.sale) || 0), 0))} TL
            </div>
          )}
          {currency !== "TL" && (
            <>
              <div><span style={{ color: "#78716c" }}>Satış ({currency}):</span> <b>{fmt(calc.totalSaleDisplay)}</b></div>
              <div><span style={{ color: "#78716c" }}>Kur:</span> {exchangeRate}</div>
            </>
          )}
        </div>
      </div>

      {/* KAYDET */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={handleSave} disabled={!canEdit || saving} style={btnSave}>
          {saving ? "Kaydediliyor..." : "💾 Teklifi Kaydet"}
        </button>
        <button
          onClick={async () => {
            try {
              const preview = {
                quoteNo, quoteDate, customerName, customerPhone, customerEmail,
                paymentTerm, shipping, shippingCost, shippingIncluded,
                currency, exchangeRate, quoteType, term, notes, status,
                lines: lines.map((l, i) => {
                  const r = calc.lineResults[i];
                  return {
                    stockCode: l.stockCode, musteriKodu: l.musteriKodu, stockName: l.stockName,
                    quantity: l.quantity, unit: l.unit, term: l.term,
                    linePrice: r?.total?.salePrice || 0,
                    salePricePerUnit: r?.perUnit?.salePrice || 0,
                  };
                }),
                totalPriceTl: calc.totalSaleTl,
              };
              await generateQuotePdf(preview, calc);
            } catch (e) {
              alert("PDF hatası: " + e.message);
            }
          }}
          disabled={lines.length === 0}
          style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: lines.length === 0 ? "not-allowed" : "pointer" }}
        >
          📄 PDF Önizle (kaydetmeden)
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

function LineEditor({ idx, line, calcResult, materialList, fasonList, optionsData, machineRatesData, partsLib, paymentTerm, update, updateDim, onRemove }) {

  const addMachine = () => update(idx, "machines", [...(line.machines || []), { name: "", timeMin: 0, ratePerMin: 0 }]);
  const updateMachine = (mi, field, value) => {
    const m = [...(line.machines || [])];
    if (field === "name") {
      // Ad seçilince rateperMin'i otomatik Sevkiyat Pro'dan doldur
      const autoRate = machineRatesData?.ratesByName?.[value];
      m[mi] = { ...m[mi], name: value, ratePerMin: autoRate != null ? autoRate : m[mi].ratePerMin };
    } else {
      m[mi] = { ...m[mi], [field]: (Number(value) || 0) };
    }
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

  // Seçili malzeme fiyat bilgisi
  const selectedMat = materialList.find(m => m.name === line.materialType);

  // Fason iş için geçmiş fiyat öneri: partsLib'de aynı stok koduna sahip parçanın fason gecmişinden
  const fasonHistoryForWork = (workName) => {
    try {
      if (!line.stockCode || !workName || !partsLib?.parts) return [];
      const p = partsLib.parts[line.stockCode];
      if (!p?.fasonGecmis || !Array.isArray(p.fasonGecmis)) return [];
      const wn = String(workName).toLowerCase();
      return p.fasonGecmis.filter(f => String(f?.isTuru || "").toLowerCase() === wn).slice(0, 3);
    } catch (e) {
      console.error("fasonHistoryForWork:", e);
      return [];
    }
  };

  return (
    <div style={{ padding: 12, border: "1px solid #d6d3d1", borderRadius: 6, background: line.fromLibrary ? "#f0fdf4" : "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#57534e" }}>Kalem #{idx + 1}</span>
        {line.fromLibrary && <span style={{ padding: "2px 6px", background: "#dcfce7", color: "#166534", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>KÜTÜPHANEDEN</span>}
        <button onClick={onRemove} style={{ marginLeft: "auto", padding: "3px 8px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 3, fontSize: 10, cursor: "pointer" }}>🗑 Sil</button>
      </div>

      {/* 2 KOLON: SOL %60 giriş alanları, SAĞ %40 detay panel */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(360px, 2fr)", gap: 14, alignItems: "start" }}>
        <div>

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
            {selectedMat && (
              <div style={{ fontSize: 9, color: "#1e40af", marginTop: 2 }}>
                💡 {selectedMat.shape} · özgül {selectedMat.density} · <b>{selectedMat.priceTlPerKg?.toFixed(2)} TL/kg</b> (${selectedMat.priceUsdPerKg}/kg)
              </div>
            )}
          </div>
          <div><label style={miniLabel}>EN (mm)</label><input type="number" value={line.dimensions?.en || 0} onChange={e => updateDim(idx, "en", e.target.value)} style={miniInput} /></div>
          <div><label style={miniLabel}>BOY (mm)</label><input type="number" value={line.dimensions?.boy || 0} onChange={e => updateDim(idx, "boy", e.target.value)} style={miniInput} /></div>
          <div><label style={miniLabel}>UZUNLUK (mm)</label><input type="number" value={line.dimensions?.uzunluk || 0} onChange={e => updateDim(idx, "uzunluk", e.target.value)} style={miniInput} /></div>
          <div><label style={miniLabel}>Ağırlık kg</label>
            <div style={{ padding: "6px 4px", fontSize: 11, background: "#f5f5f4", borderRadius: 3, textAlign: "right", fontWeight: 500 }}>
              {calcResult?.weightKg?.toFixed(3) || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Makineler */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>⚙️ Makineler (Teknik ekip) — TL/dk otomatik Sevkiyat Pro'dan
          <button onClick={addMachine} style={{ marginLeft: 8, padding: "1px 6px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>+ Makine</button>
          {machineRatesData?.refMonth && (
            <span style={{ marginLeft: 8, fontSize: 9, color: "#a8a29e" }}>
              Kaynak ay: {machineRatesData.refMonth} · {(machineRatesData?.machines || []).length} tezgah
            </span>
          )}
        </div>
        {(line.machines || []).map((m, mi) => (
          <div key={mi} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 30px", gap: 6, marginBottom: 4, alignItems: "center" }}>
            <select value={m.name || ""} onChange={e => updateMachine(mi, "name", e.target.value)} style={miniInput}>
              <option value="">— tezgah seç —</option>
              {(machineRatesData?.machines || []).map(mc => (
                <option key={mc.id} value={mc.name}>{mc.name} ({mc.wcName}) · {mc.ratePerMin.toFixed(2)} TL/dk</option>
              ))}
            </select>
            <input type="number" value={m.timeMin || 0} onChange={e => updateMachine(mi, "timeMin", e.target.value)} placeholder="Süre (dk)" style={miniInput} />
            <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
              <input type="number" step="0.01" value={m.ratePerMin || 0} onChange={e => updateMachine(mi, "ratePerMin", e.target.value)} placeholder="TL/dk" style={{ ...miniInput, flex: 1 }} />
              <span style={{ fontSize: 9, color: "#a8a29e" }}>TL/dk</span>
            </div>
            <button onClick={() => removeMachine(mi)} style={{ background: "transparent", color: "#dc2626", border: "none", cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {(line.machines || []).length === 0 && <div style={{ fontSize: 10, color: "#a8a29e", padding: 4 }}>+ Makine eklemek için üstteki butona bas</div>}
      </div>

      {/* Fason */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>🔥 Fason İşler (Satış ekibi)
          <button onClick={addFason} style={{ marginLeft: 8, padding: "1px 6px", fontSize: 10, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 3, cursor: "pointer" }}>+ Fason</button>
          {line.stockCode && <span style={{ marginLeft: 8, fontSize: 9, color: "#a8a29e" }}>Fason iş yazınca geçmiş fiyat önerilir</span>}
        </div>
        {(line.fasonWorks || []).length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 30px", gap: 6, fontSize: 9, color: "#78716c", padding: "0 2px", marginBottom: 2, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>
              <div>Fason İş</div>
              <div>Birim TL</div>
              <div>Miktar</div>
              <div></div>
            </div>
            <div style={{ fontSize: 9, color: "#a8a29e", padding: "0 2px", marginBottom: 4 }}>
              💡 <b>Birim TL × Miktar = fason toplam.</b> Miktar boşsa kalem adedi (<b>{line.quantity || 1}</b>) kullanılır. Toplu iş için: birim TL = paket tutarı, miktar = 1.
            </div>
          </>
        )}
        {(line.fasonWorks || []).map((f, fi) => {
          const history = fasonHistoryForWork(f.name);
          return (
            <div key={fi}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 30px", gap: 6, marginBottom: 4 }}>
                <input list={`fasonList_${idx}_${fi}`} value={f.name || ""} onChange={e => updateFason(fi, "name", e.target.value)} placeholder="Fason iş" style={miniInput} />
                <datalist id={`fasonList_${idx}_${fi}`}>
                  {fasonList.map(w => <option key={w.id} value={w.name} />)}
                </datalist>
                <input type="number" step="0.01" value={f.unitPriceTl || 0} onChange={e => updateFason(fi, "unitPriceTl", e.target.value)} placeholder="Birim TL" title="Fason işin birim fiyatı (adet başına veya toplu paket tutarı)" style={miniInput} />
                <input type="number" value={f.quantity || 0} onChange={e => updateFason(fi, "quantity", e.target.value)} placeholder={`boş = ${line.quantity || 1}`} title={`Fason kaç adete uygulanacak. Boş bırakırsan kalem adedi (${line.quantity || 1}) kullanılır. Toplu paket iş için 1 gir.`} style={miniInput} />
                <button onClick={() => removeFason(fi)} style={{ background: "transparent", color: "#dc2626", border: "none", cursor: "pointer" }}>✕</button>
              </div>
              {history.length > 0 && (
                <div style={{ fontSize: 9, color: "#1e40af", padding: "2px 4px", marginBottom: 6 }}>
                  💡 Geçmiş fiyat: {history.map((h, i) => (
                    <span key={i} style={{ marginRight: 8 }}>
                      <button onClick={() => updateFason(fi, "unitPriceTl", h.fiyatTl)} style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, fontSize: 9, padding: "1px 5px", cursor: "pointer" }}>{h.fiyatTl.toFixed(2)} TL</button>
                      <span style={{ marginLeft: 3, color: "#a8a29e" }}>({h.tarih})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Aparat/kalıp */}
      <div style={sectionStyle}>
        <div style={sectionTitle}>🛠 Aparat / Kalıp / Model</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 6 }}>
          <div>
            <label style={miniLabel}>Toplam Maliyet (TL)</label>
            <input type="number" value={line.specialToolCost || 0} onChange={e => update(idx, "specialToolCost", Number(e.target.value) || 0)} style={miniInput} />
          </div>
          <div>
            <label style={miniLabel}>Açıklama</label>
            <input value={line.specialToolDescription || ""} onChange={e => update(idx, "specialToolDescription", e.target.value)}
              placeholder={line.stockName ? `${line.stockName} — Aparat/Kalıp` : "Aparat / Kalıp adı"} style={miniInput} />
          </div>
          <div>
            <label style={miniLabel}>Faturalama</label>
            <select value={line.specialToolMode || "spread"} onChange={e => update(idx, "specialToolMode", e.target.value)} style={miniInput}>
              <option value="spread">📊 Adete Yay</option>
              <option value="separate">📋 Ayrı Satır</option>
            </select>
          </div>
        </div>
        {(line.specialToolCost || 0) > 0 && (
          <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
            {(line.specialToolMode || "spread") === "spread"
              ? <>Adete yayılıyor: <b>{fmt((line.specialToolCost || 0) / (line.quantity || 1))} TL/adet</b> parça birim fiyatına ekleniyor</>
              : <>Ayrı satır: müşteriye "<b>{line.specialToolDescription || (line.stockName + " — Aparat/Kalıp")}</b>" ismiyle {fmt(line.specialToolCost)} TL + marj olarak gösterilecek</>
            }
          </div>
        )}
      </div>

      {/* Termin + Teknik Not */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 6, marginBottom: 10 }}>
        <div>
          <label style={miniLabel}>Termin (satır bazlı)</label>
          <input value={line.term || ""} onChange={e => update(idx, "term", e.target.value)} placeholder="örn. 30 GÜN — boş bırakırsan meta termin" style={miniInput} />
          <div style={{ fontSize: 9, color: "#a8a29e", marginTop: 2 }}>
            Boş bırakırsan üstteki genel termin kullanılır. Farklıysa PDF'te bu satırda görünür.
          </div>
        </div>
        <div>
          <label style={miniLabel}>Teknik Not</label>
          <input value={line.technicalNote || ""} onChange={e => update(idx, "technicalNote", e.target.value)} placeholder="Özel işlem, tolerans, notlar..." style={miniInput} />
        </div>
      </div>

      {/* HESAP ÖZETİ (kompakt) */}
      {calcResult && calcResult.total.totalCost > 0 && (
        <div style={{ padding: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, fontSize: 10, color: "#166534" }}>
          <b>Bu Kalem:</b> Adet Maliyet: {fmt(calcResult.perUnit.totalCost)} · Adet Satış: <b>{fmt(calcResult.perUnit.salePrice)}</b>
          {" · "}Toplam: <b>{fmt(calcResult.total.salePrice)}</b>
          {" · "}Marj: <b>%{calcResult.margins.profitPct.toFixed(1)}</b>
          {" · "}Aralık: {calcResult.margins.quantityBracket} · Grup: {calcResult.margins.paymentGroup}
        </div>
      )}
        </div>

        {/* SAĞ SÜTUN: DETAY PANEL — her zaman açık, uzun kalemlerde takip için sticky */}
        <div style={{ position: "sticky", top: 10, alignSelf: "start", maxHeight: "calc(100vh - 40px)", overflow: "auto" }}>
          {calcResult
            ? <LineDetailPanel idx={idx} line={line} calcResult={calcResult} selectedMat={selectedMat} paymentTerm={paymentTerm} update={update} />
            : <div style={{ padding: 10, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6, color: "#94a3b8", fontSize: 11 }}>Hesap için hammadde/makine/fason bilgisi girin</div>}
        </div>
      </div>
    </div>
  );
}

// ==================== Detay Panel — 1 adet için kırılım ====================

// Marj override input satırı — default etiket + input + auto sıfırlama
function MarginRow({ label, defaultPct, effectivePct, active, currentValue, onChange, hint }) {
  return (
    <>
      <td style={detailLabel}>
        {label}
        {" "}
        {active
          ? <span style={{ background: "#dbeafe", color: "#1e40af", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600, marginLeft: 4 }}>OVERRIDE</span>
          : <span style={{ background: "#f5f5f4", color: "#78716c", padding: "1px 5px", borderRadius: 3, fontSize: 9, marginLeft: 4 }}>AUTO</span>}
      </td>
      <td style={detailValue}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          {!active && <span style={{ fontSize: 10, color: "#a8a29e" }}>varsayılan %{defaultPct.toFixed(2)}</span>}
          <input
            type="number"
            step="0.1"
            value={active ? currentValue : ""}
            placeholder={defaultPct.toFixed(1)}
            onChange={e => onChange(e.target.value)}
            style={{ width: 60, padding: "2px 4px", fontSize: 11, textAlign: "right", border: "1px solid #cbd5e1", borderRadius: 3 }}
            title={hint || "Boş bırakırsan bracket + grup marjı kullanılır"}
          />
          <span style={{ fontSize: 11 }}>%</span>
          {active && (
            <button onClick={() => onChange("")} style={{ padding: "1px 5px", fontSize: 9, border: "1px solid #cbd5e1", background: "#fff", borderRadius: 3, cursor: "pointer" }} title="Auto'ya döndür">↺</button>
          )}
        </div>
      </td>
    </>
  );
}

function LineDetailPanel({ idx, line, calcResult, selectedMat, paymentTerm, update }) {
  if (!calcResult || !calcResult.margins || !calcResult.perUnit) {
    return <div style={{ padding: 10, color: "#a8a29e", fontSize: 11 }}>Hesap için hammadde/makine/fason bilgisi girin</div>;
  }
  const qty = Number(line.quantity) || 1;
  const machines = line.machines || [];
  const fasonWorks = line.fasonWorks || [];
  const margins = calcResult.margins || {};
  const perUnit = calcResult.perUnit || {};
  const defaults = margins.defaults || {};
  const activeOv = margins.overrideActive || {};
  const currentOv = line.overrides || {};

  const setOverride = (key, val) => {
    const next = { ...(line.overrides || {}) };
    if (val === "" || val === null || val === undefined) delete next[key];
    else next[key] = Number(val);
    update(idx, "overrides", next);
  };

  // Adet başına marj çarpanları (calcResult.margins'ten)
  const materialMarginPct = (margins.material || 0) * 100;
  const laborMarginPct = (margins.labor || 0) * 100;
  const fasonMarginPct = (margins.fason || 0) * 100;
  const specialToolMarginPct = (margins.specialTool || 0) * 100;

  // Adet başına kalemler
  const matPerUnit = perUnit.material || 0;
  const matSalePerUnit = matPerUnit * (1 + (margins.material || 0));
  const matProfitPerUnit = matSalePerUnit - matPerUnit;

  const laborPerUnit = perUnit.labor || 0;
  const laborSalePerUnit = laborPerUnit * (1 + (margins.labor || 0));
  const laborProfitPerUnit = laborSalePerUnit - laborPerUnit;

  const fasonPerUnit = perUnit.fason || 0;
  const fasonSalePerUnit = fasonPerUnit * (1 + (margins.fason || 0));
  const fasonProfitPerUnit = fasonSalePerUnit - fasonPerUnit;

  const toolPerUnit = perUnit.specialTool || 0;
  const toolSalePerUnit = toolPerUnit * (1 + (margins.specialTool || 0));
  const toolProfitPerUnit = toolSalePerUnit - toolPerUnit;

  const totalCostPerUnit = perUnit.totalCost || 0;
  const totalSalePerUnit = perUnit.salePrice || 0;
  const totalProfitPerUnit = totalSalePerUnit - totalCostPerUnit;

  return (
    <div style={{ padding: 12, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#1e293b" }}>
        📊 1 Adet İçin Maliyet Kırılımı ({qty} adet × formül)
      </div>

      {/* HAMMADDE */}
      {matPerUnit > 0 && (
        <div style={detailSection}>
          <div style={detailSectionTitle}>🧱 Hammadde</div>
          <table style={detailTable}>
            <tbody>
              <tr><td style={detailLabel}>Ağırlık</td><td style={detailValue}>{calcResult.weightKg.toFixed(3)} kg</td></tr>
              <tr><td style={detailLabel}>Birim fiyat</td><td style={detailValue}>{fmt(selectedMat?.priceTlPerKg || 0)} TL/kg</td></tr>
              <tr><td style={detailLabel}>Malzeme maliyeti (adet)</td><td style={detailValueBold}>{fmt(matPerUnit)} TL</td></tr>
              <tr>
                <MarginRow
                  label="Marj (miktar + vade grubu)"
                  defaultPct={(defaults.material || 0) * 100}
                  effectivePct={materialMarginPct}
                  active={activeOv.material}
                  currentValue={currentOv.materialMarginPct}
                  onChange={v => setOverride("materialMarginPct", v)}
                  hint="Revizyonda müşteriye düşük fiyat vermek için düşürebilirsin"
                />
              </tr>
              <tr style={{ borderTop: "1px solid #cbd5e1" }}>
                <td style={detailLabel}><b>Satış (adet)</b></td>
                <td style={detailValueBold}>{fmt(matSalePerUnit)} TL</td>
              </tr>
              <tr>
                <td style={detailLabel}>Kâr (adet)</td>
                <td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(matProfitPerUnit)} TL (%{materialMarginPct.toFixed(1)})</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* İŞÇİLİK */}
      {laborPerUnit > 0 && (
        <div style={detailSection}>
          <div style={detailSectionTitle}>⚙️ İşçilik (Makine × Süre × TL/dk)</div>
          <table style={detailTable}>
            <thead>
              <tr>
                <th style={detailTh}>Makine</th>
                <th style={{ ...detailTh, textAlign: "right" }}>Süre</th>
                <th style={{ ...detailTh, textAlign: "right" }}>TL/dk</th>
                <th style={{ ...detailTh, textAlign: "right" }}>Adet Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m, mi) => {
                const cost = (Number(m.timeMin) || 0) * (Number(m.ratePerMin) || 0);
                return (
                  <tr key={mi}>
                    <td style={detailLabel}>{m.name || "—"}</td>
                    <td style={detailValue}>{m.timeMin || 0} dk</td>
                    <td style={detailValue}>{fmt(m.ratePerMin || 0)}</td>
                    <td style={detailValueBold}>{fmt(cost)} TL</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "1px solid #cbd5e1" }}>
                <td colSpan="3" style={detailLabel}><b>İşçilik toplam (adet)</b></td>
                <td style={detailValueBold}>{fmt(laborPerUnit)} TL</td>
              </tr>
              <tr>
                <td colSpan="2" style={detailLabel}></td>
                <MarginRow
                  label="Marj (miktar + malz özel)"
                  defaultPct={(defaults.labor || 0) * 100}
                  effectivePct={laborMarginPct}
                  active={activeOv.labor}
                  currentValue={currentOv.laborMarginPct}
                  onChange={v => setOverride("laborMarginPct", v)}
                />
              </tr>
              <tr>
                <td colSpan="3" style={detailLabel}><b>Satış (adet)</b></td>
                <td style={detailValueBold}>{fmt(laborSalePerUnit)} TL</td>
              </tr>
              <tr>
                <td colSpan="3" style={detailLabel}>Kâr (adet)</td>
                <td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(laborProfitPerUnit)} TL (%{laborMarginPct.toFixed(1)})</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* FASON */}
      {fasonPerUnit > 0 && (
        <div style={detailSection}>
          <div style={detailSectionTitle}>🔥 Fason İşler</div>
          <table style={detailTable}>
            <thead>
              <tr>
                <th style={detailTh}>İş</th>
                <th style={{ ...detailTh, textAlign: "right" }}>Birim TL</th>
                <th style={{ ...detailTh, textAlign: "right" }}>Adet Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {fasonWorks.map((f, fi) => {
                const fQty = Number(f.quantity) || qty;
                const totalCost = (Number(f.unitPriceTl) || 0) * fQty;
                const perUnit = totalCost / qty;
                return (
                  <tr key={fi}>
                    <td style={detailLabel}>{f.name || "—"}</td>
                    <td style={detailValue}>{fmt(f.unitPriceTl || 0)}</td>
                    <td style={detailValueBold}>{fmt(perUnit)} TL</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "1px solid #cbd5e1" }}>
                <td colSpan="2" style={detailLabel}><b>Fason toplam (adet)</b></td>
                <td style={detailValueBold}>{fmt(fasonPerUnit)} TL</td>
              </tr>
              <tr>
                <td colSpan="1" style={detailLabel}></td>
                <MarginRow
                  label="Marj"
                  defaultPct={(defaults.fason || 0) * 100}
                  effectivePct={fasonMarginPct}
                  active={activeOv.fason}
                  currentValue={currentOv.fasonMarginPct}
                  onChange={v => setOverride("fasonMarginPct", v)}
                />
              </tr>
              <tr>
                <td colSpan="2" style={detailLabel}><b>Satış (adet)</b></td>
                <td style={detailValueBold}>{fmt(fasonSalePerUnit)} TL</td>
              </tr>
              <tr>
                <td colSpan="2" style={detailLabel}>Kâr (adet)</td>
                <td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(fasonProfitPerUnit)} TL (%{fasonMarginPct.toFixed(1)})</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* APARAT — spread (adete yay) modu: adet başına kırılım */}
      {toolPerUnit > 0 && (
        <div style={detailSection}>
          <div style={detailSectionTitle}>🛠 Aparat/Kalıp (adete yayılıyor)</div>
          <table style={detailTable}>
            <tbody>
              <tr><td style={detailLabel}>Toplam maliyet ({qty} adete yayılıyor)</td><td style={detailValue}>{fmt(line.specialToolCost || 0)} TL</td></tr>
              <tr><td style={detailLabel}>Adet maliyet</td><td style={detailValueBold}>{fmt(toolPerUnit)} TL</td></tr>
              <tr>
                <MarginRow
                  label="Marj"
                  defaultPct={(defaults.specialTool || 0) * 100}
                  effectivePct={specialToolMarginPct}
                  active={activeOv.specialTool}
                  currentValue={currentOv.specialToolMarginPct}
                  onChange={v => setOverride("specialToolMarginPct", v)}
                />
              </tr>
              <tr><td style={detailLabel}><b>Satış (adet)</b></td><td style={detailValueBold}>{fmt(toolSalePerUnit)} TL</td></tr>
              <tr><td style={detailLabel}>Kâr (adet)</td><td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(toolProfitPerUnit)} TL</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {/* APARAT — separate (ayrı satır) modu: toplam üzerinden + marj düzenleme */}
      {(line.specialToolCost || 0) > 0 && (line.specialToolMode || "spread") === "separate" && (
        <div style={{ ...detailSection, background: "#fef3c7", borderColor: "#fde68a" }}>
          <div style={detailSectionTitle}>🛠 Aparat/Kalıp (ayrı satır — teklif altında)</div>
          <table style={detailTable}>
            <tbody>
              <tr><td style={detailLabel}>Toplam maliyet</td><td style={detailValueBold}>{fmt(calcResult?.separateTool?.cost || 0)} TL</td></tr>
              <tr>
                <MarginRow
                  label="Marj"
                  defaultPct={(defaults.specialTool || 0) * 100}
                  effectivePct={specialToolMarginPct}
                  active={activeOv.specialTool}
                  currentValue={currentOv.specialToolMarginPct}
                  onChange={v => setOverride("specialToolMarginPct", v)}
                />
              </tr>
              <tr><td style={detailLabel}><b>Toplam satış</b></td><td style={detailValueBold}>{fmt(calcResult?.separateTool?.sale || 0)} TL</td></tr>
              <tr><td style={detailLabel}>Toplam kâr</td><td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(calcResult?.separateTool?.profit || 0)} TL</td></tr>
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: "#78716c", marginTop: 6 }}>
            Bu tutar müşteriye tekliftte ayrı bir satır olarak gösterilecek — birim fiyata yayılmıyor.
          </div>
        </div>
      )}

      {/* GENEL ÖZET */}
      <div style={{ padding: 10, background: "#dcfce7", border: "1px solid #86efac", borderRadius: 4, marginTop: 8 }}>
        <table style={detailTable}>
          <tbody>
            <tr><td style={detailLabel}><b>1 Adet Toplam Maliyet</b></td><td style={detailValueBold}>{fmt(totalCostPerUnit)} TL</td></tr>
            <tr><td style={detailLabel}><b>1 Adet Satış</b></td><td style={{ ...detailValueBold, fontSize: 13, color: "#166534" }}>{fmt(totalSalePerUnit)} TL</td></tr>
            <tr><td style={detailLabel}><b>1 Adet Kâr</b></td><td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(totalProfitPerUnit)} TL (%{calcResult.margins.profitPct.toFixed(2)})</td></tr>
            <tr style={{ borderTop: "1px solid #86efac" }}>
              <td style={detailLabel}>{qty} adet için toplam satış</td>
              <td style={detailValueBold}>{fmt(calcResult.total.salePrice)} TL</td>
            </tr>
            <tr>
              <td style={detailLabel}>{qty} adet için toplam kâr</td>
              <td style={{ ...detailValueBold, color: "#16a34a" }}>+{fmt(calcResult.total.profit)} TL</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* İSKONTO SİMÜLASYONU */}
      <div style={{ marginTop: 8, padding: 8, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>💰 İskonto Simülasyonu — kâr sıfırlanana kadar indirim payı</div>
        <div style={{ fontSize: 10, color: "#92400e" }}>
          Maksimum iskonto: <b>{((totalProfitPerUnit / totalSalePerUnit) * 100).toFixed(1)}%</b>
          {" — "}bu iskonto verilirse kâr 0 olur (maliyete satış). Kâr marjı %{calcResult.margins.profitPct.toFixed(1)} olduğu için pratik olarak %{((totalProfitPerUnit / totalSalePerUnit) * 100 * 0.5).toFixed(1)} iskonto sağlıklı sınır.
        </div>
      </div>
    </div>
  );
}

const detailSection = { marginBottom: 8, padding: 8, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 4 };
const detailSectionTitle = { fontSize: 11, fontWeight: 600, marginBottom: 6, color: "#1e293b" };
const detailTable = { width: "100%", borderCollapse: "collapse", fontSize: 11 };
const detailTh = { padding: "3px 6px", fontWeight: 600, fontSize: 10, color: "#475569", textAlign: "left" };
const detailLabel = { padding: "3px 6px", color: "#475569", fontSize: 11 };
const detailValue = { padding: "3px 6px", fontVariantNumeric: "tabular-nums", textAlign: "right", fontSize: 11 };
const detailValueBold = { padding: "3px 6px", fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 600, fontSize: 11 };

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
    specialToolMode: "spread",
    specialToolDescription: "",
    term: "",
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

// "EN:20 × BOY:30 × UZ:100" gibi string dimension'ı obje'ye çevir
function parseDimensionsString(str) {
  if (!str || typeof str !== "string") return { en: 0, boy: 0, uzunluk: 0 };
  const matchNum = (label) => {
    const re = new RegExp(`${label}\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)`, "i");
    const m = str.match(re);
    return m ? Number(String(m[1]).replace(",", ".")) || 0 : 0;
  };
  return {
    en: matchNum("EN"),
    boy: matchNum("BOY"),
    uzunluk: matchNum("UZ|UZUNLUK|BOY(?:U)?"),
  };
}

// initialQuote'tan gelen lines'ı runtime'a uygun formata normalize et.
// Excel arşivi machines/fasonWorks'ü STRING olarak, dimensions'ı STRING olarak tutuyor.
// UI array/obje bekliyor — dönüştürelim, aksi halde LineEditor render'ında crash olur.
function normalizeIncomingLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines.map(l => {
    if (!l) return null;
    const machines = Array.isArray(l.machines)
      ? l.machines
      : parseMachinesString(l.machines, l.machineTimeMin);
    const fasonWorks = Array.isArray(l.fasonWorks)
      ? l.fasonWorks
      : parseFasonString(l.fasonWorks);
    const dimensions = (l.dimensions && typeof l.dimensions === "object")
      ? { en: Number(l.dimensions.en) || 0, boy: Number(l.dimensions.boy) || 0, uzunluk: Number(l.dimensions.uzunluk) || 0 }
      : parseDimensionsString(l.dimensions);
    return {
      stockCode: l.stockCode || "",
      musteriKodu: l.musteriKodu || "",
      stockName: l.stockName || "",
      quantity: Number(l.quantity) || 1,
      unit: l.unit || "ADET",
      materialType: l.materialType || "",
      dimensions,
      weightKg: Number(l.weightKg) || 0,
      machines,
      fasonWorks,
      specialToolCost: Number(l.specialToolCost) || 0,
      specialToolMode: l.specialToolMode || "spread",
      specialToolDescription: l.specialToolDescription || "",
      overrides: (l.overrides && typeof l.overrides === "object") ? l.overrides : {},
      term: l.term || "",
      technicalNote: l.technicalNote || "",
    };
  }).filter(Boolean);
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
