// Otomatik aylık snapshot için basit envanter hesabı.
// Frontend'deki inventoryCalc.js mantığının özeti — BOM/mamul fallback ATLA:
// Envanterin >%95'i BUY/RAW olduğundan toplam TL bu basit hesapla doğru çıkar.
// (Dashboard trend grafiği için yeterli; ileride detaylı hesap istenirse migrate edilir.)
//
// Girdiler:
//   mrpStock: { parts: { [code]: { n, u, g, a, r, f, h, t } } }
//   unitCosts: { byStock: { [code]: { partitions: [...], lastName } } }
//
// Çıktı:
//   { totalValue, totalQty, stockCount, missingPriceCount, items? }

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

function calculateSimpleInventoryValue({ mrpStock, unitCosts }) {
  const parts = mrpStock?.parts || {};
  const byStock = unitCosts?.byStock || {};
  let totalValue = 0;
  let totalQty = 0;
  let stockCount = 0;
  let missingPriceCount = 0;
  let totalAmbar = 0;
  let totalUretim = 0;
  let totalFason = 0;

  for (const [code, p] of Object.entries(parts)) {
    const qty = safeNum(p.t);
    if (qty <= 0) continue;
    stockCount++;
    totalQty += qty;
    const price = getLastPriceForStock(byStock[code]);
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
  };
}

module.exports = { calculateSimpleInventoryValue };
