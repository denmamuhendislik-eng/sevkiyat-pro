import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { parsePurchaseWithPrices } from "./purchaseParser";
import { subscribeUnitCosts, saveUnitCostPartitions, clearUnitCosts } from "./firestore";

const fmt = (n, frac = 2) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: frac, maximumFractionDigits: frac });
const fmtDate = (s) => s ? new Date(s + "T00:00:00Z").toLocaleDateString("tr-TR") : "—";

const CURRENCY_OPTIONS = ["TRY", "USD", "EUR"];

export default function UnitCostsTab({ canEdit, isAdmin }) {
  const [unitCosts, setUnitCosts] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(null); // parser çıktısı
  const [previewOverrides, setPreviewOverrides] = useState({}); // { rowIdx: currency }
  const [saving, setSaving] = useState(false);
  const [searchStock, setSearchStock] = useState("");
  const [showPreviewAll, setShowPreviewAll] = useState(false);
  const [manualForm, setManualForm] = useState(null);  // null | { code, name, unitPriceTl, currency, orderDate, supplier }
  const [manualSaving, setManualSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeUnitCosts((data) => {
      setUnitCosts(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parsePurchaseWithPrices(wb);
      setPreview(result);
      setPreviewOverrides({});
    } catch (err) {
      alert("Excel okuma hatası: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  const applyBulkCurrency = (currency) => {
    if (!preview) return;
    const ov = { ...previewOverrides };
    preview.partitions.forEach(p => {
      if (p.currencyGuess) ov[p.rowIdx] = currency;
    });
    setPreviewOverrides(ov);
  };

  const handleSave = async () => {
    if (!preview || !canEdit) return;
    setSaving(true);
    try {
      const finalParts = preview.partitions.map(p => ({
        ...p,
        currency: previewOverrides[p.rowIdx] || p.currency,
        // override edildiyse guess null'la
        currencyGuess: previewOverrides[p.rowIdx] ? null : p.currencyGuess,
      }));
      const res = await saveUnitCostPartitions(unitCosts, finalParts, { canEdit });
      alert(`✓ Kayıt tamam:\n${res.added} yeni parti eklendi\n${res.skipped} duplicate atlandı`);
      setPreview(null);
      setPreviewOverrides({});
    } catch (e) {
      alert("Kaydetme hatası: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const openManualForm = () => {
    setManualForm({
      code: "", name: "", unitPriceTl: "", currency: "TRY",
      orderDate: new Date().toISOString().slice(0, 10),
      originalQty: "", supplier: "",
      priceUnit: "AD", weightPerPiece: "",
    });
  };

  const handleManualSave = async () => {
    if (!manualForm || !canEdit || manualSaving) return;
    const code = (manualForm.code || "").trim();
    const rawPrice = Number(manualForm.unitPriceTl);
    if (!code) { alert("Stok kodu zorunlu"); return; }
    if (!(rawPrice > 0)) { alert("Birim fiyat sıfırdan büyük olmalı"); return; }
    // KG bazlı fiyat girilmişse parça ağırlığı ile çarpıp AD fiyata çeviriyoruz.
    // Sebep: downstream hesaplar (productCostCalc, inventoryCalc) AD bazında çalışır,
    // VIO da Satır Net Fiyatı ile AD'ye çevirip yazıyor — manuel kayıt aynı formatta olmalı.
    let price = rawPrice;
    if (manualForm.priceUnit === "KG") {
      const w = Number(manualForm.weightPerPiece);
      if (!(w > 0)) { alert("KG bazlı fiyat girdin — parça ağırlığı (kg/AD) zorunlu"); return; }
      price = rawPrice * w;
    }
    setManualSaving(true);
    try {
      const partition = {
        belgeNo: "MANUEL-" + Date.now().toString(36),
        orderDate: manualForm.orderDate || new Date().toISOString().slice(0, 10),
        code,
        name: (manualForm.name || "").trim(),
        unit: "AD",
        originalQty: Number(manualForm.originalQty) || 0,
        shippedQty: 0,
        remainingQty: Number(manualForm.originalQty) || 0,
        unitPriceTl: price,
        unitPriceDvz: 0,
        currency: manualForm.currency || "TRY",
        currencyGuess: null,
        supplierCode: "",
        supplier: (manualForm.supplier || "").trim() || "Manuel kayıt",
        _rawPrice: price,
        _rawDvzPrice: 0,
        _has2ndUnitDiscrepancy: false,
      };
      const res = await saveUnitCostPartitions(unitCosts, [partition], { canEdit });
      if (res.added > 0) {
        alert("✓ Manuel parti eklendi");
        setManualForm(null);
      } else {
        alert("Bu parti zaten kayıtlı (duplicate)");
      }
    } catch (e) {
      alert("Hata: " + e.message);
    } finally {
      setManualSaving(false);
    }
  };

  const handleClear = async () => {
    if (!isAdmin) return;
    if (!confirm("TÜM birim maliyet kayıtlarını silmek istediğine emin misin? Bu işlem geri alınamaz.")) return;
    try {
      await clearUnitCosts({ canEdit, isAdmin });
      alert("✓ Sıfırlandı");
    } catch (e) {
      alert("Silme hatası: " + e.message);
    }
  };

  // Otomasyon durumu — unitCosts.lastImport'tan hesaplanır
  const automationStatus = useMemo(() => {
    const lastImport = unitCosts?.lastImport;
    if (!lastImport) return { state: "none" };
    const ageHours = (Date.now() - new Date(lastImport).getTime()) / 3600000;
    let state;
    if (ageHours <= 24) state = "ok";
    else if (ageHours <= 72) state = "warn";
    else state = "stale";
    return { state, ageHours, lastImport };
  }, [unitCosts]);

  // Mevcut kayıtların özeti
  const stored = useMemo(() => {
    const byStock = unitCosts?.byStock || {};
    const stockKeys = Object.keys(byStock);
    let totalParts = 0, totalRemainingQty = 0, totalRemainingTl = 0, totalOriginalTl = 0;
    let lastImport = unitCosts?.lastImport || null;
    for (const code of stockKeys) {
      const slot = byStock[code];
      for (const p of (slot.partitions || [])) {
        totalParts++;
        totalRemainingQty += p.remainingQty || 0;
        totalRemainingTl += (p.remainingQty || 0) * (p.unitPriceTl || 0);
        totalOriginalTl += (p.originalQty || 0) * (p.unitPriceTl || 0);
      }
    }
    return { stockCount: stockKeys.length, totalParts, totalRemainingQty, totalRemainingTl, totalOriginalTl, lastImport };
  }, [unitCosts]);

  const filteredStocks = useMemo(() => {
    const byStock = unitCosts?.byStock || {};
    const q = searchStock.trim().toLocaleLowerCase("tr-TR");
    return Object.entries(byStock)
      .filter(([code, slot]) => {
        if (!q) return true;
        const name = slot.lastName || slot.partitions?.[slot.partitions.length - 1]?.name || "";
        return code.toLocaleLowerCase("tr-TR").includes(q) || name.toLocaleLowerCase("tr-TR").includes(q);
      })
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [unitCosts, searchStock]);

  if (!loaded) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;
  }

  return (
    <div>
      {/* Otomasyon durum rozetı */}
      <UnitCostsAutomationBadge status={automationStatus} />

      {/* Excel yükleme */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>VIO Satın Alma Raporu (Sipariş Kontrol Listesi, Fiyatlı):</span>
        {canEdit && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--color-border-info)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
            >
              📤 Excel yükle
            </button>
            <button
              onClick={openManualForm}
              title="VIO'dan gelmeyen parça için manuel birim fiyat ekle"
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed var(--color-border-info)", background: "transparent", color: "var(--color-text-info)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
            >
              + Manuel parti
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleFile}
        />
        {stored.lastImport && (
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            Son içe alım: {new Date(stored.lastImport).toLocaleString("tr-TR")}
          </span>
        )}
        {isAdmin && stored.totalParts > 0 && (
          <button
            onClick={handleClear}
            style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 5, border: "1px solid #FCA5A5", background: "transparent", color: "#DC2626", cursor: "pointer", fontSize: 10 }}
          >
            Tümünü sıfırla
          </button>
        )}
      </div>

      {/* Önizleme paneli (yeni yükleme) */}
      {preview && (
        <PreviewPanel
          preview={preview}
          previewOverrides={previewOverrides}
          setPreviewOverrides={setPreviewOverrides}
          applyBulkCurrency={applyBulkCurrency}
          handleSave={handleSave}
          saving={saving}
          onClose={() => { setPreview(null); setPreviewOverrides({}); }}
          canEdit={canEdit}
          showAll={showPreviewAll}
          setShowAll={setShowPreviewAll}
        />
      )}

      {/* Manuel parti ekleme modal */}
      {manualForm && (
        <ManualPartitionModal
          form={manualForm}
          setForm={setManualForm}
          onSave={handleManualSave}
          saving={manualSaving}
          onClose={() => setManualForm(null)}
        />
      )}

      {/* Mevcut kayıtlar özeti + tablo */}
      {!preview && (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8, marginBottom: 12, flexWrap: "wrap", fontSize: 12 }}>
            <span><b>{stored.stockCount}</b> stok</span>
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
            <span><b>{stored.totalParts}</b> parti</span>
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
            <span title="Eldeki açık partilerin TL değeri (kalan miktar × birim TL)">
              Açık değer: <b>{fmt(stored.totalRemainingTl)}</b> ₺
            </span>
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
            <span title="Tüm partilerin orijinal toplam TL bedeli">
              Toplam alım: <b>{fmt(stored.totalOriginalTl)}</b> ₺
            </span>
          </div>

          {stored.totalParts === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🏷</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Birim maliyet kaydı yok</div>
              <div style={{ fontSize: 12 }}>VIO satın alma raporu (fiyat kolonlu) yükle</div>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Stok kodu veya isim ara..."
                value={searchStock}
                onChange={e => setSearchStock(e.target.value)}
                style={{ width: "100%", maxWidth: 320, padding: "6px 12px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", fontSize: 12, marginBottom: 10 }}
              />
              <StockPartitionsTable stocks={filteredStocks.slice(0, 100)} totalStocks={filteredStocks.length} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function PreviewPanel({ preview, previewOverrides, setPreviewOverrides, applyBulkCurrency, handleSave, saving, onClose, canEdit, showAll, setShowAll }) {
  const s = preview.summary;
  const finalPartitions = preview.partitions.map(p => ({
    ...p,
    currency: previewOverrides[p.rowIdx] || p.currency,
    isOverridden: !!previewOverrides[p.rowIdx],
  }));
  const guessRows = finalPartitions.filter(p => p.currencyGuess && !p.isOverridden);
  const visible = showAll ? finalPartitions : finalPartitions.slice(0, 50);

  return (
    <div style={{ border: "2px solid var(--color-border-info)", borderRadius: 8, padding: 14, marginBottom: 16, background: "var(--color-background-info-subtle, #EFF6FF)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-info)" }}>📋 Yükleme Önizlemesi</span>
        <span style={{ fontSize: 11 }}>
          <b>{s.rowCount}</b> parti · <b>{s.stockCount}</b> stok · <b>{s.supplierCount}</b> tedarikçi · Toplam: <b>{fmt(s.totalTl)} ₺</b>
        </span>
        <button onClick={onClose} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, cursor: "pointer" }}>İptal</button>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontWeight: 500, fontSize: 12, cursor: saving ? "default" : "pointer" }}
          >
            {saving ? "Kaydediliyor..." : "✓ Onayla & Kaydet"}
          </button>
        )}
      </div>

      {/* Uyarılar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "#ECFDF5", color: "#065F46", border: "0.5px solid #A7F3D0" }}>✓ {s.tlOnly} TL</span>
        <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "#ECFDF5", color: "#065F46", border: "0.5px solid #A7F3D0" }}>✓ {s.dvzKnown} Dvz (kod biliniyor)</span>
        {s.dvzGuessed > 0 && (
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", border: "0.5px solid #FCD34D" }}>
            ⚠ {s.dvzGuessed} Dvz tahmin {s.dvzGuessLowConf > 0 ? `(${s.dvzGuessLowConf} düşük güven)` : ""}
          </span>
        )}
        {s.with2ndUnit > 0 && (
          <span title="VIO 2.brm (kg) cinsinden fiyat verdiği satırlar — parser 'Satır Net Fiyatı' (adet birim) kullanır, sorun değil" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", border: "0.5px solid #FCD34D" }}>
            ℹ {s.with2ndUnit} satırda 2.brm devrede (Net Fiyat kullanıldı)
          </span>
        )}
      </div>

      {/* Toplu eylem */}
      {guessRows.length > 0 && canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10, padding: "6px 10px", background: "var(--color-background-primary)", borderRadius: 5, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 500 }}>Tahminleri toplu ayarla:</span>
          <button onClick={() => applyBulkCurrency("EUR")} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, cursor: "pointer" }}>Tümü EUR</button>
          <button onClick={() => applyBulkCurrency("USD")} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, cursor: "pointer" }}>Tümü USD</button>
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>(veya aşağıda tek tek seç)</span>
        </div>
      )}

      {/* Tablo */}
      <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 6, overflow: "hidden", background: "var(--color-background-primary)" }}>
        <div style={{ overflowX: "auto", maxHeight: 500 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--color-background-secondary)" }}>
              <tr>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, fontSize: 10 }}>Tarih</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, fontSize: 10 }}>Belge</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, fontSize: 10 }}>Stok Kodu</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, fontSize: 10 }}>Stok Adı</th>
                <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 500, fontSize: 10 }}>Orijinal</th>
                <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 500, fontSize: 10 }}>Kalan</th>
                <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 500, fontSize: 10 }}>Birim TL</th>
                <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: 500, fontSize: 10 }}>Para</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, fontSize: 10 }}>Tedarikçi</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const isGuess = !!p.currencyGuess && !p.isOverridden;
                return (
                  <tr key={p.rowIdx} style={{ borderTop: "0.5px solid var(--color-border-tertiary)", background: isGuess ? "#FEF9E7" : "transparent" }}>
                    <td style={{ padding: "4px 8px", fontSize: 10 }}>{fmtDate(p.orderDate)}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 10 }}>{p.belgeNo}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 10 }}>{p.code}</td>
                    <td style={{ padding: "4px 8px", fontSize: 10, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10 }}>{fmt(p.originalQty, 0)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: p.remainingQty > 0 ? "var(--color-text-secondary)" : "var(--color-text-tertiary)" }}>{fmt(p.remainingQty, 0)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500 }}>{fmt(p.unitPriceTl)}</td>
                    <td style={{ padding: "4px 4px", textAlign: "center" }}>
                      {isGuess && canEdit ? (
                        <select
                          value={previewOverrides[p.rowIdx] || p.currency}
                          onChange={e => setPreviewOverrides(prev => ({ ...prev, [p.rowIdx]: e.target.value }))}
                          style={{ padding: "2px 4px", borderRadius: 3, border: "1px solid #FCD34D", background: "#FEF3C7", fontSize: 10 }}
                          title={`Tahmin: ${p.currency} (${p.currencyGuess.confidence}) — ratio ${p.currencyGuess.observedRatio || ""}`}
                        >
                          {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}{c === p.currency ? "?" : ""}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: p.currency === "TRY" ? "var(--color-background-secondary)" : "#DBEAFE", color: p.currency === "TRY" ? "var(--color-text-tertiary)" : "#1D4ED8", fontWeight: 500 }}>
                          {p.currency}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "4px 8px", fontSize: 10, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.supplier}>{p.supplier}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {finalPartitions.length > 50 && (
          <div style={{ padding: "6px 10px", textAlign: "center", background: "var(--color-background-secondary)" }}>
            <button onClick={() => setShowAll(v => !v)} style={{ background: "transparent", border: "none", color: "var(--color-text-info)", cursor: "pointer", fontSize: 11 }}>
              {showAll ? `↑ İlk 50'yi göster` : `↓ Tümünü göster (${finalPartitions.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StockPartitionsTable({ stocks, totalStocks }) {
  const [openStock, setOpenStock] = useState(null);
  return (
    <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px 110px 110px 90px", padding: "8px 12px", background: "var(--color-background-secondary)", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
        <span>Stok Kodu</span>
        <span>Ad</span>
        <span style={{ textAlign: "right" }}>Parti</span>
        <span style={{ textAlign: "right" }}>Kalan</span>
        <span style={{ textAlign: "right" }}>Açık ₺</span>
        <span style={{ textAlign: "center" }}>Son alım</span>
      </div>
      {stocks.map(([code, slot]) => {
        const parts = slot.partitions || [];
        const totalRemain = parts.reduce((s, p) => s + (p.remainingQty || 0), 0);
        const totalRemainTl = parts.reduce((s, p) => s + (p.remainingQty || 0) * (p.unitPriceTl || 0), 0);
        const lastOrder = parts.map(p => p.orderDate).filter(Boolean).sort().pop();
        const lastName = slot.lastName || parts.filter(p => p.name).pop()?.name || parts[parts.length - 1]?.name || "—";
        const isOpen = openStock === code;
        return (
          <div key={code}>
            <div
              onClick={() => setOpenStock(isOpen ? null : code)}
              style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px 110px 110px 90px", padding: "6px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center", cursor: "pointer", background: isOpen ? "var(--color-background-info-subtle, #EFF6FF)" : "transparent" }}
            >
              <span style={{ fontFamily: "var(--font-mono)" }}>{isOpen ? "▼" : "▶"} {code}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastName}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{parts.length}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(totalRemain, 0)}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{fmt(totalRemainTl)}</span>
              <span style={{ textAlign: "center", fontSize: 10, color: "var(--color-text-tertiary)" }}>{fmtDate(lastOrder)}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "3px 6px", textAlign: "left", fontWeight: 500 }}>Tarih</th>
                      <th style={{ padding: "3px 6px", textAlign: "left", fontWeight: 500 }}>Belge</th>
                      <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 500 }}>Orijinal</th>
                      <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 500 }}>Sevk</th>
                      <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 500 }}>Kalan</th>
                      <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 500 }}>Birim TL</th>
                      <th style={{ padding: "3px 6px", textAlign: "right", fontWeight: 500 }} title="Sözleşme döviz birim fiyatı (varsa)">Birim Dvz</th>
                      <th style={{ padding: "3px 6px", textAlign: "center", fontWeight: 500 }}>Para</th>
                      <th style={{ padding: "3px 6px", textAlign: "left", fontWeight: 500 }}>Tedarikçi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p, i) => (
                      <tr key={i} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding: "3px 6px" }}>{fmtDate(p.orderDate)}</td>
                        <td style={{ padding: "3px 6px", fontFamily: "var(--font-mono)" }}>{p.belgeNo}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(p.originalQty, 0)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(p.shippedQty, 0)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: p.remainingQty > 0 ? 500 : 400 }}>{fmt(p.remainingQty, 0)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{fmt(p.unitPriceTl)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: p.unitPriceDvz > 0 ? "#1D4ED8" : "var(--color-text-tertiary)" }}>
                          {p.unitPriceDvz > 0 ? fmt(p.unitPriceDvz, 4) : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "center" }}>
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: p.currency === "TRY" ? "var(--color-background-tertiary)" : "#DBEAFE", color: p.currency === "TRY" ? "var(--color-text-tertiary)" : "#1D4ED8" }}>{p.currency}</span>
                        </td>
                        <td style={{ padding: "3px 6px", fontSize: 9, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.supplier}>{p.supplier}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {totalStocks > stocks.length && (
        <div style={{ padding: "8px 12px", textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          {totalStocks - stocks.length} stok daha var — arama ile filtrele
        </div>
      )}
    </div>
  );
}

function ManualPartitionModal({ form, setForm, onSave, saving, onClose }) {
  const upd = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div style={{ background: "var(--color-background-primary)", borderRadius: 10, width: "100%", maxWidth: 520, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>+ Manuel Birim Maliyet Partisi</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-tertiary)" }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
          VIO'dan gelmeyen parça için manuel parti kaydı. FIFO sırasında diğer partilerle birlikte değerlendirilir.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center", fontSize: 12 }}>
          <label>Stok Kodu *</label>
          <input
            value={form.code} onChange={e => upd("code", e.target.value)}
            placeholder="örn. 151-0234"
            style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
          />
          <label>Stok Adı</label>
          <input
            value={form.name} onChange={e => upd("name", e.target.value)}
            placeholder="örn. 52030 VOLANT C54"
            style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
          />
          <label>Birim Fiyat *</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="number" min="0" step="0.01"
              value={form.unitPriceTl} onChange={e => upd("unitPriceTl", e.target.value)}
              placeholder={form.priceUnit === "KG" ? "TL/KG" : "TL/AD"}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
            />
            <select
              value={form.priceUnit} onChange={e => upd("priceUnit", e.target.value)}
              title="Fiyat birimi — KG seçersen aşağıdaki parça ağırlığını da gir, sistem AD fiyatına çevirir"
              style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
            >
              <option value="AD">TL / Adet</option>
              <option value="KG">TL / KG</option>
            </select>
            <select
              value={form.currency} onChange={e => upd("currency", e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
            >
              <option value="TRY">TRY (₺)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
          {form.priceUnit === "KG" && (
            <>
              <label>Parça Ağırlığı (kg/AD) *</label>
              <input
                type="number" min="0" step="0.001"
                value={form.weightPerPiece} onChange={e => upd("weightPerPiece", e.target.value)}
                placeholder="örn. 2,5"
                style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid #FCD34D", background: "#FFFBEB", fontSize: 12 }}
              />
              <span></span>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                {Number(form.unitPriceTl) > 0 && Number(form.weightPerPiece) > 0 ? (
                  <>= <b style={{ color: "var(--color-text-success)" }}>{(Number(form.unitPriceTl) * Number(form.weightPerPiece)).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL/AD</b> olarak kaydedilecek</>
                ) : (
                  <i>KG fiyat × parça ağırlığı = AD fiyat (hesap için)</i>
                )}
              </div>
            </>
          )}
          <label>Miktar (opsiyonel)</label>
          <input
            type="number" min="0" step="1"
            value={form.originalQty} onChange={e => upd("originalQty", e.target.value)}
            placeholder="kalan miktar — boş bırakılırsa 0"
            style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
          />
          <label>Tarih</label>
          <input
            type="date" value={form.orderDate} onChange={e => upd("orderDate", e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
          />
          <label>Tedarikçi</label>
          <input
            value={form.supplier} onChange={e => upd("supplier", e.target.value)}
            placeholder="opsiyonel"
            style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 12, cursor: "pointer" }}>İptal</button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{ padding: "6px 16px", borderRadius: 5, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontWeight: 500, fontSize: 12, cursor: saving ? "default" : "pointer" }}
          >
            {saving ? "Kaydediliyor..." : "✓ Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnitCostsAutomationBadge({ status }) {
  if (status.state === "none") {
    return (
      <div style={{ marginBottom: 12, padding: "8px 14px", background: "var(--color-background-secondary)", border: "1px dashed var(--color-border-secondary)", borderRadius: 6, fontSize: 12, color: "var(--color-text-tertiary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span>📧</span>
        <span>Henüz VIO satın alma raporu yüklenmedi. Cron her sabah/öğle/akşam çalıştığında otomatik gelir.</span>
      </div>
    );
  }
  const hours = status.ageHours;
  const ageLabel = hours < 1 ? "az önce" : hours < 24 ? `${Math.floor(hours)} sa önce` : `${Math.floor(hours / 24)} gün önce`;
  const dateStr = new Date(status.lastImport).toLocaleString("tr-TR");
  let bg, border, color, icon, label;
  if (status.state === "ok") {
    bg = "#F0FDF4"; border = "#86EFAC"; color = "#166534"; icon = "✓";
    label = `Son içe alım: ${ageLabel} · cron otomasyonu aktif`;
  } else if (status.state === "warn") {
    bg = "#FFFBEB"; border = "#FCD34D"; color = "#92400E"; icon = "⚠";
    label = `Son içe alım: ${ageLabel} — son cron çalıştırmadan beri 1+ gün geçti`;
  } else {
    bg = "#FEF2F2"; border = "#FCA5A5"; color = "#B91C1C"; icon = "❌";
    label = `Son içe alım: ${ageLabel} — cron veya mail durmuş olabilir, kontrol et!`;
  }
  return (
    <div title={`Son güncelleme: ${dateStr}`}
      style={{ marginBottom: 12, padding: "8px 14px", background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 12, color, display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 500 }}
    >
      <span>{icon}</span>
      <span>📧 {label}</span>
    </div>
  );
}
