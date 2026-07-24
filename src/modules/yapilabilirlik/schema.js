// Yapılabilirlik form şeması — FR-71.1 (Proje) + FR-71.2 (Ürün) birleşik.
// Excel formuyla birebir eşleşen alanlar ve default değerler.

// FR-71.1 — Puanlı yapılabilirlik değerlendirme (2026-07-22 rev).
// 10 Satış+Proje sorusu (max 50 puan) + 5 Teknik soru (max 50 puan) = 100 üzerinden.
// Her sorunun cevap türü ("choice" veya "slider") ve puan mapping'i sabittir.
// Öneri bantları: ≥75 KABUL · 50-74 DEĞİŞİKLİK · <50 RED/GM
// %<50 durumunda GM imzası zorunlu (aksi halde teklife dönüşemez).

// Standart cevap seçenekleri
export const EVAL_CHOICES = [
  { key: "EVET",   label: "Evet",   color: "#166534" },
  { key: "HAYIR",  label: "Hayır",  color: "#991b1b" },
  { key: "KISMEN", label: "Kısmen", color: "#92400e" },
];

// SATIŞ VE PROJE — 10 soru, max 50 puan
export const SALES_QUESTIONS = [
  {
    key: "shipmentTerms",
    label: "Sevkiyat ve teslimat şartları belirlenmiş mi? Özel şart varsa belirtiniz.",
    dept: "sales", type: "choice",
    scoring: { EVET: 4, HAYIR: 2, KISMEN: 3 }, max: 4,
    hintOnLow: "Müşteri ile sevkiyat sorumluluğu ve teslim yeri (Incoterm, adres) net belirlensin.",
  },
  {
    key: "paymentTerms",
    label: "Ödeme koşulları belirlenmiş mi? Özel şart varsa belirtiniz.",
    dept: "sales", type: "choice",
    scoring: { EVET: 4, HAYIR: 2, KISMEN: 3 }, max: 4,
    hintOnLow: "Vade, avans, döviz kuru sabitleme gibi ödeme detayları müşteri ile netleştirilsin.",
  },
  {
    key: "deliveryDate",
    label: "Termin tarihleri belirlenmiş mi? Özel veya uygunsuz termin istenmişse belirtiniz.",
    dept: "sales", type: "choice",
    scoring: { EVET: 4, HAYIR: 2, KISMEN: 3 }, max: 4,
    hintOnLow: "Termin tarihi kapasite planına göre revize edilerek müşteri ile mutabık kalınsın.",
  },
  {
    key: "salesRisk",
    label: "Genel olarak satışa engel özel şart ve durum söz konusu mu? (Müşteri finansal durum, ödeme performansı, ağır kalite şartları vs.)",
    dept: "sales", type: "choice",
    scoring: { EVET: 0, HAYIR: 4, KISMEN: 2 }, max: 4, positive: "no",
    hintOnLow: "Müşteri finansal durum ve ağır kalite şartları için ek güvence (avans, sözleşme klozu) istenebilir.",
  },
  {
    key: "specialMaterial",
    label: "Özel hammadde ve diğer malzeme gereksinimi var mı? Varsa belirtiniz.",
    dept: "sales", type: "choice",
    scoring: { EVET: 1, HAYIR: 4, KISMEN: 2 }, max: 4, positive: "no",
    hintOnLow: "Özel hammadde tedarik süresi ve fiyat riski müşteriye yansıtılsın (teslim + fiyat şartı klozu).",
  },
  {
    key: "specialFason",
    label: "Özel ısıl işlem, kaplama, boya vb. fason işlem gereksinimi var mı? Varsa Fason bölümüne ekleyiniz.",
    dept: "sales", type: "choice",
    scoring: { EVET: 1, HAYIR: 4, KISMEN: 2 }, max: 4, positive: "no",
    hintOnLow: "Fason işleyici bulunabilirliği ve maliyeti teklif öncesi doğrulansın; termin buffer'ı eklensin.",
  },
  {
    key: "capacityEnough",
    label: "İş için mevcut kapasite yeterli mi?",
    dept: "sales", type: "choice",
    scoring: { EVET: 4, HAYIR: 0, KISMEN: 2 }, max: 4,
    hintOnLow: "Fason destek veya mesai artışı planlansın; müşteri ile daha esnek termin görüşülsün.",
  },
  {
    key: "extraInvestment",
    label: "İş için ileride veya hemen ek yatırım gerekir mi?",
    dept: "sales", type: "choice",
    scoring: { EVET: 1, HAYIR: 4, KISMEN: 2 }, max: 4, positive: "no",
    hintOnLow: "Yatırım maliyeti teklife yansıtılsın veya müşteri katkı payı görüşülsün.",
  },
  {
    key: "companyBenefit",
    label: "Şirkete getireceği ilerleme ve katkı payı var mı? Varsa belirtiniz.",
    dept: "sales", type: "choice",
    scoring: { EVET: 10, HAYIR: 0, KISMEN: 5 }, max: 10,
    hintOnLow: "Stratejik değer düşük — düşük kâr marjlı işse fırsat maliyeti değerlendirilsin.",
  },
  {
    key: "seriesFuture",
    label: "Seri imalatı olan veya başka işlerin önünü açacak bir proje mi? Gelecek vaat ediyor mu?",
    dept: "sales", type: "choice",
    scoring: { EVET: 8, HAYIR: 0, KISMEN: 4 }, max: 8,
    hintOnLow: "Tek seferlik iş — özel yatırım ve aparat maliyeti tam olarak bu teklife yüklensin.",
  },
];

