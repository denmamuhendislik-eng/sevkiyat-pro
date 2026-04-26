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

// Tarih parse — 4 input varyantı:
//   1. Excel serial (number 25000-100000)        → "YYYY-MM-DD"
//   2. Text "DD.MM.YYYY" (eski manuel format)    → "YYYY-MM-DD"
//   3. Integer DDMMYYYY (mail format, 7-8 hane)  → "YYYY-MM-DD"  — örn 1012025 = 2025-01-01
//   4. Boş / parse edilemez                       → ""
function parseSerialDate(v) {
  if (v === "" || v === undefined || v === null) return "";
  // Number tipinde gelen mail format integer'ı veya excel serial
  if (typeof v === "number" && !isNaN(v)) {
    // Mail format: DDMMYYYY (7-8 hane, 1012025 ile 31122099 arası)
    if (v >= 1000000 && v <= 99999999) {
      const s = String(v).padStart(8, "0");
      const dd = s.substring(0, 2);
      const mm = s.substring(2, 4);
      const yyyy = s.substring(4, 8);
      // Sanity: dd 01-31, mm 01-12
      const ddN = parseInt(dd), mmN = parseInt(mm), yyyyN = parseInt(yyyy);
      if (ddN >= 1 && ddN <= 31 && mmN >= 1 && mmN <= 12 && yyyyN >= 2000 && yyyyN <= 2100) {
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    // Excel serial
    if (v > 25000 && v < 100000) {
      const d = new Date((v - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
    }
    return "";
  }
  // String tipinde
  const s = String(v).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const n = Number(s);
  if (!isNaN(n)) return parseSerialDate(n);
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

// Müşteri başlığı tespiti — iki format desteği:
//   1. Eski (manuel export): r[0] = "Müşteri 120-XXXX AD..."  (tek hücre)
//   2. Yeni (VIO mail):       r[0] = "Müşteri", r[1] = "120-XXXX", r[3] = "AD..."  (3 hücre)
// Dönen değer: { code, name } veya null
function detectCustomerHeader(r) {
  const c0 = String(r[0] || "").trim();
  if (!c0.startsWith("Müşteri")) return null;
  // Format 2 (mail): "Müşteri" tek başına bir hücrede
  if (c0 === "Müşteri") {
    const code = String(r[1] || "").trim();
    // Müşteri adı tipik olarak r[3]'te (r[2] boş kolon ayırıcı). r[3] yoksa r[2]'ye fallback.
    const name = String(r[3] || r[2] || "").trim();
    if (code && name) return { code, name };
  }
  // Format 1 (eski): "Müşteri 120-XXXX AD..." aynı hücrede
  const m = c0.match(/Müşteri\s+(\S+)\s+(.+)/);
  if (m) return { code: m[1].trim(), name: m[2].trim() };
  return null;
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

    // Müşteri başlığı — iki format auto-detect
    const cust = detectCustomerHeader(r);
    if (cust) {
      currentCustomerCode = cust.code;
      currentCustomerName = cust.name;
      customerSet.add(currentCustomerCode);
      continue;
    }

    // Kolon başlığı satırı — her müşteri bloğunda tekrar eder
    if (c0 === "Tarih") {
      currentCols = findHeaderColumns(r);
      continue;
    }

    // Data satırı şartları
    if (!currentCustomerCode || !currentCols) continue;
    const belgeNoVal = r[currentCols.belgeNo];
    const stokKoduVal = r[currentCols.stokKodu];
    const belgeNo = belgeNoVal !== "" && belgeNoVal !== undefined ? String(belgeNoVal).trim() : "";
    const stokKodu = stokKoduVal !== "" && stokKoduVal !== undefined ? String(stokKoduVal).trim() : "";
    if (!belgeNo || !stokKodu || stokKodu === "Stok Kodu") continue;

    const teslimTarihi = parseSerialDate(r[currentCols.teslimTarihi]);
    const orderDateIso = parseSerialDate(r[currentCols.orderDate]);
    // ID fallback zinciri: teslim yoksa orderDate, o da yoksa row-index.
    // Aynı belgeNo+stokKodu'da teslim boş 2 satır gelirse collision olmasın diye.
    const idKey = teslimTarihi || orderDateIso || `row${i}`;
    const id = `${belgeNo}_${stokKodu}_${idKey}`;

    const row = {
      customerCode: currentCustomerCode,
      customerName: currentCustomerName,
      orderDate: orderDateIso,
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
