// Teklif Excel export — kalem tablosu + toplam. Müşteri isterse Excel formatında
// göndermek için (PDF ile aynı verinin xlsx sürümü).
//
// Sayfa yapısı:
//   Başlık bloğu: teklif no, tarih, müşteri, para birimi
//   Kalem tablosu: sıra, stok kodu, açıklama, adet, birim, birim fiyat, tutar, termin
//   Aparat/kalıp bloğu (varsa)
//   Toplam satırı

import * as XLSX from "xlsx";

const CURRENCY_SYMBOL = { TL: "₺", DOLAR: "$", EURO: "€" };

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtTerm(t) {
  if (t === undefined || t === null || t === "") return "";
  const s = String(t).trim();
  if (!s) return "";
  if (/^\d+([.,]\d+)?$/.test(s)) return `${s} gün`;
  return s;
}

export function generateQuoteExcel(quote, calc) {
  const currency = quote.currency || "TL";
  const symbol = CURRENCY_SYMBOL[currency] || currency;
  const displayFactor = calc?.displayFactor || 1;
  const show = (tl) => Number((tl || 0) * displayFactor);

  // Excel için AoA (array of arrays) yaklaşımı — merkezi kontrol
  const rows = [];

  // Başlık bloğu
  rows.push([`TEKLİF FORMU / QUOTATION`]);
  rows.push([`Teklif No`, quote.quoteNo || "", "", `Tarih`, fmtDate(quote.quoteDate)]);
  rows.push([`Müşteri`, quote.customerName || "", "", `Para Birimi`, `${currency} (${symbol})`]);
  if (quote.customerPhone) rows.push([`Telefon`, quote.customerPhone]);
  if (quote.customerEmail) rows.push([`E-mail`, quote.customerEmail]);
  if (quote.paymentTerm) rows.push([`Ödeme`, quote.paymentTerm]);
  if (quote.term) rows.push([`Termin`, quote.term]);
  rows.push([]); // boş satır

  // Kalem tablosu başlıkları
  rows.push([
    "Sıra", "Stok Kodu", "Müşteri Kodu", "Açıklama",
    "Adet", "Birim",
    `Birim Fiyat (${symbol})`, `Tutar (${symbol})`,
    "Termin",
  ]);

  const lines = quote.lines || [];
  const lineResults = calc?.lineResults || [];
  let linesOnlySale = 0;
  lines.forEach((line, i) => {
    const lr = lineResults[i];
    const qty = Number(line.quantity) || 1;
    const linePrice = lr?.total?.salePrice || 0;
    const unitPrice = linePrice / qty;
    linesOnlySale += linePrice;
    rows.push([
      i + 1,
      line.stockCode || "",
      line.musteriKodu || "",
      line.stockName || "",
      qty,
      line.unit || "AD",
      Number(show(unitPrice).toFixed(2)),
      Number(show(linePrice).toFixed(2)),
      fmtTerm(line.term),
    ]);
  });

  // Aparat/kalıp ayrı satır (varsa)
  const separateTools = calc?.separateToolItems || [];
  let separateToolsSale = 0;
  if (separateTools.length > 0) {
    rows.push([]);
    rows.push(["APARAT / KALIP / ÖZEL TAKIM"]);
    rows.push(["Açıklama", "", "", "", "", "", "", `Tutar (${symbol})`, ""]);
    separateTools.forEach(t => {
      separateToolsSale += (t.sale || 0);
      rows.push([t.description || "—", "", "", "", "", "", "", Number(show(t.sale).toFixed(2)), ""]);
    });
  }

  // Toplam
  const totalSale = calc?.totalSaleTl || (linesOnlySale + separateToolsSale);
  const shippingCost = Number(quote.shippingCost || 0);
  const shippingIncluded = quote.shippingIncluded !== false;
  const grandTotal = shippingIncluded ? totalSale : totalSale + shippingCost;

  rows.push([]);
  if (!shippingIncluded && shippingCost > 0) {
    rows.push(["", "", "", "", "", "", "Nakliye", Number(show(shippingCost).toFixed(2))]);
  }
  rows.push(["", "", "", "", "", "", `TOPLAM (${symbol})`, Number(show(grandTotal).toFixed(2))]);

  // Notlar
  if (quote.notes && quote.notes.trim()) {
    rows.push([]);
    rows.push(["Notlar", quote.notes]);
  }

  // Worksheet oluştur
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Sütun genişlikleri
  ws["!cols"] = [
    { wch: 6 },   // Sıra
    { wch: 20 },  // Stok Kodu
    { wch: 18 },  // Müşteri Kodu
    { wch: 40 },  // Açıklama
    { wch: 8 },   // Adet
    { wch: 8 },   // Birim
    { wch: 16 },  // Birim Fiyat
    { wch: 16 },  // Tutar
    { wch: 14 },  // Termin
  ];

  // Merge — başlık satırı geniş
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teklif");

  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  const filename = `Teklif_${safe(quote.quoteNo)}_${safe(quote.customerName)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
