// İhracat Özet Dashboard
// KPI kartlar + müşteri özet tablosu + geciken/yaklaşan uyarılar + aylık trend
// Filtreler: dönem (bu ay / bu yıl / özel aralık / tümü)

import React, { useState, useMemo } from "react";
import { computeAllocatedByOrder } from "./allocationCalc";

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

const isDeliveryLabel = (label) => String(label || "").toUpperCase().includes("DELIVERY");

// Bir faturanın ödeme etiketi bazlı bekleyen tutarını hesaplar (partial için)
function computeInvoiceRemainingByLabel(inv) {
  const total = Number(inv.totalAmount) || 0;
  const paid = Number(inv.paidAmount) || 0;
  const remaining = Math.max(0, total - paid);
  const plan = Array.isArray(inv.paymentPlan) ? inv.paymentPlan.filter(p => Number(p?.pct) > 0) : [];
  if (plan.length === 0 || remaining <= 0) return {};
  // Advance önce ödenir varsayımı: non-delivery kısmı önce dolar, sonra delivery
  const nonDeliveryPct = plan.filter(p => !isDeliveryLabel(p?.label)).reduce((s, p) => s + Number(p.pct), 0);
  const deliveryPct = plan.filter(p => isDeliveryLabel(p?.label)).reduce((s, p) => s + Number(p.pct), 0);
  const nonDeliveryAmount = total * (nonDeliveryPct / 100);
  const deliveryAmount = total * (deliveryPct / 100);
  const paidTowardsDelivery = Math.max(0, paid - nonDeliveryAmount);
  const nonDeliveryRemaining = Math.max(0, nonDeliveryAmount - paid);
  const deliveryRemaining = Math.max(0, deliveryAmount - paidTowardsDelivery);
  const out = {};
  // Non-delivery satırlarına dağıt
  if (nonDeliveryRemaining > 0.005 && nonDeliveryPct > 0) {
    for (const p of plan.filter(pp => !isDeliveryLabel(pp?.label))) {
      const ratio = Number(p.pct) / nonDeliveryPct;
      out[p.label] = (out[p.label] || 0) + nonDeliveryRemaining * ratio;
    }
  }
  if (deliveryRemaining > 0.005 && deliveryPct > 0) {
    for (const p of plan.filter(pp => isDeliveryLabel(pp?.label))) {
      const ratio = Number(p.pct) / deliveryPct;
      out[p.label] = (out[p.label] || 0) + deliveryRemaining * ratio;
    }
  }
  return out;
}

