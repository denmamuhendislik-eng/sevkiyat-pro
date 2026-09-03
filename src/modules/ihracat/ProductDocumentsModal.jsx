// Ürün bazlı doküman ekleri modal
// Aynı stok kodunun tüm siparişleri aynı dosyaları paylaşır.
// Kategori serbest — kullanıcı yazar (default 4 sık kullanılan öneri butonu).
//
// Storage: Firebase Storage (appData/exportProductDocs/{stokKodu}/...)
// Meta: exportSettings.productDocuments[stokKodu].files[]
//
// canEdit false ise sadece görüntüle+indir. Yükleme/sil admin/satış+isAdmin ile.

import React, { useState, useRef } from "react";
import { uploadProductDocument, deleteProductDocument } from "./firestore";

const PRESET_CATEGORIES = ["Teknik Resim", "Müşteri PO", "Numune Raporu", "Sertifika"];
const MAX_MB = 20;

function fmtBytes(n) {
  const kb = n / 1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  return (kb / 1024).toFixed(1) + " MB";
}

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("tr-TR"); }
  catch { return ""; }
}

export default function ProductDocumentsModal({
  stokKodu, stokAdi, files, canEdit, userEmail, onClose,
}) {
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("Teknik Resim");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Dosya çok büyük: ${fmtBytes(file.size)} (max ${MAX_MB} MB)`);
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      await uploadProductDocument(stokKodu, file, category, { canEdit, userEmail });
    } catch (err) {
      setError("Yüklenemedi: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (f) => {
    if (!canEdit) return;
    if (!confirm(`Dosyayı sil?\n${f.fileName}`)) return;
    try {
      await deleteProductDocument(stokKodu, f.storagePath, { canEdit, userEmail });
    } catch (err) {
      alert("Silinemedi: " + err.message);
    }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>📎 Ürün Dokümanları</div>
            <div style={{ fontSize: 10, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>
              {stokKodu} {stokAdi ? `— ${stokAdi}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {error && (
          <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
            ⚠ {error}
          </div>
        )}

        {/* Yükleme */}
        {canEdit && (
          <div style={{ padding: 10, marginBottom: 10, background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#44403c", marginBottom: 6 }}>Yeni Dosya Yükle</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "#57534e" }}>Kategori:</span>
              {PRESET_CATEGORIES.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  style={{ padding: "2px 8px", fontSize: 10, border: `1px solid ${category === c ? "#1e40af" : "#d6d3d1"}`,
                    background: category === c ? "#dbeafe" : "#fff", color: category === c ? "#1e40af" : "#44403c",
                    borderRadius: 3, cursor: "pointer", fontWeight: category === c ? 600 : 400 }}>{c}</button>
              ))}
              <input type="text" value={category} onChange={e => setCategory(e.target.value)}
                placeholder="veya serbest kategori..."
                style={{ padding: "3px 6px", fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 3, minWidth: 140 }} />
            </div>
            <input ref={fileInputRef} type="file" onChange={handleFileChange} disabled={uploading}
              style={{ fontSize: 11 }} />
            {uploading && <span style={{ marginLeft: 8, fontSize: 10, color: "#78716c" }}>Yükleniyor…</span>}
            <div style={{ marginTop: 4, fontSize: 9, color: "#78716c" }}>Max {MAX_MB} MB. PDF, DWG, resim, Excel vs.</div>
          </div>
        )}

        {/* Dosya listesi */}
        <div style={{ fontSize: 11, fontWeight: 600, color: "#44403c", marginBottom: 6 }}>
          Dosyalar ({(files || []).length})
        </div>
        {(!files || files.length === 0) ? (
          <div style={{ padding: 16, textAlign: "center", color: "#a8a29e", fontSize: 11, border: "1px dashed #d6d3d1", borderRadius: 4 }}>
            {canEdit ? "Henüz dosya yok. Yukarıdan yükleyebilirsin." : "Bu ürün için doküman yok."}
          </div>
        ) : (
          <div style={{ border: "1px solid #e7e5e4", borderRadius: 4, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ background: "#f5f5f4" }}>
                <tr>
                  <th style={th}>Ad</th>
                  <th style={{ ...th, width: 110 }}>Kategori</th>
                  <th style={{ ...th, width: 70, textAlign: "right" }}>Boyut</th>
                  <th style={{ ...th, width: 90 }}>Tarih</th>
                  <th style={{ ...th, width: 90, textAlign: "center" }}>Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={f.storagePath || i} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={td}>
                      <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "#1e40af", textDecoration: "none" }}>
                        {f.fileName}
                      </a>
                    </td>
                    <td style={{ ...td, fontSize: 10, color: "#57534e" }}>{f.category || "—"}</td>
                    <td style={{ ...td, textAlign: "right", color: "#78716c", fontSize: 10 }}>{fmtBytes(f.size || 0)}</td>
                    <td style={{ ...td, fontSize: 10, color: "#78716c" }} title={f.uploadedBy || ""}>{fmtDate(f.uploadedAt)}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <a href={f.url} target="_blank" rel="noreferrer"
                        style={{ padding: "2px 6px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, marginRight: 3, textDecoration: "none" }}>👁</a>
                      {canEdit && (
                        <button onClick={() => handleDelete(f)}
                          style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button onClick={onClose}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1050, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 720, maxHeight: "92vh", overflow: "auto" };
const th = { padding: "5px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "4px 8px", fontSize: 11, verticalAlign: "middle" };
