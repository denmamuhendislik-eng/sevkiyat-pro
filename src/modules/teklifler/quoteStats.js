// Teklif KPI hesaplamaları — pure fonksiyon.
// Kural: Arşiv (source="excel-archive-import") status alanı güvenilmez olduğu için
// dönüşüm/kabul/reddedildi hesaplarına DAHİL EDİLMEZ. Sadece sistem içi teklifler
// (source="ui" | "from-feasibility" | null) ticari KPI'lara girer.

function daysBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const s = new Date(String(startIso).slice(0, 10)).getTime();
  const e = new Date(String(endIso).slice(0, 10)).getTime();
  if (isNaN(s) || isNaN(e)) return null;
  return (e - s) / (1000 * 60 * 60 * 24);
}

function mean(arr) {
  const f = arr.filter(n => Number.isFinite(n));
  if (f.length === 0) return null;
  return f.reduce((s, n) => s + n, 0) / f.length;
}

function median(arr) {
  const f = arr.filter(n => Number.isFinite(n));
  if (f.length === 0) return null;
  const sorted = f.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const isArchive = (q) => q?.source === "excel-archive-import";

export function computeQuoteStats(quotes) {
  const list = Array.isArray(quotes) ? quotes.filter(q => q?.quoteNo) : [];

  // Revizyon zincirlerini grupla — her (baseNo + müşteri) tek teklif sayılır
  const groups = new Map();
  for (const q of list) {
    const baseNo = q.baseQuoteNo || q.quoteNo;
    const custKey = String(q.customerName || "").replace(/\s+/g, "_").substring(0, 40);
    const key = `${baseNo}__${custKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const groupList = Array.from(groups.values()).map(revs => {
    const sorted = revs.slice().sort((a, b) => (Number(b.revNo) || 0) - (Number(a.revNo) || 0));
    return { active: sorted[0], all: sorted, history: sorted.slice(1) };
  });

  // Her grupta aktif (en yüksek revNo) teklifi say
  const activeQuotes = groupList.map(g => g.active);
  const nonArchive = activeQuotes.filter(q => !isArchive(q));
  const archive = activeQuotes.filter(isArchive);

  // Durum sayaçları — SADECE arşiv olmayan tekliflerde
  const byStatus = { draft: 0, sent: 0, accepted: 0, rejected: 0 };
  for (const q of nonArchive) {
    const st = q.status || "sent";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }

  // Dönüşüm oranı — arşiv hariç
  const decidedCount = byStatus.accepted + byStatus.rejected;
  const conversionRate = decidedCount > 0 ? (byStatus.accepted / decidedCount) * 100 : null;

  // Portfolio
  const totalCount = nonArchive.length;
  const totalTl = nonArchive.reduce((s, q) => s + (Number(q.totalPriceTl) || 0), 0);
  const avgQuoteTl = totalCount > 0 ? totalTl / totalCount : 0;

  const activeStatuses = ["draft", "sent"];
  const activeQuotesOnly = nonArchive.filter(q => activeStatuses.includes(q.status || "sent"));
  const activeCount = activeQuotesOnly.length;
  const activeTotalTl = activeQuotesOnly.reduce((s, q) => s + (Number(q.totalPriceTl) || 0), 0);

  // Ortalama teklif → sipariş süresi (kabul olanlar)
  const conversionDays = [];
  for (const q of nonArchive) {
    if (q.status === "accepted" && q.quoteDate && q.orderDate) {
      const d = daysBetween(q.quoteDate, q.orderDate);
      if (d != null && d >= 0) conversionDays.push(d);
    }
  }

  // Feasibility zinciri — arşiv hariç
  const fromFeasibilityCount = nonArchive.filter(q =>
    q.feasibilityNo || (Array.isArray(q.feasibilityNos) && q.feasibilityNos.length > 0)
  ).length;
  const fromFeasibilityAccepted = nonArchive.filter(q => {
    const hasFeas = q.feasibilityNo || (Array.isArray(q.feasibilityNos) && q.feasibilityNos.length > 0);
    return hasFeas && q.status === "accepted";
  }).length;

  // Revizyon istatistikleri (arşiv olmayan grup'lar)
  const nonArchiveGroups = groupList.filter(g => !isArchive(g.active));
  const withRevisions = nonArchiveGroups.filter(g => g.history.length > 0).length;
  const revisionRate = nonArchiveGroups.length > 0 ? (withRevisions / nonArchiveGroups.length) * 100 : 0;
  const revCounts = nonArchiveGroups.map(g => Number(g.active.revNo) || 0);
  const avgRevNo = mean(revCounts);

  // Müşteri sıralaması — TL cirosuna göre
  const customerStats = {};
  for (const q of nonArchive) {
    const cName = q.customerName || "—";
    if (!customerStats[cName]) customerStats[cName] = {
      name: cName, count: 0, tl: 0,
      accepted: 0, decided: 0, sent: 0,
    };
    const cs = customerStats[cName];
    cs.count++;
    cs.tl += Number(q.totalPriceTl) || 0;
    if (q.status === "accepted") { cs.accepted++; cs.decided++; }
    else if (q.status === "rejected") cs.decided++;
    else if (q.status === "sent" || q.status === "draft") cs.sent++;
  }
  const customerRanking = Object.values(customerStats)
    .map(c => ({
      ...c,
      conversionRate: c.decided > 0 ? (c.accepted / c.decided) * 100 : null,
    }))
    .sort((a, b) => b.tl - a.tl);

  // Parça bazlı KPI
  const partStats = {};
  for (const q of nonArchive) {
    for (const line of (q.lines || [])) {
      const code = String(line.stockCode || "").trim();
      if (!code) continue;
      if (!partStats[code]) partStats[code] = {
        code,
        name: line.stockName || "",
        quoteCount: 0,
        totalQty: 0,
        totalTl: 0,
        unitTlSum: 0,
        unitTlCount: 0,
        maxUnitTl: 0,
        accepted: 0,
        decided: 0,
      };
      const p = partStats[code];
      p.quoteCount++;
      const qty = Number(line.quantity) || 0;
      const linePrice = Number(line.linePrice) || 0;
      const unitPrice = qty > 0 ? linePrice / qty : 0;
      p.totalQty += qty;
      p.totalTl += linePrice;
      p.unitTlSum += unitPrice;
      p.unitTlCount++;
      if (unitPrice > p.maxUnitTl) p.maxUnitTl = unitPrice;
      if (line.stockName && !p.name) p.name = line.stockName;
      if (q.status === "accepted") { p.accepted++; p.decided++; }
      else if (q.status === "rejected") p.decided++;
    }
  }
  const parts = Object.values(partStats).map(p => ({
    ...p,
    avgUnitTl: p.unitTlCount > 0 ? p.unitTlSum / p.unitTlCount : 0,
    conversionRate: p.decided > 0 ? (p.accepted / p.decided) * 100 : null,
  }));

  const topByTotalTl = parts.slice().sort((a, b) => b.totalTl - a.totalTl).slice(0, 5);
  const topByQuoteCount = parts.slice().sort((a, b) => b.quoteCount - a.quoteCount).slice(0, 5);
  const topByQty = parts.slice().sort((a, b) => b.totalQty - a.totalQty).slice(0, 5);
  const lowConversionParts = parts
    .filter(p => p.decided >= 2 && p.conversionRate != null && p.conversionRate < 50)
    .sort((a, b) => a.conversionRate - b.conversionRate)
    .slice(0, 5);

  // Aging (aktif teklifler — en eski başta)
  const activeAging = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const q of activeQuotesOnly) {
    const days = daysBetween(q.quoteDate, today);
    if (days != null && days >= 0) {
      activeAging.push({
        quoteNo: q.quoteNo,
        customerName: q.customerName || "—",
        totalTl: Number(q.totalPriceTl) || 0,
        currency: q.currency || "TL",
        days,
        status: q.status || "sent",
      });
    }
  }
  activeAging.sort((a, b) => b.days - a.days);

  const lostOpportunity = activeAging.filter(q => q.days > 60);

  return {
    // Genel
    totalRecords: activeQuotes.length,
    archiveCount: archive.length,
    nonArchiveCount: nonArchive.length,

    // Portfolio (arşiv hariç)
    totalCount, totalTl, avgQuoteTl,
    activeCount, activeTotalTl,
    byStatus,

    // Dönüşüm
    decidedCount,
    conversionRate,
    avgConversionDays: median(conversionDays),

    // Feasibility
    fromFeasibilityCount,
    fromFeasibilityAccepted,
    feasibilityRate: totalCount > 0 ? (fromFeasibilityCount / totalCount) * 100 : 0,

    // Revizyon
    withRevisions,
    revisionRate,
    avgRevNo,

    // Müşteri sıralaması (ciro desc)
    customerRanking,

    // Parça istatistikleri
    topByTotalTl,
    topByQuoteCount,
    topByQty,
    lowConversionParts,

    // Aging
    activeAging: activeAging.slice(0, 10),
    lostOpportunity,
  };
}
