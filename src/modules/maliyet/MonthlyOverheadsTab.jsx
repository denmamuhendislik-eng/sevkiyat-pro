import { useState, useEffect, useMemo } from "react";
import { subscribeLaborCosts, saveMonthlyOverhead, deleteMonthlyOverhead } from "./firestore";

const WEIGHT_OPTIONS = [
  { value: "area", label: "Alan (m²)", icon: "📐", hint: "Kira, aydınlatma, ısıtma — alana orantılı" },
  { value: "power", label: "Kurulu güç (kW)", icon: "⚡", hint: "Elektrik — makine bazlı enerji" },
  { value: "amortization", label: "Amortisman", icon: "🏭", hint: "Tezgahın satın alma değerine orantılı" },
  { value: "machineCount", label: "Eşit", icon: "🟰", hint: "Tüm tezgahlara eşit pay (genel personel, sigorta)" },
];

const todayMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m) - 1]} ${y}`;
};

export default function MonthlyOverheadsTab({ canEdit, isAdmin }) {
  const [laborData, setLaborData] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(todayMonth());
  const [draftItems, setDraftItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeLaborCosts((data) => {
      setLaborData(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);

  // Seçilen ay değiştiğinde / firestore'dan veri gelince draft'ı senkronize et (dirty değilse)
  useEffect(() => {
    if (dirty) return;
    const monthData = laborData?.monthlyOverheads?.[selectedMonth];
    setDraftItems(monthData?.items ? monthData.items.map(it => ({ ...it })) : []);
  }, [selectedMonth, laborData, dirty]);

  const total = useMemo(() =>
    draftItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  , [draftItems]);

  const monthsList = useMemo(() => {
    const set = new Set([selectedMonth, todayMonth()]);
    if (laborData?.monthlyOverheads) Object.keys(laborData.monthlyOverheads).forEach(m => set.add(m));
    return [...set].sort().reverse();
  }, [laborData, selectedMonth]);

  const addItem = () => {
    setDraftItems(prev => [...prev, {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      category: "",
      amount: 0,
      weightKey: "machineCount"
    }]);
    setDirty(true);
  };

  const updateItem = (id, patch) => {
    setDraftItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
    setDirty(true);
  };

  const removeItem = (id) => {
    setDraftItems(prev => prev.filter(it => it.id !== id));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const cleaned = draftItems
        .filter(it => (it.category || "").trim() && Number(it.amount) > 0)
        .map(it => ({
          id: it.id,
          category: it.category.trim(),
          amount: Number(it.amount),
          weightKey: it.weightKey || "machineCount"
        }));
      const monthData = laborData?.monthlyOverheads?.[selectedMonth];
      await saveMonthlyOverhead(selectedMonth, {
        source: monthData?.source === "vio-mail" ? "vio-mail-edited" : "manual",
        receivedAt: new Date().toISOString(),
        items: cleaned,
        totalTl: cleaned.reduce((s, it) => s + it.amount, 0),
      }, { canEdit });
      setDirty(false);
    } catch (e) {
      alert("Kaydetme hatası: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const monthData = laborData?.monthlyOverheads?.[selectedMonth];
    setDraftItems(monthData?.items ? monthData.items.map(it => ({ ...it })) : []);
    setDirty(false);
  };

  const handleDelete = async () => {
    if (!isAdmin) return;
    if (!confirm(`${monthLabel(selectedMonth)} ayının tüm gider verilerini silmek istediğine emin misin?`)) return;
    try {
      await deleteMonthlyOverhead(selectedMonth, { canEdit, isAdmin });
      setDraftItems([]);
      setDirty(false);
    } catch (e) {
      alert("Silme hatası: " + e.message);
    }
  };

  if (!loaded) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;
  }

  const currentMonthData = laborData?.monthlyOverheads?.[selectedMonth];
  const sourceTag = currentMonthData?.source;

  return (
    <div>
      {/* Üst bant */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Ay:</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={e => e.target.value && setSelectedMonth(e.target.value)}
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
        />
        {monthsList.length > 1 && (
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", fontSize: 12 }}
          >
            {monthsList.map(m => <option key={m} value={m}>{monthLabel(m)} ({m})</option>)}
          </select>
        )}
        {sourceTag === "manual" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)" }}>Manuel</span>}
        {sourceTag === "vio-mail" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#ECFDF5", color: "#065F46" }}>📧 VIO mail</span>}
        {sourceTag === "vio-mail-edited" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#FEF3C7", color: "#92400E" }}>📧 VIO + manuel</span>}

        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600 }}>
          Toplam: {total.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
        </span>

        {canEdit && (
          <>
            {dirty && (
              <button
                onClick={handleReset}
                style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 12 }}
              >
                Geri al
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid " + (dirty ? "#1D9E75" : "var(--color-border-secondary)"), background: dirty ? "#1D9E75" : "transparent", color: dirty ? "white" : "var(--color-text-tertiary)", cursor: dirty ? "pointer" : "default", fontSize: 12, fontWeight: 500 }}
            >
              {saving ? "Kaydediliyor..." : dirty ? "Kaydet" : "Kaydedildi ✓"}
            </button>
          </>
        )}
      </div>

      {/* Tablo */}
      <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 240px 40px", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", gap: 8 }}>
          <span>Kategori</span>
          <span style={{ textAlign: "right" }}>Tutar (₺)</span>
          <span>Dağıtım kriteri</span>
          <span></span>
        </div>
        {draftItems.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
            Bu ay için gider kalemi yok. {canEdit && "Aşağıdan ekleyebilirsiniz."}
          </div>
        ) : draftItems.map(it => (
          <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 240px 40px", gap: 8, padding: "6px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", alignItems: "center", fontSize: 12 }}>
            <input
              value={it.category}
              onChange={e => updateItem(it.id, { category: e.target.value })}
              placeholder="Örn: Kira, Elektrik, Personel..."
              disabled={!canEdit}
              style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid var(--color-border-tertiary)", fontSize: 12, background: canEdit ? "var(--color-background-primary)" : "transparent" }}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={it.amount}
              onChange={e => updateItem(it.id, { amount: e.target.value })}
              disabled={!canEdit}
              style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid var(--color-border-tertiary)", fontSize: 12, textAlign: "right", background: canEdit ? "var(--color-background-primary)" : "transparent" }}
            />
            <select
              value={it.weightKey || "machineCount"}
              onChange={e => updateItem(it.id, { weightKey: e.target.value })}
              disabled={!canEdit}
              title={WEIGHT_OPTIONS.find(o => o.value === (it.weightKey || "machineCount"))?.hint}
              style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid var(--color-border-tertiary)", fontSize: 11, background: canEdit ? "var(--color-background-primary)" : "transparent" }}
            >
              {WEIGHT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>)}
            </select>
            {canEdit && (
              <button
                onClick={() => removeItem(it.id)}
                title="Sil"
                style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, color: "var(--color-text-tertiary)", padding: 4 }}
              >✕</button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <button
            onClick={addItem}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed var(--color-border-info)", background: "transparent", color: "var(--color-text-info)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            + Kategori ekle
          </button>
          {isAdmin && currentMonthData && draftItems.length > 0 && (
            <button
              onClick={handleDelete}
              style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, border: "1px solid #FCA5A5", background: "transparent", color: "#DC2626", cursor: "pointer", fontSize: 11 }}
            >
              Bu ayı sıfırla
            </button>
          )}
        </div>
      )}

      {/* Açıklama */}
      <div style={{ marginTop: 18, padding: "10px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--color-text-info)" }}>Dağıtım kriteri tezgah dakika maliyetini nasıl etkiler?</div>
        {WEIGHT_OPTIONS.map(o => (
          <div key={o.value}>{o.icon} <b>{o.label}</b> — {o.hint}</div>
        ))}
        <div style={{ marginTop: 6, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          Bu kriterler tezgah dakika maliyeti hesabında kullanılır. Tezgahların alan/güç/satın alma değerleri İş Merkezleri tab'ından girilir (sonraki adım).
        </div>
      </div>
    </div>
  );
}
