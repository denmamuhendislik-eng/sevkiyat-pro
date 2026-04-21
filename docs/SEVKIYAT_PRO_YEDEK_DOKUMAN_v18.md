# SEVKIYAT PRO — YEDEK DÖKÜMAN v18

> Son güncelleme: 21 Nisan 2026 (Claude Code feedback entegrasyonu)
> Oturum: v17 → v18.17 (18-21 Nisan 2026)
> Ek: 21 Nisan 2026 — Claude Code ilk oturumundan gelen 3 risk yansıtıldı (süre iyimser, cycle koruması, döviz blocker)

## Genel Bilgiler

- **Repo:** `~/sevkiyat-pro` (github.com/denmamuhendislik-eng/sevkiyat-pro)
- **Canlı:** sevkiyat-pro.vercel.app
- **Kullanıcı:** Ömer (denmamuhendislik-eng, ADMIN)
- **Ana dosya:** App.jsx (~14844 satır, React + Firebase/Firestore)
- **Cloud Functions:** `~/sevkiyat-pro/functions/` (3 fonksiyon: HTTP + Morning + Midday)
- **Otomasyon:** VIO Mail Otomasyonu (Morning: `*/15 9-11 * * 1-5`, Midday: `0 15,19 * * 1-5`)

## Deploy

### Frontend (App.jsx → Vercel)
```bash
cp ~/Downloads/App.jsx ~/sevkiyat-pro/src/App.jsx && cd ~/sevkiyat-pro && git add . && git commit -m "..." && git push
```

### Cloud Functions (Firebase)
```bash
cd ~/sevkiyat-pro/functions && firebase deploy --only functions
```
Bu komut **3 fonksiyonu tek seferde** deploy eder:
- `fetchVioReportsHttp` (manuel tetikleme)
- `fetchVioReportsMorning` (sabah otomasyonu)
- `fetchVioReportsMidday` (öğle otomasyonu)

---

## ⚠️ ÖNEMLİ — CLOUD FUNCTION / OAUTH TOKEN YÖNETİMİ

### Token Süresi Sorunu ve Kalıcı Çözüm

**Sorun:** Google OAuth "Testing" modunda refresh token 7 günde expire olur → `invalid_grant` hatası → otomasyon durur.

**Kalıcı çözüm:** OAuth consent screen **Production** moduna geçirildi (17.04.2026). Token artık süresiz.

### Production Modu Kontrolü
1. Google Cloud Console → **APIs & Services** → **OAuth consent screen** → **Audience**
2. Publishing status: **"In production"** olmalı
3. Eğer "Testing" yazıyorsa → **"Publish app"** tıkla

### Token Yenileme (invalid_grant hatası alırsan)

**Hata tanı:** Sevkiyat Pro'da kırmızı badge `❌ Otomasyon hatası` → Cloud Run Logs → `error: "invalid_grant"`

**Çözüm adımları:**

#### Adım 1 — Yeni refresh token al
```bash
cd ~/sevkiyat-pro/functions
node get-refresh-token.js
```
- Script bir URL verecek → tarayıcıda aç (**gizli modda** açmak önerilir)
- **denmasevkiyatpro@gmail.com** hesabıyla giriş yap (denmamuhendislik DEĞİL!)
- Gmail erişim izni ver
- "✓ Refresh token alındı" mesajı → `refresh-token.json` otomatik güncellenir

#### Adım 2 — Secret güncelle (newline tuzağı YÖNTEMİ!)
```bash
cd ~/sevkiyat-pro/functions
node -e "process.stdout.write(require('./refresh-token.json').refresh_token)" | firebase functions:secrets:set GMAIL_REFRESH_TOKEN --data-file -
```
⚠️ **MUTLAKA `process.stdout.write` yöntemi kullan** — `echo` veya `cat` newline ekler, token bozulur.

#### Adım 3 — 3 fonksiyonu tek seferde deploy
```bash
firebase deploy --only functions
```

#### Adım 4 — Test
Cloud Scheduler → Morning job'ını seç → **Force run** → Sevkiyat Pro'da yeşil badge kontrol et.

### Cloud Scheduler Konumu
Google Cloud Console → üst arama → "Cloud Scheduler" veya:
```
console.cloud.google.com/cloudscheduler?project=sevkiyat-pro
```

### Cloud Function Logları
```bash
firebase functions:log --only fetchVioReportsMorning --lines 30
```
Ya da: Cloud Run → Services → fetchvioreportsmorning → Observability → Logs

### Cron Zamanları
| Job | Frequency | Açıklama |
|-----|-----------|----------|
| Morning | `*/15 9-11 * * 1-5` | Pzt-Cum 09:00-11:45, 15dk aralıkla |
| Midday | `0 15,19 * * 1-5` | Pzt-Cum 15:00 ve 19:00 |

