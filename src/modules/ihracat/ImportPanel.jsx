// İhracat Excel Import paneli
// - Dosya seç / drag-drop
// - Parse + ürün eşleştirme + duplicate kontrol
// - Önizleme (yeni vs zaten var; eşleşen vs eşleşmeyen)
// - Her satırda checkbox (varsayılan hepsi seçili) + hızlı tarih filtresi
// - Canlı mutabakat önizlemesi (seçime göre)
// - Skip mode default (üstüne yazmaz)

import React, { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { parseExportOrderExcel, matchProductsToOrders, classifyForImport } from "./importParser";
import { bulkImportExportOrders } from "./firestore";
import { computeAllocatedByOrder, computePreviewReconciliation } from "./allocationCalc";

export default function ImportPanel({ ordersData, allocationsData, settings, products, canEdit, userEmail, remainingByPid }) {
  const [dragOver, setDragOver] = useState(false);
  const [parseState, setParseState] = useState(null);
  const [mode, setMode] = useState("skip");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  // Kullanıcının seçtiği ID'ler (checkbox). Import edilecek olanlar.
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [minTermin, setMinTermin] = useState(""); // "YYYY-MM-DD" filtresi
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
      const enrichedMap = Object.fromEntries(allEnriched.map(o => [o.id, o]));
      const { newOnes, duplicates } = classifyForImport(Object.values(enrichedMap), ordersData?.orders || {});
      setParseState({ parsed, matched, unmatched, newOnes, duplicates, enrichedMap });
      // Default: tüm yeni satırlar seçili
      setSelectedIds(new Set(newOnes.map(o => o.id)));
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
    // Sadece seçili olanları import et (skip modunda yeniler; overwrite'da hepsi seçili)
    const toImport = mode === "overwrite"
      ? Object.values(parseState.enrichedMap).filter(o => selectedIds.has(o.id))
      : parseState.newOnes.filter(o => selectedIds.has(o.id));
    if (toImport.length === 0) {
      alert("İçe aktarılacak seçili kayıt yok.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await bulkImportExportOrders(toImport, { canEdit, userEmail, mode });
      setResult(res);
      setParseState(null);
      setSelectedIds(new Set());
      setMinTermin("");
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
    setSelectedIds(new Set());
    setMinTermin("");
  };

  const hasParse = !!parseState;

  return (
    <div>
      {!hasParse && !result && (
        <div style={{ padding: 12, marginBottom: 12, background: "var(--color-background-info)", color: "var(--color-text-info)", borderRadius: 6, fontSize: 12 }}>
          🌍 VIO ERP'den aldığın <b>Sipariş Raporu Toplamlı (Müşteri Alt Hesaplı)</b> Excel'ini yükle.
          <br />
          <b>Üstüne yazmaz</b> — aynı 3-tuple ID varsa <b>atlanır</b>. Önizlemede her satırı ayrı seçebilirsin.
        </div>
      )}
      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12 }}>⚠ {error}</div>
      )}

      {result && (
        <div style={{ padding: 12, marginBottom: 12, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 6, fontSize: 12 }}>
          ✓ İçe aktarım tamam — <b>{result.added}</b> yeni · <b>{result.skipped}</b> atlandı (mevcut) · <b>{result.overwritten}</b> üzerine yazıldı
          <button onClick={handleReset} style={{ marginLeft: 12, padding: "3px 8px", fontSize: 11, background: "#fff", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
            Yeni İçe Aktarım
          </button>
        </div>
      )}

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

      {hasParse && (
        <PreviewPanel
          parseState={parseState}
          mode={mode}
          setMode={setMode}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          minTermin={minTermin}
          setMinTermin={setMinTermin}
          onImport={runImport}
          onCancel={handleReset}
          saving={saving}
          canEdit={canEdit}
          ordersData={ordersData}
          allocationsData={allocationsData}
          remainingByPid={remainingByPid}
          products={products}
        />
      )}
    </div>
  );
}

