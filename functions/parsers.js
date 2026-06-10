/**
 * VIO Parsers — Server-side Node.js port
 *
 * App.jsx (v11 sonrası) içindeki 3 parser fonksiyonunun BIREBIR kopyası.
 * Sevkiyat Pro frontend'iyle aynı çıktıyı üretmesi GARANTI edilmiştir.
 *
 * Tek fark: bu dosya React state'i (saveStock vb.) çağırmaz, sadece
 * { workbook } → { result } dönüşümü yapar. Firestore yazma `firestore.js`
 * tarafında yapılır.
 *
 * Eşleştirme tablosu (App.jsx satırları → bu dosya):
 *   parseStockReport      App.jsx ~4931
 *   parseAkibetExcel      App.jsx ~6547
 *   parsePurchaseExcel    App.jsx ~7309
 *
 * Helper'lar (norm, pNum, classifyLoc, fmtVioDate) burada yerel olarak
 * tanımlandı, App.jsx'teki versiyonlarıyla birebir aynı.
 */

const XLSX = require("xlsx");

// ==================== ORTAK YARDIMCILAR ====================

const norm = (s) =>
  String(s || "")
    .replace(/[\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");

const pNum = (v) => {
  if (v === "" || v === undefined || v === null) return 0;
  // v18.16 fix: XLSX.js Number hücrelerini (örn. 4255.32) doğrudan al.
  // String'e çevirip .replace(/\./g, "") uygulanırsa ondalık nokta silinir
  // ve 425532 gibi yanlış (100x şişkin) sonuç oluşur. String girdiler için
  // eski Türk formatı parse ("1.234,56" → 1234.56) aynen korunur.
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).trim();
  if (!s) return 0;
  // Türkçe sayı formatı: "1.234,56" → "1234.56"
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

// v14: Emir tarihi parse — VIO formatı D(D)MMYYYY, 7 veya 8 haneli (örn "2042026" = 02.04.2026).
// Bazı rapor sürümlerinde "DD.MM.YYYY", "DD/MM/YYYY" veya Excel serial de gelebilir.
// Çıktı: "YYYY-MM-DD" veya null. Frontend parseAkibetExcel ile birebir aynı.
const parseEmirTarihi = (v) => {
  if (v === "" || v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{7,8}$/.test(s)) {
    const padded = s.padStart(8, "0");
    const dd = padded.substring(0, 2);
    const mm = padded.substring(2, 4);
    const yyyy = padded.substring(4, 8);
    const y = Number(yyyy);
    if (y < 2000 || y > 2100) return null;
    return `${yyyy}-${mm}-${dd}`;
  }
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
  return null;
};

// ==================== STOK RAPORU ====================

const AMBAR_LOCS = new Set([
  "Hammadde ve Malzeme",
  "Yardımcı Malzeme Ambarı",
  "Merkez Ambarı",
  "Kontrol ve Giriş Ambarı",
  "Sevkiyat Ambarı",
  "Montaj Hattı",
]);
const URETIM_LOCS = new Set([
  "Üretim Hattı",
  "PRES HATTI",
  "KAYNAK HATTI",
  "TALAŞ AMBARI",
  "Lazer Mamül Ambarı",
]);
const HARIC_LOCS = new Set([
  "Iskarta Ambarı",
  "Hurda ve Talaş Ambarı",
  "Lazer Hurda Ambarı",
  "Yeniden İşleme Ambarı",
]);

const classifyLoc = (loc) => {
  if (!loc) return "ambar";
  if (AMBAR_LOCS.has(loc)) return "ambar";
  if (URETIM_LOCS.has(loc)) return "uretim";
  if (HARIC_LOCS.has(loc)) return "haric";
  return "fason";
};

function parseStockReport(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Dinamik sütun tespiti — header satırını ilk 15 satırda ara
  let cols = null;
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i];
    let codeCi = -1;
    for (let ci = 0; ci < row.length; ci++) {
      if (norm(row[ci]) === "stok kodu") {
        codeCi = ci;
        break;
      }
    }
    if (codeCi >= 0) {
      headerIdx = i;
      cols = { code: codeCi };
      row.forEach((cell, ci) => {
        const h = norm(cell);
        if (!h) return;
        if (h === "stok adı" || h === "stok adi") cols.name = ci;
        else if (h === "yer adı" || h === "yer adi") cols.loc = ci;
        else if (h === "miktar") cols.qty = ci;
        else if (h === "br") cols.unit = ci;
        else if (h === "lot no") cols.lot = ci;
        else if (h === "operasyon adı" || h === "operasyon adi") cols.opName = ci;
        else if (h === "oper.no" || h === "oper no") cols.opNo = ci;
      });
      break;
    }
  }

  if (!cols || cols.loc == null || cols.qty == null) {
    return {
      parts: [],
      totalCodes: 0,
      totalRows: 0,
      categories: {
        ambar: { count: 0, total: 0 },
        uretim: { count: 0, total: 0 },
        fason: { count: 0, total: 0 },
        haric: { count: 0, total: 0 },
      },
      locations: [],
      fasonCompanies: [],
    };
  }

  let currentGroup = "";
  const partsMap = {};
  const locSet = new Set();
  const fasonSet = new Set();
  let dataRows = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = String(r[cols.code] || "").trim();
    if (!code) continue;
    if (/^\d{3}\s{2,}/.test(code)) {
      currentGroup = code.replace(/\s{2,}/g, " ").trim();
      continue;
    }
    const codeNorm = norm(code);
    if (
      codeNorm === "stok kodu" ||
      codeNorm.startsWith("denma") ||
      codeNorm.startsWith("son stok") ||
      codeNorm.startsWith("miktar")
    )
      continue;
    if (!code.match(/^[\w\d]/)) continue;

    const name = cols.name != null ? String(r[cols.name] || "").trim() : "";
    const loc = String(r[cols.loc] || "").trim();
    const qty = pNum(r[cols.qty]);
    const unit = (cols.unit != null ? String(r[cols.unit] || "").trim() : "") || "AD";
    const opName = (cols.opName != null ? String(r[cols.opName] || "").trim() : "") || null;
    const opNo = (cols.opNo != null ? String(r[cols.opNo] || "").trim() : "") || null;

    if (!loc) continue;
    const cat = classifyLoc(loc);
    locSet.add(loc);
    if (cat === "fason") fasonSet.add(loc);
    dataRows++;

    if (!partsMap[code]) {
      partsMap[code] = {
        code,
        name,
        unit,
        group: currentGroup,
        ambar: 0,
        uretim: 0,
        fason: 0,
        haric: 0,
        total: 0,
        locs: [],
      };
    }
    const p = partsMap[code];
    p[cat] += qty;
    p.total += qty;
    p.locs.push({
      l: loc,
      q: qty,
      ...(opName ? { o: opName } : {}),
      ...(opNo ? { n: opNo } : {}),
      c: cat,
    });
  }

  const parts = Object.values(partsMap);
  return {
    parts,
    totalCodes: parts.length,
    totalRows: dataRows,
    categories: {
      ambar: {
        count: parts.filter((p) => p.ambar > 0).length,
        total: Math.round(parts.reduce((s, p) => s + p.ambar, 0)),
      },
      uretim: {
        count: parts.filter((p) => p.uretim > 0).length,
        total: Math.round(parts.reduce((s, p) => s + p.uretim, 0)),
      },
      fason: {
        count: parts.filter((p) => p.fason > 0).length,
        total: Math.round(parts.reduce((s, p) => s + p.fason, 0)),
      },
      haric: {
        count: parts.filter((p) => p.haric > 0).length,
        total: Math.round(parts.reduce((s, p) => s + p.haric, 0)),
      },
    },
    locations: [...locSet].sort(),
    fasonCompanies: [...fasonSet].sort(),
  };
}

