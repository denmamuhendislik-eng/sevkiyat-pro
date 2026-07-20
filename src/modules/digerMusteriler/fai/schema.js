// FAI (First Article Inspection) — SAE AS9102 uyumlu form şeması.
// FR-57 FAI FORMU Rev01 birebir eşleşen alanlar.
//
// 3 form birleşik tutulur — tek FAI kaydı içinde form1, form2, form3.

// ============================================================
// FORM 1 — Parça Numarası Nitelikleri (Part Number Accountability)
// ============================================================
// Zorunlu alanlar (sarı): 1, 2, 4, 9, 10, 13, 14, 19
// Şarta bağlı (mavi): 3, 5, 6, 7, 8, 15, 16, 17
// Opsiyonel (beyaz): 11, 12, 18, 21, 22, 23, 24

export const FORM1_FIELDS = {
  // Kapak (1-4) — tüm formlarda ortak
  partNumber:       { no: 1,  label: "Parça/Ürün Numarası",       required: "always" },
  partName:         { no: 2,  label: "Parça/Ürün Tanımı",          required: "always" },
  serialNumber:     { no: 3,  label: "Seri Numarası",              required: "conditional" },
  fairNumber:       { no: 4,  label: "FAI Rapor Numarası",         required: "always" },
  // Parça bilgisi
  partRevision:     { no: 5,  label: "Parça/Ürün Revizyonu",       required: "conditional" },
  drawingNumber:    { no: 6,  label: "Çizim/Doküman Numarası",     required: "conditional" },
  drawingRevision:  { no: 7,  label: "Çizim/Doküman Revizyonu",    required: "conditional" },
  additionalChanges:{ no: 8,  label: "Ek Değişiklikler",           required: "conditional" },
  // İş & tedarikçi
  manufacturingOrderNo:{ no: 9,  label: "Üretim İş Emri Numarası", required: "always" },
  organizationName: { no: 10, label: "Firma Adı",                  required: "always" },
  supplierCode:     { no: 11, label: "Tedarikçi Kodu",             required: "optional" },
  customerPoNumber: { no: 12, label: "Müşteri Sipariş Numarası",   required: "optional" },
  // FAI türü
  detailOrAssembly: { no: 13, label: "Alt Parça / Takım",          required: "always" }, // "detail" | "assembly"
  faiType:          { no: 14, label: "Tam / Kısmi FAI",            required: "always" }, // "full" | "partial"
  previousFairNumber:{ no: null, label: "Önceden FAI yapılmış Parça No", required: "conditional" }, // 14 altı
  partialFaiReason: { no: null, label: "Kısmi FAI Gerekçesi",      required: "conditional" }, // 14 altı
  // Alt bileşenler (15-18) — array olarak tutulur, montaj FAI için
  subComponents:    { no: "15-18", label: "Alt Bileşen Listesi", type: "array" },
  // İmzalar (19-28)
  preparedBy:       { no: 19, label: "Hazırlayan",  required: "always" },
  preparedByDate:   { no: 20, label: "Tarih",       required: "always" },
  reviewedBy:       { no: 21, label: "Onaylayan",   required: "optional" },
  reviewedByDate:   { no: 22, label: "Tarih",       required: "optional" },
  customerApprovedBy:{ no: 23, label: "Müşteri Onayı", required: "optional" },
  customerApprovalDate:{ no: 24, label: "Tarih",    required: "optional" },
};

// ============================================================
// FORM 2 — Ürün Nitelikleri (Hammadde / Özel İşlem / Fonksiyonel Test)
// ============================================================
// Zorunlu (sarı): 1, 2, 4, 14, 15
// Şarta bağlı (mavi): 3, 5, 6, 8, 9, 10
// Opsiyonel: 7, 13

export const FORM2_ITEM_FIELDS = {
  // Her satır (materyal veya özel işlem):
  materialOrProcessName:  { no: 5,  label: "Malzeme ya da Süreç Adı",       required: "conditional" },
  specificationNumber:    { no: 6,  label: "Spesifikasyon Numarası",         required: "conditional" },
  code:                   { no: 7,  label: "Kodu",                           required: "optional" },
  supplier:               { no: 8,  label: "Tedarikçi",                      required: "conditional" },
  customerApprovalVerification: { no: 9, label: "Müşteri Onayı (Var/Yok)", required: "conditional" },
  certificateNumber:      { no: 10, label: "Uygunluk Belgesi Numarası",     required: "conditional" },
  // Fonksiyonel test
  functionalTestProcedureNo: { no: 11, label: "İşlevsel Test Prosedürü No", required: "optional" },
  acceptanceReportNo:     { no: 12, label: "Kabul Raporu Numarası",         required: "optional" },
};

// ============================================================
// FORM 3 — Karakteristik Nitelikler (her ölçüm için satır)
// ============================================================
// Zorunlu (sarı): 1, 2, 4, 5, 8, 9, 12, 13

export const FORM3_CHARACTERISTIC_FIELDS = {
  characteristicNo:    { no: 5,  label: "Karakteristik No",             required: "always" },
  referenceLocation:   { no: 6,  label: "Referans Bölgesi (çizim sf)",  required: "optional" },
  characteristicType:  { no: 7,  label: "Karakteristik Özellik Türü",   required: "conditional" }, // kritik/major vb.
  requirement:         { no: 8,  label: "Gereksinim (nominal + tol)",   required: "always" },
  results:             { no: 9,  label: "Ölçüm Sonuçları",              required: "always" },
  specialToolId:       { no: 10, label: "Özel Ölçüm Alet ID",           required: "conditional" },
  nonconformanceNumber:{ no: 11, label: "Uygunsuzluk Numarası",         required: "conditional" },
};

