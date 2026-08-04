// Fiyat Listesi — mamul maliyetlerinden marj/yuvarlama ile satış fiyatı üret.
// Excel + PDF export (dahili / müşteriye gönderilebilir).
//
// Data akışı:
//   ProductCostsTab hesabından üretilen productCostsLatest snapshot (byStockCode)
//   ya da anlık BOM modelleri → calculateAllProductCosts (aynı ay/politika)
// Bu sekmede maliyet zaten yazılı (Mamül Maliyetleri açılınca hesaplanır),
// tekrar hesaplamak yerine BOM modellerinden anında recalculate ederiz —
// çünkü kullanıcı burada da aynı ay/politika seçebilir.

import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import {
  subscribeBomModels, subscribeWorkCenters, subscribeUnitCosts,
  subscribeLaborCosts, subscribeOverheadPolicy, subscribeFasonRates,
  subscribeUnitConversions, subscribePriceListPolicy, savePriceListPolicy,
} from "./firestore";
import { calculateAllProductCosts } from "./productCostCalc";
import { getOverheadMonthlyAvg } from "./distributionCalc";
import { fmtMoneyNum, CURRENCY_SYMBOLS, convertFromTl } from "./currency";

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  return `${months[Number(m) - 1]} ${y}`;
};

const ROUNDING_OPTIONS = [
  { key: 0, label: "Yok" },
  { key: 1, label: "1" },
  { key: 5, label: "5" },
  { key: 10, label: "10" },
  { key: 50, label: "50" },
  { key: 100, label: "100" },
];

function applyRounding(value, step) {
  if (!step || step <= 0) return value;
  return Math.ceil(value / step) * step;
}

