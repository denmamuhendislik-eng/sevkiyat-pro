import * as XLSX from "xlsx";

// v18.16 pNum pattern — App.jsx:6987'nin BİREBİR KOPYASI, dokunulmaz
function pNum(v) {
  if (v === "" || v === undefined || v === null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Excel serial → "YYYY-MM-DD" | DD.MM.YYYY → "YYYY-MM-DD" | "" → ""
// App.jsx:7002 parseEmirTarihi'nin serial + DD.MM.YYYY branch'leri
function parseSerialDate(v) {
  if (v === "" || v === undefined || v === null) return "";
  const s = String(v).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const n = Number(s);
  if (!isNaN(n) && n > 25000 && n < 100000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  }
  return "";
}

const norm = (s) =>
  String(s || "").replace(/[\n\r]/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");

// Dinamik kolon mapping — VIO sütun sırası değişirse güvenli
function findHeaderColumns(row) {
  const cols = {};
  row.forEach((cell, ci) => {
    const h = norm(cell);
    if (!h) return;
    if (h === "tarih") cols.orderDate = ci;
    else if (h === "belge no") cols.belgeNo = ci;
    else if (h === "stok kodu") cols.stokKodu = ci;
    else if (h === "stok adı" || h === "stok adi") cols.stokAdi = ci;
    else if (h === "teslim tarihi") cols.teslimTarihi = ci;
    else if (h === "brm") cols.brm = ci;
    else if (h.includes("orijinal miktar")) cols.orijinalMiktar = ci;
    else if (h.includes("sevk edilen")) cols.sevkEdilen = ci;
    else if (h.includes("kalan miktar")) cols.kalanMiktar = ci;
    else if (h.includes("dv.fiyat") || h.includes("dv fiyat")) cols.dvFiyat = ci;
    else if (h === "fiyat") cols.fiyat = ci;
    else if (h.includes("toplam bedel")) cols.toplamBedel = ci;
  });
  return cols;
}

export function parseSalesOrderExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const ordersMap = {};
  const customerSet = new Set();
  let currentCustomerCode = "";
  let currentCustomerName = "";
  let currentCols = null;
  let aggregateCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    // Müşteri başlığı — "Müşteri<sp>120-XXXX<sp>AD..."
    if (c0.startsWith("Müşteri")) {
      const m = c0.match(/Müşteri\s+(\S+)\s+(.+)/);
      if (m) {
        currentCustomerCode = m[1].trim();
        currentCustomerName = m[2].trim();
        customerSet.add(currentCustomerCode);
      }
      continue;
    }

    // Kolon başlığı satırı — her müşteri bloğunda tekrar eder
    if (c0 === "Tarih") {
      currentCols = findHeaderColumns(r);
      continue;
    }

    // Data satırı şartları
    if (!currentCustomerCode || !currentCols) continue;
    const belgeNo = String(r[currentCols.belgeNo] || "").trim();
    const stokKodu = String(r[currentCols.stokKodu] || "").trim();
    if (!belgeNo || !stokKodu || stokKodu === "Stok Kodu") continue;

    const teslimTarihi = parseSerialDate(r[currentCols.teslimTarihi]);
    const id = `${belgeNo}_${stokKodu}_${teslimTarihi}`;

    const row = {
      customerCode: currentCustomerCode,
      customerName: currentCustomerName,
      orderDate: parseSerialDate(r[currentCols.orderDate]),
      belgeNo,
      stokKodu,
      stokAdi: String(r[currentCols.stokAdi] || "").trim(),
      teslimTarihi,
      brm: String(r[currentCols.brm] || "").trim(),
      orijinalMiktar: pNum(r[currentCols.orijinalMiktar]),
      sevkEdilen: pNum(r[currentCols.sevkEdilen]),
      kalanMiktar: pNum(r[currentCols.kalanMiktar]),
      dvFiyat: pNum(r[currentCols.dvFiyat]),
      fiyat: pNum(r[currentCols.fiyat]),
      toplamBedel: pNum(r[currentCols.toplamBedel]),
    };

    if (ordersMap[id]) {
      // True duplicate (aynı belge+stok+teslim) → miktar/bedel topla
      aggregateCount++;
      ordersMap[id].orijinalMiktar += row.orijinalMiktar;
      ordersMap[id].sevkEdilen += row.sevkEdilen;
      ordersMap[id].kalanMiktar += row.kalanMiktar;
      ordersMap[id].toplamBedel += row.toplamBedel;
    } else {
      ordersMap[id] = row;
    }
  }

  return {
    ordersMap,
    customerCount: customerSet.size,
    orderCount: Object.keys(ordersMap).length,
    rowCount: Object.keys(ordersMap).length + aggregateCount,
    aggregateCount,
    importedAt: new Date().toISOString(),
  };
}
