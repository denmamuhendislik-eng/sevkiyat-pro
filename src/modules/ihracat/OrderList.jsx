// İhracat Sipariş Listesi — sipariş bazlı gruplu görünüm
// Aynı belgeNo + customerCode = tek "sipariş" (11 grup, 68 kalem gibi).
// Grup başlığında müşteri + belge + tarih + özet (kalem sayısı, kalan toplam, teslim özet)
// Grup expand → kalemleri liste eder (miktar, sevk, kalan, birim fiyat, termin)
// "✏ Siparişi Düzenle" → OrderHeaderEditModal (teslim + ödeme + currency toplu)
// "Durum" dropdown → grup bazlı toplu status değişimi

import React, { useState, useMemo } from "react";
import {
  computeAllocatedByOrder, computeOrderFillStatus, computeOrderRemaining,
} from "./allocationCalc";
import { updateExportOrderStatus, deleteExportOrder, bulkUpdateOrdersByBelge } from "./firestore";
import OrderHeaderEditModal from "./OrderHeaderEditModal";

const STATUS_LABELS = {
  open: { label: "Açık", bg: "#dbeafe", fg: "#1e40af" },
  closed: { label: "Kapalı", bg: "#dcfce7", fg: "#166534" },
  cancelled: { label: "İptal", bg: "#fef2f2", fg: "#991b1b" },
};

// Ödeme planı → kısa özet ("30/70" gibi)
function summarizePaymentPlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return "—";
  return plan.map(p => `%${p.pct}`).join(" + ");
}

