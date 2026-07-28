// Revizyon nedenleri (kod bazlı) — KPI'da dökümde kullanılır.
// Backward-compat: eski revisionReason (kod olmadan free-text) hâlâ çalışır.
export const REVISION_REASONS = [
  { key: "discount",     label: "1. İskonto talebi",              icon: "💰", color: "#dc2626", bg: "#fef2f2" },
  { key: "quantity",     label: "2. Miktar / parti revizyon talebi", icon: "📦", color: "#0369a1", bg: "#f0f9ff" },
  { key: "partRevision", label: "3. Parça revizyonu",             icon: "🔧", color: "#7c3aed", bg: "#faf5ff" },
  { key: "removeLine",   label: "4. Tekliften çıkarılacak kalem", icon: "🗑",  color: "#92400e", bg: "#fef3c7" },
  { key: "other",        label: "5. Diğer",                        icon: "💬", color: "#57534e", bg: "#f5f5f4" },
];

// Teklif hesap motoru.
// Excel formülü:
//   Malzeme maliyeti = ağırlık kg × TL/kg
//   İşçilik maliyeti = Σ (makine dk × TL/dk)
//   Fason maliyeti   = Σ (fason iş × birim fiyat × miktar)
//   Aparat/kalıp maliyeti = toplam maliyet / miktar (birim başına yayılır)
//   Kâr marjı: miktar aralığına göre işçilik ve malz/fason marjları
//              + vade bazlı ilave marj (30/60/90 gün)
//              + malzeme türü bazlı ilave marj (özel malzemeler için)
//   Satış fiyatı = Maliyet × (1 + toplam marj)

// Ağırlık hesabı: ebat (mm) × özgül ağırlık (g/cm³) → kg
// Şekil bazlı hacim:
//   DİKDÖRTGEN: en × boy × uzunluk (mm³)
//   SİLİNDİR:   π × (çap/2)² × uzunluk (mm³) — burada en=boy=çap
//   ALTIGEN:    2√3 × (en/2)² × uzunluk  (basitleştirilmiş — kısaltmak isterse mm² × uzunluk)
//   EBATSIZ:    manuel ağırlık girer
export function calculateWeightKg({ shape, en, boy, uzunluk, density }) {
  const e = Number(en) || 0;
  const b = Number(boy) || 0;
  const u = Number(uzunluk) || 0;
  const d = Number(density) || 0;
  if (d <= 0 || u <= 0) return 0;
  let volumeMm3 = 0;
  const shapeUp = String(shape || "").toUpperCase();
  if (shapeUp === "SİLİNDİR") {
    // çap = en (silindir için en=çap)
    const cap = e || b;
    if (cap <= 0) return 0;
    volumeMm3 = Math.PI * (cap / 2) ** 2 * u;
  } else if (shapeUp === "ALTIGEN") {
    // en = köşeden köşeye çap
    if (e <= 0) return 0;
    volumeMm3 = (3 * Math.sqrt(3) / 2) * (e / 2) ** 2 * u;
  } else if (shapeUp === "EBATSIZ") {
    return 0; // manuel giriş
  } else {
    // DİKDÖRTGEN (default)
    if (e <= 0 || b <= 0) return 0;
    volumeMm3 = e * b * u;
  }
  // mm³ → cm³ = /1000, cm³ × g/cm³ = g, g/1000 = kg
  return (volumeMm3 / 1000) * d / 1000;
}

// Miktar aralığı bazlı marj bul
export function findQuantityMargin(quantityMargins, quantity) {
  if (!Array.isArray(quantityMargins) || quantityMargins.length === 0) {
    return { laborPct: 0, materialFasonPct: 0 };
  }
  const q = Number(quantity) || 0;
  for (const b of quantityMargins) {
    if (q >= b.min && q <= b.max) return { laborPct: b.laborPct || 0, materialFasonPct: b.materialFasonPct || 0 };
  }
  // Range dışı — son aralığı kullan
  return quantityMargins[quantityMargins.length - 1] || { laborPct: 0, materialFasonPct: 0 };
}

