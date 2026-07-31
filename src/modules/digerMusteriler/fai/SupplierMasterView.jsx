// FAI Tedarikçi Master — sade CRUD (Excel import yok, manuel doldurulur).
// Firestore: appData/faiSupplierMaster

import React, { useState, useEffect, useMemo } from "react";
import {
  subscribeFaiSupplierMaster, saveFaiSupplierMasterItem, deleteFaiSupplierMasterItem,
} from "./firestore";
import { makeEmptySupplierMasterItem } from "./schema";

export default function SupplierMasterView({ canEdit, userEmail }) {
  const [data, setData] = useState({ items: {} });
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribeFaiSupplierMaster(d => {
      setData(d || { items: {} });
      setLoaded(true);
    });
    return () => unsub && unsub();
  }, []);

  const list = useMemo(() => {
    const arr = Object.entries(data.items || {}).map(([id, it]) => ({ id, ...it }));
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return arr
      .filter(it => !q || (`${it.name || ""} ${it.notes || ""}`).toLocaleLowerCase("tr-TR").includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr-TR"));
  }, [data, search]);

  const openNew = () => { if (canEdit) { setEditing({ ...makeEmptySupplierMasterItem() }); setError(""); } };
  const openEdit = (item) => { if (canEdit) { setEditing({ ...item }); setError(""); } };
  const closeEditor = () => { setEditing(null); setError(""); };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) { setError("Ad zorunlu"); return; }
    setSaving(true);
    setError("");
    try {
      await saveFaiSupplierMasterItem(editing, { canEdit, userEmail });
      closeEditor();
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!canEdit) return;
    if (!confirm(`Silinsin mi?\n\n${item.name}`)) return;
    try {
      await deleteFaiSupplierMasterItem(item.id, { canEdit, userEmail });
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <input type="text" placeholder="🔍 Ara..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, padding: "7px 12px", borderRadius: 6, border: "1px solid #d6d3d1", fontSize: 12 }} />
        <span style={{ fontSize: 11, color: "#78716c" }}>{list.length} kayıt</span>
        <button onClick={openNew} disabled={!canEdit}
          style={{ padding: "6px 12px", fontSize: 12, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500 }}>
          + Yeni Tedarikçi
        </button>
      </div>

      {!loaded ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", fontSize: 12 }}>Yükleniyor…</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", fontSize: 12 }}>
          {Object.keys(data.items || {}).length === 0 ? "Henüz tedarikçi yok. + Yeni Tedarikçi ile başla." : "Aramaya uyan kayıt yok."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                <th style={{ padding: "6px 10px", fontWeight: 600, fontSize: 11 }}>Tedarikçi Adı</th>
                <th style={{ padding: "6px 10px", fontWeight: 600, fontSize: 11 }}>Notlar</th>
                <th style={{ padding: "6px 10px", fontWeight: 600, fontSize: 11, textAlign: "center", width: 100 }}>Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {list.map(it => (
                <tr key={it.id} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 500 }}>{it.name}</td>
                  <td style={{ padding: "6px 10px", color: "#57534e" }}>{it.notes || <span style={{ color: "#a8a29e" }}>—</span>}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center" }}>
                    <button onClick={() => openEdit(it)} disabled={!canEdit}
                      style={{ padding: "3px 8px", fontSize: 10, marginRight: 4, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                      ✏ Düzenle
                    </button>
                    <button onClick={() => handleDelete(it)} disabled={!canEdit}
                      style={{ padding: "3px 8px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div style={modalBg} onClick={closeEditor}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{editing.id ? "Tedarikçi Düzenle" : "Yeni Tedarikçi"}</div>
              <button onClick={closeEditor} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            {error && <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 3 }}>Tedarikçi Adı *</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                autoFocus placeholder="Örn. XYZ Kaplama Ltd."
                style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 3 }}>Notlar (opsiyonel)</label>
              <textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })}
                placeholder="İrtibat, uzmanlık alanı, adres vb."
                style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box", minHeight: 60, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
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
    </div>
  );
}

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 500, boxShadow: "0 4px 24px rgba(0,0,0,0.15)" };
