// Envanter değer hesabı — eldeki stoğun TL karşılığı.
// Kaynak: mrpStock (VIO stok raporu — appData/mrpStock) × unitCosts (son alış fiyatı)
// 3 katmanlı eşleşme: kod → isim → ilk token (productCostCalc ile aynı pattern)

function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
const normName = (s) => String(s || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
const firstToken = (s) => {
  const t = String(s || "").trim().split(/\s+/)[0];
  return t ? t.toLocaleLowerCase("tr-TR") : "";
};

export function calculateInventoryValue({ mrpStock, unitCosts, productCosts, products, salesOrders, catOverrides }) {
  const parts = mrpStock?.parts || {};
  const byStock = unitCosts?.byStock || {};

  // Bilinen mamul stok kodları — BOM'a girmeden de mamul tespiti için
  // (örn. "BUY" tipi atanmış ama satılan ürünler, BOM'u yüklenmemiş ürünler).
  // Kaynak 1: products[].vioCode (sevkiyat planı ürün listesi)
  // Kaynak 2: salesOrders[].stokKodu (müşteri satış siparişleri)
  const knownProductCodes = new Set();
  for (const p of (products || [])) {
    if (p?.vioCode) knownProductCodes.add(String(p.vioCode).trim());
  }
  for (const o of Object.values(salesOrders || {})) {
    if (o?.stokKodu) knownProductCodes.add(String(o.stokKodu).trim());
  }

  // MRP'de manuel atanmış kategori override'ları — stockCode → catKey (raw_dokum, buy_rulman, vs.)
  // Aşağıdaki CAT_KEY_MAP üzerinden (mainGroup, subCategory) çözümlenir; otomatik regex'e öncelikli.
  const overrideMap = catOverrides || {};
  const CAT_KEY_MAP = {
    raw_dokum: { mainGroup: "⚙️ Hammadde", subCategory: "🔶 Döküm" },
    raw_dolu: { mainGroup: "⚙️ Hammadde", subCategory: "🔩 Dolu Malzeme" },
    raw_diger: { mainGroup: "⚙️ Hammadde", subCategory: "📦 Diğer Hammadde" },
    buy_rulman: { mainGroup: "🛒 Satın Alma", subCategory: "⚙ Rulman / Keçe" },
    buy_baglanti: { mainGroup: "🛒 Satın Alma", subCategory: "🔧 Bağlantı Elemanı" },
    buy_lazer: { mainGroup: "🛒 Satın Alma", subCategory: "✂ Lazer Parça" },
    buy_standart: { mainGroup: "🛒 Satın Alma", subCategory: "🔹 Standart / Yarı Mamül" },
    buy_diger: { mainGroup: "🛒 Satın Alma", subCategory: "📎 Diğer Satın Alma" },
  };

  // ===== unitCosts (BUY/RAW son alış) lookup tabloları =====
  const nameToCode = {};
  const tokensToCode = {};
  const stockUnitCost = {};
  for (const [code, slot] of Object.entries(byStock)) {
    const partitions = slot.partitions || [];
    if (partitions.length === 0) continue;
    const sorted = [...partitions].sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    // En son tarihli partiden geriye doğru tara — fiyatı > 0 olan ilk partiyi al
    // (VIO'da fiyatsız partiler gelebiliyor, kör son parti almak 0 fiyata düşürürdü).
    let lastWithPrice = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (safeNum(sorted[i].unitPriceTl) > 0) { lastWithPrice = sorted[i]; break; }
    }
    const last = lastWithPrice || sorted[sorted.length - 1];
    stockUnitCost[code] = safeNum(last.unitPriceTl);
    const name = slot.lastName || last.name || "";
    if (name) {
      const nk = normName(name);
      if (nk) nameToCode[nk] = code;
      const tk = firstToken(name);
      if (tk && /^\d+/.test(tk)) {
        if (!tokensToCode[tk]) tokensToCode[tk] = [];
        tokensToCode[tk].push(code);
      }
    }
  }

  // ===== productCosts (mamul/yarı mamul hesaplanmış maliyet) lookup =====
  const calcCostByCode = {};
  const calcCostByName = {};
  const calcCostByToken = {};
  // BOM-bazlı kategori — önce ana grup tutulur (Mamul/Yarı Mamul/RAW/BUY), alt kategori
  // item çözümünde isim regex'i ile türetilir (MRP modülündeki kuralın aynısı, App.jsx:15068).
  // FASON supplyType non-root = "Yarı Mamul" (fason yaptırılan parçalar yarı mamul niteliğinde).
  // Aynı stok birden fazla BOM'da görünebilir — en yüksek öncelikli ana grubu tutuyoruz.
  // Fallback için isim bazlı map de açıyoruz (kod uyuşmazlığı durumunda — örn. BOM "150-0119320 TEKER",
  // VIO stokta "119320 TEKER" geçiyorsa isimle yakalanır).
  const stockMainCatByCode = {};
  const stockMainCatByName = {};
  const MAIN_PRIORITY = { "Mamul": 5, "Yarı Mamul": 4, "RAW": 3, "BUY": 2 };
  if (productCosts?.byModel) {
    for (const model of Object.values(productCosts.byModel)) {
      for (const part of (model.partsList || [])) {
        if (!part.stockCode) continue;
        if (part.unitCost > 0) {
          // Aynı stokKodu birden fazla BOM'da olabilir — max al (en doğru olanı yakalama)
          if (!calcCostByCode[part.stockCode] || calcCostByCode[part.stockCode] < part.unitCost) {
            calcCostByCode[part.stockCode] = part.unitCost;
          }
          const nm = normName(part.stockName);
          if (nm && (!calcCostByName[nm] || calcCostByName[nm] < part.unitCost)) {
            calcCostByName[nm] = part.unitCost;
          }
          const tk = firstToken(part.stockName);
          if (tk && /^\d+/.test(tk) && (!calcCostByToken[tk] || calcCostByToken[tk] < part.unitCost)) {
            calcCostByToken[tk] = part.unitCost;
          }
        }
        // Ana kategori tespiti (unitCost > 0 şartı yok — fiyat eksik olsa bile kategori bilinir)
        const isRoot = (part.parentIdx === null || part.parentIdx === undefined);
        let mainCat = null;
        if (isRoot) mainCat = "Mamul";
        else if (part.supplyType === "MAKE" || part.supplyType === "MAKE+FASON" || part.supplyType === "FASON") mainCat = "Yarı Mamul";
        else if (part.supplyType === "RAW") mainCat = "RAW";
        else if (part.supplyType === "BUY") mainCat = "BUY";
        if (mainCat) {
          const curC = stockMainCatByCode[part.stockCode];
          if (!curC || MAIN_PRIORITY[mainCat] > MAIN_PRIORITY[curC]) {
            stockMainCatByCode[part.stockCode] = mainCat;
          }
          const nm = normName(part.stockName);
          if (nm) {
            const curN = stockMainCatByName[nm];
            if (!curN || MAIN_PRIORITY[mainCat] > MAIN_PRIORITY[curN]) {
              stockMainCatByName[nm] = mainCat;
            }
          }
        }
      }
    }
  }

  // Alt kategori türet — MRP modülündeki isim regex'leri (App.jsx:15080)
  // Dönüş: { mainGroup, subCategory, catKey } — UI'da hiyerarşi + override dropdown için.
  // catKey: raw_dokum/raw_dolu/raw_diger/buy_rulman/buy_baglanti/buy_lazer/buy_standart/buy_diger
  // veya null (Mamul/Yarı Mamul/BOM Dışı için override mümkün değil)
  function resolveCategory(mainCat, name) {
    if (!mainCat) return { mainGroup: "❓ BOM Dışı", subCategory: "❓ BOM Dışı", catKey: null };
    if (mainCat === "Mamul") return { mainGroup: "🏭 Mamul", subCategory: "🏭 Mamul", catKey: null };
    if (mainCat === "Yarı Mamul") return { mainGroup: "🔧 Yarı Mamul", subCategory: "🔧 Yarı Mamul", catKey: null };
    const n = String(name || "").toLocaleUpperCase("tr-TR");
    if (mainCat === "RAW") {
      let sub = "📦 Diğer Hammadde";
      let catKey = "raw_diger";
      if (/DÖKÜM|DÖK\.|GÖVDE DÖKÜM/.test(n)) { sub = "🔶 Döküm"; catKey = "raw_dokum"; }
      else if (/MİL|ÇUBUK|BORU|LAMA|SAC|PLAKA|PROFİL|KÜTÜK|DOLU/.test(n)) { sub = "🔩 Dolu Malzeme"; catKey = "raw_dolu"; }
      return { mainGroup: "⚙️ Hammadde", subCategory: sub, catKey };
    }
    if (mainCat === "BUY") {
      let sub = "📎 Diğer Satın Alma";
      let catKey = "buy_diger";
      if (/RULMAN|KEÇE|SEGMAN|O-RİNG|CONTA|SİMERİNG|SEAL/.test(n)) { sub = "⚙ Rulman / Keçe"; catKey = "buy_rulman"; }
      else if (/CİVATA|SOMUN|PERNO|RONDELA|PİM|SAPLAMA|TIRNAK|PERÇIN|YILDIZ|PRES FİT|NİPEL/.test(n)) { sub = "🔧 Bağlantı Elemanı"; catKey = "buy_baglanti"; }
      else if (/LAZER/.test(n)) { sub = "✂ Lazer Parça"; catKey = "buy_lazer"; }
      else if (/YARI MAMÜL|YARI MAMUL|HAZIR|İŞLENMİŞ|MONTAJLI|ALT MONTAJ|KOMPLE|KAPAK|CONTA PLAKA|ELEMAN|ADAPTÖR|MANŞETİ|BAĞLANTI|FLANŞ/.test(n)) { sub = "🔹 Standart / Yarı Mamül"; catKey = "buy_standart"; }
      return { mainGroup: "🛒 Satın Alma", subCategory: sub, catKey };
    }
    return { mainGroup: "❓ BOM Dışı", subCategory: "❓ BOM Dışı", catKey: null };
  }

  // 2 kaynaklı lookup — önce unitCosts (BUY/RAW), sonra productCosts (MAKE)
  function lookupPrice(code, name) {
    // 1. unitCosts kod
    if (stockUnitCost[code] > 0) return { price: stockUnitCost[code], matchedBy: "code", source: "buy-last" };
    // 2. productCosts kod (mamul hesap)
    if (calcCostByCode[code] > 0) return { price: calcCostByCode[code], matchedBy: "code", source: "mamul-calc" };
    // 3. unitCosts isim
    const nk = normName(name);
    if (nk && nameToCode[nk] && stockUnitCost[nameToCode[nk]] > 0) {
      return { price: stockUnitCost[nameToCode[nk]], matchedBy: "name", source: "buy-last" };
    }
    // 4. productCosts isim
    if (nk && calcCostByName[nk] > 0) {
      return { price: calcCostByName[nk], matchedBy: "name", source: "mamul-calc" };
    }
    // 5. unitCosts token
    const tk = firstToken(name);
    if (tk && tokensToCode[tk] && tokensToCode[tk].length === 1 && stockUnitCost[tokensToCode[tk][0]] > 0) {
      return { price: stockUnitCost[tokensToCode[tk][0]], matchedBy: "token", source: "buy-last" };
    }
    // 6. productCosts token
    if (tk && calcCostByToken[tk] > 0) {
      return { price: calcCostByToken[tk], matchedBy: "token", source: "mamul-calc" };
    }
    return { price: 0, matchedBy: "miss", source: "miss" };
  }

  // Stok değer hesabı
  const items = [];
  let totalValue = 0, totalQty = 0, missingPriceCount = 0;
  let totalAmbar = 0, totalUretim = 0, totalFason = 0;

  for (const [code, p] of Object.entries(parts)) {
    const qty = safeNum(p.t);  // total
    if (qty <= 0) continue;
    const { price, matchedBy, source } = lookupPrice(code, p.n);
    const value = price * qty;
    if (price <= 0) missingPriceCount++;
    // Kategori öncelik sırası:
    // 1. MRP manuel override (kullanıcı niyeti açık)
    // 2. BOM bazlı tip + isim regex (otomatik)
    // 3. Mamul fallback (products/salesOrders'da var → BUY/BOM Dışı'sa Mamul'a çek)
    let mainGroup, subCategory, catKey, isOverride = false;
    const ovKey = overrideMap[code];
    if (ovKey && CAT_KEY_MAP[ovKey]) {
      mainGroup = CAT_KEY_MAP[ovKey].mainGroup;
      subCategory = CAT_KEY_MAP[ovKey].subCategory;
      catKey = ovKey;
      isOverride = true;
    } else {
      // BOM'dan ana grup belirle: önce kod, eşleşmezse isim üzerinden
      let mainCat = stockMainCatByCode[code];
      if (!mainCat) {
        const nk = normName(p.n);
        if (nk) mainCat = stockMainCatByName[nk];
      }
      // Mamul fallback — products/salesOrders'ta görünen stoklar BUY/BOM Dışı'dan Mamul'a yükseltilir
      if (knownProductCodes.has(code) && (mainCat !== "Mamul" && mainCat !== "Yarı Mamul")) {
        mainCat = "Mamul";
      }
      const resolved = resolveCategory(mainCat, p.n);
      mainGroup = resolved.mainGroup;
      subCategory = resolved.subCategory;
      catKey = resolved.catKey;
    }
    items.push({
      code,
      name: p.n || "",
      unit: p.u || "AD",
      group: p.g || "",
      mainGroup,
      category: subCategory,
      catKey,            // raw_dokum/buy_rulman/... veya null (Mamul/Yarı Mamul/BOM Dışı)
      catOverride: isOverride,  // true → MRP _catOverrides'tan geliyor, kullanıcı manuel
      qtyAmbar: safeNum(p.a),
      qtyUretim: safeNum(p.r),
      qtyFason: safeNum(p.f),
      qtyHaric: safeNum(p.h),
      qtyTotal: qty,
      unitPriceTl: price,
      value,
      matchedBy,
      source,
    });
    totalValue += value;
    totalQty += qty;
    totalAmbar += safeNum(p.a) * price;
    totalUretim += safeNum(p.r) * price;
    totalFason += safeNum(p.f) * price;
  }

  // Sırala: değer azalan
  items.sort((a, b) => b.value - a.value);

  return {
    items,
    summary: {
      totalValue,
      totalQty,
      stockCount: items.length,
      missingPriceCount,
      totalAmbar,
      totalUretim,
      totalFason,
      mrpStockImportedAt: mrpStock?.importedAt || null,
      unitCostsImportedAt: unitCosts?.lastImport || null,
    },
  };
}

// Aylık anahtarı: 2026-04 (Nisan). Manuel snapshot için mevcut ay kullanılır.
export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

// Aylık etiket: "Nis 2026"
export function monthLabel(mKey) {
  if (!mKey) return "";
  const m = mKey.match(/^(\d{4})-(\d{2})$/);
  if (!m) return mKey;
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

// Çeyrek anahtarı: 2026-Q1 (Oca/Şub/Mar), 2026-Q2 (Nis/May/Haz), ... — backward compat
export function quarterKey(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-11
  const q = Math.floor(m / 3) + 1;
  return `${y}-Q${q}`;
}

// Çeyrek bitiş tarihi: Q1 → 31 Mart, Q2 → 30 Haz, Q3 → 30 Eyl, Q4 → 31 Ara
export function quarterEndDate(qKey) {
  const m = qKey.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const endMonth = q * 3;  // 3, 6, 9, 12
  // Ay sonu günü
  const d = new Date(year, endMonth, 0);  // ay 0 = önceki ayın son günü
  return d.toISOString().slice(0, 10);
}