export default function PriceListTab({ canEdit, userEmail, currency = "TRY", rates = null }) {
  // Data subscriptions
  const [bomModels, setBomModels] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState({});
  const [fasonRates, setFasonRates] = useState({});
  const [unitConversions, setUnitConversions] = useState({});
  const [priceListPolicy, setPriceListPolicy] = useState({});
  const [loaded, setLoaded] = useState({ bom: false, uc: false, wc: false, labor: false, pol: false, fas: false, conv: false, plp: false });

  // UI state
  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [mode, setMode] = useState("simple");   // "simple" | "detailed"
  const [defaultMarginPct, setDefaultMarginPct] = useState(35);
  const [laborPct, setLaborPct] = useState(40);
  const [materialFasonPct, setMaterialFasonPct] = useState(30);
  const [rounding, setRounding] = useState(0);
  const [searchModel, setSearchModel] = useState("");
  const [onlyCosted, setOnlyCosted] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showZeroCost, setShowZeroCost] = useState(false);
  const policyLoadedRef = useRef(false);

  useEffect(() => {
    const u1 = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(l => ({ ...l, bom: true })); });
    const u2 = subscribeUnitCosts(d => { setUnitCosts(d || {}); setLoaded(l => ({ ...l, uc: true })); });
    const u3 = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(l => ({ ...l, wc: true })); });
    const u4 = subscribeLaborCosts(d => { setLaborData(d || {}); setLoaded(l => ({ ...l, labor: true })); });
    const u5 = subscribeOverheadPolicy(d => { setPolicy(d || {}); setLoaded(l => ({ ...l, pol: true })); });
    const u6 = subscribeFasonRates(d => { setFasonRates(d || {}); setLoaded(l => ({ ...l, fas: true })); });
    const u7 = subscribeUnitConversions(d => { setUnitConversions(d || {}); setLoaded(l => ({ ...l, conv: true })); });
    const u8 = subscribePriceListPolicy(d => {
      setPriceListPolicy(d || {});
      setLoaded(l => ({ ...l, plp: true }));
      // İlk yüklemede formu doldur
      if (!policyLoadedRef.current) {
        policyLoadedRef.current = true;
        if (d && Object.keys(d).length > 0) {
          if (d.mode) setMode(d.mode);
          if (typeof d.defaultMarginPct === "number") setDefaultMarginPct(d.defaultMarginPct);
          if (typeof d.laborPct === "number") setLaborPct(d.laborPct);
          if (typeof d.materialFasonPct === "number") setMaterialFasonPct(d.materialFasonPct);
          if (typeof d.rounding === "number") setRounding(d.rounding);
        }
      }
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthData = monthlyOverheads[selectedMonth];
  const monthlySupplies = laborData?.monthlySupplies || {};
  const availableMonths = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);

  const allLoaded = Object.values(loaded).every(Boolean);
  const calc = useMemo(() => {
    if (!allLoaded || !monthData) return null;
    return calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, refMonth: selectedMonth, unitConversions });
  }, [allLoaded, bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, selectedMonth, unitConversions]);

  // Ürün listesi + satış fiyatı hesabı
  const products = useMemo(() => {
    if (!calc?.byModel) return [];
    const q = searchModel.trim().toLocaleLowerCase("tr-TR");
    const rows = Object.values(calc.byModel).map(m => {
      const material = Number(m.rootMaterial) || 0;
      const labor = Number(m.rootLabor) || 0;
      const fason = Number(m.rootFason) || 0;
      const cost = Number(m.rootCost) || 0;
      let salesTl = 0;
      if (mode === "simple") {
        salesTl = cost * (1 + (defaultMarginPct || 0) / 100);
      } else {
        salesTl = material * (1 + (materialFasonPct || 0) / 100)
                + labor * (1 + (laborPct || 0) / 100)
                + fason * (1 + (materialFasonPct || 0) / 100);
      }
      // Yuvarlama TL bazında yapılır (satış fiyatı yuvarlama pratikte TL üzerinden düşünülür)
      const roundedTl = applyRounding(salesTl, rounding);
      const profitTl = roundedTl - cost;
      const marginPct = cost > 0 ? (profitTl / cost) * 100 : 0;
      return {
        id: m.modelKey,
        modelCode: m.modelCode || m.rootStockCode || "",
        stockCode: m.rootStockCode || "",
        stockName: m.rootStockName || m.modelName || "",
        material, labor, fason, cost,
        salesTl: roundedTl,
        profitTl,
        marginPct,
      };
    });
    return rows
      .filter(r => {
        if (!showZeroCost && r.cost <= 0) return false;
        if (onlyCosted && r.cost <= 0) return false;
        if (!q) return true;
        return r.modelCode.toLocaleLowerCase("tr-TR").includes(q)
            || r.stockCode.toLocaleLowerCase("tr-TR").includes(q)
            || r.stockName.toLocaleLowerCase("tr-TR").includes(q);
      })
      .sort((a, b) => b.cost - a.cost);
  }, [calc, mode, defaultMarginPct, laborPct, materialFasonPct, rounding, searchModel, onlyCosted, showZeroCost]);

  const selectedProducts = useMemo(
    () => products.filter(p => selectedIds.has(p.id)),
    [products, selectedIds]
  );

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelectedIds(new Set(products.map(p => p.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const savePolicy = async () => {
    if (!canEdit) return;
    try {
      await savePriceListPolicy({
        mode, defaultMarginPct, laborPct, materialFasonPct, rounding,
      }, { canEdit, userEmail });
      alert("Marj ayarları kaydedildi ✓");
    } catch (e) {
      alert("Kaydedilemedi: " + e.message);
    }
  };

  // Para birimi biçim (satış fiyatı TL bazında hesaplanır, döviz için convert)
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const fMoneyDisplay = (tl) => fmtMoneyNum(tl, currency, rates, 2);

  // ============================================================
  // Excel Export
  // ============================================================
  const exportExcel = (variant /* "internal" | "customer" */) => {
    const list = selectedProducts.length > 0 ? selectedProducts : products;
    if (list.length === 0) { alert("Listede ürün yok"); return; }
    const isInternal = variant === "internal";
    const header = isInternal
      ? ["Stok Kodu", "Ad", "Malzeme", "İşçilik", "Fason", "Toplam Maliyet", "Marj %", "Satış Fiyatı", "Kâr"]
      : ["Stok Kodu", "Ad", "Satış Fiyatı"];
    const rows = [header];
    const convVal = (tl) => currency === "TRY" ? tl : convertFromTl(tl, currency, rates) || tl;
    for (const p of list) {
      if (isInternal) {
        rows.push([
          p.stockCode, p.stockName,
          Number(convVal(p.material).toFixed(2)),
          Number(convVal(p.labor).toFixed(2)),
          Number(convVal(p.fason).toFixed(2)),
          Number(convVal(p.cost).toFixed(2)),
          Number(p.marginPct.toFixed(1)),
          Number(convVal(p.salesTl).toFixed(2)),
          Number(convVal(p.profitTl).toFixed(2)),
        ]);
      } else {
        rows.push([p.stockCode, p.stockName, Number(convVal(p.salesTl).toFixed(2))]);
      }
    }
    // Meta bilgi başlık
    const meta = [
      [`Fiyat Listesi — ${monthLabel(selectedMonth)} (${currency})`],
      [`Hesap tarihi: ${new Date().toLocaleDateString("tr-TR")}`],
      [`Marj: ${mode === "simple" ? `%${defaultMarginPct}` : `İşçilik %${laborPct} · Malzeme+Fason %${materialFasonPct}`}${rounding > 0 ? ` · Yuvarlama: ${rounding} TL adım (yukarı)` : ""}`],
      [`Ürün sayısı: ${list.length}`],
      [],
    ];
    const finalRows = [...meta, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(finalRows);
    ws["!cols"] = isInternal
      ? [{ wch: 16 }, { wch: 44 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 12 }]
      : [{ wch: 16 }, { wch: 44 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiyat Listesi");
    const fileName = `fiyat_listesi_${variant}_${selectedMonth}_${currency}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // ============================================================
  // PDF Export
  // ============================================================
  const exportPdf = (variant /* "internal" | "customer" */) => {
    const list = selectedProducts.length > 0 ? selectedProducts : products;
    if (list.length === 0) { alert("Listede ürün yok"); return; }
    const isInternal = variant === "internal";
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginL = 12;
    const marginR = 12;
    const usableW = pageW - marginL - marginR;

    // Başlık
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("DENMA MUHENDISLIK", marginL, 15);
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Fiyat Listesi - ${monthLabel(selectedMonth)}`, marginL, 22);
    pdf.setFontSize(9);
    pdf.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}`, pageW - marginR, 15, { align: "right" });
    pdf.text(`Para Birimi: ${currency}`, pageW - marginR, 20, { align: "right" });
    pdf.text(isInternal ? "(Dahili - Kar payi gorunur)" : "(Musteri versiyonu)", pageW - marginR, 25, { align: "right" });

    // Tablo başlıkları
    const startY = 32;
    let y = startY;
    const rowH = 6;
    pdf.setFillColor(240, 240, 240);
    pdf.rect(marginL, y - 4, usableW, rowH, "F");
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    if (isInternal) {
      // 5 kolon: kod, ad, maliyet, marj, satış
      const cols = [
        { x: marginL + 1, w: 30, label: "Stok Kodu", align: "left" },
        { x: marginL + 33, w: 80, label: "Ad", align: "left" },
        { x: marginL + 115, w: 22, label: "Maliyet", align: "right" },
        { x: marginL + 138, w: 15, label: "Marj%", align: "right" },
        { x: marginL + 154, w: 32, label: "Satis", align: "right" },
      ];
      cols.forEach(c => pdf.text(c.label, c.x + (c.align === "right" ? c.w : 0), y, { align: c.align }));
      y += rowH;
      pdf.setFont("helvetica", "normal");
      const convVal = (tl) => currency === "TRY" ? tl : convertFromTl(tl, currency, rates) || tl;
      const fmt = (v) => Number(convVal(v)).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      for (const p of list) {
        if (y > pageH - 15) { pdf.addPage(); y = startY; }
        const nameShort = String(p.stockName || "").slice(0, 50);
        pdf.text(String(p.stockCode || ""), cols[0].x, y);
        pdf.text(nameShort, cols[1].x, y);
        pdf.text(fmt(p.cost), cols[2].x + cols[2].w, y, { align: "right" });
        pdf.text(`%${p.marginPct.toFixed(0)}`, cols[3].x + cols[3].w, y, { align: "right" });
        pdf.text(fmt(p.salesTl), cols[4].x + cols[4].w, y, { align: "right" });
        y += rowH - 1;
      }
    } else {
      // 3 kolon: kod, ad, satış
      const cols = [
        { x: marginL + 1, w: 32, label: "Stok Kodu", align: "left" },
        { x: marginL + 35, w: 110, label: "Ad", align: "left" },
        { x: marginL + 146, w: 40, label: "Fiyat", align: "right" },
      ];
      cols.forEach(c => pdf.text(c.label, c.x + (c.align === "right" ? c.w : 0), y, { align: c.align }));
      y += rowH;
      pdf.setFont("helvetica", "normal");
      const convVal = (tl) => currency === "TRY" ? tl : convertFromTl(tl, currency, rates) || tl;
      const fmt = (v) => Number(convVal(v)).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      for (const p of list) {
        if (y > pageH - 20) { pdf.addPage(); y = startY; }
        const nameShort = String(p.stockName || "").slice(0, 70);
        pdf.text(String(p.stockCode || ""), cols[0].x, y);
        pdf.text(nameShort, cols[1].x, y);
        pdf.text(fmt(p.salesTl), cols[2].x + cols[2].w, y, { align: "right" });
        y += rowH - 1;
      }
    }
    // Alt bilgi (müşteri versiyonunda)
    if (!isInternal) {
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        "Fiyatlarimiz degisken olup guncel fiyat icin lutfen teklif isteyiniz.",
        pageW / 2, pageH - 10, { align: "center" }
      );
    }
    pdf.save(`fiyat_listesi_${variant}_${selectedMonth}_${currency}.pdf`);
  };

  // ============================================================
  // Render
  // ============================================================
  if (!allLoaded) return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;
  if (!monthData) return (
    <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Hesap ayı yok</div>
      <div style={{ fontSize: 12 }}>Önce Aylık Genel Giderler sekmesinden bir ay yükleyin</div>
    </div>
  );

  return (
    <div>
      {/* Üst bant: ay + marj + yuvarlama */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Hesap ayı:</label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
            {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 2, border: "1px solid var(--color-border-secondary)", borderRadius: 4, overflow: "hidden" }}>
          <button onClick={() => setMode("simple")}
            style={{ padding: "5px 10px", fontSize: 11, border: "none",
              background: mode === "simple" ? "#1e40af" : "#fff",
              color: mode === "simple" ? "#fff" : "#44403c", cursor: "pointer" }}>
            Basit Marj
          </button>
          <button onClick={() => setMode("detailed")}
            style={{ padding: "5px 10px", fontSize: 11, border: "none",
              background: mode === "detailed" ? "#1e40af" : "#fff",
              color: mode === "detailed" ? "#fff" : "#44403c", cursor: "pointer" }}>
            Detaylı Marj
          </button>
        </div>
        {mode === "simple" ? (
          <div>
            <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Genel Marj:</label>
            <input type="number" value={defaultMarginPct} onChange={e => setDefaultMarginPct(Number(e.target.value) || 0)}
              step="1" min="0"
              style={{ width: 60, padding: "5px 8px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
            <span style={{ fontSize: 12, marginLeft: 4 }}>%</span>
          </div>
        ) : (
          <>
            <div>
              <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>İşçilik Marjı:</label>
              <input type="number" value={laborPct} onChange={e => setLaborPct(Number(e.target.value) || 0)}
                step="1" min="0"
                style={{ width: 60, padding: "5px 8px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
              <span style={{ fontSize: 12, marginLeft: 4 }}>%</span>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Malzeme+Fason Marjı:</label>
              <input type="number" value={materialFasonPct} onChange={e => setMaterialFasonPct(Number(e.target.value) || 0)}
                step="1" min="0"
                style={{ width: 60, padding: "5px 8px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
              <span style={{ fontSize: 12, marginLeft: 4 }}>%</span>
            </div>
          </>
        )}
        <div>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Yuvarlama (TL, yukarı):</label>
          <select value={rounding} onChange={e => setRounding(Number(e.target.value))}
            style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
            {ROUNDING_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={savePolicy} disabled={!canEdit}
          title="Marj ayarlarını sistem geneline kaydet"
          style={{ padding: "5px 10px", fontSize: 11, background: "#f5f5f4", border: "1px solid var(--color-border-secondary)", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed" }}>
          💾 Ayarları Kaydet
        </button>
      </div>

      {/* Filtre + Export */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input type="text" placeholder="🔍 Kod/ad ara..." value={searchModel} onChange={e => setSearchModel(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={onlyCosted} onChange={e => setOnlyCosted(e.target.checked)} />
          Sadece maliyeti hesaplananlar
        </label>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {products.length} ürün · {selectedIds.size} seçili
        </span>
        <button onClick={selectAll} style={btnSecondary}>Tümünü Seç</button>
        <button onClick={clearSelection} style={btnSecondary}>Temizle</button>
        <div style={{ borderLeft: "1px solid var(--color-border-secondary)", paddingLeft: 8, display: "flex", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", alignSelf: "center", marginRight: 4 }}>
            {selectedIds.size > 0 ? `${selectedIds.size} seçili` : "Tümü"}:
          </span>
          <button onClick={() => exportExcel("internal")} style={btnExportBlue} title="Maliyet + marj + kâr görünür (dahili)">
            📥 Excel (Dahili)
          </button>
          <button onClick={() => exportExcel("customer")} style={btnExportGreen} title="Sadece kod, ad, satış fiyatı">
            📥 Excel (Müşteri)
          </button>
          <button onClick={() => exportPdf("internal")} style={btnExportBlueOutline}>
            📄 PDF (Dahili)
          </button>
          <button onClick={() => exportPdf("customer")} style={btnExportGreenOutline}>
            📄 PDF (Müşteri)
          </button>
        </div>
      </div>

      {/* Tablo */}
      <div style={{ background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--color-background-secondary)", zIndex: 1 }}>
            <tr>
              <th style={{ ...th, width: 30, textAlign: "center" }}>
                <input type="checkbox"
                  checked={products.length > 0 && selectedIds.size === products.length}
                  onChange={() => selectedIds.size === products.length ? clearSelection() : selectAll()} />
              </th>
              <th style={th}>Stok Kodu</th>
              <th style={{ ...th, minWidth: 220 }}>Ad</th>
              <th style={{ ...th, textAlign: "right" }}>Malzeme</th>
              <th style={{ ...th, textAlign: "right" }}>İşçilik</th>
              <th style={{ ...th, textAlign: "right" }}>Fason</th>
              <th style={{ ...th, textAlign: "right" }}>Maliyet</th>
              <th style={{ ...th, textAlign: "right", background: "#eff6ff" }}>Satış Fiyatı</th>
              <th style={{ ...th, textAlign: "right" }}>Kâr</th>
              <th style={{ ...th, textAlign: "right" }}>Marj%</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)" }}>Eşleşen ürün yok</td></tr>
            ) : products.map(p => (
              <tr key={p.id} style={{ borderTop: "1px solid #f5f5f4", background: selectedIds.has(p.id) ? "#eff6ff" : "transparent" }}>
                <td style={{ ...td, textAlign: "center" }}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{p.stockCode}</td>
                <td style={td}>{p.stockName || "—"}</td>
                <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{fMoneyDisplay(p.material)}</td>
                <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{fMoneyDisplay(p.labor)}</td>
                <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{fMoneyDisplay(p.fason)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{fMoneyDisplay(p.cost)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#166534", background: "#eff6ff" }}>{fMoneyDisplay(p.salesTl)}</td>
                <td style={{ ...td, textAlign: "right", color: "#166534" }}>{fMoneyDisplay(p.profitTl)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>%{p.marginPct.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: "var(--color-text-tertiary)" }}>
        💡 <b>Basit marj</b>: satış = maliyet × (1 + marj%). <b>Detaylı marj</b>: her bileşene ayrı marj (işçilik / malzeme+fason). Yuvarlama TL bazında <b>yukarı</b> yapılır. Fiyat listesi seçtiklerini export eder; hiçbir şey seçili değilse tümü.
      </div>
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
const btnSecondary = { padding: "4px 8px", fontSize: 11, background: "#f5f5f4", border: "1px solid var(--color-border-secondary)", borderRadius: 4, cursor: "pointer" };
const btnExportBlue = { padding: "4px 10px", fontSize: 11, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 };
const btnExportGreen = { padding: "4px 10px", fontSize: 11, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 };
const btnExportBlueOutline = { padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer" };
const btnExportGreenOutline = { padding: "4px 10px", fontSize: 11, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer" };
