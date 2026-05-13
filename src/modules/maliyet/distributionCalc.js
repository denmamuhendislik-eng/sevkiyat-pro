// Tezgah dakika maliyeti hesabı.
// Model:
//   1. WC-bazlı maaş kalemleri → o WC'nin tezgahlarına eşit dağıtılır
//   2. Geri kalan gider → 4 ağırlıkla (satınAlma/alan/kuruluKw/operator) tüm tezgahlara
//   3. Tezgah meta'daki operatorAylikTl (varsa) → direkt eklenir
//   4. Aylık toplam / çalışılan dakika = TL/dakika

import { getApproxRate } from "./exchangeRates";

export const DEFAULT_WEIGHTS = { satinAlma: 0.40, alan: 0.30, kuruluKw: 0.10, operator: 0.20 };

// Tezgah meta'sı olmayan veya eksik girilmiş WC'lerin tezgahları için fallback
function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

// Tezgahın satınAlma değerini TL karşılığına çevirir (currency: TRY/USD/EUR)
function machineSatinAlmaTl(m) {
  const v = safeNum(m.satinAlmaTl);
  if (v <= 0) return 0;
  const cur = m.satinAlmaCurrency || "TRY";
  if (cur === "TRY" || cur === "TL") return v;
  // TCMB tahmin tablosu — en yakın tarihteki kur (cron gelince günlük olur)
  const rates = getApproxRate(null);
  if (cur === "USD" && rates?.USD) return v * rates.USD;
  if (cur === "EUR" && rates?.EUR) return v * rates.EUR;
  return v; // bilinmeyen birim → olduğu gibi
}

