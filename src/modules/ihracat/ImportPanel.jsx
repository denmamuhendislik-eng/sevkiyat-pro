// İhracat Excel Import paneli
// - Dosya seç / drag-drop
// - Parse + ürün eşleştirme + duplicate kontrol
// - Önizleme (yeni vs zaten var; eşleşen vs eşleşmeyen)
// - Skip mode default (üstüne yazmaz, brief kırmızı çizgisi)
// - "İçe Aktar" → bulkImportExportOrders

import React, { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { parseExportOrderExcel, matchProductsToOrders, classifyForImport } from "./importParser";
import { bulkImportExportOrders, saveCodeMapEntry } from "./firestore";

export default function ImportPanel({ ordersData, settings, products, canEdit, userEmail }) {
  const [dragOver, setDragOver] = useState(false);
  const [parseState, setParseState] = useState(null); // { parsed, matched, unmatched, newOnes, duplicates } | null
  const [mode, setMode] = useState("skip"); // "skip" | "overwrite"
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // import sonucu
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setError("");
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const parsed = parseExportOrderExcel(wb);
      if (parsed.orderCount === 0) {
        setError("Excel'de geçerli sipariş satırı bulunamadı. Format: Müşteri başlığı + 'Tarih | Belge No | Stok Kodu | ...' başlığı bekleniyor.");
        return;
      }
      const { matched, unmatched } = matchProductsToOrders(parsed.ordersMap, products, settings?.codeMap);
      const allEnriched = [...matched, ...unmatched];
      // Enriched'ları yeniden ordersMap'e koy — id → order
      const enrichedMap = Object.fromEntries(allEnriched.map(o => [o.id, o]));
      const { newOnes, duplicates } = classifyForImport(Object.values(enrichedMap), ordersData?.orders || {});
      setParseState({ parsed, matched, unmatched, newOnes, duplicates, enrichedMap });
    } catch (ex) {
      setError("Excel okuma hatası: " + (ex.message || ex));
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && /\.xlsx?$/i.test(f.name)) handleFile(f);
    else setError("Lütfen .xlsx veya .xls dosyası bırakın");
  };
  const onFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const runImport = async () => {
    if (!parseState || !canEdit) return;
    // Sadece "yeni + skip" ya da tümü (overwrite) — kullanıcı seçime göre
    const toImport = mode === "overwrite"
      ? Object.values(parseState.enrichedMap)
      : parseState.newOnes;
    if (toImport.length === 0) {
      alert("İçe aktarılacak yeni kayıt yok (tümü mevcut).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await bulkImportExportOrders(toImport, { canEdit, userEmail, mode });
      // Manuel eşleştirme yapılan kayıtlar için codeMap'e öğret
      // (İlk versiyonda auto-match dışı manuel eşleştirme UI yok — ileri sürüm)
      setResult(res);
      setParseState(null);
    } catch (e) {
      setError("İçe aktarım hatası: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setParseState(null);
    setResult(null);
    setError("");
  };

  const hasParse = !!parseState;

  return (
    <div>
      {/* Bilgi banner */}
      {!hasParse && !result && (
        <div style={{ padding: 12, marginBottom: 12, background: "var(--color-background-info)", color: "var(--color-text-info)", borderRadius: 6, fontSize: 12 }}>
          🌍 VIO ERP'den aldığın <b>Sipariş Raporu Toplamlı (Müşteri Alt Hesaplı)</b> Excel'ini yükle.
          Format Diğer Müşteriler ile aynı. Ürünler otomatik eşleştirilir (kod eşleşmesi).
          <br />
          <b>Üstüne yazmaz</b> — aynı 3-tuple ID (belge_stok_termin) varsa <b>atlanır</b>, yalnızca yeni satırlar eklenir.
        </div>
      )}
      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12 }}>⚠ {error}</div>
      )}

      {/* Sonuç */}
      {result && (
        <div style={{ padding: 12, marginBottom: 12, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 6, fontSize: 12 }}>
          ✓ İçe aktarım tamam — <b>{result.added}</b> yeni · <b>{result.skipped}</b> atlandı (mevcut) · <b>{result.overwritten}</b> üzerine yazıldı
          <button onClick={handleReset} style={{ marginLeft: 12, padding: "3px 8px", fontSize: 11, background: "#fff", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
            Yeni İçe Aktarım
          </button>
        </div>
      )}

      {/* Drag & drop */}
      {!hasParse && !result && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "#1e40af" : "var(--color-border-tertiary)"}`,
            borderRadius: 8, padding: "30px 20px", textAlign: "center",
            background: dragOver ? "rgba(30,64,175,0.05)" : "transparent",
            cursor: "pointer", transition: "all 0.15s",
          }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>{dragOver ? "📂" : "📁"}</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: dragOver ? "#1e40af" : "var(--color-text-primary)" }}>
            {dragOver ? "Dosyayı bırak" : "Excel dosyasını sürükle bırak"}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 3 }}>veya tıklayarak seç (.xlsx, .xls)</div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={onFileSelect} style={{ display: "none" }} />
        </div>
      )}

      {/* Önizleme */}
      {hasParse && (
        <PreviewPanel
          parseState={parseState}
          mode={mode}
          setMode={setMode}
          onImport={runImport}
          onCancel={handleReset}
          saving={saving}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

function PreviewPanel({ parseState, mode, setMode, onImport, onCancel, saving, canEdit }) {
  const { parsed, matched, unmatched, newOnes, duplicates, enrichedMap } = parseState;
  const [showTab, setShowTab] = useState("new"); // "new" | "duplicates" | "unmatched"

  const willImportCount = mode === "overwrite" ? Object.keys(enrichedMap).length : newOnes.length;

  const rows = useMemo(() => {
    if (showTab === "new") return newOnes;
    if (showTab === "duplicates") return duplicates;
    if (showTab === "unmatched") return unmatched;
    return [];
  }, [showTab, newOnes, duplicates, unmatched]);

  return (
    <div>
      {/* Özet */}
      <div style={{ padding: 12, marginBottom: 10, background: "var(--color-background-secondary)", borderRadius: 6, fontSize: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        <StatBox label="Toplam" value={parsed.orderCount} sub={`${parsed.customerSet.length} müşteri`} />
        <StatBox label="Ürün Eşleşen" value={matched.length} color="#166534" />
        <StatBox label="Eşleşmeyen" value={unmatched.length} color={unmatched.length > 0 ? "#92400e" : "#78716c"} />
        <StatBox label="Yeni" value={newOnes.length} color="#1e40af" />
        <StatBox label="Zaten Var" value={duplicates.length} color={duplicates.length > 0 ? "#92400e" : "#78716c"} />
        {parsed.aggregateCount > 0 && <StatBox label="Aggr." value={parsed.aggregateCount} sub="Aynı 3-tuple toplandı" />}
      </div>

      {/* Mode + İçe Aktar */}
      <div style={{ padding: 10, marginBottom: 10, background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>İçe Aktarım Modu:</div>
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} />
          <b>Skip</b> (önerilen) — sadece yeni kayıtlar; mevcut atlanır
        </label>
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="radio" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
          Overwrite — mevcut kayıtların üstüne yazar (dikkat: manuel değişiklikler kaybolur)
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding: "6px 12px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Vazgeç
          </button>
          <button onClick={onImport} disabled={saving || !canEdit || willImportCount === 0}
            style={{ padding: "6px 14px", fontSize: 12, background: willImportCount > 0 ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (saving || willImportCount === 0) ? "not-allowed" : "pointer", fontWeight: 500 }}>
            {saving ? "İçe aktarılıyor…" : `💾 İçe Aktar (${willImportCount} kayıt)`}
          </button>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div style={{ padding: 8, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11 }}>
          ⚠ <b>{unmatched.length}</b> ürün <code>products</code> koleksiyonunda bulunamadı (vioCode eşleşmesi yok).
          Bu kayıtlar yine de import edilir ancak <b>pid null</b> olur. Tahsis/mutabakat için pid önemli — ihracat siparişini
          düzenleyip stok kodunu doğrulayabilir veya products'a eklemeyi düşünebilirsin.
        </div>
      )}

      {/* Tab */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border-tertiary)", marginBottom: 8 }}>
        <PreviewTabBtn active={showTab === "new"} onClick={() => setShowTab("new")}>
          🆕 Yeni ({newOnes.length})
        </PreviewTabBtn>
        <PreviewTabBtn active={showTab === "duplicates"} onClick={() => setShowTab("duplicates")}>
          ♻ Mevcut ({duplicates.length})
        </PreviewTabBtn>
        <PreviewTabBtn active={showTab === "unmatched"} onClick={() => setShowTab("unmatched")}>
          ⚠ Eşleşmeyen ({unmatched.length})
        </PreviewTabBtn>
      </div>

      {/* Liste */}
      <div style={{ maxHeight: 400, overflow: "auto", background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ background: "var(--color-background-secondary)", position: "sticky", top: 0 }}>
            <tr>
              <th style={th}>Müşteri</th>
              <th style={th}>Belge</th>
              <th style={th}>Stok Kodu</th>
              <th style={{ ...th, minWidth: 200 }}>Ürün</th>
              <th style={{ ...th, textAlign: "right" }}>Miktar</th>
              <th style={{ ...th, textAlign: "right" }}>Sevk</th>
              <th style={{ ...th, textAlign: "right" }}>Kalan</th>
              <th style={{ ...th, textAlign: "right" }}>Birim</th>
              <th style={th}>Termin</th>
              {showTab === "duplicates" && <th style={th}>Durum</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={showTab === "duplicates" ? 10 : 9} style={{ padding: 16, textAlign: "center", color: "var(--color-text-tertiary)" }}>Kayıt yok</td></tr>
            ) : rows.map(o => (
              <tr key={o.id} style={{ borderTop: "1px solid #f5f5f4" }}>
                <td style={{ ...td, fontSize: 10 }}>{o.customerName || o.customerCode}</td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{o.belgeNo}</td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>
                  {o.stokKodu}
                  {o.pid == null && <span style={{ marginLeft: 4, fontSize: 9, color: "#92400e" }}>⚠</span>}
                </td>
                <td style={td}>
                  <div>{o.stokAdi}</div>
                  {o.descriptionEn && <div style={{ fontSize: 9, color: "#78716c", fontStyle: "italic" }}>{o.descriptionEn}</div>}
                </td>
                <td style={{ ...td, textAlign: "right" }}>{Number(o.orijinalMiktar).toLocaleString("tr-TR")}</td>
                <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{Number(o.sevkedilenBaslangic).toLocaleString("tr-TR")}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{Number(o.kalanMiktarExcel).toLocaleString("tr-TR")}</td>
                <td style={{ ...td, textAlign: "right", fontSize: 10 }}>{Number(o.birimFiyat).toLocaleString("tr-TR")}</td>
                <td style={{ ...td, fontSize: 10 }}>{o.teslimTarihi || "—"}</td>
                {showTab === "duplicates" && (
                  <td style={{ ...td, fontSize: 9 }}>
                    <span style={{ padding: "1px 5px", borderRadius: 3, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>Mevcut</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value, color, sub }) {
  return (
    <div style={{ padding: "6px 10px", background: "#fff", borderRadius: 4 }}>
      <div style={{ fontSize: 9, color: "#78716c", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#44403c" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#78716c" }}>{sub}</div>}
    </div>
  );
}

function PreviewTabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "6px 12px", border: "none", background: "transparent",
        borderBottom: `2px solid ${active ? "#1e40af" : "transparent"}`,
        color: active ? "#1e40af" : "var(--color-text-secondary)",
        fontSize: 11, fontWeight: active ? 600 : 400, cursor: "pointer", marginBottom: -1,
      }}>
      {children}
    </button>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
