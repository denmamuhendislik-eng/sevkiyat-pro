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

// Fason op tespiti: opCode ≥600 ve istisnalar değil (memory: project_mrp_fason_istisnalar)
function isFasonOp(op) {
  if (op.isFason) return true;
  const code = Number(op.opCode);
  if (isNaN(code)) return false;
  return code >= 600 && ![653, 654, 665].includes(code);
}

// Bir parçanın bir fason op'u için maliyet hesabı
function calcFasonOpCost(opCode, partCode, fasonRates) {
  if (!fasonRates) return { cost: 0, source: "fason-rate-missing" };
  // 1. Parça-özel override (en yüksek öncelik)
  const overrideKey = `${opCode}_${partCode}`;
  const override = fasonRates.partOverrides?.[overrideKey];
  if (override && override.unitPriceTl > 0) {
    if (override.unit === "KG") {
      const kg = fasonRates.partWeights?.[partCode]?.kg || 0;
      if (kg > 0) return { cost: override.unitPriceTl * kg, source: "fason-override-kg" };
      return { cost: 0, source: "fason-override-kg-no-weight" };
    }
    return { cost: override.unitPriceTl, source: "fason-override-ad" };
  }
  // 2. Op default
  const opDef = fasonRates.opDefaults?.[opCode];
  if (!opDef || !(opDef.unitPriceTl > 0)) return { cost: 0, source: "fason-rate-missing" };
  if (opDef.unit === "KG") {
    const kg = fasonRates.partWeights?.[partCode]?.kg || 0;
    if (kg > 0) return { cost: opDef.unitPriceTl * kg, source: "fason-default-kg" };
    return { cost: 0, source: "fason-default-kg-no-weight" };
  }
  return { cost: opDef.unitPriceTl, source: "fason-default-ad" };
}

