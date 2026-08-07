# SEVKIYAT PRO — YEDEK DÖKÜMAN v21

> Son güncelleme: 7 Ağustos 2026
> Önceki sürüm: `SEVKIYAT_PRO_YEDEK_DOKUMAN_v20.md` (23 Nis 2026, 642 satır)
> Kapsam: v20 sonrası ~378 commit, ~15 hafta çalışma. Faz 2 tamamlandı, Maliyet paketi 6 fazın 5'i canlıda, COC + FAİ + Yapılabilirlik + Teklifler modülleri sıfırdan inşa edildi, A+R cari ekstre otoritetif kaynağa dönüştü.
>
> **v21'in amacı:** Sistemi hiç bilmeyen bir developer'ın kodu açmadan mimariyi ve akışları anlaması. Detay implementasyon değil, katmanlar + sorumluluklar + kararlar seviyesinde.

---

## 1. Meta

| Alan | Değer |
|---|---|
| Canlı ortam | `sevkiyat-pro.vercel.app` (Vercel, `main` push otomatik deploy) |
| Cloud Functions | Firebase Functions, region `europe-west1`, manuel `firebase deploy --only functions` |
| Auth | Firebase Auth (email/parola) |
| Veritabanı | Firestore (`appData/*` doküman-bazlı, çoğu Map) |
| Dosya deposu | Firebase Storage (COC dokümanları, FAI ekleri, yapılabilirlik teknik resim) |
| Frontend | React + Vite + inline stil (styled-components yok) |
| Test/CI | Yok — `npm run build` local doğrulama, Vercel preview URL |
| Rol seti | `admin`, `uretim`, `satis`, `viewer`, `operator` |
| Aktif kullanıcı | Ömer (admin) + 5-8 çalışan (tümü Denma bünyesi) |
| Dev workflow | Ömer `npm run dev` port 3000, HMR açık; Claude Code paralel geliştirir |

---

## 2. Mimari Özet

### 2.1. Yüksek seviye

Sevkiyat Pro tek-sayfa React uygulaması; kullanıcı sol menüden **sayfa** seçer, App.jsx her sayfa için ya kendi büyük componentini (`MRPPlanlama`, `MontajPlani`, `Dashboard` render kısmı) ya da bir modül componentini (`DigerMusteriler`, `MusteriDashboard`, `Yapilabilirlik`, `Teklifler`, `Maliyet`) render eder.