export function calculateMachineRates({
  monthData,         // { items: [{ id (code), category, amount }], totalTl }
  policy,            // { weights, wcSalaryMapping, supplyWcCodes, supplyAvgWindowMonths }
  workCenters,       // appData/workCenters dokümanı
  workDays = 22,     // ay başına iş günü (default)
  monthlySupplies = null,  // { "2026-04": { totalTl, items, ... } } — opsiyonel, varsa sarf dağıtımı yapılır
  refMonth = null,         // seçili hesap ayı ("2026-04"); sarf ortalaması bu ay öncesinden alınır
}) {
  const weights = (policy?.weights && typeof policy.weights === "object")
    ? { ...DEFAULT_WEIGHTS, ...policy.weights }
    : { ...DEFAULT_WEIGHTS };
  const wcSalaryMapping = policy?.wcSalaryMapping || {};
  const shiftHours = safeNum(workCenters?.shiftHours) || 9;
  const efficiency = safeNum(workCenters?.efficiency) || 0.85;
  const minutesPerMonth = workDays * shiftHours * 60 * efficiency;

  // 1. Tüm tezgahları topla — satınAlma TL karşılığı kur dönüşümüyle
  const machines = [];
  for (const [wcCode, wc] of Object.entries(workCenters?.centers || {})) {
    (wc.machines || []).forEach(m => {
      machines.push({
        id: m.id,
        name: m.name,
        wcCode,
        wcName: wc.name || wcCode,
        satinAlmaTl: machineSatinAlmaTl(m),              // kur dönüşümlü TL
        satinAlmaOriginal: safeNum(m.satinAlmaTl),       // orijinal döviz/TL tutar (audit)
        satinAlmaCurrency: m.satinAlmaCurrency || "TRY", // info
        alanM2: safeNum(m.alanM2),
        kuruluKw: safeNum(m.kuruluKw),
        operatorAylikTl: safeNum(m.operatorAylikTl),
        amortismanYil: safeNum(m.amortismanYil) || 10,
        isVirtual: !m.mesOpCodes || m.mesOpCodes.length === 0,
      });
    });
  }

  if (machines.length === 0) {
    return {
      machines: [],
      machinePay: {},
      summary: { error: "Hiç tezgah tanımlı değil — İş Merkezleri tab'ından tezgah ekleyin." },
    };
  }

  // 2. Gider kalemlerini ayrıştır: WC-bazlı maaş vs genel havuz
  const items = (monthData?.items || []);
  const wcSalaryItems = [];
  const generalPoolItems = [];
  for (const item of items) {
    const codeKey = String(item.id || item.code || "");
    const mapping = wcSalaryMapping[codeKey];
    if (Array.isArray(mapping) && mapping.length > 0) {
      wcSalaryItems.push({ ...item, wcCodes: mapping });
    } else {
      generalPoolItems.push(item);
    }
  }

  // 3. Tezgah pay haritası
  const machinePay = {};
  machines.forEach(m => {
    machinePay[m.id] = {
      satinAlmaPay: 0, alanPay: 0, kuruluKwPay: 0, operatorPay: 0,
      wcSalaryPay: 0, operatorDirect: 0, supplyPay: 0, total: 0, ratePerMin: 0,
    };
  });

  // 4. WC-bazlı maaşları dağıt — o WC'nin tezgahlarına EŞİT pay
  const wcSalaryUnmapped = [];  // WC mapping'i geçerli ama o WC'de tezgah yok → bilgi için
  for (const sal of wcSalaryItems) {
    const targetMachines = machines.filter(m => sal.wcCodes.includes(m.wcCode));
    if (targetMachines.length === 0) {
      wcSalaryUnmapped.push({ code: sal.id || sal.code, amount: sal.amount, wcCodes: sal.wcCodes });
      continue;
    }
    const perMachine = (Number(sal.amount) || 0) / targetMachines.length;
    targetMachines.forEach(m => {
      machinePay[m.id].wcSalaryPay += perMachine;
    });
  }

  // 5. Genel havuz toplamı
  const wcSalaryTotal = wcSalaryItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const generalPool = generalPoolItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  // 6. 4 ağırlıkla genel havuz dağıtımı
  const totalSatinAlma = machines.reduce((s, m) => s + m.satinAlmaTl, 0);
  const totalAlan = machines.reduce((s, m) => s + m.alanM2, 0);
  const totalKw = machines.reduce((s, m) => s + m.kuruluKw, 0);
  const machineCount = machines.length;

  const satinAlmaPool = generalPool * (weights.satinAlma || 0);
  const alanPool = generalPool * (weights.alan || 0);
  const kwPool = generalPool * (weights.kuruluKw || 0);
  const operatorPool = generalPool * (weights.operator || 0);

  machines.forEach(m => {
    const p = machinePay[m.id];
    if (totalSatinAlma > 0) p.satinAlmaPay = satinAlmaPool * (m.satinAlmaTl / totalSatinAlma);
    if (totalAlan > 0) p.alanPay = alanPool * (m.alanM2 / totalAlan);
    if (totalKw > 0) p.kuruluKwPay = kwPool * (m.kuruluKw / totalKw);
    if (machineCount > 0) p.operatorPay = operatorPool / machineCount;
    p.operatorDirect = m.operatorAylikTl;
  });

  // 6b. Stok sarf hareketlerinin dağıtımı — ayrı havuz, sadece policy.supplyWcCodes WC'lerine,
  // o WC'lerin makinaları arasında 4 ağırlık ile bölünür. Hareketli ortalama TL'i kullanılır.
  const supplyWcCodes = Array.isArray(policy?.supplyWcCodes) ? policy.supplyWcCodes : [];
  let supplyAvgInfo = { avgTl: 0, monthsUsed: 0, monthsList: [] };
  if (monthlySupplies && supplyWcCodes.length > 0) {
    const win = Number(policy?.supplyAvgWindowMonths) || 6;
    supplyAvgInfo = getSupplyMonthlyAvg(monthlySupplies, win, refMonth);
    if (supplyAvgInfo.avgTl > 0) {
      const targetMachines = machines.filter(m => supplyWcCodes.includes(m.wcCode));
      if (targetMachines.length > 0) {
        const tSatinAlma = targetMachines.reduce((s, m) => s + m.satinAlmaTl, 0);
        const tAlan = targetMachines.reduce((s, m) => s + m.alanM2, 0);
        const tKw = targetMachines.reduce((s, m) => s + m.kuruluKw, 0);
        const tCount = targetMachines.length;
        const sAvgPool = supplyAvgInfo.avgTl * (weights.satinAlma || 0);
        const sAlanPool = supplyAvgInfo.avgTl * (weights.alan || 0);
        const sKwPool = supplyAvgInfo.avgTl * (weights.kuruluKw || 0);
        const sOpPool = supplyAvgInfo.avgTl * (weights.operator || 0);
        targetMachines.forEach(m => {
          const p = machinePay[m.id];
          let pay = 0;
          if (tSatinAlma > 0) pay += sAvgPool * (m.satinAlmaTl / tSatinAlma);
          if (tAlan > 0) pay += sAlanPool * (m.alanM2 / tAlan);
          if (tKw > 0) pay += sKwPool * (m.kuruluKw / tKw);
          if (tCount > 0) pay += sOpPool / tCount;
          p.supplyPay = pay;
        });
      }
    }
  }

  // 7. Total + ratePerMin (sarf payı dahil)
  machines.forEach(m => {
    const p = machinePay[m.id];
    p.total = p.satinAlmaPay + p.alanPay + p.kuruluKwPay + p.operatorPay + p.wcSalaryPay + p.operatorDirect + p.supplyPay;
    // Sanal tezgahlar (mesOpCodes yok) gerçekten çalışmadığı için dakika ücreti irrelevant ama yine de hesapla (referans)
    p.ratePerMin = minutesPerMonth > 0 ? p.total / minutesPerMonth : 0;
  });

  // Dağıtım toplamı kontrolü
  const totalDistributed = machines.reduce((s, m) => s + machinePay[m.id].total, 0);
  const totalSourceMonth = (Number(monthData?.totalTl) || 0) + machines.reduce((s, m) => s + m.operatorAylikTl, 0);
  // not: source toplam = ay toplamı + meta operatorAylikTl (ekstra direkt). Tutar tutar kontrol eder.

  return {
    machines,
    machinePay,
    summary: {
      monthlyTotal: monthData?.totalTl || 0,
      wcSalaryTotal,
      generalPool,
      pools: { satinAlma: satinAlmaPool, alan: alanPool, kuruluKw: kwPool, operator: operatorPool },
      totals: { satinAlma: totalSatinAlma, alan: totalAlan, kuruluKw: totalKw, machineCount },
      minutesPerMonth,
      shiftHours, efficiency, workDays,
      totalDistributed,
      totalSourceMonth,
      operatorDirectTotal: machines.reduce((s, m) => s + m.operatorAylikTl, 0),
      wcSalaryUnmapped,
      supplyDistribution: {
        avgTl: supplyAvgInfo.avgTl,
        monthsUsed: supplyAvgInfo.monthsUsed,
        monthsList: supplyAvgInfo.monthsList,
        wcCodes: supplyWcCodes,
        totalDistributed: machines.reduce((s, m) => s + machinePay[m.id].supplyPay, 0),
      },
    },
  };
}