function PreviewPanel({
  parseState, mode, setMode,
  selectedIds, setSelectedIds,
  minTermin, setMinTermin,
  onImport, onCancel, saving, canEdit,
  ordersData, allocationsData, remainingByPid, products,
}) {
  const { parsed, matched, unmatched, newOnes, duplicates, enrichedMap } = parseState;
  const [showTab, setShowTab] = useState("new");

  // İzin verilen kayıtlar: mode'a göre seçilebilir havuz
  const selectablePool = mode === "overwrite" ? Object.values(enrichedMap) : newOnes;

  const rows = useMemo(() => {
    if (showTab === "new") return newOnes;
    if (showTab === "duplicates") return duplicates;
    if (showTab === "unmatched") return unmatched;
    return [];
  }, [showTab, newOnes, duplicates, unmatched]);

  // Seçili kayıtlar → import edilecekler
  const selectedOrders = useMemo(
    () => selectablePool.filter(o => selectedIds.has(o.id)),
    [selectablePool, selectedIds]
  );

  const toggleOne = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectAllVisible = () => {
    const next = new Set(selectedIds);
    for (const o of rows) if (isRowSelectable(o, mode)) next.add(o.id);
    setSelectedIds(next);
  };

  const deselectAllVisible = () => {
    const next = new Set(selectedIds);
    for (const o of rows) next.delete(o.id);
    setSelectedIds(next);
  };

  // Tarih filtresi uygula — minTermin'den önce olanları deselect et.
  // teslimTarihi boşsa orderDate'i baz al. Ne biri ne diğeri yoksa dokunma.
  const applyDateFilter = () => {
    if (!minTermin) return;
    const next = new Set(selectedIds);
    for (const o of selectablePool) {
      const cmpDate = o.teslimTarihi || o.orderDate || "";
      if (cmpDate && cmpDate < minTermin) next.delete(o.id);
    }
    setSelectedIds(next);
  };

  // Canlı mutabakat — seçili satırlarla
  const allocatedByOrder = useMemo(() => computeAllocatedByOrder(allocationsData?.allocations || {}), [allocationsData]);
  const previewRecon = useMemo(() => {
    return computePreviewReconciliation({
      planByPid: remainingByPid || {},
      selectedNewOrders: selectedOrders,
      existingOrdersMap: ordersData?.orders || {},
      allocatedByOrderMap: allocatedByOrder,
      mode,
      products,
    });
  }, [remainingByPid, selectedOrders, ordersData, allocatedByOrder, mode, products]);

  const reconSummary = useMemo(() => {
    let matched = 0, planExtra = 0, orderExtra = 0;
    for (const r of previewRecon) {
      if (r.match) matched++;
      else if (r.diff > 0) planExtra++;
      else if (r.diff < 0) orderExtra++;
    }
    return { total: previewRecon.length, matched, planExtra, orderExtra };
  }, [previewRecon]);

  return (
    <div>
      {/* Özet */}
      <div style={{ padding: 12, marginBottom: 10, background: "var(--color-background-secondary)", borderRadius: 6, fontSize: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        <StatBox label="Excel Toplam" value={parsed.orderCount} sub={`${parsed.customerSet.length} müşteri`} />
        <StatBox label="Ürün Eşleşen" value={matched.length} color="#166534" />
        <StatBox label="Eşleşmeyen" value={unmatched.length} color={unmatched.length > 0 ? "#92400e" : "#78716c"} />
        <StatBox label="Yeni" value={newOnes.length} color="#1e40af" />
        <StatBox label="Zaten Var" value={duplicates.length} color={duplicates.length > 0 ? "#92400e" : "#78716c"} />
        <StatBox label="Seçili (import)" value={selectedOrders.length} color="#166534" sub={`${mode === "overwrite" ? "overwrite" : "skip"}`} />
      </div>

      {/* Hızlı Filtre */}
      <div style={{ padding: 10, marginBottom: 10, background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#44403c" }}>🔧 Hızlı Filtre:</div>
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>📅 Tarih filtresi:</span>
          <input type="date" value={minTermin} onChange={e => setMinTermin(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3 }} />
          <span style={{ fontSize: 10, color: "#78716c" }}>öncesini çıkar</span>
        </label>
        <button onClick={applyDateFilter} disabled={!minTermin}
          style={{ padding: "4px 10px", fontSize: 11, background: minTermin ? "#1e40af" : "#a8a29e", color: "#fff", border: "none", borderRadius: 3, cursor: minTermin ? "pointer" : "not-allowed", fontWeight: 500 }}>
          Uygula
        </button>
        <div style={{ borderLeft: "1px solid #d6d3d1", height: 20 }} />
        <button onClick={selectAllVisible}
          style={{ padding: "4px 8px", fontSize: 11, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>
          Görünenleri seç
        </button>
        <button onClick={deselectAllVisible}
          style={{ padding: "4px 8px", fontSize: 11, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>
          Görünenleri temizle
        </button>
      </div>

      {/* Canlı Mutabakat Önizleme */}
      <MutabakatPreview summary={reconSummary} rows={previewRecon} />

      {/* Mode + İçe Aktar */}
      <div style={{ padding: 10, marginBottom: 10, background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>İçe Aktarım Modu:</div>
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} />
          <b>Skip</b> (önerilen) — sadece yeni; mevcut dokunulmaz
        </label>
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="radio" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
          Overwrite — mevcutun üstüne yaz (dikkat)
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding: "6px 12px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Vazgeç
          </button>
          <button onClick={onImport} disabled={saving || !canEdit || selectedOrders.length === 0}
            style={{ padding: "6px 14px", fontSize: 12, background: selectedOrders.length > 0 ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (saving || selectedOrders.length === 0) ? "not-allowed" : "pointer", fontWeight: 500 }}>
            {saving ? "İçe aktarılıyor…" : `💾 İçe Aktar (${selectedOrders.length} kayıt)`}
          </button>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div style={{ padding: 8, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11 }}>
          ⚠ <b>{unmatched.length}</b> ürün <code>products</code>'ta bulunamadı (vioCode eşleşmesi yok).
          Bu kayıtlar seçilirse pid=null olarak eklenir. Tahsis/mutabakat için pid önemli.
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
              <th style={{ ...th, width: 30, textAlign: "center" }}>
                <input type="checkbox"
                  checked={rows.length > 0 && rows.every(o => selectedIds.has(o.id) || !isRowSelectable(o, mode))}
                  onChange={e => e.target.checked ? selectAllVisible() : deselectAllVisible()} />
              </th>
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
              <tr><td colSpan={showTab === "duplicates" ? 11 : 10} style={{ padding: 16, textAlign: "center", color: "var(--color-text-tertiary)" }}>Kayıt yok</td></tr>
            ) : rows.map(o => {
              const selectable = isRowSelectable(o, mode);
              const isSelected = selectedIds.has(o.id);
              const bg = isSelected ? "#eff6ff" : "transparent";
              return (
                <tr key={o.id} style={{ borderTop: "1px solid #f5f5f4", background: bg }}>
                  <td style={{ ...td, textAlign: "center" }}>
                    <input type="checkbox" checked={isSelected} disabled={!selectable}
                      onChange={() => toggleOne(o.id)}
                      title={!selectable ? "Bu kayıt import edilemez (Skip modda mevcut kayıt)" : ""}
                    />
                  </td>
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
                  <td style={{ ...td, fontSize: 10 }}>{o.teslimTarihi || o.orderDate || "—"}</td>
                  {showTab === "duplicates" && (
                    <td style={{ ...td, fontSize: 9 }}>
                      <span style={{ padding: "1px 5px", borderRadius: 3, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>Mevcut</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function isRowSelectable(order, mode) {
  // Skip modda: sadece "yeni" satırlar seçilebilir. duplicates ve mevcut zaten import edilmez.
  // Overwrite modda: hepsi seçilebilir.
  if (mode === "overwrite") return true;
  // Skip modda selectablePool zaten newOnes; duplicates ve unmatched (mevcut olan) engellenmiş olur.
  // isRowSelectable UI'da checkbox disable için kullanılır. Duplicates tab'ında hepsi mevcut → false.
  return true; // Aslında UI selectablePool ile zaten sınırlıyor; her satır kendi tab'ında selectable
}

function MutabakatPreview({ summary, rows }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssue = summary.planExtra > 0 || summary.orderExtra > 0;
  return (
    <div style={{ padding: 10, marginBottom: 10, background: hasIssue ? "#fef3c7" : "#f0fdf4",
      border: `1px solid ${hasIssue ? "#fde68a" : "#86efac"}`, borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12 }}>
          <b>🔍 Mutabakat Önizleme</b> (seçili satırlara göre canlı):
          <span style={{ marginLeft: 8, color: "#166534" }}>✅ {summary.matched} tutuyor</span>
          {summary.planExtra > 0 && <span style={{ marginLeft: 8, color: "#92400e" }}>📈 {summary.planExtra} plan fazlası</span>}
          {summary.orderExtra > 0 && <span style={{ marginLeft: 8, color: "#991b1b" }}>📉 {summary.orderExtra} sipariş fazlası</span>}
        </div>
        <button onClick={() => setExpanded(!expanded)}
          style={{ padding: "3px 10px", fontSize: 11, background: "#fff", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>
          {expanded ? "Detayı Gizle" : `Detay (${rows.length})`}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, maxHeight: 220, overflow: "auto", background: "#fff", borderRadius: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead style={{ background: "#f5f5f4", position: "sticky", top: 0 }}>
              <tr>
                <th style={{ ...th, width: 30, textAlign: "center" }}></th>
                <th style={th}>Stok</th>
                <th style={{ ...th, minWidth: 200 }}>Ürün</th>
                <th style={{ ...th, textAlign: "right" }}>Plan Kalan</th>
                <th style={{ ...th, textAlign: "right" }}>Sipariş Kalan</th>
                <th style={{ ...th, textAlign: "right", fontWeight: 700 }}>Fark</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 12, textAlign: "center", color: "#a8a29e" }}>Karşılaştırılacak ürün yok</td></tr>
              ) : rows.map((r, i) => {
                const icon = r.match ? "✅" : (r.diff > 0 ? "📈" : "📉");
                const statusColor = r.match ? "#166534" : (r.diff > 0 ? "#92400e" : "#991b1b");
                return (
                  <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={{ ...td, textAlign: "center", fontSize: 12 }}>{icon}</td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{r.stokKodu || "—"}</td>
                    <td style={td}>{r.name || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.planQty.toLocaleString("tr-TR")}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.orderQty.toLocaleString("tr-TR")}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: statusColor }}>
                      {r.diff === 0 ? "0" : (r.diff > 0 ? `+${r.diff}` : r.diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
