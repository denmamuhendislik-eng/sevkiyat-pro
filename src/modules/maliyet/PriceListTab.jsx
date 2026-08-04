// Fiyat Listesi — Mamül Maliyetleri hesabından SADECE root/parça maliyetini alıp
// üstüne marj + yuvarlama uygular. Kırılım/detaylı marj YOK; overhead problemi
// yaşamamak için tek gerçek kaynak = productCostCalc çıktısındaki unitCost/rootCost.
//
// productCostCalc.js'e DOKUNULMAZ — burası pasif tüketici.
//
// Excel + PDF export (dahili / müşteriye gönderilebilir).

import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import {
  subscribeBomModels, subscribeWorkCenters, subscribeUnitCosts,
  subscribeLaborCosts, subscribeOverheadPolicy, subscribeFasonRates,
  subscribeUnitConversions, subscribePriceListPolicy, savePriceListPolicy,
} from "./firestore";
import { calculateAllProductCosts } from "./productCostCalc";
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

export default function PriceListTab({ canEdit, userEmail, currency = "TRY", rates = null, sharedMonth, setSharedMonth }) {
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

  // Hesap ayı: üst seviyeden paylaşılır
  const [localMonth, setLocalMonth] = useState(todayMonth());
  const selectedMonth = sharedMonth !== undefined ? sharedMonth : localMonth;
  const setSelectedMonth = setSharedMonth || setLocalMonth;

  // UI state — sadeleştirilmiş: tek marj
  const [marginPct, setMarginPct] = useState(35);
  const [rounding, setRounding] = useState(0);
  const [includeSubparts, setIncludeSubparts] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [onlyCosted, setOnlyCosted] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
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
          // Backward-compat: eski defaultMarginPct varsa onu al, yoksa marginPct
          const m = typeof d.marginPct === "number" ? d.marginPct
                  : typeof d.defaultMarginPct === "number" ? d.defaultMarginPct : 35;
          setMarginPct(m);
          if (typeof d.rounding === "number") setRounding(d.rounding);
          if (typeof d.includeSubparts === "boolean") setIncludeSubparts(d.includeSubparts);
        }
      }
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthData = monthlyOverheads[selectedMonth];
  const monthlySupplies = laborData?.monthlySupplies || {};
  const availableMonths = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);

  // Seçili ay mevcut değilse en son mevcut aya düş
  useEffect(() => {
    if (availableMonths.length === 0) return;
    if (monthlyOverheads[selectedMonth]) return;
    setSelectedMonth(availableMonths[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths, selectedMonth]);

  const allLoaded = Object.values(loaded).every(Boolean);
  const calc = useMemo(() => {
    if (!allLoaded || !monthData) return null;
    return calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, refMonth: selectedMonth, unitConversions });
  }, [allLoaded, bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, selectedMonth, unitConversions]);

  // ============================================================
  // Ürün listesi + satış fiyatı hesabı
  // Formül: salesTl = cost × (1 + marginPct/100), yuvarla
  // Overhead problemi YOK: rootCost/unitCost direkt Mamul Maliyeti'nden alınır.
  // ============================================================
  const products = useMemo(() => {
    if (!calc?.byModel) return [];
    const rows = [];
    for (const m of Object.values(calc.byModel)) {
      // Root mamul satırı
      const rootCost = Number(m.rootCost) || 0;
      rows.push({
        id: `root:${m.modelKey}`,
        modelKey: m.modelKey,
        stockCode: m.rootStockCode || "",
        stockName: m.rootStockName || m.modelName || "",
        level: 0,
        isRoot: true,
        parentModel: null,
        parentModelStockCode: null,
        cost: rootCost,
      });
      // Alt parçalar (toggle ON ise)
      if (includeSubparts && m.partsList) {
        for (const p of m.partsList) {
          // Root parçayı zaten ekledik, atla
          if (p.parentIdx === null || p.parentIdx === undefined) continue;
          const unitCost = Number(p.unitCost) || 0;
          rows.push({
            id: `${m.modelKey}:${p.idx}`,
            modelKey: m.modelKey,
            stockCode: p.stockCode || "",
            stockName: p.stockName || "",
            level: Number(p.level) || 1,
            isRoot: false,
            parentModel: m.modelCode || m.rootStockCode || "",
            parentModelStockCode: m.rootStockCode || "",
            cost: unitCost,
            supplyType: p.supplyType || "",
          });
        }
      }
    }
    // Hesap: satış + kâr + marj%
    const q = searchText.trim().toLocaleLowerCase("tr-TR");
    return rows
      .map(r => {
        const salesTl = applyRounding(r.cost * (1 + (marginPct || 0) / 100), rounding);
        const profitTl = salesTl - r.cost;
        const marginActualPct = r.cost > 0 ? (profitTl / r.cost) * 100 : 0;
        return { ...r, salesTl, profitTl, marginActualPct };
      })
      .filter(r => {
        if (onlyCosted && r.cost <= 0) return false;
        if (!q) return true;
        return r.stockCode.toLocaleLowerCase("tr-TR").includes(q)
            || (r.stockName || "").toLocaleLowerCase("tr-TR").includes(q)
            || (r.parentModel || "").toLocaleLowerCase("tr-TR").includes(q);
      })
      .sort((a, b) => {
        // Root'lar önce, sonra maliyet desc; alt parçalar kendi ana mamulünün altında
        if (includeSubparts) {
          // Aynı model içinde: root önce (isRoot true), sonra alt parçalar level'a göre
          const aKey = a.modelKey || "";
          const bKey = b.modelKey || "";
          if (aKey !== bKey) {
            // Modeller arası: root maliyetine göre desc
            const aModelCost = a.isRoot ? a.cost : (calc.byModel[aKey]?.rootCost || 0);
            const bModelCost = b.isRoot ? b.cost : (calc.byModel[bKey]?.rootCost || 0);
            return bModelCost - aModelCost;
          }
          // Aynı model içi: root önce
          if (a.isRoot && !b.isRoot) return -1;
          if (!a.isRoot && b.isRoot) return 1;
          return (a.level || 0) - (b.level || 0);
        }
        return b.cost - a.cost;
      });
  }, [calc, marginPct, rounding, includeSubparts, searchText, onlyCosted]);

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
        marginPct, rounding, includeSubparts,
      }, { canEdit, userEmail });
      alert("Marj ayarları kaydedildi ✓");
    } catch (e) {
      alert("Kaydedilemedi: " + e.message);
    }
  };

  // Para birimi biçim (rootCost TL bazında; kur uygulanır)
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const fMoneyDisplay = (tl) => fmtMoneyNum(tl, currency, rates, 2);
  const convVal = (tl) => currency === "TRY" ? tl : (convertFromTl(tl, currency, rates) || tl);

  // ============================================================
  // Excel Export
  // ============================================================
  const exportExcel = (variant /* "internal" | "customer" */) => {
    const list = selectedProducts.length > 0 ? selectedProducts : products;
    if (list.length === 0) { alert("Listede ürün yok"); return; }
    const isInternal = variant === "internal";
    // Header
    const header = isInternal
      ? (includeSubparts
          ? ["Seviye", "Ana Mamul", "Stok Kodu", "Ad", "Maliyet", "Marj %", "Satış Fiyatı", "Kâr"]
          : ["Stok Kodu", "Ad", "Maliyet", "Marj %", "Satış Fiyatı", "Kâr"])
      : (includeSubparts
          ? ["Seviye", "Ana Mamul", "Stok Kodu", "Ad", "Satış Fiyatı"]
          : ["Stok Kodu", "Ad", "Satış Fiyatı"]);
    const rows = [header];
    for (const p of list) {
      if (isInternal) {
        const baseRow = [
          p.stockCode, p.stockName,
          Number(convVal(p.cost).toFixed(2)),
          Number(p.marginActualPct.toFixed(1)),
          Number(convVal(p.salesTl).toFixed(2)),
          Number(convVal(p.profitTl).toFixed(2)),
        ];
        if (includeSubparts) {
          rows.push([p.isRoot ? "MAMÜL" : `L${p.level}`, p.parentModel || "-", ...baseRow]);
        } else {
          rows.push(baseRow);
        }
      } else {
        const baseRow = [p.stockCode, p.stockName, Number(convVal(p.salesTl).toFixed(2))];
        if (includeSubparts) {
          rows.push([p.isRoot ? "MAMÜL" : `L${p.level}`, p.parentModel || "-", ...baseRow]);
        } else {
          rows.push(baseRow);
        }
      }
    }
    const meta = [
      [`Fiyat Listesi — ${monthLabel(selectedMonth)} (${currency})`],
      [`Hesap tarihi: ${new Date().toLocaleDateString("tr-TR")}`],
      [`Marj: %${marginPct}${rounding > 0 ? ` · Yuvarlama: ${rounding} TL adım (yukarı)` : ""}`],
      [includeSubparts ? "Kapsam: Mamül + Alt parçalar" : "Kapsam: Sadece mamüller"],
      [`Kayıt sayısı: ${list.length}`],
      [],
    ];
    const finalRows = [...meta, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(finalRows);
    // Kolon genişlikleri
    if (isInternal) {
      ws["!cols"] = includeSubparts
        ? [{ wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 44 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 12 }]
        : [{ wch: 16 }, { wch: 44 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
    } else {
      ws["!cols"] = includeSubparts
        ? [{ wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 44 }, { wch: 14 }]
        : [{ wch: 16 }, { wch: 44 }, { wch: 14 }];
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiyat Listesi");
    const fileName = `fiyat_listesi_${variant}_${selectedMonth}_${currency}${includeSubparts ? "_altparca" : ""}.xlsx`;
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
    if (includeSubparts) {
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text("Mamul + alt parcalar dahil", marginL, 27);
      pdf.setTextColor(0);
    }

    const startY = includeSubparts ? 34 : 32;
    let y = startY;
    const rowH = 6;
    pdf.setFillColor(240, 240, 240);
    pdf.rect(marginL, y - 4, usableW, rowH, "F");
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    const fmt = (v) => Number(convVal(v)).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Kolonlar — mod'a göre değişir
    let cols;
    if (isInternal) {
      cols = includeSubparts ? [
        { x: marginL + 1, w: 12, label: "Sev.", align: "left" },
        { x: marginL + 14, w: 24, label: "Ana Mamul", align: "left" },
        { x: marginL + 40, w: 26, label: "Stok Kodu", align: "left" },
        { x: marginL + 68, w: 60, label: "Ad", align: "left" },
        { x: marginL + 128, w: 22, label: "Maliyet", align: "right" },
        { x: marginL + 152, w: 12, label: "Marj%", align: "right" },
        { x: marginL + 166, w: 20, label: "Satis", align: "right" },
      ] : [
        { x: marginL + 1, w: 30, label: "Stok Kodu", align: "left" },
        { x: marginL + 33, w: 80, label: "Ad", align: "left" },
        { x: marginL + 115, w: 22, label: "Maliyet", align: "right" },
        { x: marginL + 138, w: 15, label: "Marj%", align: "right" },
        { x: marginL + 154, w: 32, label: "Satis", align: "right" },
      ];
    } else {
      cols = includeSubparts ? [
        { x: marginL + 1, w: 12, label: "Sev.", align: "left" },
        { x: marginL + 14, w: 26, label: "Ana Mamul", align: "left" },
        { x: marginL + 42, w: 32, label: "Stok Kodu", align: "left" },
        { x: marginL + 76, w: 70, label: "Ad", align: "left" },
        { x: marginL + 148, w: 38, label: "Fiyat", align: "right" },
      ] : [
        { x: marginL + 1, w: 32, label: "Stok Kodu", align: "left" },
        { x: marginL + 35, w: 110, label: "Ad", align: "left" },
        { x: marginL + 146, w: 40, label: "Fiyat", align: "right" },
      ];
    }
    cols.forEach(c => pdf.text(c.label, c.x + (c.align === "right" ? c.w : 0), y, { align: c.align }));
    y += rowH;
    pdf.setFont("helvetica", "normal");

    // Satırlar
    for (const p of list) {
      if (y > pageH - 15) { pdf.addPage(); y = startY; }
      const nameShort = String(p.stockName || "").slice(0, isInternal ? 40 : 50);
      const levelStr = p.isRoot ? "MAMUL" : `L${p.level}`;
      if (isInternal) {
        if (includeSubparts) {
          pdf.text(levelStr, cols[0].x, y);
          pdf.text(String(p.parentModel || "-").slice(0, 12), cols[1].x, y);
          pdf.text(String(p.stockCode || ""), cols[2].x, y);
          pdf.text(nameShort, cols[3].x, y);
          pdf.text(fmt(p.cost), cols[4].x + cols[4].w, y, { align: "right" });
          pdf.text(`%${p.marginActualPct.toFixed(0)}`, cols[5].x + cols[5].w, y, { align: "right" });
          pdf.text(fmt(p.salesTl), cols[6].x + cols[6].w, y, { align: "right" });
        } else {
          pdf.text(String(p.stockCode || ""), cols[0].x, y);
          pdf.text(nameShort, cols[1].x, y);
          pdf.text(fmt(p.cost), cols[2].x + cols[2].w, y, { align: "right" });
          pdf.text(`%${p.marginActualPct.toFixed(0)}`, cols[3].x + cols[3].w, y, { align: "right" });
          pdf.text(fmt(p.salesTl), cols[4].x + cols[4].w, y, { align: "right" });
        }
      } else {
        if (includeSubparts) {
          pdf.text(levelStr, cols[0].x, y);
          pdf.text(String(p.parentModel || "-").slice(0, 14), cols[1].x, y);
          pdf.text(String(p.stockCode || ""), cols[2].x, y);
          pdf.text(nameShort, cols[3].x, y);
          pdf.text(fmt(p.salesTl), cols[4].x + cols[4].w, y, { align: "right" });
        } else {
          pdf.text(String(p.stockCode || ""), cols[0].x, y);
          pdf.text(nameShort, cols[1].x, y);
          pdf.text(fmt(p.salesTl), cols[2].x + cols[2].w, y, { align: "right" });
        }
      }
      y += rowH - 1;
    }
    // Alt bilgi (müşteri versiyonu)
    if (!isInternal) {
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        "Fiyatlarimiz degisken olup guncel fiyat icin lutfen teklif isteyiniz.",
        pageW / 2, pageH - 10, { align: "center" }
      );
    }
    pdf.save(`fiyat_listesi_${variant}_${selectedMonth}_${currency}${includeSubparts ? "_altparca" : ""}.pdf`);
  };

  // ============================================================
  // Render
  // ============================================================
  if (!allLoaded) return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;
  if (!monthData) return (
    <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Hesap ayı seçili değil / yüklenmemiş</div>
      <div style={{ fontSize: 12 }}>Mamul Maliyetleri sekmesinde bir ay seçili değilse, önce Aylık Genel Giderler'den bir ay yükleyin. Ay seçimi Mamul Maliyetleri ile ortaktır.</div>
    </div>
  );

  return (
    <div>
      {/* Üst bant: ay + marj + yuvarlama + toggle */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8, marginBottom: 12 }}>
        <div title="Mamul Maliyetleri sekmesi ile ortak">
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Hesap ayı:</label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
            {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginLeft: 6 }}>(Mamul Maliyetleri ile ortak)</span>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Marj:</label>
          <input type="number" value={marginPct} onChange={e => setMarginPct(Number(e.target.value) || 0)}
            step="1" min="0"
            style={{ width: 70, padding: "5px 8px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
          <span style={{ fontSize: 12, marginLeft: 4 }}>%</span>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Yuvarlama:</label>
          <select value={rounding} onChange={e => setRounding(Number(e.target.value))}
            style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
            {ROUNDING_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginLeft: 4 }}>TL, yukarı</span>
        </div>
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", background: includeSubparts ? "#f0fdf4" : "#fff", border: "1px solid " + (includeSubparts ? "#86efac" : "var(--color-border-secondary)"), borderRadius: 4 }}
          title="Her mamulun BOM ağacındaki alt parçaları da fiyat listesine ekle">
          <input type="checkbox" checked={includeSubparts} onChange={e => setIncludeSubparts(e.target.checked)} />
          🌲 Alt parçaları dahil et
        </label>
        <button onClick={savePolicy} disabled={!canEdit}
          title="Marj + yuvarlama + toggle tercihi sistem geneline kaydedilir"
          style={{ padding: "5px 10px", fontSize: 11, background: "#f5f5f4", border: "1px solid var(--color-border-secondary)", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed" }}>
          💾 Ayarları Kaydet
        </button>
      </div>

      {/* Filtre + Export */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input type="text" placeholder="🔍 Kod / ad / ana mamul ara..." value={searchText} onChange={e => setSearchText(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={onlyCosted} onChange={e => setOnlyCosted(e.target.checked)} />
          Sadece maliyeti hesaplananlar
        </label>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {products.length} kayıt · {selectedIds.size} seçili
        </span>
        <button onClick={selectAll} style={btnSecondary}>Tümünü Seç</button>
        <button onClick={clearSelection} style={btnSecondary}>Temizle</button>
        <div style={{ borderLeft: "1px solid var(--color-border-secondary)", paddingLeft: 8, display: "flex", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", alignSelf: "center", marginRight: 4 }}>
            {selectedIds.size > 0 ? `${selectedIds.size} seçili` : "Tümü"}:
          </span>
          <button onClick={() => exportExcel("internal")} style={btnExportBlue} title="Maliyet + marj + kâr görünür (dahili)">📥 Excel (Dahili)</button>
          <button onClick={() => exportExcel("customer")} style={btnExportGreen} title="Sadece kod, ad, satış fiyatı">📥 Excel (Müşteri)</button>
          <button onClick={() => exportPdf("internal")} style={btnExportBlueOutline}>📄 PDF (Dahili)</button>
          <button onClick={() => exportPdf("customer")} style={btnExportGreenOutline}>📄 PDF (Müşteri)</button>
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
              {includeSubparts && <th style={{ ...th, width: 60 }}>Sev.</th>}
              {includeSubparts && <th style={{ ...th, width: 130 }}>Ana Mamul</th>}
              <th style={th}>Stok Kodu</th>
              <th style={{ ...th, minWidth: 220 }}>Ad</th>
              <th style={{ ...th, textAlign: "right" }}>Maliyet</th>
              <th style={{ ...th, textAlign: "right" }}>Marj%</th>
              <th style={{ ...th, textAlign: "right", background: "#eff6ff" }}>Satış Fiyatı</th>
              <th style={{ ...th, textAlign: "right" }}>Kâr</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={includeSubparts ? 9 : 7} style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)" }}>Eşleşen kayıt yok</td></tr>
            ) : products.map(p => (
              <tr key={p.id} style={{
                borderTop: "1px solid #f5f5f4",
                background: selectedIds.has(p.id) ? "#eff6ff" : (p.isRoot ? "transparent" : "#fafaf9"),
              }}>
                <td style={{ ...td, textAlign: "center" }}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                {includeSubparts && (
                  <td style={{ ...td, fontSize: 9 }}>
                    {p.isRoot
                      ? <span style={{ padding: "1px 5px", background: "#1e40af", color: "#fff", borderRadius: 3, fontWeight: 600 }}>MAMÜL</span>
                      : <span style={{ padding: "1px 5px", background: "#f5f5f4", color: "#78716c", borderRadius: 3 }}>L{p.level}</span>}
                  </td>
                )}
                {includeSubparts && (
                  <td style={{ ...td, fontSize: 10, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>
                    {p.isRoot ? "—" : (p.parentModel || "-")}
                  </td>
                )}
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: p.isRoot ? 600 : 500, paddingLeft: (includeSubparts && !p.isRoot) ? 8 + (p.level - 1) * 6 : 8 }}>
                  {p.stockCode}
                </td>
                <td style={td}>{p.stockName || "—"}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{fMoneyDisplay(p.cost)}</td>
                <td style={{ ...td, textAlign: "right" }}>%{p.marginActualPct.toFixed(0)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#166534", background: "#eff6ff" }}>{fMoneyDisplay(p.salesTl)}</td>
                <td style={{ ...td, textAlign: "right", color: "#166534" }}>{fMoneyDisplay(p.profitTl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: "var(--color-text-tertiary)" }}>
        💡 <b>Satış Fiyatı</b> = Maliyet × (1 + Marj%) → yuvarla. <b>Maliyet</b> = Mamul Maliyetleri hesabından birebir alınır (hiç ek hesap yok).
        {includeSubparts && <> · <b>Alt parça satırları</b>: Aynı stok kodu birden fazla mamulda kullanılırsa her mamulun altında ayrı satır olarak listelenir.</>}
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
