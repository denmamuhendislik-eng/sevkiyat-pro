// Mutabakat Paneli — Sevkiyat Planı vs İhracat Siparişleri
//
// Brief kritik kural: HİÇBİR VERİYİ DÜZELTMEZ, sadece gösterir.
// Import'u da bloklamaz — bilgi amaçlı sürekli çalışır.
//
// Karşılaştırma:
//   Plan tarafı: yd.orders[pid] - shipped (yıllık siparişten sevk edilmiş çıkarılmış)
//   İhracat tarafı: Σ(orijinalMiktar - sevkedilenBaslangic - Σ konteyner tahsis) [açık siparişler]
//
// Her iki taraf da aynı bilgiyi ölçüyor: OFMER'e daha ne kadar sevk kaldı.

import React, { useMemo, useEffect } from "react";
import { computeAllocatedByOrder, computeReconciliation } from "./allocationCalc";

export default function ReconciliationPanel({ ordersData, allocationsData, products, remainingByPid }) {
  const allocatedByOrder = useMemo(() => computeAllocatedByOrder(allocationsData?.allocations || {}), [allocationsData]);

  const rows = useMemo(() => {
    return computeReconciliation({
      planByPid: remainingByPid || {},
      ordersMap: ordersData?.orders || {},
      allocatedByOrderMap: allocatedByOrder,
      products,
    });
  }, [remainingByPid, ordersData, allocatedByOrder, products]);

  // Boş stok kodlu satırlar sayısı — üst uyarı için
  const emptyStockRows = useMemo(() => rows.filter(r => !r.stokKodu || !String(r.stokKodu).trim()), [rows]);

  // DEBUG: browser console'a boş stok kodlu ürünleri ve products örneğini dump et.
  // Kullanıcı F12 ile bakıp yansıtabilir. Sorun çözülünce kaldırılır.
  useEffect(() => {
    if (emptyStockRows.length === 0) return;
    // eslint-disable-next-line no-console
    console.log("[İhracat Mutabakat DEBUG] Stok kodu boş görünen satırlar:", emptyStockRows.map(r => ({
      pid: r.pid,
      name: r.name,
      planQty: r.planQty,
      orderQty: r.orderQty,
    })));
    // Products dizisinde bu pid'lere karşılık gelen ürünleri de dump et
    const debugProds = emptyStockRows.slice(0, 15).map(r => {
      const p = (products || []).find(pp => Number(pp.id) === Number(r.pid));
      return {
        pid: r.pid,
        found: !!p,
        vioCode: p?.vioCode,
        vioCodeType: typeof p?.vioCode,
        vioCodeLen: p?.vioCode ? String(p.vioCode).length : 0,
        nameTR: p?.nameTR,
      };
    });
    // eslint-disable-next-line no-console
    console.log("[İhracat Mutabakat DEBUG] products lookup (ilk 15):", debugProds);
    // eslint-disable-next-line no-console
    console.log("[İhracat Mutabakat DEBUG] products dizi boyutu:", (products || []).length,
      "· vioCode dolu:", (products || []).filter(p => p?.vioCode).length);
  }, [emptyStockRows, products]);

  const summary = useMemo(() => {
    let matched = 0, planExtra = 0, orderExtra = 0;
    for (const r of rows) {
      if (r.match) matched++;
      else if (r.diff > 0) planExtra++;
      else if (r.diff < 0) orderExtra++;
    }
    return { total: rows.length, matched, planExtra, orderExtra };
  }, [rows]);

  const planEmpty = !remainingByPid || Object.keys(remainingByPid).length === 0;
  const orderEmpty = !ordersData?.orders || Object.keys(ordersData.orders).length === 0;

  return (
    <div>
      {/* Bilgi banner */}
      <div style={{ padding: 10, marginBottom: 10, background: "var(--color-background-info)", color: "var(--color-text-info)", borderRadius: 6, fontSize: 12 }}>
        🔍 <b>Mutabakat</b> — Sevkiyat Planı (yıllık) sevk edilecek kalan miktarı <b>vs</b> İhracat Siparişleri açık bakiyesi.
        İkisi <b>birebir tutmalı</b>. Bu panel sadece gösterir; verileri düzeltmez.
      </div>

      {/* Özet kartlar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
        <SumBox label="Toplam Ürün" value={summary.total} />
        <SumBox label="✅ Tutuyor" value={summary.matched} color="#166534" />
        <SumBox label="⚠ Plan Fazlası" value={summary.planExtra} color={summary.planExtra > 0 ? "#92400e" : "#78716c"}
          sub="Plan'da var, siparişte yok" />
        <SumBox label="⚠ Sipariş Fazlası" value={summary.orderExtra} color={summary.orderExtra > 0 ? "#92400e" : "#78716c"}
          sub="Siparişte var, plan'da yok" />
      </div>

      {(planEmpty || orderEmpty) && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11 }}>
          {planEmpty && "⚠ Sevkiyat Planı verisi yok — mutabakat yapılamıyor. "}
          {orderEmpty && "⚠ Henüz ihracat siparişi yok — Excel Import veya Yeni Sipariş ile başla."}
        </div>
      )}

      {emptyStockRows.length > 0 && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11 }}>
          ⚠ <b>{emptyStockRows.length}</b> ürünün VIO stok kodu mutabakat panelinde görüntülenemiyor.
          Products ekranında bu ürünlerin <code>vioCode</code> alanı boş olabilir <b>veya</b> data akışında bir sorun var.
          Detay için tarayıcı console'unu aç (F12) — geçici debug logu yazılıyor.
          Aşağıda satırlarda ürün id (<code>#pid</code>) görürsün, Products ekranından kontrol edebilirsin.
        </div>
      )}

      {/* Tablo */}
      <div style={{ background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 6, overflow: "auto", maxHeight: 600 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ background: "var(--color-background-secondary)", position: "sticky", top: 0 }}>
            <tr>
              <th style={{ ...th, width: 40, textAlign: "center" }}></th>
              <th style={th}>Stok Kodu</th>
              <th style={{ ...th, minWidth: 240 }}>Ürün Adı</th>
              <th style={{ ...th, textAlign: "right" }}>Plan Kalan</th>
              <th style={{ ...th, textAlign: "right" }}>Sipariş Kalan</th>
              <th style={{ ...th, textAlign: "right", fontWeight: 700 }}>Fark</th>
              <th style={{ ...th, textAlign: "center", width: 100 }}>Durum</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>
                {planEmpty || orderEmpty ? "Veri yükleniyor..." : "Karşılaştırılacak ürün yok"}
              </td></tr>
            ) : rows.map((r, i) => {
              const bg = r.match ? "transparent" : (r.diff > 0 ? "#fef3c7" : "#fef2f2");
              const icon = r.match ? "✅" : (r.diff > 0 ? "📈" : "📉");
              const status = r.match ? "Tutuyor" : (r.diff > 0 ? "Plan Fazlası" : "Sipariş Fazlası");
              const statusColor = r.match ? "#166534" : (r.diff > 0 ? "#92400e" : "#991b1b");
              return (
                <tr key={i} style={{ borderTop: "1px solid #f5f5f4", background: bg }}>
                  <td style={{ ...td, textAlign: "center", fontSize: 14 }}>{icon}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>
                    {r.stokKodu && String(r.stokKodu).trim()
                      ? r.stokKodu
                      : (r.pid != null
                          ? <span style={{ color: "#92400e", fontStyle: "italic" }} title="Products'ta VIO kodu görünmüyor">#{r.pid}</span>
                          : "—")}
                  </td>
                  <td style={td}>
                    {r.name || "—"}
                    {r.pid != null && <span style={{ marginLeft: 4, fontSize: 9, color: "#a8a29e" }}>(pid #{r.pid})</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.planQty.toLocaleString("tr-TR")}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.orderQty.toLocaleString("tr-TR")}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: statusColor }}>
                    {r.diff === 0 ? "0" : (r.diff > 0 ? `+${r.diff.toLocaleString("tr-TR")}` : r.diff.toLocaleString("tr-TR"))}
                  </td>
                  <td style={{ ...td, textAlign: "center", fontSize: 10, color: statusColor, fontWeight: 600 }}>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
        💡 <b>Plan Fazlası</b>: Sevkiyat Planı'nda o üründen daha fazla sevk bekleniyor ama siparişlerde karşılığı yok.
        Sipariş girmeyi unutmuş olabilir. <br />
        💡 <b>Sipariş Fazlası</b>: İhracat siparişlerinde açık bakiye var ama Sevkiyat Planı'nda yıllık talep bunu karşılamıyor.
        Products ekranından yıllık sipariş adedini artırman gerekebilir.
      </div>
    </div>
  );
}

function SumBox({ label, value, color, sub }) {
  return (
    <div style={{ padding: "8px 12px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: "#78716c", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#44403c" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#78716c" }}>{sub}</div>}
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600, fontSize: 10, textAlign: "left", color: "#44403c" };
const td = { padding: "5px 8px", fontSize: 11, verticalAlign: "top" };