// Tüm BOM modelleri için maliyet hesabı.
export function calculateAllProductCosts({ bomModels, unitCosts, workCenters, monthData, policy, fasonRates }) {
  if (!bomModels || Object.keys(bomModels).length === 0) {
    return { byModel: {}, wcRateAvg: {}, stockUnitCost: {}, summary: { error: "BOM modeli yok" } };
  }
  if (!monthData) {
    return { byModel: {}, wcRateAvg: {}, stockUnitCost: {}, summary: { error: "Gider verisi yok (ay seçilmedi)" } };
  }

  // 1. Tezgah dakika ücretlerini hesapla → WC bazında ortalama
  // YRD (sanal) ekipmanlar dahil — kullanıcı tam da bu WC'de gerçek tezgah olmadığında
  // maliyet hesaplanabilsin diye YRD ekliyor. Dışarda bırakırsak o WC'de cycle × 0 = 0 olur
  // ve KAYNAK gibi sadece sanal ekipmanı olan WC'lerde işçilik hep sıfır çıkar.
  const ratesCalc = calculateMachineRates({ monthData, policy, workCenters });
  const wcRateSum = {};
  for (const m of ratesCalc.machines) {
    const rate = ratesCalc.machinePay[m.id]?.ratePerMin || 0;
    if (rate <= 0) continue;  // Ücreti hesaplanmamış makinaları geç
    if (!wcRateSum[m.wcCode]) wcRateSum[m.wcCode] = { sum: 0, count: 0 };
    wcRateSum[m.wcCode].sum += rate;
    wcRateSum[m.wcCode].count++;
  }
  const wcRateAvg = {};
  for (const [code, v] of Object.entries(wcRateSum)) {
    wcRateAvg[code] = v.count > 0 ? v.sum / v.count : 0;
  }

  // 1b. BOM'dan WC bazlı ortalama cycle süresi (cycleTime girilmemiş op'lar için fallback) —
  // mantık App.jsx:8548 ile birebir aynı (orada çizelgeleme için kullanılıyor, burada maliyet için).
  // İŞLEME MERKEZİ ve TORNA gibi yoğun WC'lerde gerçek MES verileri çok → güvenilir ortalama çıkar.
  const wcAvgCycle = {};
  const wcCycleSums = {};
  for (const mk of Object.keys(bomModels)) {
    if (mk === "undefined") continue;
    for (const p of (bomModels[mk]?.parts || [])) {
      for (const op of (p.operations || [])) {
        if (op.wcCode && op.cycleTime > 0) {
          if (!wcCycleSums[op.wcCode]) wcCycleSums[op.wcCode] = { total: 0, count: 0 };
          wcCycleSums[op.wcCode].total += op.cycleTime;
          wcCycleSums[op.wcCode].count++;
        }
      }
    }
  }
  for (const [wc, s] of Object.entries(wcCycleSums)) {
    wcAvgCycle[wc] = Math.round((s.total / s.count) * 100) / 100;
  }
  const DEFAULT_CYCLE_MIN = 5;  // MRP App.jsx:6698 ile tutarlı global default

  // Kullanıcı manuel WC default override'ları — workCenters/centers/{wc}/manualCycleMin
  const wcManualCycle = {};
  for (const [code, wc] of Object.entries(workCenters?.centers || {})) {
    const v = Number(wc?.manualCycleMin);
    if (v > 0) wcManualCycle[code] = v;
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
    // En son tarihli partiden geriye doğru tara — fiyatı > 0 olan ilk partiyi al.
    // (VIO'da bazı partiler fiyatsız geliyor; eskiden son parti 0 ise fiyatı bulamıyorduk.)
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
      let fason = 0;
      const fasonSources = [];
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

      // BOM'da child miktarı — App.jsx explosion ile aynı pattern: p.qty
      // (BOM modeline göre 'qty' field'ı kullanılır, varsa 'qtyPerParent' fallback)
      const childQty = (c) => safeNum(c.p.qty) || safeNum(c.p.qtyPerParent) || 1;

      // Material hesabı — supplyType'a göre dallan
      // BUY/RAW: bitmiş satın alma → sadece directLookup.cost. Children ve operations
      // BOM'da olsa bile dikkate alınmaz (eskiden MAKE iken kalmış olabilirler).
      // MAKE/MAKE+FASON/PRODUCT: children'dan recursive (varsa) veya leaf'te directLookup.
      // FASON (parça düzeyinde): material 0, fason ücreti aşağıda.
      if (isBuyType) {
        material = directLookup?.cost || 0;
        if (material > 0) {
          source = "buy-by-" + directLookup.matchedBy;
        } else {
          source = "buy-no-cost";
        }
        if (children.length > 0) {
          // BOM'da eski MAKE'ten kalan alt parçalar var — görmezden gelindi
          source += " (children-ignored)";
        }
      } else if (children.length === 0) {
        // Yaprak parça (MAKE/FASON)
        if (sType === "FASON") {
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
        // Üst parça — children'dan recursive topla (hem MAKE hem FASON için)
        // FASON parçada hammadde bizden gidiyor → child material'i biz ödüyoruz, sadece içsel
        // işçilik fasonda yapıldığı için atlanır (aşağıda).
        for (const c of children) {
          const cCost = calcPart(c.i, visited);
          material += cCost.unitCost * childQty(c);
        }
        source = sType === "FASON" ? "fason-children" : "make-recursive";
      }

      // İşçilik + Fason — bu parçanın operasyonları
      // BUY/RAW: tüm op'lar atlanır (bitmiş satın alma → işçilik/fason satın alma fiyatına dahil).
      // FASON (tam fason): parça komple fasonda yapılıyor → içsel op'lar atlanır (fasonda yapılır),
      //   yalnız fason op'lar (opCode ≥600) ücretlendirilir. Hammadde child'lardan toplanır (yukarıda).
      // MAKE / MAKE+FASON: hem içsel hem fason op'lar normal işlenir.
      let opMesCount = 0, opManualCount = 0, opWcAvgCount = 0, opDefaultCount = 0;
      let opIgnoredBuy = 0;
      let opIgnoredFasonInternal = 0;
      if (isBuyType) {
        opIgnoredBuy = (part.operations || []).length;
      } else {
        const isPureFason = sType === "FASON";
        for (const op of part.operations || []) {
          if (isFasonOp(op)) {
            // Fason op — her tip parça için ücretlendirilir (FASON dahil, MAKE+FASON dahil)
            const f = calcFasonOpCost(op.opCode, part.stockCode, fasonRates);
            fason += f.cost;
            fasonSources.push(f.source);
          } else {
            // İçsel op — FASON tipi parçada atla (komple fasonda yapılıyor, içsel iş yok)
            if (isPureFason) {
              opIgnoredFasonInternal++;
              continue;
            }
            // Tezgah dakika ücretiyle hesap. 4 katmanlı cycle resolve:
            //   1) op.cycleTime > 0 (MES'ten gerçek süre)
            //   2) wcManualCycle[wcCode] (kullanıcı manuel override — MachineRatesTab)
            //   3) wcAvgCycle[wcCode] (BOM'daki diğer op'ların WC ortalaması)
            //   4) DEFAULT_CYCLE_MIN (global 5dk, MRP ile tutarlı)
            const wcCode = op.wcCode || op.workCenter;
            // wcCode boş ise op atla — hangi tezgahta yapıldığı bilinmediği için ücret hesaplanamaz
            if (!wcCode) continue;
            const rawCycle = safeNum(op.cycleTime);
            let cycle = rawCycle;
            if (rawCycle > 0) {
              opMesCount++;
            } else if (wcManualCycle[wcCode] > 0) {
              cycle = wcManualCycle[wcCode];
              opManualCount++;
            } else if (wcAvgCycle[wcCode] > 0) {
              cycle = wcAvgCycle[wcCode];
              opWcAvgCount++;
            } else {
              cycle = DEFAULT_CYCLE_MIN;
              opDefaultCount++;
            }
            const rate = wcRateAvg[wcCode] || 0;
            labor += cycle * rate;
          }
        }
      }

      const total = material + labor + fason;
      // Fason kaynaklarını source'a ekle (audit için)
      let finalSource = source;
      if (fasonSources.length > 0) {
        const uniqFason = [...new Set(fasonSources)];
        finalSource += " +" + uniqFason.join("+");
      }
      // İşçilik veri kalitesi audit'i — kaç op MES/manuel/WC ortalaması/global default kullandı
      if (opManualCount > 0 || opWcAvgCount > 0 || opDefaultCount > 0) {
        finalSource += ` +labor(mes:${opMesCount},man:${opManualCount},wcAvg:${opWcAvgCount},def:${opDefaultCount})`;
      }
      if (opIgnoredBuy > 0) {
        // BUY parça olmasına rağmen BOM'da operasyon kayıtları var — atlandığı için audit'e geç
        finalSource += ` +ops-ignored:${opIgnoredBuy}`;
      }
      if (opIgnoredFasonInternal > 0) {
        // FASON parçada içsel op kayıtları var (eskiden MAKE iken kalmış olabilir) — atlandı
        finalSource += ` +ops-fason-skip:${opIgnoredFasonInternal}`;
      }
      partCost[idx] = {
        idx,
        stockCode: part.stockCode,
        stockName: part.stockName,
        level: part.level,
        parentIdx: part.parentIdx,
        supplyType: part.supplyType,
        qtyPerParent: safeNum(part.qty) || safeNum(part.qtyPerParent) || 1,
        materialCost: material,
        laborCost: labor,
        fasonCost: fason,
        unitCost: total,
        source: finalSource,
        childCount: children.length,
        opCount: (part.operations || []).length,
        laborOpMes: opMesCount,
        laborOpManual: opManualCount,
        laborOpWcAvg: opWcAvgCount,
        laborOpDefault: opDefaultCount,
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

    // Recursive toplam — root için tüm child'lardaki labor+fason'u da topla (zaten unitCost'a dahil ama
    // ayrı kolonlarda görebilmek için: her parça için kendi labor/fason'unu çocuklarınkiyle topla)
    function rollupTotals(idx) {
      const node = partCost[idx];
      if (!node) return { mat: 0, lab: 0, fas: 0 };
      const childIndices = parts.map((p, i) => i).filter(i => parts[i].parentIdx === idx);
      let mat = node.materialCost || 0;
      let lab = node.laborCost || 0;
      let fas = node.fasonCost || 0;
      // Eğer üst parça children'a sahipse, child'ların labor+fason'unu da topla (mat zaten recursive zaten)
      // Wait — material zaten recursive (child unitCost × qty). Ama labor/fason değil — sadece bu parça için.
      // Root toplamı için child'ların labor+fason'unu da topla.
      if (childIndices.length > 0 && (node.supplyType === "MAKE" || node.supplyType === "MAKE+FASON" || !node.supplyType)) {
        for (const ci of childIndices) {
          const childRoll = rollupTotals(ci);
          const childQty = safeNum(parts[ci].qty) || safeNum(parts[ci].qtyPerParent) || 1;
          lab += childRoll.lab * childQty;
          fas += childRoll.fas * childQty;
        }
      }
      return { mat, lab, fas };
    }
    const rollup = rollupTotals(rootIdx);

    byModel[modelKey] = {
      modelKey,
      modelCode: model.modelCode,
      modelName: model.modelName,
      rootIdx,
      rootCost: rootInfo.unitCost || 0,
      rootMaterial: rollup.mat,
      rootLabor: rollup.lab,
      rootFason: rollup.fas,
      rootStockCode: parts[rootIdx]?.stockCode,
      rootStockName: parts[rootIdx]?.stockName,
      partCosts: partCost,
      partsList: parts.map((p, i) => ({
        idx: i,
        ...partCost[i],
      })),
    };
  }

  // Veri kalitesi toplamı — kaç op MES/manuel/WC ortalaması/global default kullandı
  let totalOpMes = 0, totalOpManual = 0, totalOpWcAvg = 0, totalOpDefault = 0;
  for (const model of Object.values(byModel)) {
    for (const part of (model.partsList || [])) {
      totalOpMes += part.laborOpMes || 0;
      totalOpManual += part.laborOpManual || 0;
      totalOpWcAvg += part.laborOpWcAvg || 0;
      totalOpDefault += part.laborOpDefault || 0;
    }
  }

  return {
    byModel,
    wcRateAvg,
    wcAvgCycle,
    wcManualCycle,
    stockUnitCost,
    ratesCalcSummary: ratesCalc.summary,
    summary: {
      modelCount: Object.keys(byModel).length,
      stockCount: Object.keys(stockUnitCost).length,
      wcCount: Object.keys(wcRateAvg).length,
      stocksWithoutCost: 0, // hesaplanacak
      laborOpMes: totalOpMes,
      laborOpManual: totalOpManual,
      laborOpWcAvg: totalOpWcAvg,
      laborOpDefault: totalOpDefault,
    },
  };
}
