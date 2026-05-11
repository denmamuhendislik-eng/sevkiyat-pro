import * as XLSX from "xlsx";
import { guessCurrency } from "./exchangeRates";

// VIO Satın Alma Raporu Toplamlı (Müşteri Alt Hesaplı) — fiyat kolonlu versiyon parser'ı.
// Çıktı: { partitions: [...], summary: {...} }
// Her satır → bir parti. Satır Net Fiyatı asıl TL birim fiyatı (2.birim sorunu çözüldü).

const pNum = (v) => {
  if (v === "" || v === undefined || v === null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

// Excel serial → "YYYY-MM-DD"
const fromExcelDate = (n) => {
  if (typeof n !== "number" || isNaN(n)) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const norm = (s) =>
  String(s || "").replace(/[\n\r]/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");

// Header satırını parse — kolon adı → index map
function findCols(row) {
  const cols = {};
  row.forEach((cell, ci) => {
    const h = norm(cell);
    if (!h) return;
    if (h === "tarih") cols.date = ci;
    else if (h === "belge no") cols.belgeNo = ci;
    else if (h === "stok kodu") cols.code = ci;
    else if (h === "stok adı" || h === "stok adi") cols.name = ci;
    else if (h === "teslim tarihi") cols.teslim = ci;
    else if (h === "brm") cols.unit = ci;
    else if (h === "orijinal miktar" || h === "orjinal miktar") cols.original = ci;
    else if (h === "sevk edilen miktar" || h === "sevkedilen miktar") cols.shipped = ci;
    else if (h === "kalan miktar") cols.remaining = ci;
    else if (h === "dv.fiyat") cols.dvzPrice = ci;
    else if (h === "fiyat") cols.price = ci;
    else if (h === "toplam bedel") cols.totalBedel = ci;
    else if (h === "dvz kod") cols.currency = ci;
    else if (h === "2. miktar" || h === "2.miktar") cols.qty2 = ci;
    else if (h === "satır net fiyatı") cols.netPrice = ci;
    else if (h === "satır net dv.fiyatı") cols.netDvzPrice = ci;
  });
  return cols;
}

export function parsePurchaseWithPrices(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let currentSupplier = "", currentSupplierCode = "";
  let cols = null;
  const partitions = [];
  let parseErrors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    // Tedarikçi başlık satırı
    if (c0.startsWith("Müşteri") && c0.match(/Müşteri\s+\S+\s+/)) {
      const m = c0.match(/Müşteri\s+(\S+)\s+(.+)$/);
      if (m) {
        currentSupplierCode = m[1].trim();
        currentSupplier = m[2].trim().replace(/\s{2,}/g, " ");
      }
      cols = null;
      continue;
    }

    // Kolon başlığı satırı (her tedarikçi grubu için yeniden)
    if (norm(c0) === "tarih" && norm(r[2]) === "stok kodu") {
      cols = findCols(r);
      continue;
    }

    if (!cols) continue;

    // Veri satırı kontrolü — tarih numeric (Excel serial) + stok kodu dolu
    const dateVal = r[cols.date];
    if (typeof dateVal !== "number") continue;
    const code = String(r[cols.code] || "").trim();
    if (!code) continue;

    const orderDate = fromExcelDate(dateVal);
    const teslimDate = fromExcelDate(r[cols.teslim]);
    const original = pNum(r[cols.original]);
    const shipped = pNum(r[cols.shipped]);
    const remaining = pNum(r[cols.remaining]);
    const netPrice = pNum(r[cols.netPrice]);          // TL birim — asıl alan
    const netDvzPrice = pNum(r[cols.netDvzPrice]);    // Döviz birim (varsa)
    const dvzCodeRaw = String(r[cols.currency] || "").trim().toUpperCase();
    const rawPrice = pNum(r[cols.price]);
    const rawTotalBedel = pNum(r[cols.totalBedel]);
    const qty2 = pNum(r[cols.qty2]);

    // Para birimi mantığı
    let currency = "TRY";
    let currencyGuess = null; // { confidence, refRate } — tahmin yapıldıysa
    if (netDvzPrice > 0) {
      // Dövizli alım
      if (dvzCodeRaw === "USD" || dvzCodeRaw === "EUR") {
        currency = dvzCodeRaw;
      } else {
        // Kod boş → tahmin
        const ratio = netPrice > 0 ? netPrice / netDvzPrice : 0;
        const g = guessCurrency(ratio, orderDate);
        currency = g.currency;
        currencyGuess = { confidence: g.confidence, refRate: g.refRate, observedRatio: ratio };
      }
    }

    // 2. birim sorunu var mı? (Fiyat × Orijinal ≠ Toplam Bedel)
    const expectedTotal = rawPrice * original;
    const has2ndUnitDiscrepancy = expectedTotal > 0 && Math.abs(expectedTotal - rawTotalBedel) / Math.max(expectedTotal, rawTotalBedel) > 0.05;

    partitions.push({
      rowIdx: i,
      orderDate,
      belgeNo: String(r[cols.belgeNo] || "").trim(),
      code,
      name: String(r[cols.name] || "").trim(),
      unit: String(r[cols.unit] || "").trim() || "AD",
      teslimDate,
      originalQty: original,
      shippedQty: shipped,
      remainingQty: remaining,
      unitPriceTl: netPrice,        // Satır Net Fiyatı — TL/AD nihai
      unitPriceDvz: netDvzPrice,    // Satır Net Dv.Fiyatı — Döviz/AD nihai (info)
      currency,                     // "TRY" / "USD" / "EUR"
      currencyGuess,                // null veya { confidence, refRate, observedRatio }
      supplierCode: currentSupplierCode,
      supplier: currentSupplier,
      // Audit / debug:
      _rawPrice: rawPrice,
      _rawTotalBedel: rawTotalBedel,
      _qty2: qty2,
      _has2ndUnitDiscrepancy: has2ndUnitDiscrepancy,
    });
  }

  // Özet
  const suppliers = new Set();
  const stockCodes = new Set();
  let totalTl = 0, tlOnly = 0, dvzKnown = 0, dvzGuessed = 0, dvzGuessLowConf = 0;
  let with2ndUnit = 0;
  for (const p of partitions) {
    suppliers.add(p.supplierCode);
    stockCodes.add(p.code);
    totalTl += (p.unitPriceTl || 0) * (p.originalQty || 0);
    if (p.currency === "TRY") tlOnly++;
    else if (p.currencyGuess) {
      dvzGuessed++;
      if (p.currencyGuess.confidence === "low") dvzGuessLowConf++;
    } else dvzKnown++;
    if (p._has2ndUnitDiscrepancy) with2ndUnit++;
  }

  return {
    partitions,
    summary: {
      rowCount: partitions.length,
      supplierCount: suppliers.size,
      stockCount: stockCodes.size,
      totalTl,
      tlOnly,
      dvzKnown,
      dvzGuessed,
      dvzGuessLowConf,
      with2ndUnit,
    },
    parseErrors,
  };
}
