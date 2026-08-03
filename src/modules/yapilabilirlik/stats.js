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

// Firestore Timestamp objesi, ISO string veya Date — hepsini ISO'ya çevir.
// Eski/backfill kayıtlarda Timestamp obje olarak gelebilir → parse hatasını
// önlemek için savunma amaçlı normalize.
function toIso(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString();
  }
  return null;
}

function daysBetween(start, end) {
  const startIso = toIso(start);
  const endIso = toIso(end);
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

// Kayan pencere — geçmişteki "hep aynı gün" imzaları yakın performansı
// bastırmasın diye son N study'yi baz al. Girdi: [{value, t}] sortKey ile.
const RECENT_WINDOW = 10;
function recentValues(arr, n = RECENT_WINDOW) {
  return arr
    .filter(x => Number.isFinite(x?.value))
    .slice()
    .sort((a, b) => (b.t || "").localeCompare(a.t || "")) // en yeni önce
    .slice(0, n)
    .map(x => x.value);
}

// Dağılım kutuları — tooltip'te "5 hızlı · 3 normal · 2 yavaş" için.
function breakdown(values) {
  const fast = values.filter(v => v < 1).length;
  const normal = values.filter(v => v >= 1 && v <= 7).length;
  const slow = values.filter(v => v > 7).length;
  return { fast, normal, slow };
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
  const evaluatingWaits = [];     // "Karar Bekliyor" (satış) süreleri.
                                  // Aktif evaluating için: son imza → bugün (aging)
                                  // Karar verilmiş studyler için: son imza → updatedAt (proxy)
                                  // → geçmişteki karar hızını da dahil eder, metrik dolu olur.
  let evaluatingActiveCount = 0;  // Sadece şu an evaluating durumunda olanların sayısı

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

    // Tamamlanmış aşamalar — imza tarihleri arası fark. t: sortKey (en yeni imza).
    if (sSales) {
      const d = daysBetween(study.createdAt, sSales);
      if (d != null && d >= 0) salesDurations.push({ value: d, t: toIso(sSales) });
    }
    if (sTech && sSales) {
      const d = daysBetween(sSales, sTech);
      if (d != null && d >= 0) technicalDurations.push({ value: d, t: toIso(sTech) });
    }
    if (sGm && sTech) {
      const d = daysBetween(sTech, sGm);
      if (d != null && d >= 0) gmDurations.push({ value: d, t: toIso(sGm) });
    }
    // Aktif bekleyen aging — henüz imzalanmamış aşamalar için "geçen süre"
    // metriğe dahil edilsin. Aksi halde uzun bekleyen bir study medyana hiç
    // katkı vermeyip yanıltıcı düşük değerler çıkabiliyor (2026-08-03 gözlemi).
    const nowIso = new Date().toISOString();
    if (!sSales && status === "salesPending") {
      const d = daysBetween(study.createdAt, nowIso);
      if (d != null && d >= 0) salesDurations.push({ value: d, t: nowIso });
    }
    if (!sTech && status === "technicalPending" && sSales) {
      const d = daysBetween(sSales, nowIso);
      if (d != null && d >= 0) technicalDurations.push({ value: d, t: nowIso });
    }
    if (!sGm && status === "gmPending" && sTech) {
      const d = daysBetween(sTech, nowIso);
      if (d != null && d >= 0) gmDurations.push({ value: d, t: nowIso });
    }

    // Toplam süre (createdAt → son imza)
    if (status === "approved" || status === "convertedToQuote") {
      const finalSig = sGm || sTech;
      const d = daysBetween(study.createdAt, finalSig);
      if (d != null && d >= 0) totalDurations.push({ value: d, t: toIso(finalSig) });
    }
    // Karar bekleme süresi — evaluating (aktif) + karar verilmiş (geçmiş)
    // Aktif: son imza → bugün (aging)
    // Geçmiş: son imza → updatedAt (updatedAt = karar tarihi proxy)
    {
      const finalSig = sGm || sTech;
      if (finalSig) {
        if (status === "evaluating") {
          const d = daysBetween(finalSig, nowIso);
          if (d != null && d >= 0) { evaluatingWaits.push({ value: d, t: nowIso }); evaluatingActiveCount++; }
        } else if ((status === "approved" || status === "convertedToQuote" || status === "rejected") && study.updatedAt) {
          const d = daysBetween(finalSig, study.updatedAt);
          // 365 gün üstü outlier — sonradan başka bir sebeple updatedAt değişmiş olabilir
          if (d != null && d >= 0 && d < 365) evaluatingWaits.push({ value: d, t: toIso(study.updatedAt) });
        }
      }
    }
    // Teklife dönüşüm süresi
    if (status === "convertedToQuote" && study.convertedAt) {
      const finalSig = sGm || sTech;
      if (finalSig) {
        const d = daysBetween(finalSig, study.convertedAt);
        if (d != null && d >= 0) conversionDurations.push({ value: d, t: toIso(study.convertedAt) });
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

    // Dönüşüm — conversionDurations'ta recent window yok (nadir olay, tümü kullanılır)
    decidedCount,
    conversionRate,
    rejectionRate,
    avgConversionDays: median(conversionDurations.map(x => x.value)),
    avgConversionDaysMean: mean(conversionDurations.map(x => x.value)),

    // Süre — medyan SON 10 study üzerinden (kayan pencere).
    // Sebep: geçmiş "hep aynı gün imza" desenleri yakın performansı bastırmasın.
    // Fallback: 10'dan az study varsa hepsi kullanılır.
    avgSalesDays:      median(recentValues(salesDurations)),
    avgTechnicalDays:  median(recentValues(technicalDurations)),
    avgGmDays:         median(recentValues(gmDurations)),
    avgEvaluatingDays: median(recentValues(evaluatingWaits)),
    evaluatingCount: evaluatingActiveCount,
    evaluatingSampleSize: evaluatingWaits.length,
    avgTotalDays:      median(recentValues(totalDurations)),
    // Sample debug — StageRow tooltip için. windowN: medyan hangi pencerede
    // hesaplandı (min(total, 10)). breakdown: dağılım kutuları.
    stageStats: (() => {
      const build = (arr) => {
        const rec = recentValues(arr);
        return {
          n: arr.length,           // toplam study sayısı
          windowN: rec.length,     // medyan hangi pencerede (son N)
          samples: rec.slice(0, 5).map(v => Number(v.toFixed ? v.toFixed(2) : v)),
          breakdown: breakdown(rec),
        };
      };
      return {
        sales:      build(salesDurations),
        technical:  build(technicalDurations),
        gm:         build(gmDurations),
        evaluating: build(evaluatingWaits),
        total:      build(totalDurations),
      };
    })(),
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
