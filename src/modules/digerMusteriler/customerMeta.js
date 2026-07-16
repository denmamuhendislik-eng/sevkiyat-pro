// Müşteri kodu → rozet rengi + kısa etiket.
// VIO'dan gelen kodlar ana hesap (120-116) + alt hesaplar (120-116-1, 120-116-2, ...) şeklinde
// karışık olabilir — hepsi aynı müşteri grubu olarak ele alınır (prefix match).
export function customerBadge(code) {
  if (matchCustomer(code, "120-0107")) return { bg: "#1e293b", fg: "#f1f5f9", label: "ASL" };
  if (matchCustomer(code, "120-116"))  return { bg: "#78350f", fg: "#fef3c7", label: "RKT" };
  return { bg: "#475569", fg: "#fff", label: "?" };
}

// Tam müşteri adı → kısa gösterim
export function shortName(fullName) {
  if (!fullName) return "";
  if (fullName.includes("ASELSAN")) return "Aselsan Konya";
  if (fullName.includes("ROKETSAN")) return "Roketsan";
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

// UI filtre butonları — ana hesap kodları.
// Backend TRACKED_CUSTOMER_PREFIXES ile eşleşmeli (functions/parsers.js:1199).
export const KNOWN_CUSTOMERS = [
  { code: "120-0107", shortLabel: "ASL" },
  { code: "120-116",  shortLabel: "RKT" },
];
