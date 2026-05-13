import * as XLSX from "xlsx";

// VIO "Gider Alımları / Stok Alım Hareketleri" — aylık sarf malzeme satınalmaları.
// Stok grupları 001 + 033 + 041 (kesici takım, kesme yağı, PPE, bilenme vs.)
// Format:
//   - Tek sayfa, header satırlarında metadata (Ana Grup, Stok Grup, ...)
//   - Her ay için blok: "MM-AyAdı" başlığı → "Stok Kod | Stok Adı | Kilo | Ciro Bedeli | Birim Maliyet"
//     → kalem satırları → boş kod + toplam satırı (kg/TL totals)
//   - Yıl bilgisi yok → fallbackYear (default: current year)

const pNum = (v) => {
  if (v === "" || v === undefined || v === null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

const MONTH_NAMES = {
  ocak: "01", "şubat": "02", subat: "02", mart: "03", nisan: "04",
  "mayıs": "05", mayis: "05", haziran: "06", temmuz: "07",
  "ağustos": "08", agustos: "08", "eylül": "09", eylul: "09",
  "ekim": "10", "kasım": "11", kasim: "11", "aralık": "12", aralik: "12",
};

function parseMonthHeader(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\s*-\s*(\S+)/);
  if (!m) return null;
  const mmNum = m[1].padStart(2, "0");
  const nameLower = m[2].toLocaleLowerCase("tr-TR");
  const mmFromName = MONTH_NAMES[nameLower];
  if (mmFromName && mmFromName === mmNum) return mmNum;
  if (mmFromName) return mmFromName;
  return mmNum;
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");

function isHeaderRow(row) {
  // "Stok Kod | Stok Adı | Kilo | Ciro Bedeli | Birim Maliyet"
  const c0 = norm(row[0]);
  return c0 === "stok kod" || c0 === "stok kodu";
}

export function parseSuppliesExcel(workbook, fallbackYear) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const year = Number(fallbackYear) || new Date().getFullYear();

  const months = {};
  let currentMonth = null;
  let currentItems = [];
  let inDataSection = false;
  // Excel hücre başlık metadata satırlarını atlamak için: ilk MM-Ay başlığı görülene kadar şeritte tarama
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const firstCell = String(r[0] ?? "").trim();
    // Boş satır
    if (!firstCell && (!r[1] || !String(r[1]).trim()) && !r[3]) continue;

    // Ay başlığı?
    const mm = parseMonthHeader(firstCell);
    if (mm) {
      // Önceki ayı kapat
      if (currentMonth) {
        months[currentMonth] = finalizeMonth(currentItems);
      }
      currentMonth = `${year}-${mm}`;
      currentItems = [];
      inDataSection = false;
      continue;
    }

    // Header satırı
    if (isHeaderRow(r)) {
      inDataSection = true;
      continue;
    }

    // Veri satırı (sadece bir ay aktifken)
    if (inDataSection && currentMonth) {
      const code = firstCell;
      if (!code) continue;  // boş kod = toplam satırı, atla
      const name = String(r[1] ?? "").trim();
      const kg = pNum(r[2]);
      const amountTl = pNum(r[3]);
      const unitCost = pNum(r[4]);
      if (amountTl <= 0) continue;
      currentItems.push({ code, name, kg, amountTl, unitCost });
    }
  }
  // Son ayı kapat
  if (currentMonth) {
    months[currentMonth] = finalizeMonth(currentItems);
  }

  return {
    months,
    monthsList: Object.keys(months).sort(),
    totalItems: Object.values(months).reduce((s, m) => s + m.itemCount, 0),
    grandTotalTl: Object.values(months).reduce((s, m) => s + m.totalTl, 0),
  };
}

function finalizeMonth(items) {
  const totalTl = items.reduce((s, it) => s + (it.amountTl || 0), 0);
  return {
    items,
    totalTl: Math.round(totalTl * 100) / 100,
    itemCount: items.length,
  };
}
