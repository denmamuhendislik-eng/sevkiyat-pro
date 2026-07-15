/**
 * firestore.js — Parser çıktılarını Firestore'a yazma
 *
 * KRİTİK: App.jsx'teki saveStock/saveAkibet/savePurchase fonksiyonlarının
 * yazdığı format ile BIREBIR aynı şema kullanılır. Sevkiyat Pro'nun
 * mevcut listener'ları bu doc'ları okuyup arayüzü tazeler.
 *
 * Doc yolları (App.jsx'ten):
 *   appData/mrpStock     → Stok raporu
 *   appData/mrpAkibet    → Bekleyen Operasyonlar (Ürünlü)
 *   appData/mrpPurchase  → Sipariş Kontrol Listesi
 *   appData/automationLog → her çalıştırma için entry (bu modülde yeni)
 */

const admin = require("firebase-admin");

const APP_COL = "appData";
const STOCK_DOC = "mrpStock";
const AKIBET_DOC = "mrpAkibet";
const PURCH_DOC = "mrpPurchase";
const SALES_ORDERS_DOC = "salesOrders";
const UNIT_COSTS_DOC = "unitCosts";
const LABOR_COSTS_DOC = "laborCosts";
const OVERHEAD_MAPPINGS_DOC = "overheadCategoryMappings";
const SHIPMENTS_DOC = "shipments";
const PLAN_OVERRIDES_DOC = "planOverrides";
const AUTOMATION_LOG_DOC = "automationLog";
const COC_PARTS_DOC = "cocParts";
const COC_CERTIFICATES_DOC = "cocCertificates";
// Teklif modülü doc adları
const QUOTE_MATERIALS_DOC = "quoteMaterials";
const QUOTE_MACHINES_REF_DOC = "quoteMachinesRef";
const QUOTE_FASON_WORKS_DOC = "quoteFasonWorks";
const QUOTE_OPTIONS_DOC = "quoteOptions";
const QUOTE_POLICY_DOC = "quotePolicy";
const QUOTE_CUSTOMERS_DOC = "quoteCustomers";
const QUOTE_PARTS_DOC = "quoteParts"; // Parça kütüphanesi (stok kodu bazlı hafıza)
const QUOTES_YEAR_DOC_PREFIX = "quotes_"; // quotes_2024, quotes_2025 vb.

/**
 * Stock parser çıktısını Sevkiyat Pro'nun beklediği compact formata çevir.
 * App.jsx satır 5057-5060 ile birebir aynı dönüşüm.
 *
 * v13: pl[] = sadece üretim hattı (PRES/KAYNAK/TALAŞ/Üretim Hattı/Lazer Mamül Ambarı)
 * lokasyon detayı — Sevkiyat Bazlı İhtiyaç ekranındaki "🔍 Kontrol Önerilir" rozeti için.
 * Diğer lokasyonlar (ambar/fason/haric) kompakt total'larda zaten var, detay tutmaya gerek yok.
 */
function transformStockForFirestore(parserResult, fileName) {
  const partsObj = {};
  parserResult.parts.forEach((p) => {
    const pl = (p.locs || [])
      .filter((l) => l.c === "uretim")
      .map((l) => ({ l: l.l, q: l.q, o: l.o || null, n: l.n || null }));
    partsObj[p.code] = {
      n: p.name,
      u: p.unit,
      g: p.group,
      a: p.ambar,
      r: p.uretim,
      f: p.fason,
      h: p.haric,
      t: p.total,
      lc: p.locs.length,
      ...(pl.length > 0 ? { pl } : {}),
    };
  });
  return {
    importedAt: new Date().toISOString(),
    fileName,
    totalCodes: parserResult.totalCodes,
    totalRows: parserResult.totalRows,
    categories: parserResult.categories,
    fasonCompanies: parserResult.fasonCompanies,
    parts: partsObj,
  };
}

/**
 * Akibet parser zaten doğru formatta, doğrudan yazılır
 * (App.jsx saveAkibet → setDoc(..., result))
 */
function transformAkibetForFirestore(parserResult) {
  return parserResult;
}

/**
 * Purchase parser zaten doğru formatta, doğrudan yazılır
 */
function transformPurchaseForFirestore(parserResult) {
  return parserResult;
}

/**
 * Tek bir rapor için Firestore yazma — type'a göre uygun dönüşümü uygular
 */
async function saveReport(db, type, parserResult, fileName, opts = {}) {
  let docId, payload;
  if (type === "stock") {
    docId = STOCK_DOC;
    payload = transformStockForFirestore(parserResult, fileName);
  } else if (type === "akibet") {
    docId = AKIBET_DOC;
    payload = transformAkibetForFirestore(parserResult);
  } else if (type === "purchase") {
    docId = PURCH_DOC;
    payload = transformPurchaseForFirestore(parserResult);
  } else if (type === "salesOrders") {
    // Özel akış: önce eski salesOrders ile diff hesapla, shipments güncelle, sonra yaz.
    const diffResult = await saveSalesOrdersWithDiff(db, parserResult);
    return { docId: SALES_ORDERS_DOC, payload: parserResult.ordersMap || {}, diffMeta: diffResult };
  } else if (type === "overhead") {
    // Özel akış: çoklu ay yazımı + kategori mapping tahmin + mail tarihi bazlı kısmi-ay kontrolü
    const overheadOut = await saveOverheadReport(db, parserResult, { messageDate: opts.messageDate });
    return { docId: LABOR_COSTS_DOC, payload: null, overheadMeta: overheadOut };
  } else if (type === "supplies") {
    // Özel akış: monthlySupplies.{ym} dot-notation çoklu ay yazımı + mail tarihi bazlı kısmi-ay kontrolü
    const suppliesOut = await saveSuppliesReport(db, parserResult, { messageDate: opts.messageDate });
    return { docId: LABOR_COSTS_DOC, payload: null, suppliesMeta: suppliesOut };
  } else if (type === "cariEkstre") {
    // Özel akış: A+R için authoritative source, EKSTRE_* ID şeması ile shipments'a yazılır
    const ekstreOut = await saveCariEkstreReport(db, parserResult, opts.cariEkstreOpts || {});
    return { docId: SHIPMENTS_DOC, payload: null, ekstreMeta: ekstreOut };
  } else {
    throw new Error(`Bilinmeyen rapor tipi: ${type}`);
  }

  await db.collection(APP_COL).doc(docId).set(payload);
  return { docId, payload };
}

/**
 * salesOrders'taki tüm sipariş kalemleri için cocParts master'a iskelet kayıt ekle.
 * Idempotent: aynı stokKodu varsa atla, yoksa iskelet ekle.
 * İskelet: {stokKodu, description, customerCode, faiNo: null, revisions: [], isSkeleton: true}
 * Kullanıcı sonradan Parça Master tab'ından FAİ + revizyon ekler.
 *
 * Tüm müşteriler için çalışır (A+R sınırı yok) — COC her müşteri için talep
 * üzerine düzenlenebilir.
 */
