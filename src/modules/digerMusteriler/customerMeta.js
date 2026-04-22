// Müşteri kodu → rozet rengi + kısa etiket (prototip v2'den)
export function customerBadge(code) {
  if (code === "120-0107") return { bg: "#1e293b", fg: "#f1f5f9", label: "ASL" };
  if (code === "120-116-1") return { bg: "#78350f", fg: "#fef3c7", label: "RKT" };
  if (code === "120-115") return { bg: "#064e3b", fg: "#d1fae5", label: "DNM" };
  return { bg: "#475569", fg: "#fff", label: "?" };
}

// Tam müşteri adı → kısa gösterim (prototip v2'den)
export function shortName(fullName) {
  if (!fullName) return "";
  if (fullName.includes("ASELSAN")) return "Aselsan Konya";
  if (fullName.includes("ROKETSAN")) return "Roketsan";
  if (fullName.includes("DENMA")) return "Denma Dış Ticaret";
  return fullName.slice(0, 30);
}

// Bilinen müşteri kodları — UI'da filter butonları için
export const KNOWN_CUSTOMERS = [
  { code: "120-0107", shortLabel: "ASL" },
  { code: "120-115", shortLabel: "DNM" },
  { code: "120-116-1", shortLabel: "RKT" },
];
