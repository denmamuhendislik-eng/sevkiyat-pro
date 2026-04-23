import * as XLSX from "xlsx";

// VIO Ürün Ağacı Excel'ini parse eder.
// bomModels parametresi: mevcut BOM'lardaki _autoSupplyType override'larını global tutarlılık için
// kullanmak üzere inject edilir (App.jsx'teki eski çağrıda closure'dan okunuyordu — taşırken
// davranışı korumak için parametre yaptık).
//
// FIX 23 Nis 2026 (v19 BOM parser fix): "hammaddesiz op" durumunda op'lar yanlış part'a
// atanıyordu (RAW/BUY). Düzeltme: op owner resolution RAW/BUY part'ları atlar.
// Etkilenmiş canlı BOM'lar: 152-0148, 152-0812, 152-0128, 151-0006.
export function parseBomExcel(workbook, bomModels = {}) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Find header row (Stok Kodu)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const c0 = String(rows[i][0] || "").trim();
    if (c0 === "Stok Kodu" || c0.includes("Stok Kod")) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return null;

  // Find model info from header area
  let modelCode = "", modelName = "";
  for (let i = 0; i < headerIdx; i++) {
    const txt = String(rows[i][0] || "");
    const m = txt.match(/Ürün Ağacı:\s*(\S+)\s*-\s*(.+)/);
    if (m) { modelCode = m[1].trim(); modelName = m[2].trim(); break; }
    const m2 = txt.match(/\((\d{3}-\d{4}(?:-\d+)?)\)\s+(.+)/);
    if (m2) { modelCode = m2[1].trim(); modelName = m2[2].trim(); break; }
  }

  const parts = [];
  const detectedWCs = {};    // wcCode -> {name, opCodes}
  const detectedFason = {};  // opCode -> {name, count}
  let totalOps = 0;
  const partStack = {};      // level -> index of most recent part at that level
  const orphanOps = [];      // operations parsed before any part exists

  for (let i = headerIdx + 1; i < rows.length; i++) {
    let col0 = String(rows[i][0] || "").trim();
    let col1 = String(rows[i][1] || "").trim();
    const col2 = rows[i][2];
    const col3 = String(rows[i][3] || "").trim();

    if (!col0 && !col1) continue;

    let level = 0;
    const prefixMatch = col0.match(/^([\.\|\s]+)/);
    if (prefixMatch) {
      const pfx = prefixMatch[1];
      level = (pfx.match(/\./g) || []).length + (pfx.match(/\|/g) || []).length;
      col0 = col0.substring(pfx.length).trim();
    }
    const prefixMatch1 = col1.match(/^([\.\|\s]+)/);
    if (prefixMatch1) {
      col1 = col1.substring(prefixMatch1[1].length).trim();
    }

    const opMatch = col0.match(/^Oper:\s*\((\d+)\)\s*(.*)/);
    if (opMatch) {
      const opCode = opMatch[1];
      const opName = opMatch[2].trim();
      let wcCode = "", wcName = "";
      const wcMatch = col1.match(/İş\.Mrk:\s*\((\d+)\)\s*(.*)/);
      if (wcMatch) { wcCode = wcMatch[1]; wcName = wcMatch[2].trim(); }

      const opObj = { opCode, opName, wcCode, wcName, setupTime: null, cycleTime: null };
      totalOps++;

      // Op owner resolution: seviye-1'den aşağı doğru ara, RAW/BUY part'ları atla.
      let ownerIdx;
      for (let lv = level - 1; lv >= 0; lv--) {
        const idx = partStack[lv];
        if (idx === undefined) continue;
        const p = parts[idx];
        if (!p) continue;
        if (p.supplyType === "RAW" || p.supplyType === "BUY") continue;
        ownerIdx = idx;
        break;
      }
      if (ownerIdx !== undefined && parts[ownerIdx]) {
        parts[ownerIdx].operations.push(opObj);
      } else {
        orphanOps.push(opObj);
      }

      const isFason = parseInt(opCode) >= 600;
      if (isFason) {
        if (!detectedFason[opCode]) detectedFason[opCode] = { name: opName, count: 0 };
        detectedFason[opCode].count++;
      } else if (wcCode) {
        if (!detectedWCs[wcCode]) detectedWCs[wcCode] = { name: wcName, opCodes: new Set() };
        detectedWCs[wcCode].opCodes.add(opCode);
      }
      continue;
    }

    const codeMatch = col0.match(/^(\d{3}-\d{4}(?:-\d+)?)/);
    if (!codeMatch) continue;

    const stockCode = codeMatch[1];
    const stockName = col1 || col0.substring(stockCode.length).trim();
    let qty = 1;
    if (col2 !== "" && col2 !== undefined) {
      const qStr = String(col2).replace(",", ".");
      const parsed = parseFloat(qStr);
      if (!isNaN(parsed)) qty = parsed;
    }

    const prefix = stockCode.split("-")[0];
    let supplyType = "MAKE";
    if (prefix === "150") supplyType = "RAW";
    else if (prefix === "157") supplyType = "BUY";

    // Global tutarlılık: bu stok kodu için başka BOM'larda manuel override varsa onu kullan
    const existingOverride = Object.values(bomModels || {})
      .flatMap((m) => m?.parts || [])
      .find((p) => p.stockCode === stockCode && p._autoSupplyType);
    if (existingOverride) supplyType = existingOverride.supplyType;

    const partIdx = parts.length;
    parts.push({
      stockCode, stockName, level, qty,
      unit: col3 || "AD", supplyType, parentIdx: null,
      operations: []
    });

    partStack[level] = partIdx;
    for (const k of Object.keys(partStack)) {
      if (parseInt(k) > level) delete partStack[k];
    }
  }

  // Orphan operations → synthetic L0 root (product)
  if (orphanOps.length > 0 && modelCode) {
    for (const p of parts) p.level += 1;
    const prefix = modelCode.split("-")[0];
    let rootType = "MAKE";
    if (prefix === "150") rootType = "RAW";
    else if (prefix === "157") rootType = "BUY";
    parts.unshift({
      stockCode: modelCode, stockName: modelName, level: 0, qty: 1,
      unit: "AD", supplyType: rootType, parentIdx: null,
      operations: [...orphanOps]
    });
    orphanOps.length = 0;
  }

  // parentIdx atama
  const stack = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    while (stack.length > 0 && stack[stack.length - 1].level >= p.level) stack.pop();
    if (stack.length > 0) p.parentIdx = stack[stack.length - 1].idx;
    stack.push({ idx: i, level: p.level });
  }

  // Operasyonlara göre supply type güncelle (manuel override olmayanlar için)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.operations.length > 0 && p.supplyType === "MAKE") {
      const hasFason = p.operations.some((op) => parseInt(op.opCode) >= 600);
      const allFason = p.operations.every((op) => parseInt(op.opCode) >= 600);
      if (allFason) p.supplyType = "FASON";
      else if (hasFason) p.supplyType = "MAKE+FASON";
    }
  }

  const wcResult = {};
  for (const [code, wc] of Object.entries(detectedWCs)) {
    wcResult[code] = { name: wc.name, machines: [], opCodes: [...wc.opCodes] };
  }
  const faResult = {};
  for (const [code, fa] of Object.entries(detectedFason)) {
    faResult[code] = { name: fa.name, leadTimeDays: 14, supplier: "", count: fa.count };
  }

  return {
    modelCode, modelName,
    parts,
    partCount: parts.length,
    levelCounts: {
      L0: parts.filter((p) => p.level === 0).length,
      L1: parts.filter((p) => p.level === 1).length,
      L2: parts.filter((p) => p.level === 2).length,
      L3: parts.filter((p) => p.level === 3).length,
      L4: parts.filter((p) => p.level >= 4).length,
    },
    opCount: totalOps,
    detectedWCs: wcResult,
    detectedFason: faResult,
    importedAt: new Date().toISOString(),
  };
}
