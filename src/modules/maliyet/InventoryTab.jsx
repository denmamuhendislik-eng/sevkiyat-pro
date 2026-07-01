import { useState, useEffect, useMemo } from "react";
import {
  subscribeMrpStock, subscribeUnitCosts,
  subscribeInventorySnapshots, saveInventorySnapshot, deleteInventorySnapshot,
  subscribeBomModels, subscribeWorkCenters, subscribeLaborCosts,
  subscribeOverheadPolicy, subscribeFasonRates,
  subscribeProducts, subscribeSalesOrders, subscribeBomMapping,
  subscribeUnitConversions,
  saveCatOverride,
} from "./firestore";
import { calculateInventoryValue, quarterKey, quarterEndDate, monthKey, monthLabel } from "./inventoryCalc";
import { calculateAllProductCosts } from "./productCostCalc";
import { DEFAULT_WEIGHTS } from "./distributionCalc";
import { fmtMoneyNum, getRatesForDate, CURRENCY_SYMBOLS } from "./currency";

// Stok kodu prefix'inden kategori adı türet (VIO grup boş olduğunda fallback)
function prefixCategoryName(code) {
  const c = String(code || "").trim();
  if (!c) return "(Diğer)";
  // 150- = Döküm/RAW (gri döküm vs.)
  if (/^150[-]/.test(c)) return "150- Döküm";
  // 151- = İşlenmiş parçalar (yarı mamul/mamul)
  if (/^151[-]/.test(c)) return "151- İşlenmiş Parça";
  // 152- = Sac/Lama
  if (/^152[-]/.test(c)) return "152- Sac/Lama";
  // 157- = Standart alım
  if (/^157[-]/.test(c)) return "157- Standart Alım";
  // 158- = (varsa)
  if (/^158[-]/.test(c)) return "158- (Tanımsız)";
  // MM- = Standart malzeme (cıvata, somun vs.)
  if (/^MM[-]/i.test(c)) return "MM- Standart Malzeme";
  // Numerik prefix
  const m = c.match(/^(\d{3,4})/);
  if (m) return m[1] + "- (Diğer)";
  // Alfa prefix
  const m2 = c.match(/^([A-Z]+)/i);
  if (m2) return m2[1] + "- (Diğer)";
  return "(Diğer)";
}

// MRP _catOverrides için seçenekler — sadece BUY/RAW parçalar override edilebilir
const CAT_KEY_OPTIONS = [
  { value: "", label: "🤖 Otomatik (algoritma)" },
  { value: "raw_dokum", label: "🔶 Döküm (RAW)" },
  { value: "raw_dolu", label: "🔩 Dolu Malzeme (RAW)" },
  { value: "raw_diger", label: "📦 Diğer Hammadde (RAW)" },
  { value: "buy_rulman", label: "⚙ Rulman / Keçe (BUY)" },
  { value: "buy_baglanti", label: "🔧 Bağlantı Elemanı (BUY)" },
  { value: "buy_lazer", label: "✂ Lazer Parça (BUY)" },
  { value: "buy_standart", label: "🔹 Standart / Yarı Mamül (BUY)" },
  { value: "buy_diger", label: "📎 Diğer Satın Alma (BUY)" },
];

const GROUP_OPTIONS = [
  // BOM-bazlı detaylı kategori (MRP modülündeki isim regex'leri ile alt kırılım — App.jsx:15080)
  { value: "bomCategory", label: "BOM Kategorisi (önerilen)", getKey: (it) => it.category || "❓ BOM Dışı" },
  // VIO grup dolu ise onu, değilse kod prefix'ten türetilen kategori
  { value: "vioGroup", label: "VIO Grup (otomatik fallback)", getKey: (it) => it.group || prefixCategoryName(it.code) },
  { value: "source", label: "Kaynak (Mamul/Alış/Eksik)", getKey: (it) => {
    if (it.source === "mamul-calc") return "🏭 Mamul / Yarı Mamul";
    if (it.source === "buy-last") return "🛒 Satın Alma (Hammadde/Standart)";
    return "⚠ Birim TL Eksik";
  }},
  { value: "codePrefix", label: "Stok Kodu Prefix", getKey: (it) => prefixCategoryName(it.code) },
  { value: "none", label: "Gruplama Yok", getKey: () => "_all" },
];

const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const fmtPct = (n) => (n >= 0 ? "+" : "") + Number(n || 0).toFixed(1) + "%";

