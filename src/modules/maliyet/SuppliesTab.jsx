import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  subscribeLaborCosts, saveMonthlySuppliesBulk, deleteMonthlySupplies,
  subscribeOverheadPolicy, saveOverheadPolicy,
} from "./firestore";
import { parseSuppliesExcel } from "./suppliesParser";
import { getSupplyMonthlyAvg, DEFAULT_WEIGHTS } from "./distributionCalc";

const WINDOW_OPTIONS = [3, 6, 12];
const DEFAULT_WINDOW = 6;

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m) - 1]} ${y}`;
};
const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export default function SuppliesTab({ canEdit, isAdmin }) {
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [loaded, setLoaded] = useState({ labor: false, pol: false });
  const [excelPreview, setExcelPreview] = useState(null);
  const [excelSaving, setExcelSaving] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [expandedMonth, setExpandedMonth] = useState(null);
  const [savingWindow, setSavingWindow] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeLaborCosts((data) => {
      setLaborData(data || {});
      setLoaded(p => ({ ...p, labor: true }));
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = subscribeOverheadPolicy((d) => {
      setPolicy(!d || Object.keys(d).length === 0 ? { weights: { ...DEFAULT_WEIGHTS }, wcSalaryMapping: {}, supplyAvgWindowMonths: DEFAULT_WINDOW } : d);
      setLoaded(p => ({ ...p, pol: true }));
    });
    return unsub;
  }, []);

  const allLoaded = loaded.labor && loaded.pol;
  const windowMonths = Number(policy?.supplyAvgWindowMonths) || DEFAULT_WINDOW;

  const monthlySupplies = laborData?.monthlySupplies || {};
  const monthsList = useMemo(() => Object.keys(monthlySupplies).sort().reverse(), [monthlySupplies]);

  // Hareketli ortalama — distributionCalc'taki helper aynısı, dağıtımda kullanılacak değer
  const movingAvg = useMemo(() => getSupplyMonthlyAvg(monthlySupplies, windowMonths), [monthlySupplies, windowMonths]);

  const totals = useMemo(() => {
    const list = monthsList.map(ym => monthlySupplies[ym]);
    const totalTl = list.reduce((s, m) => s + (m?.totalTl || 0), 0);
    const totalItems = list.reduce((s, m) => s + (m?.itemCount || 0), 0);
    const months = list.length;
    return { months, totalTl, totalItems };
  }, [monthsList, monthlySupplies]);

  const handleWindowChange = async (newWindow) => {
    if (!canEdit || newWindow === windowMonths) return;
    setSavingWindow(true);
    try {
      const updated = { ...policy, supplyAvgWindowMonths: newWindow };
      await saveOverheadPolicy(updated, { canEdit });
    } catch (err) {
      alert("Pencere kaydı hatası: " + err.message);
    } finally {
      setSavingWindow(false);
    }
  };

  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parseSuppliesExcel(wb, selectedYear);
      setExcelPreview(result);
    } catch (err) {
      alert("Excel okuma hatası: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  const handleSaveExcel = async () => {
    if (!excelPreview || !canEdit) return;
    setExcelSaving(true);
    try {
      const importedAt = new Date().toISOString();
      const currentMonth = todayMonth();
      const updates = {};
      const skipped = [];
      for (const [ym, m] of Object.entries(excelPreview.months)) {
        if (ym >= currentMonth) {
          // Bugünün ayı ve sonrası atlanır — kısmi/eksik veri
          skipped.push(ym);
          continue;
        }
        updates[ym] = {
          source: "manual-excel",
          receivedAt: importedAt,
          year: Number(ym.split("-")[0]),
          items: m.items,
          totalTl: m.totalTl,
          itemCount: m.itemCount,
        };
      }
      if (Object.keys(updates).length === 0) {
        alert("Kaydedilecek tam ay yok — tüm aylar henüz bitmemiş.");
        return;
      }
      await saveMonthlySuppliesBulk(updates, { canEdit });
      const msg = `✓ ${Object.keys(updates).length} ay kaydedildi`
        + (skipped.length > 0 ? `\n⏸ Atlandı (mevcut/gelecek ay): ${skipped.join(", ")}` : "");
      alert(msg);
      setExcelPreview(null);
    } catch (err) {
      alert("Kayıt hatası: " + err.message);
    } finally {
      setExcelSaving(false);
    }
  };

  const handleDelete = async (ym) => {
    if (!isAdmin) return;
    if (!confirm(`${monthLabel(ym)} sarf verisi silinsin mi?`)) return;
    try {
      await deleteMonthlySupplies(ym, { canEdit, isAdmin });
    } catch (err) {
      alert("Silme hatası: " + err.message);
    }
  };

  if (!allLoaded) return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 12, padding: "8px 12px", background: "var(--color-background-secondary)", borderRadius: 6 }}>
        💡 VIO Stok Alım Hareketleri (Stok grupları 001/033/041) — kesici takım, kesme yağı, sarf malzeme, PPE.
        Aylık toplam (Ciro Bedeli) "Talaşlı İmalat" WC grubuna dağıtılır (sonraki adım: MachineRatesTab dağıtım politikası).
      </div>

      {/* Excel yükleme + Yıl seçici */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Yıl:</label>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
        >
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Excel'de yıl bilgisi yok, seçili yıla göre kaydedilir</span>
        {canEdit && (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid #2563EB", background: "#2563EB", color: "white", fontWeight: 500, fontSize: 12, cursor: "pointer" }}
          >
            📥 Excel Yükle
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleExcelFile} style={{ display: "none" }} />
      </div>

      {/* Preview (yükleme sonrası onay) */}
      {excelPreview && (
        <div style={{ padding: 14, marginBottom: 16, background: "#EFF6FF", border: "1px solid #2563EB", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: "#1E40AF" }}>📋 Önizleme: {excelPreview.monthsList.length} ay tespit edildi</span>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{excelPreview.totalItems} kalem · {fmt2(excelPreview.grandTotalTl)} TL</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {excelPreview.monthsList.map(ym => {
              const m = excelPreview.months[ym];
              const isCurrentOrFuture = ym >= todayMonth();
              return (
                <span
                  key={ym}
                  style={{
                    padding: "4px 10px", borderRadius: 4, fontSize: 11,
                    background: isCurrentOrFuture ? "#FEF3C7" : "white",
                    border: "1px solid " + (isCurrentOrFuture ? "#FCD34D" : "#93C5FD"),
                    color: isCurrentOrFuture ? "#92400E" : "#1E40AF",
                  }}
                  title={isCurrentOrFuture ? "Bugünün ayı veya sonrası — kısmi veri, atlanacak" : ""}
                >
                  {monthLabel(ym)}: {fmt0(m.totalTl)} TL ({m.itemCount} kalem) {isCurrentOrFuture && "⏸"}
                </span>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setExcelPreview(null)} style={{ padding: "5px 12px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 12, cursor: "pointer" }}>İptal</button>
            <button
              onClick={handleSaveExcel}
              disabled={excelSaving || !canEdit}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontWeight: 500, fontSize: 12, cursor: excelSaving ? "default" : "pointer" }}
            >
              {excelSaving ? "Kaydediliyor..." : "✓ Tamam Ayları Kaydet"}
            </button>
          </div>
        </div>
      )}

      {/* Özet + hareketli ortalama window seçici */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "stretch" }}>
        <KPI label="Yüklü ay" value={totals.months} sub="Tam aylar (kısmi atlanır)" />
        <KPI label="Toplam sarf TL" value={fmt2(totals.totalTl) + " ₺"} sub={`${totals.totalItems} kalem`} />
        <div style={{ padding: "8px 14px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 6, minWidth: 240, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 10, color: "#166534", fontWeight: 600 }}>
            🎯 Maliyet dağıtımında kullanılacak değer
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#166534" }}>
            {fmt2(movingAvg.avgTl)} ₺/ay
          </div>
          <div style={{ fontSize: 9, color: "#166534", marginBottom: 4 }}>
            Son {movingAvg.monthsUsed} ay ortalaması · {movingAvg.monthsList.length > 0 ? `${monthLabel(movingAvg.monthsList[0])} – ${monthLabel(movingAvg.monthsList[movingAvg.monthsList.length - 1])}` : "veri yok"}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <span style={{ fontSize: 9, color: "#166534", alignSelf: "center", marginRight: 4 }}>Pencere:</span>
            {WINDOW_OPTIONS.map(n => {
              const active = windowMonths === n;
              return (
                <button
                  key={n}
                  onClick={() => handleWindowChange(n)}
                  disabled={!canEdit || savingWindow}
                  style={{
                    padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: active ? 600 : 500,
                    border: "1px solid " + (active ? "#16A34A" : "#86EFAC"),
                    background: active ? "#16A34A" : "white",
                    color: active ? "white" : "#166534",
                    cursor: canEdit ? "pointer" : "default",
                  }}
                >
                  {n} ay
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Aylar listesi */}
      {monthsList.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8, fontSize: 12 }}>
          Henüz sarf verisi yüklenmedi. Yukarıdan Excel yükle.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 120px 120px 40px", padding: "6px 12px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
            <span>Ay</span>
            <span>Kaynak</span>
            <span style={{ textAlign: "right" }}>Kalem</span>
            <span style={{ textAlign: "right" }}>Toplam TL</span>
            <span></span>
          </div>
          {monthsList.map(ym => {
            const m = monthlySupplies[ym];
            const isExpanded = expandedMonth === ym;
            return (
              <div key={ym}>
                <div
                  onClick={() => setExpandedMonth(isExpanded ? null : ym)}
                  style={{ display: "grid", gridTemplateColumns: "120px 1fr 120px 120px 40px", padding: "6px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center", cursor: "pointer", background: isExpanded ? "var(--color-background-info-subtle, #EFF6FF)" : "transparent" }}
                >
                  <span style={{ fontWeight: 500 }}>{isExpanded ? "▼" : "▶"} {monthLabel(ym)}</span>
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                    {m?.source === "manual-excel" ? "📄 Excel" : m?.source === "vio-mail" ? "📧 Mail" : m?.source || "—"} · {m?.receivedAt ? new Date(m.receivedAt).toLocaleDateString("tr-TR") : ""}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{m?.itemCount || 0}</span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt2(m?.totalTl || 0)}</span>
                  {isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(ym); }}
                      title="Sil (admin)"
                      style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-text-tertiary)", padding: 0 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div style={{ background: "var(--color-background-primary)", padding: "8px 16px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 70px 110px 90px", padding: "4px 0", fontSize: 9, fontWeight: 500, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-tertiary)", gap: 6 }}>
                      <span>Stok Kodu</span>
                      <span>Stok Adı</span>
                      <span style={{ textAlign: "right" }}>Kg</span>
                      <span style={{ textAlign: "right" }}>Ciro Bedeli</span>
                      <span style={{ textAlign: "right" }}>Birim TL</span>
                    </div>
                    {(m?.items || []).slice(0, 100).map((it, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 70px 110px 90px", padding: "3px 0", fontSize: 10, gap: 6, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                        <span style={{ fontFamily: "var(--font-mono)" }}>{it.code}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.name}>{it.name}</span>
                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{it.kg > 0 ? fmt2(it.kg) : "—"}</span>
                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt2(it.amountTl)}</span>
                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{it.unitCost > 0 ? fmt2(it.unitCost) : "—"}</span>
                      </div>
                    ))}
                    {(m?.items?.length || 0) > 100 && (
                      <div style={{ padding: "6px 0", fontSize: 10, color: "var(--color-text-tertiary)", textAlign: "center" }}>
                        + {m.items.length - 100} satır daha
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, sub }) {
  return (
    <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", borderRadius: 6, minWidth: 140 }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{sub}</div>}
    </div>
  );
}
