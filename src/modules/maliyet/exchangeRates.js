// TCMB hardcoded kur tablosu — Cloud Function gelene kadar geçici.
// Aylık ortalama indicative kurlar. Her ay başında manuel güncellenebilir.
// TODO: Cloud Function ile günlük TCMB indicative kurlarını exchangeRates/{YYYY-MM-DD} altına yazınca bu tablo fallback olur.

const HARDCODED_MONTHLY_RATES = {
  // YYYY-MM: { USD, EUR }
  "2024-01": { USD: 30.0, EUR: 32.7 },
  "2024-06": { USD: 32.5, EUR: 35.0 },
  "2024-12": { USD: 35.3, EUR: 37.2 },
  "2025-03": { USD: 37.0, EUR: 40.0 },
  "2025-06": { USD: 39.5, EUR: 43.5 },
  "2025-09": { USD: 41.0, EUR: 47.0 },
  "2025-12": { USD: 42.5, EUR: 49.0 },
  "2026-01": { USD: 43.0, EUR: 49.5 },
  "2026-02": { USD: 43.5, EUR: 50.0 },
  "2026-03": { USD: 44.0, EUR: 50.5 },
  "2026-04": { USD: 44.5, EUR: 51.0 },
  "2026-05": { USD: 45.0, EUR: 51.5 },
};

// En yakın tarihteki kuru döndürür (hardcoded tablodan).
// dateStr: "YYYY-MM-DD" veya null
export function getApproxRate(dateStr) {
  if (!dateStr) {
    const months = Object.keys(HARDCODED_MONTHLY_RATES).sort();
    return HARDCODED_MONTHLY_RATES[months[months.length - 1]];
  }
  const ym = dateStr.slice(0, 7);
  if (HARDCODED_MONTHLY_RATES[ym]) return HARDCODED_MONTHLY_RATES[ym];
  // En yakın ay (önce veya sonra)
  const months = Object.keys(HARDCODED_MONTHLY_RATES).sort();
  let best = months[0];
  let bestDiff = Infinity;
  for (const m of months) {
    const diff = Math.abs(m.localeCompare(ym));
    if (diff < bestDiff) { bestDiff = diff; best = m; }
  }
  return HARDCODED_MONTHLY_RATES[best];
}

// Bir TL/Dvz oran verildiğinde hangi döviz olduğunu tahmin eder.
// Mantık: rate'e en yakın olanı seç (USD vs EUR).
// dateStr: "YYYY-MM-DD" (ratio'nun ait olduğu tarih)
// ratio: Satır Net Fiyatı / Satır Net Dv.Fiyatı
// Döndürür: { currency: "USD"|"EUR", confidence: "high"|"medium"|"low", refRate }
export function guessCurrency(ratio, dateStr) {
  const refRates = getApproxRate(dateStr);
  if (!ratio || ratio <= 0) return { currency: "TRY", confidence: "high", refRate: null };
  const usdDiff = Math.abs(ratio - refRates.USD) / refRates.USD;
  const eurDiff = Math.abs(ratio - refRates.EUR) / refRates.EUR;
  const pick = usdDiff < eurDiff ? "USD" : "EUR";
  const pickDiff = Math.min(usdDiff, eurDiff);
  // %5'ten yakın → yüksek güven, %15'e kadar → orta, üstü → düşük
  const confidence = pickDiff < 0.05 ? "high" : pickDiff < 0.15 ? "medium" : "low";
  return { currency: pick, confidence, refRate: refRates[pick] };
}