async function upsertCocPartsSkeletonsFromOrders(db, ordersMap) {
  if (!ordersMap || Object.keys(ordersMap).length === 0) return { added: 0 };
  const ref = db.collection(APP_COL).doc("cocParts");
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : { parts: {} };
  const existingParts = existing.parts || {};

  // Tüm sipariş kalemlerinden unique stokKodu listesi (ilk gelen description+customerCode kazanır)
  const newSkeletons = {};
  for (const o of Object.values(ordersMap)) {
    if (!o?.stokKodu) continue;
    const key = String(o.stokKodu).trim();
    if (!key) continue;
    if (existingParts[key]) continue; // master'da zaten var
    if (newSkeletons[key]) continue;   // bu yüklemede başka kalemde de var, ilk gelen
    newSkeletons[key] = {
      stokKodu: key,
      description: String(o.stokAdi || "").trim(),
      faiNo: null,
      revisions: [],
      customerCode: o.customerCode || "",
      isSkeleton: true, // UI'da "Eksik" rozeti için
      createdAt: new Date().toISOString(),
      source: "auto-from-salesOrders",
    };
  }

  const addedCount = Object.keys(newSkeletons).length;
  if (addedCount === 0) return { added: 0 };

  const merged = { ...existingParts, ...newSkeletons };
  await ref.set({
    parts: merged,
    totalCount: Object.keys(merged).length,
    lastSkeletonImportAt: new Date().toISOString(),
  }, { merge: true });

  return { added: addedCount };
}

/**
 * salesOrders + shipments birleşik yazımı — sevk geçmişi diff hesabı.
 *
 * VIO sadece aktif siparişleri verir; tam teslim olunca rapordan düşer. Diff:
 *   1. Eskide var, yenide var, sevkEdilen artmış → "vio-update" event
 *   2. Eskide var, yenide yok → "vio-removed" final event (kalan miktar tam sevk varsayımı)
 *   3. Eskide yok, yenide var (sevkEdilen>0) → initial "vio-update" event
 *
 * DigerMusteriler.jsx handleFile içindeki logic'in CommonJS aynası — frontend
 * manuel yükleme ile cloud function mail otomasyonu BİREBİR aynı diff üretir.
 *
 * @returns {Promise<{eventCount, salesOrdersCount}>}
 */