### OAuth Client Bilgileri
- **Client adı:** Sevkiyat Pro VIO Mail Reader
- **Client türü:** Desktop
- **Gmail hesabı:** denmasevkiyatpro@gmail.com
- **Dosyalar:** `~/sevkiyat-pro/functions/oauth-client.json` + `refresh-token.json`

---

## Ömer'in 3 Sütun Kuralı (v17'den devir)

1. **Görünürlük:** WIP "hazır stok" sayılmaz → eksikse eksik görünür
2. **Cascade:** WIP karşılanmış sayılır → child hammadde talep gereksiz
3. **Yeni iş emri kararı:** WIP karşılanmış sayılır → sadece WIP üstü eksik için yeni emir

## Çalışma Prensipleri (Ömer'in)
- "Başka yerleri bozmak istemem, kötü tecrübelerim var"
- "Önce teşhis sonra kod" — spekülatif değişiklik yok
- Minimum müdahale, exclusion-based pattern
- "Görünürlüğü sisteme, kararı insana bırak"
- Programı yavaşlatıcı değişiklik istemiyor

---

## v18 Oturumunda Tamamlanan Değişiklikler

### v18 — WIP Hızlandır + MRP/BOM Explosion PLS rozet
- WIP Hızlandır tablosunda 🔍/✓ PLS rozeti
- MRP/BOM Explosion code sütununda tıklanabilir PLS rozeti

### v18.1 — PO Takip kısmi karşılama görsel
- Satır arka planı: poGap>0 kırmızı, onaylı yeşil

### v18.2 — Ürün birim KG inline edit (admin)
- editKgPid, editKgTemp state
- saveEditKg — validation + confirm diyalog
- kg tıklanabilir (sadece admin, ✎ ikonu)

### v18.2.1 — Yedek butonu (KALICI)
- getDocs, collection import
- downloadFullBackup — appData collection JSON indir
- 💾 Yedek butonu admin panelinde kalıcı