// TEKNİK — 5 soru, max 50 puan (4 choice + 1 slider)
export const TECHNICAL_QUESTIONS = [
  {
    key: "machineParkOk",
    label: "Talaşlı imalat için tezgah parkuru yeterli mi? (X-Y-Z limitleri, güç, devir, ilerleme, eksen sayısı vb.)",
    dept: "technical", type: "choice",
    scoring: { EVET: 10, HAYIR: 0, KISMEN: 5 }, max: 10,
    hintOnLow: "Alternatif tezgah kombinasyonu veya fason destek planlansın; termin buffer'ı eklensin.",
  },
  {
    key: "needSpecialTool",
    label: "Talaşlı imalat için özel aparat, takım, tutucu vs. gerekli mi? Varsa aşağıda listeye ekleyiniz.",
    dept: "technical", type: "choice",
    scoring: { EVET: 4, HAYIR: 10, KISMEN: 7 }, max: 10, positive: "no",
    hintOnLow: "Özel aparat maliyeti + tedarik süresi teklife eklensin; ilk parça FAI süresi göz önünde bulundurulsun.",
  },
  {
    key: "unmeasurable",
    label: "Talaşlı imalat sırasında ve sonrasında ölçülemeyen ölçü, sağlanamayacak teknik detay var mı?",
    dept: "technical", type: "choice",
    scoring: { EVET: 0, HAYIR: 10, KISMEN: 5 }, max: 10, positive: "no",
    hintOnLow: "Müşteri ile ölçüm yöntemi/toleransı yeniden görüşülsün veya feragat notu alınsın.",
  },
  {
    key: "criticalTolerance",
    label: "Özel toleranslar, kritik ölçüler, hassas yüzey pürüzlülük vb. durumlar var mı?",
    dept: "technical", type: "choice",
    scoring: { EVET: 4, HAYIR: 10, KISMEN: 7 }, max: 10, positive: "no",
    hintOnLow: "Kritik ölçüler için ek ölçüm ekipmanı ve zaman planlansın; ıskarta payı maliyete eklensin.",
  },
  {
    key: "overallTechnical",
    label: "Genel olarak teknik şartları yerine getirebilmek için karşılaşılması muhtemel durumlar (ölçü/konum toleransları, işleme süresi, aparat, takım ömrü, ayar süresi, kalite kontrol ihtiyacı, muhtemel hammadde problemi) yönünden puanlayınız.\nNot: 0 çok zor, 10 en kolay.",
    dept: "technical", type: "slider", min: 0, max: 10,
    hintOnLow: "Zorluk yüksek — deneme parça planı, ek ölçüm turu ve teknik risk primi teklife eklensin.",
  },
];

// Tüm sorular (uyumluluk + döngü için)
export const EVALUATION_QUESTIONS = [...SALES_QUESTIONS, ...TECHNICAL_QUESTIONS];

// Bölüm bazlı maksimum puan
export const SALES_MAX = SALES_QUESTIONS.reduce((s, q) => s + (q.max || 0), 0);       // 50
export const TECHNICAL_MAX = TECHNICAL_QUESTIONS.reduce((s, q) => s + (q.max || 0), 0); // 50
export const TOTAL_MAX = SALES_MAX + TECHNICAL_MAX; // 100

// Departmanlar — accordion başlıkları (2 grup)
export const EVALUATION_DEPARTMENTS = [
  { key: "sales",     label: "Satış ve Proje",  icon: "💼", color: "#1e40af", bg: "#eff6ff", roleKey: "salesManager",  max: SALES_MAX },
  { key: "technical", label: "Teknik Birim",     icon: "⚙️", color: "#0f766e", bg: "#f0fdfa", roleKey: "technicalUnit", max: TECHNICAL_MAX },
];

