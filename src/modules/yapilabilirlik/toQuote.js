// Yapılabilirlik → Teklif dönüştürme helper'ı (Faz Y-5).
//
// Onaylı bir feasibility study'yi Yeni Teklif form'unun anlayacağı
// initialQuote payload'ına çevirir. Tek kalem (line) üretilir çünkü
// yapılabilirlik tek parça için yapılıyor. Kullanıcı istese elle ek
// kalem ekleyebilir.

export function feasibilityToQuotePayload(study) {
  if (!study) return null;

  // Operasyonlar → machines array (name, timeMin, ratePerMin)
  // Detail varsa onu kullan; yoksa toplam süre + tek kutu makine
  const opsDetails = Array.isArray(study.operations?.details) ? study.operations.details.filter(d => d.machine) : [];
  let machines = [];
  if (opsDetails.length > 0) {
    machines = opsDetails.map(d => ({
      name: String(d.machine || "").trim(),
      timeMin: Number(d.minutes) || 0,
      ratePerMin: 0, // machineRatesData'dan otomatik dolar (NewQuoteView içinde)
    }));
  } else if (Number(study.operations?.totalMinutes) > 0) {
    // Tek toplam süre — makine adı boş, kullanıcı elle seçer
    machines = [{ name: "", timeMin: Number(study.operations.totalMinutes), ratePerMin: 0 }];
  }

  // Fason kalemleri → fasonWorks array
  const fasonWorks = (study.fasonItems || []).map(it => ({
    name: String(it.name || "").trim(),
    unitPriceTl: Number(it.unitCost) || 0,
    quantity: Number(it.qty) || 0,
  }));

  // Aparat/takım/model/ölçme toplamı → specialToolCost (Karar 2: tek satır)
  const toolingTotal = (study.toolingItems || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);
  const toolingDescription = (study.toolingItems || []).length > 0
    ? "Aparat/Takım/Model/Ölçme (yapılabilirlik toplamı — " + study.toolingItems.length + " kalem)"
    : "";

  // Line (kalem) obje — NewQuoteView'in beklediği yapı
  const line = {
    stockCode: study.stockCode || study.partNo || "",
    musteriKodu: study.musteriKodu || "",
    stockName: study.partName || "",
    quantity: Number(study.quantity) || 1,
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
    specialToolMode: "spread", // adete yay — default
    specialToolDescription: toolingDescription,
    overrides: {},
    term: "",
    technicalNote: study.recommendations || "",
    fromLibrary: false,
    fromFeasibility: true,
  };

  return {
    // Feasibility bilgi
    feasibilityNo: study.studyNo,
    // Müşteri
    customerName: study.customerName || "",
    customerPhone: study.customerContact || "",
    customerEmail: study.customerEmail || "",
    // Şu an için müşteri kodu ayrı field yok teklifde, name'e yeterli
    // Meta
    quoteDate: new Date().toISOString().slice(0, 10),
    lines: [line],
    // Diğer alanlar Yeni Teklif form'unun default state'iyle doldurulur
    notes: study.recommendations
      ? `Yapılabilirlik (${study.studyNo}) önerileri: ${study.recommendations}`
      : `Yapılabilirlik ${study.studyNo}'ten oluşturuldu`,
    source: "from-feasibility",
  };
}
