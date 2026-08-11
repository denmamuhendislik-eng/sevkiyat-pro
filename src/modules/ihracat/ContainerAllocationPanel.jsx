// Konteyner tahsis paneli — Sevkiyat Detay ekranındaki her konteyner kartına
// eklenir. Konteyner içindeki OFMER (veya diğer ihracat müşterisi) ürünlerini
// açık siparişlere dağıtır.
//
// Kritik davranışlar:
//   - Yalnızca konteynerdeki en az bir pid ihracat siparişinde varsa görünür.
//   - Aksi halde component null döner (render edilmez).
//   - FIFO öneri gösterilir; kullanıcı onaylayınca kayıt.
//   - Toplam ≠ konteyner miktarı → uyarı (kayıt engellenmez, kullanıcı seçer)
//   - Bakiye aşımı → kırmızı uyarı (kayıt engellenmez, dikkat için)
//   - motor kritik: yd.quantities'e HİÇ dokunulmaz; sadece containerAllocations'a yazar.

import React, { useState, useMemo, useEffect } from "react";
import {
  computeAllocatedByOrder, computeOrderRemaining, suggestFifoAllocation,
  forecastContainerBilling,
} from "./allocationCalc";
import {
  saveContainerAllocation, deleteContainerAllocation,
  subscribeExportInvoices, subscribeInvoiceSettings,
  deleteExportInvoice, cancelExportInvoice,
} from "./firestore";
import { generateInvoicePdf } from "./invoicePdf";
import InvoiceCreateModal from "./InvoiceCreateModal";
import InvoiceEditModal from "./InvoiceEditModal";