// ============================================================
// Enum'lar
// ============================================================

export const DETAIL_OR_ASSEMBLY_OPTIONS = [
  { key: "detail",   label: "Alt Parça (Detail Part)" },
  { key: "assembly", label: "Takım / Montaj (Assembly)" },
];

export const FAI_TYPE_OPTIONS = [
  { key: "full",    label: "Tam FAI (Full)" },
  { key: "partial", label: "Kısmi FAI (Partial / Delta)" },
];

export const CUSTOMER_APPROVAL_OPTIONS = [
  { key: "yes", label: "Var" },
  { key: "no",  label: "Yok" },
];

// Karakteristik türleri (Form 3 Alan 7)
export const CHARACTERISTIC_TYPES = [
  { key: "critical",        label: "Kritik" },
  { key: "major",           label: "Major" },
  { key: "minor",           label: "Minor" },
  { key: "flightSafety",    label: "Uçuş Güvenliği" },
  { key: "keyCharacteristic", label: "Anahtar Karakteristik" },
  { key: "other",           label: "Diğer" },
];

// FAI durum akışı
//   draft            → taslak, düzenlenebilir
//   prepared         → hazırlayan imzaladı, onay bekliyor
//   approved         → onaylayan imzaladı, müşteriye gönderilmeye hazır (dahili onaylı)
//   submitted        → müşteriye gönderildi
//   customerApproved → müşteri onayladı → seri üretim serbest
//   rejected         → müşteri reddetti / düzeltici gerekli
export const FAI_STATUSES = [
  { key: "draft",            label: "📝 Taslak",              color: "#78716c", bg: "#f5f5f4" },
  { key: "prepared",         label: "⏳ Onay Bekliyor",       color: "#92400e", bg: "#fef3c7" },
  { key: "approved",         label: "✅ Dahili Onaylı",       color: "#166534", bg: "#dcfce7" },
  { key: "submitted",        label: "📤 Müşteriye Gönderildi", color: "#1e40af", bg: "#dbeafe" },
  { key: "customerApproved", label: "🎉 Müşteri Onayladı",    color: "#166534", bg: "#f0fdf4" },
  { key: "rejected",         label: "❌ Reddedildi",          color: "#991b1b", bg: "#fee2e2" },
];

// ============================================================
// Roller (İmzalar için)
// ============================================================
// Prosedür: Hazırlayan = Kalite Kontrol Sorumlusu
//           Onaylayan  = Kalite Yöneticisi / Genel Müdür
//           Müşteri Onayı = harici (portal onayı — sistem sadece kayıt tutar)

export const FAI_ROLES = [
  { key: "preparedBy",         label: "Hazırlayan (Kalite Kontrol)" },
  { key: "reviewedBy",         label: "Onaylayan (Kalite Yöneticisi)" },
  { key: "customerApprovedBy", label: "Müşteri Onayı" },
];

// Kalite Kontrol için Diğer Müşteriler'de bir flag yok — canEdit yeterli (Kalite + Üretim + Satış)

// ============================================================
// Alt bileşen belge kategorileri (Form 1 alt parça listesi için)
// COC alt bileşen sistemi ile aynı — yeniden kullanılır
// ============================================================

// Boş bir FAI kaydı — Yeni FAI açılışında başlangıç
export function makeEmptyFai(faiNo) {
  return {
    faiNo: faiNo || "",
    createdAt: null,
    updatedAt: null,

    // === FORM 1 ===
    partNumber: "",
    partName: "",
    serialNumber: "",
    fairNumber: "",             // FAI Rapor No (formda 4. alan) — genelde faiNo ile aynı
    partRevision: "",
    drawingNumber: "",
    drawingRevision: "",
    additionalChanges: "",
    manufacturingOrderNo: "",
    organizationName: "DENMA Mühendislik Mak. Otom. İnş. San. Tic. Ltd. Şti.",
    supplierCode: "",
    customerPoNumber: "",
    detailOrAssembly: "detail",
    faiType: "full",
    previousFairNumber: "",
    partialFaiReason: "",
    subComponents: [],          // [{ partNumber, partName, serialNumber, fairNumber }]

    // === FORM 2 ===
    materialsAndProcesses: [],  // [{ materialOrProcessName, specificationNumber, code, supplier, customerApprovalVerification, certificateNumber, ... }]
    functionalTests: [],        // [{ procedureNumber, procedureRevision, acceptanceReportNo }]
    form2Comments: "",

    // === FORM 3 ===
    characteristics: [],        // [{ characteristicNo, referenceLocation, characteristicType, requirement, results, specialToolId, nonconformanceNumber }]
    form3Comments: "",

    // Ekler / Belgeler (Storage path'leri)
    attachments: {
      balloonedDrawing: null,   // Balonlu resim (Form 3 için)
      materialCertificates: [], // [{ path, name, size, uploadedAt }]
      testReports: [],
      productionDocs: [],       // rota, iş talimatı vb.
      nonconformanceDocs: [],
      customerApprovalLetter: null, // Müşteri onay yazısı (portal ekran görüntüsü/PDF)
      other: [],
    },

    // === İMZALAR ===
    signatures: {}, // { [roleKey]: { signedAt, signedBy, signedRoleLabel } }

    // === Durum ===
    status: "draft",
    statusHistory: [], // [{ from, to, at, by }]
    customerApprovalDate: null,
    customerApprovalNote: "",

    // === Bağlantılar ===
    linkedFeasibilityNo: null,  // yapılabilirlikten oluşturulmuşsa
    stockCode: "",              // cocParts.parts key'i (parça master bağlantısı)

    // === Müşteri bilgisi ===
    customerCode: "",
    customerName: "",

    // === Meta ===
    source: "ui",
  };
}
