import * as XLSX from "xlsx";
import { guessCurrency } from "./exchangeRates";

// VIO "Sipariş Kontrol Listesi (Belge No)" raporu — fiyat kolonu eklenmiş.
// Format: her sipariş bloğu R(x) = "No" + sipariş no, R(x+1) = header, R(x+2+) = data
// Avantajlar:
//   - Alt Hesap Döviz kolonu (16) = "EUR"/"USD"/boş → para birimi açık
//   - Satır Net Fiyatı (26) = TL nihai (VIO'nun o günkü kuruyla çevrilmiş)
//   - Satır Net Dv.Fiyatı (24) = Döviz birim (varsa, info)
//   - 2.birim sorunu yok — Net Fiyatı her zaman adet bazlı TL

const pNum = (v) => {
  if (v === "" || v === undefined || v === null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

// VIO tarih formatı: DDMMYYYY (7-8 hane numeric) veya Excel serial
const parseVioDate = (v) => {
  if (v === "" || v === undefined || v === null) return null;
  if (typeof v === "number") {
    if (v > 25000 && v < 100000) {
      // Excel serial
      const d = new Date((v - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    // DDMMYYYY numeric: 16012026 = 16.01.2026, 4112025 = 4.11.2025 (7 hane)
    const s = String(v).padStart(8, "0");
    const dd = s.substring(0, 2);
    const mm = s.substring(2, 4);
    const yyyy = s.substring(4, 8);
    const y = Number(yyyy);
    if (y >= 2000 && y <= 2100) return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{7,8}$/.test(s)) {
    const padded = s.padStart(8, "0");
    const dd = padded.substring(0, 2);
    const mm = padded.substring(2, 4);
    const yyyy = padded.substring(4, 8);
    const y = Number(yyyy);
    if (y >= 2000 && y <= 2100) return `${yyyy}-${mm}-${dd}`;
  }
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  return null;
};

const norm = (s) =>
  String(s || "").replace(/[\n\r]/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");

// Header satırı tespit + kolon index map
function findCols(row) {
  const cols = {};
  row.forEach((cell, ci) => {
    const h = norm(cell);
    if (!h) return;
    if (h === "stok kodu") cols.code = ci;
    else if (h === "stok adı" || h === "stok adi") cols.name = ci;
    else if (h === "teslim tarihi") cols.teslim = ci;
    else if (h === "br") cols.unit = ci;
    else if (h === "orijinal miktar" || h === "orjinal miktar") cols.original = ci;
    else if (h === "sevk edilen miktar" || h === "sevkedilen miktar") cols.shipped = ci;
    else if (h === "kalan miktar") cols.remaining = ci;
    else if (h === "alt hesap döviz" || h === "alt hesap doviz") cols.altCurrency = ci;
    else if (h === "2. miktar" || h === "2.miktar") cols.qty2 = ci;
    else if (h === "hesap kalan 2. miktar") cols.remainingQty2 = ci;
    else if (h === "dv.fiyat") cols.dvzPrice = ci;
    else if (h === "satır net dv.fiyatı") cols.netDvzPrice = ci;
    else if (h === "fiyat") cols.price = ci;
    else if (h === "satır net fiyatı") cols.netPrice = ci;
    else if (h === "kalan miktar bedeli") cols.remainingBedel = ci;
    else if (h === "kalan miktar dv.bedeli") cols.remainingDvzBedel = ci;
  });
  return cols;
}

export function parsePurchaseWithPrices(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let currentBelgeNo = "", currentOrderDate = "", currentSupplierCode = "", currentSupplier = "";
  let cols = null;
  const partitions = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    // Sipariş başlığı: "No" satırı
    // R4: ["No", 27, "Tarih", "", 16012026, "Müşteri", "320-0295", "KOYUNCU DÖKÜM..."]
    if (c0 === "No") {
      currentBelgeNo = r[1] !== "" && r[1] != null ? String(r[1]).trim() : "";
      currentOrderDate = parseVioDate(r[4]);
      currentSupplierCode = String(r[6] || "").trim();
      currentSupplier = String(r[7] || "").trim().replace(/\s{2,}/g, " ");
      cols = null;
      continue;
    }

    // Header satırı (her sipariş bloğunda tekrarlanır)
    if (norm(c0) === "stok kodu") {
      cols = findCols(r);
      continue;
    }

    if (!cols) continue;

    // Toplam/özet satırları atla (Stok Kodu boş, Sevk Edilen Miktar dolu olabilir)
    if (!c0) continue;

    // Veri satırı kontrolü: stok kodu pattern (örn. 150-XXXX, MM-XXXX-XXXXX)
    if (!c0.match(/^[\w\d]/)) continue;
    const cn = norm(c0);
    if (cn === "no" || cn === "müşteri" || cn === "musteri" || cn === "stok kodu" || cn === "nakliye") continue;
    if (cn.startsWith("denma") || cn.startsWith("bekleme") || cn.startsWith("rapor") || cn.startsWith("onay") || cn.startsWith("stok/")) continue;

    const code = c0;
    const name = String(r[cols.name] || "").trim();
    const teslimDate = parseVioDate(r[cols.teslim]);
    const original = pNum(r[cols.original]);
    const shipped = pNum(r[cols.shipped]);
    const remaining = pNum(r[cols.remaining]);

    // Bedel/miktar yoksa skip (boş satır)
    if (original <= 0 && remaining <= 0) continue;

    const netPrice = pNum(r[cols.netPrice]);       // TL nihai
    const netDvzPrice = pNum(r[cols.netDvzPrice]); // Döviz nihai (varsa)
    const altCurrency = String(r[cols.altCurrency] || "").trim().toUpperCase();
    const rawPrice = pNum(r[cols.price]);
    const rawDvzPrice = pNum(r[cols.dvzPrice]);
    const remainingBedel = pNum(r[cols.remainingBedel]);
    const remainingDvzBedel = pNum(r[cols.remainingDvzBedel]);
    const qty2 = pNum(r[cols.qty2]);

    // Para birimi: Alt Hesap Döviz dolu ise direkt onu kullan
    // Bu format'ta tahmin gerekmiyor — VIO açık veriyor
    let currency = "TRY";
    let currencyGuess = null;
    if (altCurrency === "USD" || altCurrency === "EUR") {
      currency = altCurrency;
    } else if (netDvzPrice > 0 || rawDvzPrice > 0) {
      // Alt Hesap Döviz boş ama dvz fiyat dolu → tahmin (fallback)
      const ratio = netPrice > 0 && netDvzPrice > 0 ? netPrice / netDvzPrice : 0;
      const g = guessCurrency(ratio, currentOrderDate);
      currency = g.currency;
      currencyGuess = { confidence: g.confidence, refRate: g.refRate, observedRatio: ratio };
    }

    // Netlik kontrolü — Fiyat × Orijinal vs Net Fiyat × Orijinal karşılaştırması
    // Net Fiyat boşsa Fiyat'ı fallback olarak kullan (kontrol amaçlı)
    const usedTl = netPrice > 0 ? netPrice : rawPrice;

    partitions.push({
      rowIdx: i,
      orderDate: currentOrderDate,
      belgeNo: currentBelgeNo,
      code,
      name,
      unit: String(r[cols.unit] || "").trim() || "AD",
      teslimDate,
      originalQty: original,
      shippedQty: shipped,
      remainingQty: remaining,
      unitPriceTl: usedTl,             // Asıl: Satır Net Fiyatı (TL/AD)
      unitPriceDvz: netDvzPrice,       // Döviz/AD (varsa)
      currency,                        // "TRY" / "USD" / "EUR"
      currencyGuess,                   // null veya tahmin meta
      supplierCode: currentSupplierCode,
      supplier: currentSupplier,
      // Audit/info:
      _rawPrice: rawPrice,
      _rawDvzPrice: rawDvzPrice,
      _remainingBedel: remainingBedel,
      _remainingDvzBedel: remainingDvzBedel,
      _qty2: qty2,
      _has2ndUnitDiscrepancy: false,   // bu formatta sorun yok
    });
  }

  // Özet
  const suppliers = new Set();
  const stockCodes = new Set();
  let totalTl = 0, tlOnly = 0, dvzKnown = 0, dvzGuessed = 0, dvzGuessLowConf = 0, noPrice = 0;
  for (const p of partitions) {
    suppliers.add(p.supplierCode);
    stockCodes.add(p.code);
    totalTl += (p.unitPriceTl || 0) * (p.originalQty || 0);
    if (p.unitPriceTl <= 0) noPrice++;
    else if (p.currency === "TRY") tlOnly++;
    else if (p.currencyGuess) {
      dvzGuessed++;
      if (p.currencyGuess.confidence === "low") dvzGuessLowConf++;
    } else dvzKnown++;
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
      noPrice,
      with2ndUnit: 0,  // bu formatta artık irrelevant
    },
    parseErrors: [],
  };
}
