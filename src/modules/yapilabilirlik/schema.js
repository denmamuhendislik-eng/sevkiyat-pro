// Yapılabilirlik form şeması — FR-71.1 (Proje) + FR-71.2 (Ürün) birleşik.
// Excel formuyla birebir eşleşen alanlar ve default değerler.

// FR-71.1 — 12 madde yapılabilirlik değerlendirme soruları
export const EVALUATION_QUESTIONS = [
  { key: "canMeetDemands",       label: "Şirketin imkanları müşteri taleplerini karşılıyor mu?" },
  { key: "needsInvestment",      label: "Ek yatırım gerekiyor mu?" },
  { key: "hasCapacity",          label: "Yeterli kapasite ve imkanlar mevcut mu?" },
  { key: "companyBenefit",       label: "Şirkete getireceği ilerleme ve katkı payı var mı?" },
  { key: "materialSupply",       label: "Malzeme ve yan ürünleri temin edebilme imkanı" },
  { key: "shipmentTerms",        label: "Sevkiyat ve teslimat şartları belirlenmiş mi?" },
  { key: "specialCharacteristics", label: "Özel karakteristikler belirlenmiş mi?" },
  { key: "paymentTerms",         label: "Ödeme koşulları açık bir şekilde belirlenmiş mi?" },
  { key: "qmsRequirements",      label: "Kalite Yönetim Sistemi gereklilikleri belirlenmiş mi?" },
  { key: "technicalDocs",        label: "Gerekli teknik dokümanlar ve standartlar temin edilebilmiş mi?" },
  { key: "quoteValidityPeriod",  label: "Teklifin geçerlilik süresi belirlenmiş mi?" },
  { key: "contractDisputes",     label: "Sözleşmeden kaynaklanabilecek ihtilaflar durumunda çözüm belirlenmiş mi?" },
];

// FR-71.2 — Ürün detayı satırında 4 boyut
export const PRODUCT_DIMENSIONS = [
  { key: "fixture",     label: "Yeni Aparat İhtiyacı",       costLabel: "Aparat birim maliyet" },
  { key: "specialTool", label: "Özel Takım İhtiyacı",         costLabel: "Takım birim maliyet" },
  { key: "measurement", label: "Yeni Ölçme Ekipman İhtiyacı", costLabel: "Ölçme ekipmanı birim maliyet", hasSourceType: true },
  { key: "fason",       label: "Üretim Fason İşleme İhtiyacı", costLabel: "Fason birim maliyet", hasSourceType: true },
];

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
    partNo: "",
    partName: "",
    material: "",
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
    // Ürün detayı (FR-71.2 — çoklu satır)
    productDetails: [
      // { no, partCode, partName,
      //   fixture: "yes"|"no", fixtureUnitCost,
      //   specialTool: "yes"|"no", specialToolUnitCost,
      //   measurement: "yes"|"no", measurementUnitCost, measurementSourceType: "direct"|"outsource",
      //   fason: "yes"|"no", fasonUnitCost, fasonSourceType: "direct"|"outsource" }
    ],
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