async function saveSalesOrdersWithDiff(db, parserResult) {
  const importedAt = new Date().toISOString();
  const newOrdersMap = parserResult.ordersMap || {};

  // Eski salesOrders + shipments + planOverrides oku.
  // planOverrides: deferred-aware diff için — kullanıcı bir siparişi "Akibeti Belirsiz"
  // işaretlediyse, VIO'dan kaybolması iptal sayılır (sahte sevk event yazılmaz).
  const ordersRef = db.collection(APP_COL).doc(SALES_ORDERS_DOC);
  const shipmentsRef = db.collection(APP_COL).doc(SHIPMENTS_DOC);
  const overridesRef = db.collection(APP_COL).doc(PLAN_OVERRIDES_DOC);
  const [ordersSnap, shipmentsSnap, overridesSnap] = await Promise.all([
    ordersRef.get(), shipmentsRef.get(), overridesRef.get()
  ]);
  const oldOrders = ordersSnap.exists ? (ordersSnap.data() || {}) : {};
  const newShipments = shipmentsSnap.exists ? { ...(shipmentsSnap.data() || {}) } : {};
  const oldOverrides = overridesSnap.exists ? (overridesSnap.data() || {}) : {};
  const overrideUpdates = {}; // status değişen override'lar (deferred → cancelled)
  let cancelledCount = 0;

  // ID şeması {belgeNo}_{stokKodu}_{teslimTarihi} → VIO'da teslim tarihi güncellenirse
  // eski ID kaybolur, yeni ID gelir. Sahte vio-removed event yazmamak için (belgeNo, stokKodu)
  // → yeni ID listesi indeksi kuruyoruz. Eski ID kayıpsa ama aynı belge+stok yeni VIO'da varsa
  // teslim güncellemesi varsay, event yazma.
  const newBelgeStokIndex = {};
  for (const [id, o] of Object.entries(newOrdersMap)) {
    if (!o || !o.belgeNo || !o.stokKodu) continue;
    const key = `${o.belgeNo}|${o.stokKodu}`;
    if (!newBelgeStokIndex[key]) newBelgeStokIndex[key] = [];
    newBelgeStokIndex[key].push(id);
  }
  const hasReplacementInVio = (oldO) => {
    if (!oldO?.belgeNo || !oldO?.stokKodu) return false;
    const arr = newBelgeStokIndex[`${oldO.belgeNo}|${oldO.stokKodu}`];
    return !!(arr && arr.length > 0);
  };

  // Override migration — VIO'da teslim tarihi değişerek 3-tuple ID'si değişen sipariş için
  // eski ID'nin planOverrides kaydını yeni ID'ye taşır. Sadece 1-1 replacement durumunda
  // çalışır (birden fazla aday varsa belirsizlik → orphan bırakılır, kullanıcı UI'dan
  // müdahale eder). Yeni ID'de zaten override varsa çakışma korunur.
  // Hem deferred hem diğer override türleri (note, manuel hafta) için aynı şekilde çalışır.
  let migratedCount = 0;
  const migrateOverrideIfReplacement = (oldId, oldO) => {
    const ov = oldOverrides[oldId];
    if (!ov) return;
    const arr = newBelgeStokIndex[`${oldO.belgeNo}|${oldO.stokKodu}`] || [];
    if (arr.length !== 1) return; // belirsizlik — orphan bırak
    const newId = arr[0];
    if (oldOverrides[newId] || overrideUpdates[newId] !== undefined) return; // çakışma
    overrideUpdates[newId] = {
      ...ov,
      migratedFrom: oldId,
      migratedAt: importedAt,
    };
    overrideUpdates[oldId] = admin.firestore.FieldValue.delete();
    migratedCount++;
  };

  // A+R müşterileri için shipments yazımı SKIPLENİR — cari ekstre authoritative source.
  // (kullanıcı kararı 2026-06-22) VIO sipariş raporundaki sevkEdilen yaklaşık olduğu için
  // A+R sevkleri sadece cari ekstreden saveCariEkstreReport ile yazılır.
  const TRACKED_PREFIXES = ["120-0107", "120-116"];
  const isTrackedCustomer = (code) => {
    if (!code) return false;
    const s = String(code).trim();
    return TRACKED_PREFIXES.some(p => s === p || s.startsWith(p + "-"));
  };

  let eventCount = 0;
  let skippedTrackedCount = 0;
  // Birim fiyat snapshot — Dashboard aylık TL hesabı için kritik. unitPriceTl yoksa
  // shipment "fiyatsız" sayılır ve toplama dahil edilmez. Client (DigerMusteriler.jsx)
  // ensureShipmentDoc ile BIREBIR AYNI mantık: yeni kayıtta unitPriceTl + toplamBedel,
  // mevcut kayıtta unitPriceTl yoksa salesOrders'tan backfill.
  const ensureShipmentDoc = (id, o) => {
    if (isTrackedCustomer(o?.customerCode)) {
      skippedTrackedCount++;
      return null; // A+R skip — cari ekstre authoritative
    }
    if (!newShipments[id]) {
      const orjMikt = Number(o.orijinalMiktar) || 0;
      const toplamBedel = Number(o.toplamBedel) || 0;
      const unitPriceTl = orjMikt > 0 ? toplamBedel / orjMikt : 0;
      newShipments[id] = {
        customerCode: o.customerCode || "",
        customerName: o.customerName || "",
        stokKodu: o.stokKodu || "",
        stokAdi: o.stokAdi || "",
        belgeNo: o.belgeNo || "",
        orijinalMiktar: orjMikt,
        toplamBedel,
        unitPriceTl,
        teslimTarihi: o.teslimTarihi || "",
        events: [],
        totalShipped: 0,
        fullyDelivered: false,
        firstShipAt: "",
        finalShipAt: "",
        lastUpdate: importedAt,
      };
    } else {
      // Backfill: mevcut shipment'ta unitPriceTl yoksa, salesOrders verisinden doldur.
      // Cron öncesi oluşan fiyatsız kayıtlar burada otomatik kapanır.
      const sh = newShipments[id];
      if (!sh.unitPriceTl || !sh.toplamBedel) {
        const orjMikt = Number(o.orijinalMiktar) || sh.orijinalMiktar || 0;
        const toplamBedel = Number(o.toplamBedel) || 0;
        if (orjMikt > 0 && toplamBedel > 0) {
          sh.toplamBedel = toplamBedel;
          sh.unitPriceTl = toplamBedel / orjMikt;
          if (!sh.orijinalMiktar) sh.orijinalMiktar = orjMikt;
        }
      }
    }
    return newShipments[id];
  };
  const pushEvent = (id, event) => {
    const sh = newShipments[id];
    if (!sh) return; // ensureShipmentDoc A+R için skip etti — no-op
    sh.events.push(event);
    sh.totalShipped = event.cumulative;
    sh.lastUpdate = importedAt;
    if (!sh.firstShipAt) sh.firstShipAt = event.at;
    sh.finalShipAt = event.at;
    if (event.final) sh.fullyDelivered = true;
    eventCount++;
  };
  // Replacement (3-tuple ID değişimi) sırasında eski ID için kümülatif sevk değerini
  // final event olarak kalıcı yazar. VIO yeni ID için sevkEdilen'i sıfırdan başlattığı
  // için vio-resync de yakalayamıyordu → bu çözüm 81 orphan'lık Mayıs-Haziran kayıp
  // pattern'inden öğrenildi (2026-06-17 cari ekstre karşılaştırması).
  const captureReplacementFinal = (id, oldO) => {
    const oldSevkEdilen = Number(oldO.sevkEdilen || 0);
    if (oldSevkEdilen <= 0) return;
    ensureShipmentDoc(id, oldO);
    const sh = newShipments[id];
    if (!sh) return; // A+R skip
    const currentTotal = Number(sh.totalShipped || 0);
    if (oldSevkEdilen <= currentTotal) return; // zaten eşit/fazla → ekleme yok
    const delta = oldSevkEdilen - currentTotal;
    pushEvent(id, {
      at: importedAt,
      deltaQty: delta,
      cumulative: oldSevkEdilen,
      source: "vio-replacement-final",
      final: true,
    });
  };

  // 1) Eskide var olanları işle
  for (const [id, oldO] of Object.entries(oldOrders)) {
    if (!oldO || typeof oldO !== "object") continue;
    const ov = oldOverrides[id];
    const isDeferred = ov?.status === "deferred";
    const newO = newOrdersMap[id];

    if (isDeferred) {
      // Deferred sipariş — diff'ten muaf, sahte sevk event yazma
      if (!newO) {
        if (hasReplacementInVio(oldO)) {
          // Teslim tarihi VIO'da güncellenmiş — iptal değil. Override'ı yeni ID'ye taşı
          // (1-1 replacement varsa). Belirsizlik/çakışma varsa orphan kalır.
          // ÖNLEYİCI FIX: Eski ID için kümülatif sevk değerini final event olarak kalıcı yaz —
          // VIO yeni ID için sevkEdilen baseline'ını sıfırdan başlattığı için (test edildi),
          // bu olmadan eski sevkler kalıcı kayıp.
          captureReplacementFinal(id, oldO);
          migrateOverrideIfReplacement(id, oldO);
          continue;
        }
        // Gerçekten kayboldu + deferred idi → İPTAL kabul et
        overrideUpdates[id] = { ...ov, status: "cancelled", cancelledAt: importedAt };
        cancelledCount++;
      }
      // else: hala VIO'da, kalanMiktar otomatik güncellenir (salesOrders setDoc), event yazma
      continue;
    }

    if (newO) {
      const oldShip = Number(oldO.sevkEdilen || 0);
      const newShip = Number(newO.sevkEdilen || 0);
      const delta = newShip - oldShip;
      if (delta > 0) {
        ensureShipmentDoc(id, newO);
        pushEvent(id, { at: importedAt, deltaQty: delta, cumulative: newShip, source: "vio-update" });
      }
    } else {
      // VIO'dan kayboldu — gerçek kayıp mı yoksa teslim tarihi güncellemesi mi?
      // Aynı (belgeNo, stokKodu) yeni VIO'da varsa: teslim güncellemesi → sahte event yazma.
      if (hasReplacementInVio(oldO)) {
        // ÖNLEYİCI FIX: Eski ID için kümülatif sevk değerini final event olarak kalıcı yaz —
        // VIO yeni ID'ye sevkEdilen taşımıyor (test edildi). Bu olmadan eski sevkler kalıcı kayıp.
        captureReplacementFinal(id, oldO);
        // Deferred olmayan override'lar (note / manuel hafta) için de migration çalışır.
        // ov undefined ise helper kendi içinde no-op döner.
        migrateOverrideIfReplacement(id, oldO);
        continue;
      }
      // Gerçekten kayboldu → kalan miktar tam sevk varsayımı
      const oldRemaining = Number(oldO.kalanMiktar || 0);
      if (oldRemaining > 0) {
        ensureShipmentDoc(id, oldO);
        const cumulative = Number(oldO.orijinalMiktar || 0);
        pushEvent(id, { at: importedAt, deltaQty: oldRemaining, cumulative, source: "vio-removed", final: true });
      } else if (newShipments[id]) {
        newShipments[id].fullyDelivered = true;
        newShipments[id].lastUpdate = importedAt;
      }
    }
  }
  // 2) Yenide olup eskide olmayan siparişler
  for (const [id, newO] of Object.entries(newOrdersMap)) {
    if (oldOrders[id]) continue;
    const newShip = Number(newO.sevkEdilen || 0);
    if (newShip > 0) {
      ensureShipmentDoc(id, newO);
      pushEvent(id, { at: importedAt, deltaQty: newShip, cumulative: newShip, source: "vio-update" });
    }
  }

  // 3) vio-resync — VIO sipariş raporundaki `sevkEdilen` ile bizim shipments'taki
  //    totalShipped arasındaki sapmaları kapat. Kayıp B kalıcı çözümü:
  //    - Replacement migration sonrası baseline kaybı (eski ID'nin sevkEdilen değeri yeni
  //      ID'ye taşınmıyor) → yeni ID için ilk raporda bu fark resync event ile yakalanır.
  //    - Diff arasında atlanan kayıt (rapor gelmediği günde sevkEdilen değişti) → fark
  //      bir sonraki raporda resync ile kapanır.
  //    Sadece vioTotal > ourTotal olan durumda yazılır (eksik sayım toleranslı).
  //    `at` = importedAt (cari ekstredeki gerçek irsaliye tarihi bilinmiyor — yine de tutar yakalanır).
  let resyncCount = 0;
  for (const [id, newO] of Object.entries(newOrdersMap)) {
    const vioTotal = Number(newO.sevkEdilen || 0);
    if (vioTotal <= 0) continue;
    const shipDoc = newShipments[id];
    const ourTotal = Number(shipDoc?.totalShipped || 0);
    if (vioTotal <= ourTotal) continue;
    const delta = vioTotal - ourTotal;
    ensureShipmentDoc(id, newO);
    pushEvent(id, {
      at: importedAt,
      deltaQty: delta,
      cumulative: vioTotal,
      source: "vio-resync",  // audit kaynağı — diff'in atladığı sapmayı kapatıyor
    });
    resyncCount++;
  }

  // 4) Backfill pass — tüm mevcut shipments için, salesOrders'ta hâlâ aktif olanlardan
  //    unitPriceTl + toplamBedel doldur (eski cron veya bug zamanında fiyat alanı yazılmamış
  //    kayıtlar için telafi). Event üretmez ama mevcut shipment'ın TL alanları güncellenir.
  let backfillCount = 0;
  for (const [id, sh] of Object.entries(newShipments)) {
    if (isTrackedCustomer(sh?.customerCode)) continue; // A+R cari ekstreden besleniyor
    if (sh.unitPriceTl && sh.toplamBedel) continue;
    const so = newOrdersMap[id];
    if (!so) continue;
    const orjMikt = Number(so.orijinalMiktar) || 0;
    const toplamBedel = Number(so.toplamBedel) || 0;
    if (orjMikt > 0 && toplamBedel > 0) {
      sh.toplamBedel = toplamBedel;
      sh.unitPriceTl = toplamBedel / orjMikt;
      if (!sh.orijinalMiktar) sh.orijinalMiktar = orjMikt;
      backfillCount++;
    }
  }

  // Yaz: salesOrders her zaman, shipments event VEYA backfill varsa,
  // planOverrides cancelled geçişi VEYA migration olduysa (merge ile diğerleri korunur).
  await ordersRef.set(newOrdersMap);
  if (eventCount > 0 || backfillCount > 0) {
    await shipmentsRef.set(newShipments);
  }
  if (Object.keys(overrideUpdates).length > 0) {
    await overridesRef.set(overrideUpdates, { merge: true });
  }

  // cocParts master'a iskelet kayıt ekle (yeni stok kodları için, tüm müşteriler)
  let cocSkeletonsAdded = 0;
  try {
    const skel = await upsertCocPartsSkeletonsFromOrders(db, newOrdersMap);
    cocSkeletonsAdded = skel.added || 0;
  } catch (err) {
    // cocParts hatası salesOrders akışını engellemesin — log + devam
    console.error("[cocParts skeleton] Hata:", err.message);
  }

  return {
    eventCount, cancelledCount, migratedCount, resyncCount, backfillCount,
    skippedTrackedCount, salesOrdersCount: Object.keys(newOrdersMap).length,
    cocSkeletonsAdded,
  };
}