// ==================== BEKLEYEN OPERASYONLAR (ÜRÜNLÜ) — AKIBET ====================

function parseAkibetExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const findHeaderColumns = (row) => {
    const cols = {};
    row.forEach((cell, ci) => {
      const h = norm(cell);
      if (!h) return;
      if (h === "emir no") cols.emirNo = ci;
      else if (h.includes("emir tarihi")) cols.emirTarihi = ci;
      else if (h === "emir miktarı" || h === "emir miktari") cols.emirMiktari = ci;
      else if (h.includes("operasyon emir sayacı") || h.includes("operasyon emir sayaci"))
        cols.sayaci = ci;
      else if (h.includes("üretilen miktar") || h.includes("uretilen miktar"))
        cols.uretilen = ci;
      else if (h.includes("emir kalan miktarı") || h.includes("emir kalan miktari"))
        cols.kalan = ci;
      else if (h === "oper.no" || h === "oper no") cols.opNo = ci;
      else if (h === "operasyon adı" || h === "operasyon adi") cols.opName = ci;
      else if (h.includes("oper.baş") || h.includes("oper bas")) cols.opBasTarihi = ci;
      else if (h === "iş mrk" || h === "is mrk") cols.isMrk = ci;
    });
    return cols;
  };

  const partsMap = {};
  let currentCode = "",
    currentName = "",
    currentUnit = "AD";
  let currentCols = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    if (c0 === "Ürün" || c0 === "Urun") {
      currentCode = String(r[1] || "").trim();
      currentName = String(r[4] || "").trim();
      currentUnit = String(r[10] || "").trim() || "AD";
      currentCols = null;
      continue;
    }

    if (c0 === "Emir No") {
      currentCols = findHeaderColumns(r);
      continue;
    }

    if (!currentCode || !currentCols) continue;

    if (!c0 || !/^\d+$/.test(c0)) continue;

    const cols = currentCols;
    const emirNo = c0;
    const emirQty = pNum(r[cols.emirMiktari]);
    const sayaci = pNum(r[cols.sayaci]);
    const uretilen = pNum(r[cols.uretilen]);
    const kalan = pNum(r[cols.kalan]);
    const opNo = String(r[cols.opNo] || "").trim();
    const opName = String(r[cols.opName] || "").trim();
    const isMrk = cols.isMrk != null ? String(r[cols.isMrk] || "").trim() : "";
    if (!opName) continue;
    const isFason = opName.toUpperCase().includes("FASON");

    if (!partsMap[currentCode]) {
      partsMap[currentCode] = {
        code: currentCode,
        name: currentName,
        unit: currentUnit,
        ordersMap: {},
      };
    }
    const part = partsMap[currentCode];
    if (!part.ordersMap[emirNo]) {
      // v14: Emir açılış tarihi (öncelikle emirTarihi column'u, yoksa opBasTarihi fallback)
      const openDate = cols.emirTarihi != null ? parseEmirTarihi(r[cols.emirTarihi]) : null;
      part.ordersMap[emirNo] = { emirNo, qty: emirQty, openDate, opsRaw: [] };
    }
    part.ordersMap[emirNo].opsRaw.push({
      sayaci,
      uretilen,
      kalan,
      opNo,
      opName,
      isMrk,
      isFason,
    });
  }

  // İkinci geçiş: cancelled-op detection + agregasyon
  const anomalies = [];
  const parts = [];

  Object.values(partsMap).forEach((part) => {
    const orders = [];
    let internalRemaining = 0,
      fasonRemaining = 0,
      totalRemaining = 0,
      totalQty = 0;

    Object.values(part.ordersMap).forEach((order) => {
      const opsSorted = [...order.opsRaw].sort((a, b) => a.sayaci - b.sayaci);

      const cancelledIdxs = new Set();
      for (let i2 = 0; i2 < opsSorted.length; i2++) {
        if (opsSorted[i2].uretilen === 0) {
          for (let j = i2 + 1; j < opsSorted.length; j++) {
            if (opsSorted[j].uretilen > 0) {
              cancelledIdxs.add(i2);
              break;
            }
          }
        }
      }

      if (cancelledIdxs.size > 0) {
        anomalies.push({
          code: part.code,
          name: part.name,
          emirNo: order.emirNo,
          cancelledOps: [...cancelledIdxs]
            .sort((a, b) => a - b)
            .map((idx) => opsSorted[idx].opName),
        });
      }

      const ops = opsSorted.map((op, idx) => {
        const cancelled = cancelledIdxs.has(idx);
        return {
          name: op.opName,
          isFason: op.isFason,
          remaining: cancelled ? 0 : op.kalan,
          opCode: op.opNo,
          wcCode: op.isMrk,
          sayaci: op.sayaci,
          uretilen: op.uretilen,
          cancelled,
        };
      });

      let orderIntRem = 0,
        orderFasRem = 0;
      ops.forEach((op) => {
        if (op.cancelled) return;
        if (op.isFason) orderFasRem = Math.max(orderFasRem, op.remaining);
        else orderIntRem = Math.max(orderIntRem, op.remaining);
      });
      // v14 fix: Emirin GERÇEK fiziksel kalan parça sayısı = MAX(iç, fason).
      // Aynı 80 parça hem iç hem fason op'lardan geçer; intRem+fasRem = ÇİFT SAYIM.
      // intRem/fasRem ayrımı workload dağılımı için korunur, ama WIP toplamı orderRem üzerinden.
      const orderRem = Math.max(orderIntRem, orderFasRem);

      // v14 Adım 1: Emir'in fiziksel konumu — ilk açık op ve kalan op dağılımı
      const activeOps = ops.filter((op) => !op.cancelled && op.remaining > 0);
      const firstActive = ops.find((op) => !op.cancelled && op.remaining > 0);
      const firstOpenOp = firstActive
        ? {
            name: firstActive.name,
            isFason: firstActive.isFason,
            opCode: firstActive.opCode,
          }
        : null;
      const remainingOps = {
        total: activeOps.length,
        fason: activeOps.filter((op) => op.isFason).length,
        internal: activeOps.filter((op) => !op.isFason).length,
      };

      orders.push({
        emirNo: order.emirNo,
        qty: order.qty,
        openDate: order.openDate || null, // v14
        intRem: orderIntRem,
        fasRem: orderFasRem,
        rem: orderRem, // v14
        firstOpenOp, // v14
        remainingOps, // v14
        ops,
      });
      totalQty += order.qty;
      internalRemaining += orderIntRem;
      fasonRemaining += orderFasRem;
      totalRemaining += orderRem; // v14
    });

    parts.push({
      code: part.code,
      name: part.name,
      unit: part.unit,
      totalQty,
      internalRemaining,
      fasonRemaining,
      totalRemaining, // v14
      orderCount: orders.length,
      orders,
    });
  });

  const totalParts = parts.length;
  const withInternal = parts.filter((p) => p.internalRemaining > 0).length;
  const withFason = parts.filter((p) => p.fasonRemaining > 0).length;

  const uniqueOpNames = new Set();
  parts.forEach((p) =>
    p.orders.forEach((o) =>
      o.ops.forEach((op) => {
        if (!op.cancelled) uniqueOpNames.add(op.name);
      }),
    ),
  );
  const opColumns = [...uniqueOpNames].map((name) => ({
    name,
    isFason: name.toUpperCase().includes("FASON"),
  }));

  return {
    parts,
    totalParts,
    withInternal,
    withFason,
    opColumns,
    anomalies,
    importedAt: new Date().toISOString(),
  };
}

