// Yapılabilirlik KPI hesaplamaları — pure fonksiyonlar.
// UI'dan bağımsız, listedeki tüm study'leri alıp aggregate metrikler döndürür.
//
// Kullanım:
//   const stats = computeFeasibilityStats(studies);
//   stats.total, stats.conversionRate, stats.questionRanking, ...

import {
  EVALUATION_QUESTIONS,
  computeStudyScore,
  getRecommendation,
  getNegotiationHints,
  scoreForAnswer,
} from "./schema";
import { computeStudyStatus } from "./firestore";

function daysBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (isNaN(s) || isNaN(e)) return null;
  return (e - s) / (1000 * 60 * 60 * 24);
}

function mean(arr) {
  const filtered = arr.filter(n => Number.isFinite(n));
  if (filtered.length === 0) return null;
  return filtered.reduce((s, n) => s + n, 0) / filtered.length;
}

function median(arr) {
  const filtered = arr.filter(n => Number.isFinite(n));
  if (filtered.length === 0) return null;
  const sorted = filtered.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeFeasibilityStats(studies) {
  const list = Array.isArray(studies) ? studies : [];

  // Durum sayaçları
  const byStatus = {
    draft: 0, salesPending: 0, technicalPending: 0, gmPending: 0,
    evaluating: 0, approved: 0, rejected: 0, convertedToQuote: 0,
  };

  const scoresPercent = [];
  const salesScores = [];
  const technicalScores = [];

  // Süreler (gün)
  const salesDurations = [];      // createdAt → salesManager.signedAt
  const technicalDurations = [];  // salesManager → technicalUnit
  const gmDurations = [];         // technicalUnit → generalManager
  const totalDurations = [];      // createdAt → son imza (approved için)
  const conversionDurations = []; // son imza → convertedAt

  const slowestPending = []; // aktif bekleyenler

  // Soru başına puan/max/cevap dağılımı
  const questionStats = {};
  EVALUATION_QUESTIONS.forEach(q => {
    questionStats[q.key] = {
      key: q.key,
      label: q.label,
      dept: q.dept,
      max: q.max || 0,
      totalScore: 0,
      totalMax: 0,
      count: 0,
      answersCount: {}, // { EVET: 3, HAYIR: 2, KISMEN: 5 } veya slider için { "0":1, "5":3 ... }
    };
  });

  const hintCounts = {}; // { questionKey: count }
  let systemAgreeCount = 0;
  let systemDisagreeCount = 0;

  const customerStats = {};

  for (const study of list) {
    const status = computeStudyStatus(study);
    if (byStatus[status] !== undefined) byStatus[status]++;

    const score = computeStudyScore(study);
    scoresPercent.push(score.percent);
    salesScores.push(score.sales.percent);
    technicalScores.push(score.technical.percent);

    // Aşama süreleri
    const sigs = study.signatures || {};
    const sSales = sigs.salesManager?.signedAt;
    const sTech = sigs.technicalUnit?.signedAt;
    const sGm = sigs.generalManager?.signedAt;

    if (sSales) {
      const d = daysBetween(study.createdAt, sSales);
      if (d != null && d >= 0) salesDurations.push(d);
    }
    if (sTech && sSales) {
      const d = daysBetween(sSales, sTech);
      if (d != null && d >= 0) technicalDurations.push(d);
    }
    if (sGm && sTech) {
      const d = daysBetween(sTech, sGm);
      if (d != null && d >= 0) gmDurations.push(d);
    }

    // Toplam süre (createdAt → son imza)
    if (status === "approved" || status === "convertedToQuote") {
      const finalSig = sGm || sTech;
      const d = daysBetween(study.createdAt, finalSig);
      if (d != null && d >= 0) totalDurations.push(d);
    }
    // Teklife dönüşüm süresi
    if (status === "convertedToQuote" && study.convertedAt) {
      const finalSig = sGm || sTech;
      if (finalSig) {
        const d = daysBetween(finalSig, study.convertedAt);
        if (d != null && d >= 0) conversionDurations.push(d);
      }
    }

    // En yavaş aktif bekleyen
    if (["salesPending", "technicalPending", "gmPending", "evaluating"].includes(status)) {
      const pendingSince = sTech || sSales || study.createdAt || study.updatedAt;
      const waitDays = daysBetween(pendingSince, new Date().toISOString());
      slowestPending.push({
        studyNo: study.studyNo,
        customerName: study.customerName || "—",
        status,
        waitDays: waitDays || 0,
      });
    }

    // Soru puan istatistikleri
    const evaluation = study.evaluation || {};
    for (const q of EVALUATION_QUESTIONS) {
      const ans = evaluation[q.key]?.answer;
      if (ans == null || ans === "") continue;
      const points = scoreForAnswer(q, ans);
      const qs = questionStats[q.key];
      qs.totalScore += points;
      qs.totalMax += q.max || 0;
      qs.count++;
      const ansKey = q.type === "slider" ? String(ans) : String(ans).toUpperCase();
      qs.answersCount[ansKey] = (qs.answersCount[ansKey] || 0) + 1;
    }

    // Müzakere ipuçları — her sık tetiklenen hint say
    const hints = getNegotiationHints(study);
    for (const h of hints) {
      hintCounts[h.questionKey] = (hintCounts[h.questionKey] || 0) + 1;
    }

    // Sistem önerisi vs karar tutarlılığı (sadece karar verilenler)
    if (study.decision) {
      const rec = getRecommendation(score.percent);
      if (rec.key === study.decision) systemAgreeCount++;
      else systemDisagreeCount++;
    }

    // Müşteri stats
    const cName = study.customerName || "—";
    if (!customerStats[cName]) {
      customerStats[cName] = {
        name: cName,
        total: 0, converted: 0, rejected: 0, approved: 0,
        scoreSum: 0, scoreCount: 0,
      };
    }
    const cs = customerStats[cName];
    cs.total++;
    if (status === "convertedToQuote") cs.converted++;
    if (status === "rejected") cs.rejected++;
    if (status === "approved") cs.approved++;
    cs.scoreSum += score.percent;
    cs.scoreCount++;
  }

  // Dönüşüm oranları
  const decidedCount = byStatus.approved + byStatus.rejected + byStatus.convertedToQuote;
  const conversionRate = decidedCount > 0 ? (byStatus.convertedToQuote / decidedCount) * 100 : 0;
  const rejectionRate = decidedCount > 0 ? (byStatus.rejected / decidedCount) * 100 : 0;
  const lostOpportunity = byStatus.approved;
  const activePending = byStatus.salesPending + byStatus.technicalPending + byStatus.gmPending + byStatus.evaluating;

  // Soru rankingleri: en düşük ratio (avg score / max) başta
  const questionRanking = Object.values(questionStats)
    .filter(qs => qs.count > 0)
    .map(qs => ({
      ...qs,
      ratio: qs.totalMax > 0 ? qs.totalScore / qs.totalMax : 0,
      avgScorePct: qs.totalMax > 0 ? Math.round((qs.totalScore / qs.totalMax) * 100) : 0,
    }))
    .sort((a, b) => a.ratio - b.ratio);

  // Yavaş bekleyenler sırala
  slowestPending.sort((a, b) => b.waitDays - a.waitDays);

  // Müşteri sırala (toplam sayı desc)
  const customerRanking = Object.values(customerStats)
    .map(c => ({
      ...c,
      conversionRate: c.total > 0 ? (c.converted / c.total) * 100 : 0,
      avgScore: c.scoreCount > 0 ? c.scoreSum / c.scoreCount : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // En sık tetiklenen müzakere ipucu (top N için)
  const hintRanking = Object.entries(hintCounts)
    .map(([key, count]) => {
      const q = EVALUATION_QUESTIONS.find(x => x.key === key);
      return { key, count, label: q?.label || key, hint: q?.hintOnLow || "" };
    })
    .sort((a, b) => b.count - a.count);

  return {
    total: list.length,
    byStatus,
    activePending,
    lostOpportunity,

    // Dönüşüm
    decidedCount,
    conversionRate,
    rejectionRate,
    avgConversionDays: median(conversionDurations),
    avgConversionDaysMean: mean(conversionDurations),

    // Süre
    avgSalesDays: median(salesDurations),
    avgTechnicalDays: median(technicalDurations),
    avgGmDays: median(gmDurations),
    avgTotalDays: median(totalDurations),
    slowestPending: slowestPending.slice(0, 5),

    // Puan
    avgScorePercent: mean(scoresPercent),
    avgSalesPercent: mean(salesScores),
    avgTechnicalPercent: mean(technicalScores),
    scoreHistogram: {
      low: scoresPercent.filter(s => s < 50).length,
      mid: scoresPercent.filter(s => s >= 50 && s < 75).length,
      high: scoresPercent.filter(s => s >= 75).length,
    },
    questionRanking, // sıralı: en düşük ratio başta

    // Karar tutarlılığı
    systemAgreeCount,
    systemDisagreeCount,

    // Müşteri
    customerRanking,

    // Müzakere ipuçları
    hintRanking,
  };
}