/**
 * Otomasyon log entry'si ekle. Her çalıştırma için bir entry tutulur.
 * Maksimum 50 entry — eski olanlar otomatik silinir (FIFO).
 *
 * Format:
 * appData/automationLog = {
 *   entries: [
 *     { runAt, source, results: [{ type, status, ... }], success: bool, error?: string },
 *     ...
 *   ]
 * }
 */
async function appendAutomationLog(db, entry) {
  const ref = db.collection(APP_COL).doc(AUTOMATION_LOG_DOC);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : { entries: [] };
  const entries = data.entries || [];
  entries.push(entry);
  // FIFO trim
  const MAX_ENTRIES = 50;
  const trimmed = entries.slice(-MAX_ENTRIES);
  await ref.set({ entries: trimmed }, { merge: false });
}

/**
 * Cari ekstre items'ı shipments doc'una yazar — A+R için AUTHORITATIVE source.
 *
 * Mimari (kullanıcı kararı 2026-06-22):
 *   - Cari ekstre = A+R sevkiyatları için %100 doğru kaynak (VIO sipariş raporu yaklaşık)
 *   - Her ekstre satırı için ID: EKSTRE_{customerCode}_{tarih}_{belgeNo}_{stokKodu}
 *   - Idempotent: aynı ID varsa atla (haftalık cron rerun safe)
 *   - İade satırları negatif miktar/bedel → totalShipped negatif, dashboard'da
 *     toplam sevk hesabı otomatik net (brüt - iade) gösterir
 *   - VIO diff bu kayıtlara dokunmaz (saveSalesOrdersWithDiff'te A+R skip)
 *
 * @returns {Promise<{added, skipped, deletedNonExtre, totalItems}>}
 */