// ==================== SİPARİŞ KONTROL LİSTESİ (BELGE NO) — PURCHASE ====================

const fmtVioDate = (v) => {
  const s = String(v || "").trim();
  if (!/^\d{7,8}$/.test(s)) return s;
  const year = s.slice(-4);
  const month = s.slice(-6, -4);
  const day = s.slice(0, -6).padStart(2, "0");
  return `${day}.${month}.${year}`;
};

function parsePurchaseExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const findCols = (row) => {
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
    });
    return cols;
  };

  let currentOrder = "",
    currentSupplier = "",
    currentDate = "";
  let currentCols = null;
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    if (c0 === "No") {
      currentOrder = String(r[1] || "").trim();
      currentDate = fmtVioDate(r[4]);
      currentSupplier = String(r[7] || "").trim().replace(/\s{2,}/g, " ");
      currentCols = null;
      continue;
    }

    if (norm(c0) === "stok kodu") {
      currentCols = findCols(r);
      continue;
    }

    if (!currentCols) continue;

    if (!c0 || !c0.match(/^[\w\d]/)) continue;
    const cn = norm(c0);
    if (cn === "no" || cn === "müşteri" || cn === "musteri" || cn === "stok kodu" || cn === "nakliye")
      continue;
    if (
      cn.startsWith("denma") ||
      cn.startsWith("bekleme") ||
      cn.startsWith("rapor") ||
      cn.startsWith("onay") ||
      cn.startsWith("stok/")
    )
      continue;

    const cols = currentCols;
    const code = c0;
    const name = cols.name != null ? String(r[cols.name] || "").trim() : "";
    const teslim = cols.teslim != null ? fmtVioDate(r[cols.teslim]) : "";
    const unit = (cols.unit != null ? String(r[cols.unit] || "").trim() : "") || "AD";
    const original = pNum(r[cols.original]);
    const shipped = pNum(r[cols.shipped]);
    const remaining = pNum(r[cols.remaining]);

    if (original > 0 || remaining > 0) {
      items.push({
        code,
        name,
        unit,
        order: currentOrder,
        supplier: currentSupplier,
        date: currentDate,
        teslim,
        original,
        shipped,
        remaining,
      });
    }
  }

  const partsMap = {};
  items.forEach((it) => {
    if (!partsMap[it.code]) {
      partsMap[it.code] = {
        code: it.code,
        name: it.name,
        unit: it.unit,
        totalRemaining: 0,
        totalOriginal: 0,
        suppliers: [],
        orders: [],
      };
    }
    const p = partsMap[it.code];
    p.totalRemaining += it.remaining;
    p.totalOriginal += it.original;
    if (!p.suppliers.includes(it.supplier)) p.suppliers.push(it.supplier);
    p.orders.push({
      order: it.order,
      supplier: it.supplier,
      teslim: it.teslim,
      original: it.original,
      remaining: it.remaining,
    });
  });

  const parts = Object.values(partsMap);
  const supplierSet = new Set(items.map((i) => i.supplier).filter(Boolean));

  return {
    parts,
    totalParts: parts.length,
    totalItems: items.length,
    totalRemaining: parts.reduce((s, p) => s + p.totalRemaining, 0),
    supplierCount: supplierSet.size,
    importedAt: new Date().toISOString(),
  };
}