// WC-bazlı maaş otomatik tahmin — gider kalemleri + tanımlı WC'ler verilince mapping önerir
export function suggestWcSalaryMapping(items, wcCenters) {
  // wcCenters: { [wcCode]: { name, machines } }
  const wcList = Object.entries(wcCenters || {}).map(([code, wc]) => ({
    code, name: String(wc.name || code).toLocaleLowerCase("tr-TR"),
  }));
  const suggestions = {};

  for (const item of items) {
    const itemCode = String(item.id || item.code || "");
    const itemName = String(item.category || item.name || "").toLocaleLowerCase("tr-TR");
    if (!itemName.includes("maaş") && !itemName.includes("maas")) continue;

    const matched = [];
    // Kural tabanı (kullanıcının yorumlarına göre)
    if (itemName.includes("talaşlı") || itemName.includes("talasli")) {
      // Talaşlı imalat → TORNA + İŞLEME
      wcList.forEach(wc => {
        if (wc.name.includes("torna") || wc.name.includes("işleme") || wc.name.includes("isleme")) matched.push(wc.code);
      });
    } else if (itemName.includes("montaj") || itemName.includes("pres") || itemName.includes("kaynak")) {
      // Montaj/pres/kaynak → MONTAJ + PRES + KAYNAK
      wcList.forEach(wc => {
        if (wc.name.includes("montaj") || wc.name.includes("pres") || wc.name.includes("kaynak")) matched.push(wc.code);
      });
    } else if (itemName.includes("depo") || itemName.includes("testere") || itemName.includes("boya")) {
      // Depo/testere/boya → TESTERE + (varsa boya tezgahı)
      wcList.forEach(wc => {
        if (wc.name.includes("testere") || wc.name.includes("boya")) matched.push(wc.code);
      });
    } else if (itemName.includes("mühendislik") || itemName.includes("muhendislik")) {
      // Mühendislik → KALİTE KONTROL (kullanıcı kararı)
      wcList.forEach(wc => {
        if (wc.name.includes("kalite")) matched.push(wc.code);
      });
    }
    // sosyal hizmetli, idari hizmet → ortak havuz (mapping yok)

    if (matched.length > 0) {
      // Unique
      suggestions[itemCode] = [...new Set(matched)];
    }
  }

  return suggestions;
}

// ==================== STOK SARF — HAREKETLİ ORTALAMA ====================
// Yığılan alımları (varil soğutma sıvısı vb.) yumuşatmak için, mamul maliyet
// hesabında o ayın tek başına TL'i yerine son N ayın aritmetik ortalaması kullanılır.
//
// monthlySupplies: { "2026-01": { totalTl, items, ... }, ... }
// windowMonths:    son kaç ayın ortalaması (3/6/12; default 6)
// refMonth (ops):  "2026-04" gibi referans ay — bu ayın TAMAMI ortalama dahil değil,
//                  refMonth'tan önceki son N ay kullanılır. Verilmezse bugünün ayı
//                  hariç tüm tam aylar üzerinden ortalama.
//
// Dönüş: { avgTl, monthsUsed, monthsList }
export function getSupplyMonthlyAvg(monthlySupplies, windowMonths = 6, refMonth = null) {
  const map = monthlySupplies || {};
  const sorted = Object.keys(map).sort();
  // Bugünün ayı ve sonrası kısmi veri → her zaman hariç
  const today = new Date().toISOString().slice(0, 7);
  const cutoff = refMonth || today;
  const candidates = sorted.filter(m => m < cutoff);
  // Son N ay
  const selected = candidates.slice(-Math.max(1, Number(windowMonths) || 6));
  if (selected.length === 0) {
    return { avgTl: 0, monthsUsed: 0, monthsList: [] };
  }
  const sum = selected.reduce((s, m) => s + (Number(map[m]?.totalTl) || 0), 0);
  return {
    avgTl: sum / selected.length,
    monthsUsed: selected.length,
    monthsList: selected,
  };
}