### v18.3 — VIO duplika temizlik migration (UYGULANDI, TAMAMLANDI)
**8 duplika fantom→aktif merge map:**
```
65→154, 66→172, 70→176, 74→177, 84→178, 109→150, 123→161, 152→156
```
- ✅ 8 fantom ürün silindi
- ✅ 1 kg düzeltildi (#150: 0.10→92)
- ✅ 2 yıl verisi taşındı (2024, 2025)
- Migration butonu kaldırıldı (v18.4)

### v18.4 — Migration butonu kaldırıldı
- FANTOM_MERGE_MAP, KG_FIXES, runDuplicateMigration silindi (~146 satır)
- Korunan: VIO_CODES temizliği, approveNewProduct iyileştirmeleri, 💾 Yedek butonu

### v18.5 — L2 subParts WIP rozeti
**Teşhis:** Parent (151-1268 MONTAJLI) bulk olduğu için child (151-0090) L2'ye düşüyor → L2 render kodu WIP rozetini göstermiyordu.
**Fix:** L1 WIP rozet kodunun birebir kopyası L2 render bloğuna eklendi (fontSize 7, marginRight 3). Hesaplama/filter/mantık dokunulmadı.

### v18.6 — WIP tooltip akış durumu (Stil C)
**Sorun:** Tooltip "⚙TORNA MRK.1 · 100 ad" gösteriyordu ama gerçekte 35 ad TORNA'da, 65 ad FASON'a gitmiş.
**Çözüm:** Op'lar arası transit hesabı:
```
transit[i] = (i==0 ? order.qty : ops[i-1].uretilen) - ops[i].uretilen
```
Tooltip'e yeni satır: `Şu an: ⚙TORNA MRK.1 (35) · 🔩FASON ISLAH (65)`. Sadece transit > 0 VE remaining > 0 olanlar gösterilir. Hem L1 hem L2'de uygulandı.

### v18.7 — WIP Hızlandır eşiği 10g + renk ayrımı
- Filter eşiği: `< 0` → `< 10` (hem geciken hem yaklaşan)
- Satır arka plan rengi:
  - `< 0`: kırmızı (#FEF2F2) — geciken
  - `0-2`: turuncu (#FFEDD5) — kritik
  - `3-9`: sarı (#FFFBEB) — dar zaman
- Slack sütun ikonu: ❌ / ⚠ / ⏳ + renk
- Sayaç label aynı ("WIP hızlandır"), sıralama ascending slack

### v18.8 — Satınalma Excel Export
MRP Planlama → Satınalma tabı → arama kutusu yanında 📥 Excel Export butonu.

**Popup:**
- Durum: Yeni sipariş (gap>0) / Takip listesi (openPO>0) / Tümü — dinamik sayaçlı radio
- Kategoriler: RAW + BUY alt kategoriler checkbox + "Tümünü seç" master
- Format: Tek sayfa / Kategori başına ayrı sheet

**Sütun setleri:**
- Yeni sipariş: Kod, Ad, Br, Sipariş Açığı, Tedarikçi, Kategori
- Takip: Kod, Ad, Br, Açık Sipariş, Kalan İhtiyaç, Tedarikçi, Kategori
- Tümü: Tüm sütunlar

Dosya: `Satinalma_{Mod}_{YYYYMMDD}.xlsx`

### v18.9 — MRP cache Firestore + çizelge otomatik tetikleme
**İhtiyaç:** Sayfa yenilenince MRP sonucu kayboluyordu. Günde 5+ kez BOM Explosion + Çizelge tıklanıyordu.

**Yapılanlar:**
1. MRP_CACHE_DOC = "mrpCache" sabiti
2. mrpCacheLoaded useRef flag
3. Firestore listener — sayfa açılışında explosionResult'u okur (ilk kez)
4. runBomExplosion sonunda Firestore'a yaz (canEdit kullanıcılar)
5. useEffect + autoCalcPending flag → BOM Explosion bitince çizelge otomatik hesapla

**Çözülen sorunlar:**
- setTimeout + React closure problemi → useEffect pattern'e geçildi
- schedSource "vio" kalması → forceMrp parametresi eklendi
- Override varsa confirm popup → silent parametresi (otomatik akışta popup atlanır)

**calculateSchedule parametreleri:**
```js
calculateSchedule(silent = false, forceMrp = false)
```
- Manuel buton: `calculateSchedule()` → popup çıkar, schedSource'a göre çalışır
- Otomatik akış: `calculateSchedule(true, true)` → popup yok, MRP modu zorunlu

**Yetki:** MRP sayfasını görmek: admin + üretim (canSeeMRP). MRP yazmak/çalıştırmak: admin + üretim (canEdit).

### v18.10 — Bulk WIP ayrı listede gösterilmesi
**Sorun:** "İş emri aç" listesinde bulk WIP'i olan parçalar da görünüyordu (bulk emirler nonBulk'a sayılmadığı için).

**Çözüm:** makeParts ikiye bölündü — sadece görünüm ayrımı, hesap değişmedi:
- **Ana liste (makeParts):** Gerçekten yeni emir açılması gereken parçalar
- **Yeni liste (makePartsBulk):** Zaten bulk emir açık VE bulk WIP eksiği tamamen kapatan parçalar

**Ayrım kriterleri (akibetLookup'tan okuma, yeniden hesap yok):**
1. orderCount > 0 (aktif emir var)
2. remainingNonBulk === 0 (tüm emirler bulk)
3. totalRemaining > 0 (bulk emirin kalanı var)
4. totalRemaining >= p.totalShort (bulk yetiyor, kısmi değil)

**Yeni sayaç kartı:** `🔒 Bulk WIP İzle (N)` — gri renk, acilActive === "bulkwip"

### Montaj Planı — "En Son Tamamlanan Model" KPI düzeltmeleri
**Sorun 1:** calDays sadece bugünden 5 iş günü öncesini içeriyordu → geçmiş shipped konteynerlerin marjları 0 çıkıyordu.
**Fix:** calDays yerine doğrudan iş günü sayan inline loop eklendi.

**Sorun 2:** "En düşük ortalama marjlı model" metriği yanıltıcıydı (farklı konteyner sayıları).
**Fix:** Yeni metrik: "Her konteynerde en son hazır olan model" sayılıyor, en çok kez "en son" olan model seçiliyor. Eşitlikte ortalama marj tie-break.

**Sorun 3:** count değişkeni karışıklığı (appearance count vs last-ready count).
**Fix:** `count: cnt` (lastReadyCount) kullanılıyor.

### PLS Onay — Yumuşak güncelleme
**Sorun:** VIO otomasyonu yeni stok verisi getirdiğinde hat stoğu miktarı azalırsa (örn 626→620) PLS onayı tamamen iptal oluyordu.
**Fix:** Hat stoğu > 0 olduğu sürece onay korunur, miktar otomatik güncellenir (`Math.min(conf.qty, currentPlsTotal)`). Sıfıra düşerse iptal.

---

## Sistemik Tasarımsal Bulgu — "Gizli RAW" (çözülmedi, dokümante edildi)
shipReqAnalysis konteyner-bazlı kümülatif tüketim yapıyor. PLS havuzu erken konteynerleri kapatıyor → cascade alta inmiyor → RAW Sipariş Ver'de görünmüyor. Operatör pratiği: "Şüphem varsa Tümü'ye geç". İleride: Opsiyon C (MRP-Sevkiyat fark uyarısı) veya D (Horizon-bağımsız RAW önizlemesi).

---

## Kritik Line Numaraları (v18.10 sonrası, ~14155 satır)

- Line 5: Firebase imports (getDocs, collection dahil)
- Line 57: VIO_CODES sözlüğü (temizlenmiş, 171 pid)
- Line 773-797: approveNewProduct (vioCode set + duplika koruma)
- Line 1101-1121: saveEditKg
- Line 1123-1147: downloadFullBackup
- Line 4822: canEdit = isAdmin || isUretim (MRPPlanlama)
- Line 5244: explosionResult state + mrpCacheLoaded + autoCalcPending useRef
- Line 5250-5280: Firestore listeners (BOM mapping + mrpCache)
- Line 5372: runBomExplosion (Firestore yaz + autoCalcPending flag)
- Line 5930: calculateSchedule(silent, forceMrp)
- Line 6366: useEffect autoCalcPending → calculateSchedule(true, true)
- Line 7133-7220: akibetLookup, isBulk mantığı
- Line 7263-7299: stockPool, cascadeAvail
- Line 10976-11020: makeParts / makePartsBulk ayrımı (isBulkSufficient)
- Line 11404-11429: L1 WIP rozet tooltip (akış satırı)
- Line 11475-11509: L2 subParts WIP rozet (akış satırı)
- Line 13475-13500: Excel Export butonu
- Line 13711-13910: Excel Export popup

---

## v18.11 — v18.17 Oturumu Özeti (18-20 Nisan 2026)

### v18.11 — WIP Hızlandır satır tooltip'i
- WIP Hızlandır listesinde her satıra v18.6 Style C (transit-flow) tooltip eklendi
- Satır hover'da emir no, açıklama, yaş, konum tek bakışta görülüyor
- Konum: line ~11417-11454

### v18.12 — Montaj Öncelik Önerisi paneli (~245 satır)
- Acil Aksiyon ve konteyner listesi arasında yeni panel
- `shipReqAnalysis.allProdData`'dan fill-rate hesabı, hazır/eksik dağılımı
- Sadece Montaj Planı ürünleri (ANA_IDS=[1,2,3,4,5])
- Her konteyner-ürün satırı expand edilebilir → eksik L1 parça listesi
- Varsayılan kapalı, `shipReqOpen[panelKey] === true` kontrolü
- Konum: line ~11505-11750

### v18.13 — Parent MAKE tooltip (Satınalma RAW/BUY parçaları için)
- `parentLookup[stockCode] → [{code, name}]` — ters BOM ağacı
- `buildParentTip()` — RAW/BUY parçanın kullanıldığı MAKE parent'ları listeler
- Tüm 8 Satınalma kategorisinde çalışır (DataTable paylaşımlı)
- Konum: line ~13690-13720

### v18.14 — Testere kategorisi + MAKE hammadde tooltip
- `testereByOpLookup` cache — ilk op /TESTERE|KESİM|ŞERİT/ regex
- `isTestereParca(r)` — adı "KSM " ile başlayan veya testere op'lu
- `childMaterialLookup[makeCode]` — ters BOM (MAKE → hammadde child'ları)
- `buildMaterialTip()` — hammadde kodu/adı + ambar + net açık + açık sipariş
- Üretim sekmesi 2 alt tabloya bölündü: 🪚 Testere Kesimi + 🏭 Diğer
- MAKE parçalar için materialTip, RAW/BUY için parentTip

### v18.15 — Hammadde durumu renklendirme + sıralama
- `partsByCode` O(1) Map (parts.find() yerine)
- `materialStatus(r)` — green/yellow/red/unknown, cache'li
  - green: tüm hammaddeler netQty=0 (iş emri hemen açılabilir)
  - yellow: netQty>0 ama openPO karşılıyor (gap=0)
  - red: gap>0 veya netQty>0 && openPO=0
- DataTable'a opsiyonel `rowBg` prop (diğer tablolar etkilenmez)
- Sıralama: rank asc (yeşil üstte), sonra level asc, netQty desc
- Header'da renk açıklama satırı

### v18.16 — VIO sayı parse BUG FIX (KRİTİK)
**Frontend (App.jsx):**
- 3 `pNum` fonksiyonuna `if (typeof v === "number") return isNaN(v) ? 0 : v;` eklendi
- parseStockReport (line 5084), parseAkibetExcel (line 6957), parsePurchaseExcel (line 8329)
- Semptom: XLSX Number hücreleri (örn 4255.32) → `String(v).replace(/\./g, "")` → **425532** (100x şişkin)
- Düzeltme: Number tipinde ise doğrudan al, string ise eski Türk formatı parse'ı korunur

**Backend (functions/parsers.js):**
- Tek merkezi `pNum` — aynı düzeltme uygulandı (5 satır ekleme)
- Test edildi: VIO örnek dosyasında 150-0047=4255.32 (eskiden 425532), 150-0014=1247.4, 150-0123=1086.63
- Deploy sonrası Force Run ile Firestore'a doğru değerler yazıldığı doğrulandı

**Etkilenen alanlar:**
- Stok Raporu (ambar miktarları)
- Akibet (emir kalan miktarları)
- Sipariş Kontrol (açık PO miktarları)

### v18.17 — Manuel Bulk Override Sistemi (~240 satır)
**Problem:** 52005/42005/36005/52010/42010/36010 gibi parçalar "PRES + TORNA" iş akışına sahip — `isBulkOpName` MONTAJ/PRES'i bulk sayar ama `.every()` kullanıldığı için TORNA olması yeterli, bulk sayılmaz. Alt patlatma durur, sevkiyat bazlı ihtiyaçta ► açılmaz.

**Çözüm:** Manuel işaretleme mekanizması.
- **Firestore yapısı:** `bomMapping._bulkOverrides = { "151-0214": { manual: true, by: "Ömer", at: "..." } }`
- **`saveBulkOverride(code, manual)`** — saveCatOverride pattern'i (line ~5337)
- **`manualBulkSet`** useMemo — O(1) Set lookup
- **9 yerde override** — cascade hesaplarının her biri: stockPool (3), runBomExplosion parentStkAvail/forwardDemand/demandSummary (3), partRealDeadlinesWithWip (3)

**Rozet matrisi (4 durum):**
| Durum | Rozet | Renk | Anlam |
|-------|-------|------|-------|
| Manuel + etkili | 🔒 | Koyu turuncu | Manuel flag devrede |
| Manuel + gereksiz | 🔓 | Soluk gri | Otomatik zaten bulk, flag gereksiz |
| Otomatik bulk | 🔒 | Açık turuncu | Sistem otomatik tespit |
| İşaretlenebilir | ⊕ | Çok soluk (0.35 opacity) | Aktif emir var, manuel ekleme yolu |

- Rozet yeri: Sevkiyat Bazlı İhtiyaç paneli, parça kodu yanında (PLS'in solunda)
- Kapsam: MAKE + MAKE+FASON + FASON
- Yetki: canEdit (admin + üretim)
- Otomatik kaldırma YOK (flag kalıcı, 🔓 ile görsel uyarı)

**Confirm Popup + Toast:**
- Tıklama → confirm popup "Ne olacak?" açıklama
- Onay → sağ üstte toast: "✓ Manuel bulk işaretli" + 🔥 Şimdi Çalıştır butonu (tek tıkla BOM Explosion)

### Backend v14 akibet format güncellemesi (parsers.js)
Yüksek öncelikli pending madde kapatıldı. Frontend fallback mekanizması korundu (güvenlik).

**Eklenen helper:**
- `parseEmirTarihi(v)` — D(D)MMYYYY + DD.MM.YYYY + Excel serial support

**Order seviyesi yeni alanlar:**
- `openDate` — emir açılış tarihi (YYYY-MM-DD)
- `rem` — fiziksel kalan (MAX(intRem, fasRem), çift sayımsız)
- `firstOpenOp` — { name, isFason, opCode }
- `remainingOps` — { total, fason, internal }

**Part seviyesi yeni alan:**
- `totalRemaining` — part-level fiziksel kalan toplamı

**Test:** Mock akibet + gerçek tooltip teyidi (emir 542, 02.04.26 tarihli, "18g" yaşta, TORNA MRK.1'de → hepsi doğru)

---

## Pending / Askıdakiler

### ✅ Tamamlandı (v18.11-18.17 oturumu)
- [x] Backend Cloud Function scheduler güncellemesi (akibet parse yeni format)
- [x] VIO sayı parse bug fix (frontend + backend)
- [x] Manuel bulk override sistemi

### Yüksek Öncelik
- [ ] Tezgah çizelgeleme iyileştirmesi (operasyon süreleri düzeltme — devam eden iş)
- [ ] Fason yönetim modülü (fason alım siparişleri entegrasyonu dahil)

### Orta Öncelik
- [ ] Gizli RAW sorunu (Opsiyon C/D tasarımı)
- [ ] FASON filter WIP kontrolü
- [ ] v14 tooltip replikasyonu (Satınalma/İş Emri Öncelik/Bekleyen Fason/MRP Arama/DataTable)

### Düşük Öncelik
- [ ] 116925-01/04 BOM ağacı "Eşleştirilmemiş" uyarısı
- [ ] Sevkiyat Tahmini Hazır Olma → geçmiş GER, gelecek PLN ayrımı
- [ ] "En Son Tamamlanan Model" teşhis tooltip'ini production'da kaldırma (şimdilik bilgilendirici, kalabilir)

---

## 🎯 STRATEJİK ROADMAP — Maliyet & Envanter Modülü

> Karar verildi: 20 Nisan 2026 tarihinde Ömer ile stratejik istişare sonrası.

### Durum tespiti

**VIO'da var olan:**
- PO/alım maliyetleri (parça bazlı girdi fiyatı) — güvenilir
- Finans, stok, üretim (iş emri), MES entegrasyonu
- Ortak genel giderler kayıt altında

**VIO'da olmayan (Sevkiyat Pro'nun dolduracağı boşluk):**
- BOM ağacına göre roll-up maliyet hesabı (rigit değil)
- Sevkiyat bazlı kârlılık görüntüsü
- Stok envanter değerinin ağaç mantığıyla hesaplanması
- Genel giderlerin üretim alanlarına güvenilir dağıtımı yok → Sevkiyat Pro'da "göz kararı çarpan" ile çözülecek

**Dışarıdaki sistemler:**
- MES: Smart Factory (ayrı program, her makineye tablet — gerçek zamanlı op takibi orada)
- VIO ERP: ana sistem

### Maliyet Modülü — Tasarım Kararları

**Üç katmanlı yapı:**
1. **Hammadde/BUY** → VIO PO raporundan otomatik (zaten çekiliyor). Başlangıçta "son fiyat" yöntemi.
2. **İşçilik/operasyon** → MES'ten gelen op süreleri × iş merkezi saat ücreti (admin girer). Fason op'lar için parça başı fiyat.
3. **Genel gider** → sabit çarpan (örn %15). Admin panelinden ayarlanabilir. "Göz kararı ama şeffaf" yaklaşımı.

**Kaynak öncelikleri:**
- Fason alım siparişleri yüklenebilir → fason op maliyeti netleşir
- Maliyet alt verilerinin tam doldurulması için önce fason yönetim modülü tamamlanmalı

### Envanter Modülü — Tasarım Kararları
- Maliyet motorunun doğal uzantısı (önce maliyet, sonra envanter)
- Her parça için: `ambar × birim_maliyet`
- Lokasyon bazlı dağılım: Ambar / Üretim Hattı / Fason
- WIP parçalar için yarı maliyet hesabı (hammadde + tamamlanmış op'lar) — ileri aşama

### Sevkiyat Bazlı Kâr Analizi (hedef "milad")
Ömer'in en heyecan duyduğu çıktı. Her sevkiyat için:
- Satış fiyatı (girilir veya VIO'dan)
- Hammadde maliyeti (roll-up)
- İşçilik maliyeti (op süresi × saat ücreti)
- Genel gider (%X çarpan)
- **Kâr ve marj (%)** — yöneticinin altın madeni

### Mimari Kararı — Modüler Yaklaşım (Seçenek C)

**Karar:** Yeni maliyet/envanter modülü, App.jsx içinde DEĞİL, ayrı dosyada başlayacak.

```
src/
├── App.jsx (mevcut, değişmez — sadece <CostModule /> import eder)
├── modules/
│   └── maliyet/
│       ├── CostModule.jsx       (UI — sayfa + panel)
│       ├── engine.js            (roll-up hesap motoru)
│       ├── AdminSettings.jsx    (saat ücreti, genel gider çarpanı)
│       └── firestore.js         (Firestore okuma/yazma)
└── ...
```

**Sebepler:**
- App.jsx zaten 14,844 satır — büyümeye devam ederse yönetilemez olur
- Yeni iş zaten "yeni yer" — temiz başlangıç
- Ayrı veri modeli var (maliyet dokumanları Firestore'da yeni koleksiyon)
- AI yardımıyla çalışmak çok daha rahat (sadece ilgili modül yüklenir)

**Önemli:** Kullanıcı arayüzünde tek uygulama, tek canlı, tek deploy. Sadece kod organizasyonu değişiyor.

### MVP Yaklaşımı — Küçük Başla, Büyük Hayal Et

**Aşama 0 (hazırlık — şimdi değil, sonraki sıra):**
- Tezgah çizelgeleme işi tamamlansın — **operasyon süreleri düzeltme bu işin alt kalemidir** (MES'ten gelen sürelerin ince ayarı, iş merkezi doğrulaması)
- Fason yönetim modülü tamamlansın (fason alım siparişleri yüklemesi dahil)
- Bunlar **maliyet modülünün altyapısını doldurur** (fason op fiyatları, op süreleri)

**Aşama 1 — Maliyet MVP (~1-2 hafta):**
- Sadece hammadde maliyeti (VIO PO fiyatından son fiyat)
- Parça bazlı görüntü ("150-0047 birim maliyet: 14.50 TL")
- Admin panelinde güncel PO fiyat listesi
- **BOM roll-up döngü (cycle) koruması — Aşama 1 başlangıcından itibaren zorunlu.** Eğer `bomMapping`'de yanlışlıkla A→B→A gibi bir döngü oluşursa recursive roll-up motoru sonsuz döner. Basit bir `visited` set yeterli, ama erken eklenmeli (sonradan ekleme sorun çıkarır).

**Aşama 1 kenar durumları (süreyi şişirebilir):**
- PO fiyat güncelleme sıklığı — her gün mü, her PO gelişinde mi?
- "Son fiyat" tanımı — en yeni fatura mı, en ucuz mu, hangi tedarikçi?
- Birim dönüşümleri — 150-0047 kg cinsinden satın alınır, üretimde adet/çift kullanılır. Çevrim tablosu gerekir.
- Eksik PO'lu yeni parça — PO geçmişi yoksa fallback ne? (0? sektör ortalaması? manuel girdi?)
- Bu dört kenar durum toplu olarak 1 haftayı 2 haftaya çıkarabilir. Öncesinde netleştirilmeli.

**Aşama 2 — İşçilik (~1 hafta):**
- İş merkezi saat ücreti admin paneli
- MES op süreleri × saat ücreti → parça başı işçilik
- Fason op'lar için parça başı fiyat
- BOM roll-up'a işçilik eklenir

**Aşama 3 — Genel gider + son maliyet (~3 gün):**
- Admin panelde genel gider çarpanı
- Toplam = (hammadde + işçilik) × (1 + %genel_gider)
- Parça bazlı son birim maliyet

**Aşama 4 — Envanter değeri (~1 hafta):**
- Stok × birim maliyet
- Lokasyon bazlı toplam dağılım dashboard'u

**Aşama 5 — Sevkiyat bazlı kâr analizi (~1-2 hafta):**
- Satış fiyatı entegrasyonu
- Her sevkiyat için kâr/marj hesabı
- Dashboard + grafikler

**Toplam tahmin: 4-6 hafta** (Aşama 0 hariç, sadece maliyet modülü için)

### ⚠️ Aşama 1 BLOCKER — Önce Cevaplanmalı

**Soru 0 (blocker): Döviz durumu**
VIO'da PO kayıtları TL olarak mı, yoksa Euro/Dolar ile mi tutuluyor?
- Eğer VIO TL'ye çevirip kaydediyorsa → sorun yok, direkt kullanılır
- Eğer VIO orijinal dövizde kaydediyorsa → kur tablosu + tarih bazlı çevrim mekaniği lazım (ayrı altyapı)
- Eğer karışık (bazı PO TL, bazı döviz) → en karmaşık durum, hangi formatta hangisi olduğunu ayırt etme mantığı

**Bu sorunun cevabı tüm maliyet mimarisini etkiler** — diğer 4 stratejik sorudan önce bu netleşmeli. Aksi takdirde Aşama 1 boyunca "TL mi, döviz mi" belirsizliği tüm hesapları kirletir.

**Araştırma yöntemi:** VIO'daki birkaç örnek PO'yu incele (TL ile yapılan alım + dolar/euro ile yapılan alım), kaydın hangi formatta olduğunu gör.

### Bekleyen Stratejik Sorular (Soru 0 sonrası, Aşama 1'e başlarken cevaplanacak)

1. **Maliyet değerleme yöntemi:** son fiyat mı, ağırlıklı ortalama mı? (önerim: başlangıç için son fiyat)
2. **Genel gider:** tek çarpan mı, kategori bazlı mı? (MAKE/FASON ayrı çarpanlar mümkün)
3. **Yetki sınırlaması:** `canSeeCost` rol eklenmeli mi? (operatör maliyet görmemeli)
4. **Tarihsel snapshot:** geçmiş sevkiyatlar için o dönemki maliyet mi, güncel maliyet mi? (başlangıçta sadece anlık, sonra snapshot)

### Sıra Beklemede — Önce Çözülecek İşler (Ömer'in talebi)

1. **Tezgah çizelgeleme iyileştirmesi** (devam eden iş) — operasyon süreleri düzeltme bu çalışmanın içinde
2. **Fason yönetim modülü** — fason alım siparişleri yüklenmesi dahil
3. **Sonra** → maliyet modülüne başla (önce Soru 0 = döviz araştırması, sonra yukarıdaki MVP aşaması 1)

---

## Badge Durumları (Otomasyon)
- **🐢 Yeşil** → her şey normal, müdahale gerekmez
- **⚠️ Sarı** → son güncelleme eski (6+ saat), VIO mail göndermemiş olabilir veya hafta sonu
- **❌ Kırmızı** → otomasyon hatası, yukarıdaki "Token Yenileme" bölümüne bak
- **Gri** → automationLog henüz oluşmamış

---

## Firestore Doküman Yapısı
| Doküman | İçerik |
|---------|--------|
| appData/products | Ürün listesi (pid, nameTR, kg, vioCode) |
| appData/bomModels | BOM ağaçları (15 model, 896 parça) |
| appData/mrpBomMapping | BOM eşleştirme + kategori override + **bulk override (v18.17)** |
| appData/mrpCache | BOM Explosion sonucu (sayfa yenilemede korunsun) |
| appData/workCenters | İş merkezleri + kapasite |
| appData/schedJobOrder | Çizelge iş emirleri |
| appData/plsConfirmations | Hat stoğu onayları |
| appData/mrpStock | VIO Stok Raporu |
| appData/mrpAkibet | Bekleyen Operasyonlar (akibet) — **v14 format: openDate, rem, firstOpenOp, remainingOps, totalRemaining** |
| appData/mrpPurchaseOrders | Sipariş Kontrol Listesi |
| appData/automationLog | Cloud Function çalıştırma log'ları |
| yearsData/{yıl} | Sevkiyat planı (konteynerler, miktarlar) |
| montajState | Montaj planı (günlük PLN/GER, başlangıç stoku) |

**Gelecekte eklenecek (maliyet modülü için):**
| Doküman | İçerik |
|---------|--------|
| appData/costSettings | İş merkezi saat ücretleri, genel gider çarpanı, fason op fiyatları |
| appData/partCosts | Parça bazlı hesaplanmış maliyetler (cache) |
| appData/inventoryValue | Envanter değer snapshot'ları |

---

## YENİ OTURUM SAHİPLERİ İÇİN

### Sistem Durumu
- Cloud Function otomasyonu **canlı** (Production modunda, token süresiz)
- Sabah 09:00-11:45 arası her 15 dakika, 15:00 ve 19:00 ek tetikler
- Sevkiyat Pro UI'da yeşil badge bunu doğrular
- MRP sonucu Firestore cache'de saklanır — sayfa yenilemede kaybolmaz
- BOM Explosion sonrası çizelge otomatik hesaplanır (override'lar korunur)

### Dikkat Edilmesi Gerekenler
- `isOrderBulk` mantığına DOKUNMA — cascade, WIP, iş emri kararı hepsi buna bağlı. **v18.17 ile manuel override eklendi**, otomatik mantık korundu
- `calculateSchedule(silent, forceMrp)` parametreleri — manuel buton parametre geçmez (default false,false)
- `plsConfirmedLookup` yumuşak güncelleme — stok > 0 olduğu sürece onay korunur
- VIO_CODES sözlüğü temizlendi (171 pid, duplikalar yok) — yeni ürün eklenirken dikkat
- **pNum fonksiyonlarına DOKUNMA** — v18.16'daki `typeof === "number"` kontrolü kritik (frontend 3 yer + backend 1 yer)
- **parseAkibetExcel yeni alanları (openDate, rem, firstOpenOp, remainingOps, totalRemaining)** — frontend fallback mantığı güvenlik ağı, kaldırılmamalı
- **`_bulkOverrides` Firestore alanı** — `_catOverrides` ile aynı doc içinde (`mrpBomMapping`)
- **Gmail mail pencere süresi 24 saat BİLİNÇLİ** — `index.js`'te `fetchAllVioReports(auth, 24)`. 48'e çıkarma cazibesine direnilecek. Gerekçe: otomasyonun sessizce kendini kurtarmasındansa, 24+ saat gecikmede **erken uyarı** görmeyi tercih ediyoruz. Purchase mail 24 saatten sonra gelince "Otomasyon hatası" uyarısı çıkar → operatör müdahale eder. Silent failure'dan iyidir.

### Hızlı Test Kontrol Listesi
1. ✅ Sevkiyat Pro açılır, sol menü çalışır
2. ✅ MRP Planlama → BOM Explosion → sonuç gelir
3. ✅ Çizelge otomatik hesaplanır (Kendi MRP badge'i)
4. ✅ Sayfa yenile → MRP sonucu hâlâ duruyor
5. ✅ Acil Aksiyon paneli: 6 sayaç kartı
6. ✅ Satınalma → Excel Export butonu → popup → dosya iner
7. ✅ VIO otomasyon badge yeşil
8. ✅ Montaj Planı → KPI → "En Son Tamamlanan Model" doğru gösteriyor
9. ✅ **Sevkiyat Bazlı İhtiyaç panel** → REDÜKTÖR altında Eksik Bileşenler → bulk rozeti (⊕/🔒/🔓) parça kodu yanında görünüyor (v18.17)
10. ✅ **WIP tooltip'i** → "Emir XXX (tarih) — ... · ⚙op_adı · kalan N op (XF+YI)" formatında (v14 backend)
11. ✅ **150-0047 Q240 7131** → Açık Sip. = 4255.32 (ondalık doğru, v18.16)
12. ✅ **Üretim sekmesi** → Testere Kesimi + Diğer Üretim ayrı tablolar, yeşil/sarı/kırmızı satır renkleri (v18.14-15)
13. ✅ **Satınalma stok kodu hover** → MAKE için hammadde tooltip, RAW/BUY için parent tooltip (v18.13-14)
14. ✅ **Montaj Öncelik Önerisi paneli** → 21 sevkiyat-model listesi, expand edilebilir (v18.12)
