import { useState, useEffect, useMemo } from "react";
import {
  subscribeBomModels, subscribeWorkCenters, subscribeUnitCosts,
  subscribeLaborCosts, subscribeOverheadPolicy,
} from "./firestore";
import { calculateAllProductCosts } from "./productCostCalc";
import { DEFAULT_WEIGHTS } from "./distributionCalc";

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m) - 1]} ${y}`;
};
const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

const SUPPLY_COLORS = {
  BUY: "#2563EB", RAW: "#92400E", MAKE: "#1D9E75",
  "MAKE+FASON": "#D97706", FASON: "#C2410C", PRODUCT: "#1D9E75",
};

export default function ProductCostsTab({ canEdit, isAdmin }) {
  const [bomModels, setBomModels] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [loaded, setLoaded] = useState({ bom: false, wc: false, unit: false, labor: false, pol: false });
  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [selectedModel, setSelectedModel] = useState(null);
  const [searchModel, setSearchModel] = useState("");

  useEffect(() => {
    const u = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(p => ({ ...p, bom: true })); });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(p => ({ ...p, wc: true })); });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeUnitCosts(d => { setUnitCosts(d || {}); setLoaded(p => ({ ...p, unit: true })); });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeLaborCosts(d => { setLaborData(d || {}); setLoaded(p => ({ ...p, labor: true })); });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeOverheadPolicy(d => {
      setPolicy(!d || Object.keys(d).length === 0 ? { weights: { ...DEFAULT_WEIGHTS }, wcSalaryMapping: {} } : d);
      setLoaded(p => ({ ...p, pol: true }));
    });
    return u;
  }, []);

  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthsAvailable = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);

  // Default: en son tamamlanmış ay
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
  const calc = useMemo(() => {
    if (!allLoaded) return null;
    return calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy });
  }, [allLoaded, bomModels, unitCosts, workCenters, monthData, policy]);

  const modelsList = useMemo(() => {
    if (!calc?.byModel) return [];
    const q = searchModel.trim().toLocaleLowerCase("tr-TR");
    return Object.values(calc.byModel)
      .filter(m => {
        if (!q) return true;
        return (m.modelCode || "").toLocaleLowerCase("tr-TR").includes(q) ||
               (m.modelName || "").toLocaleLowerCase("tr-TR").includes(q) ||
               (m.rootStockCode || "").toLocaleLowerCase("tr-TR").includes(q) ||
               (m.rootStockName || "").toLocaleLowerCase("tr-TR").includes(q);
      })
      .sort((a, b) => (b.rootCost || 0) - (a.rootCost || 0));
  }, [calc, searchModel]);

  const totals = useMemo(() => {
    if (!calc?.byModel) return { models: 0, costed: 0, totalRootCost: 0, avgCost: 0, withoutCost: 0 };
    const models = Object.values(calc.byModel);
    const costed = models.filter(m => m.rootCost > 0).length;
    const totalRootCost = models.reduce((s, m) => s + m.rootCost, 0);
    return {
      models: models.length,
      costed,
      totalRootCost,
      avgCost: costed > 0 ? totalRootCost / costed : 0,
      withoutCost: models.length - costed,
    };
  }, [calc]);

  if (!allLoaded) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Veriler yükleniyor...</div>;
  }

  if (!monthData) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Hesap ayı yok</div>
        <div style={{ fontSize: 12 }}>Önce Aylık Genel Giderler sekmesinden bir ay yükleyin</div>
      </div>
    );
  }

  return (
    <div>
      {/* Üst bant: ay seçici + özet */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8 }}>
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Hesap ayı:</label>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
        >
          {monthsAvailable.map(m => <option key={m} value={m}>{monthLabel(m)} ({m})</option>)}
        </select>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          O ayın tezgah dakika ücretleri kullanılır
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary)" }}>
          <b>{totals.models}</b> BOM · <b>{totals.costed}</b> maliyetli · <b>{totals.withoutCost}</b> eksik · Ortalama: <b>{fmt2(totals.avgCost)} ₺</b>
        </span>
      </div>

      {/* Uyarılar */}
      {calc?.ratesCalcSummary?.totals?.machineCount === 0 && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 6, fontSize: 11, color: "#92400E" }}>
          ⚠ Hiç tezgah meta verisi yok — işçilik maliyeti 0 hesaplanacak. Tezgah Dakika Ücretleri sekmesinden tezgahları doldur.
        </div>
      )}
      {Object.keys(calc?.stockUnitCost || {}).length === 0 && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 6, fontSize: 11, color: "#92400E" }}>
          ⚠ Birim Maliyet verisi yok — BUY/RAW parçalar 0 hesaplanır. Önce Birim Maliyetler sekmesinden VIO Excel'i yükle.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: selectedModel ? "350px 1fr" : "1fr", gap: 12 }}>
        {/* SOL: BOM listesi */}
        <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", background: "var(--color-background-secondary)", borderBottom: "1px solid var(--color-border-tertiary)" }}>
            <input
              type="text"
              placeholder="Model kodu veya isim ara..."
              value={searchModel}
              onChange={e => setSearchModel(e.target.value)}
              style={{ width: "100%", padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 11 }}
            />
          </div>
          <div style={{ maxHeight: 700, overflowY: "auto" }}>
            {modelsList.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
                {searchModel ? "Eşleşme yok" : "BOM modeli yok"}
              </div>
            ) : modelsList.map(m => {
              const isSelected = selectedModel === m.modelKey;
              return (
                <div
                  key={m.modelKey}
                  onClick={() => setSelectedModel(isSelected ? null : m.modelKey)}
                  style={{
                    padding: "8px 12px",
                    borderTop: "0.5px solid var(--color-border-tertiary)",
                    cursor: "pointer",
                    background: isSelected ? "var(--color-background-info-subtle, #EFF6FF)" : "transparent",
                    borderLeft: isSelected ? "3px solid var(--color-text-info)" : "3px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.modelCode || m.rootStockCode}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: m.rootCost > 0 ? "var(--color-text-success)" : "var(--color-text-tertiary)", flexShrink: 0 }}>
                      {m.rootCost > 0 ? fmt2(m.rootCost) + " ₺" : "—"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.rootStockName || m.modelName}
                  </div>
                  {m.rootCost > 0 && (
                    <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      Malz: {fmt0(m.rootMaterial)} ₺ · İşç: {fmt0(m.rootLabor)} ₺
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* SAĞ: seçili BOM detayı */}
        {selectedModel && calc?.byModel?.[selectedModel] && (
          <ModelDetailPanel model={calc.byModel[selectedModel]} wcRateAvg={calc.wcRateAvg} stockUnitCost={calc.stockUnitCost} onClose={() => setSelectedModel(null)} />
        )}
      </div>
    </div>
  );
}

function ModelDetailPanel({ model, wcRateAvg, stockUnitCost, onClose }) {
  const [showZero, setShowZero] = useState(true);
  const [searchPart, setSearchPart] = useState("");
  const parts = model.partsList || [];
  const filtered = useMemo(() => {
    const q = searchPart.trim().toLocaleLowerCase("tr-TR");
    return parts.filter(p => {
      if (!showZero && (p.unitCost || 0) <= 0) return false;
      if (!q) return true;
      const code = (p.stockCode || "").toLocaleLowerCase("tr-TR");
      const name = (p.stockName || "").toLocaleLowerCase("tr-TR");
      return code.includes(q) || name.includes(q);
    });
  }, [parts, showZero, searchPart]);

  return (
    <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--color-background-info-subtle, #EFF6FF)", borderBottom: "1px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-info)" }}>{model.modelCode || model.rootStockCode}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{model.rootStockName || model.modelName}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-success)" }}>{fmt2(model.rootCost)} ₺</div>
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            Malz: {fmt2(model.rootMaterial)} ₺ + İşç: {fmt2(model.rootLabor)} ₺
          </div>
        </div>
        <button onClick={onClose} style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, cursor: "pointer" }}>Kapat</button>
      </div>

      <div style={{ padding: "8px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 10, fontSize: 11, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Parça kodu veya isim ara..."
          value={searchPart}
          onChange={e => setSearchPart(e.target.value)}
          style={{ flex: "1 1 200px", maxWidth: 320, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 11 }}
        />
        <span style={{ color: "var(--color-text-tertiary)" }}>{filtered.length} / {parts.length} parça</span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} />
          0 ₺ olanları göster
        </label>
      </div>

      <div style={{ overflowX: "auto", maxHeight: 700, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--color-background-secondary)", zIndex: 1 }}>
            <tr>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>L</th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>Stok Kodu</th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>Stok Adı</th>
              <th style={{ padding: "5px 6px", textAlign: "center", fontWeight: 500 }}>Tip</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Op</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Malzeme</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>İşçilik</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Birim TL</th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>Kaynak</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const indent = (p.level || 0) * 12;
              const isRoot = p.idx === model.rootIdx;
              return (
                <tr key={p.idx} style={{ borderTop: "0.5px solid var(--color-border-tertiary)", background: isRoot ? "var(--color-background-info-subtle, #EFF6FF)" : "transparent" }}>
                  <td style={{ padding: "4px 8px", color: "var(--color-text-tertiary)" }}>L{p.level ?? "?"}</td>
                  <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", paddingLeft: 8 + indent }}>
                    {isRoot && "⭐ "}{p.stockCode}
                  </td>
                  <td style={{ padding: "4px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.stockName}>{p.stockName}</td>
                  <td style={{ padding: "3px 4px", textAlign: "center" }}>
                    <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: (SUPPLY_COLORS[p.supplyType] || "#888") + "20", color: SUPPLY_COLORS[p.supplyType] || "#888", fontWeight: 600 }}>
                      {p.supplyType || "?"}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{p.opCount || 0}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.materialCost)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.laborCost)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: isRoot ? 700 : 500 }}>{fmt2(p.unitCost)}</td>
                  <td style={{ padding: "4px 8px", fontSize: 9, color: "var(--color-text-tertiary)" }}>{p.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", fontSize: 10, color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
        <b>Kaynak kodu açıklaması:</b><br/>
        <code>buy-last-price</code> — BUY/RAW için unitCosts son alış fiyatı kullanıldı<br/>
        <code>buy-no-cost</code> — BUY/RAW ama unitCosts'ta kayıt yok (0 hesaplandı)<br/>
        <code>make-recursive</code> — Alt parçaların maliyetinden hesaplandı<br/>
        <code>make-leaf</code> — MAKE ama alt parça yok (sadece operasyon işçiliği)<br/>
        <code>fason-tbd</code> — Fason ücreti henüz tanımlı değil
      </div>
    </div>
  );
}
