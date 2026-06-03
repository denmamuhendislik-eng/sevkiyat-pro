import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  subscribeBomModels, subscribeWorkCenters, subscribeUnitCosts,
  subscribeLaborCosts, subscribeOverheadPolicy, subscribeFasonRates,
  saveProductCostsLatest,
} from "./firestore";
import { calculateAllProductCosts } from "./productCostCalc";
import { DEFAULT_WEIGHTS } from "./distributionCalc";
import { fmtMoneyNum, CURRENCY_SYMBOLS } from "./currency";

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m) - 1]} ${y}`;
};
// fmt2/fmt0 module-level kaldı: status/explain gibi para birimi-bağımsız yerlerde
// (örn. alış fiyatı tooltip'ı içinde, hep TL ile gösteriliyor). Para birimi-aware
// yerlerde ProductCostsTab/ModelDetailPanel içindeki f2/f0/sym kullanılır.
const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

const SUPPLY_COLORS = {
  BUY: "#2563EB", RAW: "#92400E", MAKE: "#1D9E75",
  "MAKE+FASON": "#D97706", FASON: "#C2410C", PRODUCT: "#1D9E75",
};

// Maliyet veri kalitesi durumu — parça satır rengi + filtre için
const STATUS_COLORS = {
  ok:      { bar: "#22C55E", bg: "rgba(34, 197, 94, 0.06)",  emoji: "🟢", label: "Tam" },
  partial: { bar: "#F59E0B", bg: "rgba(245, 158, 11, 0.07)", emoji: "🟡", label: "Kısmi" },
  missing: { bar: "#DC2626", bg: "rgba(220, 38, 38, 0.06)",  emoji: "🔴", label: "Eksik" },
};

function getRowStatus(part) {
  const sType = part.supplyType;
  if (sType === "BUY" || sType === "RAW") {
    return part.unitCost > 0 ? "ok" : "missing";
  }
  if (sType === "FASON") {
    const src = part.source || "";
    const fasonCost = part.fasonCost || 0;
    // Hiç fason ücret yok → gerçek eksik (ne op-bazlı tanım ne komple FASON fallback)
    if (fasonCost <= 0) return "missing";
    // v22 (2026-06-03): substring "fason-rate-missing" kontrolü tek başına yanıltıcı —
    // op kodu Fason Ücretleri tablosunda tanımsız olsa bile, parça-bazlı "Komple FASON"
    // tablosundan fallback (fason-complete-by-code) ile karşılanıyor olabilir.
    // 151-0228 örneği: fason 78.40 TL hesaplandı (complete-by-code) ama source ikisini
    // de içerdiği için eskiden missing sayılıyordu → 7 yanlış eksik gösterimi.
    const hasMissing = src.includes("fason-rate-missing");
    const hasComplete = src.includes("fason-complete-by-code");
    if (hasMissing && hasComplete) {
      // Op tabloda yok ama komple fason fallback ile karşılandı → OK (alt parçalar da OK ise)
      return part.unitCost > 0 ? "ok" : "missing";
    }
    if (hasMissing) return "partial";  // rate-missing var ama fasonCost > 0 (nadir, audit için kısmi)
    if (src.includes("no-weight")) return "partial";
    return part.unitCost > 0 ? "ok" : "missing";
  }
  // MAKE / MAKE+FASON / PRODUCT
  const def = part.laborOpDefault || 0;
  const wcAvg = part.laborOpWcAvg || 0;
  if (def > 0 || wcAvg > 0) return "partial";
  if ((part.unitCost || 0) === 0 && (part.materialCost || 0) === 0) return "missing";
  return "ok";
}

// Parent zincirinde BUY/RAW varsa true — bu parça maliyete dahil değil (children-ignored)
function isParentBypassed(parts, partIdx) {
  let cur = parts[partIdx];
  while (cur && cur.parentIdx !== null && cur.parentIdx !== undefined) {
    const parent = parts[cur.parentIdx];
    if (!parent) break;
    if (parent.supplyType === "BUY" || parent.supplyType === "RAW") return true;
    cur = parent;
  }
  return false;
}

function explainStatus(part) {
  const reasons = [];
  const sType = part.supplyType;
  if (sType === "BUY" || sType === "RAW") {
    if (part.unitCost > 0) reasons.push(`Alış fiyatı: ${fmt2(part.unitCost)} TL ✓`);
    else reasons.push("Alış fiyatı yok ✗");
  }
  if (part.laborOpMes > 0) reasons.push(`${part.laborOpMes} op MES verisi ✓`);
  if (part.laborOpManual > 0) reasons.push(`${part.laborOpManual} op manuel WC default ✓`);
  if (part.laborOpWcAvg > 0) reasons.push(`${part.laborOpWcAvg} op WC ortalaması (tahmin) ⚠`);
  if (part.laborOpDefault > 0) reasons.push(`${part.laborOpDefault} op 5dk global default ⚠`);
  const src = part.source || "";
  if (sType === "FASON" && (part.fasonCost || 0) <= 0 && !src.includes("fason-rate-missing")) {
    reasons.push("FASON tipi ama BOM'da fason op tanımsız → fason ücreti hesaplanmadı ✗");
  }
  // Op kodu tanımsız ama komple fason fallback ile karşılandı → audit notu (eksik sayılmaz)
  if (src.includes("fason-rate-missing") && src.includes("fason-complete-by-code")) {
    reasons.push(`Op kodu Fason Ücretleri tablosunda tanımsız, parça-bazlı Komple FASON ücreti (${fmt2(part.fasonCost)} TL) ile karşılandı ⓘ`);
  } else if (src.includes("fason-rate-missing")) {
    reasons.push("Fason ücreti tanımsız ✗");
  }
  if (src.includes("no-weight")) reasons.push("Parça ağırlığı yok (KG bazlı fason) ⚠");
  if (src.includes("children-ignored")) reasons.push("BOM children görmezden gelindi (BUY)");
  if (src.includes("ops-fason-skip")) reasons.push("İçsel op'lar atlandı (FASON)");
  return reasons.length > 0 ? reasons.join(" · ") : "—";
}

export default function ProductCostsTab({ canEdit, isAdmin, currency = "TRY", rates = null }) {
  // Para birimi yardımcısı — sadece sayı (sembol ayrı kolonlarda)
  const f2 = (tl) => fmtMoneyNum(tl, currency, rates, 2);
  const f0 = (tl) => fmtMoneyNum(tl, currency, rates, 0);
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const [bomModels, setBomModels] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [unitCosts, setUnitCosts] = useState({});
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [fasonRates, setFasonRates] = useState({});
  const [loaded, setLoaded] = useState({ bom: false, wc: false, unit: false, labor: false, pol: false, fason: false });
  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [selectedModel, setSelectedModel] = useState(null);
  const [searchModel, setSearchModel] = useState("");
  const [showInconsistencies, setShowInconsistencies] = useState(false);
  const [inconsistencyFilter, setInconsistencyFilter] = useState("all"); // all | supplyType | cycleTime

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
  useEffect(() => {
    const u = subscribeFasonRates(d => { setFasonRates(d || {}); setLoaded(p => ({ ...p, fason: true })); });
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
  const monthlySupplies = laborData?.monthlySupplies || {};
  const calc = useMemo(() => {
    if (!allLoaded) return null;
    return calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, refMonth: selectedMonth });
  }, [allLoaded, bomModels, unitCosts, workCenters, monthData, policy, fasonRates, monthlySupplies, selectedMonth]);

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

  // Cloud Function snapshot için en güncel hesaplı maliyet map'ini Firestore'a yaz.
  // Hem root mamul (rootStockCode → rootCost) hem tüm BOM parçaları (partsList → unitCost)
  // dahil edilir — yarı mamul/intermediate stoklar da snapshot'ta fiyat fallback bulur.
  // Aynı stockCode birden çok model'de görünürse en yüksek hesaplı maliyet kazanır.
  useEffect(() => {
    if (!calc?.byModel) return;
    const byStockCode = {};
    let partCount = 0;
    for (const m of Object.values(calc.byModel)) {
      // Root mamul
      const rootCode = (m.rootStockCode || "").trim();
      const rootCost = Number(m.rootCost) || 0;
      if (rootCode && rootCost > 0) {
        const v = Math.round(rootCost * 100) / 100;
        if (!byStockCode[rootCode] || byStockCode[rootCode] < v) byStockCode[rootCode] = v;
      }
      // Tüm BOM parçaları
      for (const part of (m.partsList || [])) {
        const code = (part.stockCode || "").trim();
        const cost = Number(part.unitCost) || 0;
        if (!code || cost <= 0) continue;
        const v = Math.round(cost * 100) / 100;
        if (!byStockCode[code] || byStockCode[code] < v) {
          byStockCode[code] = v;
          partCount++;
        }
      }
    }
    if (Object.keys(byStockCode).length === 0) return;
    saveProductCostsLatest({
      byStockCode,
      calculatedAt: new Date().toISOString(),
      monthRef: selectedMonth,
      modelCount: Object.keys(calc.byModel).length,
      partCount,
      totalCodeCount: Object.keys(byStockCode).length,
    }).catch(err => console.warn("productCostsLatest yazımı başarısız (snapshot etkilenmez):", err.message));
  }, [calc, selectedMonth]);

  // Model bazlı status özeti — sol panelde badge ve detayda parçalama için
  const modelStatusCounts = useMemo(() => {
    const counts = {};
    if (!calc?.byModel) return counts;
    for (const [key, model] of Object.entries(calc.byModel)) {
      let ok = 0, partial = 0, missing = 0;
      const list = model.partsList || [];
      for (const part of list) {
        if (isParentBypassed(list, part.idx)) continue;
        const s = getRowStatus(part);
        if (s === "ok") ok++;
        else if (s === "partial") partial++;
        else missing++;
      }
      counts[key] = { ok, partial, missing };
    }
    return counts;
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
          <b>{totals.models}</b> BOM · <b>{totals.costed}</b> maliyetli · <b>{totals.withoutCost}</b> eksik · Ortalama: <b>{f2(totals.avgCost)} {sym}</b>
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

      {/* BOM'lar arası tutarsızlık raporu */}
      {(calc?.crossModelInconsistencies?.length > 0) && (() => {
        const all = calc.crossModelInconsistencies;
        const supplyCount = all.filter(i => i.field === "supplyType").length;
        const cycleCount = all.filter(i => i.field === "cycleTime").length;
        const filtered = inconsistencyFilter === "all" ? all : all.filter(i => i.field === inconsistencyFilter);
        return (
          <div style={{ marginBottom: 10, border: "1px solid #F59E0B", borderRadius: 6, overflow: "hidden", background: "#FFFBEB" }}>
            <div
              onClick={() => setShowInconsistencies(v => !v)}
              style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
            >
              <span style={{ fontSize: 10, color: "#92400E" }}>{showInconsistencies ? "▼" : "▶"}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#92400E" }}>
                ⚠ BOM'lar Arası Tutarsızlık ({all.length})
              </span>
              <span style={{ fontSize: 10, color: "#92400E" }}>
                {supplyCount > 0 && <span style={{ marginRight: 8 }}><b>{supplyCount}</b> supplyType</span>}
                {cycleCount > 0 && <span><b>{cycleCount}</b> cycleTime</span>}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#92400E" }}>
                Aynı stok kodu farklı BOM'larda farklı kayıtlı — manuel kontrol et
              </span>
            </div>
            {showInconsistencies && (
              <div style={{ background: "white", borderTop: "1px solid #FCD34D" }}>
                {/* Filter butonları */}
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border-tertiary)", display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Filtre:</span>
                  {[
                    { id: "all", label: `Tümü (${all.length})`, color: "#92400E" },
                    { id: "supplyType", label: `supplyType (${supplyCount})`, color: "#DC2626" },
                    { id: "cycleTime", label: `cycleTime (${cycleCount})`, color: "#D97706" },
                  ].map(f => {
                    const active = inconsistencyFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setInconsistencyFilter(f.id)}
                        style={{ padding: "3px 10px", fontSize: 10, borderRadius: 4, cursor: "pointer", fontWeight: active ? 600 : 400,
                          border: "1px solid " + (active ? f.color : "var(--color-border-tertiary)"),
                          background: active ? f.color : "transparent", color: active ? "white" : "var(--color-text-secondary)" }}>
                        {f.label}
                      </button>
                    );
                  })}
                </div>
                {/* Tablo */}
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead style={{ background: "var(--color-background-secondary)", position: "sticky", top: 0 }}>
                      <tr style={{ borderBottom: "1px solid var(--color-border-tertiary)" }}>
                        <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)" }}>Stok Kodu</th>
                        <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)" }}>Stok Adı</th>
                        <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)" }}>Alan</th>
                        <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)" }}>BOM'lar arası değerler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 && (
                        <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 11 }}>Bu filtreyle eşleşen tutarsızlık yok</td></tr>
                      )}
                      {filtered.map((inc, idx) => {
                        const isHigh = inc.impact === "high";
                        const fieldLabel = inc.field === "supplyType" ? "supplyType" : `cycleTime · op ${inc.opCode}`;
                        const modelEntries = Object.entries(inc.valuesByModel).sort();
                        return (
                          <tr key={`${inc.stockCode}_${inc.field}_${inc.opCode || ""}_${idx}`} style={{ borderBottom: "1px solid var(--color-border-tertiary)", background: isHigh ? "rgba(220, 38, 38, 0.04)" : "transparent" }}>
                            <td style={{ padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, verticalAlign: "top" }}>{inc.stockCode}</td>
                            <td style={{ padding: "5px 10px", fontSize: 10, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "top" }} title={inc.stockName}>{inc.stockName || "—"}</td>
                            <td style={{ padding: "5px 10px", fontSize: 10, verticalAlign: "top" }}>
                              <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600, color: "white", background: isHigh ? "#DC2626" : "#D97706" }}>
                                {fieldLabel}
                              </span>
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 10, verticalAlign: "top" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {modelEntries.map(([mk, val]) => {
                                  const display = inc.field === "supplyType"
                                    ? (val || "—")
                                    : (val > 0 ? `${val} dk` : "boş");
                                  const isEmptyCycle = inc.field === "cycleTime" && val === 0;
                                  return (
                                    <span key={mk} style={{ padding: "2px 7px", borderRadius: 3, border: "1px solid var(--color-border-tertiary)", background: isEmptyCycle ? "#FEE2E2" : "var(--color-background-secondary)", fontSize: 10 }}>
                                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", marginRight: 4 }}>{mk}:</span>
                                      <strong style={{ color: isEmptyCycle ? "#991B1B" : "var(--color-text-primary)" }}>{display}</strong>
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: "6px 12px", fontSize: 9, color: "var(--color-text-tertiary)", borderTop: "1px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
                  ℹ <b>supplyType</b> (kırmızı) hesap modelini değiştirir — yüksek etki · <b>cycleTime</b> (turuncu) işçilik miktarını etkiler — orta etki · BOM yükleme parent-bazlı, eski yüklemelerde drift birikir. Manuel düzeltmek için ilgili BOM Excel'i indir → düzelt → yükle.
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
                      {m.rootCost > 0 ? `${f2(m.rootCost)} ${sym}` : "—"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.rootStockName || m.modelName}
                  </div>
                  {m.rootCost > 0 && (
                    <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      Malz: {f0(m.rootMaterial)} · İşç: {f0(m.rootLabor)}
                      {(m.rootFason || 0) > 0 && <> · Fas: {f0(m.rootFason)}</>}
                    </div>
                  )}
                  {(() => {
                    const cnt = modelStatusCounts[m.modelKey];
                    if (!cnt || (cnt.ok + cnt.partial + cnt.missing) === 0) return null;
                    return (
                      <div style={{ fontSize: 9, marginTop: 3, display: "flex", gap: 6 }} title={`${cnt.missing} eksik · ${cnt.partial} kısmi · ${cnt.ok} tam veri`}>
                        {cnt.missing > 0 && <span style={{ color: STATUS_COLORS.missing.bar, fontWeight: 600 }}>🔴{cnt.missing}</span>}
                        {cnt.partial > 0 && <span style={{ color: STATUS_COLORS.partial.bar, fontWeight: 600 }}>🟡{cnt.partial}</span>}
                        {cnt.ok > 0 && <span style={{ color: STATUS_COLORS.ok.bar }}>🟢{cnt.ok}</span>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        {/* SAĞ: seçili BOM detayı */}
        {selectedModel && calc?.byModel?.[selectedModel] && (
          <ModelDetailPanel
            model={calc.byModel[selectedModel]}
            wcRateAvg={calc.wcRateAvg}
            stockUnitCost={calc.stockUnitCost}
            statusCounts={modelStatusCounts[selectedModel]}
            onClose={() => setSelectedModel(null)}
            currency={currency}
            rates={rates}
          />
        )}
      </div>
    </div>
  );
}

function ModelDetailPanel({ model, wcRateAvg, stockUnitCost, statusCounts, onClose, currency = "TRY", rates = null }) {
  const f2 = (tl) => fmtMoneyNum(tl, currency, rates, 2);
  const sym = CURRENCY_SYMBOLS[currency] || "₺";
  const [showZero, setShowZero] = useState(true);
  const [searchPart, setSearchPart] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");  // all | ok | partial | missing
  const parts = model.partsList || [];

  // Eksik BUY/RAW kalemleri için Excel şablonu indir — UnitCostsTab'a toplu yüklemeye hazır
  const handleExportMissing = () => {
    const missingBuyRaw = parts.filter(p => {
      const sType = p.supplyType;
      if (sType !== "BUY" && sType !== "RAW") return false;
      if (isParentBypassed(parts, p.idx)) return false;
      return (p.unitCost || 0) <= 0;
    });
    if (missingBuyRaw.length === 0) {
      alert("Eksik BUY/RAW kalemi yok 👍");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = [["Stok Kodu", "Stok Adı", "Tip", "TL/Birim *", "Birim (AD/KG)", "Ağırlık (kg/AD, KG için)", "Tarih (YYYY-MM-DD)", "Tedarikçi", "Not"]];
    missingBuyRaw.forEach(p => {
      rows.push([p.stockCode || "", p.stockName || "", p.supplyType, "", "AD", "", today, "", ""]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 25 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Eksik_Birim_Maliyetler");
    const fileName = `eksik_birim_maliyet_${(model.modelCode || "BOM").replace(/[^a-zA-Z0-9-]/g, "_")}_${today}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };
  const filtered = useMemo(() => {
    const q = searchPart.trim().toLocaleLowerCase("tr-TR");
    return parts.filter(p => {
      if (!showZero && (p.unitCost || 0) <= 0) return false;
      if (statusFilter !== "all") {
        const bypassed = isParentBypassed(parts, p.idx);
        if (bypassed) return false;  // bypassed satırlar filtrede yer almaz
        if (getRowStatus(p) !== statusFilter) return false;
      }
      if (!q) return true;
      const code = (p.stockCode || "").toLocaleLowerCase("tr-TR");
      const name = (p.stockName || "").toLocaleLowerCase("tr-TR");
      return code.includes(q) || name.includes(q);
    });
  }, [parts, showZero, searchPart, statusFilter]);

  return (
    <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--color-background-info-subtle, #EFF6FF)", borderBottom: "1px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-info)" }}>{model.modelCode || model.rootStockCode}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{model.rootStockName || model.modelName}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-success)" }}>{f2(model.rootCost)} {sym}</div>
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            Malz: {f2(model.rootMaterial)} + İşç: {f2(model.rootLabor)}
            {(model.rootFason || 0) > 0 && <> + Fas: {f2(model.rootFason)}</>} {sym}
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
        {statusCounts?.missing > 0 && (
          <button
            onClick={handleExportMissing}
            title="Bu modeldeki BUY/RAW eksik kalemleri Excel olarak indir — UnitCostsTab'tan toplu yüklenebilir"
            style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: 500, border: "1px solid #DC2626", background: "transparent", color: "#DC2626", cursor: "pointer" }}
          >
            📥 Eksik Excel İndir
          </button>
        )}
        {statusCounts && (statusCounts.ok + statusCounts.partial + statusCounts.missing) > 0 && (
          <div style={{ display: "inline-flex", gap: 4, marginLeft: statusCounts?.missing > 0 ? 0 : "auto" }}>
            {[
              { k: "all", label: "Hepsi", count: statusCounts.ok + statusCounts.partial + statusCounts.missing, color: "var(--color-text-secondary)" },
              { k: "missing", label: "🔴 Eksik", count: statusCounts.missing, color: STATUS_COLORS.missing.bar },
              { k: "partial", label: "🟡 Kısmi", count: statusCounts.partial, color: STATUS_COLORS.partial.bar },
              { k: "ok", label: "🟢 Tam", count: statusCounts.ok, color: STATUS_COLORS.ok.bar },
            ].map(b => {
              const active = statusFilter === b.k;
              return (
                <button
                  key={b.k}
                  onClick={() => setStatusFilter(b.k)}
                  style={{
                    padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontWeight: active ? 600 : 500,
                    border: `1px solid ${active ? b.color : "var(--color-border-tertiary)"}`,
                    background: active ? b.color + "22" : "transparent",
                    color: active ? b.color : "var(--color-text-secondary)",
                  }}
                >
                  {b.label} ({b.count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto", maxHeight: 700, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--color-background-secondary)", zIndex: 1 }}>
            <tr>
              <th style={{ padding: "5px 4px", textAlign: "center", fontWeight: 500, width: 6 }}></th>
              <th style={{ padding: "5px 4px", textAlign: "center", fontWeight: 500, width: 18 }}></th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>L</th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>Stok Kodu</th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>Stok Adı</th>
              <th style={{ padding: "5px 6px", textAlign: "center", fontWeight: 500 }}>Tip</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Op</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Malzeme</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>İşçilik</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Fason</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>Birim {sym}</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }} title="1 adet root mamul için bu parçadan kullanılan miktar (zincir qty çarpımı)">Kullanım</th>
              <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }} title="Birim TL × Kullanım = root maliyetine bu parçanın katkısı">Etki ({sym})</th>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 500 }}>Kaynak</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const indent = (p.level || 0) * 12;
              const isRoot = p.idx === model.rootIdx;
              const bypassed = isParentBypassed(parts, p.idx);
              const status = bypassed ? null : getRowStatus(p);
              const sc = status ? STATUS_COLORS[status] : null;
              const tooltip = bypassed
                ? "BUY parent altında — hesaba dahil değil ⊘"
                : explainStatus(p);
              const rowBg = isRoot
                ? "var(--color-background-info-subtle, #EFF6FF)"
                : (sc?.bg || "transparent");
              return (
                <tr
                  key={p.idx}
                  title={tooltip}
                  style={{ borderTop: "0.5px solid var(--color-border-tertiary)", background: rowBg, opacity: bypassed ? 0.5 : 1 }}
                >
                  <td style={{ padding: 0, background: sc?.bar || "transparent", width: 4 }}></td>
                  <td style={{ padding: "3px 2px", textAlign: "center", fontSize: 10 }}>
                    {bypassed ? <span title="BUY parent altında — hesaba dahil değil">⊘</span> : (sc ? sc.emoji : "")}
                  </td>
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
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{f2(p.materialCost)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{f2(p.laborCost)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: (p.fasonCost || 0) > 0 ? "#C2410C" : "var(--color-text-tertiary)" }}>{f2(p.fasonCost)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: isRoot ? 700 : 500 }}>{f2(p.unitCost)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }} title={`1 root için ${p.effectiveQty ?? 1} kullanılır`}>
                    {(() => {
                      const q = p.effectiveQty ?? 1;
                      if (q === 1) return "1";
                      if (q < 0.01) return q.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
                      return q.toLocaleString("tr-TR", { maximumFractionDigits: 4 });
                    })()}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: bypassed ? "var(--color-text-tertiary)" : "var(--color-text-success)" }} title="Birim × Kullanım = root maliyetine katkı">
                    {bypassed ? "—" : f2(p.contribution)}
                  </td>
                  <td style={{ padding: "4px 8px", fontSize: 9, color: "var(--color-text-tertiary)" }}>{p.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", fontSize: 10, color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
        <b>Durum:</b> 🟢 Tam (MES + manuel veri) · 🟡 Kısmi (WC ortalaması veya 5dk default kullanıldı, ya da KG fason ağırlık eksik) · 🔴 Eksik (alış fiyatı yok / fason ücreti tanımsız / unitCost 0) · ⊘ BUY parent altı (hesaba dahil değil)<br/>
        <b>Kaynak kodu açıklaması:</b>
        <code>buy-by-code</code>, <code>make-recursive</code>, <code>fason-children</code>, <code>+labor(mes:N,man:N,wcAvg:N,def:N)</code> — Satır üzerine hover ile detay tooltip
      </div>
    </div>
  );
}
