// Ürün Fiyat Tarihçesi Modal
// Products sekmesinde ürün kartındaki 📊 tıklanınca açılır.
// Kronolojik fiyat değişimleri — append-only.

import React from "react";

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_META = {
  "vio-import": { label: "VIO Import", color: "#1e40af", bg: "#dbeafe" },
  "manual": { label: "Manuel", color: "#166534", bg: "#dcfce7" },
  "ihracat-order": { label: "İhracat Sipariş", color: "#7c3aed", bg: "#f5f3ff" },
};

export default function PriceHistoryModal({ product, onClose }) {
  if (!product) return null;
  const history = Array.isArray(product.priceHistory) ? product.priceHistory : [];
  // Yeni en üstte
  const sorted = [...history].sort((a, b) => {
    const at = a.recordedAt || a.date || "";
    const bt = b.recordedAt || b.date || "";
    return bt.localeCompare(at);
  });
  const current = Number(product.salesPriceEur) || 0;

  // Min/max/avg — istatistik
  const prices = history.map(h => Number(h.price) || 0).filter(p => p > 0);
  const minP = prices.length > 0 ? Math.min(...prices) : 0;
  const maxP = prices.length > 0 ? Math.max(...prices) : 0;
  const avgP = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>📊 Fiyat Tarihçesi</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              {product.vioCode && <><code>{product.vioCode}</code> · </>}
              {product.nameTR || `pid ${product.id}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {/* Özet */}
        <div style={{ padding: 10, marginBottom: 12, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: "#57534e", fontWeight: 600 }}>💰 Güncel Fiyat</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>{fmt(current)} EUR</div>
              {product.salesPriceUpdatedAt && (
                <div style={{ fontSize: 8, color: "#78716c" }}>
                  Son güncelleme: {new Date(product.salesPriceUpdatedAt).toLocaleDateString("tr-TR")}
                </div>
              )}
            </div>
            {history.length > 0 && (
              <>
                <div>
                  <div style={{ fontSize: 9, color: "#57534e", fontWeight: 600 }}>📉 En Düşük</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>{fmt(minP)} EUR</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#57534e", fontWeight: 600 }}>📈 En Yüksek</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>{fmt(maxP)} EUR</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#57534e", fontWeight: 600 }}>📊 Ortalama</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af" }}>{fmt(avgP)} EUR</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#57534e", fontWeight: 600 }}>🔢 Değişim</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{history.length} kayıt</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tarihçe tablosu */}
        {sorted.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6, fontSize: 12 }}>
            Henüz fiyat kaydı yok. Bir kayıt eklendiğinde burada listelenir.
          </div>
        ) : (
          <div style={{ border: "1px solid #e7e5e4", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ maxHeight: 400, overflow: "auto" }}>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead style={{ background: "#f5f5f4", position: "sticky", top: 0 }}>
                  <tr>
                    <th style={th}>Tarih</th>
                    <th style={{ ...th, textAlign: "right" }}>Fiyat</th>
                    <th style={{ ...th, textAlign: "right" }}>Δ</th>
                    <th style={th}>Kaynak</th>
                    <th style={th}>Müşteri / Ref</th>
                    <th style={th}>Kaydeden</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((h, i) => {
                    const prevIdx = sorted.findIndex((_, idx) => idx === i + 1);
                    const prev = prevIdx >= 0 ? sorted[prevIdx] : null;
                    const delta = prev ? (Number(h.price) || 0) - (Number(prev.price) || 0) : null;
                    const src = SOURCE_META[h.source] || { label: h.source || "?", color: "#78716c", bg: "#fafaf9" };
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                        <td style={td}>{h.date || "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#1e40af" }}>{fmt(h.price)} EUR</td>
                        <td style={{ ...td, textAlign: "right", fontSize: 10, color: delta == null ? "#a8a29e" : delta > 0 ? "#166534" : delta < 0 ? "#dc2626" : "#78716c" }}>
                          {delta == null ? "—" : (delta > 0 ? "+" : "") + fmt(delta)}
                        </td>
                        <td style={td}>
                          <span style={{ padding: "1px 6px", fontSize: 9, fontWeight: 600, borderRadius: 2, background: src.bg, color: src.color }}>
                            {src.label}
                          </span>
                        </td>
                        <td style={td}>
                          {h.customerName || h.customerCode ? (
                            <div>
                              <div>{h.customerName || h.customerCode}</div>
                              {h.orderRef && <div style={{ fontSize: 9, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>#{h.orderRef}</div>}
                            </div>
                          ) : "—"}
                        </td>
                        <td style={{ ...td, fontSize: 9, color: "#78716c" }}>{h.by || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, borderTop: "1px solid #e7e5e4", paddingTop: 10 }}>
          <button onClick={onClose}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 800, maxHeight: "92vh", overflow: "auto" };
const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
