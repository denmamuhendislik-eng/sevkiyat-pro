// Uygunluk Belgesi (COC) alt bileşen yönetimi — helper'lar.
//
// Amacı: Montajlı bir parçanın COC'unu üretirken alt bileşenleri
// (make/buy) tespit edip her biri için belge durumunu takip etmek.
//
// Kaynak öncelik zinciri:
//   1) cocCertificates[certNo].subComponents  (belirli COC'a özel snapshot)
//   2) bomModels[stokKodu].parts              (yüklü BOM ağacı — otomatik)
//   3) cocParts.parts[stokKodu].manualSubComponents (elle girilmiş master)
//   4) hiçbiri yoksa → boş, UI kullanıcıya BOM yükle veya manuel ekle önerir

// Standart bağlantı elemanı keyword'leri — bunlar için default COC gerekmez.
// Kullanıcı override edebilir (cocParts.parts[sk].requiresCoc: true).
export const STANDARD_FASTENER_KEYWORDS = [
  "CIVATA", "SOMUN", "HELICOIL", "PUL", "RONDELA",
  "SEGMAN", "SEGAN", "PIN", "VIDA", "SAPLAMA",
  "TAPA", "TIRTIR", "SETASKUR", "SET ASKUR",
  "YAY PUL", "RIVETLI", "RIVET", "PERNO",
];

// Sadece stok adına bakar. false pozitif riskini kabul ediyoruz —
// kullanıcı requiresCoc: true ile override edebilir.
export function isStandardFastener(stokAdi) {
  if (!stokAdi) return false;
  const s = String(stokAdi).toLocaleUpperCase("tr-TR");
  return STANDARD_FASTENER_KEYWORDS.some(kw => s.includes(kw));
}

// COC gerekli mi? cocParts.parts[sk].requiresCoc'ye bakar:
//   true  → hep gerekli (heuristic yoksayılır)
//   false → hep atla
//   null / undefined → heuristik uygula (standart bağlantı elemanı → gerekmez)
export function requiresCocEffective(subComponent, cocParts) {
  const partMaster = cocParts?.parts?.[subComponent.stokKodu];
  if (partMaster?.requiresCoc === true) return true;
  if (partMaster?.requiresCoc === false) return false;
  return !isStandardFastener(subComponent.stokAdi);
}

// bomModels'daki bir root için alt bileşenleri (level > 0, supplyType !== "hammadde")
// düz array olarak döndürür. Level bilgisi UI'da hiyerarşi göstermek için tutulur.
export function extractSubComponentsFromBom(bomModel) {
  if (!bomModel || !Array.isArray(bomModel.parts)) return [];
  const out = [];
  for (const p of bomModel.parts) {
    if (!p || !p.stockCode) continue;
    if ((Number(p.level) || 0) === 0) continue; // root
    // Hammadde'yi atla — ana parçanın hammadde sertifikası zaten ayrı bir kanal
    const sType = String(p.supplyType || "").toLowerCase();
    if (sType === "hammadde") continue;
    out.push({
      stokKodu: p.stockCode,
      stokAdi: p.stockName || "",
      level: Number(p.level) || 0,
      qty: Number(p.qty) || 0,
      unit: p.unit || "AD",
      supplyType: sType || "make", // buy | make (fason vs. dahil değil, üst seviye)
      source: "bom",
    });
  }
  return out;
}

// cocParts.parts[sk].manualSubComponents — kullanıcının elle girdiği liste.
// Aynı format: { stokKodu, stokAdi, qty, unit, supplyType, level? }
export function extractSubComponentsFromMasterManual(stokKodu, cocParts) {
  const list = cocParts?.parts?.[stokKodu]?.manualSubComponents;
  if (!Array.isArray(list)) return [];
  return list.map(x => ({
    stokKodu: String(x.stokKodu || "").trim(),
    stokAdi: String(x.stokAdi || "").trim(),
    level: Number(x.level) || 1,
    qty: Number(x.qty) || 0,
    unit: x.unit || "AD",
    supplyType: String(x.supplyType || "make").toLowerCase(),
    source: "manual",
  })).filter(x => x.stokKodu);
}

// Ana çözüm fonksiyonu — hangi kaynak varsa onu döndürür.
//
// Öncelik:
//   1) certificateSubComponents varsa (var olan bir COC'un audit snapshot'ı) → onu döndür
//   2) bomModels'dan çekilebilirse → oradan
//   3) cocParts'daki manuel liste → oradan
//   4) yoksa → boş array + source: "none"
export function resolveSubComponents({ stokKodu, bomModels, cocParts, certificateSubComponents = null }) {
  if (Array.isArray(certificateSubComponents) && certificateSubComponents.length > 0) {
    return { list: certificateSubComponents, source: "certificate" };
  }
  const bomModel = bomModels?.[stokKodu];
  const fromBom = bomModel ? extractSubComponentsFromBom(bomModel) : [];
  if (fromBom.length > 0) {
    return { list: fromBom, source: "bom" };
  }
  const fromManual = extractSubComponentsFromMasterManual(stokKodu, cocParts);
  if (fromManual.length > 0) {
    return { list: fromManual, source: "manual" };
  }
  return { list: [], source: "none" };
}

