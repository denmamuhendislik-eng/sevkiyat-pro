import { useState, useEffect, useMemo } from "react";
import { subscribeWorkCenters, saveMachinesForWc, saveWcManualCycle, subscribeLaborCosts, subscribeOverheadPolicy, saveOverheadPolicy, subscribeBomModels } from "./firestore";
import { calculateMachineRates, DEFAULT_WEIGHTS, suggestWcSalaryMapping } from "./distributionCalc";

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m) - 1]} ${y}`;
};

const META_FIELDS = [
  { key: "satinAlmaTl", label: "Satın Alma", placeholder: "0", icon: "🏭", hint: "Tezgah satın alma değeri — yanındaki kur seçici ile döviz girilebilir, sistem TL'ye çevirir", hasCurrency: true },
  { key: "alanM2", label: "Alan (m²)", placeholder: "0", icon: "📐", hint: "Tezgahın kapladığı alan — kira/ısıtma payı için" },
  { key: "kuruluKw", label: "Kurulu Güç (kW)", placeholder: "0", icon: "⚡", hint: "Tezgahın kurulu elektrik gücü — elektrik payı için" },
  { key: "operatorAylikTl", label: "Operatör Aylık (₺)", placeholder: "0", icon: "👤", hint: "Tezgaha sabit atanmış operatör ücreti (TL, varsa)" },
  { key: "amortismanYil", label: "Amortisman (yıl)", placeholder: "10", icon: "📅", hint: "Amortisman süresi — varsayılan 10 yıl" },
];

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

export default function MachineRatesTab({ canEdit }) {
  const [workCenters, setWorkCenters] = useState({});
  const [loaded, setLoaded] = useState(false);
  // Local draft: { [wcCode]: { dirty: bool, machines: [...] } }
  const [drafts, setDrafts] = useState({});
  const [savingWc, setSavingWc] = useState(null);
  // Dağıtım için ek state'ler
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  // BOM ortalaması referans değer (manuel input boş ise gösterilir)
  const [bomModels, setBomModels] = useState({});
  // WC bazlı manuel cycle input drafts (kaydedilmemiş değişiklikler)
  const [cycleDrafts, setCycleDrafts] = useState({});

  useEffect(() => {
    const unsub = subscribeLaborCosts((d) => setLaborData(d || {}));
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = subscribeOverheadPolicy((d) => {
      if (!d || Object.keys(d).length === 0) {
        // Default policy
        setPolicy({ weights: { ...DEFAULT_WEIGHTS }, wcSalaryMapping: {} });
      } else {
        setPolicy(d);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeWorkCenters((data) => {
      setWorkCenters(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = subscribeBomModels((d) => setBomModels(d || {}));
    return unsub;
  }, []);

  // BOM'dan WC bazlı ortalama cycle süresi — productCostCalc.js'deki hesabın aynısı.
  // UI'da "BOM ort: X dk" referans olarak gösterilir.
  const wcAvgCycle = useMemo(() => {
    const sums = {};
    for (const mk of Object.keys(bomModels)) {
      if (mk === "undefined") continue;
      for (const p of (bomModels[mk]?.parts || [])) {
        for (const op of (p.operations || [])) {
          if (op.wcCode && op.cycleTime > 0) {
            if (!sums[op.wcCode]) sums[op.wcCode] = { total: 0, count: 0 };
            sums[op.wcCode].total += op.cycleTime;
            sums[op.wcCode].count++;
          }
        }
      }
    }
    const out = {};
    for (const [wc, s] of Object.entries(sums)) {
      out[wc] = Math.round((s.total / s.count) * 100) / 100;
    }
    return out;
  }, [bomModels]);

  const handleSaveCycle = async (code, raw) => {
    if (!canEdit) return;
    const trimmed = String(raw ?? "").trim();
    const val = trimmed === "" ? null : Number(trimmed);
    try {
      await saveWcManualCycle(code, val, { canEdit });
      setCycleDrafts(prev => { const { [code]: _, ...rest } = prev; return rest; });
    } catch (e) {
      alert("Manuel cycle kaydı hatası: " + e.message);
    }
  };

  // Tüm WC'leri göster — tezgahsız olanlarda "+ Yardımcı ekipman ekle" butonu
  const wcEntries = useMemo(() => {
    const centers = workCenters?.centers || {};
    return Object.entries(centers)
      .sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));
  }, [workCenters]);

  // Toplam istatistikler (kayıtlı + draft karışımı)
  const totals = useMemo(() => {
    let totalMachines = 0, totalSatinAlma = 0, totalAlan = 0, totalKw = 0, totalOpTl = 0;
    let filledMachines = 0;
    for (const [code, wc] of wcEntries) {
      const machines = drafts[code]?.machines || wc.machines || [];
      totalMachines += machines.length;
      for (const m of machines) {
        const sa = Number(m.satinAlmaTl) || 0;
        const al = Number(m.alanM2) || 0;
        const kw = Number(m.kuruluKw) || 0;
        const op = Number(m.operatorAylikTl) || 0;
        totalSatinAlma += sa;
        totalAlan += al;
        totalKw += kw;
        totalOpTl += op;
        if (sa > 0 || al > 0 || kw > 0) filledMachines++;
      }
    }
    return { totalMachines, totalSatinAlma, totalAlan, totalKw, totalOpTl, filledMachines };
  }, [wcEntries, drafts]);

  const getMachines = (code) => {
    if (drafts[code]) return drafts[code].machines;
    const wc = workCenters?.centers?.[code];
    return wc?.machines || [];
  };

  const updateMachine = (code, mIdx, fieldKey, value) => {
    setDrafts(prev => {
      const cur = prev[code]?.machines ? [...prev[code].machines] : [...(workCenters?.centers?.[code]?.machines || [])].map(m => ({ ...m }));
      cur[mIdx] = { ...cur[mIdx], [fieldKey]: value };
      return { ...prev, [code]: { dirty: true, machines: cur } };
    });
  };

  const handleSaveWc = async (code) => {
    if (!canEdit) return;
    if (!drafts[code]?.dirty) return;
    setSavingWc(code);
    try {
      // Numeric alanları sayıya dönüştür
      const cleaned = drafts[code].machines.map(m => {
        const out = { ...m };
        for (const f of META_FIELDS) {
          if (out[f.key] === "" || out[f.key] === undefined || out[f.key] === null) {
            delete out[f.key];
          } else {
            const n = Number(out[f.key]);
            if (!isNaN(n)) out[f.key] = n;
          }
        }
        return out;
      });
      await saveMachinesForWc(code, cleaned, { canEdit });
      setDrafts(prev => {
        const { [code]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      alert("Kaydetme hatası: " + e.message);
    } finally {
      setSavingWc(null);
    }
  };

  const handleResetWc = (code) => {
    setDrafts(prev => {
      const { [code]: _, ...rest } = prev;
      return rest;
    });
  };

  // Sanal tezgah / yardımcı ekipman ekleme — mesOpCodes yok → MRP iş atamaz, sadece maliyet havuzu
  const handleAddVirtual = async (code) => {
    if (!canEdit) return;
    const name = prompt("Yardımcı ekipman/personel grubu adı:\n(örn. \"Kalite Kontrol Personel\", \"Yardımcı Ekipman\")");
    if (!name || !name.trim()) return;
    const wc = workCenters?.centers?.[code];
    const machines = drafts[code]?.machines || wc?.machines || [];
    const nextId = code + String(machines.length + 1).padStart(2, "0");
    const newList = [...machines, { id: nextId, name: name.trim() }];
    try {
      await saveMachinesForWc(code, newList, { canEdit });
      // Draft varsa temizle (artık subscribe ile yeni veri gelir)
      if (drafts[code]) handleResetWc(code);
    } catch (e) {
      alert("Ekleme hatası: " + e.message);
    }
  };

  if (!loaded) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;
  }

  if (wcEntries.length === 0) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🏭</div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Tanımlı tezgah yok</div>
        <div style={{ fontSize: 12 }}>İş Merkezleri tab'ından tezgah ekleyin</div>
      </div>
    );
  }

  return (
    <div>
      {/* Üst özet */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8, marginBottom: 16, flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>{totals.totalMachines} tezgah</span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span title="Maliyet alanları doldurulmuş tezgah sayısı"><b>{totals.filledMachines}</b> / {totals.totalMachines} dolu</span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span>🏭 {fmt(totals.totalSatinAlma)} ₺</span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span>📐 {fmt(totals.totalAlan)} m²</span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span>⚡ {fmt(totals.totalKw)} kW</span>
        {totals.totalOpTl > 0 && (
          <>
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
            <span>👤 {fmt(totals.totalOpTl)} ₺/ay</span>
          </>
        )}
      </div>

      {/* WC bazında tablo grupları */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {wcEntries.map(([code, wc]) => {
          const machines = getMachines(code);
          const isEmpty = machines.length === 0;
          const isDirty = !!drafts[code]?.dirty;
          const isSaving = savingWc === code;
          return (
            <div key={code} style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden", opacity: isEmpty ? 0.85 : 1 }}>
              <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{wc.name || code}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>({machines.length} tezgah)</span>
                {/* Manuel default cycle (dk) — BOM'da süre girilmemiş op'lar için */}
                {(() => {
                  const stored = wc.manualCycleMin;
                  const draft = cycleDrafts[code];
                  const value = draft !== undefined ? draft : (stored != null ? String(stored) : "");
                  const bomAvg = wcAvgCycle[code];
                  const isDirty = draft !== undefined && draft !== (stored != null ? String(stored) : "");
                  return (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--color-text-secondary)" }}>
                      <span title="Bu WC'deki op'larda cycleTime girilmemişse maliyet hesabında bu değer kullanılır. Boş bırakırsan BOM ortalaması, o da yoksa 5 dk default kullanılır.">⏱ Manuel cycle:</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder={bomAvg > 0 ? `boş = ${bomAvg}` : "boş = 5"}
                        value={value}
                        disabled={!canEdit}
                        onChange={e => setCycleDrafts(prev => ({ ...prev, [code]: e.target.value }))}
                        onBlur={() => { if (isDirty) handleSaveCycle(code, value); }}
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        style={{ width: 70, padding: "3px 6px", fontSize: 11, borderRadius: 3, border: "1px solid " + (isDirty ? "#1D9E75" : "var(--color-border-tertiary)") }}
                      />
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>dk</span>
                      {bomAvg > 0 && (
                        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }} title="BOM'daki süreli op'ların ortalaması">(BOM ort: {bomAvg})</span>
                      )}
                    </span>
                  );
                })()}
                {isEmpty && canEdit && (
                  <button
                    onClick={() => handleAddVirtual(code)}
                    title="Bu merkez için yardımcı ekipman/personel kaydı ekle — MRP'ye iş atanmaz, sadece maliyet havuzu"
                    style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 4, border: "1px dashed var(--color-border-info)", background: "transparent", color: "var(--color-text-info)", fontSize: 11, fontWeight: 500, cursor: "pointer" }}
                  >
                    + Yardımcı ekipman/personel ekle
                  </button>
                )}
                {isDirty && canEdit && (
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                    <button
                      onClick={() => handleResetWc(code)}
                      style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, color: "var(--color-text-secondary)", cursor: "pointer" }}
                    >
                      Geri al
                    </button>
                    <button
                      onClick={() => handleSaveWc(code)}
                      disabled={isSaving}
                      style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontSize: 11, fontWeight: 500, cursor: isSaving ? "default" : "pointer" }}
                    >
                      {isSaving ? "Kaydediliyor..." : "Kaydet"}
                    </button>
                  </span>
                )}
              </div>
              {isEmpty ? (
                <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center", fontStyle: "italic" }}>
                  Bu merkezde tezgah veya yardımcı ekipman tanımlı değil.
                  {canEdit && " Üst köşedeki butondan personel/ekipman maliyet kaydı ekleyebilirsin."}
                </div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: "var(--color-background-primary)" }}>
                          <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 500, fontSize: 10, color: "var(--color-text-secondary)", minWidth: 220 }}>Tezgah / Ekipman</th>
                          {META_FIELDS.map(f => (
                            <th key={f.key} title={f.hint} style={{ padding: "6px 10px", textAlign: "right", fontWeight: 500, fontSize: 10, color: "var(--color-text-secondary)", minWidth: 110 }}>
                              {f.icon} {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {machines.map((m, idx) => {
                          const isVirtual = !m.mesOpCodes || m.mesOpCodes.length === 0;
                          return (
                            <tr key={m.id || idx} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                              <td style={{ padding: "5px 10px" }}>
                                <div style={{ fontSize: 11, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                  {m.name || m.id}
                                  {isVirtual && (
                                    <span title="Yardımcı ekipman/personel — MRP iş atamaz, sadece maliyet havuzu" style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "#FEF3C7", color: "#92400E" }}>YRD</span>
                                  )}
                                </div>
                                {m.id && m.id !== m.name && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--color-text-tertiary)" }}>{m.id}</div>}
                              </td>
                              {META_FIELDS.map(f => (
                                <td key={f.key} style={{ padding: "4px 8px", textAlign: "right" }}>
                                  {f.hasCurrency ? (
                                    <div style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                                      <input
                                        type="number" min="0" step="0.01"
                                        value={m[f.key] === undefined || m[f.key] === null ? "" : m[f.key]}
                                        onChange={e => updateMachine(code, idx, f.key, e.target.value)}
                                        placeholder={f.placeholder}
                                        disabled={!canEdit}
                                        style={{ width: 90, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--color-border-tertiary)", fontSize: 11, textAlign: "right", background: canEdit ? "var(--color-background-primary)" : "transparent" }}
                                      />
                                      <select
                                        value={m.satinAlmaCurrency || "TRY"}
                                        onChange={e => updateMachine(code, idx, "satinAlmaCurrency", e.target.value)}
                                        disabled={!canEdit}
                                        title="Sözleşme para birimi — TRY harici girilirse sistem TCMB kuruyla TL'ye çevirir"
                                        style={{ padding: "4px 4px", borderRadius: 4, border: "1px solid var(--color-border-tertiary)", fontSize: 10, background: canEdit ? "var(--color-background-primary)" : "transparent" }}
                                      >
                                        <option value="TRY">₺</option>
                                        <option value="USD">$</option>
                                        <option value="EUR">€</option>
                                      </select>
                                    </div>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      step={f.key === "amortismanYil" ? "1" : "0.01"}
                                      value={m[f.key] === undefined || m[f.key] === null ? "" : m[f.key]}
                                      onChange={e => updateMachine(code, idx, f.key, e.target.value)}
                                      placeholder={f.placeholder}
                                      disabled={!canEdit}
                                      style={{ width: 100, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--color-border-tertiary)", fontSize: 11, textAlign: "right", background: canEdit ? "var(--color-background-primary)" : "transparent" }}
                                    />
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {canEdit && (
                    <div style={{ padding: "6px 14px", borderTop: "0.5px solid var(--color-border-tertiary)", textAlign: "right" }}>
                      <button
                        onClick={() => handleAddVirtual(code)}
                        title="Bu merkez için yardımcı ekipman/personel kaydı ekle"
                        style={{ padding: "3px 10px", borderRadius: 4, border: "1px dashed var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", fontSize: 10, cursor: "pointer" }}
                      >
                        + Yardımcı ekipman/personel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Dağıtım politikası + hesap önizleme */}
      <DistributionPanel
        workCenters={workCenters}
        laborData={laborData}
        policy={policy}
        setPolicy={setPolicy}
        policyDirty={policyDirty}
        setPolicyDirty={setPolicyDirty}
        savingPolicy={savingPolicy}
        setSavingPolicy={setSavingPolicy}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        showMappingEditor={showMappingEditor}
        setShowMappingEditor={setShowMappingEditor}
        canEdit={canEdit}
      />


      {/* Yardım kutusu */}
      <div style={{ marginTop: 18, padding: "10px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--color-text-info)" }}>Tezgah meta verileri ne için?</div>
        {META_FIELDS.map(f => (
          <div key={f.key}>{f.icon} <b>{f.label}</b> — {f.hint}</div>
        ))}
        <div style={{ marginTop: 6, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          Aylık genel giderler bu meta verilere göre tezgahlara dağıtılır. Eksik bilgi varsa o tezgah eşit pay alır.
        </div>
      </div>
    </div>
  );
}

const WEIGHT_LABELS = {
  satinAlma: { label: "Satın Alma", icon: "🏭", desc: "Tezgah yatırım değerine orantılı (amortisman + sermaye yükü)" },
  alan:      { label: "Alan",       icon: "📐", desc: "Kapladığı m² oranı (kira, ısıtma, aydınlatma)" },
  kuruluKw:  { label: "Kurulu Güç", icon: "⚡", desc: "kW oranı (elektrik enerjisi)" },
  operator:  { label: "Operatör/Eşit", icon: "👤", desc: "Eşit dağılım (idari, sosyal hizmetli vs. ortak personel)" },
};

function DistributionPanel({ workCenters, laborData, policy, setPolicy, policyDirty, setPolicyDirty, savingPolicy, setSavingPolicy, selectedMonth, setSelectedMonth, showMappingEditor, setShowMappingEditor, canEdit }) {
  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthsAvailable = useMemo(() => Object.keys(monthlyOverheads).sort().reverse(), [monthlyOverheads]);
  const monthData = monthlyOverheads[selectedMonth];

  // Default ay: en son TAMAMLANMIŞ ay (bugünün ayı hariç)
  useEffect(() => {
    if (monthsAvailable.length === 0) return;
    if (monthlyOverheads[selectedMonth]) return;
    const cur = todayMonth();
    const completed = monthsAvailable.filter(m => m < cur);
    if (completed.length > 0) setSelectedMonth(completed[0]);
    else setSelectedMonth(monthsAvailable[0]);
  }, [monthsAvailable, selectedMonth, monthlyOverheads, setSelectedMonth]);

  const weights = policy?.weights || DEFAULT_WEIGHTS;
  const totalWeight = (weights.satinAlma || 0) + (weights.alan || 0) + (weights.kuruluKw || 0) + (weights.operator || 0);
  const weightOk = Math.abs(totalWeight - 1.0) < 0.001;

  const updateWeight = (key, percentValue) => {
    const v = Math.max(0, Math.min(1, Number(percentValue) / 100));
    setPolicy(prev => ({ ...prev, weights: { ...(prev?.weights || DEFAULT_WEIGHTS), [key]: v } }));
    setPolicyDirty(true);
  };

  const handleSavePolicy = async () => {
    if (!canEdit || savingPolicy) return;
    if (!weightOk) {
      alert("Ağırlıkların toplamı %100 olmalı. Şu an: %" + (totalWeight * 100).toFixed(1));
      return;
    }
    setSavingPolicy(true);
    try {
      await saveOverheadPolicy(policy, { canEdit });
      setPolicyDirty(false);
    } catch (e) {
      alert("Kaydetme hatası: " + e.message);
    } finally {
      setSavingPolicy(false);
    }
  };

  // Otomatik WC-maaş tahmini
  const handleAutoSuggest = () => {
    if (!monthData?.items) { alert("Önce bir ay seç (gider verisi gerekli)"); return; }
    const suggestions = suggestWcSalaryMapping(monthData.items, workCenters?.centers || {});
    setPolicy(prev => ({
      ...prev,
      wcSalaryMapping: { ...(prev?.wcSalaryMapping || {}), ...suggestions },
    }));
    setPolicyDirty(true);
  };

  const updateMapping = (code, wcCodes) => {
    setPolicy(prev => ({
      ...prev,
      wcSalaryMapping: { ...(prev?.wcSalaryMapping || {}), [code]: wcCodes },
    }));
    setPolicyDirty(true);
  };
  const removeMapping = (code) => {
    setPolicy(prev => {
      const m = { ...(prev?.wcSalaryMapping || {}) };
      delete m[code];
      return { ...prev, wcSalaryMapping: m };
    });
    setPolicyDirty(true);
  };

  // Hesap
  const calc = useMemo(() => {
    if (!monthData || !workCenters || !policy) return null;
    return calculateMachineRates({ monthData, policy, workCenters });
  }, [monthData, workCenters, policy]);

  const wcEntries = useMemo(() =>
    Object.entries(workCenters?.centers || {}).sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]))
  , [workCenters]);

  const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  const fmt4 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 4 });

  return (
    <div style={{ marginTop: 20, border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--color-background-info-subtle, #EFF6FF)", borderBottom: "1px solid var(--color-border-tertiary)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-info)" }}>⚙️ Dağıtım Politikası & Hesaplanmış Tezgah Dakika Ücretleri</div>
      </div>

      {/* Ağırlıklar */}
      <div style={{ padding: "12px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 8, color: "var(--color-text-secondary)" }}>Dağıtım ağırlıkları — genel havuz bu yüzdelerle 4 kritere bölünür:</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(WEIGHT_LABELS).map(([key, def]) => {
            const v = weights[key] || 0;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: 6 }} title={def.desc}>
                <span style={{ fontSize: 14 }}>{def.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{def.label}</span>
                <input
                  type="number" min="0" max="100" step="1"
                  value={Math.round(v * 1000) / 10}
                  onChange={e => updateWeight(key, e.target.value)}
                  disabled={!canEdit}
                  style={{ width: 50, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", fontSize: 11, textAlign: "center" }}
                />
                <span style={{ fontSize: 11 }}>%</span>
              </div>
            );
          })}
          <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 12px", fontSize: 12, fontWeight: 600, color: weightOk ? "var(--color-text-success)" : "#DC2626" }}>
            Toplam: %{(totalWeight * 100).toFixed(1)} {weightOk ? "✓" : "(100 olmalı)"}
          </span>
          {canEdit && policyDirty && (
            <button
              onClick={handleSavePolicy}
              disabled={!weightOk || savingPolicy}
              style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 5, border: "1px solid #1D9E75", background: weightOk ? "#1D9E75" : "var(--color-background-secondary)", color: weightOk ? "white" : "var(--color-text-tertiary)", fontWeight: 500, fontSize: 12, cursor: weightOk ? "pointer" : "default" }}
            >
              {savingPolicy ? "Kaydediliyor..." : "Politikayı Kaydet"}
            </button>
          )}
        </div>
      </div>

      {/* WC-Maaş Mapping editor */}
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div
          onClick={() => setShowMappingEditor(v => !v)}
          style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
        >
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{showMappingEditor ? "▼" : "▶"}</span>
          <span style={{ fontWeight: 500 }}>WC-Maaş Eşleştirme</span>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            ({Object.keys(policy?.wcSalaryMapping || {}).length} kalem)
          </span>
          {canEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); handleAutoSuggest(); }}
              style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, border: "1px solid var(--color-border-info)", background: "transparent", color: "var(--color-text-info)", fontSize: 11, cursor: "pointer" }}
            >
              🔄 Otomatik tahmin
            </button>
          )}
        </div>
        {showMappingEditor && (
          <div style={{ marginTop: 8 }}>
            {!monthData ? (
              <div style={{ padding: 12, fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "center" }}>
                Önce bir ay seç (aşağıdan) — kalemleri görmek için.
              </div>
            ) : (
              <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px 1fr 40px", padding: "6px 10px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, gap: 8 }}>
                  <span>Kod</span>
                  <span>Hizmet Adı</span>
                  <span style={{ textAlign: "right" }}>Tutar</span>
                  <span>Hangi WC'lere?</span>
                  <span></span>
                </div>
                {(monthData.items || []).map(it => {
                  const code = String(it.id || it.code || "");
                  const mapped = policy?.wcSalaryMapping?.[code] || [];
                  return (
                    <div key={code} style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px 1fr 40px", padding: "5px 10px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{code}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.category}>{it.category}</span>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(it.amount)}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                        {wcEntries.map(([wcCode, wc]) => {
                          const isSelected = mapped.includes(wcCode);
                          return (
                            <button
                              key={wcCode}
                              onClick={() => {
                                if (!canEdit) return;
                                const next = isSelected ? mapped.filter(c => c !== wcCode) : [...mapped, wcCode];
                                if (next.length === 0) removeMapping(code);
                                else updateMapping(code, next);
                              }}
                              disabled={!canEdit}
                              style={{
                                padding: "2px 6px", fontSize: 9, borderRadius: 3,
                                border: "1px solid " + (isSelected ? "#1D9E75" : "var(--color-border-secondary)"),
                                background: isSelected ? "#ECFDF5" : "transparent",
                                color: isSelected ? "#065F46" : "var(--color-text-tertiary)",
                                fontWeight: isSelected ? 600 : 400,
                                cursor: canEdit ? "pointer" : "default",
                              }}
                            >
                              {wc.name || wcCode}
                            </button>
                          );
                        })}
                        {mapped.length === 0 && <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>genel havuz</span>}
                      </div>
                      {canEdit && mapped.length > 0 && (
                        <button onClick={() => removeMapping(code)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-tertiary)" }} title="Eşleştirmeyi temizle">✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 10, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
              WC seçilmemiş kalemler genel havuza dahil olur. Seçilen kalemler o WC'nin tezgahlarına eşit dağıtılır.
            </div>
          </div>
        )}
      </div>

      {/* Ay seçici + Hesap */}
      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Hesap ayı:</label>
          {monthsAvailable.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Henüz aylık gider verisi yok</span>
          ) : (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
            >
              {monthsAvailable.map(m => <option key={m} value={m}>{monthLabel(m)} ({m}) · {fmt2(monthlyOverheads[m]?.totalTl)} ₺</option>)}
            </select>
          )}
        </div>

        {calc && monthData ? (
          <DistributionResult calc={calc} fmt2={fmt2} fmt4={fmt4} />
        ) : (
          <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12, border: "1px dashed var(--color-border-tertiary)", borderRadius: 6 }}>
            {!monthData ? "Bu ay için gider verisi yok" : "Hesap hazırlanıyor..."}
          </div>
        )}
      </div>
    </div>
  );
}

function DistributionResult({ calc, fmt2, fmt4 }) {
  const { machines, machinePay, summary } = calc;
  if (summary.error) {
    return <div style={{ padding: 20, color: "#DC2626", fontSize: 12, textAlign: "center" }}>{summary.error}</div>;
  }
  const utilColor = (rate) => rate > 50 ? "#DC2626" : rate > 25 ? "#F59E0B" : rate > 5 ? "#10B981" : "var(--color-text-tertiary)";

  // WC bazında grupla
  const byWc = {};
  machines.forEach(m => {
    if (!byWc[m.wcCode]) byWc[m.wcCode] = { name: m.wcName, machines: [] };
    byWc[m.wcCode].machines.push(m);
  });
  const wcCodes = Object.keys(byWc).sort((a, b) => (byWc[a].name || a).localeCompare(byWc[b].name || b));

  return (
    <div>
      {/* Hesap özeti */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "8px 12px", background: "var(--color-background-secondary)", borderRadius: 6, marginBottom: 10, flexWrap: "wrap", fontSize: 11 }}>
        <span>Ay toplamı: <b>{fmt2(summary.monthlyTotal)} ₺</b></span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span>WC-maaş: <b>{fmt2(summary.wcSalaryTotal)} ₺</b></span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span>Genel havuz: <b>{fmt2(summary.generalPool)} ₺</b></span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span title="Aylık çalışılan dakika = iş günü × shiftHours × 60 × verimlilik">Çalışılan dk/ay: <b>{fmt2(summary.minutesPerMonth)}</b></span>
        <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span>{summary.totals.machineCount} tezgah</span>
        {summary.operatorDirectTotal > 0 && (
          <>
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
            <span>Meta operatör (direkt): <b>{fmt2(summary.operatorDirectTotal)} ₺</b></span>
          </>
        )}
      </div>

      {summary.wcSalaryUnmapped?.length > 0 && (
        <div style={{ padding: "6px 12px", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 5, marginBottom: 10, fontSize: 11, color: "#92400E" }}>
          ⚠ {summary.wcSalaryUnmapped.length} kalem: WC-mapping yapılmış ama o WC'lerde tezgah yok — dağıtılmadı (kayıp). Mapping'i kontrol et.
        </div>
      )}

      {/* Tezgah tablosu — WC bazında gruplanmış */}
      <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 100px 100px 100px 100px 110px 110px", padding: "6px 10px", background: "var(--color-background-secondary)", fontSize: 9, fontWeight: 500, color: "var(--color-text-secondary)", gap: 6 }}>
          <span>Tezgah</span>
          <span style={{ textAlign: "right" }}>WC Maaş</span>
          <span style={{ textAlign: "right" }}>Satın Alma</span>
          <span style={{ textAlign: "right" }}>Alan</span>
          <span style={{ textAlign: "right" }}>Güç</span>
          <span style={{ textAlign: "right" }}>Eşit</span>
          <span style={{ textAlign: "right" }}>Op. Direkt</span>
          <span style={{ textAlign: "right" }}>Aylık Toplam</span>
          <span style={{ textAlign: "right" }}>TL / dk</span>
        </div>
        {wcCodes.map(wcCode => {
          const wc = byWc[wcCode];
          return (
            <div key={wcCode}>
              <div style={{ padding: "5px 10px", background: "var(--color-background-info-subtle, #EFF6FF)", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 10, fontWeight: 600, color: "var(--color-text-info)" }}>
                {wc.name} <span style={{ fontSize: 9, fontWeight: 400, color: "var(--color-text-tertiary)" }}>({wc.machines.length} tezgah)</span>
              </div>
              {wc.machines.map(m => {
                const p = machinePay[m.id];
                return (
                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 100px 100px 100px 100px 110px 110px", padding: "4px 10px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 10, gap: 6, alignItems: "center" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.name}{m.isVirtual && <span style={{ marginLeft: 5, fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "#FEF3C7", color: "#92400E" }}>YRD</span>}
                    </span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.wcSalaryPay)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.satinAlmaPay)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.alanPay)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.kuruluKwPay)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.operatorPay)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(p.operatorDirect)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt2(p.total)}</span>
                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: utilColor(p.ratePerMin) }}>{fmt4(p.ratePerMin)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: "var(--color-text-tertiary)", display: "flex", justifyContent: "space-between" }}>
        <span>Dağıtım toplamı: {fmt2(summary.totalDistributed)} ₺ · Kaynak ay+meta: {fmt2(summary.totalSourceMonth)} ₺</span>
        <span>Fark: {fmt2(Math.abs(summary.totalDistributed - summary.totalSourceMonth))} ₺</span>
      </div>
    </div>
  );
}
