// İhracat Özet Dashboard
// KPI kartlar + müşteri özet tablosu + geciken/yaklaşan uyarılar + aylık trend
// Filtreler: dönem (bu ay / bu yıl / özel aralık / tümü)

import React, { useState, useMemo } from "react";

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

export default function SummaryPanel({ invoicesData, ordersData }) {
  const [period, setPeriod] = useState("thisYear"); // "thisMonth" | "thisYear" | "custom" | "all"
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const invoices = useMemo(() => Object.values(invoicesData?.invoices || {}), [invoicesData]);
  const orders = useMemo(() => Object.values(ordersData?.orders || {}), [ordersData]);

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
    if (period === "custom") {
      return { fromDate: customFrom || "", toDate: customTo || "" };
    }
    return { fromDate: "", toDate: "" };
  }, [period, customFrom, customTo]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (!inv.invoiceDate) return period === "all";
      if (fromDate && inv.invoiceDate < fromDate) return false;
      if (toDate && inv.invoiceDate > toDate) return false;
      return true;
    });
  }, [invoices, fromDate, toDate, period]);

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
    return overdue.sort((a, b) => b.daysPassed - a.daysPassed).slice(0, 10);
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
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff" }}>
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

function Kpi({ label, value, color, bg }) {
  return (
    <div style={{ padding: "8px 10px", background: bg || "#fafaf9", borderRadius: 4 }}>
      <div style={{ fontSize: 10, color: "#57534e", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || "#44403c", marginTop: 2 }}>{value}</div>
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