async function saveCariEkstreReport(db, parserResult, opts = {}) {
  const items = parserResult.items || [];
  const importedAt = new Date().toISOString();
  const shipmentsRef = db.collection(APP_COL).doc(SHIPMENTS_DOC);
  const ordersRef = db.collection(APP_COL).doc(SALES_ORDERS_DOC);
  const [shipSnap, ordersSnap] = await Promise.all([shipmentsRef.get(), ordersRef.get()]);
  const shipments = shipSnap.exists ? { ...(shipSnap.data() || {}) } : {};
  const salesOrders = ordersSnap.exists ? (ordersSnap.data() || {}) : {};

  // Opt: ilk dolumda mevcut A+R kayıtları (VIO diff'ten gelen, EKSTRE_ prefiksli olmayan)
  // silinir → cari ekstre tek otorite. Sonraki run'larda gerekmez (idempotent).
  const TRACKED_PREFIXES = ["120-0107", "120-116"];
  const isTracked = (code) => {
    if (!code) return false;
    const s = String(code).trim();
    return TRACKED_PREFIXES.some(p => s === p || s.startsWith(p + "-"));
  };
  let deletedNonExtre = 0;
  if (opts.purgeNonExtreForTracked) {
    for (const [id, sh] of Object.entries(shipments)) {
      if (id.startsWith("EKSTRE_")) continue;
      if (isTracked(sh?.customerCode)) {
        delete shipments[id];
        deletedNonExtre++;
      }
    }
  }

  // VIO cari ekstre refNo formatı: "1000017187" = "1000" prefix + VIO sipariş belge no ("17187")
  // salesOrders.belgeNo formatı: "17187" (5-6 digit)
  // Normalize: refNo "1000" prefix'ini kırp, leading zero'ları temizle.
  const normalizeRefNo = (refNo) => {
    const s = String(refNo || "").trim();
    if (!s) return s;
    // "1000XXXXX" pattern: 1000 prefix + sayısal belge no
    if (/^1000\d+$/.test(s)) {
      const without1000 = s.substring(4);
      const n = Number(without1000);
      if (Number.isFinite(n) && n > 0) return String(n);
    }
    return s;
  };

  // salesOrders lookup indeksleri
  const orderIndex = {};        // (belgeNo|stokKodu) → [orders]
  const orderByBelgeNo = {};    // belgeNo → [orders] (stokKodu fark etmez, fallback için)
  for (const [id, o] of Object.entries(salesOrders)) {
    if (!o || !o.belgeNo || !o.stokKodu) continue;
    const belge = String(o.belgeNo).trim();
    const stok = String(o.stokKodu).trim();
    const key = `${belge}|${stok}`;
    if (!orderIndex[key]) orderIndex[key] = [];
    orderIndex[key].push({ id, ...o });
    if (!orderByBelgeNo[belge]) orderByBelgeNo[belge] = [];
    orderByBelgeNo[belge].push({ id, ...o });
  }

  // Eşleme stratejisi (öncelik sırası):
  //   1) Tam eşleşme: refNo (normalize) + stokKodu → salesOrders 3-tuple
  //   2) Fallback: refNo eşleşti ama stokKodu farklı → aynı belgeNo'daki başka order'ın
  //      teslimTarihi'ni ödünç al (tam teslim olmuş diğer kalemlerden, sipariş başına
  //      genelde aynı termin). matchedOrderId yazma, sadece termin ödünç al.
  //   3) Hiç eşleşme → orphan
  const matchOrder = (refNo, stokKodu, ekstreTarih) => {
    const stok = String(stokKodu).trim();
    const raw = String(refNo).trim();
    const normalized = normalizeRefNo(refNo);
    const tryKeys = [raw, normalized].filter((v, i, a) => v && a.indexOf(v) === i);

    // 1) Tam eşleşme
    for (const k of tryKeys) {
      const candidates = orderIndex[`${k}|${stok}`];
      if (candidates && candidates.length > 0) {
        if (candidates.length === 1) return { ...candidates[0], matchType: "exact" };
        const sorted = [...candidates].sort((a, b) => (a.teslimTarihi || "9999").localeCompare(b.teslimTarihi || "9999"));
        const future = sorted.find(o => (o.teslimTarihi || "") >= ekstreTarih);
        return { ...(future || sorted[0]), matchType: "exact" };
      }
    }
    // 2) Fallback: aynı belgeNo'nun başka stok satırından termin ödünç al
    for (const k of tryKeys) {
      const fallbackList = orderByBelgeNo[k];
      if (fallbackList && fallbackList.length > 0) {
        const sorted = [...fallbackList].sort((a, b) => (a.teslimTarihi || "9999").localeCompare(b.teslimTarihi || "9999"));
        const future = sorted.find(o => (o.teslimTarihi || "") >= ekstreTarih);
        const chosen = future || sorted[0];
        // Önemli: matchedOrderId YAZMA — bu siparişin spesifik 3-tuple'ı yok.
        // Sadece termin bilgisi ödünç. OTD hesabında "borrowed termin" olarak kullanılır.
        return { ...chosen, id: null, matchType: "borrowed" };
      }
    }
    return null;
  };

  let added = 0, skipped = 0, updated = 0, matchExact = 0, matchBorrowed = 0, orphan = 0;
  for (const it of items) {
    const id = `EKSTRE_${it.customerCode}_${it.tarih}_${it.belgeNo}_${it.stokKodu}`;
    const matchedOrderForExisting = matchOrder(it.refNo, it.stokKodu, it.tarih);
    if (shipments[id]) {
      const sh = shipments[id];
      const newMatchedId = matchedOrderForExisting?.id || null;
      const newTermin = matchedOrderForExisting?.teslimTarihi || null;
      const newType = matchedOrderForExisting?.matchType || "orphan";
      const newBedelTl = Number(it.bedelTl) || 0;
      const newCurrency = it.currency || "TL";
      const newDvzKur = Number(it.dvzKur) || 1;
      // Eşleme alanları + bedel/currency güncelleme (parser fix sonrası bedel değişebilir)
      const needsUpdate =
        sh.matchedOrderId !== newMatchedId ||
        sh.musteriTermin !== newTermin ||
        sh.matchType !== newType ||
        Math.abs((sh.toplamBedel || 0) - newBedelTl) > 0.01 ||
        sh.currency !== newCurrency;
      if (needsUpdate) {
        sh.matchedOrderId = newMatchedId;
        sh.musteriTermin = newTermin;
        sh.isOrphan = !matchedOrderForExisting;
        sh.matchType = newType;
        const miktar = Number(it.miktar) || 0;
        const orjMikt = Math.abs(miktar);
        sh.toplamBedel = newBedelTl;
        sh.unitPriceTl = orjMikt > 0 ? Math.abs(newBedelTl) / orjMikt : 0;
        sh.currency = newCurrency;
        sh.dvzKur = newDvzKur;
        sh.bedelOrjinal = Number(it.bedelOrjinal) || 0;
        updated++;
      }
      if (matchedOrderForExisting?.matchType === "exact") matchExact++;
      else if (matchedOrderForExisting?.matchType === "borrowed") matchBorrowed++;
      else orphan++;
      skipped++;
      continue;
    }
    const miktar = Number(it.miktar) || 0;
    const bedel = Number(it.bedelTl) || 0;
    const orjMikt = Math.abs(miktar);
    const unitPriceTl = orjMikt > 0 ? Math.abs(bedel) / orjMikt : 0;

    const matchedOrder = matchedOrderForExisting;
    const musteriTermin = matchedOrder?.teslimTarihi || null;
    const matchedOrderId = matchedOrder?.id || null;
    const matchType = matchedOrder?.matchType || "orphan";
    if (matchType === "exact") matchExact++;
    else if (matchType === "borrowed") matchBorrowed++;
    else orphan++;

    shipments[id] = {
      customerCode: it.customerCode,
      customerName: it.customerName,
      stokKodu: it.stokKodu,
      stokAdi: it.stokAdi || "",
      belgeNo: it.belgeNo,
      refNo: it.refNo || "",
      orijinalMiktar: orjMikt,
      toplamBedel: bedel,
      unitPriceTl,
      teslimTarihi: it.tarih, // cari ekstre fatura tarihi (gerçek sevk tarihi)
      musteriTermin,           // salesOrders'tan eşlenen müşteri termini (OTD hesabı için)
      matchedOrderId,          // eşlenen salesOrders 3-tuple ID'si (sadece exact match'te dolu)
      matchType,               // "exact" | "borrowed" | "orphan"
      isOrphan: !matchedOrder, // OTD'ye katılmaz, audit listesinde
      currency: it.currency || "TL",
      dvzKur: Number(it.dvzKur) || 1,
      bedelOrjinal: Number(it.bedelOrjinal) || 0,
      isIade: !!it.isIade,
      source: "ekstre",
      events: [{
        at: it.tarih + "T00:00:00.000Z",
        deltaQty: miktar,
        cumulative: miktar,
        source: it.isIade ? "ekstre-iade" : "ekstre-sync",
        final: true,
      }],
      totalShipped: miktar,
      fullyDelivered: true,
      firstShipAt: it.tarih,
      finalShipAt: it.tarih,
      lastUpdate: importedAt,
    };
    added++;
  }

  if (added > 0 || updated > 0 || deletedNonExtre > 0) {
    await shipmentsRef.set(shipments);
  }
  return { added, skipped, updated, deletedNonExtre, totalItems: items.length, matchExact, matchBorrowed, orphan };
}

/**
 * COC parça master'ı yazar (KONF Excel'den parse edilen).
 * Yapı: appData/cocParts = { parts: { [stokKodu]: {description, faiNo, revisions, customerCode} }, ... }
 *
 * Idempotent: mevcut parts ile merge edilir. Excel'de olmayan parçalar silinmez
 * (kullanıcı UI'dan yeni parça eklerse korunur). Çakışma: Excel öncelikli.
 */