export default function ContainerAllocationPanel({
  containerId, year, items, products,
  ordersData, allocationsData, canEdit, userEmail,
}) {
  const [expandedPid, setExpandedPid] = useState(null);
  const [collapsed, setCollapsed] = useState(true);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showTransportModal, setShowTransportModal] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [invoicesData, setInvoicesData] = useState({ invoices: {} });
  const [invoiceSettings, setInvoiceSettings] = useState({});
  const [toast, setToast] = useState(""); // kısa geri bildirim

  useEffect(() => {
    const u1 = subscribeExportInvoices(d => setInvoicesData(d || { invoices: {} }));
    const u2 = subscribeInvoiceSettings(d => setInvoiceSettings(d || {}));
    return () => { u1 && u1(); u2 && u2(); };
  }, []);

  // Bu konteynere ait faturalar
  const containerInvoices = useMemo(() => {
    return Object.values(invoicesData?.invoices || {})
      .filter(inv => inv.containerId === containerId && Number(inv.year) === Number(year))
      .sort((a, b) => (a.invoiceNo || "").localeCompare(b.invoiceNo || ""));
  }, [invoicesData, containerId, year]);
  const activeInvoiceCount = containerInvoices.filter(i => (i.status || "issued") !== "cancelled").length;

  // Konteynerdeki hangi item'lar ihracat siparişinde var? Diğerlerini gösterme.
  const orders = useMemo(() => Object.values(ordersData?.orders || {}), [ordersData]);
  const openOrders = useMemo(() => orders.filter(o => (o.status || "open") === "open"), [orders]);

  const relevantItems = useMemo(() => {
    return (items || []).filter(item => {
      return openOrders.some(o =>
        o.pid != null &&
        Number(o.pid) === Number(item.pid)
      );
    });
  }, [items, openOrders]);

  const allocatedByOrder = useMemo(
    () => computeAllocatedByOrder(allocationsData?.allocations || {}),
    [allocationsData]
  );

  // Konteynerdeki ihracat müşterisi (tek müşteri varsayımı — çoklu müşteri gelirse null döner)
  const containerCustomer = useMemo(() => {
    const codes = new Map();
    for (const item of relevantItems) {
      for (const o of openOrders) {
        if (Number(o.pid) === Number(item.pid) && o.customerCode) {
          codes.set(o.customerCode, o.customerName || o.customerCode);
        }
      }
    }
    if (codes.size !== 1) return null;
    const [code, name] = [...codes.entries()][0];
    return { code, name };
  }, [relevantItems, openOrders]);

  // Toplam yağ miktarı — invoiceSettings.oilRules'a göre
  const oilCalculation = useMemo(() => {
    const rules = Array.isArray(invoiceSettings?.oilRules) ? invoiceSettings.oilRules : [];
    if (rules.length === 0) return { totalOil: 0, breakdown: [] };
    const ruleMap = new Map(rules.map(r => [Number(r.pid), Number(r.oilPerUnit) || 0]));
    let total = 0;
    const breakdown = [];
    for (const item of (items || [])) {
      const perUnit = ruleMap.get(Number(item.pid));
      if (perUnit && Number(item.qty) > 0) {
        const amt = Number(item.qty) * perUnit;
        total += amt;
        breakdown.push({ pid: item.pid, name: item.name, qty: item.qty, perUnit, amount: amt });
      }
    }
    return { totalOil: total, breakdown };
  }, [items, invoiceSettings]);

  // Öngörülen fatura toplamı (nakliye + yağ dahil)
  const forecast = useMemo(() => {
    if (relevantItems.length === 0) return null;
    return forecastContainerBilling({
      containerId, year,
      items: relevantItems,
      ordersMap: ordersData?.orders || {},
      allocationsMap: allocationsData?.allocations || {},
      allocatedByOrderMap: allocatedByOrder,
      containerInvoices,
      invoiceSettings,
    });
  }, [containerId, year, relevantItems, ordersData, allocationsData, allocatedByOrder, containerInvoices, invoiceSettings]);

  const transportPresets = useMemo(() => {
    const t = invoiceSettings?.transportDefault || { description: "TRANSPORTATION COST", unit: "AD", unitPrice: 0, currency: "EUR" };
    const oil = invoiceSettings?.oilProduct || { description: "GEAR OIL", unit: "KG", unitPrice: 0, currency: "EUR" };
    const extraLines = [
      { description: t.description, qty: 1, unit: t.unit || "AD", unitPrice: Number(t.unitPrice) || 0 },
    ];
    if (oilCalculation.totalOil > 0) {
      extraLines.push({
        description: oil.description,
        qty: Number(oilCalculation.totalOil.toFixed(3)),
        unit: oil.unit || "KG",
        unitPrice: Number(oil.unitPrice) || 0,
      });
    }
    // ORDER NR: bu konteynerdeki aktif (VOID hariç) fatura numaraları listelenir
    // → nakliye faturasında hangi ticari faturalara ait olduğu görünür
    const activeCIs = containerInvoices
      .filter(i => (i.status || "issued") !== "cancelled")
      .map(i => i.invoiceNo);
    const orderNrValue = activeCIs.length > 0
      ? `TRANSPORT - ${activeCIs.join(", ")}`
      : (containerCustomer ? `TRANSPORT - CONTAINER ${containerId || ""}` : "");
    return {
      extraLines,
      currency: t.currency || "EUR",
      // Nakliye + yağ genelde teslimatta ödeme — tek satır %100 IN ADVANCE WITH DELIVERY
      paymentPlan: [{ label: "IN ADVANCE WITH DELIVERY", pct: 100 }],
      orderNr: orderNrValue,
    };
  }, [invoiceSettings, oilCalculation, containerCustomer, containerId, containerInvoices]);

  // Hiç ilgili item yok → panel gizli (kartın kalan alanında gürültü yapmasın)
  // Yerel satış konteynerlerinde OFMER ürünü olmadığı için panel görünmez.
  if (relevantItems.length === 0) return null;

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const handleDownloadInvoice = async (inv) => {
    try { await generateInvoicePdf(inv, invoiceSettings); }
    catch (e) { alert("PDF üretilemedi: " + e.message); }
  };

  const handleDeleteInvoice = async (inv) => {
    if (!canEdit) return;
    const ok = confirm(
      `${inv.invoiceNo} numaralı faturayı SİLMEK istediğinden emin misin?\n\n` +
      `• Kayıt tamamen silinir (kurtarma yok).\n` +
      `• Bu numara ilgili yılın son numarasıysa sayaç geri alınır — yeni fatura aynı numarayı alabilir.\n` +
      `• Denetim izi bırakmak istersen SİL yerine 🚫 İPTAL (VOID) kullan.`
    );
    if (!ok) return;
    try {
      const res = await deleteExportInvoice(inv.invoiceNo, { canEdit, userEmail });
      if (res.counterRolledBack) {
        showToast(`✓ ${inv.invoiceNo} silindi. Sayaç ${res.newCounterValue}'e geri alındı — yeni fatura ${inv.invoiceNo}'yi alabilir.`);
      } else {
        showToast(`✓ ${inv.invoiceNo} silindi. (Sayaç geri alınmadı — daha sonra basılmış numaralar var.)`);
      }
    } catch (e) {
      alert("Silinemedi: " + e.message);
    }
  };

  const handleVoidInvoice = async (inv) => {
    if (!canEdit) return;
    if ((inv.status || "issued") === "cancelled") { alert("Zaten iptal"); return; }
    const reason = prompt(`${inv.invoiceNo} VOID edilecek — numara tekrar kullanılamaz.\n\nİptal sebebi:`);
    if (reason == null) return;
    try {
      await cancelExportInvoice(inv.invoiceNo, reason, { canEdit, userEmail });
      showToast(`🚫 ${inv.invoiceNo} iptal edildi (VOID)`);
    } catch (e) {
      alert("İptal edilemedi: " + e.message);
    }
  };

  // Özet: kaç item tam tahsis edilmiş
  const summary = relevantItems.map(item => {
    const key = `${year}_${containerId}_${item.pid}`;
    const alloc = allocationsData?.allocations?.[key];
    const totalAllocated = Array.isArray(alloc?.allocations)
      ? alloc.allocations.reduce((s, a) => s + Number(a.qty || 0), 0)
      : 0;
    let status = "empty";
    if (totalAllocated >= item.qty) status = "complete";
    else if (totalAllocated > 0) status = "partial";
    return { pid: item.pid, name: item.name, itemQty: item.qty, totalAllocated, status };
  });
  const completeCount = summary.filter(s => s.status === "complete").length;
  const partialCount = summary.filter(s => s.status === "partial").length;
  const emptyCount = summary.filter(s => s.status === "empty").length;

  return (
    <div style={{ marginTop: 8, marginBottom: 8, padding: 8, background: "rgba(30,64,175,0.04)", border: "1px solid rgba(30,64,175,0.2)", borderRadius: 6 }}>
      {/* Header — collapse toggle + fatura buton */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div onClick={() => setCollapsed(!collapsed)}
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#1e40af", flex: 1 }}>
          <span>{collapsed ? "▶" : "▼"}</span>
          <span>🔗 İhracat Sipariş Tahsisi ({relevantItems.length} ürün)</span>
          <div style={{ display: "flex", gap: 6, fontSize: 9 }}>
            {completeCount > 0 && <span style={{ color: "#166534" }}>✅ {completeCount} tam</span>}
            {partialCount > 0 && <span style={{ color: "#92400e" }}>◐ {partialCount} kısmi</span>}
            {emptyCount > 0 && <span style={{ color: "#78716c" }}>⭕ {emptyCount} boş</span>}
          </div>
        </div>
        {(completeCount > 0 || partialCount > 0) && (
          <button onClick={(e) => { e.stopPropagation(); setShowInvoiceModal(true); }} disabled={!canEdit}
            title={activeInvoiceCount > 0
              ? `Bu konteynerde ${activeInvoiceCount} aktif fatura var — modal içinde çift faturalama uyarısı çıkacak`
              : "Bu konteynerdeki tahsis edilmiş kalemlerden fatura(lar) oluştur"}
            style={{ padding: "3px 10px", fontSize: 10, background: "#166534", color: "#fff", border: "none", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}>
            🧾 Fatura Oluştur
            {activeInvoiceCount > 0 && (
              <span style={{ padding: "0 5px", fontSize: 9, fontWeight: 700, background: "#f59e0b", color: "#fff", borderRadius: 2 }}>
                {activeInvoiceCount} kesildi
              </span>
            )}
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); setShowTransportModal(true); }} disabled={!canEdit || !containerCustomer}
          title={!containerCustomer
            ? "Müşteri belirlenemedi (konteynerde birden fazla müşteri var veya hiç yok)"
            : oilCalculation.totalOil > 0
              ? `Nakliye + ${oilCalculation.totalOil.toFixed(2)} ${invoiceSettings?.oilProduct?.unit || "KG"} yağ ön-dolduruldu`
              : "Nakliye faturası (yağ hesabına uygun ürün yoksa yalnız nakliye satırı)"}
          style={{ padding: "3px 10px", fontSize: 10, background: containerCustomer ? "#1e40af" : "#a8a29e", color: "#fff", border: "none", borderRadius: 3, cursor: (canEdit && containerCustomer) ? "pointer" : "not-allowed", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}>
          🚚 Nakliye Faturası
          {oilCalculation.totalOil > 0 && (
            <span style={{ padding: "0 5px", fontSize: 9, fontWeight: 700, background: "#f59e0b", color: "#fff", borderRadius: 2 }}>
              +🛢 {oilCalculation.totalOil.toFixed(2)}
            </span>
          )}
        </button>
      </div>

      {toast && (
        <div style={{ marginTop: 6, padding: 6, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, fontSize: 10 }}>
          {toast}
        </div>
      )}

      {/* Öngörü — her zaman görünür (collapse'dan bağımsız) */}
      {forecast && forecast.grandTotal > 0 && (
        <div style={{ marginTop: 6, padding: 8, background: "#ffffff", border: "1px solid #dbeafe", borderRadius: 4 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 10 }}>
            <span style={{ fontSize: 11 }}>📊</span>
            <span style={{ fontWeight: 700, color: "#1e40af" }}>
              Öngörülen Fatura Toplamı: {fmt(forecast.grandTotal)} {forecast.currency}
            </span>
            {forecast.issuedTotal > 0 && (
              <span style={{ padding: "1px 6px", background: "#dcfce7", color: "#166534", borderRadius: 2, fontWeight: 600 }}>
                ✅ Kesildi: {fmt(forecast.issuedTotal)}
              </span>
            )}
            {forecast.pendingTotal > 0 && (
              <span style={{ padding: "1px 6px", background: "#dbeafe", color: "#1e40af", borderRadius: 2, fontWeight: 600 }}>
                🔮 Kalan: {fmt(forecast.pendingTotal)}
              </span>
            )}
            {forecast.mixedCurrency && (
              <span style={{ padding: "1px 6px", background: "#fef3c7", color: "#92400e", borderRadius: 2, fontWeight: 600 }}>
                ⚠ Çoklu döviz
              </span>
            )}
          </div>
          {Object.keys(forecast.byLabel).length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 9, color: "#44403c" }}>
              {Object.entries(forecast.byLabel)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([label, v]) => (
                  <div key={label} style={{ padding: "3px 8px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 3 }}>
                    <span style={{ fontWeight: 600 }}>{label}:</span>{" "}
                    <span style={{ fontWeight: 700, color: "#1e40af" }}>{fmt(v.total)}</span>
                    {v.issued > 0 && v.pending > 0 && (
                      <span style={{ marginLeft: 4, color: "#78716c", fontSize: 8 }}>
                        (✅ {fmt(v.issued)} / 🔮 {fmt(v.pending)})
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
          {forecast.warnings.length > 0 && (
            <div style={{ marginTop: 6, padding: 5, background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 3, fontSize: 9 }}>
              ⚠ {forecast.warnings.join(" · ")}
            </div>
          )}
        </div>
      )}

      {!collapsed && containerInvoices.length > 0 && (
        <div style={{ marginTop: 8, padding: 6, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#44403c", marginBottom: 4 }}>
            🧾 Bu Konteynerin Faturaları ({containerInvoices.length})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr style={{ background: "#f5f5f4" }}>
                <th style={invTh}>Fatura No</th>
                <th style={invTh}>Tarih</th>
                <th style={invTh}>Müşteri</th>
                <th style={invTh}>Order NR.</th>
                <th style={{ ...invTh, textAlign: "right" }}>Toplam</th>
                <th style={{ ...invTh, textAlign: "center" }}>Durum</th>
                <th style={{ ...invTh, textAlign: "center", width: 130 }}>Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {containerInvoices.map(inv => {
                const isVoid = (inv.status || "issued") === "cancelled";
                return (
                  <tr key={inv.invoiceNo} style={{ borderTop: "1px solid #f5f5f4", background: isVoid ? "#fafaf9" : "transparent", opacity: isVoid ? 0.7 : 1 }}>
                    <td style={{ ...invTd, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{inv.invoiceNo}</td>
                    <td style={invTd}>{inv.invoiceDate || "—"}</td>
                    <td style={invTd}>{inv.customerName || "—"}</td>
                    <td style={{ ...invTd, fontFamily: "ui-monospace, monospace", fontSize: 9 }}>{inv.orderNr || "—"}</td>
                    <td style={{ ...invTd, textAlign: "right", fontWeight: 600 }}>
                      {Number(inv.totalAmount || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {inv.currency}
                    </td>
                    <td style={{ ...invTd, textAlign: "center" }}>
                      {isVoid
                        ? <span style={{ padding: "1px 5px", fontSize: 8, fontWeight: 700, borderRadius: 2, background: "#fef2f2", color: "#991b1b" }}>VOID</span>
                        : <span style={{ padding: "1px 5px", fontSize: 8, fontWeight: 700, borderRadius: 2, background: "#dbeafe", color: "#1e40af" }}>Kesildi</span>}
                    </td>
                    <td style={{ ...invTd, textAlign: "center" }}>
                      <button onClick={() => handleDownloadInvoice(inv)} title="PDF indir"
                        style={{ padding: "1px 5px", fontSize: 9, marginRight: 2, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 2, cursor: "pointer" }}>📄</button>
                      {!isVoid && (
                        <>
                          <button onClick={() => setEditInvoice(inv)} disabled={!canEdit} title="Düzenle"
                            style={{ padding: "1px 5px", fontSize: 9, marginRight: 2, background: "#fefce8", color: "#854d0e", border: "1px solid #fde68a", borderRadius: 2, cursor: canEdit ? "pointer" : "not-allowed" }}>✏</button>
                          <button onClick={() => handleDeleteInvoice(inv)} disabled={!canEdit} title="Sil (sayaç geri alınır)"
                            style={{ padding: "1px 5px", fontSize: 9, marginRight: 2, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                          <button onClick={() => handleVoidInvoice(inv)} disabled={!canEdit} title="VOID (numara tutulur)"
                            style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: canEdit ? "pointer" : "not-allowed" }}>🚫</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!collapsed && (
        <div style={{ marginTop: 8 }}>
          {relevantItems.map(item => (
            <ItemAllocation
              key={item.pid}
              item={item}
              containerId={containerId}
              year={year}
              products={products}
              ordersData={ordersData}
              allocationsData={allocationsData}
              allocatedByOrder={allocatedByOrder}
              canEdit={canEdit}
              userEmail={userEmail}
              isExpanded={expandedPid === item.pid}
              onToggle={() => setExpandedPid(expandedPid === item.pid ? null : item.pid)}
            />
          ))}
        </div>
      )}
      {showInvoiceModal && (
        <InvoiceCreateModal
          mode="container"
          containerId={containerId}
          year={year}
          items={relevantItems}
          products={products}
          ordersData={ordersData}
          allocationsData={allocationsData}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setShowInvoiceModal(false)}
          onCreated={() => setShowInvoiceModal(false)}
        />
      )}
      {showTransportModal && containerCustomer && (
        <InvoiceCreateModal
          mode="blank"
          containerId={containerId}
          year={year}
          products={products}
          ordersData={ordersData}
          allocationsData={allocationsData}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setShowTransportModal(false)}
          onCreated={() => setShowTransportModal(false)}
          presetCustomerCode={containerCustomer.code}
          presetCustomerName={containerCustomer.name}
          presetExtraLines={transportPresets.extraLines}
          presetPaymentPlan={transportPresets.paymentPlan}
          presetCurrency={transportPresets.currency}
          presetOrderNr={transportPresets.orderNr}
          presetTitle="🚚 Nakliye Faturası Oluştur"
        />
      )}
      {editInvoice && (
        <InvoiceEditModal
          invoice={editInvoice}
          canEdit={canEdit}
          userEmail={userEmail}
          onClose={() => setEditInvoice(null)}
          onSaved={() => { /* subscription güncelliyor — modal açık kalsın */ }}
        />
      )}
    </div>
  );
}

const invTh = { padding: "3px 6px", fontWeight: 700, fontSize: 9, textAlign: "left", color: "#44403c" };
const invTd = { padding: "3px 6px", fontSize: 10, verticalAlign: "middle" };

function fmt(n) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ItemAllocation({
  item, containerId, year, products,
  ordersData, allocationsData, allocatedByOrder,
  canEdit, userEmail,
  isExpanded, onToggle,
}) {
  const key = `${year}_${containerId}_${item.pid}`;
  const currentAlloc = allocationsData?.allocations?.[key];
  const savedAllocations = Array.isArray(currentAlloc?.allocations) ? currentAlloc.allocations : [];

  const [editing, setEditing] = useState(savedAllocations);
  const [saving, setSaving] = useState(false);

  // Firestore güncellendiğinde local state'i güncelle (başka bir cihazdan değişiklik için)
  useEffect(() => {
    setEditing(savedAllocations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, currentAlloc?.updatedAt]);

  // FIFO öneri hesapla (henüz kaydetmiyoruz — sadece öneri)
  const fifoSuggestion = useMemo(() => {
    return suggestFifoAllocation({
      pid: item.pid,
      stokKodu: null,
      containerQty: item.qty,
      ordersMap: ordersData?.orders || {},
      allocatedByOrderMap: allocatedByOrder,
    });
  }, [item, ordersData, allocatedByOrder]);

  // Kayıtlı tahsis yoksa ve panel açılınca FIFO'yu default olarak öner
  useEffect(() => {
    if (isExpanded && savedAllocations.length === 0 && editing.length === 0 && fifoSuggestion.length > 0) {
      setEditing(fifoSuggestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  // Bu pid için açık siparişler (dropdown için)
  const availableOrders = useMemo(() => {
    const orders = Object.values(ordersData?.orders || {}).filter(o =>
      (o.status || "open") === "open" &&
      o.pid != null && Number(o.pid) === Number(item.pid)
    );
    return orders.map(o => ({
      order: o,
      remaining: computeOrderRemaining(o, allocatedByOrder),
    })).filter(x => x.remaining > 0).sort((a, b) =>
      (a.order.teslimTarihi || "9999").localeCompare(b.order.teslimTarihi || "9999")
    );
  }, [item, ordersData, allocatedByOrder]);

  // Editing state hesaplamaları
  const editingTotal = editing.reduce((s, a) => s + Number(a.qty || 0), 0);
  const diff = editingTotal - item.qty;

  // Bakiye aşımı kontrolü — her satır için ayrı
  const editingWithChecks = editing.map(a => {
    const orderObj = Object.values(ordersData?.orders || {}).find(o => o.id === a.orderId);
    if (!orderObj) return { ...a, overflow: false, remaining: 0 };
    const otherAllocated = (allocatedByOrder.get(a.orderId) || 0) - (savedAllocations.find(sa => sa.orderId === a.orderId)?.qty || 0);
    const availableForThisOrder = (Number(orderObj.orijinalMiktar) || 0)
                                - (Number(orderObj.sevkedilenBaslangic) || 0)
                                - otherAllocated;
    const overflow = Number(a.qty || 0) > availableForThisOrder;
    return { ...a, overflow, availableForThisOrder };
  });

  const hasOverflow = editingWithChecks.some(x => x.overflow);

  const updateAllocQty = (i, qty) => {
    setEditing(prev => prev.map((a, idx) => idx === i ? { ...a, qty: Number(qty) || 0 } : a));
  };
  const removeAlloc = (i) => setEditing(prev => prev.filter((_, idx) => idx !== i));
  const addOrder = (orderId) => {
    if (!orderId) return;
    if (editing.some(a => a.orderId === orderId)) return; // zaten var
    const o = Object.values(ordersData?.orders || {}).find(x => x.id === orderId);
    if (!o) return;
    setEditing(prev => [...prev, { orderId: o.id, belgeNo: o.belgeNo, qty: 0 }]);
  };

  const applyFifo = () => setEditing(fifoSuggestion);
  const resetToSaved = () => setEditing(savedAllocations);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const product = (products || []).find(p => Number(p.id) === Number(item.pid));
      const cleaned = editing.filter(a => Number(a.qty) > 0);
      if (cleaned.length === 0) {
        // Boş: kaydı sil
        await deleteContainerAllocation(year, containerId, item.pid, { canEdit, userEmail });
      } else {
        await saveContainerAllocation({
          year, containerId, pid: item.pid,
          stokKodu: product?.vioCode || "",
          containerQty: item.qty,
          allocations: cleaned,
        }, { canEdit, userEmail });
      }
    } catch (e) {
      alert("Kaydedilemedi: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const totalSaved = savedAllocations.reduce((s, a) => s + Number(a.qty || 0), 0);
  const savedStatus = totalSaved >= item.qty ? "complete" : totalSaved > 0 ? "partial" : "empty";
  const statusIcon = savedStatus === "complete" ? "✅" : savedStatus === "partial" ? "◐" : "⭕";
  const statusColor = savedStatus === "complete" ? "#166534" : savedStatus === "partial" ? "#92400e" : "#78716c";

  return (
    <div style={{ marginBottom: 4, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 4, padding: "6px 8px" }}>
      {/* Item satırı */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={onToggle}>
        <span style={{ fontSize: 12 }}>{isExpanded ? "▼" : "▶"}</span>
        <span style={{ fontSize: 12 }}>{statusIcon}</span>
        <span style={{ flex: 1, fontSize: 11, color: "#44403c" }}>{item.name}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>
          {totalSaved}/{item.qty}
        </span>
      </div>

      {/* Expand — tahsis edit */}
      {isExpanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e7e5e4" }}>
          {/* Aksiyon barı */}
          <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
            {fifoSuggestion.length > 0 && (
              <button onClick={applyFifo}
                title="Erken termin önce — konteyner miktarını dolduran öneri"
                style={{ padding: "2px 8px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>
                ⚡ FIFO Uygula
              </button>
            )}
            {savedAllocations.length > 0 && (
              <button onClick={resetToSaved}
                style={{ padding: "2px 8px", fontSize: 10, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>
                ↺ Kayıtlıya Dön
              </button>
            )}
          </div>

          {/* Tahsis satırları */}
          {editingWithChecks.length === 0 ? (
            <div style={{ padding: 8, textAlign: "center", fontSize: 10, color: "#78716c", background: "#fafaf9", borderRadius: 3 }}>
              Henüz tahsis yok. FIFO uygula veya aşağıdan sipariş ekle.
            </div>
          ) : (
            editingWithChecks.map((a, i) => {
              const orderObj = Object.values(ordersData?.orders || {}).find(o => o.id === a.orderId);
              return (
                <div key={a.orderId} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 6, alignItems: "center", marginBottom: 3, fontSize: 10 }}>
                  <span style={{ padding: "1px 5px", fontFamily: "ui-monospace, monospace", background: "#f5f5f4", borderRadius: 2, fontSize: 9 }}>
                    #{a.belgeNo}
                  </span>
                  <span style={{ fontSize: 9, color: "#78716c" }}>
                    {orderObj?.teslimTarihi || "—"} · kalan {a.availableForThisOrder} ad
                  </span>
                  <input type="number" value={a.qty} onChange={e => updateAllocQty(i, e.target.value)}
                    min="0" disabled={!canEdit}
                    style={{ width: 60, padding: "2px 4px", fontSize: 10, border: `1px solid ${a.overflow ? "#dc2626" : "#d6d3d1"}`, borderRadius: 2, textAlign: "right" }} />
                  <button onClick={() => removeAlloc(i)} disabled={!canEdit}
                    style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
                </div>
              );
            })
          )}

          {/* Sipariş ekle */}
          {availableOrders.length > editing.length && (
            <select value="" onChange={e => addOrder(e.target.value)} disabled={!canEdit}
              style={{ marginTop: 4, padding: "3px 6px", fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 3, width: "100%" }}>
              <option value="">+ Sipariş ekle...</option>
              {availableOrders
                .filter(x => !editing.some(a => a.orderId === x.order.id))
                .map(x => (
                  <option key={x.order.id} value={x.order.id}>
                    #{x.order.belgeNo} · termin {x.order.teslimTarihi || "—"} · {x.remaining} ad kalan
                  </option>
                ))}
            </select>
          )}

          {/* Toplam + uyarılar */}
          <div style={{ marginTop: 6, padding: 6, background: "#fafaf9", borderRadius: 3, fontSize: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Toplam Tahsis</span>
              <span style={{ fontWeight: 700, color: diff === 0 ? "#166534" : "#92400e" }}>
                {editingTotal} / {item.qty} {diff !== 0 && `(fark: ${diff > 0 ? "+" : ""}${diff})`}
              </span>
            </div>
            {diff !== 0 && (
              <div style={{ marginTop: 3, color: "#92400e", fontSize: 9 }}>
                ⚠ Toplam konteyner miktarı ({item.qty}) ile eşleşmiyor — kaydetmeden önce düzelt veya bilinçli farkla kaydet.
              </div>
            )}
            {hasOverflow && (
              <div style={{ marginTop: 3, color: "#991b1b", fontSize: 9 }}>
                🔴 Bir siparişin bakiyesinden fazla tahsis yapılıyor (kırmızı input) — kayıt yine yapılabilir ama önerilmez.
              </div>
            )}
          </div>

          {/* Kaydet + iptal */}
          <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end", gap: 4 }}>
            <button onClick={onToggle} disabled={saving}
              style={{ padding: "3px 10px", fontSize: 10, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>
              Kapat
            </button>
            <button onClick={handleSave} disabled={saving || !canEdit}
              style={{ padding: "3px 10px", fontSize: 10, background: "#166534", color: "#fff", border: "none", borderRadius: 3, cursor: (saving || !canEdit) ? "not-allowed" : "pointer", fontWeight: 500 }}>
              {saving ? "Kaydediliyor…" : "💾 Kaydet"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
