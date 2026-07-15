/**
 * quoteParser.js — Excel "Teklif Verme Son Versiyon" .xlsm parse edici.
 *
 * İki ana parse fonksiyonu:
 *   1. parseQuoteMasterData(workbook)   → master data (Veri + REFERANS sheet'lerinden)
 *   2. parseQuoteArchive(workbook)      → arşiv (Liste sheet'inden yıl bölünmüş)
 *
 * Excel yapısı (analiz edilmiş):
 *   Veri sheet:
 *     col 0-5:   Malzeme türü, cinsi (şekil), özgül ağırlık, $/kg, TL/kg, döviz kuru
 *     col 6-7:   Makine listesi + dk ücretleri (referans — asıl kaynak workCenters)
 *     col 8-9:   Fason işler + cinsi
 *     col 10-12: Firma adı + telefon + email
 *     col 13-17: Nakliye, ödeme şekli, döviz cinsi, birim, teklif tipi seçenekleri
 *     col 18:    Firma grup adı
 *     col 20-24: İşçilik ilave kâr marjı (vade × malzeme türü matrisi)
 *     col 27-28: Hammadde ilave kâr marjı (firma grubu bazlı)
 *
 *   REFERANS VERİLER sheet:
 *     col 1-3:   Miktar aralığı → işçilik % + malzeme/fason %
 *     col 0-1:   Stok listesi (Kod + Açıklama) — henüz teklif modülü için gerekli değil
 *
 *   Liste sheet:
 *     col 0-40:  Kaydedilmiş teklif kalemleri (Excel formunun sonuçları)
 *     Bir teklif = aynı "Teklif No"lu kalemlerin toplamı
 */

// ==================== HELPER ====================

