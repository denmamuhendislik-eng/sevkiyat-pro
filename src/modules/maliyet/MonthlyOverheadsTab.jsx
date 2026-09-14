import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { subscribeLaborCosts, saveMonthlyOverhead, deleteMonthlyOverhead, saveMonthlyOverheadsBulk } from "./firestore";
import { parseOverheadExcel } from "./overheadParser";

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
  const [excelPreview, setExcelPreview] = useState(null);
  const [excelSaving, setExcelSaving] = useState(false);
  const fileInputRef = useRef(null);
  // Accordion ay listesi — SuppliesTab pattern
  const [expandedMonth, setExpandedMonth] = useState(null);

  useEffect(() => {
    const unsub = subscribeLaborCosts((data) => {
      setLaborData(data || {});
      setLoaded(true);
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
      const currentMonth = todayMonth(); // "YYYY-MM" — bugünün ayı (kısmi olabilir)
      const updates = {};
      const skipped = [];
      for (const [ym, m] of Object.entries(excelPreview.byMonth)) {
        // Bugünün ayı ve sonrası atlanır — kısmi/eksik veri
        if (ym >= currentMonth) {
          skipped.push(ym);
          continue;
        }
        const merged = {};
        for (const it of m.items) {
          if (!merged[it.code]) {
            merged[it.code] = { id: it.code, category: it.name, amount: 0 };
          }
          merged[it.code].amount += Number(it.amount) || 0;
        }
        const cleanedItems = Object.values(merged).filter(it => it.amount > 0);
        const totalTl = cleanedItems.reduce((s, it) => s + it.amount, 0);
        updates[ym] = {
          source: "vio-mail-excel",
          receivedAt: importedAt,
          items: cleanedItems,
          totalTl,
        };
      }
      if (Object.keys(updates).length === 0) {
        alert("Kaydedilecek tam ay yok — tüm aylar henüz bitmemiş.");
        setExcelSaving(false);
        return;
      }
      await saveMonthlyOverheadsBulk(updates, { canEdit });
      const skippedMsg = skipped.length > 0 ? `\n\nAtlanan (henüz tamamlanmamış): ${skipped.join(", ")}` : "";
      alert(`✓ Kayıt tamam:\n${Object.keys(updates).length} ay yazıldı\n${Object.values(updates).reduce((s, m) => s + m.items.length, 0)} kategori-ay kaydı${skippedMsg}`);
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

  // Accordion liste için yüklü tüm aylar (sadece kayıt edilenler, descending)
  const loadedMonthsList = useMemo(() => {
    return Object.keys(laborData?.monthlyOverheads || {}).sort().reverse();
  }, [laborData]);

  const addItem = () => {
    setDraftItems(prev => [...prev, {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      category: "",
      amount: 0,
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

  const handleDelete = async (ym = selectedMonth) => {
    if (!isAdmin) return;
    if (!confirm(`${monthLabel(ym)} ayının tüm gider verilerini silmek istediğine emin misin?`)) return;
    try {
      await deleteMonthlyOverhead(ym, { canEdit, isAdmin });
      if (ym === selectedMonth) {
        setDraftItems([]);
        setDirty(false);
      }
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

  // Tüm aylar üzerinden özet (sayım + toplam + aylık ortalama + en pahalı ay + trend)
  // SuppliesTab pattern'iyle tutarlı — kullanıcı sekmeye girer girmez fotoğrafı görür
  const overallSummary = useMemo(() => {
    const mo = laborData?.monthlyOverheads || {};
    const entries = Object.entries(mo).sort((a, b) => a[0].localeCompare(b[0])); // ay artan
    let monthCount = 0, totalTl = 0, totalItems = 0;
    let mostExpensive = { ym: "", totalTl: 0 };
    for (const [ym, data] of entries) {
      monthCount++;
      const t = Number(data?.totalTl || 0);
      totalTl += t;
      totalItems += (data?.items || []).length;
      if (t > mostExpensive.totalTl) mostExpensive = { ym, totalTl: t };
    }
    // Trend (son 3 ay ort. vs önceki 3 ay ort.)
    let trend = null;
    if (entries.length >= 4) {
      const last3 = entries.slice(-3);
      const prev3 = entries.slice(-6, -3);
      if (prev3.length > 0) {
        const lastAvg = last3.reduce((s, [, d]) => s + Number(d?.totalTl || 0), 0) / last3.length;
        const prevAvg = prev3.reduce((s, [, d]) => s + Number(d?.totalTl || 0), 0) / prev3.length;
        if (prevAvg > 0) {
          const pct = ((lastAvg - prevAvg) / prevAvg) * 100;
          trend = { pct, lastAvg, prevAvg, direction: pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat" };
        }
      }
    }
    return {
      monthCount,
      totalTl,
      totalItems,
      avgPerMonth: monthCount > 0 ? totalTl / monthCount : 0,
      mostExpensive: mostExpensive.ym ? mostExpensive : null,
      trend,
    };
  }, [laborData]);

  // Trend etkisi — hangi kategori(ler) son 3 ay ort. vs önceki 3 ay ort. farkını sürüklüyor
  // Aynı normalize (trim + upper tr-TR) — Top 5 ile tutarlı
  const trendImpact = useMemo(() => {
    if (!overallSummary.trend || overallSummary.trend.direction === "flat") return null;
    const mo = laborData?.monthlyOverheads || {};
    const entries = Object.entries(mo).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length < 4) return null;
    const last3 = entries.slice(-3);
    const prev3 = entries.slice(-6, -3);
    if (prev3.length === 0) return null;
    const sumByCat = (list) => {
      const map = new Map(); // key = normalized, val = { display, sum }
      for (const [, data] of list) {
        for (const it of (data?.items || [])) {
          const raw = (it?.category || "").trim();
          if (!raw) continue;
          const key = raw.toLocaleUpperCase("tr-TR");
          const prev = map.get(key) || { display: raw, sum: 0 };
          prev.sum += Number(it.amount) || 0;
          map.set(key, prev);
        }
      }
      return map;
    };
    const lastMap = sumByCat(last3);
    const prevMap = sumByCat(prev3);
    const allKeys = new Set([...lastMap.keys(), ...prevMap.keys()]);
    const impact = [];
    for (const key of allKeys) {
      const l = lastMap.get(key) || { display: prevMap.get(key)?.display || key, sum: 0 };
      const p = prevMap.get(key) || { display: l.display, sum: 0 };
      const lastAvg = l.sum / last3.length;
      const prevAvg = p.sum / prev3.length;
      const delta = lastAvg - prevAvg;
      if (Math.abs(delta) < 1) continue; // gürültü filtresi
      const pct = prevAvg > 0 ? (delta / prevAvg) * 100 : null; // yeni kalem → pct=null
      impact.push({
        category: l.display || p.display || key,
        prevAvg, lastAvg, delta, pct,
        isNew: prevAvg === 0 && lastAvg > 0,
        isDropped: lastAvg === 0 && prevAvg > 0,
      });
    }
    const risers = impact.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
    const fallers = impact.filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);
    return { risers, fallers };
  }, [laborData, overallSummary.trend]);

  // Top 5 gider kalemi — kategori adına göre normalize edilir (trim + upper tr-TR)
  // Sonuç: [{ category, totalTl, avgPerMonth, pct }]
  const topCategories = useMemo(() => {
    const mo = laborData?.monthlyOverheads || {};
    const monthCount = Object.keys(mo).length;
    if (monthCount === 0) return [];
    const grandTotal = Object.values(mo).reduce((s, d) => s + Number(d?.totalTl || 0), 0);
    const byCat = new Map(); // key = normalized, val = { display, totalTl }
    for (const data of Object.values(mo)) {
      for (const it of (data?.items || [])) {
        const raw = (it?.category || "").trim();
        if (!raw) continue;
        const key = raw.toLocaleUpperCase("tr-TR");
        const prev = byCat.get(key) || { display: raw, totalTl: 0 };
        prev.totalTl += Number(it.amount) || 0;
        byCat.set(key, prev);
      }
    }
    const arr = Array.from(byCat.values())
      .map(x => ({
        category: x.display,
        totalTl: x.totalTl,
        avgPerMonth: monthCount > 0 ? x.totalTl / monthCount : 0,
        pct: grandTotal > 0 ? (x.totalTl / grandTotal) * 100 : 0,
      }))
      .sort((a, b) => b.totalTl - a.totalTl)
      .slice(0, 5);
    return arr;
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

      {/* Özet KPI'lar — tüm aylar üzerinden (SuppliesTab pattern'iyle tutarlı) */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <KPI label="Yüklü ay" value={overallSummary.monthCount} sub="Tam aylar (kısmi atlanır)" />
        <KPI label="Toplam gider" value={fmt(overallSummary.totalTl) + " ₺"} sub={`${overallSummary.totalItems} kalem`} />
        <KPI label="Aylık ortalama" value={fmt(overallSummary.avgPerMonth) + " ₺"} sub={overallSummary.monthCount > 0 ? `${overallSummary.monthCount} ay üzerinden` : "veri yok"} />
        {overallSummary.mostExpensive && (
          <KPI
            label="En pahalı ay"
            value={fmt(overallSummary.mostExpensive.totalTl) + " ₺"}
            sub={monthLabel(overallSummary.mostExpensive.ym)}
          />
        )}
        {overallSummary.trend && (
          <KPI
            label="Trend (son 3 ay ort.)"
            value={
              <span style={{ color: overallSummary.trend.direction === "up" ? "#B91C1C" : overallSummary.trend.direction === "down" ? "#166534" : "var(--color-text-primary)" }}>
                {overallSummary.trend.direction === "up" ? "▲" : overallSummary.trend.direction === "down" ? "▼" : "▬"} %{Math.abs(overallSummary.trend.pct).toFixed(1)}
              </span>
            }
            sub={`önceki 3 ay ort. ${fmt(overallSummary.trend.prevAvg)} ₺`}
          />
        )}
      </div>

      {/* Trend etkisi — hangi kategori(ler) trendi sürüklüyor */}
      {trendImpact && (trendImpact.risers.length > 0 || trendImpact.fallers.length > 0) && (
        <div style={{ marginBottom: 14, padding: "10px 14px", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>📈 Trendi Etkileyen Kalemler</span>
            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
              son 3 ay ort. vs önceki 3 ay ort. · en büyük fark ilk sırada
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Artış */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#B91C1C", marginBottom: 4 }}>▲ Artış (trendi yukarı çeken)</div>
              {trendImpact.risers.length === 0 ? (
                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontStyle: "italic", padding: "4px 0" }}>—</div>
              ) : trendImpact.risers.map((r, i) => (
                <div key={r.category + i} style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 6, padding: "4px 0", alignItems: "center", fontSize: 11, borderTop: i === 0 ? "none" : "0.5px dashed var(--color-border-tertiary)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={r.category}>{r.category}</span>
                    {r.isNew && <span style={{ fontSize: 9, padding: "1px 5px", background: "#FEE2E2", color: "#991B1B", borderRadius: 3, fontWeight: 600, flexShrink: 0 }}>yeni</span>}
                    <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{fmt(r.prevAvg)} → {fmt(r.lastAvg)}</span>
                  </div>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#B91C1C" }}>
                    +{fmt(r.delta)} ₺{r.pct !== null && ` (%${r.pct.toFixed(0)})`}
                  </span>
                </div>
              ))}
            </div>
            {/* Düşüş */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#166534", marginBottom: 4 }}>▼ Düşüş (trendi aşağı çeken)</div>
              {trendImpact.fallers.length === 0 ? (
                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontStyle: "italic", padding: "4px 0" }}>—</div>
              ) : trendImpact.fallers.map((r, i) => (
                <div key={r.category + i} style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 6, padding: "4px 0", alignItems: "center", fontSize: 11, borderTop: i === 0 ? "none" : "0.5px dashed var(--color-border-tertiary)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={r.category}>{r.category}</span>
                    {r.isDropped && <span style={{ fontSize: 9, padding: "1px 5px", background: "#DCFCE7", color: "#166534", borderRadius: 3, fontWeight: 600, flexShrink: 0 }}>kalktı</span>}
                    <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{fmt(r.prevAvg)} → {fmt(r.lastAvg)}</span>
                  </div>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#166534" }}>
                    {fmt(r.delta)} ₺{r.pct !== null && ` (%${r.pct.toFixed(0)})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top 5 gider kalemi */}
      {topCategories.length > 0 && (
        <div style={{ marginBottom: 14, padding: "10px 14px", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>🏆 Top 5 Gider Kalemi</span>
            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
              {overallSummary.monthCount} ay boyunca · toplam bazında · kategori adı ile birleştirildi
            </span>
          </div>
          {topCategories.map((c, i) => (
            <div key={c.category + i} style={{ display: "grid", gridTemplateColumns: "24px 1fr 120px 130px 60px", gap: 8, padding: "5px 0", alignItems: "center", fontSize: 11, borderTop: i === 0 ? "none" : "0.5px dashed var(--color-border-tertiary)" }}>
              <span style={{ fontWeight: 700, color: i === 0 ? "#B45309" : "var(--color-text-secondary)" }}>{i + 1}.</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={c.category}>{c.category}</span>
                <div style={{ flex: 1, minWidth: 40, height: 6, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, c.pct)}%`, height: "100%", background: i === 0 ? "#F59E0B" : i === 1 ? "#EAB308" : "#A3A3A3" }} />
                </div>
              </div>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt(c.totalTl)} ₺</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-tertiary)" }}>ort. {fmt(c.avgPerMonth)} ₺/ay</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: i < 2 ? "#B45309" : "var(--color-text-secondary)" }}>%{c.pct.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Accordion ay listesi — SuppliesTab pattern (kapalı başlar, ok ile aç) */}
      {loadedMonthsList.length > 0 && (
        <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px 140px 80px 40px", padding: "6px 12px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
            <span>Ay</span>
            <span>Kaynak</span>
            <span style={{ textAlign: "right" }}>Kalem</span>
            <span style={{ textAlign: "right" }}>Toplam TL</span>
            <span></span>
            <span></span>
          </div>
          {loadedMonthsList.map(ym => {
            const m = laborData?.monthlyOverheads?.[ym];
            const isExpanded = expandedMonth === ym;
            const isSelected = selectedMonth === ym;
            return (
              <div key={ym}>
                <div
                  onClick={() => setExpandedMonth(isExpanded ? null : ym)}
                  style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px 140px 80px 40px", padding: "6px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center", cursor: "pointer", background: isExpanded ? "var(--color-background-info-subtle, #EFF6FF)" : (isSelected ? "rgba(29, 158, 117, 0.05)" : "transparent") }}
                >
                  <span style={{ fontWeight: 500 }}>{isExpanded ? "▼" : "▶"} {monthLabel(ym)}</span>
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                    {m?.source === "vio-mail" ? "📧 Mail" : m?.source === "vio-mail-edited" ? "📧 Mail + manuel" : m?.source === "manual" ? "✏️ Manuel" : m?.source || "—"}
                    {m?.receivedAt && ` · ${new Date(m.receivedAt).toLocaleDateString("tr-TR")}`}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>{(m?.items || []).length}</span>
                  <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmt(m?.totalTl || 0)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedMonth(ym); }}
                    title="Bu ayı seçili yap (manuel düzenleme için aşağıya)"
                    style={{ background: "transparent", border: "1px solid var(--color-border-secondary)", borderRadius: 4, cursor: "pointer", fontSize: 10, padding: "2px 8px", color: "var(--color-text-secondary)" }}
                  >
                    Düzenle
                  </button>
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
                {isExpanded && (() => {
                  const items = [...(m?.items || [])].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
                  const monthTotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
                  return (
                    <div style={{ background: "var(--color-background-primary)", padding: "8px 16px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 140px 60px", padding: "4px 0", fontSize: 9, fontWeight: 500, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-tertiary)", gap: 6 }}>
                        <span>Kod</span>
                        <span>Kategori (çoktan aza)</span>
                        <span style={{ textAlign: "right" }}>Tutar (₺)</span>
                        <span style={{ textAlign: "right" }}>Pay</span>
                      </div>
                      {items.length === 0 ? (
                        <div style={{ padding: "8px 0", fontSize: 10, color: "var(--color-text-tertiary)", textAlign: "center" }}>Bu ayda kategori yok</div>
                      ) : items.map((it, i) => {
                        const pct = monthTotal > 0 ? ((Number(it.amount) || 0) / monthTotal) * 100 : 0;
                        return (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 140px 60px", padding: "3px 0", fontSize: 10, gap: 6, borderTop: "0.5px solid var(--color-border-tertiary)", alignItems: "center" }}>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{it.id || "—"}</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.category}>{it.category || "—"}</span>
                            <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(it.amount)}</span>
                            <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: pct >= 15 ? "#B45309" : "var(--color-text-tertiary)", fontWeight: pct >= 15 ? 600 : 400 }}>%{pct.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

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
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 40px", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", gap: 8 }}>
          <span>Kod</span>
          <span>Kategori</span>
          <span style={{ textAlign: "right" }}>Tutar (₺)</span>
          <span></span>
        </div>
        {draftItems.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
            Bu ay için gider kalemi yok. {canEdit && "Aşağıdan ekleyebilirsiniz."}
          </div>
        ) : draftItems.map(it => (
          <div key={it.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px 40px", gap: 8, padding: "6px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", alignItems: "center", fontSize: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-tertiary)" }}>
              {it.id && /^\d+/.test(String(it.id)) ? it.id : "—"}
            </span>
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
        Bu sayfada VIO'dan gelen aylık genel gider kalemleri listelenir. Dağıtım politikası ve tezgah-bazlı maaş eşleştirmesi <b>Tezgah Dakika Ücretleri</b> sekmesinden yapılır.
      </div>
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function KPI({ label, value, sub }) {
  return (
    <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", borderRadius: 6, minWidth: 140 }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{sub}</div>}
    </div>
  );
}

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

function OverheadPreviewPanel({ preview, onSave, onCancel, saving, canEdit }) {
  const months = preview.monthsList || [];
  const currentMonth = todayMonth();
  // Skip-edilecek aylar (mevcut ay ve sonrası)
  const isSkipped = (ym) => ym >= currentMonth;
  const acceptedMonths = months.filter(m => !isSkipped(m));
  const skippedMonths = months.filter(m => isSkipped(m));

  const [showAll, setShowAll] = useState(false);
  // Default seçim: en son tamamlanmış ay (kaydedilecek son ay)
  const [selectedMonth, setSelMonth] = useState(acceptedMonths[acceptedMonths.length - 1] || months[0]);
  const monthData = preview.byMonth[selectedMonth] || { items: [], totalBorc: 0 };
  const acceptedTotal = acceptedMonths.reduce((s, m) => s + (preview.byMonth[m]?.totalBorc || 0), 0);

  return (
    <div style={{ border: "2px solid var(--color-border-info)", borderRadius: 8, padding: 14, marginBottom: 16, background: "var(--color-background-info-subtle, #EFF6FF)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-info)" }}>📋 Genel Gider Önizlemesi</span>
        <span style={{ fontSize: 11 }}>
          Yıl: <b>{preview.year}</b> · {acceptedMonths.length}/{months.length} ay alınacak · <b>{preview.itemCount}</b> kalem · <b>{preview.uniqueCodeCount}</b> kod
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Kaydedilecek toplam: {fmt(acceptedTotal)} ₺</span>
        {skippedMonths.length > 0 && (
          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", fontWeight: 500 }}>
            ⊘ {skippedMonths.join(", ")} atlanacak (henüz tamamlanmamış)
          </span>
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

      {/* Ay tabları — skip edilenler üstü çizili */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {months.map(m => {
          const skip = isSkipped(m);
          return (
            <button
              key={m}
              onClick={() => setSelMonth(m)}
              title={skip ? `${m} henüz tamamlanmamış — kaydedilmeyecek` : ""}
              style={{
                padding: "4px 12px", borderRadius: 5, border: "1px solid",
                borderColor: m === selectedMonth ? "var(--color-text-info)" : skip ? "#FCD34D" : "var(--color-border-secondary)",
                background: m === selectedMonth ? "var(--color-background-info)" : skip ? "#FFFBEB" : "transparent",
                color: skip ? "#92400E" : m === selectedMonth ? "var(--color-text-info)" : "var(--color-text-secondary)",
                fontSize: 11, fontWeight: m === selectedMonth ? 600 : 400, cursor: "pointer",
                textDecoration: skip ? "line-through" : "none",
                opacity: skip ? 0.85 : 1,
              }}
            >
              {skip && "⊘ "}{m} · {fmt(preview.byMonth[m]?.totalBorc || 0)} ₺
            </button>
          );
        })}
      </div>

      {/* Seçili ay tablosu */}
      <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 6, overflow: "hidden", background: "var(--color-background-primary)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 160px", padding: "6px 12px", background: "var(--color-background-secondary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
          <span>Hizmet Kodu</span>
          <span>Hizmet Adı</span>
          <span style={{ textAlign: "right" }}>Borç (₺)</span>
        </div>
        <div style={{ maxHeight: showAll ? "none" : 400, overflowY: "auto" }}>
          {monthData.items.map((it, i) => (
            <div key={`${it.code}-${i}`} style={{ display: "grid", gridTemplateColumns: "100px 1fr 160px", padding: "5px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", alignItems: "center", fontSize: 11, gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{it.code}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
              <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{fmt(it.amount)}</span>
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
