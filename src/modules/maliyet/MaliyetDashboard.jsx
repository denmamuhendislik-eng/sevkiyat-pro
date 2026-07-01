import { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import {
  subscribeInventorySnapshots, subscribeMrpStock, subscribeUnitCosts,
  subscribeLaborCosts, subscribeBomModels, subscribeWorkCenters,
  subscribeOverheadPolicy, subscribeFasonRates, subscribeProducts,
  subscribeSalesOrders, subscribeBomMapping, subscribeUnitConversions,
} from "./firestore";
import { calculateInventoryValue, monthLabel } from "./inventoryCalc";
import { calculateAllProductCosts } from "./productCostCalc";
import { DEFAULT_WEIGHTS } from "./distributionCalc";
import { fmtMoneyNum, getRatesForDate, CURRENCY_SYMBOLS } from "./currency";

const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const fmtPct = (n) => (n >= 0 ? "+" : "") + Number(n || 0).toFixed(1) + "%";

export default function MaliyetDashboard({ currency = "TRY", rates = null, currencyRates = {} }) {
  const [mrpStock, setMrpStock] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [snapshots, setSnapshots] = useState({});
  const [laborData, setLaborData] = useState({});
  // InventoryTab ile aynı tam hesap için ek subscribe'lar (mamul/yarı mamul fallback)
  const [bomModels, setBomModels] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [policy, setPolicy] = useState(null);
  const [fasonRates, setFasonRates] = useState({});
  const [products, setProducts] = useState([]);
  const [salesOrders, setSalesOrders] = useState({});
  const [bomMapping, setBomMapping] = useState({});
  const [unitConversions, setUnitConversions] = useState({ conversions: {} });
  const [loaded, setLoaded] = useState({
    stock: false, unit: false, snap: false, labor: false,
    bom: false, wc: false, pol: false, fason: false, prod: false, so: false, map: false, uconv: false,
  });

  useEffect(() => { const u = subscribeMrpStock(d => { setMrpStock(d || {}); setLoaded(p => ({ ...p, stock: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeUnitCosts(d => { setUnitCosts(d || {}); setLoaded(p => ({ ...p, unit: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeInventorySnapshots(d => { setSnapshots(d?.snapshots || {}); setLoaded(p => ({ ...p, snap: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeLaborCosts(d => { setLaborData(d || {}); setLoaded(p => ({ ...p, labor: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(p => ({ ...p, bom: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(p => ({ ...p, wc: true })); }); return u; }, []);
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
  useEffect(() => { const u = subscribeBomMapping(d => { setBomMapping(d || {}); setLoaded(p => ({ ...p, map: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeUnitConversions(d => { setUnitConversions(d || { conversions: {} }); setLoaded(p => ({ ...p, uconv: true })); }); return u; }, []);

  const allLoaded = Object.values(loaded).every(Boolean);

  // productCosts (mamul/yarı mamul birim TL fallback için) — InventoryTab'la aynı mantık
  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthsAvailable = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);
  const productCostMonth = useMemo(() => {
    if (monthsAvailable.length === 0) return null;
    const cur = new Date().toISOString().slice(0, 7);
    const completed = monthsAvailable.filter(m => m < cur);
    return completed[0] || monthsAvailable[0];
  }, [monthsAvailable]);
  const monthlySupplies = laborData?.monthlySupplies || {};

  const productCosts = useMemo(() => {
    if (!allLoaded || !productCostMonth) return null;
    const monthData = monthlyOverheads[productCostMonth];
    if (!monthData) return null;
    return calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, refMonth: productCostMonth, unitConversions });
  }, [allLoaded, bomModels, unitCosts, workCenters, monthlyOverheads, productCostMonth, policy, fasonRates, monthlySupplies, unitConversions]);

  // Anlık envanter — InventoryTab ile birebir aynı (productCosts + mamul fallback dahil)
  const catOverrides = bomMapping?._catOverrides || {};
  const live = useMemo(() => {
    if (!allLoaded) return null;
    return calculateInventoryValue({ mrpStock, unitCosts, productCosts, products, salesOrders, catOverrides });
  }, [allLoaded, mrpStock, unitCosts, productCosts, products, salesOrders, catOverrides]);

  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  // Snapshot tarihsel kura göre çevrim
  const f2Snap = (tl, snap) => {
    if (currency === "TRY") return fmt2(tl);
    const dateKey = (snap?.takenAt || "").slice(0, 10);
    const snapRates = snap?.ratesAt || getRatesForDate(currencyRates, dateKey) || rates;
    return fmtMoneyNum(tl, currency, snapRates, 2);
  };
  // Bir TL değerini snapshot kurunda sayıya çevir
  const toCurrency = (tl, snap) => {
    if (currency === "TRY") return Number(tl || 0);
    const dateKey = (snap?.takenAt || "").slice(0, 10);
    const snapRates = snap?.ratesAt || getRatesForDate(currencyRates, dateKey) || rates;
    if (!snapRates) return 0;
    if (currency === "USD") return snapRates.usd > 0 ? Number(tl || 0) / snapRates.usd : 0;
    if (currency === "EUR") return snapRates.eur > 0 ? Number(tl || 0) / snapRates.eur : 0;
    return Number(tl || 0);
  };

  // Snapshot listesi — son 24 ay, monthKey > Qkey öncelik
  const snapList = useMemo(() => {
    return Object.entries(snapshots)
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => (a.monthKey || a.key).localeCompare(b.monthKey || b.key));  // asc
  }, [snapshots]);

  // Grafik verisi — son 12 ay
  const chartData = useMemo(() => {
    return snapList.slice(-12).map(s => {
      const label = s.monthKey ? monthLabel(s.monthKey) : s.key;
      return {
        label,
        value: toCurrency(s.totalValue, s),
        tlValue: s.totalValue,
        snap: s,
      };
    });
  }, [snapList, currency, rates, currencyRates]);

  // KPI hesaplar
  const lastSnap = snapList[snapList.length - 1] || null;
  const prevSnap = snapList[snapList.length - 2] || null;
  const yearAgoSnap = snapList[snapList.length - 13] || null;  // 12 ay önce

  const liveValue = live?.summary?.totalValue || 0;
  const liveConverted = toCurrency(liveValue, { takenAt: new Date().toISOString() });

  const lastValue = lastSnap ? toCurrency(lastSnap.totalValue, lastSnap) : 0;
  const monthChange = (prevSnap && lastSnap) ? (lastValue - toCurrency(prevSnap.totalValue, prevSnap)) : 0;
  const monthChangePct = prevSnap ? (monthChange / toCurrency(prevSnap.totalValue, prevSnap) * 100) : 0;

  const yoyChange = (yearAgoSnap && lastSnap) ? (lastValue - toCurrency(yearAgoSnap.totalValue, yearAgoSnap)) : null;
  const yoyChangePct = yearAgoSnap && yearAgoSnap.totalValue > 0
    ? (yoyChange / toCurrency(yearAgoSnap.totalValue, yearAgoSnap) * 100)
    : null;

  const avg12 = snapList.length > 0
    ? snapList.slice(-12).reduce((s, sn) => s + toCurrency(sn.totalValue, sn), 0) / Math.min(12, snapList.length)
    : 0;

  if (!allLoaded) return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;

  return (
    <div>
      {/* KPI kartları */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>
        <KPI label="Anlık envanter" value={`${fmt2(liveConverted)} ${sym}`} sub={`${live?.summary?.stockCount || 0} kalem · ${fmt0(live?.summary?.totalQty || 0)} adet`} color="#1D9E75" />
        <KPI
          label={lastSnap ? `Son snapshot (${lastSnap.monthKey ? monthLabel(lastSnap.monthKey) : lastSnap.key})` : "Son snapshot"}
          value={lastSnap ? `${f2Snap(lastSnap.totalValue, lastSnap)} ${sym}` : "—"}
          sub={prevSnap ? `${monthChange >= 0 ? "↑" : "↓"} ${fmt2(Math.abs(monthChange))} (${fmtPct(monthChangePct)}) ay/ay` : "Önceki snapshot yok"}
          color={monthChange >= 0 ? "#1D9E75" : "#DC2626"}
        />
        <KPI label="12 ay ortalaması" value={`${fmt2(avg12)} ${sym}`} sub={`${Math.min(12, snapList.length)} snapshot baz alındı`} color="#3B82F6" />
        <KPI
          label="Yıllık trend (YoY)"
          value={yoyChangePct != null ? fmtPct(yoyChangePct) : "—"}
          sub={yearAgoSnap ? `12 ay öncesine göre (${monthLabel(yearAgoSnap.monthKey || yearAgoSnap.key)})` : "12 ay veri yetersiz"}
          color={yoyChangePct == null ? "#888" : yoyChangePct >= 0 ? "#1D9E75" : "#DC2626"}
        />
      </div>

      {/* Trend grafiği */}
      <div style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>📈 Envanter Değer Trendi</h3>
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            Son 12 ay snapshot · Para birimi: <b>{currency}</b> · Snapshot tarihindeki kurla
          </span>
        </div>
        {chartData.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
            Henüz snapshot yok. Her ayın 1'inde otomatik alınır. Envanter sekmesinden manuel de alabilirsin.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
              <Tooltip
                formatter={(value, name, item) => [`${fmt2(value)} ${sym}`, "Envanter"]}
                labelFormatter={(label) => label}
                contentStyle={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-secondary)", borderRadius: 6, fontSize: 11 }}
              />
              <Bar dataKey="value" fill="#1D9E75" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Snapshot listesi (alt detay) */}
      {snapList.length > 0 && (
        <div style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", fontSize: 12, fontWeight: 600 }}>
            Snapshot Listesi ({snapList.length})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 100px 110px 130px 130px 1fr", padding: "6px 14px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <span>Ay</span>
            <span>Kaynak</span>
            <span style={{ textAlign: "right" }}>Stok</span>
            <span style={{ textAlign: "right" }}>Toplam ({sym})</span>
            <span style={{ textAlign: "right" }}>Kur (snap)</span>
            <span style={{ fontSize: 9 }}>Alındı</span>
          </div>
          {snapList.slice().reverse().map(s => (
            <div key={s.key} style={{ display: "grid", gridTemplateColumns: "120px 100px 110px 130px 130px 1fr", padding: "5px 14px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 10, alignItems: "center" }}>
              <span style={{ fontWeight: 500 }}>{s.monthKey ? monthLabel(s.monthKey) : s.key}</span>
              <span style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{s.source?.startsWith("auto-") ? "🤖 Otomatik" : "📸 Manuel"}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{s.stockCount || 0}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--color-text-success)" }}>{f2Snap(s.totalValue, s)}</span>
              <span style={{ textAlign: "right", fontSize: 9, color: "var(--color-text-tertiary)" }}>
                {s.ratesAt ? `$ ${fmt2(s.ratesAt.usd)} · € ${fmt2(s.ratesAt.eur)}` : "—"}
              </span>
              <span style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{s.takenAt ? new Date(s.takenAt).toLocaleString("tr-TR") : "—"}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, padding: "10px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 10, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        <b>Dashboard nasıl beslenir?</b> Her ayın 1'i sabah 11:00'da otomatik snapshot Cloud Function cron tarafından alınır
        (VIO Son Stok Raporu cron'undan sonra). Snapshot'a o günkü TCMB kuru kayıt altına alınır — sonradan kur değişse bile
        geçmiş USD/EUR değerleri sabit kalır. Toggle TL/USD/EUR ile grafik anında güncellenir.
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color }) {
  return (
    <div style={{ padding: "10px 14px", background: "var(--color-background-primary)", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, borderLeft: `4px solid ${color || "#888"}` }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "var(--color-text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