function s(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function n(v) {
  if (v === undefined || v === null || v === "") return 0;
  // Türkçe virgül desteği: "46,89" → 46.89 (nokta zaten desteklenir)
  const str = String(v).replace(",", ".");
  const num = Number(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Excel serial date → ISO YYYY-MM-DD (basit)
 * 1900 tabanlı Excel serial'ı Date'e çevir. YYYYAA-NNN gibi string'ler olduğu gibi döner.
 */
function excelDateToIso(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Zaten YYYY-MM-DD veya DD.MM.YYYY formatındaysa dönüştür
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const dot = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dot) return `${dot[3]}-${String(dot[2]).padStart(2, "0")}-${String(dot[1]).padStart(2, "0")}`;
  // Serial number ise Excel epoch 1899-12-30
  const num = Number(s);
  if (Number.isFinite(num) && num > 30000 && num < 60000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  }
  return null;
}

// ==================== MASTER DATA PARSE ====================

function parseMaterials(veriRows) {
  const materials = {};
  let currencyRateUsd = 0;

  for (let i = 1; i < veriRows.length; i++) {
    const r = veriRows[i];
    const name = s(r[0]);
    if (!name || name === "0") continue;
    const shape = s(r[1]).toUpperCase();
    const density = n(r[2]);
    const priceUsdPerKg = n(r[3]);
    const priceTlPerKg = n(r[4]);
    if (materials[name]) continue; // duplicate

    materials[name] = {
      name,
      shape: shape || "DİKDÖRTGEN",
      density,
      priceUsdPerKg,
      priceTlPerKg,
      updatedAt: new Date().toISOString(),
    };

    // Döviz kuru satır 1'in col 5'inde ("281.34 TL / $6 = 46.89 gibi")
    if (i === 1) {
      const rate = n(r[5]);
      if (rate > 0) currencyRateUsd = rate;
    }
  }

  return { materials, currencyRateUsd };
}

function parseMachines(veriRows) {
  // Sadece referans — asıl kaynak workCenters. Ama Excel'de kayıtlı olanları da tut.
  const machines = {};
  for (let i = 1; i < veriRows.length; i++) {
    const r = veriRows[i];
    const name = s(r[6]);
    const rate = n(r[7]);
    if (!name || name === "Yeni Makine Gir" || name === "0") continue;
    if (machines[name]) continue;
    machines[name] = { name, refRatePerMinTl: rate };
  }
  return machines;
}

function parseFasonWorks(veriRows) {
  const works = [];
  const seen = new Set();
  for (let i = 1; i < veriRows.length; i++) {
    const r = veriRows[i];
    const name = s(r[8]);
    if (!name || name === "0") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const id = name.toLowerCase()
      .replace(/[çğıöşü]/g, (c) => ({ç:"c",ğ:"g",ı:"i",ö:"o",ş:"s",ü:"u"}[c] || c))
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    works.push({ id, name, defaultUnitPriceTl: null });
  }
  return works;
}

function parseOptions(veriRows) {
  // col 13: Nakliye, col 14: Ödeme Şekli, col 15: Döviz Cinsi, col 16: Birim, col 17: Teklif Tipi
  const nakliye = new Set();
  const odemeSekli = new Set();
  const dovizCinsi = new Set();
  const birim = new Set();
  const teklifTipi = new Set();

  for (let i = 1; i < veriRows.length; i++) {
    const r = veriRows[i];
    const nk = s(r[13]); if (nk && nk !== "0") nakliye.add(nk);
    const od = s(r[14]); if (od && od !== "0") odemeSekli.add(od);
    const dv = s(r[15]); if (dv && dv !== "0") dovizCinsi.add(dv);
    const br = s(r[16]); if (br && br !== "0") birim.add(br);
    const tt = s(r[17]); if (tt && tt !== "0") teklifTipi.add(tt);
  }

  return {
    nakliye: [...nakliye],
    odemeSekli: [...odemeSekli],
    dovizCinsi: [...dovizCinsi],
    birim: [...birim],
    teklifTipi: [...teklifTipi],
  };
}

function parseMaterialLaborMargins(veriRows) {
  // col 20-24 tablosu:
  //   Row 1 header:  '' | '' | '30 Gün Vade' | '60 Gün Vade' | '90 Gün Vade'
  //   Row 2 seed:    'AYLIK' | 0.05 | 'GRUP1' | 'GRUP2' | 'GRUP3'
  //   Row 3+:        '' | Malzeme adı | val30 | val60 | val90
  const map = {};
  for (let i = 3; i < veriRows.length; i++) {
    const r = veriRows[i];
    const matName = s(r[21]);
    if (!matName || matName === "0") continue;
    const v30 = n(r[22]);
    const v60 = n(r[23]);
    const v90 = n(r[24]);
    if (map[matName]) continue;
    map[matName] = { grup1: v30, grup2: v60, grup3: v90 };
  }
  return map;
}

function parseCustomerGroupMargins(veriRows) {
  // col 27-28:
  //   Row 1: 'Gruplar' | 'Kâr Marjları'
  //   Row 2: 'GRUP1' | 0.15
  //   Row 3: 'GRUP2' | 0.20
  //   Row 4: 'GRUP3' | 0.25
  const map = {};
  for (let i = 2; i < 10 && i < veriRows.length; i++) {
    const r = veriRows[i];
    const grp = s(r[27]);
    const rate = n(r[28]);
    if (!grp || grp === "0") continue;
    map[grp] = rate;
  }
  return map;
}

function parseQuantityMargins(referansRows) {
  // REFERANS VERİLER — miktar aralığı col 3, işçilik col 4, malzeme/fason col 5
  //   Row 0: [3]='MİKTAR ARALIĞI (ADET)' [4]='İŞÇİLİK(%)' [5]='MALZEME-FASON(%)'
  //   Row 1: [3]=1 [4]=6 [5]=1.2
  //   Row 2: [3]='2-3' [4]=5 [5]=1
  //   ... Row 12: [3]='1000 - 10000' [4]=0.2 [5]=0.1
  const brackets = [];
  const seenRanges = new Set();
  for (let i = 1; i < 20 && i < referansRows.length; i++) {
    const r = referansRows[i];
    const range = s(r[3]);
    if (!range || range.startsWith("=") || range === "0") continue;
    const cleaned = range.replace(/\s+/g, "");
    let min = null, max = null;
    if (/^\d+$/.test(cleaned)) {
      min = max = Number(cleaned);
    } else {
      const parts = cleaned.split("-");
      if (parts.length === 2) {
        const a = Number(parts[0]);
        const b = Number(parts[1]);
        if (Number.isFinite(a) && Number.isFinite(b)) { min = a; max = b; }
      }
    }
    if (min === null || !Number.isFinite(min)) continue;
    const key = `${min}-${max ?? min}`;
    if (seenRanges.has(key)) continue;
    seenRanges.add(key);
    brackets.push({
      min, max: max ?? min,
      laborPct: n(r[4]),
      materialFasonPct: n(r[5]),
    });
  }
  brackets.sort((a, b) => a.min - b.min);
  return brackets;
}

/**
 * Ana master data parse — bir workbook alıp Firestore payload'ları döner.
 * Dönüş: {
 *   quoteMaterials: { materials, currencyRateUsd },
 *   quoteMachinesRef: { machines },
 *   quoteFasonWorks: { works },
 *   quoteOptions:    { nakliye, odemeSekli, dovizCinsi, birim, teklifTipi },
 *   quotePolicy:     { quantityMargins, materialLaborMargins, customerGroupMargins }
 * }
 */
function parseQuoteMasterData(workbook) {
  const XLSX = require("xlsx");
  const veriWs = workbook.Sheets["Veri"];
  const referansWs = workbook.Sheets["REFERANS VERİLER"];
  if (!veriWs) throw new Error("Excel'de 'Veri' sheet'i yok");
  if (!referansWs) throw new Error("Excel'de 'REFERANS VERİLER' sheet'i yok");

  const veriRows = XLSX.utils.sheet_to_json(veriWs, { header: 1, defval: "" });
  const referansRows = XLSX.utils.sheet_to_json(referansWs, { header: 1, defval: "" });

  const { materials, currencyRateUsd } = parseMaterials(veriRows);
  const machines = parseMachines(veriRows);
  const fasonWorks = parseFasonWorks(veriRows);
  const options = parseOptions(veriRows);
  const materialLaborMargins = parseMaterialLaborMargins(veriRows);
  const customerGroupMargins = parseCustomerGroupMargins(veriRows);
  const quantityMargins = parseQuantityMargins(referansRows);

  return {
    quoteMaterials: {
      materials,
      currencyRateUsd,
      importedAt: new Date().toISOString(),
    },
    quoteMachinesRef: {
      machines,
      note: "Excel referans — asıl kaynak workCenters",
    },
    quoteFasonWorks: {
      works: fasonWorks,
    },
    quoteOptions: options,
    quotePolicy: {
      quantityMargins,
      materialLaborMargins,
      customerGroupMargins,
      importedAt: new Date().toISOString(),
    },
    summary: {
      materialCount: Object.keys(materials).length,
      machineCount: Object.keys(machines).length,
      fasonWorkCount: fasonWorks.length,
      currencyRateUsd,
      quantityBracketCount: quantityMargins.length,
    },
  };
}

// ==================== ARŞİV PARSE ====================

/**
 * Liste sheet'ini parse eder — 2437 kalem → 208 teklif → yıl bölünmüş.
 * Bir teklif = aynı Teklif No + Firma + Tarih ile birleşen kalemler.
 *
 * Dönüş: {
 *   quotes_2024: { quotes: { [quoteId]: {...} } },
 *   quotes_2025: { quotes: { [quoteId]: {...} } },
 *   summary: { totalQuotes, totalLines, byYear }
 * }
 */
function parseQuoteArchive(workbook) {
  const XLSX = require("xlsx");
  const listeWs = workbook.Sheets["Liste"];
  if (!listeWs) throw new Error("Excel'de 'Liste' sheet'i yok");
  const rows = XLSX.utils.sheet_to_json(listeWs, { header: 1, defval: "" });

  // Col indexleri (header'dan doğrulanmış)
  const C = {
    firmaAdi: 1, telefon: 2, email: 3, teklifTarihi: 4, teklifNo: 5,
    odemeSekli: 6, nakliye: 7, malzemeKodu: 8, malzemeTanimi: 9,
    miktar: 10, birim: 11, termin: 12, dovizCinsi: 13,
    malzemeTuru: 14, ebat: 15, agirlikKg: 16,
    malzemeMaliyeti: 17, malzemeKarMarji: 18, malzemeKar: 19,
    kullanilanMakineler: 20, makineZaman: 21, makineKarMarjlari: 22, makineToplamKar: 23,
    fasonIsler: 24, fasonMaliyetleri: 25, fasonKarMarjlari: 26, fasonToplamKar: 27,
    hammaddeMlytKar: 28, iscilikMlytKar: 29, fasonMlytKar: 30,
    teklifFiyati: 31, nakliyeUcreti: 32,
    siparisTarihi: 33, teklifTipi: 34,
  };

  const quotesByYear = {}; // { "2024": { quotes: {} }, "2025": {...} }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const teklifNo = s(r[C.teklifNo]);
    if (!teklifNo || teklifNo === "0") continue;
    const firmaAdi = s(r[C.firmaAdi]);
    const teklifTarihi = excelDateToIso(r[C.teklifTarihi]);
    const stokKodu = s(r[C.malzemeKodu]);
    if (!stokKodu && !s(r[C.malzemeTanimi])) continue;

    // Yıl: teklif no'nun ilk 2 hanesi (25011301 → 2025) veya tarih
    let year;
    if (/^\d{8}$/.test(teklifNo)) {
      const yy = teklifNo.substring(0, 2);
      year = "20" + yy;
    } else if (teklifTarihi) {
      year = teklifTarihi.substring(0, 4);
    } else {
      year = "unknown";
    }
    if (!quotesByYear[year]) quotesByYear[year] = { quotes: {} };
    const bucket = quotesByYear[year].quotes;

    // Aynı teklifNo aynı gün farklı müşteriye verilmiş olabilir (Excel'de duplicate).
    // Bunu ayırmak için grouping key: teklifNo + normalized firma adı.
    const customerKey = firmaAdi.replace(/\s+/g, "_").substring(0, 40);
    const groupKey = `${teklifNo}__${customerKey}`;

    // Aynı groupKey'li kalemler bir quote objesi altında toplanır
    if (!bucket[groupKey]) {
      bucket[groupKey] = {
        quoteNo: teklifNo,
        customerName: firmaAdi,
        customerPhone: s(r[C.telefon]) === "0" ? "" : s(r[C.telefon]),
        customerEmail: s(r[C.email]) === "0" ? "" : s(r[C.email]),
        quoteDate: teklifTarihi,
        paymentTerm: s(r[C.odemeSekli]),
        shipping: s(r[C.nakliye]),
        currency: s(r[C.dovizCinsi]) || "TL",
        quoteType: s(r[C.teklifTipi]) || "Yurtiçi Satış",
        orderDate: excelDateToIso(r[C.siparisTarihi]),        // sipariş dönüşüm izleme
        status: excelDateToIso(r[C.siparisTarihi]) ? "accepted" : "sent",
        lines: [],
        totalPriceTl: 0,
        source: "excel-archive-import",
        importedAt: new Date().toISOString(),
      };
    }

    const quote = bucket[groupKey];
    const teklifFiyati = n(r[C.teklifFiyati]);
    const line = {
      stockCode: stokKodu,
      stockName: s(r[C.malzemeTanimi]),
      quantity: n(r[C.miktar]),
      unit: s(r[C.birim]) || "ADET",
      term: s(r[C.termin]),
      materialType: s(r[C.malzemeTuru]),
      dimensions: s(r[C.ebat]),
      weightKg: n(r[C.agirlikKg]),
      materialCost: n(r[C.malzemeMaliyeti]),
      materialMarginPct: n(r[C.malzemeKarMarji]),
      materialProfit: n(r[C.malzemeKar]),
      machines: s(r[C.kullanilanMakineler]),
      machineTimeMin: n(r[C.makineZaman]),
      machineMarginPct: n(r[C.makineKarMarjlari]),
      machineProfit: n(r[C.makineToplamKar]),
      fasonWorks: s(r[C.fasonIsler]),
      fasonCost: n(r[C.fasonMaliyetleri]),
      fasonMarginPct: n(r[C.fasonKarMarjlari]),
      fasonProfit: n(r[C.fasonToplamKar]),
      materialTotalWithProfit: n(r[C.hammaddeMlytKar]),
      laborTotalWithProfit: n(r[C.iscilikMlytKar]),
      fasonTotalWithProfit: n(r[C.fasonMlytKar]),
      linePrice: teklifFiyati,
      shippingCost: n(r[C.nakliyeUcreti]),
    };
    quote.lines.push(line);
    quote.totalPriceTl += teklifFiyati;
  }

  const summary = { totalQuotes: 0, totalLines: 0, byYear: {} };
  for (const [year, doc] of Object.entries(quotesByYear)) {
    const count = Object.keys(doc.quotes).length;
    const lines = Object.values(doc.quotes).reduce((s, q) => s + q.lines.length, 0);
    summary.totalQuotes += count;
    summary.totalLines += lines;
    summary.byYear[year] = { quoteCount: count, lineCount: lines };
  }

  return { quotesByYear, summary };
}

// ==================== PARÇA KÜTÜPHANESİ (arşivden çıkarma) ====================

// Stok kodundan 10'lu bucket id üret (0-9) — Firestore 1MB doc limitini aşmamak için partition.
// Deterministic: aynı stok kodu her zaman aynı bucket'a gider.
function partBucketId(stokKodu) {
  let hash = 0;
  const s = String(stokKodu || "");
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash) % 10).padStart(1, "0");
}

