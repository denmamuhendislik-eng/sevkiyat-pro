import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { subscribeLaborCosts, saveMonthlyOverhead, deleteMonthlyOverhead, saveMonthlyOverheadsBulk, subscribeCategoryMappings, saveCategoryMappings } from "./firestore";
import { parseOverheadExcel } from "./overheadParser";
import { guessWeightKey } from "./categoryMapper";

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
  // Excel preview state
  const [excelPreview, setExcelPreview] = useState(null);   // parser çıktısı + override draft
  const [excelSaving, setExcelSaving] = useState(false);
  const [savedCategoryMappings, setSavedCategoryMappings] = useState({});
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeLaborCosts((data) => {
      setLaborData(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeCategoryMappings((data) => {
      setSavedCategoryMappings(data?.mappings || {});
    });
    return unsub;
  }, []);

  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = parseOverheadExcel(wb);
      // Her satır için weightKey tahmin et
      const enriched = {};
      for (const [ym, m] of Object.entries(result.byMonth)) {
        enriched[ym] = {
          ...m,
          items: m.items.map(it => {
            const g = guessWeightKey(it.code, it.name, savedCategoryMappings);
            return { ...it, weightKey: g.weightKey, weightSource: g.source };
          }),
        };
      }
      setExcelPreview({ ...result, byMonth: enriched, overrides: {} });
    } catch (err) {
      alert("Excel okuma hatası: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  const updatePreviewItemWeight = (ym, code, newWeightKey) => {
    setExcelPreview(prev => ({
      ...prev,
      byMonth: {
        ...prev.byMonth,
        [ym]: {
          ...prev.byMonth[ym],
          items: prev.byMonth[ym].items.map(it =>
            it.code === code ? { ...it, weightKey: newWeightKey, weightSource: "override" } : it
          ),
        },
      },
      overrides: { ...prev.overrides, [code]: newWeightKey },
    }));
  };

  const handleSaveExcel = async () => {
    if (!excelPreview || !canEdit) return;
    setExcelSaving(true);
    try {
      const importedAt = new Date().toISOString();
      const updates = {};
      const newMappings = { ...savedCategoryMappings };
      for (const [ym, m] of Object.entries(excelPreview.byMonth)) {
        // Aynı kod birden fazla satırda olabilir aynı ayda? Olabilir (örnek dataset aynı kodlar farklı satırlarda) — bunları birleştir
        const merged = {};
        for (const it of m.items) {
          const key = it.code;
          if (!merged[key]) {
            merged[key] = {
              id: it.code,            // kod = id (aynı kod birleştirilirse stabil id)
              category: it.name,
              amount: 0,
              weightKey: it.weightKey,
            };
          }
          merged[key].amount += Number(it.amount) || 0;
          // Aynı koda farklı weightKey atanmışsa sonuncuyu al
          merged[key].weightKey = it.weightKey;
        }
        const cleanedItems = Object.values(merged).filter(it => it.amount > 0);
        const totalTl = cleanedItems.reduce((s, it) => s + it.amount, 0);
        updates[ym] = {
          source: "vio-mail-excel",
          receivedAt: importedAt,
          items: cleanedItems,
          totalTl,
        };
        // Kategori mapping'ler (override edilmiş veya guess edilmiş kalanlar — saklayalım)
        for (const it of cleanedItems) {
          newMappings[it.id] = it.weightKey;
        }
      }
      await saveMonthlyOverheadsBulk(updates, { canEdit });
      // Mapping'leri kaydet — sonraki yüklemelerde otomatik atansın
      await saveCategoryMappings(newMappings, { canEdit });
      alert(`✓ Kayıt tamam:\n${Object.keys(updates).length} ay yazıldı\n${Object.values(updates).reduce((s, m) => s + m.items.length, 0)} kategori-ay kaydı`);
      setExcelPreview(null);
    } catch (err) {
      alert("Kaydetme hatası: " + err.message);
    } finally {
      setExcelSaving(false);
    }
  };

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

  // Son içe alım durumu — monthlyOverheads içindeki en geç receivedAt'ten hesaplanır
  // (useMemo erken return'den ÖNCE — React Hooks rule)
  const automationStatus = useMemo(() => {
    const mo = laborData?.monthlyOverheads || {};
    let lastReceivedAt = null;
    let monthCount = 0;
    let lastSource = "";
    let lastMonth = "";
    for (const [ym, data] of Object.entries(mo)) {
      monthCount++;
      if (data?.receivedAt && (!lastReceivedAt || data.receivedAt > lastReceivedAt)) {
        lastReceivedAt = data.receivedAt;
        lastSource = data.source || "";
        lastMonth = ym;
      }
    }
    if (!lastReceivedAt) return { state: "none", monthCount };
    const ageDays = (Date.now() - new Date(lastReceivedAt).getTime()) / 86400000;
    let state;
    if (ageDays <= 35) state = "ok";
    else if (ageDays <= 45) state = "warn";
    else state = "stale";
    return { state, ageDays, lastReceivedAt, monthCount, lastSource, lastMonth };
  }, [laborData]);

  if (!loaded) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;
  }

  const currentMonthData = laborData?.monthlyOverheads?.[selectedMonth];
  const sourceTag = currentMonthData?.source;

  return (
    <div>
      {/* Otomasyon durum rozetı */}
      <OverheadAutomationBadge status={automationStatus} />

      {/* Excel yükleme bandı (manuel yedek) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap", padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>VIO Hizmet Total Raporu:</span>
        {canEdit && (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--color-border-info)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            📤 Excel yükle
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleExcelFile}
        />
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          Otomatik akış: VIO her ayın 10. günü maille gönderir → bir önceki ayın gider verisi otomatik yüklenir.
        </span>
      </div>

      {/* Excel önizleme paneli — yüklenmişse */}
      {excelPreview && (
        <OverheadPreviewPanel
          preview={excelPreview}
          onUpdateWeight={updatePreviewItemWeight}
          onSave={handleSaveExcel}
          onCancel={() => setExcelPreview(null)}
          saving={excelSaving}
          canEdit={canEdit}
        />
      )}

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

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function OverheadAutomationBadge({ status }) {
  if (status.state === "none") {
    return (
      <div style={{ marginBottom: 12, padding: "8px 14px", background: "var(--color-background-secondary)", border: "1px dashed var(--color-border-secondary)", borderRadius: 6, fontSize: 12, color: "var(--color-text-tertiary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span>📧</span>
        <span>Henüz Hizmet Total Raporu yüklenmedi. VIO ayda 1 mail göndermesi bekleniyor (ayın 10'u).</span>
      </div>
    );
  }
  const ageDays = Math.floor(status.ageDays);
  const ageLabel = ageDays === 0 ? "bugün" : ageDays === 1 ? "1 gün önce" : `${ageDays} gün önce`;
  const dateStr = new Date(status.lastReceivedAt).toLocaleDateString("tr-TR");
  const sourceLbl = status.lastSource === "vio-mail" ? "VIO mail" : status.lastSource === "vio-mail-excel" ? "Excel yükleme" : status.lastSource === "manual" ? "Manuel" : status.lastSource;
  let bg, border, color, icon, label;
  if (status.state === "ok") {
    bg = "#F0FDF4"; border = "#86EFAC"; color = "#166534"; icon = "✓";
    label = `Son içe alım: ${ageLabel} (${dateStr}) · ${status.monthCount} ay verisi · ${sourceLbl}`;
  } else if (status.state === "warn") {
    bg = "#FFFBEB"; border = "#FCD34D"; color = "#92400E"; icon = "⚠";
    label = `Son içe alım: ${ageLabel} (${dateStr}) — mail biraz gecikmiş, kontrol et`;
  } else {
    bg = "#FEF2F2"; border = "#FCA5A5"; color = "#B91C1C"; icon = "❌";
    label = `Son içe alım: ${ageLabel} (${dateStr}) — uzun süredir Hizmet Total Raporu maili gelmiyor, VIO'yu kontrol et!`;
  }
  return (
    <div title={`Son güncelleme: ${new Date(status.lastReceivedAt).toLocaleString("tr-TR")}\nKaynak: ${sourceLbl}\nVerilen ay: ${status.lastMonth}\nVeri kapsamı: ${status.monthCount} ay`}
      style={{ marginBottom: 12, padding: "8px 14px", background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 12, color, display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 500 }}
    >
      <span>{icon}</span>
      <span>📧 {label}</span>
    </div>
  );
}

function OverheadPreviewPanel({ preview, onUpdateWeight, onSave, onCancel, saving, canEdit }) {
  const months = preview.monthsList || [];
  const [showAll, setShowAll] = useState(false);
  const [selectedMonth, setSelMonth] = useState(months[0]);
  const monthData = preview.byMonth[selectedMonth] || { items: [], totalBorc: 0 };
  const overrideCount = Object.keys(preview.overrides || {}).length;

  // Tüm aylardaki tüm öğeleri toplu olarak göster (aynı kod ay bazında merge edilmedi henüz)
  return (
    <div style={{ border: "2px solid var(--color-border-info)", borderRadius: 8, padding: 14, marginBottom: 16, background: "var(--color-background-info-subtle, #EFF6FF)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-info)" }}>📋 Genel Gider Önizlemesi</span>
        <span style={{ fontSize: 11 }}>
          Yıl: <b>{preview.year}</b> · {months.length} ay · <b>{preview.itemCount}</b> kalem · <b>{preview.uniqueCodeCount}</b> benzersiz kod
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Genel toplam: {fmt(preview.grandTotal)} ₺</span>
        {overrideCount > 0 && (
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#FEF3C7", color: "#92400E" }}>{overrideCount} kriter override</span>
        )}
        <button onClick={onCancel} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, cursor: "pointer" }}>İptal</button>
        {canEdit && (
          <button
            onClick={onSave}
            disabled={saving}
            style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontWeight: 500, fontSize: 12, cursor: saving ? "default" : "pointer" }}
          >
            {saving ? "Kaydediliyor..." : "✓ Onayla & Kaydet"}
          </button>
        )}
      </div>

      {/* Ay tabları */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {months.map(m => (
          <button
            key={m}
            onClick={() => setSelMonth(m)}
            style={{
              padding: "4px 12px", borderRadius: 5, border: "1px solid",
              borderColor: m === selectedMonth ? "var(--color-text-info)" : "var(--color-border-secondary)",
              background: m === selectedMonth ? "var(--color-background-info)" : "transparent",
              color: m === selectedMonth ? "var(--color-text-info)" : "var(--color-text-secondary)",
              fontSize: 11, fontWeight: m === selectedMonth ? 600 : 400, cursor: "pointer"
            }}
          >
            {m} · {fmt(preview.byMonth[m]?.totalBorc || 0)} ₺
          </button>
        ))}
      </div>

      {/* Seçili ay tablosu */}
      <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 6, overflow: "hidden", background: "var(--color-background-primary)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 200px 70px", padding: "6px 12px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
          <span>Hizmet Kodu</span>
          <span>Hizmet Adı</span>
          <span style={{ textAlign: "right" }}>Borç (₺)</span>
          <span>Dağıtım Kriteri</span>
          <span style={{ textAlign: "center" }}>Kaynak</span>
        </div>
        <div style={{ maxHeight: showAll ? "none" : 400, overflowY: "auto" }}>
          {monthData.items.map((it, i) => (
            <div key={`${it.code}-${i}`} style={{ display: "grid", gridTemplateColumns: "100px 1fr 130px 200px 70px", padding: "5px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", alignItems: "center", fontSize: 11, gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{it.code}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{fmt(it.amount)}</span>
              <select
                value={it.weightKey}
                onChange={e => onUpdateWeight(selectedMonth, it.code, e.target.value)}
                disabled={!canEdit}
                style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", fontSize: 10, background: it.weightSource === "override" ? "#FEF3C7" : it.weightSource === "saved" ? "#ECFDF5" : "var(--color-background-primary)" }}
              >
                <option value="area">📐 Alan</option>
                <option value="power">⚡ Güç</option>
                <option value="amortization">🏭 Amortisman</option>
                <option value="machineCount">🟰 Eşit</option>
              </select>
              <span style={{ textAlign: "center", fontSize: 9, color: "var(--color-text-tertiary)" }}>
                {it.weightSource === "saved" ? "✓ Hatırlandı" : it.weightSource === "guess" ? "Tahmin" : it.weightSource === "override" ? "Düzelt" : "Default"}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: "5px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)", fontSize: 11, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
          <span>{selectedMonth} ay toplamı</span>
          <span>{fmt(monthData.totalBorc)} ₺</span>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--color-text-tertiary)" }}>
        ℹ Kategori-kriter atamaları (override veya tahmin) kaydedilir → sonraki ay raporunda aynı kod için otomatik atanır. Tahminler: 📐 bina/su/doğalgaz/kira · ⚡ elektrik · 🏭 makine/bakım · 🟰 diğerleri.
      </div>
    </div>
  );
}
