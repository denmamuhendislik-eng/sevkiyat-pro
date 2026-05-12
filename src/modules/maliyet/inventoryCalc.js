// Envanter değer hesabı — eldeki stoğun TL karşılığı.
// Kaynak: mrpStock (VIO stok raporu — appData/mrpStock) × unitCosts (son alış fiyatı)
// 3 katmanlı eşleşme: kod → isim → ilk token (productCostCalc ile aynı pattern)

function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
const normName = (s) => String(s || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
const firstToken = (s) => {
  const t = String(s || "").trim().split(/\s+/)[0];
  return t ? t.toLocaleLowerCase("tr-TR") : "";
};

export function calculateInventoryValue({ mrpStock, unitCosts }) {
  const parts = mrpStock?.parts || {};
  const byStock = unitCosts?.byStock || {};

  // Lookup tabloları
  const nameToCode = {};
  const tokensToCode = {};
  const stockUnitCost = {};
  for (const [code, slot] of Object.entries(byStock)) {
    const partitions = slot.partitions || [];
    if (partitions.length === 0) continue;
    const sorted = [...partitions].sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    const last = sorted[sorted.length - 1];
    stockUnitCost[code] = safeNum(last.unitPriceTl);
    const name = slot.lastName || last.name || "";
    if (name) {
      const nk = normName(name);
      if (nk) nameToCode[nk] = code;
      const tk = firstToken(name);
      if (tk && /^\d+/.test(tk)) {
        if (!tokensToCode[tk]) tokensToCode[tk] = [];
        tokensToCode[tk].push(code);
      }
    }
  }

  function lookupPrice(code, name) {
    if (stockUnitCost[code] != null) return { price: stockUnitCost[code], matchedBy: "code" };
    const nk = normName(name);
    if (nk && nameToCode[nk]) return { price: stockUnitCost[nameToCode[nk]], matchedBy: "name" };
    const tk = firstToken(name);
    if (tk && tokensToCode[tk] && tokensToCode[tk].length === 1) {
      return { price: stockUnitCost[tokensToCode[tk][0]], matchedBy: "token" };
    }
    return { price: 0, matchedBy: "miss" };
  }

  // Stok değer hesabı
  const items = [];
  let totalValue = 0, totalQty = 0, missingPriceCount = 0;
  let totalAmbar = 0, totalUretim = 0, totalFason = 0;

  for (const [code, p] of Object.entries(parts)) {
    const qty = safeNum(p.t);  // total
    if (qty <= 0) continue;
    const { price, matchedBy } = lookupPrice(code, p.n);
    const value = price * qty;
    if (price <= 0) missingPriceCount++;
    items.push({
      code,
      name: p.n || "",
      unit: p.u || "AD",
      group: p.g || "",
      qtyAmbar: safeNum(p.a),
      qtyUretim: safeNum(p.r),
      qtyFason: safeNum(p.f),
      qtyHaric: safeNum(p.h),
      qtyTotal: qty,
      unitPriceTl: price,
      value,
      matchedBy,
    });
    totalValue += value;
    totalQty += qty;
    totalAmbar += safeNum(p.a) * price;
    totalUretim += safeNum(p.r) * price;
    totalFason += safeNum(p.f) * price;
  }

  // Sırala: değer azalan
  items.sort((a, b) => b.value - a.value);

  return {
    items,
    summary: {
      totalValue,
      totalQty,
      stockCount: items.length,
      missingPriceCount,
      totalAmbar,
      totalUretim,
      totalFason,
      mrpStockImportedAt: mrpStock?.importedAt || null,
      unitCostsImportedAt: unitCosts?.lastImport || null,
    },
  };
}

// Çeyrek anahtarı: 2026-Q1 (Oca/Şub/Mar), 2026-Q2 (Nis/May/Haz), ...
export function quarterKey(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-11
  const q = Math.floor(m / 3) + 1;
  return `${y}-Q${q}`;
}

// Çeyrek bitiş tarihi: Q1 → 31 Mart, Q2 → 30 Haz, Q3 → 30 Eyl, Q4 → 31 Ara
export function quarterEndDate(qKey) {
  const m = qKey.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const endMonth = q * 3;  // 3, 6, 9, 12
  // Ay sonu günü
  const d = new Date(year, endMonth, 0);  // ay 0 = önceki ayın son günü
  return d.toISOString().slice(0, 10);
}