/**
 * Arşivdeki tüm teklif kalemlerini gezip her benzersiz stok kodu için kütüphane
 * kartı çıkarır. Aynı stok koduyla verilen tüm teklifleri toplayıp:
 *   - son kullanılan hammadde/makineler/fason bilgisi (son tarihli teklift)
 *   - toplam kullanım sayısı
 *   - son fiyat + son teklif tarihi
 *   - fason iş × son fiyat geçmişi (autocomplete için)
 *
 * Dönüş: { buckets: { [bucketId]: {parts: {...}} }, summary }
 * 10 bucket (0-9), her stok kodu hash mod 10 ile deterministik bir bucket'a gider.
 * Firestore doc limit: 1MB — bucket başına ~200 parça, ~100-150 KB.
 * Stok kodu boş olan kalemler atlanır (henüz kod verilmemiş yeni teklifler).
 */
function extractQuotePartsFromArchive(archiveResult) {
  const parts = {};
  const now = new Date().toISOString();

  for (const [year, doc] of Object.entries(archiveResult.quotesByYear || {})) {
    for (const quote of Object.values(doc.quotes || {})) {
      const quoteDate = quote.quoteDate || "";
      for (const line of quote.lines || []) {
        const stokKodu = s(line.stockCode);
        if (!stokKodu || stokKodu === "0") continue;

        if (!parts[stokKodu]) {
          parts[stokKodu] = {
            stokKodu,
            stokAdi: s(line.stockName),
            musteriKodu: "", // arşivde yok — kullanıcı elle girer
            hammadde: {
              tur: s(line.materialType),
              ebat: s(line.dimensions),
              agirlikKg: n(line.weightKg),
            },
            operasyonlar: {
              makineler: s(line.machines),      // örn. "SPİNNER,GOODWAY"
              toplamSureDk: n(line.machineTimeMin),
            },
            fason: {
              isler: s(line.fasonWorks),       // örn. "Kromat,Fosfat"
              tahminiToplam: n(line.fasonCost),
            },
            fasonGecmis: [], // aşağıda doldurulur
            aparat: {
              varMi: false,
              aciklama: "",
              maliyet: 0,
            },
            yapılabilirlik: {
              durum: "onaylı_gecmis", // arşivden geldiği için önceden yapılabilir
              not: "",
            },
            musteriler: new Set(),       // hangi müşterilere verildi (Set olarak topla)
            kullanimSayisi: 0,
            sonTeklifNo: "",
            sonTeklifTarihi: "",
            sonMusteri: "",
            sonFiyatTl: 0,
            sonMiktar: 0,
            createdAt: now,
            createdBy: "excel-archive-import",
          };
        }

        const p = parts[stokKodu];
        p.kullanimSayisi++;
        if (quote.customerName) p.musteriler.add(quote.customerName);

        // Fason iş × fiyat geçmişi — arşivden çıkar
        if (line.fasonWorks && line.fasonCost > 0) {
          const isler = String(line.fasonWorks).split(/[,;/]/).map(x => x.trim()).filter(Boolean);
          const fiyatPerIs = line.fasonCost / (isler.length || 1);
          for (const isim of isler) {
            p.fasonGecmis.push({
              isTuru: isim,
              fiyatTl: fiyatPerIs,
              teklifNo: quote.quoteNo,
              tarih: quoteDate,
              musteri: quote.customerName,
              miktar: line.quantity,
            });
          }
        }

        // Son teklif güncellemesi (en yeni tarih)
        if (!p.sonTeklifTarihi || (quoteDate && quoteDate > p.sonTeklifTarihi)) {
          p.sonTeklifNo = quote.quoteNo;
          p.sonTeklifTarihi = quoteDate;
          p.sonMusteri = quote.customerName;
          p.sonFiyatTl = line.linePrice || 0;
          p.sonMiktar = line.quantity || 0;
          // En yeni teklift bilgi ile hammadde/operasyon güncelle (revizyon olmuş olabilir)
          if (line.materialType) p.hammadde.tur = line.materialType;
          if (line.dimensions) p.hammadde.ebat = line.dimensions;
          if (line.weightKg) p.hammadde.agirlikKg = line.weightKg;
          if (line.machines) p.operasyonlar.makineler = line.machines;
          if (line.machineTimeMin) p.operasyonlar.toplamSureDk = line.machineTimeMin;
        }
      }
    }
  }

  // Set → Array + fason geçmişini kısalt (arşivin şişmemesi için)
  for (const p of Object.values(parts)) {
    p.musteriler = [...p.musteriler].slice(0, 10); // max 10 müşteri (nadiren aşar)
    p.fasonGecmis.sort((a, b) => (b.tarih || "").localeCompare(a.tarih || ""));
    p.fasonGecmis = p.fasonGecmis.slice(0, 10); // son 10 fason kaydı yeter
  }

  // 10 bucket'a dağıt — Firestore 1MB doc limitini aşmamak için partition
  const buckets = {};
  for (let i = 0; i < 10; i++) buckets[String(i)] = { parts: {} };
  let totalUsages = 0;
  for (const [stokKodu, p] of Object.entries(parts)) {
    const bid = partBucketId(stokKodu);
    buckets[bid].parts[stokKodu] = p;
    totalUsages += p.kullanimSayisi;
  }

  return {
    buckets,
    summary: {
      partCount: Object.keys(parts).length,
      totalUsages,
      bucketDistribution: Object.fromEntries(
        Object.entries(buckets).map(([b, d]) => [b, Object.keys(d.parts).length])
      ),
    },
  };
}

