// Para birimi yardımcıları — Maliyet modülünde TL/USD/EUR toggle için.
// Kur kaynağı: currencyRates Firestore doc (TCMB cron tarafından doldurulur).
// Manuel override: kullanıcı toolbar input'una değer girerse, o tarihteki kuru ezer (transient).

export const CURRENCIES = ["TRY", "USD", "EUR"];
export const CURRENCY_SYMBOLS = { TRY: "₺", USD: "$", EUR: "€" };
export const CURRENCY_LABELS = { TRY: "TL", USD: "USD", EUR: "EUR" };

// currencyRates doc'undan en son kayıtlı kuru döndür. Boş ise null.
export function getLatestRates(currencyRates) {
  const map = currencyRates?.rates || {};
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return null;
  const lastKey = keys[keys.length - 1];
  const r = map[lastKey];
  return {
    date: lastKey,
    usd: Number(r?.usd) || 0,
    eur: Number(r?.eur) || 0,
    source: r?.source || "tcmb-unknown",
  };
}

// Belirli bir tarihe en yakın (eşit veya daha küçük) kayıtlı kuru bul.
// Snapshot tarihindeki tarihsel kur için kullanılır.
export function getRatesForDate(currencyRates, isoDate) {
  if (!isoDate) return getLatestRates(currencyRates);
  const map = currencyRates?.rates || {};
  const keys = Object.keys(map).filter(k => k <= isoDate).sort();
  if (keys.length === 0) {
    // Tarih kayıtlardan eskiyse en eski kuru kullan (uyarı amaçlı en yakını)
    const all = Object.keys(map).sort();
    if (all.length === 0) return null;
    const earliest = map[all[0]];
    return { date: all[0], usd: Number(earliest?.usd) || 0, eur: Number(earliest?.eur) || 0, source: (earliest?.source || "tcmb") + "-too-early" };
  }
  const lastKey = keys[keys.length - 1];
  const r = map[lastKey];
  return { date: lastKey, usd: Number(r?.usd) || 0, eur: Number(r?.eur) || 0, source: r?.source || "tcmb" };
}

// Tarihsel yıllık ortalama kurlar — Firestore'da TCMB kaydı yoksa fallback.
// Kaynaklar: paracevirici.com (TCMB arşiv) + haberturk + exchange-rates.org.
// 2026 için değer koymuyoruz — cari yılın kısmi ortalaması Firestore'dan gerçek zamanlı gelir.
const HISTORICAL_YEAR_AVG_RATES = {
  "2024": { usd: 32.90, eur: 35.57 },
  "2025": { usd: 39.57, eur: 44.85 },
};

// Belirli bir yıl için tüm kayıtlı TCMB kurlarının aritmetik ortalaması.
// Yıl arşiv teklifleri dönemsel değerlendirmek için (o yılın ortalama kuru = teklifin
// verildiği dönemin gerçek TL karşılığı).
// Firestore'da yoksa HISTORICAL_YEAR_AVG_RATES fallback'e düşer.
export function getAverageRatesForYear(currencyRates, year) {
  const map = currencyRates?.rates || {};
  const prefix = String(year) + "-";
  const keys = Object.keys(map).filter(k => k.startsWith(prefix));
  if (keys.length > 0) {
    let usdSum = 0, usdCount = 0, eurSum = 0, eurCount = 0;
    for (const k of keys) {
      const r = map[k];
      const u = Number(r?.usd);
      const e = Number(r?.eur);
      if (u > 0) { usdSum += u; usdCount++; }
      if (e > 0) { eurSum += e; eurCount++; }
    }
    return {
      year: String(year),
      usd: usdCount > 0 ? usdSum / usdCount : 0,
      eur: eurCount > 0 ? eurSum / eurCount : 0,
      days: keys.length,
      source: "firestore",
    };
  }
  // Firestore'da veri yok → tarihsel fallback
  const fb = HISTORICAL_YEAR_AVG_RATES[String(year)];
  if (fb) {
    return { year: String(year), usd: fb.usd, eur: fb.eur, days: 0, source: "historical" };
  }
  return null;
}

// TL → seçili para birimine çevir. rates objesi { usd, eur } içermeli.
export function convertFromTl(tlValue, targetCurrency, rates) {
  const v = Number(tlValue) || 0;
  if (targetCurrency === "TRY" || !rates) return v;
  if (targetCurrency === "USD") return rates.usd > 0 ? v / rates.usd : 0;
  if (targetCurrency === "EUR") return rates.eur > 0 ? v / rates.eur : 0;
  return v;
}

// Para birimi sembolü ile formatla
export function fmtMoney(tlValue, targetCurrency, rates, opts = {}) {
  const { minFrac = 2, maxFrac = 2, withSymbol = true } = opts;
  const converted = convertFromTl(tlValue, targetCurrency, rates);
  const sym = CURRENCY_SYMBOLS[targetCurrency] || "";
  const formatted = converted.toLocaleString("tr-TR", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
  return withSymbol ? `${formatted} ${sym}` : formatted;
}

// Sadece sayı (sembol yok) — tablolar için
export function fmtMoneyNum(tlValue, targetCurrency, rates, frac = 2) {
  return fmtMoney(tlValue, targetCurrency, rates, { minFrac: frac, maxFrac: frac, withSymbol: false });
}

// Manuel override + TCMB hibrit kur çözümleyici.
// override: { usd?: number, eur?: number } — kullanıcı toolbar'da değer girerse
// auto: getLatestRates(currencyRates) sonucu
export function resolveActiveRates(override, auto) {
  const usd = Number(override?.usd) > 0 ? Number(override.usd) : (auto?.usd || 0);
  const eur = Number(override?.eur) > 0 ? Number(override.eur) : (auto?.eur || 0);
  const isOverride = (Number(override?.usd) > 0) || (Number(override?.eur) > 0);
  return {
    usd, eur,
    source: isOverride ? "manuel-override" : (auto?.source || "tcmb"),
    date: isOverride ? null : (auto?.date || null),
    isOverride,
  };
}