// Vade → grup adı ("30 Gün Vade" → "GRUP1")
export function paymentTermToGroup(paymentTerm) {
  const s = String(paymentTerm || "").toLowerCase();
  if (s.includes("30")) return "GRUP1";
  if (s.includes("60")) return "GRUP2";
  if (s.includes("90")) return "GRUP3";
  // Peşin / diğer → default GRUP1 (en düşük)
  return "GRUP1";
}

// Bir kalem için tam hesap.
// Girdiler:
//   line: { quantity, materialType, dimensions (en/boy/uzunluk), weightKg (manuel override),
//           machines: [{name, timeMin, ratePerMin}], fasonWorks: [{name, unitPriceTl, quantity(opt)}],
//           specialToolCost (aparat/kalıp toplam maliyeti, adet başına yayılır) }
//   materials: quoteMaterials.materials — TL/kg lookup
//   policy: quotePolicy — quantityMargins, customerGroupMargins, materialLaborMargins
//   paymentTerm: müşterinin vade bilgisi
export function calculateLineCost({ line, materials, policy, paymentTerm }) {
  const qty = Number(line.quantity) || 1;
  const mat = materials?.[line.materialType];
  const density = mat?.density || 0;
  const pricePerKgTl = mat?.priceTlPerKg || 0;

  // 1. Ağırlık (manuel override varsa öncelik)
  let weightKg = Number(line.weightKg);
  if (!weightKg || weightKg <= 0) {
    weightKg = calculateWeightKg({
      shape: mat?.shape,
      en: line.dimensions?.en,
      boy: line.dimensions?.boy,
      uzunluk: line.dimensions?.uzunluk,
      density,
    });
  }

  // 2. Malzeme maliyeti (adet başına)
  const materialCostPerUnit = weightKg * pricePerKgTl;
  const materialCostTotal = materialCostPerUnit * qty;

  // 3. İşçilik (makine dk × dk ücreti)
  let laborCostPerUnit = 0;
  for (const m of (line.machines || [])) {
    laborCostPerUnit += (Number(m.timeMin) || 0) * (Number(m.ratePerMin) || 0);
  }
  const laborCostTotal = laborCostPerUnit * qty;

  // 4. Fason (birim fiyat × miktar, ya da satır bazlı)
  let fasonCostTotal = 0;
  for (const f of (line.fasonWorks || [])) {
    const unitPrice = Number(f.unitPriceTl) || 0;
    const fQty = Number(f.quantity) || qty; // fason quantity yoksa parça quantity kullan
    fasonCostTotal += unitPrice * fQty;
  }
  const fasonCostPerUnit = fasonCostTotal / qty;

  // 5. Özel takım/aparat/kalıp
  //    Mod A (yay): toplam maliyet / miktar → her adete küçük ilave
  //    Mod B (ayrı satır): kaleme dahil değil, teklifin altında ayrı satır olur (aşağıda ele alınır)
  const specialToolTotal = Number(line.specialToolCost) || 0;
  const specialToolMode = String(line.specialToolMode || "spread"); // "spread" | "separate"
  const specialToolInLine = specialToolMode === "spread"; // adete yay → kaleme dahil
  const specialToolPerUnit = specialToolInLine ? (specialToolTotal / qty) : 0;
  const specialToolSeparate = !specialToolInLine ? specialToolTotal : 0; // ayrı satır: teklif altına

  // 6. Toplam maliyet (adet başına)
  const totalCostPerUnit = materialCostPerUnit + laborCostPerUnit + fasonCostPerUnit + specialToolPerUnit;
  const totalCostTotal = totalCostPerUnit * qty;

  // 7. Marj hesabı — parti büyüklüğü verilmişse marj bracket'i ONA göre bakılır.
  //    Amaç: Uzun vadeli yüksek adet siparişlerde parti bazlı fiyatlama (örn. 500
  //    adet 10×50 parti halinde teslim → 50 adet marj bracket'i alınır → gerçekçi
  //    birim fiyat). Üretim/malzeme maliyeti yine qty (500) üzerinden hesaplanır.
  //    line.batchSize yoksa/0 ise mevcut davranış (qty üzerinden) korunur → backward-compat.
  const marginQty = Number(line.batchSize) > 0 ? Number(line.batchSize) : qty;
  const qMargin = findQuantityMargin(policy?.quantityMargins, marginQty);
  const group = paymentTermToGroup(paymentTerm);
  const groupMargin = policy?.customerGroupMargins?.[group] || 0;

  // Malzeme özel ilave marj (bazı malzemeler için — ör. KROM sac)
  const matSpecial = policy?.materialLaborMargins?.[line.materialType];
  const matSpecialByGroup = {
    GRUP1: matSpecial?.grup1 || 0,
    GRUP2: matSpecial?.grup2 || 0,
    GRUP3: matSpecial?.grup3 || 0,
  };
  const matSpecialPct = matSpecialByGroup[group] || 0;

  // Marj formülü:
  //   Malzeme satış = maliyet × (1 + malz/fason marj + firma grup marj)
  //   İşçilik satış = maliyet × (1 + işçilik marj + malzeme özel marj)
  //   Fason satış = maliyet × (1 + malz/fason marj)
  //   Aparat satış = maliyet × (1 + malz/fason marj)  — teklif başına dağıtım
  const materialMarginDefault = (qMargin.materialFasonPct || 0) + (groupMargin || 0);
  const laborMarginDefault = (qMargin.laborPct || 0) + (matSpecialPct || 0);
  const fasonMarginDefault = qMargin.materialFasonPct || 0;
  const specialToolMarginDefault = qMargin.materialFasonPct || 0;

  // Override desteği: kullanıcı revizyonda satır bazlı marja elle müdahale edebilir.
  // Override boş/null ise default (bracket + grup) marjı kullanılır.
  const ov = line.overrides || {};
  const hasOv = (v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));
  const eff = (def, v) => (hasOv(v) ? Number(v) / 100 : def);
  const materialMargin = eff(materialMarginDefault, ov.materialMarginPct);
  const laborMargin = eff(laborMarginDefault, ov.laborMarginPct);
  const fasonMargin = eff(fasonMarginDefault, ov.fasonMarginPct);
  const specialToolMargin = eff(specialToolMarginDefault, ov.specialToolMarginPct);
  const overrideActive = {
    material: hasOv(ov.materialMarginPct),
    labor: hasOv(ov.laborMarginPct),
    fason: hasOv(ov.fasonMarginPct),
    specialTool: hasOv(ov.specialToolMarginPct),
  };

  const materialSaleTotal = materialCostTotal * (1 + materialMargin);
  const laborSaleTotal = laborCostTotal * (1 + laborMargin);
  const fasonSaleTotal = fasonCostTotal * (1 + fasonMargin);
  // Aparat: spread modda kaleme dahil, separate modda ayrı satıra
  const specialToolInLineSale = specialToolInLine ? (specialToolTotal * (1 + specialToolMargin)) : 0;
  const specialToolSeparateSale = specialToolSeparate * (1 + specialToolMargin);

  const linePrice = materialSaleTotal + laborSaleTotal + fasonSaleTotal + specialToolInLineSale;
  const unitPrice = linePrice / qty;
  const totalProfit = linePrice - totalCostTotal;
  const profitMarginPct = totalCostTotal > 0 ? (totalProfit / totalCostTotal) * 100 : 0;

  return {
    weightKg,
    quantity: qty,
    // Adet başına
    perUnit: {
      material: materialCostPerUnit,
      labor: laborCostPerUnit,
      fason: fasonCostPerUnit,
      specialTool: specialToolPerUnit,
      totalCost: totalCostPerUnit,
      salePrice: unitPrice,
    },
    // Toplam
    total: {
      material: materialCostTotal,
      labor: laborCostTotal,
      fason: fasonCostTotal,
      specialTool: specialToolInLine ? specialToolTotal : 0,
      totalCost: totalCostTotal,
      salePrice: linePrice,
      profit: totalProfit,
    },
    // Aparat/kalıp — ayrı satır modu (kaleme dahil değil, teklift altında görünür)
    separateTool: {
      mode: String(specialToolMode || "spread"),
      inLine: Boolean(specialToolInLine),
      cost: Number(specialToolSeparate) || 0,
      sale: Number(specialToolSeparateSale) || 0,
      profit: Number(specialToolSeparateSale - specialToolSeparate) || 0,
      margin: Number(specialToolMargin) || 0,
      description: String(line.specialToolDescription || (line.stockName ? `${line.stockName} — Aparat/Kalıp` : "Aparat / Kalıp")),
    },
    // Marj bilgisi (UI'da göstermek için)
    margins: {
      quantityBracket: `${qMargin.min || 1}${qMargin.max && qMargin.max !== qMargin.min ? "-" + qMargin.max : ""}`,
      // Marj bracket'inin hangi adet üzerinden bulunduğu — parti kullanıldıysa şeffaflık
      marginQty,
      batchSize: Number(line.batchSize) || 0,
      batchApplied: Number(line.batchSize) > 0 && Number(line.batchSize) < qty,
      material: materialMargin,
      labor: laborMargin,
      fason: fasonMargin,
      specialTool: specialToolMargin,
      // Default (override öncesi) — UI "auto" değeri göstermek için
      defaults: {
        material: materialMarginDefault,
        labor: laborMarginDefault,
        fason: fasonMarginDefault,
        specialTool: specialToolMarginDefault,
      },
      overrideActive,
      paymentGroup: group,
      groupMargin,
      materialSpecialMargin: matSpecialPct,
      profitPct: profitMarginPct,
    },
    // Satış-maliyet ayrıntı (iskonto simülasyonu için)
    materialSaleTotal,
    laborSaleTotal,
    fasonSaleTotal,
    specialToolInLineSale,   // spread modda kaleme dahil edilen satış
    specialToolSeparateSale, // separate modda ayrı satır olarak toplanacak satış
  };
}

