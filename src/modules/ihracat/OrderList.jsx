// İhracat Sipariş Listesi
// Kalıcı ana kullanım — müşteri filtre + arama + kalan renk kodlaması
// Satır tıklanınca detay (ödeme planı, teslim şekli, tahsis geçmişi)

import React, { useState, useMemo } from "react";
import {
  computeAllocatedByOrder, computeOrderFillStatus, computeOrderRemaining,
} from "./allocationCalc";
import { updateExportOrderStatus, deleteExportOrder } from "./firestore";

const STATUS_LABELS = {
  open: { label: "Açık", bg: "#dbeafe", fg: "#1e40af" },
  closed: { label: "Kapalı", bg: "#dcfce7", fg: "#166534" },
  cancelled: { label: "İptal", bg: "#fef2f2", fg: "#991b1b" },
};

export default function OrderList({ ordersData, allocationsData, settings, products, canEdit, userEmail, onEdit }) {
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [expandedId, setExpandedId] = useState(null);

  const orders = useMemo(() => Object.values(ordersData?.orders || {}), [ordersData]);
  const allocatedByOrder = useMemo(() => computeAllocatedByOrder(allocationsData?.allocations || {}), [allocationsData]);

  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      if (!o?.customerCode) continue;
      if (!map.has(o.customerCode)) map.set(o.customerCode, o.customerName || o.customerCode);
    }
    return Array.from(map, ([code, name]) => ({ code, name }));
  }, [orders]);

  const list = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return orders
      .filter(o => {
        if (customerFilter !== "all" && o.customerCode !== customerFilter) return false;
        if (statusFilter !== "all" && (o.status || "open") !== statusFilter) return false;
        if (!q) return true;
        const hay = `${o.belgeNo || ""} ${o.stokKodu || ""} ${o.stokAdi || ""} ${o.descriptionEn || ""} ${o.customerName || ""}`.toLocaleLowerCase("tr-TR");
        return hay.includes(q);
      })
      .sort((a, b) => (b.teslimTarihi || "").localeCompare(a.teslimTarihi || ""));
  }, [orders, search, customerFilter, statusFilter]);

  const kpi = useMemo(() => {
    const openOrders = orders.filter(o => (o.status || "open") === "open");
    let toplamKalan = 0;
    for (const o of openOrders) toplamKalan += computeOrderRemaining(o, allocatedByOrder);
    return {
      total: orders.length,
      open: openOrders.length,
      toplamKalan,
    };
  }, [orders, allocatedByOrder]);

  const handleStatusChange = async (order, newStatus) => {
    if (!canEdit) return;
    try {
      await updateExportOrderStatus(order.id, newStatus, { canEdit, userEmail });
    } catch (e) {
      alert("Durum güncellenemedi: " + e.message);
    }
  };

  const handleDelete = async (order) => {
    if (!canEdit) return;
    if (!confirm(`Silinsin mi?\n\nBelge ${order.belgeNo} · ${order.stokKodu}`)) return;
    try {
      await deleteExportOrder(order.id, { canEdit, userEmail });
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  return (
    <div>
      {/* KPI bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Kpi label="Toplam Sipariş" value={kpi.total} />
        <Kpi label="Açık" value={kpi.open} color="#1e40af" />
        <Kpi label="Toplam Kalan Miktar" value={kpi.toplamKalan.toLocaleString("tr-TR")} color="#166534" />
      </div>

      {/* Filtre bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="🔎 Belge / stok / ürün adı ara..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }} />
        <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid var(--color-border-secondary)", borderRadius: 4 }}>
          <option value="all">Tüm Müşteriler ({customerOptions.length})</option>
          {customerOptions.map(c => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 2 }}>
          {[
            { key: "open", label: "Açık" },
            { key: "closed", label: "Kapalı" },
            { key: "cancelled", label: "İptal" },
            { key: "all", label: "Tümü" },
          ].map(o => (
            <button key={o.key} onClick={() => setStatusFilter(o.key)}
              style={{
                padding: "5px 10px", fontSize: 11, border: "1px solid " + (statusFilter === o.key ? "#1e40af" : "var(--color-border-secondary)"),
                background: statusFilter === o.key ? "#1e40af" : "#fff",
                color: statusFilter === o.key ? "#fff" : "#44403c",
                cursor: "pointer", borderRadius: 4,
              }}>{o.label}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{list.length} kayıt</span>
      </div>

      {/* Tablo */}
      {list.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8, fontSize: 12 }}>
          {orders.length === 0
            ? "Henüz ihracat siparişi yok. + Yeni Sipariş ile başla veya Excel Import kullan."
            : "Filtreye uyan kayıt yok."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "var(--color-background-secondary)" }}>
              <tr>
                <th style={{ ...th, width: 30 }}></th>
                <th style={th}>Müşteri</th>
                <th style={th}>Belge No</th>
                <th style={th}>Stok Kodu</th>
                <th style={{ ...th, minWidth: 220 }}>Ürün (TR / İngilizce)</th>
                <th style={{ ...th, textAlign: "right" }}>Miktar</th>
                <th style={{ ...th, textAlign: "right" }}>Tahsis</th>
                <th style={{ ...th, textAlign: "right", background: "#eff6ff" }}>Kalan</th>
                <th style={{ ...th, textAlign: "right" }}>Birim Fiyat</th>
                <th style={th}>Termin</th>
                <th style={{ ...th, textAlign: "center", width: 90 }}>Durum</th>
                <th style={{ ...th, textAlign: "center", width: 80 }}>Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {list.map(o => {
                const fill = computeOrderFillStatus(o, allocatedByOrder);
                const tahsis = allocatedByOrder.get(o.id) || 0;
                const isExpanded = expandedId === o.id;
                const rowBg = fill.status === "full" ? "#f5f5f4" : fill.status === "empty" ? "#fff" : "#fefce8";
                const stMeta = STATUS_LABELS[o.status || "open"];
                return (
                  <React.Fragment key={o.id}>
                    <tr style={{ borderTop: "1px solid #f5f5f4", background: rowBg }}>
                      <td style={{ ...td, textAlign: "center", cursor: "pointer" }} onClick={() => setExpandedId(isExpanded ? null : o.id)}>
                        {isExpanded ? "▼" : "▶"}
                      </td>
                      <td style={{ ...td, fontSize: 10 }}>{o.customerName || o.customerCode || "—"}</td>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{o.belgeNo || "—"}</td>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{o.stokKodu || "—"}</td>
                      <td style={td}>
                        <div>{o.stokAdi || "—"}</div>
                        {o.descriptionEn && <div style={{ fontSize: 9, color: "#78716c", fontStyle: "italic" }}>{o.descriptionEn}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{Number(o.orijinalMiktar || 0).toLocaleString("tr-TR")}</td>
                      <td style={{ ...td, textAlign: "right", color: tahsis > 0 ? "#166534" : "#a8a29e" }}>
                        {Number(o.sevkedilenBaslangic || 0) > 0
                          ? `${Number(o.sevkedilenBaslangic).toLocaleString("tr-TR")}+${tahsis}`
                          : tahsis.toLocaleString("tr-TR")}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, background: "#eff6ff", color: fill.remaining === 0 ? "#166534" : "#1e40af" }}>
                        {fill.remaining.toLocaleString("tr-TR")}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {o.birimFiyat != null ? `${Number(o.birimFiyat).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${o.currency || ""}` : "—"}
                      </td>
                      <td style={{ ...td, fontSize: 10 }}>{o.teslimTarihi || "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <select value={o.status || "open"} onChange={e => handleStatusChange(o, e.target.value)} disabled={!canEdit}
                          style={{ padding: "2px 6px", fontSize: 9, fontWeight: 600, border: "1px solid " + stMeta.fg, borderRadius: 3, background: stMeta.bg, color: stMeta.fg, cursor: canEdit ? "pointer" : "not-allowed" }}>
                          <option value="open">Açık</option>
                          <option value="closed">Kapalı</option>
                          <option value="cancelled">İptal</option>
                        </select>
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <button onClick={() => onEdit(o)} disabled={!canEdit}
                          style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>✏</button>
                        <button onClick={() => handleDelete(o)} disabled={!canEdit}
                          style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: "#fafaf9" }}>
                        <td colSpan={12} style={{ padding: 10 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 11 }}>
                            <div>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>Teslim & Ödeme</div>
                              <div>Teslim şekli: <b>{o.deliveryTerms || "—"}</b></div>
                              <div style={{ marginTop: 4 }}>Ödeme planı:</div>
                              {Array.isArray(o.paymentPlan) && o.paymentPlan.length > 0 ? (
                                <ul style={{ margin: "4px 0 0 20px", padding: 0, fontSize: 10 }}>
                                  {o.paymentPlan.map((p, i) => <li key={i}>{p.label} — %{p.pct}</li>)}
                                </ul>
                              ) : <div style={{ fontSize: 10, color: "#a8a29e" }}>Plan girilmemiş</div>}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>Tahsis Geçmişi</div>
                              {tahsis > 0 ? (
                                <div style={{ fontSize: 10 }}>Toplam {tahsis} adet — {Number(o.sevkedilenBaslangic || 0) > 0 ? `+ Başlangıç sevk: ${o.sevkedilenBaslangic}` : ""}</div>
                              ) : <div style={{ fontSize: 10, color: "#a8a29e" }}>Henüz konteynere tahsis edilmedi</div>}
                              <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
                                (Konteyner tahsis paneli sonraki PR'da Sevkiyat Detay ekranına eklenecek)
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ padding: "8px 12px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#78716c", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#44403c" }}>{value}</div>
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