export default function SummaryPanel({ invoicesData, ordersData, allocationsData, shipmentsData, exportSettings = {} }) {
  const [period, setPeriod] = useState("thisYear"); // "thisMonth" | "thisYear" | "year" | "custom" | "all"
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Sipariş filtresi hangi tarihe göre çalışsın: "orderDate" (sipariş tarihi) | "teslimTarihi"
  const [orderDateBasis, setOrderDateBasis] = useState("orderDate");

  const invoices = useMemo(() => Object.values(invoicesData?.invoices || {}), [invoicesData]);
  const orders = useMemo(() => Object.values(ordersData?.orders || {}), [ordersData]);

  // Verideki farklı yılların listesi (invoice tarihi + sipariş tarihi + teslim tarihi)
  const availableYears = useMemo(() => {
    const set = new Set();
    for (const inv of invoices) {
      if (inv?.invoiceDate) set.add(String(inv.invoiceDate).slice(0, 4));
    }
    for (const o of orders) {
      if (o?.orderDate) set.add(String(o.orderDate).slice(0, 4));
      if (o?.createdAt) set.add(String(o.createdAt).slice(0, 4));
      if (o?.teslimTarihi) set.add(String(o.teslimTarihi).slice(0, 4));
    }
    // Bugünün yılı hep dahil
    set.add(String(new Date().getFullYear()));
    return Array.from(set).filter(y => /^\d{4}$/.test(y)).sort();
  }, [invoices, orders]);

  // Dönem filtresi
  const { fromDate, toDate } = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    if (period === "thisMonth") {
      const from = new Date(y, m, 1).toISOString().slice(0, 10);
      const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
      return { fromDate: from, toDate: to };
    }
    if (period === "thisYear") {
      return { fromDate: `${y}-01-01`, toDate: `${y}-12-31` };
    }
    if (period === "year") {
      const yy = selectedYear;
      return { fromDate: `${yy}-01-01`, toDate: `${yy}-12-31` };
    }
    if (period === "custom") {
      return { fromDate: customFrom || "", toDate: customTo || "" };
    }
    return { fromDate: "", toDate: "" };
  }, [period, customFrom, customTo, selectedYear]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (!inv.invoiceDate) return period === "all";
      if (fromDate && inv.invoiceDate < fromDate) return false;
      if (toDate && inv.invoiceDate > toDate) return false;
      return true;
    });
  }, [invoices, fromDate, toDate, period]);

  // Bir siparişin filtre tarihi — orderDateBasis'e göre:
  //  - "orderDate": sipariş tarihi (VIO import) veya createdAt (manuel form)
  //  - "teslimTarihi": teslim/termin tarihi
  const getOrderFilterDate = (o) => {
    if (orderDateBasis === "teslimTarihi") {
      return o?.teslimTarihi ? String(o.teslimTarihi).slice(0, 10) : null;
    }
    if (o?.orderDate) return String(o.orderDate).slice(0, 10);
    if (o?.createdAt) return String(o.createdAt).slice(0, 10);
    return null;
  };

  // Siparişleri filtre tarihi seçimine göre filtrele — bağlı child kayıtları hariç
  // Tarihsiz sipariş yoksa dönem seçiminden bağımsız hep dahil edilir.
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (o?.isLinkedChild) return false; // sipariş özetine cascade child'lar sayılmaz
      if (period === "all") return true;
      const d = getOrderFilterDate(o);
      if (!d) return true; // hiç tarih yoksa her dönemde görünür
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, fromDate, toDate, period, orderDateBasis]);

  // Tarihsiz sipariş sayısı — bilgi rozeti için (basis'e göre değişir)
  const orderStats = useMemo(() => {
    let noDateCount = 0;
    let linkedChildCount = 0;
    for (const o of orders) {
      if (o?.isLinkedChild) linkedChildCount++;
      else if (!getOrderFilterDate(o)) noDateCount++;
    }
    return { noDateCount, linkedChildCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, orderDateBasis]);

  // Tahsis edilen miktar (order.id → allocated qty)
  const allocatedByOrder = useMemo(
    () => computeAllocatedByOrder(allocationsData?.allocations || {}, shipmentsData?.shipments || {}),
    [allocationsData, shipmentsData]
  );

  // Faturalanmış orderId set — active (VOID hariç) faturalarda linkedOrderIds
  const invoicedOrderIds = useMemo(() => {
    const s = new Set();
    for (const inv of invoices) {
      if ((inv.status || "issued") === "cancelled") continue;
      for (const oid of (inv.linkedOrderIds || [])) s.add(oid);
    }
    return s;
  }, [invoices]);

  // Sipariş KPI'ları — currency bazlı gruplu
  // Tutarları 4 kategoriye ayır:
  //  1. Önceden Sevk (VIO/dış sistem) = sevkedilenBaslangic × price
  //  2. Sistem Faturalı = tahsis × price (sipariş invoicedOrderIds'e girmişse)
  //  3. Fatura Bekliyor = tahsis × price (sevk edildi ama fatura kesilmedi)
  //  4. Henüz Sevk Yok = kalan miktar × price
  // toplam = 1 + 2 + 3 + 4 = totalAmount (orij × price)
  const orderKpis = useMemo(() => {
    const byCurrency = new Map();
    for (const o of filteredOrders) {
      const cur = o.currency || "EUR";
      if (!byCurrency.has(cur)) {
        byCurrency.set(cur, {
          openCount: 0, closedCount: 0, cancelledCount: 0,
          belgeSet: new Set(),
          totalQty: 0, priorShippedQty: 0, allocatedQty: 0, remainingQty: 0,
          totalAmount: 0, priorShippedAmount: 0,
          systemInvoicedAmount: 0, pendingInvoiceAmount: 0, notShippedAmount: 0,
        });
      }
      const b = byCurrency.get(cur);
      const status = o.status || "open";
      if (status === "open") b.openCount++;
      else if (status === "closed") b.closedCount++;
      else if (status === "cancelled") b.cancelledCount++;
      if (o.belgeNo) b.belgeSet.add(`${o.customerCode}__${o.belgeNo}`);
      if (status === "cancelled") continue;
      const orij = Number(o.orijinalMiktar) || 0;
      const sevkBas = Number(o.sevkedilenBaslangic) || 0;
      const tahsis = allocatedByOrder.get(o.id) || 0;
      const remaining = Math.max(0, orij - sevkBas - tahsis);
      const price = Number(o.birimFiyat) || 0;
      b.totalQty += orij;
      b.priorShippedQty += sevkBas;
      b.allocatedQty += tahsis;
      b.remainingQty += remaining;
      b.totalAmount += orij * price;
      b.priorShippedAmount += sevkBas * price;
      const isInvoicedInSystem = invoicedOrderIds.has(o.id);
      if (isInvoicedInSystem) b.systemInvoicedAmount += tahsis * price;
      else b.pendingInvoiceAmount += tahsis * price;
      b.notShippedAmount += remaining * price;
    }
    return Array.from(byCurrency, ([currency, v]) => ({
      currency,
      openCount: v.openCount,
      closedCount: v.closedCount,
      cancelledCount: v.cancelledCount,
      belgeCount: v.belgeSet.size,
      itemCount: v.openCount + v.closedCount, // aktifler
      totalQty: v.totalQty,
      priorShippedQty: v.priorShippedQty,
      allocatedQty: v.allocatedQty,
      shippedQty: v.priorShippedQty + v.allocatedQty,
      remainingQty: v.remainingQty,
      fillRate: v.totalQty > 0 ? Math.round(((v.priorShippedQty + v.allocatedQty) / v.totalQty) * 100) : 0,
      totalAmount: v.totalAmount,
      priorShippedAmount: v.priorShippedAmount,
      systemInvoicedAmount: v.systemInvoicedAmount,
      pendingInvoiceAmount: v.pendingInvoiceAmount,
      notShippedAmount: v.notShippedAmount,
    })).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredOrders, allocatedByOrder, invoicedOrderIds]);

  // Müşteri bazlı sipariş KPI — motor bağlı olan + olmayan hepsi listelenir
  const motorLinkedCustomers = Array.isArray(exportSettings?.motorLinkedCustomers) ? exportSettings.motorLinkedCustomers : [];
  const customerOrderKpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);

    const map = new Map(); // `${code}_${currency}` → aggregate
    for (const o of filteredOrders) {
      if ((o.status || "open") === "cancelled") continue;
      const cur = o.currency || "EUR";
      const code = o.customerCode || "(bilinmiyor)";
      const key = `${code}__${cur}`;
      if (!map.has(key)) {
        map.set(key, {
          customerCode: code,
          customerName: o.customerName || code,
          currency: cur,
          belgeSet: new Set(),
          itemCount: 0,
          totalBedel: 0,
          kalanBedel: 0,
          totalQty: 0,
          kalanQty: 0,
          overdueCount: 0,
          overdueQty: 0,
          upcomingCount: 0,
          upcomingQty: 0,
        });
      }
      const b = map.get(key);
      if (o.belgeNo) b.belgeSet.add(`${code}__${o.belgeNo}`);
      b.itemCount++;
      const orij = Number(o.orijinalMiktar) || 0;
      const sevkBas = Number(o.sevkedilenBaslangic) || 0;
      const tahsis = allocatedByOrder.get(o.id) || 0;
      const kalan = Math.max(0, orij - sevkBas - tahsis);
      const price = Number(o.birimFiyat) || 0;
      b.totalBedel += orij * price;
      b.kalanBedel += kalan * price;
      b.totalQty += orij;
      b.kalanQty += kalan;
      // Geciken / yaklaşan sayacı: sadece açık + kalan > 0 + termini olan
      if ((o.status || "open") === "open" && kalan > 0 && o.teslimTarihi) {
        if (o.teslimTarihi < today) { b.overdueCount++; b.overdueQty += kalan; }
        else if (o.teslimTarihi <= in30Str) { b.upcomingCount++; b.upcomingQty += kalan; }
      }
    }
    return Array.from(map.values()).map(x => ({
      ...x,
      belgeCount: x.belgeSet.size,
      fillRateBedel: x.totalBedel > 0 ? Math.round(((x.totalBedel - x.kalanBedel) / x.totalBedel) * 100) : 0,
      fillRateQty: x.totalQty > 0 ? Math.round(((x.totalQty - x.kalanQty) / x.totalQty) * 100) : 0,
      isMotorLinked: motorLinkedCustomers.includes(x.customerCode),
    })).sort((a, b) => b.kalanBedel - a.kalanBedel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, allocatedByOrder, exportSettings]);

  // Termin uyarıları — yaklaşan (30 gün) + geciken
  const orderTerminAlerts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);
    const upcoming = [];
    const overdue = [];
    for (const o of filteredOrders) {
      if ((o.status || "open") !== "open") continue;
      if (!o.teslimTarihi) continue;
      const orij = Number(o.orijinalMiktar) || 0;
      const sevkBas = Number(o.sevkedilenBaslangic) || 0;
      const tahsis = allocatedByOrder.get(o.id) || 0;
      const remaining = Math.max(0, orij - sevkBas - tahsis);
      if (remaining <= 0) continue;
      if (o.teslimTarihi < today) overdue.push(o);
      else if (o.teslimTarihi <= in30Str) upcoming.push(o);
    }
    // Sıralama: önce müşteri adı, sonra termin (aynı müşterinin kayıtları peş peşe gelsin)
    const sortByCustomerThenTermin = (a, b) => {
      const cn = (a.customerName || a.customerCode || "").localeCompare(b.customerName || b.customerCode || "", "tr");
      if (cn !== 0) return cn;
      return (a.teslimTarihi || "").localeCompare(b.teslimTarihi || "");
    };
    overdue.sort(sortByCustomerThenTermin);
    upcoming.sort(sortByCustomerThenTermin);
    return { upcoming, overdue };
  }, [filteredOrders, allocatedByOrder]);

  // KPI hesaplamaları (currency bazlı gruplu)
  const kpis = useMemo(() => {
    const byCurrency = new Map(); // currency → {issued, paid, pending, byLabel, voidCount}
    for (const inv of filteredInvoices) {
      const cur = inv.currency || "EUR";
      if (!byCurrency.has(cur)) {
        byCurrency.set(cur, { issued: 0, paid: 0, pending: 0, byLabel: {}, voidCount: 0, issuedCount: 0 });
      }
      const bucket = byCurrency.get(cur);
      if ((inv.status || "issued") === "cancelled") {
        bucket.voidCount++;
        continue;
      }
      const total = Number(inv.totalAmount) || 0;
      const paid = Number(inv.paidAmount) || 0;
      bucket.issued += total;
      bucket.paid += paid;
      bucket.pending += Math.max(0, total - paid);
      bucket.issuedCount++;
      // Bekleyen etiketleri
      const remByLabel = computeInvoiceRemainingByLabel(inv);
      for (const [label, amt] of Object.entries(remByLabel)) {
        bucket.byLabel[label] = (bucket.byLabel[label] || 0) + amt;
      }
    }
    return Array.from(byCurrency, ([currency, v]) => ({ currency, ...v }));
  }, [filteredInvoices]);

  // Müşteri özet
  const customerSummary = useMemo(() => {
    const byCustomer = new Map(); // code → {name, currencies: Map(cur → {issued, paid, pending, count})}
    for (const inv of filteredInvoices) {
      if ((inv.status || "issued") === "cancelled") continue;
      const code = inv.customerCode || "(bilinmiyor)";
      const name = inv.customerName || code;
      const cur = inv.currency || "EUR";
      if (!byCustomer.has(code)) byCustomer.set(code, { name, currencies: new Map() });
      const c = byCustomer.get(code);
      if (!c.currencies.has(cur)) c.currencies.set(cur, { issued: 0, paid: 0, pending: 0, count: 0 });
      const b = c.currencies.get(cur);
      const total = Number(inv.totalAmount) || 0;
      const paid = Number(inv.paidAmount) || 0;
      b.issued += total;
      b.paid += paid;
      b.pending += Math.max(0, total - paid);
      b.count++;
    }
    return Array.from(byCustomer, ([code, v]) => ({
      code, name: v.name,
      currencies: Array.from(v.currencies, ([cur, b]) => ({ currency: cur, ...b })),
    })).sort((a, b) => {
      const aPending = a.currencies.reduce((s, c) => s + c.pending, 0);
      const bPending = b.currencies.reduce((s, c) => s + c.pending, 0);
      return bPending - aPending;
    });
  }, [filteredInvoices]);

  // Uyarılar — geciken tahsilat + siparişten fatura kesilmemiş
  const alerts = useMemo(() => {
    const overdue = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const inv of filteredInvoices) {
      if ((inv.status || "issued") === "cancelled") continue;
      if ((inv.paymentStatus || "unpaid") === "paid") continue;
      const remaining = (Number(inv.totalAmount) || 0) - (Number(inv.paidAmount) || 0);
      if (remaining <= 0.005) continue;
      // Faturanın en son teslim tarihi kesildikten çok geç ise "geciken"
      // Basit yaklaşım: fatura tarihinden 60+ gün geçmişse geciken
      if (!inv.invoiceDate) continue;
      const daysPassed = Math.floor((new Date(today) - new Date(inv.invoiceDate)) / (1000 * 60 * 60 * 24));
      if (daysPassed >= 60) {
        overdue.push({ inv, daysPassed, remaining });
      }
    }
    return overdue.sort((a, b) => b.daysPassed - a.daysPassed);
  }, [filteredInvoices]);

  return (
    <div>
      {/* Dönem seçici */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#57534e" }}>Dönem:</span>
        {[
          { key: "thisMonth", label: "Bu Ay" },
          { key: "thisYear", label: "Bu Yıl" },
          { key: "custom", label: "Özel Aralık" },
          { key: "all", label: "Tümü" },
        ].map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 500,
              background: period === p.key ? "#1e40af" : "#fff",
              color: period === p.key ? "#fff" : "#44403c",
              border: "1px solid " + (period === p.key ? "#1e40af" : "#d6d3d1"),
              borderRadius: 4, cursor: "pointer",
            }}>{p.label}</button>
        ))}
        {/* Yıl butonları — veride hangi yıllar varsa */}
        {availableYears.length > 0 && (
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 4, paddingLeft: 8, borderLeft: "1px solid #d6d3d1" }}>
            <span style={{ fontSize: 10, color: "#78716c" }}>Yıl:</span>
            {availableYears.map(y => {
              const isActive = period === "year" && selectedYear === y;
              return (
                <button key={y} onClick={() => { setPeriod("year"); setSelectedYear(y); }}
                  style={{
                    padding: "4px 8px", fontSize: 11, fontWeight: 500,
                    background: isActive ? "#166534" : "#fff",
                    color: isActive ? "#fff" : "#44403c",
                    border: "1px solid " + (isActive ? "#166534" : "#d6d3d1"),
                    borderRadius: 4, cursor: "pointer",
                  }}>{y}</button>
              );
            })}
          </div>
        )}
        {period === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 4 }} />
            <span style={{ fontSize: 11, color: "#78716c" }}>→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 4 }} />
          </>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#78716c" }}>
          {filteredInvoices.length} fatura {fromDate && `· ${fromDate} → ${toDate || "…"}`}
        </span>
      </div>

      {/* Sipariş KPI bloğu */}
      {orderKpis.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#44403c" }}>📦 Sipariş Özeti</div>
            {/* Basis toggle */}
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: "#78716c" }}>Filtre:</span>
              {[
                { key: "orderDate", label: "Sipariş Tarihi" },
                { key: "teslimTarihi", label: "Teslim Tarihi" },
              ].map(b => (
                <button key={b.key} onClick={() => setOrderDateBasis(b.key)}
                  style={{
                    padding: "3px 8px", fontSize: 10, fontWeight: 500,
                    background: orderDateBasis === b.key ? "#7c3aed" : "#fff",
                    color: orderDateBasis === b.key ? "#fff" : "#44403c",
                    border: "1px solid " + (orderDateBasis === b.key ? "#7c3aed" : "#d6d3d1"),
                    borderRadius: 3, cursor: "pointer",
                  }}>{b.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: "#78716c", flex: 1 }}>
              {orderDateBasis === "teslimTarihi"
                ? "Dönem: siparişin teslim tarihi alanına göre."
                : "Dönem: sipariş tarihi (orderDate / sisteme giriş) alanına göre."}
              {orderStats.noDateCount > 0 && <> {orderStats.noDateCount} sipariş tarihsiz — her dönemde görünür.</>}
              {orderStats.linkedChildCount > 0 && <> {orderStats.linkedChildCount} bağlı ürün özete dahil değil.</>}
            </div>
          </div>
          {orderKpis.map(k => (
            <div key={`order_${k.currency}`} style={{ padding: 12, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#57534e", marginBottom: 8 }}>
                💱 {k.currency} · {k.belgeCount} sipariş / {k.itemCount} aktif kalem
                {k.cancelledCount > 0 && <span style={{ marginLeft: 6, color: "#dc2626" }}>· {k.cancelledCount} iptal</span>}
              </div>
              {/* Miktar bazlı özet */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 8 }}>
                <Kpi color="#1e40af" bg="#eff6ff" label="💰 Toplam Sipariş Tutarı" value={`${fmt(k.totalAmount)} ${k.currency}`} sub={`${fmt0(k.totalQty)} adet · ${k.belgeCount} belge`} />
                <Kpi color="#166534" bg="#dcfce7" label="✅ Sevk Edilen" value={`${fmt0(k.shippedQty)} adet`} sub={`Fill rate: %${k.fillRate}`} />
                <Kpi color="#dc2626" bg="#fef2f2" label="🔮 Bekleyen Miktar" value={`${fmt0(k.remainingQty)} adet`} sub={`${k.openCount} açık kalem`} />
              </div>
              {k.totalQty > 0 && (
                <div style={{ marginBottom: 10, height: 6, background: "#f5f5f4", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${k.fillRate}%`, height: "100%", background: k.fillRate === 100 ? "#166534" : "#1e40af", transition: "width 0.3s" }} />
                </div>
              )}
              {/* Parasal detay — sevk & fatura durumuna göre */}
              <div style={{ paddingTop: 8, borderTop: "1px dashed #e7e5e4" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#78716c", marginBottom: 6 }}>
                  Toplam sipariş tutarının dağılımı (sevk & fatura durumu):
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                  <Kpi color="#0e7490" bg="#ecfeff" label="📤 Önceden Sevk (VIO)"
                    value={`${fmt(k.priorShippedAmount)} ${k.currency}`}
                    sub={`Dış sistemde faturalandı · ${fmt0(k.priorShippedQty)} adet`} />
                  <Kpi color="#166534" bg="#dcfce7" label="🧾 Sistem Faturalı"
                    value={`${fmt(k.systemInvoicedAmount)} ${k.currency}`}
                    sub="Bu sistemde sevk + fatura kesildi" />
                  <Kpi color="#78716c" bg="#fafaf9" label="🔮 Henüz Sevk Yok"
                    value={`${fmt(k.notShippedAmount)} ${k.currency}`}
                    sub="Tahsis edilmemiş kalan" />
                </div>
                {k.pendingInvoiceAmount > 0.005 && (
                  <div style={{ marginTop: 6, padding: 5, background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 3, fontSize: 10 }}>
                    ⚠ <b>{fmt(k.pendingInvoiceAmount)} {k.currency}</b> tahsis edildi ama fatura kesilmedi — sevkiyat detay'dan fatura oluştur.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Müşteri bazlı sipariş özeti */}
      {customerOrderKpis.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#44403c", marginBottom: 8 }}>
            🏢 Müşteri Bazlı Sipariş Özeti ({customerOrderKpis.length} satır)
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ background: "#f5f5f4" }}>
                <tr>
                  <th style={th}>Müşteri</th>
                  <th style={{ ...th, textAlign: "center" }}>Motor</th>
                  <th style={th}>Currency</th>
                  <th style={{ ...th, textAlign: "right" }}>Belge</th>
                  <th style={{ ...th, textAlign: "right" }}>Kalem</th>
                  <th style={{ ...th, textAlign: "right" }}>Toplam Bedel</th>
                  <th style={{ ...th, textAlign: "right" }}>Kalan Bedel</th>
                  <th style={{ ...th, textAlign: "center" }}>🔴 Geciken</th>
                  <th style={{ ...th, textAlign: "center" }}>🕐 Yaklaşan</th>
                  <th style={{ ...th, textAlign: "right" }}>Fill %</th>
                </tr>
              </thead>
              <tbody>
                {customerOrderKpis.map((k, i) => {
                  const rowBg = k.isMotorLinked ? "transparent" : "#eff6ff";
                  return (
                    <tr key={`${k.customerCode}_${k.currency}_${i}`} style={{ borderTop: "1px solid #f5f5f4", background: rowBg }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{k.customerName}</div>
                        <div style={{ fontSize: 9, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>{k.customerCode}</div>
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {k.isMotorLinked
                          ? <span title="Motor'a bağlı müşteri" style={{ fontSize: 12 }}>🔗</span>
                          : <span title="Motor'a bağlı değil — yeni müşteri" style={{ padding: "1px 5px", fontSize: 9, fontWeight: 700, background: "#dbeafe", color: "#1e40af", borderRadius: 2 }}>YENİ</span>}
                      </td>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{k.currency}</td>
                      <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{fmt0(k.belgeCount)}</td>
                      <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{fmt0(k.itemCount)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#1e40af" }}>{fmt(k.totalBedel)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: k.kalanBedel > 0 ? "#dc2626" : "#a8a29e" }}>{fmt(k.kalanBedel)}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {k.overdueCount > 0 ? (
                          <span title={`${fmt0(k.overdueQty)} adet kalan`}
                            style={{ padding: "1px 6px", fontSize: 10, fontWeight: 700, borderRadius: 2, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}>
                            {k.overdueCount} · {fmt0(k.overdueQty)}
                          </span>
                        ) : <span style={{ color: "#d6d3d1", fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {k.upcomingCount > 0 ? (
                          <span title={`${fmt0(k.upcomingQty)} adet kalan · 30 gün içinde`}
                            style={{ padding: "1px 6px", fontSize: 10, fontWeight: 700, borderRadius: 2, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                            {k.upcomingCount} · {fmt0(k.upcomingQty)}
                          </span>
                        ) : <span style={{ color: "#d6d3d1", fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <span style={{ padding: "1px 6px", fontSize: 10, fontWeight: 700, borderRadius: 2, background: k.fillRateBedel >= 100 ? "#dcfce7" : "#fef3c7", color: k.fillRateBedel >= 100 ? "#166534" : "#92400e" }}>
                          %{k.fillRateBedel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Termin uyarıları */}
      {(orderTerminAlerts.overdue.length > 0 || orderTerminAlerts.upcoming.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {orderTerminAlerts.overdue.length > 0 && (
            <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>
                🔴 Geciken Siparişler ({orderTerminAlerts.overdue.length})
              </div>
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#fef2f2" }}><tr>
                    <th style={th}>Müşteri</th><th style={th}>Belge</th><th style={th}>Stok Kodu</th><th style={th}>Ürün Adı</th><th style={th}>Termin</th><th style={{ ...th, textAlign: "right" }}>Kalan</th>
                  </tr></thead>
                  <tbody>
                    {orderTerminAlerts.overdue.map(o => {
                      const rem = Math.max(0, (Number(o.orijinalMiktar) || 0) - (Number(o.sevkedilenBaslangic) || 0) - (allocatedByOrder.get(o.id) || 0));
                      return (
                        <tr key={o.id} style={{ borderTop: "1px solid #fecaca" }}>
                          <td style={td} title={o.customerCode || ""}>{o.customerName || o.customerCode || "—"}</td>
                          <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>#{o.belgeNo}</td>
                          <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 9 }}>{o.stokKodu}</td>
                          <td style={td}>{o.stokAdi || "—"}</td>
                          <td style={{ ...td, color: "#991b1b" }}>{o.teslimTarihi}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#991b1b" }}>{fmt0(rem)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {orderTerminAlerts.upcoming.length > 0 && (
            <div style={{ padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
                🕐 Yaklaşan Terminler ({orderTerminAlerts.upcoming.length}) <span style={{ fontSize: 9, fontWeight: 400 }}>· 30 gün içinde</span>
              </div>
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#fef3c7" }}><tr>
                    <th style={th}>Müşteri</th><th style={th}>Belge</th><th style={th}>Stok Kodu</th><th style={th}>Ürün Adı</th><th style={th}>Termin</th><th style={{ ...th, textAlign: "right" }}>Kalan</th>
                  </tr></thead>
                  <tbody>
                    {orderTerminAlerts.upcoming.map(o => {
                      const rem = Math.max(0, (Number(o.orijinalMiktar) || 0) - (Number(o.sevkedilenBaslangic) || 0) - (allocatedByOrder.get(o.id) || 0));
                      return (
                        <tr key={o.id} style={{ borderTop: "1px solid #fde68a" }}>
                          <td style={td} title={o.customerCode || ""}>{o.customerName || o.customerCode || "—"}</td>
                          <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>#{o.belgeNo}</td>
                          <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 9 }}>{o.stokKodu}</td>
                          <td style={td}>{o.stokAdi || "—"}</td>
                          <td style={{ ...td, color: "#92400e" }}>{o.teslimTarihi}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#92400e" }}>{fmt0(rem)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fatura KPI ayırıcı başlık */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#44403c", marginBottom: 8, marginTop: 4 }}>💰 Fatura Özeti</div>

      {/* KPI kartları — currency bazlı */}
      {kpis.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6, marginBottom: 12 }}>
          Bu dönemde fatura yok.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {kpis.map(k => (
            <div key={k.currency} style={{ padding: 12, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#57534e", marginBottom: 8 }}>
                💱 {k.currency} · {k.issuedCount} aktif fatura {k.voidCount > 0 && `· ${k.voidCount} VOID`}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                <Kpi color="#1e40af" bg="#eff6ff" label="💰 Kesilen" value={`${fmt(k.issued)} ${k.currency}`} />
                <Kpi color="#166534" bg="#dcfce7" label="✅ Ödenen" value={`${fmt(k.paid)} ${k.currency}`} />
                <Kpi color="#dc2626" bg="#fef2f2" label="🔮 Kalan Tahsilat" value={`${fmt(k.pending)} ${k.currency}`} />
              </div>
              {Object.keys(k.byLabel).length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e7e5e4" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#78716c", marginBottom: 4 }}>Kalan tutar ödeme etiketine göre:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(k.byLabel).sort((a, b) => b[1] - a[1]).map(([label, amt]) => (
                      <div key={label} style={{ padding: "3px 8px", fontSize: 10, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 3 }}>
                        <span style={{ fontWeight: 600 }}>{label}:</span>{" "}
                        <span style={{ fontWeight: 700, color: "#dc2626" }}>{fmt(amt)} {k.currency}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Uyarılar */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 14, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>
            ⚠ Geciken Tahsilatlar ({alerts.length})
            <span style={{ fontSize: 9, color: "#78716c", fontWeight: 400, marginLeft: 6 }}>
              (fatura kesildikten 60+ gün geçmiş ve hâlâ tam ödenmemiş)
            </span>
          </div>
          <div style={{ maxHeight: 400, overflow: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "#fef2f2" }}>
                <tr>
                  <th style={th}>Fatura No</th>
                  <th style={th}>Tarih</th>
                  <th style={th}>Müşteri</th>
                  <th style={{ ...th, textAlign: "right" }}>Kalan</th>
                  <th style={{ ...th, textAlign: "right" }}>Gün</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.inv.invoiceNo} style={{ borderTop: "1px solid #fecaca" }}>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{a.inv.invoiceNo}</td>
                    <td style={td}>{a.inv.invoiceDate}</td>
                    <td style={td}>{a.inv.customerName}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#991b1b" }}>{fmt(a.remaining)} {a.inv.currency}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{a.daysPassed}g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Müşteri özet tablosu */}
      {customerSummary.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ padding: 10, background: "#fafaf9", borderBottom: "1px solid #e7e5e4", fontSize: 12, fontWeight: 600 }}>
            🏢 Müşteri Bazlı Özet ({customerSummary.length} müşteri)
          </div>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead style={{ background: "#f5f5f4" }}>
              <tr>
                <th style={th}>Müşteri</th>
                <th style={th}>Currency</th>
                <th style={{ ...th, textAlign: "right" }}>Fatura</th>
                <th style={{ ...th, textAlign: "right" }}>Kesilen</th>
                <th style={{ ...th, textAlign: "right" }}>Ödenen</th>
                <th style={{ ...th, textAlign: "right" }}>Kalan</th>
              </tr>
            </thead>
            <tbody>
              {customerSummary.flatMap(c => c.currencies.map((b, i) => (
                <tr key={`${c.code}_${b.currency}`} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={td}>
                    {i === 0 && (
                      <>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 9, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>{c.code}</div>
                      </>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{b.currency}</td>
                  <td style={{ ...td, textAlign: "right", color: "#78716c" }}>{fmt0(b.count)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#1e40af" }}>{fmt(b.issued)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#166534" }}>{fmt(b.paid)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, color: b.pending > 0 ? "#dc2626" : "#a8a29e" }}>{fmt(b.pending)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color, bg, sub }) {
  return (
    <div style={{ padding: "8px 10px", background: bg || "#fafaf9", borderRadius: 4 }}>
      <div style={{ fontSize: 10, color: "#57534e", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || "#44403c", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