async function saveCocPartsReport(db, parserResult, opts = {}) {
  const newParts = parserResult.parts || {};
  const ref = db.collection(APP_COL).doc(COC_PARTS_DOC);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : { parts: {} };
  const existingParts = existing.parts || {};

  let added = 0, updated = 0, unchanged = 0;
  const merged = { ...existingParts };
  for (const [stokKodu, p] of Object.entries(newParts)) {
    const cur = merged[stokKodu];
    if (!cur) {
      merged[stokKodu] = p;
      added++;
    } else {
      // Aynı parça — değişim var mı?
      const changed = cur.description !== p.description ||
                      cur.faiNo !== p.faiNo ||
                      JSON.stringify(cur.revisions || []) !== JSON.stringify(p.revisions || []) ||
                      cur.customerCode !== p.customerCode;
      if (changed) {
        merged[stokKodu] = { ...cur, ...p, updatedAt: new Date().toISOString() };
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  await ref.set({
    parts: merged,
    aselsanCount: parserResult.aselsanCount || 0,
    roketsanCount: parserResult.roketsanCount || 0,
    totalCount: Object.keys(merged).length,
    lastImportAt: parserResult.importedAt,
  });

  return { added, updated, unchanged, totalCount: Object.keys(merged).length };
}

/**
 * Geçmiş COC sertifika kayıtlarını yazar (Liste sheet'inden).
 * Yapı: appData/cocCertificates_{YYYY} = { certificates: { [id]: {...} }, totalCount, ... }
 * ID şeması: `${certNo}_${siraNo}` (1 sertifika no'da çoklu satır için)
 *
 * Year-bazlı doc bölünmesi: Firestore tek doc başına 40K index entry limiti var.
 * 1680 kayıt × 12 field = ~20K alan tek doc'a sığmaz. Yıl bazlı bölersek yılda max
 * ~1500 sertifika güvenli.
 *
 * Idempotent: aynı ID varsa atla.
 */
async function saveCocCertificatesReport(db, parserResult, opts = {}) {
  const newCerts = parserResult.certificates || {};

  // Yıl bazlı grupla
  const certByYear = {};
  for (const [id, c] of Object.entries(newCerts)) {
    const year = c.certNo.substring(0, 4);
    if (!certByYear[year]) certByYear[year] = {};
    certByYear[year][id] = c;
  }

  let totalAdded = 0, totalSkipped = 0;
  const yearStats = {};
  for (const [year, certs] of Object.entries(certByYear)) {
    const ref = db.collection(APP_COL).doc(`${COC_CERTIFICATES_DOC}_${year}`);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() || {}) : { certificates: {} };
    const existingCerts = existing.certificates || {};

    let added = 0, skipped = 0;
    const merged = { ...existingCerts };
    for (const [id, c] of Object.entries(certs)) {
      if (merged[id]) { skipped++; continue; }
      merged[id] = c;
      added++;
    }

    await ref.set({
      certificates: merged,
      year,
      totalCount: Object.keys(merged).length,
      lastImportAt: parserResult.importedAt || new Date().toISOString(),
    });

    totalAdded += added;
    totalSkipped += skipped;
    yearStats[year] = { added, skipped, total: Object.keys(merged).length };
  }

  return { added: totalAdded, skipped: totalSkipped, byYear: yearStats };
}

/**
 * Son otomasyon log entry'sini çek (UI'da göstermek için)
 */
async function getLatestAutomationLog(db) {
  const ref = db.collection(APP_COL).doc(AUTOMATION_LOG_DOC);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  const entries = data.entries || [];
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

// unitCosts'a FIFO partilerini merge eder. Aynı belgeNo+date+qty+price kombinasyonu varsa atla.
async function saveUnitCostPartitions(db, newPartitions) {
  if (!Array.isArray(newPartitions) || newPartitions.length === 0) {
    return { added: 0, skipped: 0, stockCount: 0 };
  }
  const ref = db.collection(APP_COL).doc(UNIT_COSTS_DOC);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};
  const byStock = { ...(existing.byStock || {}) };
  let added = 0, skipped = 0;
  const importStamp = new Date().toISOString();

  for (const p of newPartitions) {
    if (!p.code) { skipped++; continue; }
    const slot = byStock[p.code] || { partitions: [], lastImport: null };
    const isDup = slot.partitions.some(ep =>
      ep.belgeNo === p.belgeNo &&
      ep.orderDate === p.orderDate &&
      ep.originalQty === p.originalQty &&
      ep.unitPriceTl === p.unitPriceTl
    );
    if (isDup) { skipped++; continue; }
    slot.partitions.push({
      belgeNo: p.belgeNo || "",
      orderDate: p.orderDate || null,
      teslimDate: p.teslimDate || null,
      name: p.name || "",
      originalQty: p.originalQty || 0,
      shippedQty: p.shippedQty || 0,
      remainingQty: p.remainingQty || 0,
      unitPriceTl: p.unitPriceTl || 0,
      unitPriceDvz: p.unitPriceDvz || 0,
      currency: p.currency || "TRY",
      currencyGuess: p.currencyGuess || null,
      supplierCode: p.supplierCode || "",
      supplier: p.supplier || "",
      _rawPrice: p._rawPrice || 0,
      _rawDvzPrice: p._rawDvzPrice || 0,
      importedAt: importStamp,
      importSource: "vio-mail",
    });
    slot.partitions.sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    slot.lastImport = importStamp;
    if (p.name) slot.lastName = p.name;
    byStock[p.code] = slot;
    added++;
  }

  await ref.set({
    byStock,
    lastImport: importStamp,
    importCount: (existing.importCount || 0) + 1,
  });

  return { added, skipped, stockCount: Object.keys(byStock).length };
}

// Genel gider raporu (Hizmet Total) çoklu ay yazımı + kategori mapping akıllı tahmin.
// opts.messageDate (Gmail internalDate, unix ms) verilirse mail ay sonundan önce gelmişse
// o ay "kısmi" sayılıp skip edilir — VIO bazen ay-içi (örn. 10 Mayıs) interim raporu atıyor.
async function saveOverheadReport(db, parserResult, opts = {}) {
  if (!parserResult?.byMonth || Object.keys(parserResult.byMonth).length === 0) {
    return { monthsWritten: 0, codesGuessed: 0 };
  }
  // Mevcut kategori mapping'lerini çek (saved overrides)
  const mappingsRef = db.collection(APP_COL).doc(OVERHEAD_MAPPINGS_DOC);
  const mappingsSnap = await mappingsRef.get();
  const savedMappings = mappingsSnap.exists ? (mappingsSnap.data()?.mappings || {}) : {};

  // Anahtar kelime tahmin (frontend ile aynı)
  const KEYWORDS = [
    { weightKey: "power", words: ["elektrik"] },
    { weightKey: "area",  words: ["bina", "doğalgaz", "doğal gaz", "su giderleri", "su gideri", "kira", "ısıtma", "isitma", "aydınlatma"] },
    { weightKey: "amortization", words: ["makine", "demirbaş", "demirbas", "tamir", "bakım", "bakim", "amortisman"] },
  ];
  function guessWeight(code, name) {
    if (savedMappings[code]) return savedMappings[code];
    const txt = `${code || ""} ${name || ""}`.toLocaleLowerCase("tr-TR");
    for (const rule of KEYWORDS) {
      if (rule.words.some(w => txt.includes(w))) return rule.weightKey;
    }
    return "machineCount";
  }

  const importedAt = parserResult.importedAt || new Date().toISOString();
  // Bugünün ayı — kısmi/eksik olduğu için atlanır (VIO her ayın 10'unda gönderdiğinde o ay henüz bitmemiş)
  const currentMonth = new Date().toISOString().slice(0, 7);
  // Mail tarihi (Gmail internalDate, unix ms) — ay sonundan önce geldiyse o ay kısmi sayılır.
  // Cron her gün çalıştığı için bir sonraki ayın 1+'inde aynı mail görüldüğünde mevcut
  // ym >= currentMonth kuralı geçilebiliyordu ama içerik 10 günlük olabilirdi → bu kontrol kapatıyor.
  const messageDateMs = Number(opts?.messageDate) || null;
  const monthlyOverheads = {};
  const updatedMappings = { ...savedMappings };
  let codesGuessed = 0;
  const skippedMonths = [];
  const skippedPartialMonths = [];

  for (const [ym, m] of Object.entries(parserResult.byMonth)) {
    if (ym >= currentMonth) {
      skippedMonths.push(ym);
      continue;
    }
    // Yeni kural: mail ay sonundan SONRA gelmeli (ay tamamlanmış demek). Aksi takdirde kısmi.
    if (messageDateMs) {
      const [yy, mm] = ym.split("-").map(Number);
      // Ayın son gününün gece yarısı — mail bu tarihten önce geldiyse içerik tamamlanmamış
      const lastDayOfYmMs = new Date(yy, mm, 0, 23, 59, 59, 999).getTime();
      if (messageDateMs <= lastDayOfYmMs) {
        skippedPartialMonths.push(ym);
        continue;
      }
    }
    // Aynı kod birden çok satırda olursa birleştir (ay içi)
    const merged = {};
    for (const it of m.items) {
      const key = it.code;
      if (!merged[key]) {
        const weightKey = guessWeight(it.code, it.name);
        if (!savedMappings[it.code]) codesGuessed++;
        merged[key] = { id: it.code, category: it.name, amount: 0, weightKey };
      }
      merged[key].amount += Number(it.amount) || 0;
    }
    const items = Object.values(merged).filter(it => it.amount > 0);
    const totalTl = items.reduce((s, it) => s + it.amount, 0);
    monthlyOverheads[ym] = {
      source: "vio-mail",
      receivedAt: importedAt,
      items,
      totalTl,
    };
    for (const it of items) updatedMappings[it.id] = it.weightKey;
  }

  // Tek update — dot-notation ile sadece yeni ayları yaz (diğer aylar korunur)
  const laborRef = db.collection(APP_COL).doc(LABOR_COSTS_DOC);
  const dotMap = {};
  for (const [ym, data] of Object.entries(monthlyOverheads)) dotMap[`monthlyOverheads.${ym}`] = data;
  try {
    await laborRef.update(dotMap);
  } catch (e) {
    await laborRef.set({ monthlyOverheads }, { merge: true });
  }
  // Mapping'leri kaydet — sadece yazılacak ay varsa (boş kayıt mevcut mapping'leri silmesin)
  if (Object.keys(monthlyOverheads).length > 0) {
    await mappingsRef.set({ mappings: updatedMappings, updatedAt: importedAt }, { merge: false });
  }

  return {
    monthsWritten: Object.keys(monthlyOverheads).length,
    codesGuessed,
    totalTl: Object.values(monthlyOverheads).reduce((s, m) => s + (m.totalTl || 0), 0),
    skippedMonths,
    skippedPartialMonths,
  };
}

/**
 * Stok Sarf Hareketleri (Özet - Aylık Alışlar) — laborCosts.monthlySupplies field'ına
 * çoklu ay dot-notation yazımı + mail tarihi bazlı kısmi-ay koruması (overhead ile aynı pattern).
 *
 * parserResult.months: { "YYYY-MM": { items: [{code, name, kg, amountTl, unitCost}], totalTl, itemCount } }
 * opts.messageDate: Gmail internalDate (unix ms) — ay sonundan önce geldiyse o ay skip
 */
async function saveSuppliesReport(db, parserResult, opts = {}) {
  if (!parserResult?.months || Object.keys(parserResult.months).length === 0) {
    return { monthsWritten: 0, itemCount: 0 };
  }
  const importedAt = parserResult.importedAt || new Date().toISOString();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const messageDateMs = Number(opts?.messageDate) || null;
  const monthlySupplies = {};
  const skippedMonths = [];
  const skippedPartialMonths = [];

  for (const [ym, m] of Object.entries(parserResult.months)) {
    if (ym >= currentMonth) {
      skippedMonths.push(ym);
      continue;
    }
    if (messageDateMs) {
      const [yy, mm] = ym.split("-").map(Number);
      const lastDayOfYmMs = new Date(yy, mm, 0, 23, 59, 59, 999).getTime();
      if (messageDateMs <= lastDayOfYmMs) {
        skippedPartialMonths.push(ym);
        continue;
      }
    }
    // Aynı kod ay içinde birden fazla satırda olabilir — birleştir
    const merged = {};
    for (const it of m.items) {
      if (!merged[it.code]) {
        merged[it.code] = { code: it.code, name: it.name, kg: 0, amountTl: 0, unitCost: it.unitCost || 0 };
      }
      merged[it.code].kg += Number(it.kg) || 0;
      merged[it.code].amountTl += Number(it.amountTl) || 0;
    }
    const items = Object.values(merged).filter(it => it.amountTl > 0);
    const totalTl = items.reduce((s, it) => s + it.amountTl, 0);
    monthlySupplies[ym] = {
      source: "vio-mail",
      receivedAt: importedAt,
      items,
      totalTl: Math.round(totalTl * 100) / 100,
      itemCount: items.length,
    };
  }

  if (Object.keys(monthlySupplies).length === 0) {
    return { monthsWritten: 0, itemCount: 0, skippedMonths, skippedPartialMonths };
  }

  // Tek update — dot-notation ile sadece yeni ayları yaz (mevcut aylar korunur)
  const laborRef = db.collection(APP_COL).doc(LABOR_COSTS_DOC);
  const dotMap = {};
  for (const [ym, data] of Object.entries(monthlySupplies)) dotMap[`monthlySupplies.${ym}`] = data;
  try {
    await laborRef.update(dotMap);
  } catch (e) {
    await laborRef.set({ monthlySupplies }, { merge: true });
  }

  return {
    monthsWritten: Object.keys(monthlySupplies).length,
    itemCount: Object.values(monthlySupplies).reduce((s, m) => s + (m.itemCount || 0), 0),
    totalTl: Object.values(monthlySupplies).reduce((s, m) => s + (m.totalTl || 0), 0),
    skippedMonths,
    skippedPartialMonths,
  };
}

/**
 * TCMB döviz kurlarını Firestore'a yaz — günlük cron için.
 * appData/currencyRates doc'una rates.{YYYY-MM-DD} field'ı eklenir (deep merge).
 * Not: set() + merge:true ile NESTED map yazılır; dot-notation string key olarak
 * yazılır ve frontend okuyamaz. update() dot notation'ı nested olarak yorumlar.
 */
async function saveCurrencyRates(db, rateRecord) {
  if (!rateRecord || !rateRecord.date) return;
  const ref = db.collection(APP_COL).doc("currencyRates");
  const entry = {
    usd: rateRecord.usd,
    eur: rateRecord.eur,
    source: rateRecord.source,
    fetchedAt: rateRecord.fetchedAt,
  };
  try {
    // update → dot notation'ı NESTED yorumlar (rates.{date} alt-objeye yazar)
    await ref.update({
      [`rates.${rateRecord.date}`]: entry,
      lastFetch: rateRecord.fetchedAt,
      lastDate: rateRecord.date,
    });
  } catch (e) {
    // Doc yoksa create et (yeni doc, ilk yazım)
    await ref.set({
      rates: { [rateRecord.date]: entry },
      lastFetch: rateRecord.fetchedAt,
      lastDate: rateRecord.date,
    });
  }
}

/**
 * Önceki ayın aylık envanter snapshot'ını yaz — cron için.
 * monthKey: "YYYY-MM" (örn. "2026-04" → Nisan kapanış)
 * inventorySnapshots.snapshots.{monthKey} alanına nested kayıt (deep merge).
 */
async function saveMonthlyInventorySnapshot(db, monthKey, snapshot) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error("Geçersiz monthKey: " + monthKey);
  }
  const ref = db.collection(APP_COL).doc("inventorySnapshots");
  try {
    await ref.update({
      [`snapshots.${monthKey}`]: snapshot,
      lastAutoSnapshot: snapshot.takenAt,
    });
  } catch (e) {
    // Doc yoksa create et (ilk yazım)
    await ref.set({
      snapshots: { [monthKey]: snapshot },
      lastAutoSnapshot: snapshot.takenAt,
    });
  }
}