// ==================== 4. PARSER — SİPARİŞ RAPORU TOPLAMLI (MÜŞTERİ ALT HESAPLI) ====================
// Frontend src/modules/digerMusteriler/parser.js'in CommonJS aynası.
// İki format auto-detect: VIO mail export (3 hücreye yayılmış müşteri başlığı, integer DDMMYYYY tarih)
// + eski manuel export (tek hücre müşteri başlığı, text DD.MM.YYYY).

function pNumSO(v) {
  if (v === "" || v === undefined || v === null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function parseSerialDateSO(v) {
  if (v === "" || v === undefined || v === null) return "";
  if (typeof v === "number" && !isNaN(v)) {
    // Mail format DDMMYYYY
    if (v >= 1000000 && v <= 99999999) {
      const s = String(v).padStart(8, "0");
      const dd = s.substring(0, 2);
      const mm = s.substring(2, 4);
      const yyyy = s.substring(4, 8);
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
  const s = String(v).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const n = Number(s);
  if (!isNaN(n)) return parseSerialDateSO(n);
  return "";
}

function findHeaderColumnsSO(row) {
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
    // Exact match — Excel'de 'Kalan Miktar Bedeli' (TL) gibi bedel kolonları
    // 'kalan miktar' substring'iyle çakışıyordu, miktar yerine TL okunuyordu.
    else if (h === "orijinal miktar") cols.orijinalMiktar = ci;
    else if (h === "sevk edilen miktar" || h === "sevk edilen") cols.sevkEdilen = ci;
    else if (h === "kalan miktar") cols.kalanMiktar = ci;
    else if (h.includes("dv.fiyat") || h.includes("dv fiyat")) cols.dvFiyat = ci;
    else if (h === "fiyat") cols.fiyat = ci;
    else if (h.includes("toplam bedel")) cols.toplamBedel = ci;
  });
  return cols;
}

function detectCustomerHeaderSO(r) {
  const c0 = String(r[0] || "").trim();
  if (!c0.startsWith("Müşteri")) return null;
  if (c0 === "Müşteri") {
    const code = String(r[1] || "").trim();
    const name = String(r[3] || r[2] || "").trim();
    if (code && name) return { code, name };
  }
  const m = c0.match(/Müşteri\s+(\S+)\s+(.+)/);
  if (m) return { code: m[1].trim(), name: m[2].trim() };
  return null;
}

function parseSalesOrdersReport(workbook) {
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
    const cust = detectCustomerHeaderSO(r);
    if (cust) {
      currentCustomerCode = cust.code;
      currentCustomerName = cust.name;
      customerSet.add(currentCustomerCode);
      continue;
    }
    if (c0 === "Tarih") {
      currentCols = findHeaderColumnsSO(r);
      continue;
    }
    if (!currentCustomerCode || !currentCols) continue;
    const belgeNoVal = r[currentCols.belgeNo];
    const stokKoduVal = r[currentCols.stokKodu];
    const belgeNo = belgeNoVal !== "" && belgeNoVal !== undefined ? String(belgeNoVal).trim() : "";
    const stokKodu = stokKoduVal !== "" && stokKoduVal !== undefined ? String(stokKoduVal).trim() : "";
    if (!belgeNo || !stokKodu || stokKodu === "Stok Kodu") continue;
    const teslimTarihi = parseSerialDateSO(r[currentCols.teslimTarihi]);
    const orderDateIso = parseSerialDateSO(r[currentCols.orderDate]);
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
      orijinalMiktar: pNumSO(r[currentCols.orijinalMiktar]),
      sevkEdilen: pNumSO(r[currentCols.sevkEdilen]),
      kalanMiktar: pNumSO(r[currentCols.kalanMiktar]),
      dvFiyat: pNumSO(r[currentCols.dvFiyat]),
      fiyat: pNumSO(r[currentCols.fiyat]),
      toplamBedel: pNumSO(r[currentCols.toplamBedel]),
    };
    if (ordersMap[id]) {
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

// ==================== SATIN ALMA + FİYAT (UNIT COSTS) ====================
//
// Sipariş Kontrol Listesi (Belge No) raporu — fiyat kolonu eklenmiş versiyon.
// Aynı email, mevcut parsePurchaseExcel sevkiyat takibi için kullanılır;
// bu fonksiyon ek olarak fiyat çıkarımı yapar → unitCosts FIFO partileri.
//
// Frontend src/modules/maliyet/purchaseParser.js ile birebir aynı mantık.

const HARDCODED_MONTHLY_RATES = {
  "2024-01": { USD: 30.0, EUR: 32.7 }, "2024-06": { USD: 32.5, EUR: 35.0 },
  "2024-12": { USD: 35.3, EUR: 37.2 }, "2025-03": { USD: 37.0, EUR: 40.0 },
  "2025-06": { USD: 39.5, EUR: 43.5 }, "2025-09": { USD: 41.0, EUR: 47.0 },
  "2025-12": { USD: 42.5, EUR: 49.0 }, "2026-01": { USD: 43.0, EUR: 49.5 },
  "2026-02": { USD: 43.5, EUR: 50.0 }, "2026-03": { USD: 44.0, EUR: 50.5 },
  "2026-04": { USD: 44.5, EUR: 51.0 }, "2026-05": { USD: 45.0, EUR: 51.5 },
};

function getApproxRate(dateStr) {
  if (!dateStr) {
    const months = Object.keys(HARDCODED_MONTHLY_RATES).sort();
    return HARDCODED_MONTHLY_RATES[months[months.length - 1]];
  }
  const ym = dateStr.slice(0, 7);
  if (HARDCODED_MONTHLY_RATES[ym]) return HARDCODED_MONTHLY_RATES[ym];
  const months = Object.keys(HARDCODED_MONTHLY_RATES).sort();
  let best = months[0], bestDiff = Infinity;
  for (const m of months) {
    const diff = Math.abs(m.localeCompare(ym));
    if (diff < bestDiff) { bestDiff = diff; best = m; }
  }
  return HARDCODED_MONTHLY_RATES[best];
}

function guessCurrency(ratio, dateStr) {
  const refRates = getApproxRate(dateStr);
  if (!ratio || ratio <= 0) return { currency: "TRY", confidence: "high", refRate: null };
  const usdDiff = Math.abs(ratio - refRates.USD) / refRates.USD;
  const eurDiff = Math.abs(ratio - refRates.EUR) / refRates.EUR;
  const pick = usdDiff < eurDiff ? "USD" : "EUR";
  const pickDiff = Math.min(usdDiff, eurDiff);
  const confidence = pickDiff < 0.05 ? "high" : pickDiff < 0.15 ? "medium" : "low";
  return { currency: pick, confidence, refRate: refRates[pick] };
}

// ISO tarih parse — frontend purchaseParser.js parseVioDate ile birebir aynı output (YYYY-MM-DD).
// fmtVioDate (DD.MM.YYYY) burada KULLANILMAZ — duplicate kontrolü için frontend ile tutarlı olmalı.
function parseVioDateIso(v) {
  if (v === "" || v === undefined || v === null) return null;
  if (typeof v === "number") {
    if (v > 25000 && v < 100000) {
      const d = new Date((v - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
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
}

function parsePurchaseWithPrices(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const findCols = (row) => {
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
      else if (h === "dv.fiyat") cols.dvzPrice = ci;
      else if (h === "satır net dv.fiyatı") cols.netDvzPrice = ci;
      else if (h === "fiyat") cols.price = ci;
      else if (h === "satır net fiyatı") cols.netPrice = ci;
    });
    return cols;
  };

  let currentBelgeNo = "", currentOrderDate = "", currentSupplierCode = "", currentSupplier = "";
  let cols = null;
  const partitions = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    if (c0 === "No") {
      currentBelgeNo = r[1] !== "" && r[1] != null ? String(r[1]).trim() : "";
      currentOrderDate = parseVioDateIso(r[4]);
      currentSupplierCode = String(r[6] || "").trim();
      currentSupplier = String(r[7] || "").trim().replace(/\s{2,}/g, " ");
      cols = null;
      continue;
    }

    if (norm(c0) === "stok kodu") {
      cols = findCols(r);
      continue;
    }

    if (!cols || !c0) continue;
    if (!c0.match(/^[\w\d]/)) continue;
    const cn = norm(c0);
    if (cn === "no" || cn === "müşteri" || cn === "musteri" || cn === "stok kodu" || cn === "nakliye") continue;
    if (cn.startsWith("denma") || cn.startsWith("bekleme") || cn.startsWith("rapor") || cn.startsWith("onay") || cn.startsWith("stok/")) continue;

    const code = c0;
    const original = pNum(r[cols.original]);
    const remaining = pNum(r[cols.remaining]);
    if (original <= 0 && remaining <= 0) continue;

    const netPrice = pNum(r[cols.netPrice]);
    const netDvzPrice = pNum(r[cols.netDvzPrice]);
    const altCurrency = String(r[cols.altCurrency] || "").trim().toUpperCase();
    const rawPrice = pNum(r[cols.price]);
    const rawDvzPrice = pNum(r[cols.dvzPrice]);

    let currency = "TRY";
    let currencyGuess = null;
    if (altCurrency === "USD" || altCurrency === "EUR") {
      currency = altCurrency;
    } else if (netDvzPrice > 0 || rawDvzPrice > 0) {
      const ratio = netPrice > 0 && netDvzPrice > 0 ? netPrice / netDvzPrice : 0;
      const g = guessCurrency(ratio, currentOrderDate);
      currency = g.currency;
      currencyGuess = { confidence: g.confidence, refRate: g.refRate, observedRatio: ratio };
    }

    const usedTl = netPrice > 0 ? netPrice : rawPrice;

    partitions.push({
      orderDate: currentOrderDate,
      belgeNo: currentBelgeNo,
      code,
      name: String(r[cols.name] || "").trim(),
      unit: String(r[cols.unit] || "").trim() || "AD",
      teslimDate: parseVioDateIso(r[cols.teslim]),
      originalQty: original,
      shippedQty: pNum(r[cols.shipped]),
      remainingQty: remaining,
      unitPriceTl: usedTl,
      unitPriceDvz: netDvzPrice,
      currency,
      currencyGuess,
      supplierCode: currentSupplierCode,
      supplier: currentSupplier,
      _rawPrice: rawPrice,
      _rawDvzPrice: rawDvzPrice,
    });
  }

  const suppliers = new Set();
  const stockCodes = new Set();
  let totalTl = 0;
  for (const p of partitions) {
    suppliers.add(p.supplierCode);
    stockCodes.add(p.code);
    totalTl += (p.unitPriceTl || 0) * (p.originalQty || 0);
  }

  return {
    partitions,
    totalParts: partitions.length,
    supplierCount: suppliers.size,
    stockCount: stockCodes.size,
    totalTl,
    importedAt: new Date().toISOString(),
  };
}

// ==================== HİZMET TOTAL RAPORU (GENEL GİDERLER) ====================
//
// Aylık genel gider raporu — her ay "MM-AyAdı" başlığı + kod/ad/borç/alacak tablosu.
// Frontend src/modules/maliyet/overheadParser.js ile birebir aynı mantık.

const MONTH_NAMES_TR = {
  ocak: "01", "şubat": "02", subat: "02", mart: "03", nisan: "04",
  "mayıs": "05", mayis: "05", haziran: "06", temmuz: "07",
  "ağustos": "08", agustos: "08", "eylül": "09", eylul: "09",
  ekim: "10", "kasım": "11", kasim: "11", "aralık": "12", aralik: "12",
};

function parseMonthHeaderTr(s) {
  const m = String(s || "").trim().match(/^(\d{2})\s*-\s*(\S+)/);
  if (!m) return null;
  const mmFromName = MONTH_NAMES_TR[m[2].toLocaleLowerCase("tr-TR")];
  return mmFromName || m[1];
}

function findOverheadCols(row) {
  const cols = {};
  row.forEach((cell, ci) => {
    const h = norm(cell);
    if (!h) return;
    if (h === "hizmet kodu") cols.code = ci;
    else if (h === "hizmet adı" || h === "hizmet adi") cols.name = ci;
    else if (h.startsWith("borç") || h.startsWith("borc")) cols.borc = ci;
    else if (h.startsWith("alacak")) cols.alacak = ci;
  });
  return cols;
}

function parseOverheadExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

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

  let currentMonth = null;
  const byMonth = {};
  let cols = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || "").trim();

    const mm = parseMonthHeaderTr(c0);
    if (mm) {
      currentMonth = `${year}-${mm}`;
      if (!byMonth[currentMonth]) byMonth[currentMonth] = { items: [], totalBorc: 0 };
      cols = null;
      continue;
    }

    if (norm(c0) === "hizmet kodu") { cols = findOverheadCols(r); continue; }
    if (!c0 || !currentMonth || !cols || cols.borc == null) continue;

    const code = String(r[cols.code] || "").trim();
    const name = cols.name != null ? String(r[cols.name] || "").trim() : "";
    const borc = pNum(r[cols.borc]);

    if (!code || borc <= 0) continue;

    byMonth[currentMonth].items.push({ code, name, amount: borc });
    byMonth[currentMonth].totalBorc += borc;
  }

  const monthsList = Object.keys(byMonth).sort();
  const grandTotal = monthsList.reduce((s, m) => s + byMonth[m].totalBorc, 0);
  const itemCount = monthsList.reduce((s, m) => s + byMonth[m].items.length, 0);
  const uniqueCodes = new Set();
  monthsList.forEach(m => byMonth[m].items.forEach(it => uniqueCodes.add(it.code)));

  return {
    byMonth, year, monthsList, grandTotal, itemCount,
    uniqueCodeCount: uniqueCodes.size,
    importedAt: new Date().toISOString(),
  };
}

// ====================================================================
// SUPPLIES PARSER — "Özet - Aylık Alışlar" (Stok Sarf Hareketleri)
// Frontend src/modules/maliyet/suppliesParser.js'in birebir kopyası
// ====================================================================

const SUPPLIES_MONTH_NAMES = {
  ocak: "01", "şubat": "02", subat: "02", mart: "03", nisan: "04",
  "mayıs": "05", mayis: "05", haziran: "06", temmuz: "07",
  "ağustos": "08", agustos: "08", "eylül": "09", eylul: "09",
  "ekim": "10", "kasım": "11", kasim: "11", "aralık": "12", aralik: "12",
};

function parseSuppliesMonthHeader(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\s*-\s*(\S+)/);
  if (!m) return null;
  const mmNum = m[1].padStart(2, "0");
  const nameLower = m[2].toLocaleLowerCase("tr-TR");
  const mmFromName = SUPPLIES_MONTH_NAMES[nameLower];
  if (mmFromName && mmFromName === mmNum) return mmNum;
  if (mmFromName) return mmFromName;
  return mmNum;
}