export default function InventoryTab({ canEdit, isAdmin, currency = "TRY", rates = null, currencyRates = {} }) {
  const f2 = (tl) => fmtMoneyNum(tl, currency, rates, 2);
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  // Snapshot TL → tarihsel kur ile çevir. snap.ratesAt varsa onu, yoksa snap.takenAt
  // tarihine en yakın currencyRates'i, yoksa anlık kuru kullan.
  const f2Snap = (tl, snap) => {
    if (currency === "TRY") return fmtMoneyNum(tl, "TRY", null, 2);
    const dateKey = (snap?.takenAt || "").slice(0, 10);
    const snapRates = snap?.ratesAt || getRatesForDate(currencyRates, dateKey) || rates;
    return fmtMoneyNum(tl, currency, snapRates, 2);
  };
  const [mrpStock, setMrpStock] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [snapshots, setSnapshots] = useState({});
  const [bomModels, setBomModels] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [fasonRates, setFasonRates] = useState({});
  const [products, setProducts] = useState([]);
  const [salesOrders, setSalesOrders] = useState({});
  const [bomMapping, setBomMapping] = useState({});
  const [unitConversions, setUnitConversions] = useState({ conversions: {} });
  const [loaded, setLoaded] = useState({ stock: false, unit: false, snap: false, bom: false, wc: false, labor: false, pol: false, fason: false, prod: false, so: false, map: false, uconv: false });
  const [search, setSearch] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedSnap, setSelectedSnap] = useState(null);
  const [groupBy, setGroupBy] = useState("bomCategory");
  const [expandedGroups, setExpandedGroups] = useState({});

  useEffect(() => { const u = subscribeMrpStock(d => { setMrpStock(d || {}); setLoaded(p => ({ ...p, stock: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeUnitCosts(d => { setUnitCosts(d || {}); setLoaded(p => ({ ...p, unit: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeInventorySnapshots(d => { setSnapshots(d?.snapshots || {}); setLoaded(p => ({ ...p, snap: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(p => ({ ...p, bom: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(p => ({ ...p, wc: true })); }); return u; }, []);
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
  useEffect(() => { const u = subscribeBomMapping(d => { setBomMapping(d || {}); setLoaded(p => ({ ...p, map: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeUnitConversions(d => { setUnitConversions(d || { conversions: {} }); setLoaded(p => ({ ...p, uconv: true })); }); return u; }, []);

  const allLoaded = Object.values(loaded).every(Boolean);

  // ProductCosts hesap (Mamul/yarı mamul birim TL için) — son tamamlanmış ay
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

  // Anlık envanter hesap (her render'da fresh)
  const catOverrides = bomMapping?._catOverrides || {};
  const live = useMemo(() => {
    if (!allLoaded) return null;
    return calculateInventoryValue({ mrpStock, unitCosts, productCosts, products, salesOrders, catOverrides });
  }, [allLoaded, mrpStock, unitCosts, productCosts, products, salesOrders, catOverrides]);

  // Snapshot listesi (tarih sırasına göre, en yeniden eskiye)
  const snapList = useMemo(() => Object.entries(snapshots)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, data]) => ({ key, ...data })),
    [snapshots]);

  // Son snapshot ile karşılaştırma
  const lastSnap = snapList[0];
  const valueChange = lastSnap && live ? (live.summary.totalValue - lastSnap.totalValue) : 0;
  const valueChangePct = lastSnap && lastSnap.totalValue > 0 ? (valueChange / lastSnap.totalValue * 100) : 0;

  const filteredItems = useMemo(() => {
    if (!live) return [];
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return live.items.filter(it => {
      if (showMissing && it.unitPriceTl > 0) return false;
      if (!q) return true;
      return it.code.toLocaleLowerCase("tr-TR").includes(q) || (it.name || "").toLocaleLowerCase("tr-TR").includes(q);
    });
  }, [live, search, showMissing]);

  // Gruplama
  // BOM Kategorisi seçildiğinde 2 katmanlı hiyerarşi: ana grup (Mamul/Yarı Mamul/Hammadde/Satın Alma/BOM Dışı)
  //   → alt gruplar (Döküm, Rulman vs.) → item'lar. Ana grup sırası sabit, içeride alt gruplar değere göre.
  // Diğer gruplamalar tek katman (eski davranış).
  const MAIN_GROUP_ORDER = ["🏭 Mamul", "🔧 Yarı Mamul", "⚙️ Hammadde", "🛒 Satın Alma", "❓ BOM Dışı"];
  const groupedItems = useMemo(() => {
    if (groupBy === "none") return null;
    if (groupBy === "bomCategory") {
      // İki katmanlı yapı
      const mains = {};
      for (const it of filteredItems) {
        const mk = it.mainGroup || "❓ BOM Dışı";
        const sk = it.category || "❓ BOM Dışı";
        if (!mains[mk]) mains[mk] = { key: mk, hierarchical: true, subGroups: {}, totalValue: 0, totalQty: 0, itemCount: 0 };
        if (!mains[mk].subGroups[sk]) mains[mk].subGroups[sk] = { key: sk, items: [], totalValue: 0, totalQty: 0 };
        mains[mk].subGroups[sk].items.push(it);
        mains[mk].subGroups[sk].totalValue += it.value;
        mains[mk].subGroups[sk].totalQty += it.qtyTotal;
        mains[mk].totalValue += it.value;
        mains[mk].totalQty += it.qtyTotal;
        mains[mk].itemCount += 1;
      }
      // Ana grupları sabit sıraya göre, alt grupları değere göre sırala
      const arr = Object.values(mains).map(m => ({
        ...m,
        subGroups: Object.values(m.subGroups).sort((a, b) => b.totalValue - a.totalValue),
      }));
      arr.sort((a, b) => {
        const ia = MAIN_GROUP_ORDER.indexOf(a.key); const ib = MAIN_GROUP_ORDER.indexOf(b.key);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      return arr;
    }
    const opt = GROUP_OPTIONS.find(o => o.value === groupBy);
    if (!opt) return null;
    const groups = {};
    for (const it of filteredItems) {
      const k = opt.getKey(it);
      if (!groups[k]) groups[k] = { key: k, hierarchical: false, items: [], totalValue: 0, totalQty: 0 };
      groups[k].items.push(it);
      groups[k].totalValue += it.value;
      groups[k].totalQty += it.qtyTotal;
    }
    return Object.values(groups).sort((a, b) => b.totalValue - a.totalValue);
  }, [filteredItems, groupBy]);

  const toggleGroup = (key) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const handleTakeSnapshot = async () => {
    if (!canEdit || !live) return;
    const mKey = monthKey(new Date());
    if (snapshots[mKey]) {
      if (!confirm(`${monthLabel(mKey)} için zaten snapshot var. Üzerine yazılsın mı?`)) return;
    }
    setSaving(true);
    try {
      // O günkü TCMB kuru kayda alınır — geçmiş snapshot USD/EUR değerleri stabil kalır
      const todayIso = new Date().toISOString().slice(0, 10);
      const snapDayRates = getRatesForDate(currencyRates, todayIso);
      const tl = live.summary.totalValue;
      const snap = {
        takenAt: new Date().toISOString(),
        monthKey: mKey,
        source: "manual-monthly",
        totalValue: tl,
        stockCount: live.summary.stockCount,
        totalQty: live.summary.totalQty,
        missingPriceCount: live.summary.missingPriceCount,
        totalAmbar: live.summary.totalAmbar,
        totalUretim: live.summary.totalUretim,
        totalFason: live.summary.totalFason,
        // Tarihsel kur — döviz toggle bunu kullanır, sonradan kur değişse bile sabit
        ratesAt: snapDayRates ? { usd: snapDayRates.usd, eur: snapDayRates.eur, source: snapDayRates.source, date: snapDayRates.date } : null,
        totalValueUsd: snapDayRates?.usd > 0 ? tl / snapDayRates.usd : null,
        totalValueEur: snapDayRates?.eur > 0 ? tl / snapDayRates.eur : null,
        items: live.items.map(it => ({  // tam liste (~250 stok × ~200 byte = 50KB, doc limit altında)
          code: it.code, name: it.name, qtyTotal: it.qtyTotal,
          unitPriceTl: it.unitPriceTl, value: it.value, matchedBy: it.matchedBy,
        })),
      };
      await saveInventorySnapshot(mKey, snap, { canEdit });
      alert(`✓ Snapshot kaydedildi: ${monthLabel(mKey)}`);
    } catch (err) {
      alert("Hata: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // BUY/RAW parça için kategori override (admin) — MRP _catOverrides'a yazıyor, tek kaynak.
  // MRP > BOM Patlatma ile aynı doc, anında live sync.
  const handleCatOverride = async (code, newCatKey) => {
    if (!isAdmin) return;
    try {
      await saveCatOverride(code, newCatKey || null, { canEdit, isAdmin });
    } catch (err) {
      alert("Kategori override hatası: " + err.message);
    }
  };

  const handleDelete = async (qKey) => {
    if (!isAdmin) return;
    if (!confirm(`${qKey} snapshot'ı silinsin mi?`)) return;
    try {
      await deleteInventorySnapshot(qKey, { canEdit, isAdmin });
      if (selectedSnap === qKey) setSelectedSnap(null);
    } catch (err) {
      alert("Silme hatası: " + err.message);
    }
  };

  if (!allLoaded) return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;

  if (!mrpStock?.parts || Object.keys(mrpStock.parts).length === 0) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📚</div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Stok raporu yok</div>
        <div style={{ fontSize: 12 }}>VIO Son Stok Raporu cron'unun çekmesini bekle, veya MRP &gt; Veri Yönetimi'nden yükle</div>
      </div>
    );
  }

  return (
    <div>
      {/* Üst bant: anlık değer + snapshot al */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "var(--color-background-secondary)", borderRadius: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Anlık envanter değeri</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-success)" }}>{f2(live.summary.totalValue)} {sym}</div>
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{live.summary.stockCount} stok kalemi · {fmt0(live.summary.totalQty)} adet toplam</div>
        </div>
        {lastSnap && (
          <div style={{ borderLeft: "1px solid var(--color-border-secondary)", paddingLeft: 14 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Son snapshot ({lastSnap.key})</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{f2Snap(lastSnap.totalValue, lastSnap)} {sym}</div>
            <div style={{ fontSize: 10, color: valueChange >= 0 ? "var(--color-text-success)" : "#DC2626", fontWeight: 500 }}>
              {valueChange >= 0 ? "↑" : "↓"} {f2(Math.abs(valueChange))} {sym} ({fmtPct(valueChangePct)})
            </div>
          </div>
        )}
        {live.summary.missingPriceCount > 0 && (
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", fontWeight: 500 }}>
            ⚠ {live.summary.missingPriceCount} stokta birim TL yok
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ textAlign: "right", marginRight: 8 }}>
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Bu ay: <b>{monthLabel(monthKey())}</b></div>
            <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>Otomatik cron: her ayın 1'i 11:00 (önceki ay)</div>
          </div>
          {canEdit && (
            <button
              onClick={handleTakeSnapshot}
              disabled={saving}
              style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontWeight: 500, fontSize: 12, cursor: saving ? "default" : "pointer" }}
            >
              {saving ? "Alınıyor..." : "📸 Snapshot Al"}
            </button>
          )}
        </div>
      </div>

      {/* Snapshot listesi */}
      {snapList.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Aylık Snapshot Geçmişi</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {snapList.map((s, i) => {
              const prev = snapList[i + 1];
              const diff = prev ? (s.totalValue - prev.totalValue) : 0;
              const diffPct = prev && prev.totalValue > 0 ? (diff / prev.totalValue * 100) : 0;
              const isSelected = selectedSnap === s.key;
              return (
                <div
                  key={s.key}
                  onClick={() => setSelectedSnap(isSelected ? null : s.key)}
                  style={{
                    padding: "8px 14px", borderRadius: 6, cursor: "pointer",
                    border: "1px solid " + (isSelected ? "var(--color-text-info)" : "var(--color-border-tertiary)"),
                    background: isSelected ? "var(--color-background-info-subtle, #EFF6FF)" : "var(--color-background-primary)",
                    minWidth: 180,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{s.monthKey ? monthLabel(s.monthKey) : s.key}</span>
                    {isAdmin && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(s.key); }} title="Sil" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-tertiary)" }}>✕</button>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-success)" }}>{f2Snap(s.totalValue, s)} {sym}</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>
                    {s.stockCount} kalem · {s.source?.startsWith("auto-") ? "🤖 Otomatik" : "📸 Manuel"}
                  </div>
                  {prev && (
                    <div style={{ fontSize: 10, color: diff >= 0 ? "var(--color-text-success)" : "#DC2626", fontWeight: 500 }}>
                      {diff >= 0 ? "↑" : "↓"} {f2Snap(Math.abs(diff), s)} ({fmtPct(diffPct)})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Anlık stok değer tablosu */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Stok kodu veya isim ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: "1 1 200px", maxWidth: 300, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 11 }}
        />
        <label style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Gruplama:</label>
        <select
          value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 11 }}
        >
          {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={showMissing} onChange={e => setShowMissing(e.target.checked)} />
          Sadece birim TL'si olmayanlar
        </label>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{filteredItems.length} / {live.items.length} satır</span>
        {productCostMonth && (
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>
            Mamul hesabı: {productCostMonth}
          </span>
        )}
      </div>

      <InventoryTable
        filteredItems={filteredItems}
        groupedItems={groupedItems}
        expandedGroups={expandedGroups}
        toggleGroup={toggleGroup}
        search={search}
        showMissing={showMissing}
        currency={currency}
        rates={rates}
        isAdmin={isAdmin}
        onCatOverride={handleCatOverride}
      />

      <div style={{ marginTop: 10, padding: "8px 14px", background: "var(--color-background-secondary)", borderRadius: 6, fontSize: 10, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        <b>Hesap:</b> Eldeki toplam stok (ambar + üretim + fason + dış) × birim TL (unitCosts son alış). 3 katmanlı eşleşme: kod → isim → ilk token.
        {live.summary.mrpStockImportedAt && (
          <> · Stok raporu: {new Date(live.summary.mrpStockImportedAt).toLocaleString("tr-TR")}</>
        )}
        <br/>
        Aylık snapshot'lar: her ayın 1'i sabah 11:00'da önceki ay için otomatik alınır (Cloud Function cron). Manuel anytime Snapshot Al ile mevcut ay için de alınabilir.
      </div>
    </div>
  );
}

function InventoryTable({ filteredItems, groupedItems, expandedGroups, toggleGroup, search, showMissing, currency = "TRY", rates = null, isAdmin = false, onCatOverride = null }) {
  const f2 = (tl) => fmtMoneyNum(tl, currency, rates, 2);
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const COL_TEMPLATE = "110px 1fr 70px 70px 70px 90px 90px 110px 80px 130px";
  const HEADER = (
    <div style={{ display: "grid", gridTemplateColumns: COL_TEMPLATE, padding: "6px 12px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 6 }}>
      <span>Stok Kodu</span>
      <span>Stok Adı</span>
      <span style={{ textAlign: "right" }}>Ambar</span>
      <span style={{ textAlign: "right" }}>Üretim</span>
      <span style={{ textAlign: "right" }}>Fason</span>
      <span style={{ textAlign: "right" }}>Toplam</span>
      <span style={{ textAlign: "right" }}>Birim {sym}</span>
      <span style={{ textAlign: "right" }}>Değer {sym}</span>
      <span style={{ textAlign: "center" }}>Kaynak</span>
      <span title="BUY/RAW parçalar için kategori override (MRP _catOverrides ile ortak)">Kategori</span>
    </div>
  );

  const renderItem = (it) => (
    <div key={it.code} style={{ display: "grid", gridTemplateColumns: COL_TEMPLATE, padding: "4px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 10, gap: 6, alignItems: "center", background: it.unitPriceTl <= 0 ? "#FFFBEB" : "transparent" }}>
      <span style={{ fontFamily: "var(--font-mono)" }}>{it.code}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.name}>{it.name}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{fmt0(it.qtyAmbar)}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{fmt0(it.qtyUretim)}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{fmt0(it.qtyFason)}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt0(it.qtyTotal)}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{f2(it.unitPriceTl)}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: it.value > 0 ? "var(--color-text-success)" : "var(--color-text-tertiary)" }}>{f2(it.value)}</span>
      <span style={{ textAlign: "center", fontSize: 8, color: it.source === "mamul-calc" ? "var(--color-text-info)" : it.source === "buy-last" ? "var(--color-text-success)" : "var(--color-text-tertiary)" }}>
        {it.source === "mamul-calc" ? "🏭 mamul" : it.source === "buy-last" ? "🛒 alış" : it.matchedBy}
      </span>
      {/* Kategori dropdown — sadece BUY/RAW parçalar override edilebilir */}
      {it.catKey != null && isAdmin && onCatOverride ? (
        <select
          value={it.catOverride ? it.catKey : ""}
          onChange={(e) => onCatOverride(it.code, e.target.value)}
          title={it.catOverride ? `🖊 Manuel override: ${it.catKey}` : `🤖 Otomatik: ${it.catKey}`}
          style={{
            fontSize: 9, padding: "2px 4px", borderRadius: 3,
            border: "1px solid " + (it.catOverride ? "#C2410C" : "var(--color-border-tertiary)"),
            background: it.catOverride ? "#FEF3C7" : "var(--color-background-primary)",
            color: it.catOverride ? "#92400E" : "var(--color-text-secondary)",
            fontWeight: it.catOverride ? 600 : 400,
            width: "100%",
          }}
        >
          {CAT_KEY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", textAlign: "center" }} title="Sadece BUY/RAW parçalar override edilebilir">—</span>
      )}
    </div>
  );

  if (!groupedItems) {
    // Flat görünüm
    return (
      <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
        {HEADER}
        <div style={{ maxHeight: 600, overflowY: "auto" }}>
          {filteredItems.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
              {search || showMissing ? "Filtre eşleşmedi" : "Stok kaydı yok"}
            </div>
          ) : filteredItems.slice(0, 500).map(renderItem)}
          {filteredItems.length > 500 && (
            <div style={{ padding: 10, textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)" }}>
              + {filteredItems.length - 500} satır daha (arama ile daralt)
            </div>
          )}
        </div>
      </div>
    );
  }

  // Gruplu görünüm — iki katmanlı (BOM kategorisi) veya tek katmanlı
  return (
    <div style={{ maxHeight: 700, overflowY: "auto" }}>
      {groupedItems.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12, border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
          {search || showMissing ? "Filtre eşleşmedi" : "Stok kaydı yok"}
        </div>
      ) : groupedItems.map(g => {
        const mainKey = g.key;
        const isMainExpanded = expandedGroups[mainKey] !== false;  // default açık
        if (g.hierarchical) {
          return (
            <div key={mainKey} style={{ marginBottom: 10, border: "2px solid var(--color-border-secondary)", borderRadius: 8, overflow: "hidden" }}>
              <div
                onClick={() => toggleGroup(mainKey)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--color-background-secondary)", cursor: "pointer", userSelect: "none", borderBottom: isMainExpanded ? "1px solid var(--color-border-tertiary)" : "none" }}
              >
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{isMainExpanded ? "▼" : "▶"}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{mainKey}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>({g.itemCount} kalem · {g.subGroups.length} alt grup · {fmt0(g.totalQty)} adet)</span>
                <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "var(--color-text-success)" }}>{f2(g.totalValue)} {sym}</span>
              </div>
              {isMainExpanded && g.subGroups.map(sg => {
                const subKey = mainKey + "/" + sg.key;
                const isSubExpanded = expandedGroups[subKey] !== false;
                return (
                  <div key={subKey} style={{ borderTop: "1px solid var(--color-border-tertiary)" }}>
                    <div
                      onClick={() => toggleGroup(subKey)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 28px", background: "var(--color-background-info-subtle, #EFF6FF)", cursor: "pointer", userSelect: "none" }}
                    >
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{isSubExpanded ? "▼" : "▶"}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-info)" }}>{sg.key}</span>
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>({sg.items.length} kalem · {fmt0(sg.totalQty)} adet)</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--color-text-success)" }}>{f2(sg.totalValue)} {sym}</span>
                    </div>
                    {isSubExpanded && (
                      <>
                        {HEADER}
                        {sg.items.slice(0, 200).map(renderItem)}
                        {sg.items.length > 200 && (
                          <div style={{ padding: 8, textAlign: "center", fontSize: 10, color: "var(--color-text-tertiary)" }}>
                            + {sg.items.length - 200} satır daha
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        }
        return (
          <div key={mainKey} style={{ marginBottom: 8, border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
            <div
              onClick={() => toggleGroup(mainKey)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--color-background-info-subtle, #EFF6FF)", cursor: "pointer", userSelect: "none" }}
            >
              <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{isMainExpanded ? "▼" : "▶"}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-info)" }}>{mainKey}</span>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>({g.items.length} kalem · {fmt0(g.totalQty)} adet)</span>
              <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--color-text-success)" }}>{f2(g.totalValue)} {sym}</span>
            </div>
            {isMainExpanded && (
              <>
                {HEADER}
                {g.items.slice(0, 200).map(renderItem)}
                {g.items.length > 200 && (
                  <div style={{ padding: 8, textAlign: "center", fontSize: 10, color: "var(--color-text-tertiary)" }}>
                    + {g.items.length - 200} satır daha
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