export default function OrderList({ ordersData, allocationsData, settings, products, canEdit, userEmail, onEdit, motorSync, combRules = [] }) {
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [expandedBelge, setExpandedBelge] = useState(new Set());
  const [editingGroup, setEditingGroup] = useState(null); // group obj → OrderHeaderEditModal açar

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

  // Sipariş bazlı gruplaştırma — belgeNo + customerCode key
  const groups = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    const map = new Map();
    for (const o of orders) {
      if (!o) continue;
      if (customerFilter !== "all" && o.customerCode !== customerFilter) continue;
      // Grup bazında filtreleme sonrası kalemleri ekle; status filtresi kalem seviyesinde
      // uygulanır ama gruplama yine belgeNo bazlı — bir belgede karışık status varsa görünür.
      if (!q) {
        // filtrasyon yok, direkt ekle
      } else {
        const hay = `${o.belgeNo || ""} ${o.stokKodu || ""} ${o.stokAdi || ""} ${o.descriptionEn || ""} ${o.customerName || ""}`.toLocaleLowerCase("tr-TR");
        if (!hay.includes(q)) continue;
      }
      const key = `${o.customerCode || ""}__${o.belgeNo || ""}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          customerCode: o.customerCode || "",
          customerName: o.customerName || "",
          belgeNo: o.belgeNo || "",
          items: [],
          // Header alanları — grup içindeki ilk kalemden alınır (toplu güncelleme sonrası hepsi aynı olur)
          deliveryTerms: o.deliveryTerms || "",
          paymentPlan: o.paymentPlan || [],
          currency: o.currency || "",
          teslimTarihi: o.teslimTarihi || "",
          orderDate: o.orderDate || "",
        });
      }
      map.get(key).items.push(o);
      // Grup içindeki ilk dolu orderDate'i tut (VIO'dan gelen genelde aynıdır)
      if (!map.get(key).orderDate && o.orderDate) map.get(key).orderDate = o.orderDate;
    }
    // Status filtresi grup düzeyine uygulanır: "open" seçildiyse en az bir kalemi açık olan grupları göster.
    let list = Array.from(map.values());
    if (statusFilter !== "all") {
      list = list.filter(g => g.items.some(o => (o.status || "open") === statusFilter));
    }
    // Sıralama: en yeni sipariş tarihli önce (grup içindeki en geç orderDate)
    // orderDate yoksa createdAt'e fallback → hiçbir tarih yoksa en sona
    list.sort((a, b) => {
      const pick = (o) => o.orderDate || (o.createdAt ? String(o.createdAt).slice(0, 10) : "") || "";
      const at = a.items.reduce((mx, o) => { const d = pick(o); return d > mx ? d : mx; }, "");
      const bt = b.items.reduce((mx, o) => { const d = pick(o); return d > mx ? d : mx; }, "");
      return (bt || "").localeCompare(at || "");
    });
    return list;
  }, [orders, search, customerFilter, statusFilter]);

  const kpi = useMemo(() => {
    const openOrders = orders.filter(o => (o.status || "open") === "open");
    let toplamKalan = 0;
    for (const o of openOrders) toplamKalan += computeOrderRemaining(o, allocatedByOrder);
    // Sipariş sayısı = unique (customerCode + belgeNo)
    const orderKeys = new Set();
    for (const o of orders) if (o?.customerCode && o?.belgeNo) orderKeys.add(`${o.customerCode}__${o.belgeNo}`);
    return {
      totalOrders: orderKeys.size,
      totalItems: orders.length,
      openItems: openOrders.length,
      toplamKalan,
    };
  }, [orders, allocatedByOrder]);

  const toggleExpand = (key) => setExpandedBelge(prev => {
    const s = new Set(prev);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  });

  const handleGroupStatusChange = async (group, newStatus) => {
    if (!canEdit) return;
    if (!confirm(`${group.items.length} kalemin durumu "${STATUS_LABELS[newStatus]?.label || newStatus}" olarak güncellensin mi?`)) return;
    try {
      await bulkUpdateOrdersByBelge({
        customerCode: group.customerCode,
        belgeNo: group.belgeNo,
        patch: { status: newStatus },
      }, { canEdit, userEmail });
      // Motor sync — her kalem için open ↔ cancelled geçişi
      // Bağlı (isLinkedChild) kayıtlar atlanır: parent cascade zaten yd.orders'a yazıyor
      if (motorSync?.enabled && motorSync.apply) {
        const isActiveNew = newStatus !== "cancelled";
        for (const it of group.items) {
          if (it.pid == null) continue;
          if (it.isLinkedChild) continue; // parent'ın cascade'i child'ı halleder
          const wasActive = (it.status || "open") !== "cancelled";
          if (wasActive === isActiveNew) continue;
          const netQty = Math.max(0, (Number(it.orijinalMiktar) || 0) - (Number(it.sevkedilenBaslangic) || 0));
          const orderYear = it.teslimTarihi
            ? Number(String(it.teslimTarihi).slice(0, 4))
            : new Date().getFullYear();
          const delta = isActiveNew ? +netQty : -netQty;
          if (delta !== 0 && Number.isFinite(orderYear) && orderYear > 2020) {
            motorSync.apply({ pid: it.pid, deltaQty: delta, year: orderYear, cascade: true });
          }
        }
      }
    } catch (e) {
      alert("Durum güncellenemedi: " + e.message);
    }
  };

  const handleItemStatusChange = async (order, newStatus) => {
    if (!canEdit) return;
    // Bağlı child kayıtlarını da güncelle (aynı belgeNo + linkedParentPid=order.pid)
    const linkedChildren = order.isLinkedChild ? [] : orders.filter(x =>
      x.isLinkedChild && x.belgeNo === order.belgeNo && Number(x.linkedParentPid) === Number(order.pid)
    );
    try {
      await updateExportOrderStatus(order.id, newStatus, { canEdit, userEmail });
      for (const child of linkedChildren) {
        try { await updateExportOrderStatus(child.id, newStatus, { canEdit, userEmail }); }
        catch (childErr) { console.warn("Bağlı child status güncellenemedi:", child.id, childErr.message); }
      }
      // Motor sync — status open ↔ cancelled geçişi, SADECE parent için (cascade child'ı halleder)
      if (motorSync?.enabled && motorSync.apply && order.pid != null && !order.isLinkedChild) {
        const oldStatus = order.status || "open";
        const wasActive = oldStatus !== "cancelled";
        const isActive = newStatus !== "cancelled";
        if (wasActive !== isActive) {
          const netQty = Math.max(0, (Number(order.orijinalMiktar) || 0) - (Number(order.sevkedilenBaslangic) || 0));
          const orderYear = order.teslimTarihi
            ? Number(String(order.teslimTarihi).slice(0, 4))
            : new Date().getFullYear();
          const delta = isActive ? +netQty : -netQty;
          if (delta !== 0 && Number.isFinite(orderYear) && orderYear > 2020) {
            motorSync.apply({ pid: order.pid, deltaQty: delta, year: orderYear, cascade: true });
          }
        }
      }
    } catch (e) {
      alert("Durum güncellenemedi: " + e.message);
    }
  };

  const handleDeleteItem = async (order) => {
    if (!canEdit) return;
    // Bağlı child kayıtları — parent'ın silinmesiyle beraber silinir
    const linkedChildren = order.isLinkedChild ? [] : orders.filter(x =>
      x.isLinkedChild && x.belgeNo === order.belgeNo && Number(x.linkedParentPid) === Number(order.pid)
    );
    const extraMsg = linkedChildren.length > 0
      ? `\n\n🔗 ${linkedChildren.length} bağlı ürün kaydı da silinecek.`
      : "";
    if (!confirm(`Kalem silinsin mi?\n\nBelge ${order.belgeNo} · ${order.stokKodu}${extraMsg}`)) return;
    try {
      await deleteExportOrder(order.id, { canEdit, userEmail });
      // Bağlı child'ları da sil
      for (const child of linkedChildren) {
        try { await deleteExportOrder(child.id, { canEdit, userEmail }); }
        catch (childErr) { console.warn("Bağlı child silinemedi:", child.id, childErr.message); }
      }
      // Motor sync — sadece parent (isLinkedChild değil) için — cascade otomatik children'a düşer
      if (motorSync?.enabled && motorSync.apply && order.pid != null && !order.isLinkedChild && (order.status || "open") !== "cancelled") {
        const netQty = Math.max(0, (Number(order.orijinalMiktar) || 0) - (Number(order.sevkedilenBaslangic) || 0));
        const orderYear = order.teslimTarihi
          ? Number(String(order.teslimTarihi).slice(0, 4))
          : new Date().getFullYear();
        if (netQty > 0 && Number.isFinite(orderYear) && orderYear > 2020) {
          motorSync.apply({ pid: order.pid, deltaQty: -netQty, year: orderYear, cascade: true });
        }
      }
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  return (
    <div>
      {/* KPI bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Kpi label="Sipariş" value={kpi.totalOrders} color="#1e40af" sub={`${kpi.totalItems} kalem`} />
        <Kpi label="Açık Kalem" value={kpi.openItems} color="#166534" />
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
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{groups.length} sipariş</span>
      </div>

      {groups.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8, fontSize: 12 }}>
          {orders.length === 0
            ? "Henüz ihracat siparişi yok. + Yeni Sipariş ile başla veya Excel Import kullan."
            : "Filtreye uyan sipariş yok."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map(g => {
            const isExp = expandedBelge.has(g.key);
            const totalOrij = g.items.reduce((s, o) => s + Number(o.orijinalMiktar || 0), 0);
            const totalKalan = g.items.reduce((s, o) => s + computeOrderRemaining(o, allocatedByOrder), 0);
            const openCount = g.items.filter(o => (o.status || "open") === "open").length;
            // Grup statüsü: hepsi aynı ise onu, karışıksa "mixed"
            const statuses = new Set(g.items.map(o => o.status || "open"));
            const groupStatus = statuses.size === 1 ? Array.from(statuses)[0] : "mixed";
            return (
              <div key={g.key} style={{ background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, overflow: "hidden" }}>
                {/* Grup başlığı */}
                <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", background: isExp ? "#eff6ff" : "#fafaf9", cursor: "pointer" }}
                  onClick={() => toggleExpand(g.key)}>
                  <div style={{ fontSize: 14, color: "#78716c" }}>{isExp ? "▼" : "▶"}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Belge #{g.belgeNo}</span>
                      <span style={{ fontSize: 11, color: "#57534e" }}>{g.customerName}</span>
                      <span style={{ fontSize: 10, color: "#78716c" }}>
                        · {g.items.length} kalem · {totalKalan.toLocaleString("tr-TR")}/{totalOrij.toLocaleString("tr-TR")} kalan
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "#78716c", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span title={g.deliveryTerms}>🚚 {g.deliveryTerms ? (g.deliveryTerms.length > 30 ? g.deliveryTerms.slice(0, 30) + "…" : g.deliveryTerms) : <span style={{ color: "#dc2626" }}>Teslim şekli girilmemiş</span>}</span>
                      <span>💳 {summarizePaymentPlan(g.paymentPlan)}</span>
                      <span>💱 {g.currency || "—"}</span>
                      {g.orderDate && <span title="Sipariş tarihi">📥 {g.orderDate}</span>}
                      {g.teslimTarihi && <span title="Termin">📅 {g.teslimTarihi}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                    {groupStatus === "mixed" ? (
                      <span title={`${openCount} açık, ${g.items.length - openCount} diğer`}
                        style={{ padding: "2px 8px", fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 3, fontWeight: 600 }}>
                        KARIŞIK
                      </span>
                    ) : (
                      <select value={groupStatus} onChange={e => handleGroupStatusChange(g, e.target.value)} disabled={!canEdit}
                        style={{ padding: "3px 6px", fontSize: 10, fontWeight: 600, border: "1px solid " + STATUS_LABELS[groupStatus].fg, borderRadius: 3, background: STATUS_LABELS[groupStatus].bg, color: STATUS_LABELS[groupStatus].fg, cursor: canEdit ? "pointer" : "not-allowed" }}>
                        <option value="open">Açık (toplu)</option>
                        <option value="closed">Kapalı (toplu)</option>
                        <option value="cancelled">İptal (toplu)</option>
                      </select>
                    )}
                    <button onClick={() => setEditingGroup(g)} disabled={!canEdit}
                      title="Sipariş bazlı düzenle (teslim şekli / ödeme planı / currency — tüm kalemlere yansır)"
                      style={{ padding: "3px 10px", fontSize: 11, background: "#1e40af", color: "#fff", border: "none", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500 }}>
                      ✏ Siparişi Düzenle
                    </button>
                  </div>
                </div>

                {/* Kalemler */}
                {isExp && (
                  <div style={{ borderTop: "1px solid #e7e5e4" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead style={{ background: "var(--color-background-secondary)" }}>
                        <tr>
                          <th style={th}>Stok Kodu</th>
                          <th style={{ ...th, minWidth: 200 }}>Ürün (TR / EN)</th>
                          <th style={{ ...th, textAlign: "right" }}>Miktar</th>
                          <th style={{ ...th, textAlign: "right" }}>Sevk (VIO)</th>
                          <th style={{ ...th, textAlign: "right" }}>Tahsis</th>
                          <th style={{ ...th, textAlign: "right", background: "#eff6ff" }}>Kalan</th>
                          <th style={{ ...th, textAlign: "right" }}>Birim Fiyat</th>
                          <th style={th}>Termin</th>
                          <th style={{ ...th, textAlign: "center", width: 90 }}>Durum</th>
                          <th style={{ ...th, textAlign: "center", width: 80 }}>Aksiyon</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Kalemler — gerçek + bağlı (isLinkedChild) beraber, bağlılar sonda sıralanır */}
                        {(() => {
                          const sortedItems = [...g.items].sort((a, b) => {
                            const aL = !!a.isLinkedChild;
                            const bL = !!b.isLinkedChild;
                            if (aL !== bL) return aL ? 1 : -1; // linked'lar sona
                            return 0;
                          });
                          return sortedItems;
                        })().map(o => {
                          const tahsis = allocatedByOrder.get(o.id) || 0;
                          const fill = computeOrderFillStatus(o, allocatedByOrder);
                          const stMeta = STATUS_LABELS[o.status || "open"];
                          const isLinked = !!o.isLinkedChild;
                          return (
                            <tr key={o.id} style={{ borderTop: "1px solid #f5f5f4", background: isLinked ? "#fafaf9" : "transparent" }}>
                              <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>
                                {isLinked && <span style={{ padding: "1px 5px", fontSize: 8, fontWeight: 700, background: "rgba(30,64,175,0.12)", color: "#1e40af", borderRadius: 2, marginRight: 4 }}>🔗 BAĞLI</span>}
                                {o.stokKodu || "—"}
                              </td>
                              <td style={td}>
                                <div>{o.stokAdi || "—"}</div>
                                {o.descriptionEn && <div style={{ fontSize: 9, color: "#78716c", fontStyle: "italic" }}>{o.descriptionEn}</div>}
                                {isLinked && o.linkedParentStokKodu && (
                                  <div style={{ fontSize: 8, color: "#a8a29e", marginTop: 2 }}>Parent: {o.linkedParentStokKodu}</div>
                                )}
                              </td>
                              <td style={{ ...td, textAlign: "right" }}>{Number(o.orijinalMiktar || 0).toLocaleString("tr-TR")}</td>
                              <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{Number(o.sevkedilenBaslangic || 0).toLocaleString("tr-TR")}</td>
                              <td style={{ ...td, textAlign: "right", color: tahsis > 0 ? "#166534" : "#a8a29e" }}>{tahsis.toLocaleString("tr-TR")}</td>
                              <td style={{ ...td, textAlign: "right", fontWeight: 700, background: "#eff6ff", color: fill.remaining === 0 ? "#166534" : "#1e40af" }}>
                                {fill.remaining.toLocaleString("tr-TR")}
                              </td>
                              <td style={{ ...td, textAlign: "right" }}>
                                {o.birimFiyat != null ? `${Number(o.birimFiyat).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${o.currency || ""}` : "—"}
                              </td>
                              <td style={{ ...td, fontSize: 10 }}>{o.teslimTarihi || "—"}</td>
                              <td style={{ ...td, textAlign: "center" }}>
                                {isLinked ? (
                                  <span title="Bağlı ürünün durumu parent'a bağlıdır" style={{ padding: "2px 6px", fontSize: 9, fontWeight: 600, borderRadius: 3, background: stMeta.bg, color: stMeta.fg, opacity: 0.75 }}>{stMeta.label}</span>
                                ) : (
                                  <select value={o.status || "open"} onChange={e => handleItemStatusChange(o, e.target.value)} disabled={!canEdit}
                                    style={{ padding: "2px 6px", fontSize: 9, fontWeight: 600, border: "1px solid " + stMeta.fg, borderRadius: 3, background: stMeta.bg, color: stMeta.fg, cursor: canEdit ? "pointer" : "not-allowed" }}>
                                    <option value="open">Açık</option>
                                    <option value="closed">Kapalı</option>
                                    <option value="cancelled">İptal</option>
                                  </select>
                                )}
                              </td>
                              <td style={{ ...td, textAlign: "center" }}>
                                <button onClick={() => onEdit(o)} disabled={!canEdit}
                                  title={isLinked
                                    ? "Bağlı ürünü düzenle (birim fiyat ve İngilizce ürün adı değiştirilebilir)"
                                    : "Kalem içi bilgileri düzenle (miktar, fiyat, termin)"}
                                  style={{ padding: "2px 6px", fontSize: 10, marginRight: 3, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>✏</button>
                                {!isLinked && (
                                  <button onClick={() => handleDeleteItem(o)} disabled={!canEdit}
                                    style={{ padding: "2px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                                )}
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
          })}
        </div>
      )}

      {/* Header düzenleme modal */}
      {editingGroup && (
        <OrderHeaderEditModal
          group={editingGroup}
          settings={settings}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setEditingGroup(null)}
          onSaved={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, color, sub }) {
  return (
    <div style={{ padding: "8px 12px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#78716c", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#44403c" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#78716c" }}>{sub}</div>}
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