/**
 * Bir doc'tan tek field oku (snapshot cron için mrpStock/unitCosts/currencyRates).
 */
async function readAppDoc(db, docName) {
  const snap = await db.collection(APP_COL).doc(docName).get();
  return snap.exists ? snap.data() : null;
}

// ============================================================
// TEKLİF MODÜLÜ — Master Data + Arşiv save fonksiyonları
// ============================================================

/**
 * parseQuoteMasterData çıktısını 5 ayrı doc'a yazar.
 * staging=true ise '_staging' suffix ekler (test amacıyla).
 */
async function saveQuoteMasterData(db, parserResult, { staging = false } = {}) {
  const suffix = staging ? "_staging" : "";
  const writes = [
    { name: QUOTE_MATERIALS_DOC + suffix, data: parserResult.quoteMaterials },
    { name: QUOTE_MACHINES_REF_DOC + suffix, data: parserResult.quoteMachinesRef },
    { name: QUOTE_FASON_WORKS_DOC + suffix, data: parserResult.quoteFasonWorks },
    { name: QUOTE_OPTIONS_DOC + suffix, data: parserResult.quoteOptions },
    { name: QUOTE_POLICY_DOC + suffix, data: parserResult.quotePolicy },
  ];
  const batch = db.batch();
  const out = [];
  for (const w of writes) {
    const ref = db.collection(APP_COL).doc(w.name);
    batch.set(ref, w.data);
    out.push(w.name);
  }
  await batch.commit();
  return { staging, docsWritten: out, summary: parserResult.summary };
}

