import { useState, useEffect, useMemo } from "react";
import {
  subscribeBomModels, subscribeUnitConversions,
  saveUnitConversion, deleteUnitConversion,
} from "./firestore";

// Adet dışı birimler — bu birimler ile geçen stoklar için dönüşüm gerekebilir.
const NON_ADET_UNITS = new Set(["MT", "LT", "KG", "M2", "M3", "M", "L", "GR", "TON", "CM"]);
const UNIT_OPTIONS = ["AD", "MT", "LT", "KG", "M2", "M3", "GR", "TON", "CM", "M", "L", "PK"];

export default function UnitConversionsTab({ canEdit, isAdmin }) {
  const [bomModels, setBomModels] = useState({});
  const [unitConversions, setUnitConversions] = useState({ conversions: {} });
  const [loaded, setLoaded] = useState({ bom: false, uconv: false });
  const [editing, setEditing] = useState(null); // { stokKodu, purchaseUnit, bomUnit, factor, isNew }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filterMode, setFilterMode] = useState("mismatch"); // mismatch | all | configured

  useEffect(() => { const u = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(p => ({ ...p, bom: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeUnitConversions(d => { setUnitConversions(d || { conversions: {} }); setLoaded(p => ({ ...p, uconv: true })); }); return u; }, []);

  const allLoaded = Object.values(loaded).every(Boolean);
  const conversions = unitConversions?.conversions || {};

  // BOM'dan unique (stokKodu, bomUnit, stokAdi) çıkar
  const bomStokIndex = useMemo(() => {
    const map = {}; // stokKodu → { bomUnit, name, usageCount }
    for (const model of Object.values(bomModels || {})) {
      if (!model?.parts) continue;
      for (const p of model.parts) {
        const code = String(p.stockCode || "").trim();
        if (!code) continue;
        const unit = String(p.unit || "").trim().toUpperCase();
        if (!unit) continue;
        const name = String(p.stockName || "").trim();
        if (!map[code]) map[code] = { bomUnit: unit, name, usageCount: 0 };
        map[code].usageCount++;
        // İsim boşsa daha sonra dolduysa güncelle
        if (!map[code].name && name) map[code].name = name;
      }
    }
    return map;
  }, [bomModels]);

  // Tespit listesi: BOM'da adet dışı birimle geçen tüm stoklar
  const items = useMemo(() => {
    const list = [];
    for (const [code, meta] of Object.entries(bomStokIndex)) {
      const isNonAdet = NON_ADET_UNITS.has(meta.bomUnit);
      const conv = conversions[code];
      if (!isNonAdet && !conv) continue; // adet ise ve dönüşüm de yoksa atla
      list.push({
        code,
        name: meta.name,
        bomUnit: meta.bomUnit,
        usageCount: meta.usageCount,
        conv,
        needsAttention: isNonAdet && !conv,
      });
    }
    // Ayrıca conversions içinde olup BOM'da olmayan (silinmiş?) kayıtları da göster
    for (const [code, conv] of Object.entries(conversions)) {
      if (!bomStokIndex[code]) {
        list.push({
          code, name: "(BOM'da yok)", bomUnit: conv.bomUnit, usageCount: 0, conv, needsAttention: false, orphan: true,
        });
      }
    }
    // Sıralama: eksikler önce, sonra tanımlılar; alfabetik
    list.sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return a.code.localeCompare(b.code);
    });
    return list;
  }, [bomStokIndex, conversions]);

  const filtered = useMemo(() => {
    if (filterMode === "mismatch") return items.filter(x => x.needsAttention);
    if (filterMode === "configured") return items.filter(x => !!x.conv);
    return items;
  }, [items, filterMode]);

  const stats = useMemo(() => {
    const mismatch = items.filter(x => x.needsAttention).length;
    const configured = items.filter(x => !!x.conv).length;
    const orphan = items.filter(x => x.orphan).length;
    return { total: items.length, mismatch, configured, orphan };
  }, [items]);

  const openAdd = (item) => {
    setEditing({
      stokKodu: item.code,
      purchaseUnit: "AD",
      bomUnit: item.bomUnit || "",
      factor: "",
      name: item.name,
      isNew: true,
    });
    setError("");
  };
  const openEdit = (item) => {
    setEditing({
      stokKodu: item.code,
      purchaseUnit: item.conv.purchaseUnit,
      bomUnit: item.conv.bomUnit,
      factor: String(item.conv.factor),
      name: item.name,
      isNew: false,
    });
    setError("");
  };
  const closeForm = () => { setEditing(null); setError(""); };

  const handleSave = async () => {
    if (!editing) return;
    const factor = Number(editing.factor);
    if (!editing.stokKodu?.trim()) { setError("Stok kodu boş olamaz"); return; }
    if (!editing.purchaseUnit || !editing.bomUnit) { setError("Birimler zorunlu"); return; }
    if (!Number.isFinite(factor) || factor <= 0) { setError("Faktör > 0 olmalı"); return; }
    if (editing.purchaseUnit.trim().toUpperCase() === editing.bomUnit.trim().toUpperCase()) {
      setError("Satınalma ve BOM birimi aynı — dönüşüm gerekmiyor");
      return;
    }
    setSaving(true);
    try {
      await saveUnitConversion(editing.stokKodu.trim(), {
        purchaseUnit: editing.purchaseUnit,
        bomUnit: editing.bomUnit,
        factor,
      }, { canEdit });
      closeForm();
    } catch (e) {
      setError(e.message || "Kayıt hatası");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (code) => {
    if (!confirm(`${code} için dönüşüm silinsin mi? Maliyet hesabı yeniden hesaplanır.`)) return;
    try {
      await deleteUnitConversion(code, { canEdit });
    } catch (e) {
      alert("Silme hatası: " + (e.message || e));
    }
  };

  if (!allLoaded) {
    return <div style={{ padding: 20, color: "#78716c" }}>Yükleniyor…</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🔀 Birim Dönüşümleri</h2>
        <p style={{ color: "#78716c", fontSize: 12, margin: "6px 0 0 0", maxWidth: 720 }}>
          BOM'da MT/LT/KG gibi biriminde geçen ama satınalması AD (adet) olan stoklar için dönüşüm faktörü.
          Örnek: streç film BOM'da <b>4.25 MT</b>, satınalma birim fiyatı 500 TL/AD, 1 AD = 300 MT.
          Faktör 300 girilirse maliyet: 4.25 / 300 × 500 = 7.08 TL (doğru).
          Kaydedilmemiş stoklar mevcut davranışla hesaplanır — bugün ne yapıyorsa aynı.
        </p>
      </div>

      {/* Stat rozetleri */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <StatBadge label="Uyumsuz (Faktör eksik)" value={stats.mismatch} color="#dc2626" bg="#fef2f2" onClick={() => setFilterMode("mismatch")} active={filterMode === "mismatch"} />
        <StatBadge label="Kayıtlı" value={stats.configured} color="#16a34a" bg="#dcfce7" onClick={() => setFilterMode("configured")} active={filterMode === "configured"} />
        <StatBadge label="Tümü" value={stats.total} color="#57534e" bg="#f5f5f4" onClick={() => setFilterMode("all")} active={filterMode === "all"} />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", fontSize: 13, border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          {filterMode === "mismatch" ? "Bu filtrede stok yok — tüm uyumsuz kalemler dönüşüm tanımlı ✅" : "Kayıt yok."}
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                <th style={th}>Durum</th>
                <th style={th}>Stok Kodu</th>
                <th style={th}>Stok Adı</th>
                <th style={th}>BOM Birim</th>
                <th style={th}>Satınalma Birim</th>
                <th style={{ ...th, textAlign: "right" }}>Faktör</th>
                <th style={{ ...th, textAlign: "right" }}>BOM'da Geçtiği Yer</th>
                <th style={th}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.code} style={{ borderTop: "1px solid #f5f5f4", background: item.orphan ? "#fafaf9" : "#fff" }}>
                  <td style={td}>
                    {item.orphan ? (
                      <span style={{ padding: "2px 6px", background: "#e7e5e4", color: "#57534e", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>ORPHAN</span>
                    ) : item.needsAttention ? (
                      <span style={{ padding: "2px 6px", background: "#fef2f2", color: "#991b1b", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>⚠ EKSİK</span>
                    ) : (
                      <span style={{ padding: "2px 6px", background: "#dcfce7", color: "#166534", borderRadius: 3, fontSize: 9, fontWeight: 600 }}>✓ TANIMLI</span>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{item.code}</td>
                  <td style={td}>{item.name || "—"}</td>
                  <td style={{ ...td, fontWeight: 600, color: NON_ADET_UNITS.has(item.bomUnit) ? "#92400e" : "#57534e" }}>{item.bomUnit}</td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {item.conv ? item.conv.purchaseUnit : <span style={{ color: "#a8a29e", fontStyle: "italic" }}>tanımsız</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                    {item.conv ? (
                      <span title={`1 ${item.conv.purchaseUnit} = ${item.conv.factor} ${item.conv.bomUnit}`}>
                        1 {item.conv.purchaseUnit} = <b>{item.conv.factor}</b> {item.conv.bomUnit}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "#78716c", fontSize: 10 }}>
                    {item.usageCount ? `${item.usageCount} parça` : "—"}
                  </td>
                  <td style={td}>
                    {canEdit ? (
                      item.conv ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => openEdit(item)} style={btnEdit}>✏️ Düzenle</button>
                          <button onClick={() => handleDelete(item.code)} style={btnDelete}>🗑</button>
                        </div>
                      ) : (
                        <button onClick={() => openAdd(item)} style={btnAdd}>➕ Ekle</button>
                      )
                    ) : (
                      <span style={{ color: "#a8a29e", fontSize: 10 }}>salt okunur</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {editing && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !saving) closeForm(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 8, width: "min(520px, 92vw)", padding: 20 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {editing.isNew ? "➕ Yeni Birim Dönüşümü" : "✏️ Dönüşümü Düzenle"}
            </h3>
            {editing.name && <div style={{ fontSize: 11, color: "#78716c", marginTop: 2 }}>{editing.name}</div>}

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={label}>Stok Kodu</label>
                <input
                  type="text"
                  value={editing.stokKodu}
                  onChange={(e) => setEditing({ ...editing, stokKodu: e.target.value })}
                  disabled={!editing.isNew}
                  style={input}
                />
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Satınalmada 1 adet</label>
                  <select value={editing.purchaseUnit} onChange={(e) => setEditing({ ...editing, purchaseUnit: e.target.value })} style={input}>
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div style={{ paddingBottom: 8, color: "#78716c", fontSize: 14 }}>=</div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Miktar (BOM birimine)</label>
                  <input
                    type="number"
                    value={editing.factor}
                    onChange={(e) => setEditing({ ...editing, factor: e.target.value })}
                    placeholder="örn. 300"
                    style={input}
                    step="any"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>BOM birimi</label>
                  <select value={editing.bomUnit} onChange={(e) => setEditing({ ...editing, bomUnit: e.target.value })} style={input}>
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
                Örnek: <b>1 {editing.purchaseUnit || "AD"} = {editing.factor || "?"} {editing.bomUnit || "?"}</b>.
                BOM'da 4.25 {editing.bomUnit || "MT"} kullanılıyorsa satınalma karşılığı{" "}
                {editing.factor > 0 ? (4.25 / Number(editing.factor)).toFixed(4) : "?"} {editing.purchaseUnit || "AD"} olur.
              </div>

              {error && (
                <div style={{ padding: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11, color: "#991b1b" }}>
                  ⚠ {error}
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={closeForm} disabled={saving} style={btnCancel}>İptal</button>
              <button onClick={handleSave} disabled={saving || !canEdit} style={btnSave}>
                {saving ? "Kaydediliyor..." : "💾 Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBadge({ label, value, color, bg, onClick, active }) {
  return (
    <button onClick={onClick}
      style={{ padding: "6px 12px", border: "1px solid " + (active ? color : "transparent"), background: bg, color, borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
      <b style={{ fontSize: 14 }}>{value}</b> {label}
    </button>
  );
}

const th = { padding: "8px 10px", fontWeight: 600, fontSize: 10, borderBottom: "1px solid #e7e5e4" };
const td = { padding: "6px 10px", fontSize: 11 };
const label = { display: "block", fontSize: 10, color: "#57534e", marginBottom: 4, fontWeight: 500 };
const input = { width: "100%", padding: "6px 8px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
const btnAdd = { padding: "3px 10px", fontSize: 11, cursor: "pointer", border: "1px solid #1e40af", background: "#eff6ff", color: "#1e40af", borderRadius: 3 };
const btnEdit = { padding: "3px 8px", fontSize: 11, cursor: "pointer", border: "1px solid #a8a29e", background: "#fff", color: "#44403c", borderRadius: 3 };
const btnDelete = { padding: "3px 6px", fontSize: 11, cursor: "pointer", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 3 };
const btnSave = { padding: "8px 16px", fontSize: 12, fontWeight: 600, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" };
const btnCancel = { padding: "8px 16px", fontSize: 12, border: "1px solid #d6d3d1", background: "#fff", color: "#44403c", borderRadius: 4, cursor: "pointer" };
