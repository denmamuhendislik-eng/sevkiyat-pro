// Yapılabilirlik → Teklif dönüştürme helper'ı (Faz Y-5).
//
// Onaylı bir feasibility study'yi Yeni Teklif form'unun anlayacağı
// initialQuote payload'ına çevirir. Tek study → tek kalem, birden fazla
// study (aynı müşteri) → çok kalemli tek teklif (Faz F4, 2026-07-21).

// Bir study → tek line objesi (NewQuoteView'ın beklediği yapı)
function studyToLine(study) {
  // Sadece operations.details üzerinden makine bazlı aktarım — her satır tezgah seçimli.
  // Tezgah seçilmemiş satır (name boş) filtrelenir; boş makine ratePerMin=0 ile teklife
  // düşmemesi için: tezgah seçilmezse o satır aktarılmaz.
  const opsDetails = Array.isArray(study.operations?.details) ? study.operations.details.filter(d => d.machine) : [];
  const machines = opsDetails.map(d => ({
    name: String(d.machine || "").trim(),
    timeMin: Number(d.minutes) || 0,
    ratePerMin: 0, // NewQuoteView machineRatesData'dan isim eşleşmesiyle otomatik doldurur
  }));

  // Fason: parça başına varsayımı — quantity=0 → quoteCalc.js:110 parça qty
  // fallback'i devreye girer. Yapılabilirlik UI'sinde artık kalem qty
  // sorulmuyor (her fason parça-başı). Batch-based nadir istisna teklif
  // ekranında (NewQuoteView fason satırı) qty override edilebilir.
  const fasonWorks = (study.fasonItems || []).map(it => ({
    name: String(it.name || "").trim(),
    unitPriceTl: Number(it.unitCost) || 0,
    quantity: 0,
  }));

  const toolingTotal = (study.toolingItems || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);
  const toolingDescription = (study.toolingItems || []).length > 0
    ? "Aparat/Takım/Model/Ölçme (yapılabilirlik toplamı — " + study.toolingItems.length + " kalem)"
    : "";

  return {
    stockCode: study.stockCode || study.partNo || "",
    musteriKodu: study.musteriKodu || "",
    stockName: study.partName || "",
    quantity: Number(study.quantity) || 1,
    // Parti büyüklüğü (opsiyonel) — marj bracket'i bu değerden bakılır.
    // 0/boş ise quoteCalc quantity'ye fallback eder.
    batchSize: Number(study.batchSize) || 0,
    unit: "ADET",
    materialType: study.materialType || "",
    dimensions: {
      en: Number(study.dimensions?.en) || 0,
      boy: Number(study.dimensions?.boy) || 0,
      uzunluk: Number(study.dimensions?.uzunluk) || 0,
    },
    weightKg: Number(study.weightKg) || 0,
    machines,
    fasonWorks,
    specialToolCost: toolingTotal,
    specialToolMode: "spread",
    specialToolDescription: toolingDescription,
    overrides: {},
    term: "",
    technicalNote: study.recommendations || "",
    fromLibrary: false,
    fromFeasibility: true,
    sourceFeasibilityNo: study.studyNo, // hangi study'den geldiği line üstünde kalır
  };
}

// Tek study — backward-compat wrapper
export function feasibilityToQuotePayload(study) {
  if (!study) return null;
  return feasibilityStudiesToQuotePayload([study]);
}

// Çoklu study → tek teklif payload'ı. Aynı müşteri şartıdır.
// Her study'ye ait line ayrı ayrı üretilir, hepsi tek quote lines[] içine dizilir.
// Müşteri bilgisi ilk study'den alınır; not / feasibilityNo alanları birleştirilir.
export function feasibilityStudiesToQuotePayload(studies) {
  const list = Array.isArray(studies) ? studies.filter(Boolean) : [];
  if (list.length === 0) return null;
  const first = list[0];
  const lines = list.map(studyToLine);
  // Not: Yapılabilirlik bağlantı bilgisi feasibilityNo/feasibilityNos alanlarında
  // takip ediliyor (UI'da yeşil banner + list badge). notes'a otomatik metin
  // basmayız — PDF çıktısı temiz kalsın; kullanıcı isterse elle yazar.
  return {
    feasibilityNo: first.studyNo,
    feasibilityNos: list.map(s => s.studyNo),
    // Müşteri (aynı olmalı — çağıran taraf doğrular)
    customerName: first.customerName || "",
    customerPhone: first.customerContact || "",
    customerEmail: first.customerEmail || "",
    quoteDate: new Date().toISOString().slice(0, 10),
    lines,
    notes: "",
    source: "from-feasibility",
  };
}
