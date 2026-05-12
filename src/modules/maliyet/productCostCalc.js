// Mamul maliyet hesabı — MVP (recursive, son alış fiyatı, WC ort. işçilik).
//
// Model:
//   1. BUY/RAW yaprak parça → unitCosts son alış fiyatı (TL)
//   2. MAKE üst parça → alt parçaların maliyeti × qtyPerParent + kendi operasyon işçiliği
//   3. FASON → 0 (henüz fason ücreti veri yok, sonra)
//   4. İşçilik = cycleTime (dk/adet) × wcRateAvg[wcCode]
//   5. Setup süresi şimdilik ignore edildi (1 adet maliyeti = cycle × rate)

import { calculateMachineRates } from "./distributionCalc";

function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

// Tüm BOM modelleri için maliyet hesabı.
export function calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy }) {
  if (!bomModels || Object.keys(bomModels).length === 0) {
    return { byModel: {}, wcRateAvg: {}, stockUnitCost: {}, summary: { error: "BOM modeli yok" } };
  }
  if (!monthData) {
    return { byModel: {}, wcRateAvg: {}, stockUnitCost: {}, summary: { error: "Gider verisi yok (ay seçilmedi)" } };
  }

  // 1. Tezgah dakika ücretlerini hesapla → WC bazında ortalama
  const ratesCalc = calculateMachineRates({ monthData, policy, workCenters });
  const wcRateSum = {};
  for (const m of ratesCalc.machines) {
    if (m.isVirtual) continue;  // YRD'ler üretimde işlemiyor, ortalamaya katma
    if (!wcRateSum[m.wcCode]) wcRateSum[m.wcCode] = { sum: 0, count: 0 };
    wcRateSum[m.wcCode].sum += ratesCalc.machinePay[m.id]?.ratePerMin || 0;
    wcRateSum[m.wcCode].count++;
  }
  const wcRateAvg = {};
  for (const [code, v] of Object.entries(wcRateSum)) {
    wcRateAvg[code] = v.count > 0 ? v.sum / v.count : 0;
  }

  // 2. Birim BUY/RAW maliyetler — unitCosts son alış fiyatı (en geç orderDate'li parti)
  // PLUS: isim bazlı fallback lookup — BOM stockCode ile unitCosts key uyuşmazsa,
  // BOM stockName ile unitCosts name eşleştirmesi yapılır (örn. BOM'da "52030 VOLANT C54",
  // unitCosts'ta key="151-0234" / name="52030 VOLANT C54" → name match)
  const stockUnitCost = {};
  const nameToCode = {};       // "tam isim normalize" → code
  const tokensToCode = {};     // ilk token (örn. "52030") → [code, code...]
  const normName = (s) => String(s || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
  const firstToken = (s) => {
    const t = String(s || "").trim().split(/\s+/)[0];
    return t ? t.toLocaleLowerCase("tr-TR") : "";
  };
  for (const [code, slot] of Object.entries(unitCosts?.byStock || {})) {
    const parts = slot.partitions || [];
    if (parts.length === 0) continue;
    const sorted = [...parts].sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    const last = sorted[sorted.length - 1];
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

  // BOM part için maliyet lookup (3 katmanlı: kod → isim → ilk token)
  function lookupPartCost(part) {
    // 1. Doğrudan stockCode match
    if (stockUnitCost[part.stockCode] != null) {
      return { cost: stockUnitCost[part.stockCode], matchedBy: "code" };
    }
    // 2. Tam isim match (lowercase, trimmed)
    const nName = normName(part.stockName);
    if (nName && nameToCode[nName] != null) {
      return { cost: stockUnitCost[nameToCode[nName]], matchedBy: "name" };
    }
    // 3. İlk token match (örn. "52030 VOLANT C54" → "52030")
    const tk = firstToken(part.stockName);
    if (tk && tokensToCode[tk] && tokensToCode[tk].length === 1) {
      // Tek eşleşme varsa kullan, ambiguity yoksa
      return { cost: stockUnitCost[tokensToCode[tk][0]], matchedBy: "token" };
    }
    return { cost: 0, matchedBy: "miss" };
  }

  // 3. Her BOM modeli için recursive hesap
  const byModel = {};
  for (const [modelKey, model] of Object.entries(bomModels)) {
    if (modelKey === "undefined" || !model?.parts) continue;
    const parts = model.parts;
    if (parts.length === 0) continue;

    // partIdx → { unitCost, materialCost, laborCost, source }
    const partCost = {};

    const calcPart = (idx, visited = new Set()) => {
      if (partCost[idx]) return partCost[idx];
      if (visited.has(idx)) {
        // Cycle koruması — kendi içinde döngü tespit edilirse
        partCost[idx] = { idx, unitCost: 0, materialCost: 0, laborCost: 0, source: "cycle-detected" };
        return partCost[idx];
      }
      visited.add(idx);

      const part = parts[idx];
      if (!part) {
        partCost[idx] = { idx, unitCost: 0, materialCost: 0, laborCost: 0, source: "missing" };
        return partCost[idx];
      }

      let material = 0;
      let labor = 0;
      let source = "unknown";

      // Çocukları bul
      const children = [];
      parts.forEach((p, i) => {
        if (p.parentIdx === idx) children.push({ p, i });
      });

      const sType = part.supplyType;
      // BUY/RAW için ÖNCELİK kendi unitCost'u — child'lar olsa bile
      // (BOM'da BUY'un alt parçası olabilir ama satın alma fiyatı varsa o güvenilir)
      const isBuyType = sType === "BUY" || sType === "RAW";
      let directLookup = null;
      if (isBuyType || (sType === "MAKE" || sType === "MAKE+FASON" || sType === "PRODUCT")) {
        directLookup = lookupPartCost(part);
      }

      if (children.length === 0) {
        // Yaprak parça
        if (isBuyType) {
          material = directLookup?.cost || 0;
          source = material > 0 ? "buy-by-" + directLookup.matchedBy : "buy-no-cost";
        } else if (sType === "FASON") {
          material = 0;
          source = "fason-tbd";
        } else if (sType === "MAKE" || sType === "MAKE+FASON" || sType === "PRODUCT") {
          if (directLookup?.cost > 0) {
            material = directLookup.cost;
            source = "make-leaf-by-" + directLookup.matchedBy;
          } else {
            material = 0;
            source = "make-leaf-empty";
          }
        } else {
          source = "leaf-unknown-type";
        }
      } else {
        // Üst parça — children var
        if (isBuyType && directLookup?.cost > 0) {
          // BUY/RAW'ın kendi fiyatı varsa kullan (child'lar yardımcı bilgi)
          material = directLookup.cost;
          source = "buy-direct-by-" + directLookup.matchedBy;
        } else {
          // MAKE veya BUY ama direkt fiyat yok → child'lardan recursive
          for (const c of children) {
            const cCost = calcPart(c.i, visited);
            const qty = safeNum(c.p.qtyPerParent) || 1;
            material += cCost.unitCost * qty;
          }
          source = isBuyType ? "buy-via-children" : "make-recursive";
        }
      }

      // İşçilik — bu parçanın operasyonları (her parça kendi op'larıyla işlenir)
      for (const op of part.operations || []) {
        const cycle = safeNum(op.cycleTime);
        if (cycle <= 0) continue;
        const wcCode = op.wcCode || op.workCenter;
        // Fason op için ücret yok (henüz)
        if (op.isFason || (op.opCode && Number(op.opCode) >= 600 && ![653, 654, 665].includes(Number(op.opCode)))) continue;
        const rate = wcRateAvg[wcCode] || 0;
        labor += cycle * rate;
      }

      const total = material + labor;
      partCost[idx] = {
        idx,
        stockCode: part.stockCode,
        stockName: part.stockName,
        level: part.level,
        parentIdx: part.parentIdx,
        supplyType: part.supplyType,
        qtyPerParent: safeNum(part.qtyPerParent) || 1,
        materialCost: material,
        laborCost: labor,
        unitCost: total,
        source,
        childCount: children.length,
        opCount: (part.operations || []).filter(o => safeNum(o.cycleTime) > 0).length,
      };
      return partCost[idx];
    };

    // Root part(s) — parentIdx null/undefined
    const rootIndices = parts
      .map((p, i) => ({ p, i }))
      .filter(x => x.p.parentIdx === null || x.p.parentIdx === undefined)
      .map(x => x.i);

    // Tüm parçaları hesapla (root'tan tetiklenir, recursive iniş)
    for (const ri of rootIndices) calcPart(ri);
    // Edge: bazı parçalar root'tan ulaşılamayabilir (orphan) — onları da hesapla
    for (let i = 0; i < parts.length; i++) if (!partCost[i]) calcPart(i);

    const rootIdx = rootIndices[0];
    if (rootIdx === undefined) continue;
    const rootInfo = partCost[rootIdx] || {};

    byModel[modelKey] = {
      modelKey,
      modelCode: model.modelCode,
      modelName: model.modelName,
      rootIdx,
      rootCost: rootInfo.unitCost || 0,
      rootMaterial: rootInfo.materialCost || 0,
      rootLabor: rootInfo.laborCost || 0,
      rootStockCode: parts[rootIdx]?.stockCode,
      rootStockName: parts[rootIdx]?.stockName,
      partCosts: partCost,  // hızlı erişim
      partsList: parts.map((p, i) => ({
        idx: i,
        ...partCost[i],
      })),
    };
  }

  return {
    byModel,
    wcRateAvg,
    stockUnitCost,
    ratesCalcSummary: ratesCalc.summary,
    summary: {
      modelCount: Object.keys(byModel).length,
      stockCount: Object.keys(stockUnitCost).length,
      wcCount: Object.keys(wcRateAvg).length,
      stocksWithoutCost: 0, // hesaplanacak
    },
  };
}