// UI için: alt bileşenleri "COC gerektirir" ve "standart bağlantı elemanı"
// olarak ikiye ayır. Standart olanlar default gizlenir; kullanıcı [Göster]
// derse görünür.
export function classifySubComponents(list, cocParts) {
  const required = [];
  const standard = [];
  for (const item of list || []) {
    if (requiresCocEffective(item, cocParts)) required.push(item);
    else standard.push(item);
  }
  return { required, standard };
}

// Belge tipleri — buy/make farkı kaldırıldı (2026-07-21).
// Buy alt bileşenlere de MAKE ile aynı 3 belge yüklenir. Tedarikçi COC belgesi
// (varsa) ölçüm raporu kategorisi altına yüklenir; ayrı kategori kalmadı.
export const DOC_TYPES = ["hammaddeSertifikasi", "olcumRaporu", "fasonSertifikasi"];
// Backward-compat için eski isimler (kod tabanında referans olursa) — hepsi aynı liste
export const DOC_TYPES_MAKE = DOC_TYPES;
export const DOC_TYPES_BUY = DOC_TYPES;

// Aynı alt bileşen stokKodu için kütüphane geçmişi: mevcut cocCertificates'tan
// aynı stokKodu'nun daha önce yüklenmiş belgelerini topla.
//
// Dönüş: [{ certNo, siraNo, orderNo, controlDate, docs: {category: {url, path, name}} }]
// En yeni COC önce, sadece bu category için belgesi olan cert'ler.
export function findHistoricalDocsForSubComponent(certificates, subStokKodu, category, { limit = 10, excludeCertNo = null } = {}) {
  if (!certificates || typeof certificates !== "object") return [];
  const results = [];
  for (const cert of Object.values(certificates)) {
    if (!cert?.certNo) continue;
    if (excludeCertNo && cert.certNo === excludeCertNo) continue;
    const subs = Array.isArray(cert.subComponents) ? cert.subComponents : [];
    for (const s of subs) {
      if (s?.stokKodu !== subStokKodu) continue;
      // Array veya tek obje — ikisini de destekle
      const files = getSubDocFiles(s, category);
      for (const doc of files) {
        if (!doc?.url || !doc?.path) continue;
        results.push({
          certNo: cert.certNo,
          siraNo: cert.siraNo || "1",
          orderNo: cert.orderNo || "",
          controlDate: cert.controlDateIso || cert.controlDate || "",
          parentStokKodu: cert.stokKodu || "",
          doc: {
            url: doc.url,
            path: doc.path,
            name: doc.name || "dosya.pdf",
            size: doc.size || 0,
            uploadedAt: doc.uploadedAt || "",
          },
        });
      }
    }
  }
  // En yeni önce
  results.sort((a, b) => (b.controlDate || "").localeCompare(a.controlDate || ""));
  return results.slice(0, limit);
}

// Alt bileşen belge kategorisi → Drive/COC master kategorisi eşleşmesi.
// searchCocDrive backend'i mevcut COC kategorilerini bekliyor (driveConfig.foldersByCategory).
// Alt bileşen için de aynı Drive klasörlerini yeniden kullanıyoruz — kullanıcının
// tanımladığı ayarları ikinci kez yapmaya gerek yok.
export const SUB_DOC_TO_DRIVE_CATEGORY = {
  hammaddeSertifikasi: "rawMaterialCert",
  olcumRaporu: "measurement",
  fasonSertifikasi: "surfaceTreatment",
};

// Buy/make farkı belge tipinde kalmadı — helper her zaman aynı listeyi döndürür.
export function docTypesForSupplyType(_supplyType) {
  return DOC_TYPES;
}

// Bir alt bileşen için ilgili belge kategorisindeki dosya listesini döndür.
// Backward-compat: eski kayıtlar tek obje ({url, path, ...}); yeni yapı array.
export function getSubDocFiles(subComponent, category) {
  const v = subComponent?.docs?.[category];
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return [v];
}

// Bir alt bileşenin tamam mı eksik mi durumu — subComponent.docs objesine bakar.
// Her doc türü için: hiç dosya yok → eksik, en az 1 dosya varsa o kategori tamam.
export function subComponentStatus(subComponent) {
  const need = docTypesForSupplyType(subComponent.supplyType);
  let have = 0;
  for (const k of need) {
    if (getSubDocFiles(subComponent, k).length > 0) have++;
  }
  if (have === 0) return { status: "missing", have: 0, need: need.length };
  if (have < need.length) return { status: "partial", have, need: need.length };
  return { status: "complete", have, need: need.length };
}

// Tüm liste için özet — kaç tamam, kaç eksik.
export function summarizeStatus(subComponents) {
  let complete = 0, partial = 0, missing = 0;
  for (const s of subComponents || []) {
    const st = subComponentStatus(s).status;
    if (st === "complete") complete++;
    else if (st === "partial") partial++;
    else missing++;
  }
  return { total: (subComponents || []).length, complete, partial, missing };
}
