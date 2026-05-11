// Gider kategorisi → tezgah dağıtım kriteri akıllı eşleşmesi.
// 1. Önce kullanıcının daha önce kaydettiği mapping (savedMappings) → kullanıcı tercihi
// 2. Yoksa anahtar kelime tahmini
// 3. Yoksa default "machineCount" (eşit pay)

const KEYWORDS = [
  { weightKey: "power", words: ["elektrik"] },
  { weightKey: "area",  words: ["bina", "doğalgaz", "doğal gaz", "su giderleri", "su gideri", "kira", "ısıtma", "isitma", "aydınlatma"] },
  { weightKey: "amortization", words: ["makine", "demirbaş", "demirbas", "tamir", "bakım", "bakim", "amortisman"] },
];

// (savedMappings: { [code]: weightKey })
export function guessWeightKey(code, name, savedMappings) {
  // 1. Kullanıcı override
  if (savedMappings && savedMappings[code]) return { weightKey: savedMappings[code], source: "saved" };
  // 2. Anahtar kelime
  const txt = `${code || ""} ${name || ""}`.toLocaleLowerCase("tr-TR");
  for (const rule of KEYWORDS) {
    if (rule.words.some(w => txt.includes(w))) return { weightKey: rule.weightKey, source: "guess" };
  }
  // 3. Default
  return { weightKey: "machineCount", source: "default" };
}
