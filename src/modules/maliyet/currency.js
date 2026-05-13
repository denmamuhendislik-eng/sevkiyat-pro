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