Firestore tek `appData` koleksiyonu altında ~50 doküman tutar. Çoğu doküman büyük bir Map (ör. `salesOrders` doc'unda 855 sipariş kaydı Map olarak). Bu tercih bilinçli — v18 öncesi single-tenant + real-time listener basitliği için doküman granülariteli tasarım seçildi. Bir kaç doküman yıl-suffixli (`quotes_2026`, `cocCertificates_2026`, `feasibilityStudies_2026`, `faiRecords_2026`) çünkü tek doküman 1MB limitine yaklaşıyordu.

Cloud Functions üç ana rol oynar: (a) VIO Gmail mail otomasyonu (raporları çekip parse edip Firestore'a yazma), (b) TCMB kur cron'u, (c) HTTP endpoint'ler (manuel Excel yükleme, tek-seferlik migration'lar). App tarafındaki iş mantığının çoğu React içinde koşar; cron entegre veri akışları için Cloud Functions kritik.

### 2.2. App.jsx (17 064 satır) — ana bölümler

App.jsx tek dosyadır ve büyük olmasına rağmen refactor edilmemiştir (Senaryo B stratejisi, Faz 1A retrospektifinde v19 v20'de kanıtlandı). Ana bölümler kabaca:

| Bölüm | Yaklaşık satır | Sorumluluk |
|---|---|---|
| `App` root | 141 – 4000 | Auth, rol kontrolü, sidebar navigasyonu, `yearsData` konteyner planlaması state'i, Sevkiyat Planı sayfası tablosu, Dashboard KPI'ları, VIO Import ekranı, Sevkiyat Detay ekranı, Ürünler CRUD ekranı, kullanıcı yönetimi modalı |
| `MontajPlani` | 4006 – 5785 | Montaj hattı state'i, WIP atamaları, Montaj Öncelik Önerisi, "En son tamamlanan model" KPI'sı |
| `BomModelPicker` | 5785 – 5900 | Ürün ↔ BOM eşleştirme filtrelenebilir combobox (birden çok sekmede kullanılır) |
| `MRPPlanlama` | 5901 – 16 000+ | MRP modülünün tamamı: Ürün Ağacı yükleme + BOM Explosion motoru + Çizelge Doluluk + İş Merkezleri + Akıbet + Sipariş Kontrol Listesi + Fason + Sevkiyat Bazlı İhtiyaç paneli + Sipariş Bazlı İhtiyaç (Faz 2.2) |
| Kapanış | 16 000 – 17 064 | Yardımcı componentler, style objeleri, export |

**Modül compoentleri** App.jsx'ten prop-drill ile veri (isAdmin/isUretim/isSales flag'leri, authUser, page navigation callback'leri) alır, kendi Firestore listener'larını `src/modules/<modul>/hooks.js` üzerinden kurar.

### 2.3. `src/modules/` — bağımsız modüller

| Modül | Ana ekran | Firestore | Satır (jsx/js toplamı) | Sorumluluk |
|---|---|---|---|---|
| `digerMusteriler` | `DigerMusteriler.jsx` (7225), `Dashboard.jsx` (1177) | `firestore.js` (720), `hooks.js` (293), `parser.js` (190), `subComponents.js` (226) | 10 206 | Aselsan/Roketsan/Denma + serbest müşterilerin satış siparişi ekranı; VIO Excel yükleme; manuel plan override; COC (Uygunluk Belgesi) yönetimi + arşivi; Müşteri Dashboard (parça `Dashboard.jsx`); Drive entegrasyonu ayarları |
| `digerMusteriler/fai` | `FaiView.jsx` (2288), `Form2MasterView.jsx` (516), `SupplierMasterView.jsx` (151), `SupplierCombobox.jsx` (104) | `firestore.js` (480), `schema.js` (298), `faiPdf.js` (447), `measurementReportParser.js` (276) | 4 560 | SAE AS9102 İlk Ürün Muayenesi 3-form modülü; Drive arşiv import; CMM ölçüm raporu parse; 3-imza akışı; tedarikçi + Form 2 malzeme/süreç master |
| `teklifler` | `Teklifler.jsx` (2693), `NewQuoteView.jsx` (1653) | `firestore.js` (612), `quoteCalc.js` (338), `quotePdf.js` (432), `quoteExcel.js` (154), `quoteStats.js` (338), `machineRates.js` (112) | 6 331 | Müşteri teklif hazırlama; parça kütüphanesi (10 bucket'a bölünmüş); hammadde + fason + aparat/kalıp; revizyon zinciri (R1/R2 `/Rn` suffix); marj + iskonto + döviz; Excel + PDF export; KPI Dashboard'u |
| `yapilabilirlik` | `Yapilabilirlik.jsx` (2542) | `firestore.js` (361), `feasibilityPdf.js` (626), `schema.js` (354), `stats.js` (359), `toQuote.js` (111) | 4 353 | ISO FR-71.1/71.2 yapılabilirlik etüdü; puanlı değerlendirme (satış + teknik); 3 rol imza akışı; onaydan sonra tek tıkla teklife dönüşüm |
| `maliyet` | `Maliyet.jsx` (199) + 11 sekme | `firestore.js` (508), `productCostCalc.js` (568), `distributionCalc.js` (343), `inventoryCalc.js` (295), `currency.js` (133), `purchaseParser.js` (222), `overheadParser.js` (137), `suppliesParser.js` (140), `categoryMapper.js` (23), `exchangeRates.js` (56) | 9 331 | 11 sekmeli maliyet paketi (aşağıda 5.5'te detay); FIFO birim maliyet; aylık genel gider dağıtımı; sarf ortalaması; tezgah dakika ücreti; mamul recursive maliyet; fiyat listesi; envanter değeri snapshot; karlılık |

### 2.4. `src/shared/` — modüller arası ortak

| Dosya | Satır | Sorumluluk |
|---|---|---|
| `bomParser.js` | 240 | VIO Ürün Ağacı Excel parser'ı; op ≥600 = FASON kuralı + 653/654/665 istisnaları; INTERNAL_OP_DEFAULTS fallback; "hammaddesiz op" fix (v20 blocker'ı) |
| `weekUtils.js` | 62 | ISO hafta hesabı, hafta başı Pzt, iki tarih arası fark |
| `moneyFormat.js` | 9 | Binlik ayraç Türk lokali |
| `constants.js` | 1 | Placeholder — v20'de kuruldu, kullanılmıyor |

### 2.5. `functions/` — Cloud Functions

| Dosya | Satır | İçerik |
|---|---|---|
| `index.js` | 1116 | 17 fonksiyon exports (aşağıda 5.4'te tam liste) |
| `firestore.js` | 1333 | Admin SDK ile yazıcılar: `saveReport`, `saveSalesOrdersWithDiff`, `saveUnitCostPartitions`, `saveOverheadReport`, `saveSuppliesReport`, `saveCariEkstreReport`, `saveCocPartsReport`, `saveCocCertificatesReport`, `saveQuote*` (5 tane), `promoteQuoteStaging`, `saveCurrencyRates`, `saveMonthlyInventorySnapshot` |
| `parsers.js` | 1468 | 10 Excel parser: VIO Stok / Akıbet / Satın Alma / Sipariş / Genel Gider / Sarf / Cari Ekstre / COC KONF / COC Sertifika Listesi |
| `quoteParser.js` | 646 | 4 quote-specific parser (master data, arşiv, parts extract, customers extract) |
| `gmail.js` | 264 | OAuth client, `VIO_REPORTS` mail konfigürasyonu, attachment indir |
| `drive.js` | 553 | Service Account ile Drive arama + indirme (COC/FAI) |
| `tcmb.js` | 94 | TCMB XML kur çekim ve parse |
| `inventoryCalcSimple.js` | 84 | Snapshot cron için basit BUY/RAW × son alış hesabı |

### 2.6. Güvenlik kuralları

**Firestore** (`firestore.rules`): Basit — authenticated kullanıcı `appData/*` altındaki her şeyi okuyabilir/yazabilir. Yetki kontrolü client-side'da (rol string'i `users/{uid}.role`'den okunur, App.jsx sidebar filter + component internal `canEdit`). Bu bilinçli bir tercih — single-tenant, düşük istismar riski, prototip hız gereksinimi.

**Storage** (`storage.rules`): Aynı authenticated-any-write yaklaşımı; üç path prefix (`appData/`, `fai/`, `coc/`) tanımlı.

**Yetki mimarisi (client-side):** Sidebar `canSeeMRP` / `canSeeDigerMusteriler` / `canSeeTeklifler` / `canSeeYapilabilirlik` boolean'ları rol setine göre türetilir; her modül component'i kendi `canEdit = isAdmin || isUretim || isSales` gibi lokal türetme yapar. `maliyet` sadece admin.

---

## 3. Firestore Koleksiyonları

Tüm dokümanlar tek `appData` koleksiyonu altında (kullanıcı yönetimi hariç). Bazıları yıl-suffixli.

### 3.1. Konteyner + ürün + planlama (App.jsx sahibi)

| Doküman | Amaç | Ana alanlar | Yazar | Okur |
|---|---|---|---|---|
| `appData/state` | Konteyner planı (yıl bazlı `yearsData`), ürün listesi (`products`), sabit ayarlar (min/max KG, kombinasyon kuralları, dil) | `products[]`, `yearsData.{yıl}.containers[]`, `combRules`, `montajData` referansı | App.jsx (Sevkiyat Planı, Ürünler) | Tüm modüller |
| `montajData/state` | Montaj hattı planı | `hatDurumu`, WIP atamaları | MontajPlani | Dashboard, MRP |
| `appData/wipAssignments` | Hat üstündeki iş emirleri | `{pid, qty, hat, at}` | MRP + Montaj | MRP + Montaj |
| `appData/plsConfirmations` | Hat stoğu onayları | `{model: {qty, at, by}}` | MRP | MRP |
| `appData/userRegistry` | Kullanıcı rolleri master listesi | `{uid: {email, role, name}}` | Admin kullanıcı yönetimi modalı | App.jsx sidebar |
| `users/{uid}` | Tekil kullanıcı rol dokümanı | `{role}` | Kayıt/admin | Auth flow |

### 3.2. MRP + BOM + Çizelge (App.jsx > MRPPlanlama sahibi)

| Doküman | Amaç | Ana alanlar | Yazar | Okur |
|---|---|---|---|---|
| `appData/bomModels` | Ürün ağaçları (BOM modelleri) — VIO'dan yüklenen ağaçlar | `{modelKey: {modelCode, parts[]}}` her parça `{stockCode, level, parentIdx, qty, supplyType, ops[]}` | MRP Ürün Ağacı yükleme + BOM Explosion sırasında `_autoSupplyType` yazımı | MRP, digerMusteriler (READ-ONLY), maliyet |
| `appData/mrpBomMapping` | Ürün ↔ BOM eşleştirme, kategori override, bulk override | `{pid: modelKey}`, `_catOverrides[stockCode]`, `_bulkOverrides` | MRP eşleştirme UI | MRP, maliyet (envanter kategorisi) |
| `appData/mrpCache` | BOM Explosion sonucu cache (v18.9'dan beri) | Motor son çıktısı (grossReq, netAcik, purchase, production, fason) | MRP `runBomExplosion` | MRP (persistence için, refresh sonrası göster) |
| `appData/mrpStock` | VIO Stok Raporu (kalan miktarlar) | `{parts: {stockCode: {ambar, tedarik, ...}}}` | Cloud Function VIO mail cron veya manuel Excel yükleme | MRP, maliyet (envanter değeri) |
| `appData/mrpAkibet` | Bekleyen Operasyonlar (parça bazında iş yükü — v14 formatı) | `{parts: [...]}` | Cloud Function VIO mail cron veya manuel | MRP çizelge |
| `appData/mrpPurchase` | Sipariş Kontrol Listesi (açık PO'lar) | Belge no bazlı | Cloud Function veya manuel | MRP satın alma, maliyet birim maliyet |
| `appData/mrpRequirements` | Ürün ihtiyaç raporu | `{parts[]}` | MRP hesabı sonrası | MRP UI |
| `appData/mrpSchedule` | Kaydedilmiş çizelge çıktısı | Job listesi + WC yerleştirmesi | MRP `calculateSchedule` | MRP UI |
| `appData/schedJobOrder` | İş emri sırası (drag-drop kullanıcı kararı) | `{jobId: sortIndex}` | MRP drag-drop | MRP çizelge |
| `appData/schedOverrides` | Çizelge manuel override (WC değişimi vs.) | `{jobId: {wcId, note}}` | MRP override UI | MRP çizelge |
| `appData/workCenters` | İş merkezleri + kapasite + tatiller | `{centers[], holidays[]}` | MRP İş Merkezleri sekmesi | MRP, maliyet (tezgah dakika) |
| `appData/salesOrderStockIndex` | Diğer Müşteriler satış siparişlerindeki unique stok kodları (BOM eksik uyarısı için) | `{stockCode: true}` | Diğer Müşteriler yükleme sonrası | MRP (mamul kategorisi fallback) |

### 3.3. Diğer Müşteriler + COC + FAI (`src/modules/digerMusteriler/` sahibi)

| Doküman | Amaç | Ana alanlar | Yazar | Okur |
|---|---|---|---|---|
| `appData/salesOrders` | Satış siparişleri (Aselsan + Roketsan + Denma + serbest müşteriler); **3-tuple ID** `{belgeNo}_{stokKodu}_{teslimTarihi}` | Her key altında `{customerCode, customerName, stokKodu, stokAdi, belgeNo, orijinalMiktar, kalanMiktar, sevkEdilen, toplamBedel, teslimTarihi, ...}` | Diğer Müşteriler `handleFile` VE Cloud Function VIO cron (7×/gün) | Diğer Müşteriler, Müşteri Dashboard, MRP (motor girdisi Faz 2.1), COC iskelet |
| `appData/planOverrides` | Manuel hafta atamaları + `status: 'deferred' \| 'cancelled'` (akıbeti belirsiz) | `{orderId: {plannedWeek, note, by, at, origWeek, status?, migratedFrom?}}` | Diğer Müşteriler UI (drag-drop + status) | Diğer Müşteriler, MRP demand filter |
| `appData/shipments` | Sevk geçmişi (event-sourced); VIO diff'inden + cari ekstre'den beslenir | `{orderId: {events[{at, deltaQty, cumulative, source}], totalShipped, fullyDelivered, ...}}` | Cloud Function VIO diff + cari ekstre cron + manuel Excel yükleme | Müşteri Dashboard (OTD hesabı, aylık trend), Karlılık modülü |
| `appData/vioImportHistory` | VIO Import yükleme geçmişi audit | `{importId: {at, source, count, byRole}}` | App.jsx VIO Import ekranı | App.jsx VIO Import ekranı |
| `appData/automationLog` | Cloud Function çalıştırma log'ları | `{entries[{runAt, source, results[]}]}` | Cloud Function tümü | Diğer Müşteriler yükleme rozetı, Maliyet mail izleme rozetı |
| `appData/cocParts` | COC parça master (639 Aselsan + 11 Roketsan) | `{parts: {stokKodu: {description, faiNo, revisions[], customerCode, isSkeleton?, subComponents?}}}` | KONF Excel import + UI ekle/düzenle + salesOrders iskelet otomasyonu | COC modal, alt bileşen paneli |
| `appData/cocCertificates_{YYYY}` | Uygunluk Belgesi arşivi (year-bazlı — 1MB limit) | `{certificates: {certNoId: {certNo, siraNo, stokKodu, orderNo, subComponents, attachments, ...}}}` | Diğer Müşteriler COC modal + Excel migration | COC arşiv view, PDF üretimi |
| `appData/faiRecords_{YYYY}` | FAI kayıtları (yeni oluşturulan) | `{records: {faiNo: {form1, form2, form3, attachments, signatures, status}}}` | FAI modülü UI | FAI listesi, PDF üretimi |
| `appData/faiRecords_archive` | Drive'dan import edilen FAI arşivi | `{records: {faiNo: {stokKodu, folders[], webViewLink, ...}}}` | Cloud Function `listFaiArchiveFolders` | FAI stok bazlı uyarı banner'ı |
| `appData/driveConfig` | Google Drive entegrasyonu konfigürasyonu | `{roots[], foldersByCategory}` | Diğer Müşteriler > Drive Ayarları | `searchCocDrive` + `listFaiArchiveFolders` Cloud Functions |

### 3.4. Yapılabilirlik + Teklifler

| Doküman | Amaç | Ana alanlar | Yazar | Okur |
|---|---|---|---|---|
| `appData/feasibilityStudies_{YYYY}` | Yapılabilirlik etütleri (studyNo = `DF-YYAAGGXX`) | `{studies: {studyNo: {items, evaluations, decisions, signatures, status, score, quoteNo?}}}` | Yapılabilirlik modülü | Yapılabilirlik liste + KPI, Teklifler (yapılabilirlik → teklif dönüşümü), FAI (feasibility ilişkisi kaldırıldı 2026-07-21) |
| `appData/quotes_{YYYY}` | Teklifler (quoteNo = `TEK-YYAAGG-NN`, revizyon `/Rn` suffix) | `{quotes: {quoteNo: {customer, items, materials, fasonWorks, extras, revisionOf?, revisionReasonCode?, status, discountPct, terminDays, currency}}}` | Teklifler modülü + Excel import Cloud Function | Teklifler liste + KPI, Yapılabilirlik (silinen tekliften geri çöp), Karlılık modülü |
| `appData/quoteMaterials` | Hammadde master (ad, birim, TL fiyat, USD fiyat, kaynak URL) | `{materials: [...]}` | Master Data Excel yükleme + inline edit | Teklifler + Yapılabilirlik |
| `appData/quoteFasonWorks` | Fason iş master | `{works: [...]}` | Teklifler master ekle | Teklifler + Yapılabilirlik |
| `appData/quoteOptions` | Dropdown seçenekleri (kalem kategorisi, iş türü, sipariş miktarı vs.) | `{...}` | Teklifler ayarlar | Teklifler + Yapılabilirlik |
| `appData/quotePolicy` | Marj, KDV, ödeme koşulları vs. politikalar | `{marginPct, vat, ...}` | Teklifler ayarlar | Teklifler |
| `appData/quoteCustomers` | Müşteri master (ad, adres, tel, e-posta, döviz, master no) | `{customers: [...]}` | Teklifler yeni müşteri modalı | Teklifler + Yapılabilirlik |
| `appData/quoteParts` (10 bucket) | Parça kütüphanesi — stok kodu bazlı hafıza, `quoteParts0` … `quoteParts9` | `{parts: {stockCode: {name, weightKg, ops, materials, kullanimSayisi}}}` | Teklifler kalem düzenlerken hafızaya ekler | Teklifler yeni kalem seçici |
| `appData/quoteMachinesRef` | Tezgah referans (Maliyet modülünden kopya, teklifler snapshot'ı) | `{machines: [...]}` | Master Data import | Teklifler saatlik ücret |
| `appData/quote*_staging` | Excel import staging alanları (7 staging doc) | Aynı yapı, promote sonrası ana doc'a taşınır | Cloud Function `importQuoteExcelHttp` | `promoteQuoteStagingHttp` promotelayınca ana doc'a taşır |

### 3.5. Maliyet paketi (`src/modules/maliyet/` sahibi)

| Doküman | Amaç | Ana alanlar | Yazar | Okur |
|---|---|---|---|---|
| `appData/unitCosts` | FIFO birim maliyet partileri (VIO Sipariş Kontrol Listesi → belge no bazlı) | `{parts: {stockCode: {partitions[{belgeNo, tarih, qty, unitPrice, currency, unitPriceTry}]}}}` | Cloud Function VIO cron `saveUnitCostPartitions` + Excel eksik maliyet import | Birim Maliyetler sekmesi, Mamul Maliyetleri, Envanter |
| `appData/laborCosts` | İşçilik + aylık genel gider + WC dakika ücretleri konsolidasyonu | `{monthlyOverheads: {"YYYY-MM": {items[], totalTl}}, machineRates: {machineId: {ratePerMin}}}` | Aylık Genel Giderler + Tezgah Dakika Ücretleri sekmeleri | Mamul Maliyetleri, Fiyat Listesi |
| `appData/overheadCategoryMappings` | Aylık gider kalem kategorisi → dağıtım kriteri eşleştirme (elektrik→güç, bina→alan, makine→amortisman, diğer→eşit) | `{mappings: [...]}` | Aylık Genel Giderler UI (akıllı kural + manuel override) | `distributionCalc.js` dağıtım motoru |
| `appData/currencyRates` | TCMB günlük kur snapshot'ları (nested `rates.{YYYY-MM-DD}`) | `{rates: {"2026-08-01": {usd, eur, source, fetchedAt}}, lastFetch, lastDate}` | Cloud Function `fetchTcmbRatesDaily` (Pzt-Cum 16:30) + manuel HTTP tetik | Maliyet döviz toggle, Teklifler kur kaydı, Karlılık |
| `appData/productCostsLatest` | Mamul + tüm BOM parçaları için hesaplanmış maliyet snapshot'ı | `{byStockCode: {code: unitCost}, calculatedAt, month}` | Mamul Maliyetleri sekmesi sayfa açıldığında yazar | Cloud Function `takeMonthlySnapshot` fallback + snapshot doc |
| `appData/inventorySnapshots` | Aylık envanter değer snapshot'ları + kur donması | `{snapshots: {"YYYY-MM": {takenAt, totalValue, totalValueUsd, totalValueEur, ratesAt, byCategory}}}` | Cloud Function `takeMonthlySnapshot` (her ayın 1'i 11:00) + manuel HTTP + Envanter sekmesi manuel snapshot | Envanter sekmesi trend, Maliyet Dashboard |
| `appData/monthlyOverheadsHistory` | Aylık gider hareketli ortalama audit | `{history: [...]}` | Aylık Genel Giderler sekmesi | Aylık Genel Giderler UI |
| `appData/supplies` | Stok Sarf Hareketleri (kesici takım/yağ/PPE) | `{months: {"YYYY-MM": {items[]}}}` | Cloud Function VIO cron `saveSuppliesReport` + Excel manuel | Stok Sarf sekmesi (3/6/12 ay hareketli ortalama) → talaşlı imalat WC dağıtımı |
| `appData/fasonRates` | Fason ücretleri geçici tablosu (Sheet 1: KG bazlı 621/622, Sheet 3: op-parça, Sheet 4: komple fason) | `{opDefaults, partWeights, partOverrides, fasonComplete}` | Fason Ücretleri sekmesi Excel yükleme + inline edit | Mamul Maliyetleri (fason kolonu) |
| `appData/unitConversions` | BOM birimi ≠ satınalma birimi eşleştirme (streç film MT ↔ AD gibi) | `{conversions: {stockCode: {fromUnit, toUnit, factor}}}` | Birim Dönüşümleri sekmesi | Mamul Maliyetleri fiyat hesabı |
| `appData/machineRatesLatest` | Tezgah dakika ücreti snapshot (mail otomasyon TODO için hazır iskelet, henüz aktif kullanılmıyor) | `{byMachine, calculatedAt}` | Tezgah Dakika Ücretleri sekmesi (manuel "Snapshot al") | Henüz okuyan yok — planlanan mail cron için |
| `appData/priceListSettings` | Fiyat Listesi sekmesi tercihleri (marj, filtreler, level) | `{settings}` | Fiyat Listesi UI | Fiyat Listesi UI |

Toplam: **~50 aktif Firestore dokümanı**. Yıl-suffixli olanlar (2024/2025/2026) her yıl bir doküman büyür.

---

## 4. v20 → v21 Arası Yenilikler

v20 → v21 arasında yaklaşık **378 commit** atıldı. Aşağıda büyük paketler kronolojik + tematik.

### 4.1. Faz 2 tamamlanması (Nis sonu – May başı)

- **Faz 2.1 — Motor adaptörü** (PR #12, `99ec682`): `salesOrders` MRP motoruna girdi olarak eklendi; `mergedDemand.byProduct` konteyner + sipariş birleşik havuzu; her satırın `source` etiketi korunur; pseudo-pid şeması (500000+ ID'ler Aselsan/Roketsan ürünleri için); autoMap preview modal
- **Faz 2.2 — Ürün Özet 2 kart** (aynı PR): 📦 Konteyner ve 🤝 Sipariş filtreleri (ayrı kartlar); alt seviyelerde (Satınalma, Üretim, Fason, Çapraz Uyumsuz) birleşik kalır çünkü hammadde paylaşımlı
- **Faz 2.3 — Sipariş Bazlı İhtiyaç paneli**: **hâlâ askıda**. Sevkiyat Bazlı İhtiyaç paneli kutsal, paralel yeni panel bekleniyor
- **Faz 2.4 — Override stale uyarısı** (PR #15, 27 Nis): `staleOverrides` hook; sarı accordion; "↻ VIO'ya Güncelle" tek-tıkla
- **Faz 2.5 — Müşteri Dashboard** (aynı PR): Yeni sidebar sekmesi 📈; `shipments` doküman şeması + VIO diff olayları; 6 widget + gelecek 6 ay yükü grafiği (plan vs müşteri 2 bar); recharts kütüphanesi eklendi
- **PR #17 — Faz 1B mail otomasyonu 4. rapor**: `parseSalesOrdersReport` Cloud Function eklendi (sabah 9-11 arası her 15 dk + öğle 12/15)
- **PR #19-20 — Deferred-aware diff + replacement detection**: Teslim tarihi güncellemesinin sahte `vio-removed` event yazımı bug'ı çözüldü; `hasReplacementInVio` mantığı; `migrateOverrideIfReplacement` helper

### 4.2. BOM parser fix + MRP paketi (Nisan sonu – Haziran)

- **`c524b1b` — BOM parser cross-BOM override bug**: op yerleşimi bozan hata + confirm modal (window.confirm → React modal geçişi)
- **`9a036f8` — MRP 600+ FASON istisnaları**: 653/654/665 iç işlem; WC kod input (VIO uyumlu); INTERNAL_OP_DEFAULTS fallback
- **`dd4074c` — MRP Doluluk Oranı paneli yeniden tasarım**: Tezgah Yük Özeti birleşik
- **`a61c6d8` — 4 bug fix paketi**: kapasite/çizelge sağlığı
- **`4ca4cc1` — MRP eşleşme bekleyen**: sevkiyat/sipariş demand alt-grup kırılımı

### 4.3. Maliyet paketi (Nis sonu – Ağu başı, 6 faz)

`project_maliyet_yol_haritasi.md`'de detay. Kısa özet:

- **Faz 1 — Birim maliyet FIFO partileri** (canlı, May 11): VIO Sipariş Kontrol Listesi parser + Cloud Function `saveUnitCostPartitions`; Alt Hesap Döviz net → TRY/USD/EUR
- **Faz 2 — Aylık Genel Giderler** (canlı, May 11): VIO Hizmet Total Raporu parser (çoklu ay tek dosya, dinamik 4/10 kolon); akıllı kategori→kriter mapping; hareketli ortalama (SuppliesTab paterni)
- **Faz 2 — Tezgah Dakika Ücretleri** (canlı, May 12): Tek havuz + 4 ağırlık karışımı (40/30/10/20); WC-bazlı maaş eşleştirme; satınAlma USD/EUR kur; manuel sanal ekipman/personel; Stok Sarf katkısı (`supplyPay`)
- **Faz 2 — Stok Sarf Hareketleri** (canlı, May 13): Kesici takım/yağ/PPE; hareketli ortalama (3/6/12 ay); `policy.supplyWcCodes` ile talaşlı imalat WC'lerine dağıtım
- **Faz 3 — Mamul Maliyet** (canlı, May 12): Recursive BOM; son alış fiyatı; WC ort. işçilik; supplyType bazlı; 3 katmanlı stok kodu fallback; veri kalitesi rengi (🟢 Tam / 🟡 Kısmi / 🔴 Eksik / ⊘ BUY parent)
- **Faz 4B — Envanter Değeri** (canlı, May 12): Anlık + çeyrek snapshot; kur donması (`ratesAt` + totalValueUsd/Eur); BOM bazlı 2 katmanlı kategori (Mamul/Yarı Mamul/Hammadde/Satın Alma/BOM Dışı); MRP `_catOverrides` öncelikli
- **Faz 5 — Karlılık** (canlı, ~Haziran): Ürün × kanal birim karlılık; güncel rootCost vs güncel satış fiyatı; BOM'u olmayan doğrudan alıp-satılan ürünler dahil
- **Faz 5 — Fiyat Listesi** (canlı, Ağustos): Maliyet + marj → Excel/PDF export; 3 görünüm modu; hesap ayı Mamul Maliyetleri ile paylaşımlı
- **Fason Ücretleri** — geçici tablo (Sheet 1 KG-only 621/622, Sheet 3 diğer op'lar, Sheet 4 komple fason); Fason Takip Modülü gelene kadar
- **Döviz toggle** (canlı, May 13): TL/USD/EUR ortak toolbar; manuel kur override + TCMB hibrit; snapshot tarihsel kur
- **TCMB cron** (canlı, May 13): `fetchTcmbRatesDaily` (Pzt-Cum 16:30) + `fetchTcmbRatesHttp` (retroaktif)
- **Aylık envanter snapshot cron** (canlı, ~May 20): `takeMonthlySnapshot` her ayın 1'i 11:00

**Aktif değil (askıda):** Faz 4A FIFO sevkiyat maliyeti (state-free replay tasarımı hazır)

### 4.4. COC (Uygunluk Belgesi) modülü (Haziran)

`project_coc_live.md`'de detay. Kısa özet:

- **Faz 1A/1B/1C** — Backend + parça master + sertifika oluşturma modal + PDF üretimi (html2canvas + jsPDF A4) + 1679 sertifika geçmiş arşivi
- **Faz 2A-2E** — Doküman yönetimi (Firebase Storage; kategori bazlı master tekrar kullanım; çoklu dosya yükleme; "Uygulanmaz" toggle; ZIP indir; Drive entegrasyonu)
- **Faz 3+4 — Alt bileşen sistemi** (Temmuz): Montajlı parça 9 fazlı alt bileşen belge takibi (`subComponents.js` helper'ı); BOM/manuel toggle; `requiresCoc` override; belge yükleme 3 kanal (manuel, Drive öner, kütüphane geçmişi); ZIP'te `Alt Bilesenler/{stokKodu}/` klasör yapısı; snapshot Firestore audit
- **`0e05904` — Tüm müşterilere açıldı** (Temmuz): A+R kısıtı kaldırıldı
- **FAI kolonu entegrasyonu** (`e42ff21`): COC listesinde FAI kolonu + 1-tıkla yeni FAI

### 4.5. FAI (İlk Ürün Muayenesi) modülü (Temmuz)

`project_fai_canlida.md`'de detay. 9 faz (F-1 → F-9C):

- **F-1** backend + veri modeli (SAE AS9102 3 form şeması)
- **F-2** UI (3 sekmeli form + parça arama)
- **F-3** karakteristik N Yer + uygunsuzluk highlight
- **F-4** belge yükleme (7 kategori)
- **F-5** PDF (SAE AS9102 3 sayfa; perf optimizasyonu ~30MB → ~3-5MB)
- **F-6** ZIP paketi (PDF + kategori klasörleri)
- **F-7** onay akışı + 3 imza + status
- **F-8** yapılabilirlik → 🔬 FAI Başlat entegrasyonu (sonradan kaldırıldı)
- **F-9A** form içinde Drive'dan belge arama (mevcut `searchCocDrive` kullanır)
- **F-9B** Drive arşiv import (yeni Cloud Function `listFaiArchiveFolders`)
- **F-9C** stok bazlı arşiv uyarısı

**Ek:** Kısmi (Delta) FAI oluşturma akışı; CMM ölçüm raporu (FR-92.1 PDF) otomatik import; Form 2 malzeme/süreç master + tedarikçi master + supplier combobox; Excel import PR-1/PR-2.

### 4.6. Yapılabilirlik modülü (Temmuz sonu)

- **Y-1 → Y-6** — Backend + UI + kalem detay tablosu + değerlendirme departman accordion + operasyon süre bölümü + bilgi hazırlığı entegrasyonu + PDF çıktısı (modern minimal) + teklife dönüşüm
- **Sadeleştirme paketi** (`fb1bbb4`): 3 rol/dept, çok sayfa PDF
- **Puanlı değerlendirme + öneri + koşullu GM imzası** (`79e5a71`)
- **Aşamalı iş akışı + sidebar bildirim rozeti** (`d0d29a8`)
- **Multi-material desteği** (`2bffd4a`): `additionalMaterials` array
- **Toplu seçili → tek teklif** (`e151013`)
- **KPI Dashboard sekmesi** (`cae2ac6`)
- **Aşama süreleri kayan pencere** (`88d1203`): son 10 + dağılım tooltip
- **CMM raporu otomatik aktarım** (`05d4674`)

### 4.7. Teklifler modülü (Haziran ortası – Ağustos başı)

- **Faz 0** — Excel master data + arşiv import altyapısı (`70a08fb`)
- **Faz 1** — Parça kütüphanesi (10 bucket bölünmüş — 1MB limit); marj editörü; müşteri master; Yeni Teklif formu
- **Kalem detay paneli + makine oran entegrasyonu + fason öneri** (`24d357b`)
- **Aparat/kalıp 'Adete Yay' vs 'Ayrı Satır' modu** (`c09ec8f`)
- **A4 dikey modern minimal PDF** (`ef858a5`)
- **PDF multi-page + Excel export** (`f73685d`)
- **Satır bazlı marj override** (`bfc0e27`)
- **Teklif revizyon sistemi R1/R2 zinciri + /Rn suffix** (`fce885a`)
- **Master TL↔USD otomatik + Master Data'da manuel fiyat edit** (`5f7ea3c`)
- **Hammadde Fiyatı yönetim tabı** — çoklu stok eşleşme + öneri (`ba58591`, `cc1a763`)
- **Birim çevirisi 3 katmanlı fallback + inline factor input** (`3b2c942`)
- **KPI sekmesi** (`fe5a4c3`); Durum donut'una arşiv dilimi; ciro sıralaması
- **Arşiv döviz teklifleri o yılın ortalama TCMB kuruyla normalize** (`4cd0ac0`, `f76898c`)
- **PDF/Excel indirmede otomatik "Gönderildi"** (`ff98011`)
- **Dönüşüm KPI** (`cfcec50`): 3 metrik
- **Müşteri Teklif No — yapılabilirlik'ten aktar** (`a436407`)

### 4.8. Diğer önemli değişiklikler

- **Cari ekstre A+R sevk otoritetif kaynağı** (`8bcdf67`, Haziran 22): VIO sipariş raporu sevkEdilen yaklaşık olduğu için authoritative değil; A+R sevkleri `fetchCariEkstreWeekly` (Pzt 08:30) Cloud Function'ından; EKSTRE_ ID şeması; ödünç termin eşleşme; Aselsan TL / Roketsan USD döviz farkındalığı
- **Dashboard YTD KPI satırı** (`e965e24`): toplam alındı + net sevk + iade
- **Sevkiyat Planı VIO Import — vioCode çift kontrol** (`83906b8`, `57aa344`)
- **Ürünler VIO kodu inline edit** (`899c896`)
- **Palet etiket 100×135mm boyut seçeneği** (`875672a`)
- **DĞR sanal grubu** (`5ad1c7e`): Bilinmeyen müşteriler tek kartta
- **Otomatik plan + Planı Temizle toplu işlemler** (`dc48b30`): admin bulk actions
- **Plan Sırası Tutarsız paneli** (`da05de3`): pasif uyarı → modal → forward-fill algoritma
- **Orphan override uyarı paneli** (`1155ed6`): admin-only
- **Hafta listesi accordion** (`69dc8ea`): default kapalı
- **6 ay yükü grafiği altına ortalama plan kayması** (`ab2a0e2`)

---

## 5. BOM Patlatma Motoru

BOM Patlatma Motoru sistemin kalbi — mamul talebini alıp her hammadde/yarı-mamul için net ihtiyacı, hangi tezgahta ne kadar süre iş yapılacağını, hangi tarihte sipariş verileceğini üretir.

### 5.1. Konum

Motor **`src/App.jsx` içinde**, `MRPPlanlama` component'inin lokal scope'unda. Refactor edilmemiş — Faz 1A retrospektifinde "Senaryo B" kararı: dokunulmuyor, yeni özellikler modül klasörlerinde. Ana giriş: `runBomExplosion()` (satır ~6759) + `calculateSchedule(silent, forceMrp)` (satır ~7342).

### 5.2. Girdiler

Motor şu Firestore doküman + state kombinasyonundan beslenir:

- **`appData/bomModels`** — ürün ağaçları (parça listesi + operasyonlar)
- **`appData/mrpBomMapping`** — pid ↔ modelKey eşleştirme + `_catOverrides` + `_bulkOverrides`
- **`appData/mrpStock`** — VIO Stok Raporu, mevcut envanter (ambar + tedarik)
- **`appData/mrpAkibet`** — Bekleyen Operasyonlar (v14 formatı, WIP)
- **`appData/mrpPurchase`** — açık satın alma siparişleri
- **`appData/workCenters`** — iş merkezleri + kapasite + tatiller (`holidays[]`)
- **`appData/plsConfirmations`** — hat stoğu onayları
- **`appData/wipAssignments`** — hat üstündeki iş emirleri
- **`appData/schedJobOrder`** — kullanıcı drag-drop sırası
- **`appData/schedOverrides`** — çizelge manuel override'ları
- **`unshippedDemand.byProduct`** (App.jsx yıllık konteyner planından türetilir) — konteyner kaynaklı talep
- **`salesOrders`** (Faz 2.1 sonrası) — satış siparişi kaynaklı talep (`planOverrides.status === 'deferred'` filtrelenir)
- **Sarı/Yeşil renk politikası** — SLA + öncelik seçimi

Girdi birleştirme `mergedDemand.byProduct` memo'sunda yapılır — konteyner + satış siparişi tek havuza döner, her satırın `source` etiketi (`'container' | 'salesOrder'`) korunur. Ürün Özet iki kartı bu etiketi filtreler.

### 5.3. Çıktılar

Motor şunları üretir:

- **Brüt İhtiyaç** (`grossReq`) — ham hammadde talebi (stok düşülmeden)
- **Net Açık** — stok + WIP + açık PO düşüldükten sonra kalan
- **Satınalma önerileri** — hangi hammaddeden ne kadar, ne zamana kadar
- **Üretim iş emirleri** — hangi parça hangi WC'de ne süre + hangi hafta
- **Fason iş emirleri** — hangi op fason'a gider
- **Çapraz Uyumsuz** — BOM'da eksik veya çakışan parçalar (kırmızı uyarı)
- **Çizelge Doluluk** — WC bazında iş yükü ve boş slotlar
- **Ürün Özet** — hangi mamulden ne kadar üretilecek (kaynak kırılımlı)
- **Sevkiyat Bazlı İhtiyaç paneli** — hangi konteyner için hangi hammadde eksik (kutsal panel, dokunulmuyor)

Çıktılar `appData/mrpCache` doküman'ına yazılır (persistence — refresh sonrası göster) + `appData/mrpRequirements`, `appData/mrpSchedule` gibi ilişkili özet dokümanlara.

### 5.4. Cloud Function bileşenleri

Motor kendisi Cloud Function değil (client-side hesap). Ancak girdi verileri cron ile beslenir:

| Function | Cron / Trigger | İş |
|---|---|---|
| `fetchVioReportsHttp` | HTTP manuel | Gmail'den 4 rapor çek + Firestore'a yaz |
| `fetchVioReportsMorning` | Pzt-Cum 09:00-11:00 her 15 dk | Aynı, sabah yoğun |
| `fetchVioReportsMidday` | Pzt-Cum 15:00 + 19:00 | Aynı, gün içi düzeltme + akşam |
| `fetchTcmbRatesDaily` | Pzt-Cum 16:30 | TCMB XML kur çek |
| `fetchTcmbRatesHttp` | HTTP manuel | Retroaktif kur çek (opsiyonel `?date=`) |
| `takeMonthlySnapshot` | Her ayın 1'i 11:00 | Aylık envanter değer snapshot'ı |
| `takeMonthlySnapshotHttp` | HTTP manuel | Retroaktif snapshot |
| `deleteMonthlySnapshotHttp` | HTTP manuel | Snapshot sil |
| `fetchCariEkstreWeekly` | Pzt 08:30 | A+R cari ekstre → shipments |
| `uploadCariEkstreHttp` | HTTP manuel | Cari ekstre Excel yükle |
| `uploadCocFileHttp` | HTTP manuel | COC parça/sertifika Excel yükle |
| `searchCocDrive` | onCall (client'tan) | Drive'da COC belgesi ara |
| `listFaiArchiveFolders` | onCall | Drive'da FAI klasörü listele |
| `importCocDriveFile` | onCall | Drive'dan Storage'a dosya kopyala |
| `importQuoteExcelHttp` | HTTP manuel | Teklif Excel'i staging'e yükle |
| `promoteQuoteStagingHttp` | HTTP manuel | Staging → ana quotes_YYYY promote |
| `cleanupNonTrackedShipmentsHttp` | HTTP manuel | Cari ekstre öncesi eski VIO A+R kayıtlarını temizle |

Toplam **17 Cloud Function** aktif. Ayrıca `functions/index.js` içinde `unlinkFeasibilityByQuoteNoHttp` bir kerelik migration olarak eklenip silindi (`d1c8c02`).

### 5.5. Maliyet paketi — 11 sekmeli alt-modül

Maliyet modülü kendi başına bir uygulama gibi — `Maliyet.jsx` root'unda 11 sekme, hepsi Firestore'a bağımsız yazar/okur:

| Sekme | Faz | Aktif | Sorumluluk |
|---|---|---|---|
| 📊 Dashboard | 4 | ✅ | Envanter trendi, KPI'lar, aylık snapshot grafiği |
| 🗓 Aylık Genel Giderler | 2 | ✅ | Elektrik/su/doğalgaz/kira/amortisman aylık totalleri |
| 🛢 Stok Sarf Hareketleri | 2 | ✅ | Kesici takım, yağ, PPE — talaşlı imalat WC'lerine dağıtım |
| ⚙️ Tezgah Dakika Ücretleri | 2 | ✅ | Aylık dağıtım algoritması sonucu (dakika başı TL) |
| 🏷 Birim Maliyetler | 1 | ✅ | FIFO partili birim maliyet (VIO Sipariş Kontrol Listesi) |
| 🔀 Birim Dönüşümleri | 1 | ✅ | BOM birimi ≠ satınalma birimi eşleştirme |
| 🔧 Fason Ücretleri | 3 | ✅ | Geçici tablo, fason takip modülü gelene kadar |
| 📦 Mamul Maliyetleri | 3 | ✅ | Recursive BOM maliyeti (hammadde + işçilik + fason) |
| 💰 Fiyat Listesi | 3 | ✅ | Maliyet + marj → satış fiyatı (Excel/PDF export) |
| 🚛 Sevkiyat Maliyetleri | 4 | ⏳ | Faz 4A — FIFO bazlı, henüz aktif değil |
| 📚 Envanter Değeri | 4 | ✅ | Anlık + çeyrek snapshot + kur donması |
| 💵 Karlılık | 5 | ✅ | Ürün × kanal birim karlılık |

### 5.6. Dokunulmaz alanlar

Bu fonksiyon/veri yapıları refactor edilmemeli — kullanıcı kararlarıyla stabil kabul edildi:

- `runBomExplosion()` iç mantığı — mergedDemand ekleme dışında dokunulmuyor
- `calculateSchedule(silent, forceMrp)` parametre imzası
- `plsConfirmedLookup` yumuşak güncelleme
- `pNum()` fonksiyonları (`typeof === "number"` kontrolü v18.16'dan beri)
- `parseAkibetExcel` alanları
- `salesOrders` **3-tuple ID** şeması (`{belgeNo}_{stokKodu}_{teslimTarihi}`) — 2-tuple'a dönme %57 collision riski
- `_bulkOverrides` Firestore alanı
- `_catOverrides` Firestore alanı (MRP kategori override — envanter kategorizasyonu buna bağlı)
- Gmail mail pencere süresi (24 saat bilinçli)
- `INTERNAL_OP_CODES` set (653/654/665) + `INTERNAL_OP_DEFAULTS`
- **Sevkiyat Bazlı İhtiyaç paneli** — Faz 2'de kutsal, Sipariş Bazlı paralel panel olacak
- `shipments.events[].source` string sözlüğü (`vio-update`, `vio-removed`, `manual-shipment` — forward-compat)
- COC alt bileşen `subComponents` snapshot şeması (Faz 5 edit UI eklenirken şema korunacak)

---

## 6. Açık İşler

### 6.1. Askıdaki büyük paketler

- **Faz 2.3 — Sipariş Bazlı İhtiyaç paneli** (`project_faz2_ilerleme.md`): ~600 satır paralel panel; Sevkiyat Bazlı İhtiyaç kutsal kalır; Aselsan BOM yükleme stabilize sonrası
- **Faz 4A — FIFO Sevkiyat Maliyeti** (`project_maliyet_yol_haritasi.md`): Replay-based, state-free; mail cron entegrasyonu tasarımı hazır
- **Fason Takip Modülü**: Siparişler + tedarikçi + fiyat + gecikme + performans; büyük paket; şu an "Fason Ücretleri" sekmesi geçici çözüm
- **Per-machine calendar paketi** (`project_per_machine_calendar.md`): Çift vardiya + kısmi tatil + hafta sonu mesai — üçü aynı mimariyi paylaşır, tek pakette refactor
- **İlk boş gün hesabı** (`project_ilk_bos_gun_hesabi.md`): Tezgah "boş slot" hesabı işler arası ilk açıklığa çevrilecek; 3 yerde helper duplication
- **BOM Yönetimi birleşik modülü** (v20'de tasarlandı): Upload + eşleştirme tek ekran; ~190 BOM yükleme senaryosu için gerekli; henüz kod başlamadı

### 6.2. TODO'lar (memory'de mevcut)

- **COC alt bileşen PDF sunumu** (`project_coc_altbilesen_pdf_todo.md`): 2 yaklaşım denendi, ikisi de A4 clip sorunu; 2026-07-21 tamamen kaldırıldı; multi-page için ayrı çalışma bekliyor
- **COC parça master faiNo arşiv senkron** (`project_coc_fai_master_sync_todo.md`): `partMaster.faiNo` boş ama arşivde varsa otomatik güncelleme; 2026-07-20 "mevcut yeterli" denerek ertelendi
- **Overhead skip kuralı güçlendirme** (`project_overhead_skip_kurali_guclendirme.md`): Aylık Genel Giderler mail tarihi vs ay sonu karşılaştırması; kısmi mail engelleme; 3 dosya paralel + functions deploy
- **Tezgah dakika ücretleri aylık mail** (`project_todo_tezgah_rates_mail.md`): Analiz + plan hazır; kullanıcı 2026-07-14 "sonra karar veririz" dedi; `machineRatesLatest` snapshot iskeleti hazır, Cloud Function henüz yazılmadı; Gmail scope `readonly` → `send` genişletme + refresh token gerekir
- **OTD ödünç match izleme** (`project_otd_borrowed_match_izleme.md`): %67 sabit görünüyor, ödünç match yanılgısı şüphesi; kullanıcı 2026-07-16 "izleyelim" dedi; gerekirse A+C fix (sadece TAM match + gerçek `orijinalMiktar` kontrolü)

### 6.3. Bilinen bug/risk noktaları

- **Sarf stok tutarsızlığı** (`project_sarf_stok_tutarsizlik.md`): VIO'da kesici takım/kesme yağı giriş kayıtlı ama tüketim eksik → envanter şişkin, maliyet tahmini; 12 aylık hareketli ortalama zaten uygulanıyor
- **Snapshot productCosts bağımlılığı** (`project_snapshot_productcosts_bagimliligi.md`): Aylık snapshot mamul/yarı mamul için `productCostsLatest` doküman'ına bağımlı; Mamul Maliyetleri sekmesi ay içinde açılmazsa doküman stale olur; şu an manuel disiplin yeterli
- **Replacement detection** (`project_replacement_detection.md`): 3-tuple ID yan etkisi (teslim tarihi değişimi eski ID'yi düşürür); `hasReplacementInVio` + `migrateOverrideIfReplacement` çözümü canlıda; sadece 1-1 replacement için otomatik taşınıyor, birden fazla aday orphan bırakılıyor

---

## 7. Alınan Kararlar

### 7.1. Mimari kararlar

- **Sample data gitignore approach** (`feedback_sample_data_gitignore.md`): Gerçek müşteri verisi repo'ya girmez; `docs/samples/` altında gitignore + README (prose'dan yazılır, orijinali okumak yasak, parser yükleme yasak)
- **DigerMusteriler permissions** (`project_diger_musteriler_permissions.md`): Sidebar `canSeeMRP` reused (yeni `canSeeDigerMusteriler` tanımlanmadı); component internal `canEdit` prop'tan türetilir; `MRPPlanlama`'nın scope-local `canEdit`'ine dışarıdan bağımlılık yok
- **3-tuple ID scheme** (`project_id_scheme_3tuple.md`): `salesOrders` key = `{belgeNo}_{stokKodu}_{teslimTarihi}`; v19'un 2-tuple'ı %57 collision üretiyor; `planOverrides` key'i aynı format; cross-customer collision yok, prefix gerek yok
- **Per-machine calendar** (`project_per_machine_calendar.md`): Çift vardiya, kısmi tatil, hafta sonu mesai — üçü aynı mimariyi paylaşır, tek pakette refactor; şu an `holidays[]` `(string | { date, mode, machineIds })[]` legacy uyumlu
- **Currency toggle nested field** (`project_currency_toggle.md`): `currencyRates.rates.{YYYY-MM-DD}` nested map; Firestore `update()` ile dot-notation; `set + merge` YANLIŞ (flat field oluşturur); snapshot `ratesAt` ile o günün kuru donar
- **VIO parser exact match** (`feedback_parser_exact_match.md`): `h.includes()` tehlikeli (yeni kolon çakışır); `h === "..."` exact match tercih; bug iki tarafta olabilir (src + functions)
- **Cari ekstre A+R otoritetif kaynak** (`project_cari_ekstre_live.md`): VIO sipariş raporundaki sevkEdilen değer yaklaşık; A+R sevkleri cari ekstreden; VIO diff sadece `salesOrders` günceller, `shipments` A+R için SKIP; `TRACKED_CUSTOMERS` prefix listesi 3 dosyada paralel
- **A+R para birimleri** (`project_arole_currency.md`): Aselsan TL, Roketsan USD; parser müşteri başlığı altındaki etiketi yakalar; USD → TL Dvz Kur ile
- **Envanter kategorizasyon 3 katman** (`project_envanter_kategorizasyon.md`): MRP `_catOverrides` (kullanıcı manuel) → BOM supplyType + isim regex → products/salesOrders mamul fallback; regex 2 yerde duplicate
- **Snapshot productCosts bağımlılığı** (`project_snapshot_productcosts_bagimliligi.md`): Aylık snapshot Mamul Maliyetleri sekmesi yazan doküman'a bağımlı; manuel disiplin
- **Sevkiyat Bazlı İhtiyaç kutsal** (`feedback_sevkiyat_bazli_ihtiyac_kutsal.md`): Faz 2'de bu panel asla değiştirilmez, Sipariş Bazlı paralel panel

### 7.2. Süreç/geliştirme kararları

- **Dev server workflow** (`project_dev_server.md`): Ömer `npm run dev` port 3000 manuel çalıştırır; Claude Code kendi başlatmaz (port çakışması)
- **Working rhythm Faz 1A** (`feedback_working_rhythm.md`): Auto-approve read-only tools (git status/diff/log, ls, cat, grep, lsof); Write/Edit için sor; per-step plan → approve → code → browser test → closure table
- **Trust framework Adım 5-8** (`feedback_trust_framework_adim5_8.md`): Auto-Write modül scope'unda; stop-and-ask App.jsx, mevcut Firestore write, arch changes, npm install, edge cases, git push, Adım 9 merge
- **Trust framework v2 — safe changes auto-execute** (`feedback_trust_framework_v2_faz1a_sonrasi.md`): Güvenlik protokolüne uyan mevcut durumu bozmayan değişimlerde tüm deploy zinciri tek hamlede yürütülür; kırmızı çizgiler korunur (App.jsx, mevcut Firestore, npm install, arch)
- **Deploy check user-side** (`feedback_deploy_check_user_side.md`): Ömer Vercel dashboard açık, Ready kontrolünü o yapar; Claude Code polling yapmaz, sorar
- **Deploy skip preview check** (`feedback_deploy_skip_preview_check.md`): Küçük modül-içi değişimlerde preview atlanır → direkt merge → sadece prod Ready; büyük değişimlerde preview şart
- **Direkt main push küçük işler** (`feedback_direct_main_push_kucuk_isler.md`): Branch protection yok; küçük modül-içi değişimlerde PR atla; Cloud Functions / yeni feature için PR şart
- **Post-merge branch discipline** (`feedback_post_merge_branch_discipline.md`): `gh pr merge --delete-branch` sonrası hemen `git pull && git checkout -b yeni-branch`; main'de kalıp commit atma riski
- **Local build check** (`feedback_local_build_check.md`): App.jsx'e 50+ satırlık edit sonrası mutlaka `npm run build`; preview'a push etmeden syntax/duplicate hataları yakalar
- **Cloud Functions deploy ayrı** (`feedback_cloud_functions_deploy_ayri.md`): `functions/` değişen her PR merge'inden sonra `firebase deploy --only functions` zorunlu; Vercel otomatik etmez
- **Mail otomasyon rapor ekleme** (`project_mail_otomasyon_rapor_ekleme.md`): Yeni rapor eklerken OAuth secrets'a dokunma, sadece 5 kod adımı + functions deploy
- **No git credential API calls** (`feedback_no_git_credential_api_calls.md`): Git credential helper'dan PAT çekip API çağrısı yapma; gh CLI kur veya copy-paste text ver
- **Modal over window.confirm** (`feedback_modal_over_window_confirm.md`): Birden fazla tetiklenebilen onaylarda `window.confirm` kullanma → Chrome dialog suppression; React modal + Promise pattern

### 7.3. MRP + fason kararları

- **MRP fason istisnaları** (`project_mrp_fason_istisnalar.md`): Op ≥600 = FASON kuralına 653/654/665 iç işlem istisnası; Kalite Kontrol WC kodu 600 (VIO uyumlu); Savunma Montaj 301; `INTERNAL_OP_DEFAULTS` fallback + `resolveDefaultWC` encoding-agnostik

---

## 8. Yeni Oturum Sahipleri İçin

### 8.1. Sistem durumu (7 Ağustos 2026)

- Vercel `sevkiyat-pro.vercel.app` aktif; `main` branch canlı
- Cloud Functions (17 aktif) `europe-west1`; her deploy sonrası `firebase deploy --only functions` gerektiği unutulmamalı
- Firestore ~50 aktif doküman; büyük olanlar yıl-suffixli (`quotes_YYYY`, `cocCertificates_YYYY`, `feasibilityStudies_YYYY`, `faiRecords_YYYY`)
- Aktif kullanıcı: Ömer (admin) + satış rolü + üretim rolü kullanıcıları
- Günlük veri hacmi: 800-900 aktif satış siparişi, ~200 aktif konteyner, ~1700 COC arşivi, ~50 yapılabilirlik/ay, ~10 teklif/ay

### 8.2. Sistemi anlamak için sıra

Yeni bir developer/AI oturumunda okuma sırası:

1. Bu döküman (v21) — mimari + karar özeti
2. `project_faz2_ilerleme.md` — Faz 2 nerede kaldı
3. `project_maliyet_yol_haritasi.md` — Maliyet paketi yol haritası
4. `project_coc_live.md` + `project_fai_canlida.md` — COC + FAI durumu
5. İlgili özel karar dosyaları (memory `project_*.md` + `feedback_*.md`)
6. `SEVKIYAT_PRO_YEDEK_DOKUMAN_v20.md` — Faz 1A/1B tarihçesi + eski kararlar
7. `FAZ_2_PLAN.md`, `FAZ_1A_RETROSPEKTIF.md` — daha eski oturum notları

### 8.3. İlk oturum kırmızı çizgiler

Bir yeni oturumda dokunulmayacaklar:

- **App.jsx modül dışı edit** — mimari onay iste
- **Mevcut Firestore koleksiyonlarına yazma** — sadece kendi modül klasöründeki dokümanlara yaz
- **npm install** — dur, sebep açıkla
- **Sevkiyat Bazlı İhtiyaç paneli** — dokunma
- **3-tuple ID şeması** — 2-tuple'a dönme
- **`runBomExplosion` iç mantığı** — girdi ekleme dışında dokunma
- **VIO parser `h.includes()` kullanma** — `h === "..."` tercih
- **`window.confirm` çoklu-tetiklenen onaylarda kullanma** — React modal
- **Cloud Functions deploy atlanmasın** — `functions/` değiştiyse `firebase deploy --only functions`

### 8.4. Deploy zinciri

Küçük modül-içi değişim (safe):
1. Branch aç veya direkt main
2. Edit + commit
3. `npm run build` (App.jsx 50+ satırlık ise)
4. Push
5. Ömer prod Ready kontrol
6. Ömer canlı test

Büyük değişim (yeni modül, App.jsx modül-dışı edit, Cloud Functions):
1. Branch aç
2. Edit + commit
3. `npm run build`
4. Push + PR
5. Ömer preview Ready kontrol
6. Merge (`gh pr merge --delete-branch`)
7. **Cloud Functions varsa** `firebase deploy --only functions`
8. Ömer prod Ready kontrol
9. Ömer canlı test

---

## 9. İstatistik

- **Toplam kod satırı** (frontend + functions): ~57 000 satır
  - `src/App.jsx`: 17 064
  - `src/modules/`: ~35 000 (digerMusteriler 10 206, maliyet 9 331, teklifler 6 331, yapilabilirlik 4 353, FAI 4 560, shared 312)
  - `functions/`: ~4 500
- **Aktif Firestore dokümanı**: ~50
- **Aktif Cloud Function**: 17
- **v20 → v21 commit sayısı**: ~378
  - Nis 24 – May 15: 107 commit (Faz 2 + Maliyet Faz 1-4B)
  - May 15 – Haz 30: 71 commit (Maliyet Faz 5 + Cari ekstre)
  - Tem 1 – Ağu 7: 198 commit (COC alt bileşen + FAI + Yapılabilirlik + Teklifler)

---

*Hazırlayan: Claude Code (Opus 4.7, 1M context), Ömer'in talebiyle.*
*Kaynak: v20 dökümanı + Claude memory (17 project + 12 feedback) + repo taraması + git log v20 sonrası.*
*Tarih: 7 Ağustos 2026.*