function suppliesNorm(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

function isSuppliesHeaderRow(row) {
  const c0 = suppliesNorm(row[0]);
  return c0 === "stok kod" || c0 === "stok kodu";
}

function finalizeSuppliesMonth(items) {
  const totalTl = items.reduce((s, it) => s + (it.amountTl || 0), 0);
  return {
    items,
    totalTl: Math.round(totalTl * 100) / 100,
    itemCount: items.length,
  };
}

function parseSuppliesExcel(workbook, fallbackYear) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const year = Number(fallbackYear) || new Date().getFullYear();

  const months = {};
  let currentMonth = null;
  let currentItems = [];
  let inDataSection = false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const firstCell = String(r[0] != null ? r[0] : "").trim();
    if (!firstCell && (!r[1] || !String(r[1]).trim()) && !r[3]) continue;

    const mm = parseSuppliesMonthHeader(firstCell);
    if (mm) {
      if (currentMonth) {
        months[currentMonth] = finalizeSuppliesMonth(currentItems);
      }
      currentMonth = `${year}-${mm}`;
      currentItems = [];
      inDataSection = false;
      continue;
    }

    if (isSuppliesHeaderRow(r)) {
      inDataSection = true;
      continue;
    }

    if (inDataSection && currentMonth) {
      const code = firstCell;
      if (!code) continue;
      const name = String(r[1] != null ? r[1] : "").trim();
      const kg = pNum(r[2]);
      const amountTl = pNum(r[3]);
      const unitCost = pNum(r[4]);
      if (amountTl <= 0) continue;
      currentItems.push({ code, name, kg, amountTl, unitCost });
    }
  }
  if (currentMonth) {
    months[currentMonth] = finalizeSuppliesMonth(currentItems);
  }

  const monthsList = Object.keys(months).sort();
  return {
    months,
    monthsList,
    totalItems: Object.values(months).reduce((s, m) => s + m.itemCount, 0),
    grandTotalTl: Object.values(months).reduce((s, m) => s + m.totalTl, 0),
    importedAt: new Date().toISOString(),
  };
}

module.exports = {
  parseStockReport,
  parseAkibetExcel,
  parsePurchaseExcel,
  parsePurchaseWithPrices,
  parseSalesOrdersReport,
  parseOverheadExcel,
  parseSuppliesExcel,
};
