import * as XLSX from "xlsx";

// VIO "Hizmet Total Raporu" — aylık genel giderler.
// Format: yıl bilgisi R2'de "Tarih: 1.01.2026", aylar "MM-AyAdı" başlığı + 4 kolon tablo

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

// "01-Ocak" → "01" (string)
function parseMonthHeader(s) {
  const m = String(s || "").trim().match(/^(\d{2})\s*-\s*(\S+)/);
  if (!m) return null;
  const mmNum = m[1];
  const nameLower = m[2].toLocaleLowerCase("tr-TR");
  const mmFromName = MONTH_NAMES[nameLower];
  // numeric ve isim eşleşirse onayla
  if (mmFromName && mmFromName === mmNum) return mmNum;
  // sadece isim ile fallback
  if (mmFromName) return mmFromName;
  return mmNum;
}

const norm = (s) =>
  String(s || "").replace(/[\n\r]/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");

// Header satırında "Hizmet Kodu" / "Borç" / "Alacak" kolonlarını dinamik bul.
// VIO farklı şablonlarda farklı kolon index'i kullanıyor (4 kolon vs 10 kolon).
function findCols(row) {
  const cols = {};
  row.forEach((cell, ci) => {
    const h = norm(cell);
    if (!h) return;
    if (h === "hizmet kodu") cols.code = ci;
    else if (h === "hizmet adı" || h === "hizmet adi") cols.name = ci;
    else if (h === "borç brüt bedel" || h === "borc brut bedel" || h.startsWith("borç") || h.startsWith("borc")) cols.borc = ci;
    else if (h === "alacak brüt bedel" || h === "alacak brut bedel" || h.startsWith("alacak")) cols.alacak = ci;
  });
  return cols;
}

export function parseOverheadExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Yıl bilgisi: R0-R7 arası tüm hücreleri tara, 2020-2100 aralığında bir yıl bul.
  // İki olası format:
  //   - String "Tarih: 1.01.2026" → \b(20\d{2})\b match
  //   - Numeric DDMMYYYY (örn. 11052026) → son 4 hane yıl
  let year = String(new Date().getFullYear());
  let yearFound = false;
  for (let i = 0; i < Math.min(rows.length, 8) && !yearFound; i++) {
    for (const cell of (rows[i] || [])) {
      if (yearFound) break;
      if (typeof cell === "number") {
        const s = String(cell).padStart(8, "0");
        if (s.length === 8) {
          const yyyy = s.substring(4, 8);
          const y = Number(yyyy);
          if (y >= 2020 && y <= 2100) { year = yyyy; yearFound = true; }
        }
      } else if (typeof cell === "string") {
        const m = cell.match(/\b(20\d{2})\b/);
        if (m) { year = m[1]; yearFound = true; }
      }
    }
  }

  let currentMonth = null;  // "YYYY-MM"
  const byMonth = {};       // { "YYYY-MM": { items: [], total } }
  let cols = null;          // header'dan dinamik index map

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    // Ay başlığı
    const mm = parseMonthHeader(c0);
    if (mm) {
      currentMonth = `${year}-${mm}`;
      if (!byMonth[currentMonth]) byMonth[currentMonth] = { items: [], totalBorc: 0 };
      cols = null;  // her ay başında yeni header satırı bekleniyor
      continue;
    }

    // Header satırı (norm ile multi-line newline'ları boşluğa çevirip karşılaştır)
    if (norm(c0) === "hizmet kodu") {
      cols = findCols(r);
      continue;
    }

    if (!c0) continue;
    if (!currentMonth || !cols || cols.borc == null) continue;

    const code = String(r[cols.code] || "").trim();
    const name = cols.name != null ? String(r[cols.name] || "").trim() : "";
    const borc = pNum(r[cols.borc]);
    // alacak (cols.alacak) kullanılmıyor — VIO tarafı bug, sadece borc baz alınır

    if (!code || borc <= 0) continue;

    byMonth[currentMonth].items.push({
      code,
      name,
      amount: borc,
    });
    byMonth[currentMonth].totalBorc += borc;
  }

  // Özet
  const monthsList = Object.keys(byMonth).sort();
  const grandTotal = monthsList.reduce((s, m) => s + byMonth[m].totalBorc, 0);
  const itemCount = monthsList.reduce((s, m) => s + byMonth[m].items.length, 0);
  const uniqueCodes = new Set();
  monthsList.forEach(m => byMonth[m].items.forEach(it => uniqueCodes.add(it.code)));

  return {
    byMonth,
    year,
    monthsList,
    grandTotal,
    itemCount,
    uniqueCodeCount: uniqueCodes.size,
  };
}