/**
 * Arşivdeki müşterileri toplayıp müşteri master oluşturur.
 * Her müşteri için:
 *   - En sık kullanılan ödeme şekli → default (30/60/90 gün vade tespit)
 *   - En sık kullanılan nakliye + döviz
 *   - Kullanım sayısı, ilk/son teklif tarihi
 *   - Toplam teklif TL değeri, kabul olan teklif sayısı (dönüşüm oranı)
 */
function extractQuoteCustomersFromArchive(archiveResult) {
  const customers = {}; // { normalizeAd: {...} }

  for (const doc of Object.values(archiveResult.quotesByYear || {})) {
    for (const q of Object.values(doc.quotes || {})) {
      const name = s(q.customerName);
      if (!name) continue;
      const key = name;
      if (!customers[key]) {
        customers[key] = {
          name,
          phone: s(q.customerPhone),
          email: s(q.customerEmail),
          address: "",
          defaultPaymentTerm: "",
          defaultShipping: "",
          defaultCurrency: "",
          paymentTermCounts: {},
          shippingCounts: {},
          currencyCounts: {},
          totalQuotes: 0,
          totalLines: 0,
          totalPriceTl: 0,
          acceptedQuotes: 0,
          firstQuoteDate: q.quoteDate,
          lastQuoteDate: q.quoteDate,
          createdAt: new Date().toISOString(),
        };
      }
      const c = customers[key];
      // Meta bilgileri güncelle (email/phone boş değilse yakala)
      if (q.customerPhone && !c.phone) c.phone = s(q.customerPhone);
      if (q.customerEmail && !c.email) c.email = s(q.customerEmail);
      // Sık kullanım sayaçları
      if (q.paymentTerm) c.paymentTermCounts[q.paymentTerm] = (c.paymentTermCounts[q.paymentTerm] || 0) + 1;
      if (q.shipping) c.shippingCounts[q.shipping] = (c.shippingCounts[q.shipping] || 0) + 1;
      if (q.currency) c.currencyCounts[q.currency] = (c.currencyCounts[q.currency] || 0) + 1;
      c.totalQuotes++;
      c.totalLines += (q.lines || []).length;
      c.totalPriceTl += Number(q.totalPriceTl || 0);
      if (q.status === "accepted") c.acceptedQuotes++;
      if (q.quoteDate) {
        if (!c.firstQuoteDate || q.quoteDate < c.firstQuoteDate) c.firstQuoteDate = q.quoteDate;
        if (!c.lastQuoteDate || q.quoteDate > c.lastQuoteDate) c.lastQuoteDate = q.quoteDate;
      }
    }
  }

  // En sık kullanılanı default olarak set
  for (const c of Object.values(customers)) {
    const pickMax = (obj) => {
      const entries = Object.entries(obj || {});
      if (entries.length === 0) return "";
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    };
    c.defaultPaymentTerm = pickMax(c.paymentTermCounts);
    c.defaultShipping = pickMax(c.shippingCounts);
    c.defaultCurrency = pickMax(c.currencyCounts) || "TL";
    // Sayaçları temizle (frontend'de gerek yok, sadece hesap için kullanıldı)
    delete c.paymentTermCounts;
    delete c.shippingCounts;
    delete c.currencyCounts;
  }

  return {
    customers,
    summary: {
      customerCount: Object.keys(customers).length,
    },
  };
}

module.exports = {
  parseQuoteMasterData,
  parseQuoteArchive,
  extractQuotePartsFromArchive,
  extractQuoteCustomersFromArchive,
  partBucketId,
};
