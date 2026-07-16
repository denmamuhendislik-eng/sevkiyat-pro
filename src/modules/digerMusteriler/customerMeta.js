// Müşteri kodu → rozet rengi + kısa etiket.
// VIO'dan gelen kodlar ana hesap (120-116) + alt hesaplar (120-116-1, 120-116-2, ...) şeklinde
// karışık olabilir — hepsi aynı müşteri grubu olarak ele alınır (prefix match).
// Bilinen ana hesap kodları listesine uyup uymadığını söyler.
// KNOWN_CUSTOMERS'te olan (Aselsan/Roketsan/Denma) → true, geri kalan → false.
export function isKnownCustomer(code) {
  if (!code) return false;
  return KNOWN_CUSTOMERS.some(k => matchCustomer(code, k.code));
}

// Sanal "Diğer" grubu kodu — KNOWN_CUSTOMERS'e uymayan müşteriler bunun altında toplanır.
export const OTHER_CUSTOMER_CODE = "__other__";

export function customerBadge(code) {
  if (matchCustomer(code, "120-0107")) return { bg: "#1e293b", fg: "#f1f5f9", label: "ASL" };
  if (matchCustomer(code, "120-116"))  return { bg: "#78350f", fg: "#fef3c7", label: "RKT" };
  if (matchCustomer(code, "120-115"))  return { bg: "#064e3b", fg: "#d1fae5", label: "DNM" };
  return { bg: "#4b5563", fg: "#f3f4f6", label: "DĞR" };
}

// Tam müşteri adı → kısa gösterim
export function shortName(fullName) {
  if (!fullName) return "";
  if (fullName.includes("ASELSAN")) return "Aselsan Konya";
  if (fullName.includes("ROKETSAN")) return "Roketsan";
  if (fullName.includes("DENMA")) return "Denma Dış Ticaret";
  return fullName.slice(0, 30);
}

// Ana hesap kodu ile alt hesapları da yakalayan match.
// matchCustomer("120-116-2", "120-116") === true
// matchCustomer("120-116", "120-116")   === true
// matchCustomer("120-1160", "120-116")  === false  (partial değil, "-" sınırlı)
export function matchCustomer(code, targetCode) {
  if (!code || !targetCode) return false;
  const c = String(code).trim();
  const t = String(targetCode).trim();
  return c === t || c.startsWith(t + "-");
}

// UI filtre butonları — bilinen ana hesap kodları (gerçek müşteri).
// Aselsan/Roketsan: hem VIO açık sipariş hem ekstre sevk verisi var (tam takip).
// Denma: sadece VIO açık sipariş görünür — ekstre parseri Denma'yı almıyor, cari
//        bakiye/COC gibi ekstre-bağımlı özellikler DNM için beklenmez.
export const KNOWN_CUSTOMERS = [
  { code: "120-0107", shortLabel: "ASL" },
  { code: "120-116",  shortLabel: "RKT" },
  { code: "120-115",  shortLabel: "DNM" },
];

// Sanal "Diğer" grubu — KNOWN_CUSTOMERS'e uymayan tüm müşteriler burada birleşir.
// Filtre + KPI için KNOWN_CUSTOMERS + [DĞR] listesi kullanılır (aşağıda helper).
export const OTHER_CUSTOMER = { code: OTHER_CUSTOMER_CODE, shortLabel: "DĞR" };

// UI filtre butonu sırası: ASL, RKT, DNM, DĞR
export const ALL_CUSTOMER_GROUPS = [...KNOWN_CUSTOMERS, OTHER_CUSTOMER];
