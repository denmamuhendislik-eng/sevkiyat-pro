// CMM Ölçüm Raporu (FR-92.1) PDF parser'ı.
// Denma standart formatı FR-92.1 için özel yazılmıştır.
// Text-layered PDF gerektirir (Mitutoyo/CMM native export). Taranmış PDF çalışmaz.
//
// pdfjs-dist ile PDF metin akışı çıkarılır; koordinat clustering ile kolonlar tespit edilir.
// FR-92.1 kolonları sabit: Eleman Adı | Datum | Sıra No | Sorgulama | Nominal | Ölçülen |
//                          Üst Tol | Alt Tol | Sapma | Sonuç
//
// Çıktı:
//   {
//     header: { partCode, cmmDevice, operationName, date, workOrderNo, preparedBy, approvedBy },
//     characteristics: [
//       { no, elementName, datum, toleranceName, nominal, actual,
//         tolPlus, tolMinus, deviation, resultStatus }
//     ],
//     rawText: "…"  (debug için)
//   }

import * as pdfjsLib from "pdfjs-dist";

// Vite worker URL — build sırasında worker asset olarak servis edilir.
// Ayrı bir dosyaya ihtiyacı olan pdfjs 4.x için standart yaklaşım.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// FR-92.1 kolon başlıkları (hem TR hem parantez içi EN destekli)
const COL_HEADERS = ["Eleman Adı", "Datum", "Sıra", "Sorgulama", "Nominal", "Ölçülen", "Üst Tol", "Alt Tol", "Sapma", "Sonuç"];

// Header alanı etiketleri → dönen key
const HEADER_LABELS = {
  "Parça Kodu": "partCode",
  "Parça Adı": "partName",
  "CMM Cihaz İsmi/Kodu": "cmmDevice",
  "Operasyon İsmi": "operationName",
  "Tarih": "date",
  "Is Emri/Parça No": "workOrderNo",
  "Hazırlayan": "preparedBy",
  "Onay": "approvedBy",
};

// PDF'ten tüm sayfaların text item'larını ({str, x, y, width, height, page}) çıkar.
async function extractTextItems(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const items = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    for (const it of textContent.items) {
      // transform = [a, b, c, d, e, f] — e=x, f=y (PDF koordinatı, sol alt origin)
      const [, , , , x, yPdf] = it.transform;
      // Sayfa başından y (üstten aşağı) — sıralama kolaylığı için
      const y = viewport.height - yPdf;
      items.push({
        str: it.str,
        x,
        y,
        width: it.width,
        height: it.height,
        page: pageNo,
      });
    }
  }
  return items;
}

// Y koordinatlarına göre satırlara grupla. tolerance px içindeki item'lar aynı satır.
function groupIntoRows(items, tolerance = 3) {
  const sorted = items.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const rows = [];
  let current = null;
  for (const it of sorted) {
    if (!it.str.trim()) continue;
    if (!current || it.page !== current.page || Math.abs(it.y - current.y) > tolerance) {
      current = { page: it.page, y: it.y, items: [it] };
      rows.push(current);
    } else {
      current.items.push(it);
    }
  }
  // Her satır içinde item'ları x'e göre sırala
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

// Kolon başlığı satırını bul — "Eleman Adı" ile "Sonuç" arasında birden çok başlık geçen satır.
function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i].items.map(it => it.str).join(" ");
    // "Eleman" "Sıra" "Nominal" "Ölçülen" "Sonuç" hepsinin geçtiği satır → başlık
    const hits = ["Eleman", "Sıra", "Nominal", "Ölçülen", "Sonuç"].filter(k => rowText.includes(k)).length;
    if (hits >= 4) return { index: i, row: rows[i] };
  }
  return null;
}

// Başlık satırındaki her kolonun x-merkez pozisyonunu tespit et.
// "Üst Tol." gibi iki kelimeli başlıklar için ilk-kelime x'i alınır (kolon sol sınırı yaklaşık).
function detectColumnCenters(headerRow) {
  const cols = {};
  const items = headerRow.items;
  // Basit yaklaşım: her kolonun bilinen anahtar kelimesini ara, x merkezini kaydet
  const map = {
    elementName: ["Eleman"],
    datum: ["Datum"],
    no: ["Sıra"],
    toleranceName: ["Sorgulama"],
    nominal: ["Nominal"],
    actual: ["Ölçülen"],
    tolPlus: ["Üst"],
    tolMinus: ["Alt"],
    deviation: ["Sapma"],
    resultStatus: ["Sonuç"],
  };
  for (const [key, kws] of Object.entries(map)) {
    for (const it of items) {
      if (kws.some(kw => it.str.includes(kw))) {
        cols[key] = { xStart: it.x, xCenter: it.x + it.width / 2 };
        break;
      }
    }
  }
  return cols;
}

// Bir data satırındaki item'ları kolon merkezlerine en yakın olanlarla eşleştir.
function mapRowToColumns(row, cols) {
  const out = {};
  const keys = Object.keys(cols);
  // Her item için en yakın kolon merkezi
  const buckets = {};
  for (const k of keys) buckets[k] = [];
  for (const it of row.items) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const k of keys) {
      const d = Math.abs(it.x + it.width / 2 - cols[k].xCenter);
      if (d < bestDist) { bestDist = d; bestKey = k; }
    }
    if (bestKey) buckets[bestKey].push(it.str);
  }
  for (const k of keys) out[k] = buckets[k].join(" ").trim();
  return out;
}

