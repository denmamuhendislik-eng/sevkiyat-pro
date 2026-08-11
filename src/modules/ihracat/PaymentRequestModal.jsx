// Ödeme Talep Tablosu — müşteriye "IN ADVANCE WITH DELIVERY" ödemesi bekleyen
// faturaları listeleyen 3 sütunlu tablo. Panoya HTML + düz metin olarak yazar,
// kullanıcı Gmail/Outlook'a Ctrl+V ile tablo olarak yapıştırır.

import React, { useState, useMemo, useEffect } from "react";
import { subscribeExportSettings, saveCustomerDefaults } from "./firestore";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]);

const DEFAULT_TEMPLATE = `Merhaba,

Aşağıdaki faturalar için teslim şartı gereği ödeme talebimizdir.

Saygılarımızla.`;

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Bir etiketin "teslim" kategorisinde olup olmadığı (case-insensitive DELIVERY substring)
const isDeliveryLabel = (label) => String(label || "").toUpperCase().includes("DELIVERY");

export default function PaymentRequestModal({ invoices, customerOptions, initialCustomer, canEdit, userEmail, onClose }) {
  const [selectedCustomer, setSelectedCustomer] = useState(
    initialCustomer && initialCustomer !== "all" ? initialCustomer : ""
  );
  const [headerText, setHeaderText] = useState("");
  const [rowSelections, setRowSelections] = useState({});
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [error, setError] = useState("");
  const [exportSettings, setExportSettings] = useState({});
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  useEffect(() => {
    const u = subscribeExportSettings(d => setExportSettings(d || {}));
    return () => u && u();
  }, []);

  const customerDefaults = exportSettings?.customerDefaults || {};

  // Müşteri değişince: kayıtlı özel metin varsa onu yükle, yoksa default template
  useEffect(() => {
    if (!selectedCustomer) { setHeaderText(""); setSaveAsDefault(false); return; }
    const saved = customerDefaults[selectedCustomer]?.paymentRequestText;
    setHeaderText(saved != null ? saved : DEFAULT_TEMPLATE);
    setSaveAsDefault(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer, exportSettings]);

  // Müşteri için "delivery" etiketli fatura satırları
  const rows = useMemo(() => {
    if (!selectedCustomer) return [];
    const list = [];
    for (const inv of (invoices || [])) {
      if (inv.customerCode !== selectedCustomer) continue;
      if ((inv.status || "issued") !== "issued") continue;
      const plan = Array.isArray(inv.paymentPlan) ? inv.paymentPlan : [];
      for (const p of plan) {
        if (!isDeliveryLabel(p?.label)) continue;
        const pct = Number(p?.pct) || 0;
        if (pct <= 0) continue;
        const total = Number(inv.totalAmount) || 0;
        list.push({
          invoiceNo: inv.invoiceNo,
          label: String(p.label || "").trim(),
          pct,
          amount: total * (pct / 100),
          currency: inv.currency || "EUR",
          invoiceDate: inv.invoiceDate || "",
          key: `${inv.invoiceNo}__${String(p.label)}__${pct}`,
        });
      }
    }
    return list.sort((a, b) => (a.invoiceNo || "").localeCompare(b.invoiceNo || ""));
  }, [invoices, selectedCustomer]);

  useEffect(() => {
    const init = {};
    for (const r of rows) init[r.key] = true;
    setRowSelections(init);
  }, [rows]);

  const selectedRows = rows.filter(r => rowSelections[r.key]);

  // Currency bazlı toplam
  const totalsByCurrency = useMemo(() => {
    const m = new Map();
    for (const r of selectedRows) m.set(r.currency, (m.get(r.currency) || 0) + r.amount);
    return [...m.entries()];
  }, [selectedRows]);

  const toggleRow = (key) => setRowSelections(prev => ({ ...prev, [key]: !prev[key] }));
  const selectAll = () => setRowSelections(rows.reduce((acc, r) => ({ ...acc, [r.key]: true }), {}));
  const selectNone = () => setRowSelections(rows.reduce((acc, r) => ({ ...acc, [r.key]: false }), {}));

  // ---- Panoya kopyalama ----
  const buildHtml = () => {
    const rowsHtml = selectedRows.map(r => `
      <tr>
        <td style="border:1px solid #999;padding:6px 10px;font-family:Consolas,monospace;">${esc(r.invoiceNo)}</td>
        <td style="border:1px solid #999;padding:6px 10px;">${esc(r.label)} (%${r.pct})</td>
        <td style="border:1px solid #999;padding:6px 10px;text-align:right;font-weight:600;">${fmt(r.amount)} ${esc(r.currency)}</td>
      </tr>
    `).join("");
    const totalsHtml = totalsByCurrency.map(([cur, amt]) => `
      <tr>
        <td colspan="2" style="border:1px solid #999;padding:6px 10px;font-weight:700;background:#f5f5f4;text-align:right;">TOPLAM (${esc(cur)})</td>
        <td style="border:1px solid #999;padding:6px 10px;text-align:right;font-weight:700;background:#f5f5f4;">${fmt(amt)} ${esc(cur)}</td>
      </tr>
    `).join("");
    const table = `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:11pt;">
  <thead>
    <tr style="background:#e5e7eb;">
      <th style="border:1px solid #999;padding:8px 10px;text-align:left;">Fatura No</th>
      <th style="border:1px solid #999;padding:8px 10px;text-align:left;">Ödeme Şekli</th>
      <th style="border:1px solid #999;padding:8px 10px;text-align:right;">Tutar</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}${totalsHtml}</tbody>
</table>`;
    if (headerText.trim()) {
      const hdr = esc(headerText.trim()).replace(/\n/g, "<br/>");
      return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;margin:0 0 12px 0;">${hdr}</p>${table}`;
    }
    return table;
  };

  const buildPlain = () => {
    const lines = [];
    if (headerText.trim()) { lines.push(headerText.trim()); lines.push(""); }
    lines.push("Fatura No\tÖdeme Şekli\tTutar");
    for (const r of selectedRows) {
      lines.push(`${r.invoiceNo}\t${r.label} (%${r.pct})\t${fmt(r.amount)} ${r.currency}`);
    }
    for (const [cur, amt] of totalsByCurrency) {
      lines.push(`TOPLAM (${cur})\t\t${fmt(amt)} ${cur}`);
    }
    return lines.join("\n");
  };

  const copyToClipboard = async () => {
    if (selectedRows.length === 0) { setError("En az bir satır seç"); return; }
    setError("");
    const html = buildHtml();
    const plain = buildPlain();
    try {
      if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plain);
      } else {
        throw new Error("Tarayıcı clipboard API'yi desteklemiyor");
      }
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2500);
      // "Bu müşteri için varsayılan kaydet" işaretliyse → customerDefaults'a yaz
      if (saveAsDefault && selectedCustomer && canEdit) {
        try {
          const existing = customerDefaults[selectedCustomer] || {};
          await saveCustomerDefaults(selectedCustomer, {
            ...existing,
            paymentRequestText: headerText,
          }, { canEdit, userEmail });
        } catch (defErr) {
          console.warn("paymentRequestText kaydedilemedi:", defErr.message);
        }
      }
    } catch (e) {
      setError("Kopyalama başarısız: " + e.message);
    }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>📋 Ödeme Talep Tablosu</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              Müşterinin teslim şartı gereği bekleyen fatura ödemelerini panoya kopyala — mail'e yapıştır
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {/* Müşteri seçici */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Müşteri</label>
          <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} style={{ ...inp, background: "#fff" }}>
            <option value="">— müşteri seç —</option>
            {(customerOptions || []).map(c => (
              <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
            ))}
          </select>
        </div>

        {/* Üst metin */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>
            Üst metin (opsiyonel — tablonun üstüne yapıştırılır)
            {selectedCustomer && customerDefaults[selectedCustomer]?.paymentRequestText != null && (
              <span style={{ marginLeft: 6, fontSize: 9, color: "#166534", fontWeight: 600 }}>✓ bu müşteri için kayıtlı metin yüklendi</span>
            )}
          </label>
          <textarea value={headerText} onChange={e => setHeaderText(e.target.value)}
            placeholder="Örn. Merhaba, aşağıdaki faturalar için teslim şartı gereği ödeme talebimizdir. Saygılarımızla."
            rows={4} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
          {selectedCustomer && canEdit && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 10, color: "#57534e", cursor: "pointer" }}>
              <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
              💾 Bu müşteri ({selectedCustomer}) için üst metni varsayılan olarak kaydet — sonraki açılışta otomatik yüklenir
            </label>
          )}
        </div>

        {error && <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}

        {/* Satırlar */}
        {!selectedCustomer ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 12, border: "1px dashed #d6d3d1", borderRadius: 6 }}>
            Önce müşteri seç.
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 12, border: "1px dashed #d6d3d1", borderRadius: 6 }}>
            Bu müşteri için teslim şartlı ödemesi bekleyen aktif fatura yok.
            <br /><span style={{ fontSize: 10 }}>(Kural: status = kesildi + ödeme etiketinde "DELIVERY" geçmesi)</span>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 10 }}>
              <button onClick={selectAll} style={btnSmall}>Hepsini seç</button>
              <button onClick={selectNone} style={btnSmall}>Hiçbirini seçme</button>
              <span style={{ marginLeft: "auto", color: "#78716c" }}>{selectedRows.length}/{rows.length} satır</span>
            </div>
            <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ background: "#f5f5f4" }}>
                  <tr>
                    <th style={{ ...th, width: 30 }}></th>
                    <th style={th}>Fatura No</th>
                    <th style={th}>Tarih</th>
                    <th style={th}>Ödeme Şekli</th>
                    <th style={{ ...th, textAlign: "right" }}>Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} style={{ borderTop: "1px solid #f5f5f4", background: rowSelections[r.key] ? "transparent" : "#fafaf9", opacity: rowSelections[r.key] ? 1 : 0.55 }}>
                      <td style={td}>
                        <input type="checkbox" checked={!!rowSelections[r.key]} onChange={() => toggleRow(r.key)} />
                      </td>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{r.invoiceNo}</td>
                      <td style={{ ...td, fontSize: 10, color: "#78716c" }}>{r.invoiceDate || "—"}</td>
                      <td style={td}>{r.label} <span style={{ color: "#78716c" }}>(%{r.pct})</span></td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmt(r.amount)} {r.currency}</td>
                    </tr>
                  ))}
                  {totalsByCurrency.map(([cur, amt]) => (
                    <tr key={`total_${cur}`} style={{ borderTop: "2px solid #d6d3d1", background: "#eff6ff" }}>
                      <td style={td} colSpan={4} align="right">
                        <b>TOPLAM ({cur})</b>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 12, color: "#1e40af" }}>
                        {fmt(amt)} {cur}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Aksiyon */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12, borderTop: "1px solid #e7e5e4", paddingTop: 10 }}>
          {copiedFlash && (
            <span style={{ alignSelf: "center", marginRight: "auto", fontSize: 11, color: "#166534", fontWeight: 600 }}>
              ✓ Panoya kopyalandı — mail'e Ctrl+V ile yapıştır
            </span>
          )}
          <button onClick={onClose}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Kapat
          </button>
          <button onClick={copyToClipboard} disabled={selectedRows.length === 0}
            style={{ padding: "6px 14px", fontSize: 12, background: selectedRows.length > 0 ? "#1e40af" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: selectedRows.length > 0 ? "pointer" : "not-allowed", fontWeight: 500 }}>
            📋 Panoya Kopyala (HTML + Metin)
          </button>
        </div>
      </div>
    </div>
  );
}

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 780, maxHeight: "92vh", overflow: "auto" };
const inp = { width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 4 };
const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "middle" };
const btnSmall = { padding: "2px 8px", fontSize: 10, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" };