/**
 * Arşiv parse çıktısını yıl bölünmüş doc'lara yazar.
 * staging=true ise '_staging' suffix (örn. quotes_2024_staging).
 */
async function saveQuoteArchive(db, parserResult, { staging = false } = {}) {
  const suffix = staging ? "_staging" : "";
  const out = [];
  const batch = db.batch();
  for (const [year, doc] of Object.entries(parserResult.quotesByYear)) {
    const docName = QUOTES_YEAR_DOC_PREFIX + year + suffix;
    const ref = db.collection(APP_COL).doc(docName);
    batch.set(ref, {
      year,
      quotes: doc.quotes,
      importedAt: new Date().toISOString(),
      source: "excel-archive-import",
    });
    out.push({ docName, quoteCount: Object.keys(doc.quotes).length });
  }
  await batch.commit();
  return { staging, docsWritten: out, summary: parserResult.summary };
}

/**
 * Parça kütüphanesini (quoteParts) tek doc'a yazar.
 * Var olan doc üzerine yazılır — arşiv import'unda tam refresh.
 */
async function saveQuoteParts(db, extractResult, { staging = false } = {}) {
  const suffix = staging ? "_staging" : "";
  const ref = db.collection(APP_COL).doc(QUOTE_PARTS_DOC + suffix);
  await ref.set({
    parts: extractResult.parts,
    summary: extractResult.summary,
    importedAt: new Date().toISOString(),
    source: "excel-archive-import",
  });
  return { staging, docName: QUOTE_PARTS_DOC + suffix, summary: extractResult.summary };
}

/**
 * Staging doc'ları prod doc'larına promote et (rename değil, oku-yaz-sil).
 * Sadece admin manuel çağırır.
 */
async function promoteQuoteStaging(db) {
  const docsToPromote = [
    QUOTE_MATERIALS_DOC,
    QUOTE_MACHINES_REF_DOC,
    QUOTE_FASON_WORKS_DOC,
    QUOTE_OPTIONS_DOC,
    QUOTE_POLICY_DOC,
    QUOTE_PARTS_DOC,
  ];
  const promoted = [];
  for (const docName of docsToPromote) {
    const stagingRef = db.collection(APP_COL).doc(docName + "_staging");
    const stagingSnap = await stagingRef.get();
    if (!stagingSnap.exists) continue;
    const data = stagingSnap.data();
    const prodRef = db.collection(APP_COL).doc(docName);
    await prodRef.set(data);
    await stagingRef.delete();
    promoted.push(docName);
  }
  // Yıl doc'ları da promote et — quotes_YYYY_staging → quotes_YYYY
  const allDocs = await db.collection(APP_COL).listDocuments();
  for (const d of allDocs) {
    if (d.id.match(/^quotes_\d{4}_staging$/)) {
      const stagingSnap = await d.get();
      const data = stagingSnap.data();
      const prodName = d.id.replace("_staging", "");
      await db.collection(APP_COL).doc(prodName).set(data);
      await d.delete();
      promoted.push(prodName);
    }
  }
  return { promoted };
}

module.exports = {
  APP_COL,
  STOCK_DOC,
  AKIBET_DOC,
  PURCH_DOC,
  SALES_ORDERS_DOC,
  SHIPMENTS_DOC,
  AUTOMATION_LOG_DOC,
  UNIT_COSTS_DOC,
  LABOR_COSTS_DOC,
  QUOTE_MATERIALS_DOC,
  QUOTE_MACHINES_REF_DOC,
  QUOTE_FASON_WORKS_DOC,
  QUOTE_OPTIONS_DOC,
  QUOTE_POLICY_DOC,
  QUOTE_CUSTOMERS_DOC,
  QUOTE_PARTS_DOC,
  QUOTES_YEAR_DOC_PREFIX,
  saveReport,
  saveSalesOrdersWithDiff,
  saveUnitCostPartitions,
  saveOverheadReport,
  saveSuppliesReport,
  saveCariEkstreReport,
  saveCocPartsReport,
  saveCocCertificatesReport,
  saveQuoteMasterData,
  saveQuoteArchive,
  saveQuoteParts,
  promoteQuoteStaging,
  appendAutomationLog,
  getLatestAutomationLog,
  saveCurrencyRates,
  saveMonthlyInventorySnapshot,
  readAppDoc,
  transformStockForFirestore,
};
