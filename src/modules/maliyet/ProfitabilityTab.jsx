import { useState, useEffect, useMemo } from "react";
import {
  subscribeBomModels, subscribeWorkCenters, subscribeUnitCosts,
  subscribeLaborCosts, subscribeOverheadPolicy, subscribeFasonRates,
  subscribeProducts, subscribeSalesOrders,
} from "./firestore";
import { calculateAllProductCosts } from "./productCostCalc";
import { DEFAULT_WEIGHTS } from "./distributionCalc";
import { fmtMoneyNum, CURRENCY_SYMBOLS } from "./currency";
import { LEGACY_VIO_CODES } from "../../data/legacyVioCodes";

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m) - 1]} ${y}`;
};

// Marj % → renk paleti (kullanıcı kararı: >20 yeşil, 0-20 sarı, <0 kırmızı, fiyatsız gri)
function marginColor(marginPct, hasPrice) {
  if (!hasPrice) return { bar: "#9CA3AF", bg: "rgba(156, 163, 175, 0.08)", label: "Fiyat yok" };
  if (marginPct < 0) return { bar: "#DC2626", bg: "rgba(220, 38, 38, 0.07)", label: "Zarar" };
  if (marginPct < 20) return { bar: "#F59E0B", bg: "rgba(245, 158, 11, 0.07)", label: "Düşük" };
  return { bar: "#22C55E", bg: "rgba(34, 197, 94, 0.07)", label: "Sağlıklı" };
}

const CHANNEL_LABELS = {
  sevkiyat: "Sevkiyat Planı",
  digerMusteriler: "Diğer Müşteriler",
};
const CHANNEL_COLORS = {
  sevkiyat: "#1D9E75",
  digerMusteriler: "#2563EB",
};

export default function ProfitabilityTab({ currency = "TRY", rates = null }) {
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const f2 = (tl) => fmtMoneyNum(tl, currency, rates, 2);

  // Subscriptions — ProductCostsTab ile aynı pattern
  const [bomModels, setBomModels] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [fasonRates, setFasonRates] = useState({});
  const [products, setProducts] = useState([]);
  const [salesOrders, setSalesOrders] = useState({});
  const [loaded, setLoaded] = useState({ bom: false, wc: false, unit: false, labor: false, pol: false, fason: false, prod: false, so: false });
  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [channelFilter, setChannelFilter] = useState("all"); // all | sevkiyat | digerMusteriler | noPrice
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("margin"); // margin | profit | cost | price | code
  const [sortDir, setSortDir] = useState("desc"); // desc | asc

  useEffect(() => { const u = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(p => ({ ...p, bom: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(p => ({ ...p, wc: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeUnitCosts(d => { setUnitCosts(d || {}); setLoaded(p => ({ ...p, unit: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeLaborCosts(d => { setLaborData(d || {}); setLoaded(p => ({ ...p, labor: true })); }); return u; }, []);
  useEffect(() => {
    const u = subscribeOverheadPolicy(d => {
      setPolicy(!d || Object.keys(d).length === 0 ? { weights: { ...DEFAULT_WEIGHTS }, wcSalaryMapping: {} } : d);
      setLoaded(p => ({ ...p, pol: true }));
    });
    return u;
  }, []);
  useEffect(() => { const u = subscribeFasonRates(d => { setFasonRates(d || {}); setLoaded(p => ({ ...p, fason: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeProducts(d => { setProducts(Array.isArray(d) ? d : []); setLoaded(p => ({ ...p, prod: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeSalesOrders(d => { setSalesOrders(d || {}); setLoaded(p => ({ ...p, so: true })); }); return u; }, []);

  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthsAvailable = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);

  // Default ay: en son tamamlanmış
  useEffect(() => {
    if (monthsAvailable.length === 0) return;
    if (monthlyOverheads[selectedMonth]) return;
    const cur = todayMonth();
    const completed = monthsAvailable.filter(m => m < cur);
    if (completed.length > 0) setSelectedMonth(completed[0]);
    else setSelectedMonth(monthsAvailable[0]);
  }, [monthsAvailable, selectedMonth, monthlyOverheads]);

  const monthData = monthlyOverheads[selectedMonth];
  const allLoaded = Object.values(loaded).every(Boolean);
  const monthlySupplies = laborData?.monthlySupplies || {};

  const calc = useMemo(() => {
    if (!allLoaded || !monthData) return null;
    return calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, refMonth: selectedMonth });
  }, [allLoaded, bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, selectedMonth]);

  // Sevkiyat Planı: vioCode → product map (salesPriceEur için)
  // products[].vioCode boş olan eski ürünler için LEGACY_VIO_CODES fallback —
  // App.jsx'in display fallback'i ile aynı mantık, böylece "ürün kartında VIO kodu görünen ama
  // products.vioCode field'ı boş" durum eşleşir.
  const productByVio = useMemo(() => {
    const m = {};
    products.forEach(p => {
      const code = ((p.vioCode || "").trim()) || (LEGACY_VIO_CODES[p.id] || "").trim();
      if (code) m[code] = p;
    });
    return m;
  }, [products]);

  // Diğer Müşteriler: stokKodu → en güncel aktif siparişin unitPriceTl (TL)
  // Birden fazla aktif sipariş varsa en güncel orderDate kazanır
  const salesPriceByStock = useMemo(() => {
    const m = {};
    Object.values(salesOrders).forEach(o => {
      const code = (o.stokKodu || "").trim();
      const remaining = Number(o.kalanMiktar || 0);
      if (!code || remaining <= 0) return;
      // Birim TL fiyat — unitPriceTl önce, yoksa toplamBedel / orijinalMiktar fallback
      let priceTl = Number(o.unitPriceTl || 0);
      if (!(priceTl > 0)) {
        const tot = Number(o.toplamBedel || 0);
        const orig = Number(o.orijinalMiktar || 0);
        if (tot > 0 && orig > 0) priceTl = tot / orig;
      }
      if (!(priceTl > 0)) return;
      const orderDate = o.orderDate || "";
      const existing = m[code];
      if (!existing || (orderDate && orderDate > (existing.orderDate || ""))) {
        m[code] = { priceTl, orderDate, customerCode: o.customerCode, customerName: o.customerName };
      }
    });
    return m;
  }, [salesOrders]);

  // Karlılık satırları — her (model, kanal) çifti bir satır
  const rows = useMemo(() => {
    if (!calc?.byModel) return [];
    const list = [];
    const eurRate = Number(rates?.eur) || 0;

    for (const model of Object.values(calc.byModel)) {
      const stockCode = (model.rootStockCode || "").trim();
      const costTl = Number(model.rootCost) || 0;

      // Kanal 1: Sevkiyat Planı (vioCode eşleşmesi)
      const matchedProduct = stockCode ? productByVio[stockCode] : null;
      const eurPrice = matchedProduct ? Number(matchedProduct.salesPriceEur || 0) : 0;
      if (matchedProduct) {
        // EUR fiyatı TL'ye çevirip karşılaştır (eurRate yoksa 0 olur → fiyatsız sayılır)
        const priceTl = eurPrice > 0 && eurRate > 0 ? eurPrice * eurRate : 0;
        const profitTl = priceTl - costTl;
        const marginPct = costTl > 0 && priceTl > 0 ? (profitTl / costTl) * 100 : null;
        list.push({
          key: `${model.modelKey}__sevkiyat`,
          modelKey: model.modelKey,
          modelName: model.modelName,
          modelCode: model.modelCode,
          stockCode: stockCode || matchedProduct.vioCode,
          productName: matchedProduct.nameTR || model.modelName,
          channel: "sevkiyat",
          costTl,
          priceTl,
          priceNative: eurPrice,
          priceNativeCurrency: "EUR",
          profitTl,
          marginPct,
          hasPrice: priceTl > 0,
          customer: null,
        });
      }

      // Kanal 2: Diğer Müşteriler (stokKodu eşleşmesi)
      const dmEntry = stockCode ? salesPriceByStock[stockCode] : null;
      if (dmEntry) {
        const priceTl = Number(dmEntry.priceTl) || 0;
        const profitTl = priceTl - costTl;
        const marginPct = costTl > 0 && priceTl > 0 ? (profitTl / costTl) * 100 : null;
        list.push({
          key: `${model.modelKey}__digerMusteriler`,
          modelKey: model.modelKey,
          modelName: model.modelName,
          modelCode: model.modelCode,
          stockCode,
          productName: model.modelName,
          channel: "digerMusteriler",
          costTl,
          priceTl,
          priceNative: priceTl,
          priceNativeCurrency: "TRY",
          profitTl,
          marginPct,
          hasPrice: priceTl > 0,
          customer: dmEntry.customerCode ? `${dmEntry.customerCode}${dmEntry.customerName ? ` · ${dmEntry.customerName}` : ""}` : null,
        });
      }

      // Eşleşmeyen modeller (ne Sevkiyat Planı'nda ne Diğer Müşteriler'de) — noPrice listesi için
      if (!matchedProduct && !dmEntry) {
        list.push({
          key: `${model.modelKey}__noPrice`,
          modelKey: model.modelKey,
          modelName: model.modelName,
          modelCode: model.modelCode,
          stockCode,
          productName: model.modelName,
          channel: "noPrice",
          costTl,
          priceTl: 0,
          priceNative: 0,
          priceNativeCurrency: "TRY",
          profitTl: -costTl,
          marginPct: null,
          hasPrice: false,
          customer: null,
        });
      }
    }
    return list;
  }, [calc, productByVio, salesPriceByStock, rates]);

  // Filtre + sıralama
  // - "all": sadece hasPrice=true (gerçekten fiyatlı)
  // - "sevkiyat" / "digerMusteriler": o kanaldaki TÜM satırlar (fiyatsız Sevkiyat ürünleri audit için görünür)
  // - "noPrice": hasPrice=false her satır (kanal=noPrice + kanal var ama fiyat=0 Sevkiyat/Diğer)
  const visibleRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    let out = rows.filter(r => {
      if (channelFilter === "all") {
        if (!r.hasPrice) return false;
      } else if (channelFilter === "noPrice") {
        if (r.hasPrice) return false;
      } else {
        if (r.channel !== channelFilter) return false;
      }
      if (!q) return true;
      return (r.stockCode || "").toLocaleLowerCase("tr-TR").includes(q) ||
             (r.productName || "").toLocaleLowerCase("tr-TR").includes(q) ||
             (r.modelCode || "").toLocaleLowerCase("tr-TR").includes(q);
    });
    const sign = sortDir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      let av, bv;
      if (sortBy === "margin") {
        // null margin'leri sona at
        av = a.marginPct == null ? -Infinity : a.marginPct;
        bv = b.marginPct == null ? -Infinity : b.marginPct;
      } else if (sortBy === "profit") { av = a.profitTl; bv = b.profitTl; }
      else if (sortBy === "cost") { av = a.costTl; bv = b.costTl; }
      else if (sortBy === "price") { av = a.priceTl; bv = b.priceTl; }
      else { av = a.stockCode || ""; bv = b.stockCode || ""; return sign * String(av).localeCompare(String(bv)); }
      return sign * ((av || 0) - (bv || 0));
    });
    return out;
  }, [rows, channelFilter, search, sortBy, sortDir]);

  // Toplam fiyatsız count — filter butonu üzerinde sabit referans (filter'dan bağımsız)
  const totalNoPriceCount = useMemo(() => rows.filter(r => !r.hasPrice).length, [rows]);

  // KPI'lar — visibleRows üzerinden hesaplanır, filter + arama anında yansır
  const kpi = useMemo(() => {
    const priced = visibleRows.filter(r => r.hasPrice && r.marginPct != null);
    const lossMaking = priced.filter(r => r.marginPct < 0).length;
    const healthy = priced.filter(r => r.marginPct >= 20).length;
    const lowMargin = priced.filter(r => r.marginPct >= 0 && r.marginPct < 20).length;
    const avgMargin = priced.length > 0 ? priced.reduce((s, r) => s + r.marginPct, 0) / priced.length : 0;
    const noPriceCount = visibleRows.filter(r => !r.hasPrice).length;
    const sorted = [...priced].sort((a, b) => b.marginPct - a.marginPct);
    const topProfit = sorted[0] || null;
    const worstLoss = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    return { priced: priced.length, lossMaking, healthy, lowMargin, avgMargin, noPriceCount, topProfit, worstLoss };
  }, [visibleRows]);

  if (!allLoaded) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Veriler yükleniyor...</div>;
  }

  if (!monthData) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>💵</div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Hesap ayı yok</div>
        <div style={{ fontSize: 12 }}>Önce Aylık Genel Giderler sekmesinden bir ay yükleyin</div>
      </div>
    );
  }

  // EUR kuru yoksa Sevkiyat Planı satırları fiyatsız çıkar — uyarı
  const eurMissing = !(Number(rates?.eur) > 0);

  const headerCell = (label, key, align = "right") => {
    const active = sortBy === key;
    return (
      <th
        onClick={() => {
          if (active) setSortDir(d => d === "desc" ? "asc" : "desc");
          else { setSortBy(key); setSortDir(key === "code" ? "asc" : "desc"); }
        }}
        style={{
          textAlign: align, padding: "8px 10px", cursor: "pointer", userSelect: "none",
          color: active ? "var(--color-text-info)" : "var(--color-text-secondary)",
          fontWeight: active ? 600 : 500, fontSize: 11,
          borderBottom: "1px solid var(--color-border-tertiary)",
        }}
      >
        {label}{active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
      </th>
    );
  };

  return (
    <div>
      {/* Üst toolbar — ay seç + filtre + arama */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Maliyet ayı:</label>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          style={{ padding: "5px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--color-border-tertiary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
        >
          {monthsAvailable.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>

        <div style={{ display: "inline-flex", gap: 4 }}>
          {[
            { id: "all", label: "Tümü (fiyatlı)", color: "#374151" },
            { id: "sevkiyat", label: "Sevkiyat Planı", color: CHANNEL_COLORS.sevkiyat },
            { id: "digerMusteriler", label: "Diğer Müşteriler", color: CHANNEL_COLORS.digerMusteriler },
            { id: "noPrice", label: `Fiyatsız (${totalNoPriceCount})`, color: "#9CA3AF" },
          ].map(opt => {
            const active = channelFilter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setChannelFilter(opt.id)}
                style={{
                  padding: "5px 12px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                  border: "1px solid " + (active ? opt.color : "var(--color-border-tertiary)"),
                  background: active ? opt.color : "transparent",
                  color: active ? "white" : "var(--color-text-secondary)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Stok kodu / ürün adı ara..."
          style={{ flex: "1 1 200px", maxWidth: 280, padding: "5px 10px", fontSize: 12, borderRadius: 4, border: "1px solid var(--color-border-tertiary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
        />

        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {visibleRows.length} satır · {monthLabel(selectedMonth)} maliyeti
        </span>
      </div>

      {eurMissing && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 6, fontSize: 11, color: "#92400E" }}>
          ⚠ EUR kuru yok — Sevkiyat Planı (EUR fiyatlı) ürünler fiyatsız görünecek. Toolbar'dan manuel EUR kuru gir veya TCMB cron'u kontrol et.
        </div>
      )}

      {/* KPI şeridi */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
        <KpiCard label="Karlılık ortalaması" value={`${kpi.avgMargin.toFixed(1)}%`} color={kpi.avgMargin >= 20 ? "#22C55E" : kpi.avgMargin >= 0 ? "#F59E0B" : "#DC2626"} sub={`${kpi.priced} fiyatlı ürün`} />
        <KpiCard label="Sağlıklı (≥%20)" value={kpi.healthy} color="#22C55E" sub={`${kpi.priced > 0 ? (kpi.healthy * 100 / kpi.priced).toFixed(0) : 0}%`} />
        <KpiCard label="Düşük (%0–20)" value={kpi.lowMargin} color="#F59E0B" sub="zayıf marj" />
        <KpiCard label="Zarar (<%0)" value={kpi.lossMaking} color="#DC2626" sub="acil incele" />
        <KpiCard label="Fiyatsız" value={kpi.noPriceCount} color="#9CA3AF" sub="kanal eşleşmesi yok" />
      </div>

      {/* En karlı / en zararlı vurgu */}
      {(kpi.topProfit || kpi.worstLoss) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {kpi.topProfit && (
            <div style={{ padding: "10px 12px", background: "rgba(34, 197, 94, 0.06)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#16A34A", fontWeight: 600, marginBottom: 3 }}>🏆 EN KARLI</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{kpi.topProfit.stockCode} — {kpi.topProfit.productName}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                Marj: <strong style={{ color: "#16A34A" }}>{kpi.topProfit.marginPct.toFixed(1)}%</strong> · Birim kar: {f2(kpi.topProfit.profitTl)} {sym} · {CHANNEL_LABELS[kpi.topProfit.channel]}
              </div>
            </div>
          )}
          {kpi.worstLoss && (
            <div style={{ padding: "10px 12px", background: "rgba(220, 38, 38, 0.06)", border: "1px solid rgba(220, 38, 38, 0.3)", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#DC2626", fontWeight: 600, marginBottom: 3 }}>⚠️ EN ZARARLI</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{kpi.worstLoss.stockCode} — {kpi.worstLoss.productName}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                Marj: <strong style={{ color: "#DC2626" }}>{kpi.worstLoss.marginPct.toFixed(1)}%</strong> · Birim kar: {f2(kpi.worstLoss.profitTl)} {sym} · {CHANNEL_LABELS[kpi.worstLoss.channel]}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tablo */}
      <div style={{ overflowX: "auto", border: "1px solid var(--color-border-tertiary)", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
          <thead style={{ background: "var(--color-background-secondary)", position: "sticky", top: 0 }}>
            <tr>
              {headerCell("Stok Kodu", "code", "left")}
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-tertiary)" }}>Ürün</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-tertiary)" }}>Kanal</th>
              {headerCell(`Birim Maliyet (${sym})`, "cost")}
              {headerCell(`Birim Satış (${sym})`, "price")}
              {headerCell(`Birim Kar (${sym})`, "profit")}
              {headerCell("Marj %", "margin")}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>Bu filtreyle eşleşen ürün yok</td></tr>
            )}
            {visibleRows.map(r => {
              const c = marginColor(r.marginPct || 0, r.hasPrice);
              return (
                <tr key={r.key} style={{ background: c.bg, borderLeft: `3px solid ${c.bar}`, borderBottom: "1px solid var(--color-border-tertiary)" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>{r.stockCode || "—"}</td>
                  <td style={{ padding: "6px 10px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.productName}>{r.productName}</td>
                  <td style={{ padding: "6px 10px" }}>
                    {r.channel === "noPrice" ? (
                      <span style={{ fontSize: 10, color: "#9CA3AF" }}>—</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 3, color: "white", background: CHANNEL_COLORS[r.channel] }}>
                        {CHANNEL_LABELS[r.channel]}
                      </span>
                    )}
                    {r.customer && <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }} title={r.customer}>{r.customer.length > 30 ? r.customer.slice(0, 30) + "…" : r.customer}</div>}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f2(r.costTl)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.hasPrice ? f2(r.priceTl) : <span style={{ color: "#9CA3AF" }}>—</span>}
                    {r.hasPrice && r.priceNativeCurrency === "EUR" && (
                      <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>
                        {Number(r.priceNative).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} €
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.hasPrice ? (r.profitTl >= 0 ? "#16A34A" : "#DC2626") : "#9CA3AF" }}>
                    {r.hasPrice ? f2(r.profitTl) : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: c.bar }}>
                    {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
        ℹ Marj % = (Satış − Maliyet) / Maliyet · Renk eşikleri: ≥%20 yeşil · %0–20 sarı · &lt;0 kırmızı · Fiyatsız gri ·
        Maliyet kaynağı: {monthLabel(selectedMonth)} mamul maliyeti (rootCost, TL) · Sevkiyat Planı fiyatı: products.salesPriceEur (EUR → TL kur ile çevrilir) · Diğer Müşteriler fiyatı: aktif siparişin unitPriceTl (TL, en güncel orderDate kazanır)
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{ padding: "10px 12px", border: "1px solid var(--color-border-tertiary)", borderRadius: 6, background: "var(--color-background-primary)" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
