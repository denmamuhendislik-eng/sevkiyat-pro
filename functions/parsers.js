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
    else if (h.includes("orijinal miktar")) cols.orijinalMiktar = ci;
    else if (h.includes("sevk edilen")) cols.sevkEdilen = ci;
    else if (h.includes("kalan miktar")) cols.kalanMiktar = ci;
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

module.exports = {
  parseStockReport,
  parseAkibetExcel,
  parsePurchaseExcel,
  parseSalesOrdersReport,
};