// Bir cevap için puan getir
export function scoreForAnswer(question, answer) {
  if (!question || answer == null || answer === "") return 0;
  if (question.type === "slider") {
    const n = Number(answer);
    if (!Number.isFinite(n)) return 0;
    return Math.max(question.min || 0, Math.min(question.max || 10, n));
  }
  const s = question.scoring || {};
  return Number(s[String(answer).toUpperCase()]) || 0;
}

// Bir bölüm için puan hesabı — { score, max, percent, answered }
function scoreForSection(questions, evaluation) {
  let score = 0, answered = 0;
  const max = questions.reduce((s, q) => s + (q.max || 0), 0);
  for (const q of questions) {
    const ans = evaluation?.[q.key]?.answer;
    if (ans != null && ans !== "") answered++;
    score += scoreForAnswer(q, ans);
  }
  const percent = max > 0 ? Math.round((score / max) * 100) : 0;
  return { score, max, percent, answered, total: questions.length };
}

// Tüm study için puanlama — Yapilabilirlik.jsx ve PDF için ortak kaynak
export function computeStudyScore(study) {
  const evaluation = study?.evaluation || {};
  const sales = scoreForSection(SALES_QUESTIONS, evaluation);
  const technical = scoreForSection(TECHNICAL_QUESTIONS, evaluation);
  const totalScore = sales.score + technical.score;
  const totalMax = sales.max + technical.max;
  const percent = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  return {
    sales, technical,
    totalScore, totalMax, percent,
  };
}

// Yüzdeye göre karar önerisi
export function getRecommendation(percent) {
  if (percent >= 75) {
    return { key: "accepted", label: "KABUL", color: "#166534", bg: "#dcfce7",
             description: "Puanlama yüksek — talep kabul edilebilir." };
  }
  if (percent >= 50) {
    return { key: "changesNeeded", label: "DEĞİŞİKLİK", color: "#92400e", bg: "#fef3c7",
             description: "Puanlama orta — müşteri ile müzakere ile şartlı kabul mümkün." };
  }
  return { key: "rejected", label: "RED / GM", color: "#991b1b", bg: "#fee2e2",
           description: "Puanlama düşük — teklife dönüşüm için GM onayı zorunlu." };
}

// Düşük puanlı cevaplar için müzakere ipuçları listesi (50-74 bandı ve altında faydalı)
export function getNegotiationHints(study) {
  const evaluation = study?.evaluation || {};
  const hints = [];
  for (const q of EVALUATION_QUESTIONS) {
    if (!q.hintOnLow) continue;
    const ans = evaluation?.[q.key]?.answer;
    if (ans == null || ans === "") continue;
    const score = scoreForAnswer(q, ans);
    const isFullScore = score >= (q.max || 0);
    if (!isFullScore) {
      hints.push({ questionKey: q.key, label: q.label, hint: q.hintOnLow, score, max: q.max });
    }
  }
  return hints;
}

// Kalem kategorileri — teklife aktarım için 2 grup:
//   tooling → aparat/kalıp/model/ölçme ekipmanı (hepsi birleşik, teklifte specialToolCost'a toplanır)
//   fason   → fason işleme kalemleri (teklifte fasonWorks'e ayrı ayrı eklenir)
export const ITEM_CATEGORIES = [
  {
    key: "tooling",
    label: "Aparat / Özel Takım / Model / Ölçme Ekipmanı",
    icon: "🛠",
    description: "Yeni aparat, özel takım, kalıp, model, ölçme ekipmanı vb. — teklife toplam olarak yansır",
  },
  {
    key: "fason",
    label: "Fason İşleme",
    icon: "🔥",
    description: "Isıl işlem, kaplama, boya, özel işleme vb. — teklife kalem bazlı yansır",
  },
];

// Eski PRODUCT_DIMENSIONS — geri uyumluluk için sabit tutuluyor (mevcut kayıtlar).
// Yeni formda kullanılmıyor.
export const PRODUCT_DIMENSIONS = [
  { key: "fixture",     label: "Yeni Aparat İhtiyacı",       costLabel: "Aparat birim maliyet" },
  { key: "specialTool", label: "Özel Takım İhtiyacı",         costLabel: "Takım birim maliyet" },
  { key: "measurement", label: "Yeni Ölçme Ekipman İhtiyacı", costLabel: "Ölçme ekipmanı birim maliyet", hasSourceType: true },
  { key: "fason",       label: "Üretim Fason İşleme İhtiyacı", costLabel: "Fason birim maliyet", hasSourceType: true },
];

// Kalem tedarik türü seçenekleri
export const SOURCE_TYPES = [
  { key: "direct",    label: "Direkt Temin" },
  { key: "outsource", label: "Fason / Dış Kaynak" },
];