// Bir teklifin tüm kalemlerini hesapla + genel toplam.
// Aparat/kalıp "ayrı satır" modunda olan kalemler ayrı bir satır olarak toplama katılır.
export function calculateQuoteTotal({ lines, materials, policy, paymentTerm, currency = "TL", exchangeRate = 1 }) {
  const lineResults = (lines || []).map(line => calculateLineCost({ line, materials, policy, paymentTerm }));

  // Kalemlerden gelen "separate" aparat satırlarını ayır — teklifin altında ayrı görünür
  const separateToolItems = [];
  for (let i = 0; i < lineResults.length; i++) {
    const st = lineResults[i]?.separateTool;
    if (st && !st.inLine && st.cost > 0) {
      separateToolItems.push({
        sourceLineIdx: i,
        description: st.description,
        cost: st.cost,
        sale: st.sale,
        profit: st.profit,
        margin: st.margin,
      });
    }
  }

  const linesCost = lineResults.reduce((s, r) => s + r.total.totalCost, 0);
  const linesSale = lineResults.reduce((s, r) => s + r.total.salePrice, 0);
  const separateToolCost = separateToolItems.reduce((s, x) => s + x.cost, 0);
  const separateToolSale = separateToolItems.reduce((s, x) => s + x.sale, 0);

  const totalCost = linesCost + separateToolCost;
  const totalSale = linesSale + separateToolSale;
  const totalProfit = totalSale - totalCost;
  const overallMarginPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  // Döviz çevirisi (satış tutarları müşteriye gösterilecek dövizde)
  let displayFactor = 1;
  if (currency !== "TL" && exchangeRate > 0) {
    displayFactor = 1 / exchangeRate;
  }

  return {
    lineResults,
    separateToolItems,
    totalCostTl: totalCost,
    totalSaleTl: totalSale,
    totalProfitTl: totalProfit,
    overallMarginPct,
    currency,
    displayFactor,
    totalSaleDisplay: totalSale * displayFactor,
    totalCostDisplay: totalCost * displayFactor,
  };
}
