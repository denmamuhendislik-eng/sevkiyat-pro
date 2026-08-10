// İhracat Sipariş Raporu Excel parser'ı.
//
// Format: VIO ERP "Sipariş Raporu Toplamlı (Müşteri Alt Hesaplı)" çıktısı.
// Diğer Müşteriler modülündeki parseSalesOrderExcel deseni birebir uygulanır
// (aynı Excel yapısı, exact header match).
//
// Kritik davranışlar:
//   - Header exact match ("h === ..."). Çakışan başlıklar (örn. "Stok Adı" vs
//     "Stok Kodu") kırık eşleşme yapmasın diye.
//   - 3-tuple ID: `belgeNo_stokKodu_teslimTarihi`. Aynı ID gelirse aggregate
//     (miktar/bedel toplanır) — VIO'da nadir ama tarihsel bug'ı önler.
//   - Excel serial date → ISO (YYYY-MM-DD). Tarih boşsa "notarih" sentinel.
//   - Ürün eşleştirme (products.vioCode) ayrı bir fonksiyonda — parser sadece
//     kayıtları döndürür, matcher UI'da çağrılır (mocked verilebilsin diye).

import * as XLSX from "xlsx";

const pNum = (v) => {
  if (v === "" || v === undefined || v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function parseSerialDate(v) {
  if (!v) return "";
  if (typeof v === "string") {
    // Zaten ISO ya da başka string formatı — sadece basit kontrol
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }
  if (typeof v !== "number") return "";
  // Excel serial: 25569 = 1970-01-01
  const utcDays = v - 25569;
  const d = new Date(utcDays * 86400000);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Müşteri başlığı — iki formatı destekle (Diğer Müşteriler pattern):
//   1) "Müşteri 120-XXXX AD..." tek hücre
//   2) "Müşteri" | "120-XXXX" | ... | "AD..." parçalı
function detectCustomerHeader(row) {
  const c0 = String(row?.[0] || "").trim();
  if (!c0.startsWith("Müşteri")) return null;
  if (c0 === "Müşteri") {
    const code = String(row?.[1] || "").trim();
    const name = String(row?.[3] || row?.[2] || "").trim();
    if (!code) return null;
    return { code, name };
  }
  const m = c0.match(/Müşteri\s+(\S+)\s+(.+)/);
  if (m) return { code: m[1].trim(), name: m[2].trim() };
  return null;
}

// Header row → kolon index'leri (exact match).
// Beklenen: Tarih | Belge No | Stok Kodu | Stok Adı | Teslim Tarihi | Brm |
//           Orijinal Miktar | Sevk Edilen Miktar | Kalan Miktar |
//           Dv.Fiyat | Fiyat | Grup Adı | Toplam Bedel
function findHeaderColumns(row) {
  const cols = {};
  for (let i = 0; i < row.length; i++) {
    const h = String(row[i] || "").trim();
    if (h === "Tarih") cols.orderDate = i;
    else if (h === "Belge No") cols.belgeNo = i;
    else if (h === "Stok Kodu") cols.stokKodu = i;
    else if (h === "Stok Adı") cols.stokAdi = i;
    else if (h === "Teslim Tarihi") cols.teslimTarihi = i;
    else if (h === "Brm") cols.brm = i;
    else if (h === "Orijinal Miktar") cols.orijinalMiktar = i;
    else if (h === "Sevk Edilen Miktar") cols.sevkEdilen = i;
    else if (h === "Kalan Miktar") cols.kalanMiktar = i;
    else if (h === "Dv.Fiyat") cols.dvFiyat = i;
    else if (h === "Fiyat") cols.fiyat = i;
    else if (h === "Grup Adı") cols.grupAdi = i;
    else if (h === "Toplam Bedel") cols.toplamBedel = i;
  }
  return cols;
}

// Ana parser — workbook'u alıp orders map + meta döndürür.
// Not: ürün eşleştirme burada YAPILMAZ. UI önizleme aşamasında matchProducts()
// çağrılır (products + kod haritası ile).
export function parseExportOrderExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const ordersMap = {};
  const customerSet = new Set();
  let currentCustomerCode = "";
  let currentCustomerName = "";
  let currentCols = null;
  let aggregateCount = 0;
  let skippedRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    const cust = detectCustomerHeader(r);
    if (cust) {
      currentCustomerCode = cust.code;
      currentCustomerName = cust.name;
      customerSet.add(currentCustomerCode);
      continue;
    }

    if (c0 === "Tarih") {
      currentCols = findHeaderColumns(r);
      continue;
    }

    if (!currentCustomerCode || !currentCols) continue;

    const belgeNoVal = r[currentCols.belgeNo];
    const stokKoduVal = r[currentCols.stokKodu];
    const belgeNo = belgeNoVal !== "" && belgeNoVal !== undefined ? String(belgeNoVal).trim() : "";
    const stokKodu = stokKoduVal !== "" && stokKoduVal !== undefined ? String(stokKoduVal).trim() : "";

    if (!belgeNo || !stokKodu || stokKodu === "Stok Kodu") { skippedRows++; continue; }

    const teslimTarihi = parseSerialDate(r[currentCols.teslimTarihi]);
    const orderDateIso = parseSerialDate(r[currentCols.orderDate]);
    // 3-tuple ID — teslim yoksa orderDate, o da yoksa row-index sentinel
    const idKey = teslimTarihi || orderDateIso || `row${i}`;
    const id = `${belgeNo}_${stokKodu}_${idKey}`;

    const row = {
      id,
      customerCode: currentCustomerCode,
      customerName: currentCustomerName,
      orderDate: orderDateIso,
      belgeNo,
      stokKodu,
      stokAdi: String(r[currentCols.stokAdi] || "").trim(),
      teslimTarihi, // "" olabilir (opsiyonel — kullanıcı sonra girer)
      brm: String(r[currentCols.brm] || "").trim(),
      orijinalMiktar: pNum(r[currentCols.orijinalMiktar]),
      // Excel'deki VIO geçmiş sevki — sisteme "başlangıç bakiyesi" olarak taşınır
      sevkedilenBaslangic: pNum(r[currentCols.sevkEdilen]),
      // Bilgi amaçlı (Excel'deki hazır kalan; sistem içi bakiyeyi kullanıcı yeniden hesaplar)
      kalanMiktarExcel: pNum(r[currentCols.kalanMiktar]),
      birimFiyat: pNum(r[currentCols.dvFiyat]), // Dv.Fiyat = döviz birim fiyatı
      fiyat: pNum(r[currentCols.fiyat]),
      grupAdi: String(r[currentCols.grupAdi] || "").trim(),
      toplamBedel: pNum(r[currentCols.toplamBedel]),
      status: "open",
      source: "import",
    };

    if (ordersMap[id]) {
      aggregateCount++;
      ordersMap[id].orijinalMiktar += row.orijinalMiktar;
      ordersMap[id].sevkedilenBaslangic += row.sevkedilenBaslangic;
      ordersMap[id].kalanMiktarExcel += row.kalanMiktarExcel;
      ordersMap[id].toplamBedel += row.toplamBedel;
    } else {
      ordersMap[id] = row;
    }
  }

  return {
    ordersMap,
    customerSet: Array.from(customerSet),
    orderCount: Object.keys(ordersMap).length,
    rowCount: Object.keys(ordersMap).length + aggregateCount,
    aggregateCount,
    skippedRows,
    parsedAt: new Date().toISOString(),
  };
}

// Ürünler ile eşleştir. products: [{ id, vioCode, nameTR, nameEN, ... }]
// codeMap: settings.codeMap ({ [vioCode]: pid, ... }) — daha önce manuel bağlanmış eşleşmeler
//
// Her sipariş için pid + descriptionEn (nameEN fallback) doldurulur.
// Dönüş: { matched: [orders], unmatched: [orders] }
export function matchProductsToOrders(ordersMap, products, codeMap = {}) {
  const productsByVio = new Map();
  for (const p of (products || [])) {
    const code = String(p?.vioCode || "").trim();
    if (code) productsByVio.set(code, p);
  }
  const matched = [];
  const unmatched = [];
  for (const o of Object.values(ordersMap || {})) {
    const code = String(o.stokKodu || "").trim();
    // Önce codeMap (öğrenilmiş manuel eşleşme)
    let pid = codeMap?.[code] != null ? Number(codeMap[code]) : null;
    let prod = null;
    if (pid != null) prod = (products || []).find(p => Number(p.id) === pid) || null;
    // Yoksa vioCode
    if (!prod) {
      prod = productsByVio.get(code) || null;
      if (prod) pid = Number(prod.id);
    }
    const enriched = {
      ...o,
      pid,
      descriptionEn: prod?.nameEN || "",
    };
    if (prod) matched.push(enriched);
    else unmatched.push(enriched);
  }
  return { matched, unmatched };
}

// Mevcut Firestore ordersMap ile karşılaştır — dupliction tespiti (import öncesi rapor)
export function classifyForImport(parsedOrders, existingOrdersMap) {
  const existing = existingOrdersMap || {};
  const newOnes = [];
  const duplicates = [];
  for (const o of parsedOrders) {
    if (existing[o.id]) duplicates.push({ ...o, _existing: existing[o.id] });
    else newOnes.push(o);
  }
  return { newOnes, duplicates };
}
