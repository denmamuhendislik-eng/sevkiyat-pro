// TCMB döviz kurları çekici — günlük 16:30 cron için.
// API: https://www.tcmb.gov.tr/kurlar/today.xml veya tarihli arşiv.
// Format: <Currency CurrencyCode="USD"><ForexSelling>36.4500</ForexSelling>...</Currency>
// Hafta sonu/tatil → o günün dosyası 404, fallback: en son iş gününü dene (7 gün geriye).

const TCMB_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const TCMB_ARCHIVE_URL = (yyyymm, ddmmyyyy) => `https://www.tcmb.gov.tr/kurlar/${yyyymm}/${ddmmyyyy}.xml`;

function parseRateFromXml(xml, currencyCode) {
  // Pattern: <Currency ... CurrencyCode="USD" ... > ... <ForexSelling>36.4500</ForexSelling>
  const re = new RegExp(`<Currency[^>]*CurrencyCode="${currencyCode}"[^>]*>([\\s\\S]*?)<\\/Currency>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  const block = m[1];
  // ForexSelling tercih (döviz satış) — maliyet hesabında standart.
  // Boşsa BanknoteSelling fallback (resmi tatilde bazen olmayan field).
  const fs = block.match(/<ForexSelling>([\d.]+)<\/ForexSelling>/i);
  if (fs && fs[1]) return Number(fs[1]);
  const bs = block.match(/<BanknoteSelling>([\d.]+)<\/BanknoteSelling>/i);
  if (bs && bs[1]) return Number(bs[1]);
  return null;
}

async function tryFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 100) return null;
    return text;
  } catch (err) {
    return null;
  }
}

// Tarih string formatları: TCMB arşiv "YYYYMM" + "DDMMYYYY"
function fmtYyyyMm(d) { return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0"); }
function fmtDdMmYyyy(d) { return String(d.getDate()).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0") + String(d.getFullYear()); }
function fmtIso(d) { return d.toISOString().slice(0, 10); }

/**
 * Belirli bir tarih için TCMB kurları çek. Eğer o gün veri yoksa (hafta sonu/tatil),
 * 7 güne kadar geriye doğru ara, en son iş gününü kullan.
 *
 * @param {Date|null} targetDate — null ise bugün
 * @returns {Promise<{date, usd, eur, source} | null>}
 */
async function fetchTcmbRates(targetDate = null) {
  const today = new Date();
  const startDate = targetDate ? new Date(targetDate) : today;

  // Bugün için today.xml dene
  const isToday = !targetDate || fmtIso(startDate) === fmtIso(today);
  let xml = null;
  let usedDate = null;

  if (isToday) {
    xml = await tryFetch(TCMB_TODAY_URL);
    if (xml) usedDate = fmtIso(today);
  }

  // Arşiv ile geri yürü (max 10 gün — uzun bayram tatilleri için yeterli)
  if (!xml) {
    for (let back = 0; back < 10; back++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() - back);
      const url = TCMB_ARCHIVE_URL(fmtYyyyMm(d), fmtDdMmYyyy(d));
      xml = await tryFetch(url);
      if (xml) {
        usedDate = fmtIso(d);
        break;
      }
    }
  }

  if (!xml) return null;

  const usd = parseRateFromXml(xml, "USD");
  const eur = parseRateFromXml(xml, "EUR");
  if (!(usd > 0) || !(eur > 0)) return null;

  return {
    date: usedDate,
    usd,
    eur,
    source: `tcmb-${usedDate}`,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  fetchTcmbRates,
  parseRateFromXml,  // test için export
};
