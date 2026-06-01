// Otomatik aylık snapshot için basit envanter hesabı.
// Frontend'deki inventoryCalc.js mantığının özeti.
//
// Fiyat lookup sırası:
//   1. unitCosts.byStock[code] — son alış fiyatı (BUY/RAW kategorileri için)
//   2. productCostsLatest.byStockCode[code] — mamul/yarı mamul rootCost (Frontend
//      ProductCostsTab tarafından hesaplanıp yazılır). Bu fallback olmadan snapshot
//      anlık envanterden ~9M TL düşük çıkıyordu (mamul stokları sıfır TL sayılıyordu).
//
// Girdiler:
//   mrpStock: { parts: { [code]: { n, u, g, a, r, f, h, t } } }
//   unitCosts: { byStock: { [code]: { partitions: [...], lastName } } }
//   productCosts: { byStockCode: { [code]: rootCostTl }, calculatedAt }  ← yeni, opsiyonel
//
// Çıktı:
//   { totalValue, totalQty, stockCount, missingPriceCount, totalAmbar, totalUretim,
//     totalFason, productCostsFallbackCount, productCostsCalculatedAt }

function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function getLastPriceForStock(slot) {
  const parts = slot?.partitions || [];
  if (parts.length === 0) return 0;
  const sorted = [...parts].sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
  // En son tarihli fiyatlı parti (M12 fiber somun bug fix paterni — geriye doğru tara)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = safeNum(sorted[i].unitPriceTl);
    if (p > 0) return p;
  }
  return 0;
}

function calculateSimpleInventoryValue({ mrpStock, unitCosts, productCosts = null }) {
  const parts = mrpStock?.parts || {};
  const byStock = unitCosts?.byStock || {};
  const byStockCode = productCosts?.byStockCode || {};
  let totalValue = 0;
  let totalQty = 0;
  let stockCount = 0;
  let missingPriceCount = 0;
  let totalAmbar = 0;
  let totalUretim = 0;
  let totalFason = 0;
  let productCostsFallbackCount = 0;

  for (const [code, p] of Object.entries(parts)) {
    const qty = safeNum(p.t);
    if (qty <= 0) continue;
    stockCount++;
    totalQty += qty;
    let price = getLastPriceForStock(byStock[code]);
    if (price <= 0) {
      // Mamul/yarı mamul fallback: ProductCostsTab tarafından yazılmış rootCost
      const fallback = safeNum(byStockCode[code]);
      if (fallback > 0) {
        price = fallback;
        productCostsFallbackCount++;
      }
    }
    if (price <= 0) {
      missingPriceCount++;
      continue;  // fiyatı yoksa toplamlara dahil değil
    }
    const value = price * qty;
    totalValue += value;
    totalAmbar += safeNum(p.a) * price;
    totalUretim += safeNum(p.r) * price;
    totalFason += safeNum(p.f) * price;
  }

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    totalQty,
    stockCount,
    missingPriceCount,
    totalAmbar: Math.round(totalAmbar * 100) / 100,
    totalUretim: Math.round(totalUretim * 100) / 100,
    totalFason: Math.round(totalFason * 100) / 100,
    productCostsFallbackCount,
    productCostsCalculatedAt: productCosts?.calculatedAt || null,
  };
}

module.exports = { calculateSimpleInventoryValue };