// Boş bir kalem satırı (tooling veya fason için)
export function makeEmptyItem() {
  return {
    name: "",
    description: "",
    qty: 1,
    unitCost: 0,
    sourceType: "direct",
    supplier: "",
    deliveryDays: 0,
    note: "",
  };
}

// İş türü seçenekleri (FR-71.1 üst kısım)
export const WORK_TYPES = [
  { key: "new",    label: "Yeni Proje" },
  { key: "change", label: "Değişiklik Talebi" },
  { key: "other",  label: "Diğer" },
];

// Karar seçenekleri (FR-71.1 alt kısım)
export const DECISIONS = [
  { key: "accepted",       label: "Talep Karşılanır",           color: "#166534", bg: "#dcfce7" },
  { key: "rejected",       label: "Talep Karşılanamaz",         color: "#991b1b", bg: "#fee2e2" },
  { key: "changesNeeded",  label: "Değişiklik Yapmak Gerekir",  color: "#92400e", bg: "#fef3c7" },
];

// Gelen veri türü checkbox listesi
export const RECEIVED_DATA_TYPES = [
  { key: "mathModel",         label: "Matematik Model" },
  { key: "technicalDrawing",  label: "Teknik Resim" },
  { key: "sample",            label: "Numune Parça" },
  { key: "specifications",    label: "Şartnameler" },
  { key: "other",             label: "Diğer" },
];

// Boş bir yapılabilirlik objesi — Yeni Yapılabilirlik açılışında başlangıç
export function makeEmptyStudy(studyNo) {
  return {
    studyNo: studyNo || "",
    createdAt: null,
    updatedAt: null,
    // Kapak / Bilgi
    customerCode: "",
    customerName: "",
    customerContact: "",
    customerEmail: "",
    partNo: "",
    partName: "",
    stockCode: "",       // Sevkiyat Pro parça kütüphanesi kodu (aramadan gelir)
    musteriKodu: "",     // Müşterinin kendi parça kodu
    material: "",        // eski alan (backward-compat)
    // YENİ hammadde bloğu (Faz Y-3D)
    materialType: "",    // quoteMaterials.materials key (AL-6061 vb.)
    materialShape: "",   // DİKDÖRTGEN | SİLİNDİR | ALTIGEN | EBATSIZ
    dimensions: { en: 0, boy: 0, uzunluk: 0 },
    weightKg: 0,         // otomatik hesap veya manuel override
    quantity: 1,         // sipariş adedi (müşterinin toplam talebi)
    batchSize: 0,        // parti büyüklüğü — 0 ise quantity'ye eşit sayılır.
                         // Marj bracket'i bu değer üzerinden bulunur (fiyatlama).
                         // Üretim/malzeme maliyeti yine quantity üzerinden hesaplanır.
    customerQuoteNo: "",
    otherMaterials: "",
    otherQualityRequirements: "",
    shipmentAddress: "",
    receivedData: {}, // { mathModel: true, technicalDrawing: false, ... }
    receivedDataOther: "",
    revisionDate: "",
    workType: "new",
    workTypeOther: "",
    // İSTER tablosu (FR-71.1)
    demands: [
      // { demand, demandDetail, denmaAssessment, customerAssessment, note }
    ],
    // Değerlendirme (12 soru, EVET/HAYIR + açıklama)
    evaluation: {},
    // Ürün detayı (FR-71.2 — eski yapı, geri uyumluluk için, yeni kullanımda boş)
    productDetails: [],
    // YENİ (Faz Y-3A): kalem detay tabloları — teklife aktarım için ayrılmış
    // Her kalem: { name, description, qty, unitCost, sourceType, supplier, deliveryDays, note }
    toolingItems: [], // aparat/takım/model/ölçme — teklifte toplam olarak specialToolCost'a gider
    fasonItems: [],   // fason işleme — teklifte fasonWorks'e ayrı ayrı gider
    // Operasyon ve süre (Faz Y-3C — üretim / cad-cam için)
    operations: {
      count: 0,          // toplam operasyon sayısı
      totalMinutes: 0,   // toplam süre (dakika)
      details: [],       // opsiyonel: [{ operationName, machine, minutes }]
      note: "",
    },
    // Karar
    decision: null, // "accepted" | "rejected" | "changesNeeded"
    decisionNote: "",
    recommendations: "",
    // İmzalar — role bazlı
    signatures: {}, // { [roleKey]: { signedAt, signedBy, signedForRole, actualRole, isDelegate } }
    // Teklif bağlantısı
    linkedQuoteNo: null,
    convertedAt: null,
    // BOM'dan otomatik doldurma yapıldıysa (ileride)
    populatedFromBom: null, // bomStokKodu varsa
    // Meta
    source: "ui",
  };
}