// Header alanlarını (Parça Kodu, İş Emri, vs.) satırlardan yakala.
// "Parça Kodu (Part Code)" gibi etiket + ":" + değer formu.
// PDF iki kolonlu (sol: Parça Kodu, sağ: Tarih), pdfjs join'lediğinde tek satırda
// birleşiyor. Bu yüzden ":" sonrası tüm satırı değil, bir sonraki label başlayana
// kadar olan kısmı almak lazım (yoksa "MM-9111-0751 Tarih (Date) : 12.07.2026"
// gibi bitişik iki kolon yakalanır → FAI parça kodu uyumsuzluk uyarısı yanlış tetiklenir).
const STOP_LABELS_FOR_VALUE = ["Parça Adı", "Parça Kodu", "CMM Cihaz", "Operasyon", "Tarih", "Is Emri", "İş Emri", "Hazırlayan", "Onay"];

function _trimAtNextLabel(value, currentLabel) {
  let out = value;
  for (const stop of STOP_LABELS_FOR_VALUE) {
    if (stop === currentLabel) continue;
    // "stop" kelimesinden ÖNCEKI whitespace ile ara — kelimenin ortasında match olmasın
    const idx = out.indexOf(stop);
    if (idx > 0) {
      // Bir önceki karakter whitespace mi kontrol et
      const before = out[idx - 1];
      if (/\s/.test(before)) {
        out = out.substring(0, idx).trim();
      }
    }
  }
  // "(Part Code)" gibi parantez içi İngilizce açıklama başta kalabilir → temizle
  out = out.replace(/^\(([^)]+)\)\s*/, "").trim();
  return out;
}

function extractHeader(rows) {
  const header = {};
  const rowTexts = rows.slice(0, 20).map(r => r.items.map(i => i.str).join(" "));
  for (const [label, key] of Object.entries(HEADER_LABELS)) {
    for (const text of rowTexts) {
      const idx = text.indexOf(label);
      if (idx === -1) continue;
      // Etiketten sonra ":" ara
      const after = text.substring(idx + label.length);
      const colonIdx = after.search(/[:：]/);
      if (colonIdx === -1) continue;
      const rawValue = after.substring(colonIdx + 1).trim();
      const trimmed = _trimAtNextLabel(rawValue, label);
      if (trimmed) { header[key] = trimmed; break; }
    }
  }
  return header;
}

// Data satırlarını çıkar — başlık satırından sonraki, "Sıra No" sütununda sayı olanlar
function extractCharacteristicRows(rows, headerIdx, cols) {
  const characteristics = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const mapped = mapRowToColumns(row, cols);
    const noStr = String(mapped.no || "").trim();
    const no = parseInt(noStr, 10);
    if (!Number.isFinite(no)) continue; // sıra no yoksa data satırı değil (footer, altbilgi)
    characteristics.push({
      no,
      elementName: mapped.elementName || "",
      datum: mapped.datum || "",
      toleranceName: mapped.toleranceName || "",
      nominal: mapped.nominal || "",
      actual: mapped.actual || "",
      tolPlus: mapped.tolPlus || "",
      tolMinus: mapped.tolMinus || "",
      deviation: mapped.deviation || "",
      resultStatus: (mapped.resultStatus || "").toUpperCase(),
    });
  }
  // Sıra no'ya göre sırala (multi-page kayması ihtimaline karşı)
  characteristics.sort((a, b) => a.no - b.no);
  return characteristics;
}

// Ana giriş fonksiyonu.
export async function parseMeasurementReport(file) {
  const items = await extractTextItems(file);
  const rows = groupIntoRows(items);
  const headerRes = findHeaderRow(rows);
  if (!headerRes) {
    throw new Error("Tablo başlığı bulunamadı — bu bir FR-92.1 CMM raporu değil ya da PDF metin katmanı içermiyor (taranmış olabilir).");
  }
  const cols = detectColumnCenters(headerRes.row);
  const missingKeys = ["no", "elementName", "nominal", "actual", "resultStatus"].filter(k => !cols[k]);
  if (missingKeys.length > 0) {
    throw new Error(`Beklenen kolonlar bulunamadı: ${missingKeys.join(", ")}. PDF şablonu FR-92.1 olmayabilir.`);
  }
  const characteristics = extractCharacteristicRows(rows, headerRes.index, cols);
  const header = extractHeader(rows);
  const rawText = rows.map(r => r.items.map(i => i.str).join(" ")).join("\n");
  return { header, characteristics, rawText };
}

// Yardımcı: karakteristik satırını FAI şemasına uygun objeye çevir (mevcut characteristics'e eklenir).
// requirement/results string'leri de birlikte üretilir → eski render kodu bozulmaz.
export function characteristicToFaiRow(c) {
  const nom = String(c.nominal || "").trim();
  const tp = String(c.tolPlus || "").trim();
  const tm = String(c.tolMinus || "").trim();
  const requirement = [
    c.elementName,
    c.toleranceName,
    nom && `Nominal ${nom}${tp || tm ? ` (+${tp || "0"}/-${tm ? tm.replace(/^-/, "") : "0"})` : ""}`,
  ].filter(Boolean).join(" · ");
  const results = [
    c.actual && `Ölçülen: ${c.actual}`,
    c.deviation && `Sapma: ${c.deviation}`,
    c.resultStatus && `[${c.resultStatus}]`,
  ].filter(Boolean).join(" ");
  return {
    characteristicNo: String(c.no),
    referenceLocation: "",
    characteristicType: "",
    requirement,
    results,
    specialToolId: "CMM",
    nonconformanceNumber: "",
    // Yapılandırılmış alanlar (Faz 2 şeması)
    elementName: c.elementName,
    datum: c.datum,
    toleranceName: c.toleranceName,
    nominal: c.nominal,
    actual: c.actual,
    tolPlus: c.tolPlus,
    tolMinus: c.tolMinus,
    deviation: c.deviation,
    resultStatus: c.resultStatus,
  };
}
