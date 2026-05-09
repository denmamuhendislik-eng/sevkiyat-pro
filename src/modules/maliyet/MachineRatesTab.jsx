import { useState, useEffect, useMemo } from "react";
import { subscribeWorkCenters, saveMachinesForWc } from "./firestore";

const META_FIELDS = [
  { key: "satinAlmaTl", label: "Satın Alma (₺)", placeholder: "0", icon: "🏭", hint: "Tezgah satın alma değeri — amortisman hesabı için" },
  { key: "alanM2", label: "Alan (m²)", placeholder: "0", icon: "📐", hint: "Tezgahın kapladığı alan — kira/ısıtma payı için" },
  { key: "kuruluKw", label: "Kurulu Güç (kW)", placeholder: "0", icon: "⚡", hint: "Tezgahın kurulu elektrik gücü — elektrik payı için" },
  { key: "operatorAylikTl", label: "Operatör Aylık (₺)", placeholder: "0", icon: "👤", hint: "Tezgaha sabit atanmış operatör ücreti (varsa)" },
  { key: "amortismanYil", label: "Amortisman (yıl)", placeholder: "10", icon: "📅", hint: "Amortisman süresi — varsayılan 10 yıl" },
];

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

export default function MachineRatesTab({ canEdit }) {
  const [workCenters, setWorkCenters] = useState({});
  const [loaded, setLoaded] = useState(false);
  // Local draft: { [wcCode]: { dirty: bool, machines: [...] } }
  const [drafts, setDrafts] = useState({});
  const [savingWc, setSavingWc] = useState(null);

  useEffect(() => {
    const unsub = subscribeWorkCenters((data) => {
      setWorkCenters(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);

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

      {/* Hesaplanmış dakika ücretleri — placeholder (Adım 4) */}
      <div style={{ marginTop: 20, padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>⚙️</div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Hesaplanmış Tezgah Dakika Ücretleri</div>
        <div style={{ fontSize: 11 }}>Aylık genel gider verisi + tezgah meta verileri tamamlanınca dağıtım algoritması burada hesaplayacak (Adım 4)</div>
      </div>

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
