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
import { DEFAULT_WEIGHTS, getOverheadMonthlyAvg } from "./distributionCalc";
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
  // viewMode: "roots" (sadece mamuller) | "global" (mamuller + global alt parçalar) |
  //           "breakdown" (mamul kırılımı: her mamul + kendi tüm alt parçaları)
  const [viewMode, setViewMode] = useState("roots");
  // Breakdown modunda maksimum level filtresi — 1 (yedek parça, önerilen) / 2 / 999 (tüm)
  const [maxLevel, setMaxLevel] = useState(1);
  // Detay kolonları (Malzeme / İşçilik / Fason) bilgi amaçlı — fiyat hesabı değişmez
  const [showDetailCols, setShowDetailCols] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [onlyCosted, setOnlyCosted] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const policyLoadedRef = useRef(false);

  useEffect(() => {
    const u1 = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(l => ({ ...l, bom: true })); });
    const u2 = subscribeUnitCosts(d => { setUnitCosts(d || {}); setLoaded(l => ({ ...l, uc: true })); });
    const u3 = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(l => ({ ...l, wc: true })); });
    const u4 = subscribeLaborCosts(d => { setLaborData(d || {}); setLoaded(l => ({ ...l, labor: true })); });
    const u5 = subscribeOverheadPolicy(d => {
      // ProfitabilityTab pattern'i: policy boş gelirse default weights ile boşluk doldur.
      setPolicy(!d || Object.keys(d).length === 0 ? { weights: { ...DEFAULT_WEIGHTS }, wcSalaryMapping: {} } : d);
      setLoaded(l => ({ ...l, pol: true }));
    });
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
          // Backward-compat: eski includeSubparts bool → viewMode string
          if (typeof d.viewMode === "string") setViewMode(d.viewMode);
          else if (typeof d.includeSubparts === "boolean") setViewMode(d.includeSubparts ? "global" : "roots");
          if (typeof d.maxLevel === "number") setMaxLevel(d.maxLevel);
          if (typeof d.showDetailCols === "boolean") setShowDetailCols(d.showDetailCols);
        }
      }
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthlySupplies = laborData?.monthlySupplies || {};
  const availableMonths = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);

  // Seçili ay mevcut değilse en son mevcut aya düş
  useEffect(() => {
    if (availableMonths.length === 0) return;
    if (monthlyOverheads[selectedMonth]) return;
    setSelectedMonth(availableMonths[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths, selectedMonth]);

  // Overhead ay verisi — ProductCostsTab/ProfitabilityTab ile birebir aynı mantık.
  // "avg" modda son X ayın ortalaması alınır (policy.overheadAvgWindowMonths, default 6).
  // Aksi halde ham ay verisi. Bu monthData productCostCalc'a gider → aynı rootCost.
  const overheadAvgMode = policy?.overheadAvgMode || "avg";
  const overheadAvgWindow = Number(policy?.overheadAvgWindowMonths) || 6;
  const monthData = useMemo(() => {
    if (overheadAvgMode === "avg") {
      const avg = getOverheadMonthlyAvg(monthlyOverheads, overheadAvgWindow, selectedMonth);
      if (avg?._avgInfo?.monthsUsed > 0) return avg;
    }
    return monthlyOverheads[selectedMonth];
  }, [monthlyOverheads, overheadAvgMode, overheadAvgWindow, selectedMonth]);

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
  // 3 görünüm modu:
  //   roots     → sadece mamuller (her BOM'un root'u, unique stok kodu)
  //   global    → mamuller + hiçbir BOM'un root'u OLMAYAN alt parçalar (BUY vs.)
  //   breakdown → her mamul + kendi BOM ağacındaki TÜM alt parçalar (root olsa da),
  //               yedek parça / kırılım için — aynı stok farklı mamullerde ayrı satır
  const products = useMemo(() => {
    if (!calc?.byModel) return [];
    const models = Object.values(calc.byModel);

    // Root map — her stok kodu için en yüksek rootCost (aynı stok birden fazla
    // BOM'un root'uysa; genelde yok ama savunma). Roots/global mod için kullanılır.
    const rootByStock = new Map();
    for (const m of models) {
      const code = (m.rootStockCode || "").trim();
      if (!code) continue;
      const cost = Number(m.rootCost) || 0;
      const existing = rootByStock.get(code);
      if (!existing || cost > existing.cost) {
        rootByStock.set(code, {
          stockCode: code,
          stockName: m.rootStockName || m.modelName || "",
          cost,
          material: Number(m.rootMaterial) || 0,
          labor: Number(m.rootLabor) || 0,
          fason: Number(m.rootFason) || 0,
          modelKey: m.modelKey,
        });
      }
    }

    const rows = [];

    if (viewMode === "breakdown") {
      // Mamul kırılımı: her mamul için kendi BOM ağacındaki tüm parçalar
      // (root + alt parçalar). Bir mamul = bir "grup". Aynı stok kodu farklı
      // mamullerde ayrı satır (kasıtlı — her mamul için bağımsız kırılım).
      for (const m of models) {
        const modelLabel = m.modelCode || m.rootStockCode || m.modelKey || "";
        const rootStockCode = (m.rootStockCode || "").trim();
        // Mamul (root) satırı
        rows.push({
          id: `bd:${m.modelKey}:root`,
          stockCode: rootStockCode,
          stockName: m.rootStockName || m.modelName || "",
          level: 0,
          isRoot: true,
          parentModel: modelLabel,
          groupModelKey: m.modelKey,
          cost: Number(m.rootCost) || 0,
          material: Number(m.rootMaterial) || 0,
          labor: Number(m.rootLabor) || 0,
          fason: Number(m.rootFason) || 0,
        });
        // Alt parçalar (root hariç, partsList'ten) — level filtresi ile
        for (const p of (m.partsList || [])) {
          if (p.parentIdx === null || p.parentIdx === undefined) continue;
          const code = (p.stockCode || "").trim();
          if (!code) continue;
          const partLevel = Number(p.level) || 1;
          if (partLevel > maxLevel) continue; // level filtresi
          rows.push({
            id: `bd:${m.modelKey}:${p.idx}`,
            stockCode: code,
            stockName: p.stockName || "",
            level: partLevel,
            isRoot: false,
            parentModel: modelLabel,
            groupModelKey: m.modelKey,
            cost: Number(p.unitCost) || 0,
            supplyType: p.supplyType || "",
            material: Number(p.materialCost) || 0,
            labor: Number(p.laborCost) || 0,
            fason: Number(p.fasonCost) || 0,
          });
        }
      }
    } else {
      // "roots" ya da "global" — global (unique) liste
      // 1) Mamuller
      for (const r of rootByStock.values()) {
        rows.push({
          id: `root:${r.stockCode}`,
          stockCode: r.stockCode,
          stockName: r.stockName,
          level: 0,
          isRoot: true,
          parentModel: null,
          groupModelKey: null,
          cost: r.cost,
          material: r.material,
          labor: r.labor,
          fason: r.fason,
        });
      }
      // 2) Global mod: root olmayan stok kodları alt parça olarak
      if (viewMode === "global") {
        const subByStock = new Map();
        for (const m of models) {
          for (const p of (m.partsList || [])) {
            if (p.parentIdx === null || p.parentIdx === undefined) continue;
            const code = (p.stockCode || "").trim();
            if (!code) continue;
            if (rootByStock.has(code)) continue; // root olarak varsa dahil etme
            const cost = Number(p.unitCost) || 0;
            const parentModelName = m.modelCode || m.rootStockCode || "";
            const existing = subByStock.get(code);
            if (!existing) {
              subByStock.set(code, {
                stockCode: code,
                stockName: p.stockName || "",
                cost,
                material: Number(p.materialCost) || 0,
                labor: Number(p.laborCost) || 0,
                fason: Number(p.fasonCost) || 0,
                parentModels: new Set([parentModelName]),
                level: Number(p.level) || 1,
                supplyType: p.supplyType || "",
              });
            } else {
              if (cost > existing.cost) {
                existing.cost = cost;
                existing.material = Number(p.materialCost) || 0;
                existing.labor = Number(p.laborCost) || 0;
                existing.fason = Number(p.fasonCost) || 0;
              }
              existing.parentModels.add(parentModelName);
            }
          }
        }
        for (const s of subByStock.values()) {
          rows.push({
            id: `sub:${s.stockCode}`,
            stockCode: s.stockCode,
            stockName: s.stockName,
            level: s.level,
            isRoot: false,
            parentModel: Array.from(s.parentModels).join(", "),
            groupModelKey: null,
            cost: s.cost,
            supplyType: s.supplyType,
            material: s.material,
            labor: s.labor,
            fason: s.fason,
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
        if (viewMode === "breakdown") {
          // Grupla: aynı mamul altında root önce, sonra alt parçalar level'a göre
          const ak = a.groupModelKey || "";
          const bk = b.groupModelKey || "";
          if (ak !== bk) {
            // Modeller arası: mamulun rootCost'una göre desc
            const aRoot = a.isRoot ? a.cost : (calc.byModel[ak]?.rootCost || 0);
            const bRoot = b.isRoot ? b.cost : (calc.byModel[bk]?.rootCost || 0);
            return bRoot - aRoot;
          }
          if (a.isRoot && !b.isRoot) return -1;
          if (!a.isRoot && b.isRoot) return 1;
          return (a.level || 0) - (b.level || 0);
        }
        // roots/global: mamuller önce, sonra alt parçalar; her grup içinde maliyet desc
        if (a.isRoot && !b.isRoot) return -1;
        if (!a.isRoot && b.isRoot) return 1;
        return b.cost - a.cost;
      });
  }, [calc, marginPct, rounding, viewMode, maxLevel, searchText, onlyCosted]);

  const selectedProducts = useMemo(
    () => products.filter(p => selectedIds.has(p.id)),
    [products, selectedIds]
  );

  // Breakdown modunda mamul seçildiğinde/kaldırıldığında aynı grubun tüm alt
  // parçalarını da otomatik seç/kaldır. Kullanıcı isteği: yedek parça listesinde
  // mamulü seçmek = tüm kırılımı seçmek.
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    const clicked = products.find(p => p.id === id);
    const willSelect = !next.has(id);
    if (willSelect) next.add(id); else next.delete(id);
    // Breakdown mod + tıklanan bir mamul (root) ise grubun alt parçalarını da toggle et
    if (viewMode === "breakdown" && clicked?.isRoot && clicked.groupModelKey) {
      for (const p of products) {
        if (p.groupModelKey === clicked.groupModelKey && p.id !== id) {
          if (willSelect) next.add(p.id); else next.delete(p.id);
        }
      }
    }
    return next;
  });
  const selectAll = () => setSelectedIds(new Set(products.map(p => p.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const savePolicy = async () => {
    if (!canEdit) return;
    try {
      await savePriceListPolicy({
        marginPct, rounding, viewMode, maxLevel, showDetailCols,
      }, { canEdit, userEmail });
      alert("Ayarlar kaydedildi ✓");
    } catch (e) {
      alert("Kaydedilemedi: " + e.message);
    }
  };

  // Para birimi biçim (rootCost TL bazında; kur uygulanır)
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const fMoneyDisplay = (tl) => fmtMoneyNum(tl, currency, rates, 2);
  const convVal = (tl) => currency === "TRY" ? tl : (convertFromTl(tl, currency, rates) || tl);

  // Alt parça kolonları (Sev./Ana Mamul) hangi modlarda görünsün — global veya breakdown
  const showSubpartsCols = viewMode !== "roots";

  // ============================================================
  // Excel Export
  // ============================================================
  const exportExcel = (variant /* "internal" | "customer" */) => {
    const list = selectedProducts.length > 0 ? selectedProducts : products;
    if (list.length === 0) { alert("Listede ürün yok"); return; }
    const isInternal = variant === "internal";
    // Header
    // Dahili modda showDetailCols açıksa Malzeme/İşçilik/Fason kolonları eklenir
    const detailHeader = showDetailCols ? ["Malzeme", "İşçilik", "Fason"] : [];
    const header = isInternal
      ? (showSubpartsCols
          ? ["Seviye", "Ana Mamul", "Stok Kodu", "Ad", ...detailHeader, "Maliyet", "Marj %", "Satış Fiyatı", "Kâr"]
          : ["Stok Kodu", "Ad", ...detailHeader, "Maliyet", "Marj %", "Satış Fiyatı", "Kâr"])
      : (showSubpartsCols
          ? ["Seviye", "Ana Mamul", "Stok Kodu", "Ad", "Satış Fiyatı"]
          : ["Stok Kodu", "Ad", "Satış Fiyatı"]);
    const rows = [header];
    for (const p of list) {
      if (isInternal) {
        const detailVals = showDetailCols
          ? [Number(convVal(p.material).toFixed(2)), Number(convVal(p.labor).toFixed(2)), Number(convVal(p.fason).toFixed(2))]
          : [];
        const baseRow = [
          p.stockCode, p.stockName,
          ...detailVals,
          Number(convVal(p.cost).toFixed(2)),
          Number(p.marginActualPct.toFixed(1)),
          Number(convVal(p.salesTl).toFixed(2)),
          Number(convVal(p.profitTl).toFixed(2)),
        ];
        if (showSubpartsCols) {
          rows.push([p.isRoot ? "MAMÜL" : `L${p.level}`, p.parentModel || "-", ...baseRow]);
        } else {
          rows.push(baseRow);
        }
      } else {
        const baseRow = [p.stockCode, p.stockName, Number(convVal(p.salesTl).toFixed(2))];
        if (showSubpartsCols) {
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
      [showSubpartsCols ? "Kapsam: Mamül + Alt parçalar" : "Kapsam: Sadece mamüller"],
      [`Kayıt sayısı: ${list.length}`],
      [],
    ];
    const finalRows = [...meta, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(finalRows);
    // Kolon genişlikleri
    if (isInternal) {
      const detailWch = showDetailCols ? [{ wch: 12 }, { wch: 12 }, { wch: 12 }] : [];
      ws["!cols"] = showSubpartsCols
        ? [{ wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 44 }, ...detailWch, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 12 }]
        : [{ wch: 16 }, { wch: 44 }, ...detailWch, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
    } else {
      ws["!cols"] = showSubpartsCols
        ? [{ wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 44 }, { wch: 14 }]
        : [{ wch: 16 }, { wch: 44 }, { wch: 14 }];
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiyat Listesi");
    const fileName = `fiyat_listesi_${variant}_${selectedMonth}_${currency}${viewMode === "breakdown" ? "_kirilim" : viewMode === "global" ? "_global" : ""}.xlsx`;
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
    if (showSubpartsCols) {
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text("Mamul + alt parcalar dahil", marginL, 27);
      pdf.setTextColor(0);
    }

    const startY = showSubpartsCols ? 34 : 32;
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
      cols = showSubpartsCols ? [
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
      cols = showSubpartsCols ? [
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
        if (showSubpartsCols) {
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
        if (showSubpartsCols) {
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
    pdf.save(`fiyat_listesi_${variant}_${selectedMonth}_${currency}${viewMode === "breakdown" ? "_kirilim" : viewMode === "global" ? "_global" : ""}.pdf`);
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
        <div title="Ay seçimi Mamul Maliyetleri sekmesinden yapılır — burada değiştirilemez">
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Hesap ayı:</label>
          <span style={{ padding: "5px 10px", fontSize: 12, background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 4, fontWeight: 500 }}>
            📅 {monthLabel(selectedMonth) || "—"}
          </span>
          <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginLeft: 6 }}>(Mamul Maliyetleri'nden gelir)</span>
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
        <div title="Görünüm modu — alt parçaları nasıl listeleyeceğini seç">
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Görünüm:</label>
          <select value={viewMode} onChange={e => setViewMode(e.target.value)}
            style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
            <option value="roots">📦 Sadece Mamüller</option>
            <option value="global">🌐 Mamüller + Global Alt Parçalar</option>
            <option value="breakdown">🌲 Mamül Kırılımı (yedek parça listesi)</option>
          </select>
        </div>
        {viewMode === "breakdown" && (
          <div title="Kırılımda hangi seviyeye kadar göster (L2+ genelde iç yapıdır, fiyat mükerrer olabilir)">
            <label style={{ fontSize: 11, color: "var(--color-text-secondary)", marginRight: 6 }}>Seviye:</label>
            <select value={maxLevel} onChange={e => setMaxLevel(Number(e.target.value))}
              style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
              <option value={1}>L1 (yedek parça — önerilen)</option>
              <option value={2}>L1-L2 (yarı mamul dahil)</option>
              <option value={999}>Tüm seviyeler</option>
            </select>
          </div>
        )}
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", background: showDetailCols ? "#fef3c7" : "#fff", border: "1px solid " + (showDetailCols ? "#fde68a" : "var(--color-border-secondary)"), borderRadius: 4 }}
          title="Malzeme / İşçilik / Fason kolonları — bilgi amaçlı (fiyat hesabı değişmez, toplam Maliyet aynı kalır)">
          <input type="checkbox" checked={showDetailCols} onChange={e => setShowDetailCols(e.target.checked)} />
          🔍 Detay Kolonları
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
              {showSubpartsCols && <th style={{ ...th, width: 60 }}>Sev.</th>}
              {showSubpartsCols && <th style={{ ...th, width: 130 }}>Ana Mamul</th>}
              <th style={th}>Stok Kodu</th>
              <th style={{ ...th, minWidth: 220 }}>Ad</th>
              {showDetailCols && <th style={{ ...th, textAlign: "right", background: "#fef3c7" }}>Malzeme</th>}
              {showDetailCols && <th style={{ ...th, textAlign: "right", background: "#fef3c7" }}>İşçilik</th>}
              {showDetailCols && <th style={{ ...th, textAlign: "right", background: "#fef3c7" }}>Fason</th>}
              <th style={{ ...th, textAlign: "right" }}>Maliyet</th>
              <th style={{ ...th, textAlign: "right" }}>Marj%</th>
              <th style={{ ...th, textAlign: "right", background: "#eff6ff" }}>Satış Fiyatı</th>
              <th style={{ ...th, textAlign: "right" }}>Kâr</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={(showSubpartsCols ? 9 : 7) + (showDetailCols ? 3 : 0)} style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)" }}>Eşleşen kayıt yok</td></tr>
            ) : products.map(p => (
              <tr key={p.id} style={{
                borderTop: "1px solid #f5f5f4",
                background: selectedIds.has(p.id) ? "#eff6ff" : (p.isRoot ? "transparent" : "#fafaf9"),
              }}>
                <td style={{ ...td, textAlign: "center" }}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                {showSubpartsCols && (
                  <td style={{ ...td, fontSize: 9 }}>
                    {p.isRoot
                      ? <span style={{ padding: "1px 5px", background: "#1e40af", color: "#fff", borderRadius: 3, fontWeight: 600 }}>MAMÜL</span>
                      : <span style={{ padding: "1px 5px", background: "#f5f5f4", color: "#78716c", borderRadius: 3 }}>L{p.level}</span>}
                  </td>
                )}
                {showSubpartsCols && (
                  <td style={{ ...td, fontSize: 10, color: "#78716c", fontFamily: "ui-monospace, monospace" }}
                    title={p.parentModel || ""}>
                    {p.isRoot ? "—" : (p.parentModel || "-").length > 30 ? (p.parentModel.slice(0, 28) + "…") : (p.parentModel || "-")}
                  </td>
                )}
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: p.isRoot ? 600 : 500 }}>
                  {p.stockCode}
                </td>
                <td style={td}>{p.stockName || "—"}</td>
                {showDetailCols && <td style={{ ...td, textAlign: "right", color: "#78716c", background: "#fef3c7" }}>{p.material > 0 ? fMoneyDisplay(p.material) : "—"}</td>}
                {showDetailCols && <td style={{ ...td, textAlign: "right", color: "#78716c", background: "#fef3c7" }}>{p.labor > 0 ? fMoneyDisplay(p.labor) : "—"}</td>}
                {showDetailCols && <td style={{ ...td, textAlign: "right", color: "#78716c", background: "#fef3c7" }}>{p.fason > 0 ? fMoneyDisplay(p.fason) : "—"}</td>}
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
        💡 <b>Satış Fiyatı</b> = Maliyet × (1 + Marj%) → yuvarla. Fiyat, Mamul Maliyetleri hesabından birebir alınır.
        {showDetailCols && <> · <b>Detay kolonları</b> (Malzeme/İşçilik/Fason) bilgi amaçlıdır — toplam <b>Maliyet</b>'ten farklı olabilir (aradaki fark = genel gider / overhead payı).</>}
        {viewMode === "roots" && <> · <b>Sadece Mamüller</b>: her BOM'un kök ürünü listelenir.</>}
        {viewMode === "global" && <> · <b>Global Alt Parçalar</b>: mamüller + hiçbir mamul olarak hesaplanmayan alt parçalar (BUY hammaddeler, yarı mamuller). Her stok tek satır.</>}
        {viewMode === "breakdown" && <> · <b>Mamül Kırılımı</b>: her mamul + BOM ağacındaki alt parçalar. Seviye = {maxLevel === 999 ? "tüm seviyeler" : maxLevel === 2 ? "L1-L2 (yarı mamul dahil)" : "L1 (yedek parça)"}. <b>L2+ genelde iç yapıdır</b>, fiyatı L1 içine dahildir; müşteriye yedek parça verirken L1 önerilir. Mamul satırının checkbox'ını tıklarsan alt parçaları da otomatik seçilir.</>}
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
