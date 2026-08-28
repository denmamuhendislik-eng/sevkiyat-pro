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
  subscribeProducts, subscribeSalesOrders,
  subscribePriceListDrafts, savePriceListDraft, deletePriceListDraft,
} from "./firestore";
import { calculateAllProductCosts } from "./productCostCalc";
import { DEFAULT_WEIGHTS, getOverheadMonthlyAvg } from "./distributionCalc";
import { fmtMoneyNum, CURRENCY_SYMBOLS, convertFromTl } from "./currency";
import { LEGACY_VIO_CODES } from "../../data/legacyVioCodes";

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

// Override yapısı iki formatı destekler (backward-compat):
//   eski: number → { marginPct: n, source: "margin" }
//   yeni: { marginPct?, salesTl?, source: "margin" | "price" }
function normalizeOverride(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return { marginPct: raw, source: "margin" };
  if (typeof raw === "object") {
    if (raw.source === "price" && Number(raw.salesTl) > 0) return { salesTl: Number(raw.salesTl), source: "price" };
    if (typeof raw.marginPct === "number") return { marginPct: Number(raw.marginPct), source: "margin" };
  }
  return null;
}

// Aktif currency değerini TL'ye çevir (tersine convertFromTl)
function convertToTl(value, currency, rates) {
  const v = Number(value) || 0;
  if (currency === "TRY" || !rates) return v;
  if (currency === "USD") return v * (Number(rates.usd) || 0);
  if (currency === "EUR") return v * (Number(rates.eur) || 0);
  return v;
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
  const [productsList, setProductsList] = useState([]);
  const [salesOrders, setSalesOrders] = useState({});
  const [drafts, setDrafts] = useState({});
  const [loaded, setLoaded] = useState({ bom: false, uc: false, wc: false, labor: false, pol: false, fas: false, conv: false, plp: false, prod: false, so: false, drafts: false });

  // v-draft — satır bazlı marj override (stockCode → marginPct)
  // Root'lar için aktif; taslak yükleme/kaydetme burayı doldurur/temizler.
  const [overrides, setOverrides] = useState({}); // { [stockCode]: marginPct }
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [draftDirty, setDraftDirty] = useState(false); // taslak yüklendikten sonra değişim var mı

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
    const u9 = subscribeProducts(d => { setProductsList(Array.isArray(d) ? d : []); setLoaded(l => ({ ...l, prod: true })); });
    const u10 = subscribePriceListDrafts(d => { setDrafts(d?.drafts || {}); setLoaded(l => ({ ...l, drafts: true })); });
    const u11 = subscribeSalesOrders(d => { setSalesOrders(d || {}); setLoaded(l => ({ ...l, so: true })); });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); u9(); u10(); u11(); };
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

    // Products (vioCode + LEGACY_VIO_CODES fallback → salesPriceEur)
    // ProfitabilityTab paterni: p.vioCode boşsa LEGACY_VIO_CODES[p.id]'yi kullan.
    const productByVio = new Map();
    for (const p of (productsList || [])) {
      const code = ((p?.vioCode || "").trim()) || (LEGACY_VIO_CODES[p?.id] || "").trim();
      if (code) productByVio.set(code, p);
    }
    const eurRate = Number(rates?.eur) || 0;

    // Diğer Müşteriler (salesOrders) → stokKodu → en güncel aktif siparişin unitPriceTl
    // (ProfitabilityTab paterni ile birebir aynı)
    const yerliByStock = new Map();
    for (const o of Object.values(salesOrders || {})) {
      const code = (o?.stokKodu || "").trim();
      const remaining = Number(o?.kalanMiktar || 0);
      if (!code || remaining <= 0) continue;
      let priceTl = Number(o.unitPriceTl || 0);
      if (!(priceTl > 0)) {
        const tot = Number(o.toplamBedel || 0);
        const orig = Number(o.orijinalMiktar || 0);
        if (tot > 0 && orig > 0) priceTl = tot / orig;
      }
      if (!(priceTl > 0)) continue;
      const orderDate = o.orderDate || "";
      const existing = yerliByStock.get(code);
      if (!existing || (orderDate && orderDate > (existing.orderDate || ""))) {
        yerliByStock.set(code, { priceTl, orderDate, customerCode: o.customerCode, customerName: o.customerName });
      }
    }

    // Hesap: satış + kâr + marj% (yeni + mevcut + fark)
    const q = searchText.trim().toLocaleLowerCase("tr-TR");
    return rows
      .map(r => {
        // Mevcut fiyat kaynak zinciri: Sevkiyat Planı EUR → Diğer Müşteriler TL
        const prod = productByVio.get(r.stockCode);
        const existingEur = Number(prod?.salesPriceEur) || 0;
        const sevkTl = existingEur > 0 && eurRate > 0 ? existingEur * eurRate : 0;
        const yerliEntry = yerliByStock.get(r.stockCode) || null;
        const yerliTl = Number(yerliEntry?.priceTl) || 0;
        // Öncelik: Sevkiyat (EUR) > Diğer Müşteriler (TL). İki kanalda da olabilir.
        const existingTl = sevkTl > 0 ? sevkTl : yerliTl;
        const existingSource = sevkTl > 0 ? "sevkiyat" : (yerliTl > 0 ? "yerli" : null);
        const existingMarginPct = existingTl > 0 && r.cost > 0
          ? ((existingTl - r.cost) / r.cost) * 100
          : null;
        // Override iki formda olabilir: marginPct veya salesTl
        const rawOverride = Object.prototype.hasOwnProperty.call(overrides, r.stockCode)
          ? overrides[r.stockCode]
          : null;
        const ov = (r.isRoot ? normalizeOverride(rawOverride) : null);
        let salesTl, effectiveMargin, overrideSource;
        if (ov?.source === "price" && Number(ov.salesTl) > 0) {
          // Kullanıcı fiyat girdi → yuvarlama uygulanmaz, marj hesaplanır
          salesTl = Number(ov.salesTl);
          effectiveMargin = r.cost > 0 ? ((salesTl - r.cost) / r.cost) * 100 : 0;
          overrideSource = "price";
        } else if (ov?.source === "margin" && typeof ov.marginPct === "number") {
          effectiveMargin = ov.marginPct;
          salesTl = applyRounding(r.cost * (1 + effectiveMargin / 100), rounding);
          overrideSource = "margin";
        } else {
          effectiveMargin = marginPct;
          salesTl = applyRounding(r.cost * (1 + (effectiveMargin || 0) / 100), rounding);
          overrideSource = null;
        }
        const profitTl = salesTl - r.cost;
        const marginActualPct = r.cost > 0 ? (profitTl / r.cost) * 100 : 0;
        // Fark: yeni fiyat vs mevcut fiyat (TL bazında, ekranda currency'ye çevrilir)
        const deltaTl = existingTl > 0 ? salesTl - existingTl : 0;
        const deltaPct = existingTl > 0 ? ((salesTl - existingTl) / existingTl) * 100 : 0;
        return {
          ...r, salesTl, profitTl, marginActualPct,
          existingTl, existingMarginPct,
          existingSource,           // "sevkiyat" | "yerli" | null
          sevkTl, yerliTl,          // iki kanalı da bilelim (tooltip)
          yerliCustomer: yerliEntry?.customerName || yerliEntry?.customerCode || null,
          effectiveMargin, hasOverride: overrideSource != null,
          overrideSource,           // "margin" | "price" | null
          deltaTl, deltaPct,
        };
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
  }, [calc, marginPct, rounding, viewMode, maxLevel, searchText, onlyCosted, productsList, salesOrders, rates, overrides]);

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

  // ============================================================
  // Taslak (draft) yönetimi — sadece taslak, prod'a hiçbir şey yazılmaz
  // ============================================================
  // Marj input handler — override.source = "margin"
  const setRowMarginOverride = (stockCode, value) => {
    const v = String(value).trim();
    setOverrides(prev => {
      const next = { ...prev };
      if (v === "" || v === "-") { delete next[stockCode]; }
      else { const n = Number(v); if (!Number.isNaN(n)) next[stockCode] = { marginPct: n, source: "margin" }; }
      return next;
    });
    setDraftDirty(true);
  };
  // Fiyat input handler — override.source = "price" (currency → TL çevirimi)
  const setRowPriceOverride = (stockCode, valueInCurrency) => {
    const v = String(valueInCurrency).trim();
    setOverrides(prev => {
      const next = { ...prev };
      if (v === "" || v === "-") { delete next[stockCode]; }
      else {
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) {
          const tl = convertToTl(n, currency, rates);
          next[stockCode] = { salesTl: tl, source: "price" };
        }
      }
      return next;
    });
    setDraftDirty(true);
  };
  const resetRowOverride = (stockCode) => {
    setOverrides(prev => { const next = { ...prev }; delete next[stockCode]; return next; });
    setDraftDirty(true);
  };
  const resetAllOverrides = () => {
    if (Object.keys(overrides).length === 0) return;
    if (!confirm(`${Object.keys(overrides).length} satır bazlı marj değişikliği sıfırlanacak. Devam?`)) return;
    setOverrides({});
    setDraftDirty(true);
  };

  const draftList = useMemo(() =>
    Object.values(drafts || {}).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
  [drafts]);
  const selectedDraft = selectedDraftId ? drafts[selectedDraftId] : null;

  const loadDraft = (draftId) => {
    setSelectedDraftId(draftId);
    if (!draftId) { setOverrides({}); setDraftDirty(false); return; }
    const d = drafts[draftId];
    if (!d) return;
    setOverrides(d.overrides || {});
    if (typeof d.globalMarginPct === "number") setMarginPct(d.globalMarginPct);
    if (typeof d.rounding === "number") setRounding(d.rounding);
    setDraftDirty(false);
  };

  const handleSaveDraft = async () => {
    if (!canEdit) return;
    let id = selectedDraftId;
    let name = selectedDraft?.name || "";
    if (!id) {
      name = (prompt("Yeni taslak adı:") || "").trim();
      if (!name) return;
      id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }
    const payload = {
      id, name,
      baseMonth: selectedMonth,
      currency,
      globalMarginPct: marginPct,
      rounding,
      overrides,
    };
    try {
      await savePriceListDraft(payload, { canEdit, userEmail });
      setSelectedDraftId(id);
      setDraftDirty(false);
      alert(`Taslak kaydedildi: ${name} ✓`);
    } catch (e) { alert("Taslak kaydedilemedi: " + e.message); }
  };

  const handleRenameDraft = async () => {
    if (!canEdit || !selectedDraft) return;
    const newName = (prompt("Taslak yeni adı:", selectedDraft.name) || "").trim();
    if (!newName || newName === selectedDraft.name) return;
    try {
      await savePriceListDraft({ ...selectedDraft, name: newName, overrides, globalMarginPct: marginPct, rounding, currency, baseMonth: selectedMonth }, { canEdit, userEmail });
      setDraftDirty(false);
    } catch (e) { alert("Ad değiştirilemedi: " + e.message); }
  };

  const handleDeleteDraft = async () => {
    if (!canEdit || !selectedDraftId) return;
    if (!confirm(`"${selectedDraft?.name || selectedDraftId}" taslağı silinecek. Devam?`)) return;
    try {
      await deletePriceListDraft(selectedDraftId, { canEdit, userEmail });
      setSelectedDraftId("");
      setOverrides({});
      setDraftDirty(false);
    } catch (e) { alert("Silinemedi: " + e.message); }
  };

  const currencyMismatch = selectedDraft && selectedDraft.currency && selectedDraft.currency !== currency;
  const monthMismatch = selectedDraft && selectedDraft.baseMonth && selectedDraft.baseMonth !== selectedMonth;
  const overrideCount = Object.keys(overrides).length;

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

      {/* Taslak yönetimi — satır bazlı marj değişikliği çalışması */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 12px", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#5b21b6" }}>📝 Taslak:</span>
        <select value={selectedDraftId} onChange={e => loadDraft(e.target.value)}
          style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #ddd6fe", borderRadius: 4, minWidth: 200 }}>
          <option value="">— Yeni (kaydetmeden çalış) —</option>
          {draftList.map(d => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.baseMonth || "?"} · {d.currency || "?"} · {Object.keys(d.overrides || {}).length} satır
            </option>
          ))}
        </select>
        <button onClick={handleSaveDraft} disabled={!canEdit}
          title={selectedDraftId ? "Bu taslağın üzerine yaz" : "Yeni taslak olarak kaydet"}
          style={{ padding: "4px 10px", fontSize: 11, background: "#5b21b6", color: "#fff", border: "none", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 600 }}>
          💾 {selectedDraftId ? "Kaydet" : "Yeni Kaydet"}
        </button>
        {selectedDraftId && (
          <>
            <button onClick={handleRenameDraft} disabled={!canEdit}
              style={{ padding: "4px 10px", fontSize: 11, background: "#fff", color: "#5b21b6", border: "1px solid #ddd6fe", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed" }}>
              ✏ Ad Değiştir
            </button>
            <button onClick={handleDeleteDraft} disabled={!canEdit}
              style={{ padding: "4px 10px", fontSize: 11, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed" }}>
              🗑 Sil
            </button>
          </>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#57534e" }}>
          {overrideCount > 0 && <span style={{ marginRight: 8, padding: "2px 6px", background: "#fef3c7", color: "#92400e", borderRadius: 3, fontWeight: 600 }}>{overrideCount} satırda özel marj</span>}
          {draftDirty && selectedDraftId && <span style={{ marginRight: 8, color: "#dc2626", fontWeight: 600 }}>● kaydedilmemiş değişiklik</span>}
          {overrideCount > 0 && (
            <button onClick={resetAllOverrides} title="Tüm satır override'larını sıfırla"
              style={{ padding: "2px 8px", fontSize: 10, background: "#fff", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>
              🔄 Tümünü Sıfırla
            </button>
          )}
        </span>
        <div style={{ flexBasis: "100%", fontSize: 10, color: "#78716c" }}>
          ℹ Taslak değişiklikleri <b>ürün kartındaki satış fiyatına yansımaz</b> — sadece bu ekranda simülasyon. Ürün fiyatı değişimi için ayrı adım gerekir.
          {currencyMismatch && <span style={{ marginLeft: 8, padding: "1px 5px", background: "#fef2f2", color: "#991b1b", borderRadius: 2, fontWeight: 600 }}>⚠ Taslak {selectedDraft.currency} para biriminde kaydedildi (ekran: {currency})</span>}
          {monthMismatch && <span style={{ marginLeft: 8, padding: "1px 5px", background: "#fef2f2", color: "#991b1b", borderRadius: 2, fontWeight: 600 }}>⚠ Taslak {selectedDraft.baseMonth} ayında kaydedildi (ekran: {selectedMonth})</span>}
        </div>
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
              <th style={{ ...th, textAlign: "right", background: "#fafaf9" }} title="Ürün kartındaki mevcut satış fiyatı (products.salesPriceEur → currency)">Mevcut Fiyat</th>
              <th style={{ ...th, textAlign: "right", background: "#fafaf9" }} title="(Mevcut - Maliyet) / Maliyet">Mevcut Marj%</th>
              <th style={{ ...th, textAlign: "right", background: "#f5f3ff", width: 90 }} title="Satır bazlı özel marj (sadece mamullerde) — global marj default">Yeni Marj%</th>
              <th style={{ ...th, textAlign: "right", background: "#eff6ff" }}>Yeni Satış</th>
              <th style={{ ...th, textAlign: "right" }} title="Yeni - Mevcut">Fark</th>
              <th style={{ ...th, textAlign: "right" }}>Kâr</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={(showSubpartsCols ? 12 : 10) + (showDetailCols ? 3 : 0)} style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)" }}>Eşleşen kayıt yok</td></tr>
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
                {/* Mevcut Fiyat + kanal rozeti + tooltip */}
                <td style={{ ...td, textAlign: "right", background: "#fafaf9", color: p.existingTl > 0 ? "#44403c" : "#a8a29e" }}
                  title={
                    p.existingSource === "sevkiyat"
                      ? `Sevkiyat Planı (products.salesPriceEur)${p.yerliTl > 0 ? ` · Yerli aktif sipariş: ${fMoneyDisplay(p.yerliTl)}${p.yerliCustomer ? ` (${p.yerliCustomer})` : ""}` : ""}`
                      : p.existingSource === "yerli"
                        ? `Diğer Müşteriler (aktif sipariş)${p.yerliCustomer ? ` · ${p.yerliCustomer}` : ""}`
                        : "Mevcut fiyat kaynağı yok"
                  }>
                  {p.existingTl > 0 ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 9, opacity: 0.7 }}>{p.existingSource === "sevkiyat" ? "📤" : "🏭"}</span>
                      {fMoneyDisplay(p.existingTl)}
                      {p.existingSource === "sevkiyat" && p.yerliTl > 0 && (
                        <span style={{ fontSize: 8, color: "#a8a29e" }}>+🏭</span>
                      )}
                    </span>
                  ) : "—"}
                </td>
                <td style={{ ...td, textAlign: "right", background: "#fafaf9", color: p.existingMarginPct != null ? "#44403c" : "#a8a29e" }}>
                  {p.existingMarginPct != null ? `%${p.existingMarginPct.toFixed(0)}` : "—"}
                </td>
                {/* Yeni Marj% — root'larda input; kaynak fiyat ise hesaplanmış değer gösterilir */}
                <td style={{ ...td, textAlign: "right", background: "#f5f3ff" }}>
                  {p.isRoot ? (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <input type="number" step="1"
                        value={p.overrideSource === "margin" ? String(overrides[p.stockCode]?.marginPct ?? overrides[p.stockCode] ?? "") : (p.overrideSource === "price" ? p.effectiveMargin.toFixed(1) : "")}
                        placeholder={`%${marginPct}`}
                        onChange={e => setRowMarginOverride(p.stockCode, e.target.value)}
                        disabled={!canEdit}
                        title={p.overrideSource === "price" ? "Fiyat üzerinden hesaplanmış marj — yazarsan marj kaynağına döner" : "Marj gir → fiyat hesaplanır"}
                        style={{ width: 55, padding: "2px 5px", fontSize: 10, textAlign: "right",
                          border: `1px solid ${p.overrideSource === "margin" ? "#5b21b6" : "#e7e5e4"}`,
                          background: p.overrideSource === "margin" ? "#ede9fe" : (p.overrideSource === "price" ? "#fafaf9" : "#fff"),
                          color: p.overrideSource === "price" ? "#78716c" : "#000",
                          borderRadius: 3, fontWeight: p.overrideSource === "margin" ? 700 : 400 }} />
                      {p.hasOverride && (
                        <button onClick={() => resetRowOverride(p.stockCode)} title="Satır override'ını sıfırla"
                          style={{ padding: "1px 4px", fontSize: 9, background: "#fff", border: "1px solid #d6d3d1", borderRadius: 2, cursor: "pointer", color: "#78716c" }}>×</button>
                      )}
                    </div>
                  ) : <span style={{ color: "#a8a29e", fontSize: 10 }}>%{p.marginActualPct.toFixed(0)}</span>}
                </td>
                {/* Yeni Satış — root'larda input; kaynak marj ise hesaplanmış değer gösterilir */}
                <td style={{ ...td, textAlign: "right", background: "#eff6ff" }}>
                  {p.isRoot ? (
                    <PriceInput
                      salesTl={p.salesTl}
                      currency={currency}
                      rates={rates}
                      source={p.overrideSource}
                      canEdit={canEdit}
                      onChange={val => setRowPriceOverride(p.stockCode, val)}
                    />
                  ) : <span style={{ fontWeight: 700, color: "#166534" }}>{fMoneyDisplay(p.salesTl)}</span>}
                </td>
                {/* Fark */}
                <td style={{ ...td, textAlign: "right" }}>
                  {p.existingTl > 0 ? (
                    <div style={{ fontSize: 10, color: p.deltaTl > 0 ? "#166534" : p.deltaTl < 0 ? "#dc2626" : "#78716c" }}>
                      <div style={{ fontWeight: 700 }}>{p.deltaTl > 0 ? "+" : ""}{fMoneyDisplay(p.deltaTl)}</div>
                      <div style={{ fontSize: 9 }}>{p.deltaTl > 0 ? "+" : ""}%{p.deltaPct.toFixed(1)}</div>
                    </div>
                  ) : <span style={{ color: "#a8a29e" }}>—</span>}
                </td>
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

// Fiyat input alt bileşeni — focus sırasında ham metin, blur'da parse.
// Böylece kullanıcı 1000.50 yazarken cursor sıçraması olmaz, currency dönüşümü
// blur/enter anında bir kez yapılır.
function PriceInput({ salesTl, currency, rates, source, canEdit, onChange }) {
  const displayVal = currency === "TRY" ? salesTl : (currency === "USD" ? (Number(rates?.usd) ? salesTl / rates.usd : 0) : (Number(rates?.eur) ? salesTl / rates.eur : 0));
  const [text, setText] = useState(String(Number(displayVal.toFixed(2))));
  const [focused, setFocused] = useState(false);
  // Focus yokken salesTl/currency değişirse text güncelle
  useEffect(() => {
    if (!focused) setText(String(Number(displayVal.toFixed(2))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesTl, currency, focused]);
  const commit = () => onChange(text);
  return (
    <input type="number" step="0.01"
      value={text}
      onChange={e => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
      disabled={!canEdit}
      title={source === "margin" ? "Marj üzerinden hesaplanmış fiyat — yazarsan fiyat kaynağına döner (yuvarlama bypass)" : "Fiyat gir → marj hesaplanır (yuvarlama uygulanmaz)"}
      style={{ width: 90, padding: "2px 5px", fontSize: 10, textAlign: "right",
        border: `1px solid ${source === "price" ? "#5b21b6" : "#e7e5e4"}`,
        background: source === "price" ? "#ede9fe" : "#fff",
        color: source === "margin" ? "#78716c" : "#166534",
        borderRadius: 3, fontWeight: source === "price" ? 700 : 500 }} />
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
const btnSecondary = { padding: "4px 8px", fontSize: 11, background: "#f5f5f4", border: "1px solid var(--color-border-secondary)", borderRadius: 4, cursor: "pointer" };
const btnExportBlue = { padding: "4px 10px", fontSize: 11, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 };
const btnExportGreen = { padding: "4px 10px", fontSize: 11, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 };
const btnExportBlueOutline = { padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer" };
const btnExportGreenOutline = { padding: "4px 10px", fontSize: 11, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer" };
