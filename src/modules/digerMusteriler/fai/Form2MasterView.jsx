// FAI Form 2 — Malzeme/Süreç Master Kaydı Yönetimi
// Firestore: appData/faiForm2Master
// Amaç: Form 2 doldururken tekrar tekrar aynı hammadde/proses yazmak yerine
// master'dan seçim (PR-2). Bu ekranda master listesinin CRUD'u + Excel import.

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  subscribeFaiForm2Master, saveFaiForm2MasterItem,
  deleteFaiForm2MasterItem, bulkImportFaiForm2Master,
  subscribeFaiSupplierMaster,
} from "./firestore";
import {
  FAI_FORM2_MASTER_CATEGORIES, classifyMaterialProcess, makeEmptyForm2MasterItem, CUSTOMER_APPROVAL_OPTIONS,
} from "./schema";
import SupplierCombobox from "./SupplierCombobox";

export default function Form2MasterView({ canEdit, userEmail }) {
  const [data, setData] = useState({ items: {} });
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all"); // "all" | "material" | "process"
  const [viewMode, setViewMode] = useState("grouped"); // "flat" | "grouped"
  const [expandedGroups, setExpandedGroups] = useState({}); // { [groupKey]: bool }
  const [editing, setEditing] = useState(null); // { id?, name, code, ... }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [importState, setImportState] = useState(null); // {rows, preview, mode}
  const fileInputRef = useRef(null);

  const [supplierMaster, setSupplierMaster] = useState({ items: {} });
  useEffect(() => {
    const unsub = subscribeFaiForm2Master(d => {
      setData(d || { items: {} });
      setLoaded(true);
    });
    const unsubSup = subscribeFaiSupplierMaster(d => setSupplierMaster(d || { items: {} }));
    return () => { unsub && unsub(); unsubSup && unsubSup(); };
  }, []);

  const list = useMemo(() => {
    const arr = Object.entries(data.items || {}).map(([id, it]) => ({ id, ...it }));
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return arr
      .filter(it => catFilter === "all" || it.category === catFilter)
      .filter(it => {
        if (!q) return true;
        const hay = `${it.name || ""} ${it.code || ""} ${it.specNumber || ""} ${it.supplier || ""}`.toLocaleLowerCase("tr-TR");
        return hay.includes(q);
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr-TR"));
  }, [data, search, catFilter]);

  const catCounts = useMemo(() => {
    const all = Object.values(data.items || {});
    return {
      all: all.length,
      material: all.filter(it => it.category === "material").length,
      process: all.filter(it => it.category === "process").length,
    };
  }, [data]);

  // Gruplu görünüm — filtrelenmiş liste'yi isme göre grupla.
  // Aynı isim + aynı kategori = tek grup (isim aynı ama kategori farklı olabilir teoride).
  const grouped = useMemo(() => {
    const map = new Map(); // key: `${category}|${name}` → { name, category, variants: [] }
    for (const it of list) {
      const k = `${it.category}|${it.name}`;
      if (!map.has(k)) map.set(k, { name: it.name, category: it.category, variants: [] });
      map.get(k).variants.push(it);
    }
    return Array.from(map.values());
  }, [list]);

  const toggleGroup = (key) => setExpandedGroups(p => ({ ...p, [key]: !p[key] }));
  const openNewVariant = (baseName, category) => {
    if (!canEdit) return;
    setEditing({ ...makeEmptyForm2MasterItem(), name: baseName, category });
    setError("");
  };

  const openNew = () => {
    if (!canEdit) return;
    setEditing({ ...makeEmptyForm2MasterItem() });
    setError("");
  };
  const openEdit = (item) => {
    if (!canEdit) return;
    setEditing({ ...item });
    setError("");
  };
  const closeEditor = () => { setEditing(null); setError(""); };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.code.trim()) { setError("Ad ve Kod zorunlu"); return; }
    // Kategori auto — kullanıcı elle seçmediyse
    const category = editing.category || classifyMaterialProcess(editing.name, editing.code);
    setSaving(true);
    setError("");
    try {
      await saveFaiForm2MasterItem({ ...editing, category }, { canEdit, userEmail });
      closeEditor();
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!canEdit) return;
    if (!confirm(`Silinsin mi?\n\n${item.name} — ${item.code.slice(0, 60)}`)) return;
    try {
      await deleteFaiForm2MasterItem(item.id, { canEdit, userEmail });
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  // ============================================================
  // Excel Import
  // ============================================================
  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset input
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      // İlk satır header — 4 kolon: Ad | Spec No | Kod | Tedarikçi
      const dataRows = rows.slice(1);
      const parsed = [];
      const issues = [];
      dataRows.forEach((r, i) => {
        const rowNum = i + 2; // 1-based Excel row (header dahil)
        let name = String(r[0] || "").trim();
        const specNumber = String(r[1] || "").trim();
        const code = String(r[2] || "").trim();
        const supplier = String(r[3] || "").trim();
        if (!name && !code) return; // tamamen boş satır → skip
        // Karar 1a: Ad boş, Kod dolu → BOYA olarak ekle (kullanıcı onayladı)
        if (!name && code) {
          name = "BOYA";
          issues.push({ row: rowNum, note: `Ad boştu → "BOYA" atandı` });
        }
        if (!name || !code) {
          issues.push({ row: rowNum, note: "Ad veya Kod boş — atlandı", skipped: true });
          return;
        }
        parsed.push({
          name, code, specNumber, supplier,
          customerApproval: "",
          category: classifyMaterialProcess(name, code),
        });
      });
      // Dup detection (aynı name+code sistemde var mı)
      const existingKeys = new Set(
        Object.values(data.items || {}).map(it => `${(it.name || "").toLocaleLowerCase("tr-TR")}|${(it.code || "").toLocaleLowerCase("tr-TR")}`)
      );
      const summary = parsed.map(it => ({
        ...it,
        _isDuplicate: existingKeys.has(`${it.name.toLocaleLowerCase("tr-TR")}|${it.code.toLocaleLowerCase("tr-TR")}`),
      }));
      setImportState({
        fileName: file.name,
        rows: summary,
        issues,
        mode: "skip", // varsayılan
      });
    } catch (ex) {
      alert("Excel okuma hatası: " + (ex.message || ex));
    }
  };

  const runImport = async () => {
    if (!importState) return;
    setSaving(true);
    try {
      const res = await bulkImportFaiForm2Master(
        importState.rows.map(r => ({ name: r.name, code: r.code, specNumber: r.specNumber, supplier: r.supplier, customerApproval: r.customerApproval, category: r.category })),
        { canEdit, mode: importState.mode, userEmail }
      );
      alert(`Import tamamlandı\n\n➕ Yeni: ${res.added}\n♻ Üzerine yazıldı: ${res.overwritten}\n⏭ Atlandı: ${res.skipped}\n⚠ Hata: ${res.errors.length}`);
      setImportState(null);
    } catch (e) {
      alert("Import hatası: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="🔍 Ara (ad, kod, spec, tedarikçi)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 240, padding: "7px 12px", borderRadius: 6, border: "1px solid #d6d3d1", fontSize: 12 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { key: "all",      label: "Tümü",     count: catCounts.all },
            { key: "material", label: "Hammadde", count: catCounts.material },
            { key: "process",  label: "Süreç",    count: catCounts.process },
          ].map(o => (
            <button key={o.key} onClick={() => setCatFilter(o.key)}
              style={{
                padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                border: "1px solid " + (catFilter === o.key ? "#1e40af" : "#d6d3d1"),
                background: catFilter === o.key ? "#1e40af" : "#fff",
                color: catFilter === o.key ? "#fff" : "#44403c",
                fontWeight: 500,
              }}>
              {o.label} ({o.count})
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2, border: "1px solid #d6d3d1", borderRadius: 4, overflow: "hidden" }}>
          <button onClick={() => setViewMode("grouped")}
            title="Aynı isimdeki variantları grup başlığı altında topla"
            style={{ padding: "5px 10px", fontSize: 11, border: "none",
              background: viewMode === "grouped" ? "#1e40af" : "#fff",
              color: viewMode === "grouped" ? "#fff" : "#44403c", cursor: "pointer" }}>
            🗂 Gruplu
          </button>
          <button onClick={() => setViewMode("flat")}
            title="Tüm variantları tek düz tablo olarak göster"
            style={{ padding: "5px 10px", fontSize: 11, border: "none",
              background: viewMode === "flat" ? "#1e40af" : "#fff",
              color: viewMode === "flat" ? "#fff" : "#44403c", cursor: "pointer" }}>
            📋 Düz
          </button>
        </div>
        <button onClick={openNew} disabled={!canEdit}
          style={{ padding: "6px 12px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500 }}>
          + Yeni Kayıt
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls"
          onChange={handleFilePick} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={!canEdit}
          style={{ padding: "6px 12px", fontSize: 12, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed" }}>
          📤 Excel Import
        </button>
      </div>

      {!loaded ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", fontSize: 12 }}>Yükleniyor…</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", fontSize: 12 }}>
          {catCounts.all === 0 ? "Henüz master kayıt yok. Excel import ile başlayabilirsin." : "Filtreye uyan kayıt yok."}
        </div>
      ) : viewMode === "flat" ? (
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                <th style={th}>Kategori</th>
                <th style={th}>Ad</th>
                <th style={th}>Kod (Spesifikasyon Detayı)</th>
                <th style={th}>Spec No</th>
                <th style={th}>Tedarikçi</th>
                <th style={{ ...th, textAlign: "center", width: 80 }}>Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {list.map(it => (
                <tr key={it.id} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={td}>
                    <span style={{ padding: "1px 6px", fontSize: 9, fontWeight: 600, borderRadius: 3,
                      background: it.category === "material" ? "#dbeafe" : "#dcfce7",
                      color: it.category === "material" ? "#1e40af" : "#166534" }}>
                      {it.category === "material" ? "🧱 Hammadde" : "⚙ Süreç"}
                    </span>
                  </td>
                  <td style={{ ...td, fontWeight: 500 }}>{it.name}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", color: "#57534e", fontSize: 10 }}>{it.code}</td>
                  <td style={td}>{it.specNumber || <span style={{ color: "#a8a29e" }}>—</span>}</td>
                  <td style={td}>{it.supplier || <span style={{ color: "#a8a29e" }}>—</span>}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => openEdit(it)} disabled={!canEdit}
                      style={{ padding: "2px 6px", fontSize: 10, marginRight: 4, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                      ✏ Düzenle
                    </button>
                    <button onClick={() => handleDelete(it)} disabled={!canEdit}
                      style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // Gruplu görünüm
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          {grouped.map(g => {
            const gKey = `${g.category}|${g.name}`;
            const isExp = expandedGroups[gKey] !== false; // varsayılan açık
            return (
              <div key={gKey} style={{ borderBottom: "1px solid #f5f5f4" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#f9fafb", cursor: "pointer" }}
                  onClick={() => toggleGroup(gKey)}>
                  <span style={{ fontSize: 10, color: "#78716c", width: 12 }}>{isExp ? "▼" : "▶"}</span>
                  <span style={{ padding: "1px 6px", fontSize: 9, fontWeight: 600, borderRadius: 3,
                    background: g.category === "material" ? "#dbeafe" : "#dcfce7",
                    color: g.category === "material" ? "#1e40af" : "#166534" }}>
                    {g.category === "material" ? "🧱" : "⚙"}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{g.name}</span>
                  <span style={{ fontSize: 10, color: "#78716c" }}>
                    {g.variants.length} variant
                  </span>
                  <div style={{ marginLeft: "auto" }}>
                    <button onClick={(e) => { e.stopPropagation(); openNewVariant(g.name, g.category); }} disabled={!canEdit}
                      title={`"${g.name}" için yeni variant ekle (isim önceden dolu gelir)`}
                      style={{ padding: "2px 8px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                      + Variant
                    </button>
                  </div>
                </div>
                {isExp && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <tbody>
                      {g.variants.map(it => (
                        <tr key={it.id} style={{ borderTop: "1px solid #f5f5f4" }}>
                          <td style={{ ...td, paddingLeft: 34, width: "45%", fontFamily: "ui-monospace, monospace", color: "#57534e", fontSize: 10 }}>{it.code}</td>
                          <td style={td}>
                            <span style={{ fontSize: 9, color: "#78716c" }}>Spec:</span> {it.specNumber || <span style={{ color: "#a8a29e" }}>—</span>}
                          </td>
                          <td style={td}>
                            <span style={{ fontSize: 9, color: "#78716c" }}>Tedarikçi:</span> {it.supplier || <span style={{ color: "#a8a29e" }}>—</span>}
                          </td>
                          <td style={{ ...td, textAlign: "center", width: 80 }}>
                            <button onClick={() => openEdit(it)} disabled={!canEdit}
                              style={{ padding: "2px 6px", fontSize: 10, marginRight: 4, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                              ✏
                            </button>
                            <button onClick={() => handleDelete(it)} disabled={!canEdit}
                              style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                              🗑
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <div style={modalBg} onClick={closeEditor}>
          <div style={{ ...modalBox, maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{editing.id ? "Kayıt Düzenle" : "Yeni Master Kayıt"}</div>
              <button onClick={closeEditor} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            {error && <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ gridColumn: "1 / span 2" }}>
                <label style={lbl}>Malzeme / Süreç Adı *</label>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  style={inp} placeholder="Örn. ELOKSAL" />
              </div>
              <div style={{ gridColumn: "1 / span 2" }}>
                <label style={lbl}>Kod (Spesifikasyon Detayı) *</label>
                <textarea value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })}
                  style={{ ...inp, minHeight: 60, resize: "vertical", fontFamily: "ui-monospace, monospace" }}
                  placeholder="Örn. MIL-A-8625 TİP II, SINIF II, SİYAH SÜLFÜRİK ASİT ELOKSAL" />
              </div>
              <div>
                <label style={lbl}>Spesifikasyon No (ops.)</label>
                <input value={editing.specNumber} onChange={e => setEditing({ ...editing, specNumber: e.target.value })}
                  style={inp} placeholder="Boş bırakılabilir" />
              </div>
              <div>
                <label style={lbl}>Tedarikçi (ops.)</label>
                <SupplierCombobox
                  value={editing.supplier}
                  onChange={v => setEditing({ ...editing, supplier: v })}
                  suppliers={supplierMaster.items || {}}
                  placeholder="Boş bırakılabilir"
                  style={{ padding: "5px 8px", fontSize: 11 }}
                />
              </div>
              <div>
                <label style={lbl}>Müşteri Onayı (ops.)</label>
                <select value={editing.customerApproval || ""} onChange={e => setEditing({ ...editing, customerApproval: e.target.value })}
                  style={{ ...inp, background: "#fff" }}>
                  <option value="">—</option>
                  {CUSTOMER_APPROVAL_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Kategori</label>
                <select value={editing.category || classifyMaterialProcess(editing.name, editing.code)}
                  onChange={e => setEditing({ ...editing, category: e.target.value })}
                  style={{ ...inp, background: "#fff" }}>
                  {FAI_FORM2_MASTER_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
              <button onClick={closeEditor} disabled={saving}
                style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
                Vazgeç
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: "6px 14px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "wait" : "pointer", fontWeight: 500 }}>
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import onay modal */}
      {importState && (
        <div style={modalBg} onClick={() => !saving && setImportState(null)}>
          <div style={{ ...modalBox, maxWidth: 900, maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>📤 Excel Import Önizleme</div>
                <div style={{ fontSize: 11, color: "#78716c" }}>{importState.fileName}</div>
              </div>
              <button onClick={() => setImportState(null)} disabled={saving} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            {/* Özet */}
            {(() => {
              const total = importState.rows.length;
              const dups = importState.rows.filter(r => r._isDuplicate).length;
              const newCount = total - dups;
              return (
                <div style={{ marginBottom: 12, padding: 10, background: "#f9fafb", border: "1px solid #e7e5e4", borderRadius: 4, fontSize: 12 }}>
                  <b>{total}</b> geçerli satır bulundu · <b style={{ color: "#166534" }}>{newCount}</b> yeni · <b style={{ color: "#92400e" }}>{dups}</b> zaten sistemde (ad+kod eşleşen)
                  {importState.issues.length > 0 && <div style={{ marginTop: 4, fontSize: 11, color: "#dc2626" }}>⚠ {importState.issues.length} uyarı — aşağıda</div>}
                </div>
              );
            })()}
            {importState.issues.length > 0 && (
              <div style={{ marginBottom: 10, padding: 8, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, fontSize: 10, maxHeight: 80, overflow: "auto" }}>
                {importState.issues.map((iss, i) => (
                  <div key={i}>Satır {iss.row}: {iss.note}</div>
                ))}
              </div>
            )}
            <div style={{ marginBottom: 10, fontSize: 12 }}>
              <label style={{ marginRight: 12 }}>
                <input type="radio" checked={importState.mode === "skip"} onChange={() => setImportState(s => ({ ...s, mode: "skip" }))} />
                {" "}Aynı ad+kod varsa atla
              </label>
              <label>
                <input type="radio" checked={importState.mode === "overwrite"} onChange={() => setImportState(s => ({ ...s, mode: "overwrite" }))} />
                {" "}Üzerine yaz (spec/tedarikçi güncellensin)
              </label>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, border: "1px solid #e7e5e4" }}>
              <thead>
                <tr style={{ background: "#f5f5f4" }}>
                  <th style={{ ...th, padding: "4px 6px", fontSize: 10 }}>Durum</th>
                  <th style={{ ...th, padding: "4px 6px", fontSize: 10 }}>Kat.</th>
                  <th style={{ ...th, padding: "4px 6px", fontSize: 10 }}>Ad</th>
                  <th style={{ ...th, padding: "4px 6px", fontSize: 10 }}>Kod</th>
                </tr>
              </thead>
              <tbody>
                {importState.rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f5f5f4", background: r._isDuplicate ? "#fef3c7" : "transparent" }}>
                    <td style={{ padding: "3px 6px", fontSize: 9 }}>
                      {r._isDuplicate
                        ? <span style={{ color: "#92400e" }}>♻ Dup</span>
                        : <span style={{ color: "#166534" }}>➕ Yeni</span>}
                    </td>
                    <td style={{ padding: "3px 6px", fontSize: 9 }}>{r.category === "material" ? "🧱" : "⚙"}</td>
                    <td style={{ padding: "3px 6px", fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: "3px 6px", fontFamily: "ui-monospace, monospace", fontSize: 9, color: "#57534e" }}>{r.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
              <button onClick={() => setImportState(null)} disabled={saving}
                style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
                Vazgeç
              </button>
              <button onClick={runImport} disabled={saving || importState.rows.length === 0}
                style={{ padding: "6px 14px", fontSize: 12, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "wait" : "pointer", fontWeight: 500 }}>
                {saving ? "İçe aktarılıyor…" : `İçe Aktar (${importState.rows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
const lbl = { display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 3 };
const inp = { width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", boxShadow: "0 4px 24px rgba(0,0,0,0.15)" };
