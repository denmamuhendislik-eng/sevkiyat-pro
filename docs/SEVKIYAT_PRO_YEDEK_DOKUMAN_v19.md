# SEVKIYAT PRO — YEDEK DÖKÜMAN v19

> Son güncelleme: 21 Nisan 2026 akşamı (Çok müşterili MRP çerçevesi tamamlandı — uzun sohbet sonucu)
> Oturum: v17 → v18.17 → v19 (18-21 Nisan 2026)
> Ek: 21 Nisan 2026 sabah — Claude Code ilk oturumundan gelen 3 risk yansıtıldı
> Ek: 21 Nisan 2026 öğle — Çok müşterili MRP genişlemesi konusu açıldı
> Ek: 21 Nisan 2026 akşam — Çok müşterili MRP çerçevesi oturdu, Faz 1A yol haritası çıkarıldı, güvenlik ve modülerleşme ilkeleri dökümante edildi

---

## 🆕 Açılan Konu — Çok Müşterili MRP Genişlemesi (ÇERÇEVE TAMAMLANDI)

> **Durum:** Çerçeve oturdu, tasarım prototipleri üretildi, kararlar netleşti, yol haritası çıktı. Faz 1A kodlamaya hazır.
> **Öncelik:** Yüksek — Faz 1A izole ve sıfır riskli, tezgah çizelgeleme ve fason işiyle paralel gidebilir.

### Mevcut Durum

- Sevkiyat Pro şu an **tek müşteri** (%70 ciro, konteyner planlı) için konfigüre
- Kalan %30 için **3 müşteri** var:
  - **Aselsan Konya (120-0107)** — %30'un %89'u, dönemsel siparişler, termin tarihli
  - **Roketsan (120-116-1)** — %30'un %1'i, 2 aktif sipariş
  - **Denma Dış Ticaret (120-115)** — ihracat firmamız (iç cari), nihai alıcı yurt dışı
- Bu müşterilerin VIO satış siparişleri zaten akıyor (termin tarihli)
- **Parçalar müşteri özel (nihai ürün seviyesinde)** — BOM çakışması yok
- **Hammadde paylaşımı var** — 150-XXXX stok kodları müşteri-agnostik, ortak havuz zorunlu
- BOM ağaçları VIO'da zaten tanımlı — Sevkiyat Pro'ya import edilecek

### Ölçek Gerçeği (örnek VIO raporlarından teyit)

- **198 benzersiz aktif ürün** (914 açık sipariş satırı, 3 müşteri birleşik)
  - Aselsan: 176 ürün / 892 sipariş satırı
  - Denma Dış Ticaret: 20 ürün / 20 sipariş satırı
  - Roketsan: 2 ürün / 2 sipariş satırı
- BOM sayısı: ~700 (VIO'da kayıtlı hepsi — bir kısmı ölü, 2 yıldır sipariş yok)
- **Aktif (sipariş alan) ürün sayısı: ~198** → BOM yükleme kapsamı bu

### Kod Formatları — Netleşti

| Prefix | Anlam | Kaynak |
|--------|-------|--------|
| AC-XXXX | Aselsan montajlı ürün (nihai satış) | Aselsan müşteri kodu |
| MM-XXXX, MN-XXXX | Aselsan parça kodları (AC altında da olabilir) | Aselsan müşteri kodu |
| 152-XXXX | Aselsan'ın kod vermediği parçalar | Denma iç kodu |
| 150-/151-/157- | Hammadde | Denma stok kodu (paylaşımlı) |
| MM-9111-XXXX, AC-A9111-XXXX | Yeni Aselsan serisi | Aselsan |

Kullanıcı Aselsan için doğrudan **müşteri kodunu** kullanıyor, kod vermediği parçalar için kendi kod veriyor (152-XXXX).

### Mimari Kararı — TEK MOTOR, ÇOKLU GİRDİ

**En kritik karar.** Ana müşteri + diğer müşteriler için **ayrı motor yok**, ortak motor var. Satış siparişleri "sahte konteyner" olarak motora beslenir.

```
ŞU AN:
  Konteyner talepleri → [MRP motoru] → Satınalma + İş Emri + Sevkiyat Bazlı İhtiyaç

HEDEF:
  Konteyner talepleri ────┐
                          ├─► [Aynı MRP motoru] → Tek satınalma listesi
  Satış siparişleri  ─────┘                      Tek iş emri listesi
                                                  Müşteri bazlı ihtiyaç panelleri
```

**Neden tek motor:**
- Hammadde havuzu ortak → çift sayım imkansız olmalı
- "Gizli RAW" problemi iki kere çözülmemeli
- Satınalma listesi tek yerden çıkar (şu anki pattern korunur)
- Allocation otomatik — motor zaman sırasına göre tüketir

**Adaptör pattern:**
- Mevcut motor aynen kalır, dokunulmaz
- Yeni katman: satış siparişi → demand list dönüştürücü (`{source: 'salesOrder', ...}` tipinde "sahte konteyner")
- Motor tanıdığı yapıyı alır, şaşırmadan işler

**Dökümandaki eski not teyit edildi:**
> "Ortak veri modeli: İki farklı 'talep' yapısı (konteyner vs dönem) ortak bir kavramda buluşabilir (örn `demand` tipi: `{source: 'container'|'period', ...}`). Bu kod tarafında tek motor çalıştırır."

### Planlama ≠ İhtiyaç — İki Ayrı Ekran, Tek Motor

Bu ayrım çok önemli, karıştırılmamalı:

| Bilgi | Ne gösteriyor | Ana müşteride nerede? | Diğer müşterilerde nerede? |
|-------|----------------|------------------------|----------------------------|
| **Takvim/Plan görünümü** | Hangi sipariş hangi haftada | Montaj Planı sayfası | **Yeni sekme: Diğer Müşteriler** |
| **İhtiyaç görünümü** | Sipariş için neler eksik | Sevkiyat Bazlı İhtiyaç paneli | MRP Planlama içinde yeni kardeş panel (Faz 2) |
| **Satınalma/İş emri listesi** | Ne sipariş etmen, ne emir açman lazım | Satınalma + İş Emri Öncelik tabları | **Aynı tablar** — otomatik birleşir (tek motor) |

Akış aynı: VIO rapor gelir → BOM Explosion çalıştırılır → paneller ve listeler tek motorun çıktısını gösterir. Sadece müşteri dropdown filtresi eklenir.

### Kararlar Özeti — Netleşenler

| Konu | Karar | Gerekçe |
|------|-------|---------|
| Mimari | Ayrı sekme + ayrı motor DEĞİL, tek motor çoklu girdi (adaptör) | Stok havuzu ortak, satınalma listesi tek |
| Müşteri seçimi | Dropdown, müşteri bazlı filtre | Aselsan dominant, diğerleri istisna |
| Faz sırası | **Faz 1A:** Planlama ekranı (sıfır risk). **Faz 1B:** Mail otomasyonu (orta risk). **Faz 2:** Motor entegrasyonu + sipariş bazlı ihtiyaç | Risk iştahı düşük, önce izole kazanım |
| Granülarite | ISO hafta, UI'da ay grupları + içinde haftalar | "1-2 haftaya şu biter, ay başı..." zihinsel model |
| Termin yorumu | Saf son teslim (buffer yok, lead time yok) | MVP sadelik, yanlış varsayım yerine hiç varsayım |
| Lead time | MVP'de yok, çizelge+fason+MES olgunlaştıktan sonra | Sabit "4 hafta" varsayımı tehlikeli |
| Veri modeli | İki katmanlı: `salesOrders` (VIO ham, üzerine yazılır) + `planOverrides` (manuel, korunur) | Mevcut `_catOverrides`/`_bulkOverrides` pattern'i ile tutarlı |
| Override stale | VIO termin değişirse sarı uyarı, override silinmez (Faz 2'de netleşir) | Görünürlük sisteme, karar insana |
| Gecikenler | Ayrı kutu, filtreli görünüm — veri hareketi yok, manuel taşıma ile override'lanır | Sessiz veri hareketi prensiplerine ters |
| BOM yükleme | Elle tek tek, sadece aktif siparişli ürünler (~198 BOM) | "İçinde yanlış olabilir kontrol edeceğim" — kalite adımı |
| Batch import | YAPILMAYACAK, gereksiz altyapı | 198 BOM elle ~6-7 saat, batch 1 gün, başa baş → prensiple manuel kazanır |
| BOM eksik uyarısı | VAR — satış siparişleri vs. `bomMapping` kontrolü, eksikler için sekme başında badge | Unutma koruması (yeni sipariş geldiğinde BOM eksikse uyarır) |
| Döviz | VIO'dan kod alınacak, Firestore'a yazılacak, MVP UI'da **gizli**, maliyet modülünde açılır | Altyapı şimdi, UI sonra |
| Bedel gösterimi | TL, satır + belge grubu + hafta + ay + KPI | VIO "Toplam Bedel" kolonu zaten TL |
| Sipariş no gruplaması | VAR — aynı belge no'lu satırlar görsel grup (hafif çerçeve) | Aynı belge = aynı planlama birimi |
| Sevkiyat = satış sipariş satırı | Müşteri terminlerine göre, konteyner değil | "Termin = planlama birimi" |

### Örnek Veriler (repo'da samples/ altında)

- `ORNEKTOPLUURUNAGACI.xlsx` — 9 ürünün ürün ağacı (aralık export)
  - Format: blok ayıracı "Ürün (MM-XXXX-XXXX-Rev:YY)" ile başlar
  - Her blok: stok kodu/ad/miktar/brm + operasyon listesi + hammadde satırı
  - Mevcut parser pattern'iyle uyumlu, sadece "blok başına loop" wrapper gerekli
  - Hammadde paylaşımı teyit edildi (150-4535, 150-4742 birden fazla üründe)
- `ORNEKSATISSIPARIS.xlsx` — 914 açık sipariş satırı, 3 müşteri
  - Müşteri başlığı: "Müşteri 120-XXXX AD"
  - Kolonlar: Tarih, Belge No, Stok Kodu, Stok Adı, Teslim Tarihi, Brm, Orijinal Miktar, Sevk Edilen, **Kalan Miktar**, Dv.Fiyat, Fiyat (TL), Toplam Bedel (TL), Tahmini Üret (boş), Toplam Süre (boş)
  - Süre kolonları boş → çizelge bu raporu kullanmayacak (MES ayrı kaynak)
  - Fiyat kolonu TL, Dv.Fiyat orijinal döviz ama **döviz türü bu raporda yok** (VIO'ya ekletilecek)

### Prototipler (repo'da docs/prototype/ altında)

- **v1:** `DigerMusterilerPrototip.jsx` — temel omurga
  - Karma layout (üst: hafta stripi, alt: detay liste)
  - Dropdown + drag & drop
  - Gerçek veriden 36 satırlık alt küme
- **v2:** `DigerMusterilerPrototipV2.jsx` — 8 iyileştirmeyle genişletildi
  - Toplam bedeller (satır + belge grubu + hafta + ay + KPI)
  - Aylık bedel şeridi (12 ay)
  - "BU HAFTA" vurgu bloğu (sevke hazır olmalı)
  - Sipariş no gruplaması (aynı belge no → hafif çerçeve)
  - Geciken gecikme süresi rozeti ("hf geç", kademeli renk)
  - Arama (stok kodu / ad / belge no)
  - Sıralama (tarih / tutar / müşteri)
  - VIO güncellemesi rozeti (mavi nokta)
  - Override notu (✎ → textarea)

### Faz Kapsamı — Netleşti

**Faz 1A — İçerir:**
- Yeni sekme: "Diğer Müşteriler"
- Satış siparişi raporu parser + Firestore yaz (`salesOrders`)
- **Manuel Excel upload** (mail otomasyonu Faz 1B'de)
- Haftalık plan görünümü + aylık şerit + haftalık strip
- Manuel revizyon (dropdown + drag & drop)
- Override sistemi (`planOverrides` dokümanı, import'tan korunur)
- "BU HAFTA" vurgu bloğu
- Gecikenler kutusu (kademeli renk, "hf geç" etiketi)
- Arama + sıralama + müşteri filtresi
- Sipariş no gruplaması
- Override notu
- VIO güncellemesi rozeti (mavi nokta)
- Bedeller TL
- BOM eksik uyarı sistemi (sadece bu sekme içinde)

**Faz 1A — İçermez:**
- Motor entegrasyonu (Faz 2)
- Sipariş bazlı ihtiyaç paneli (Faz 2)
- Mail otomasyonu (Faz 1B)
- Kapasite çakışması uyarısı (Faz 2)
- Lead time / üretim başlangıç haftası (çok sonra, çizelge+fason+MES hazır olunca)
- Override stale uyarısı (Faz 2, re-import devrede)
- Döviz UI gösterimi (maliyet modülü)
- BOM batch import ekranı (gerekirse, şimdilik yok)
- Miktar bölme (edge case, MVP şişirir)
- Toplu seçim + tek hareketle taşı (nadir, sonra)

**Faz 1B — İleri aşama:**
- Mail otomasyonuna 4. rapor eklenmesi
- `fetchVioReportsMorning/Midday` Cloud Function'larına satış siparişi raporu entegrasyonu
- Orta risk (mevcut 3 rapor pipeline'ını etkileme potansiyeli)
- Faz 1A stabil olduktan **2-3 hafta sonra** değerlendirilir

**Faz 2 — Motor entegrasyonu:**
- Adaptör katmanı (`salesOrders` → motor talep listesi)
- Mevcut `runBomExplosion` genişletilir (girdi çeşitlenir, mantık aynı)
- Sipariş bazlı ihtiyaç paneli (MRP Planlama içinde yeni kardeş)
- Satınalma/İş Emri listeleri otomatik genişler (aynı kod, farklı veri)
- Tahmini süre: ~1 hafta
- **Ön koşul:** Faz 1A canlıda stabil + BOM'lar yüklü

---

## 🛡️ Güvenlik İlkeleri — Mevcut Sistemi Bozmama Garantisi

Çok müşterili MRP genişlemesi **3 seviyede izolasyon** sağlar:

### Seviye 1 — Veri İzolasyonu
- Yeni veriler yeni Firestore koleksiyonlarında: `salesOrders`, `planOverrides`
- Mevcut koleksiyonlara **yazma YOK** — sadece okuma: `products`, `bomModels`, `mrpBomMapping`, `mrpCache`, `akibet`, `mrpStock`, `mrpPurchaseOrders`
- `downloadFullBackup` yeni koleksiyonları otomatik alıyor mu? **Adım 0'da kontrol edilmeli**

### Seviye 2 — Kod İzolasyonu
- Yeni kod `src/modules/digerMusteriler/` klasöründe
- App.jsx'e sadece **2 satır** eklenti:
  - 1× `import DigerMusteriler from './modules/digerMusteriler'`
  - 1× Menü item + routing case
- Mevcut 14.8k satır **DOKUNULMAZ**

### Seviye 3 — Hata İzolasyonu
- Parser try/catch ile sarmalı
- Yeni modül state'i mevcut App state'inden bağımsız
- Hata → sadece yeni sekme çöker, mevcut ekranlar çalışmaya devam eder

### Kodlama Kuralları (Her PR'da Kontrol)

1. **Asla `App.jsx` içinde mevcut bir fonksiyonu değiştirme** — sadece yeni dosyalar ekle, en fazla 2 satırlık bağlantı
2. **Asla mevcut Firestore dokümanını yazma** — yeni koleksiyonlara yaz, mevcutları sadece oku
3. **Her yeni state hook, useEffect, listener'ı yeni modülün içinde tut** — App.jsx'in state'ine karışma
4. **Her değişiklikten önce `git diff` kontrolü** — Claude Code bunu yapmalı, neyin değiştiğini göstermeli
5. **Deploy etmeden önce 14 maddelik hızlı test listesi** çalıştırılır (bu dökümanın sonunda)
6. **Rollback planı:** Her yeni dosya git'te izlenebilir → `git revert` tek komutla geri al. Firestore koleksiyonları tamamen silinebilir (mevcut veriye dokunulmadı)

### Dokunulmaz Alanlar (v18.17'den devam)

- `isOrderBulk` mantığı
- `calculateSchedule(silent, forceMrp)` parametreleri
- `plsConfirmedLookup` yumuşak güncelleme
- VIO_CODES sözlüğü (171 pid, duplikasyon yok)
- `pNum` fonksiyonları (v18.16 tipof === "number" kontrolü)
- `parseAkibetExcel` yeni alanları (openDate, rem, firstOpenOp, remainingOps, totalRemaining)
- `_bulkOverrides` Firestore alanı
- Gmail mail pencere süresi (24 saat, bilinçli)

---

## 🧱 App.jsx Modülerleşme Stratejisi (21 Nisan 2026 Kararı)

**Durum:** App.jsx ~14.8k satır. Maliyet modülü için "Seçenek C — Modüler" kararı alındı (20 Nisan). Çok müşterili MRP için de aynı yaklaşım geçerli.

### Seçenekler Değerlendirildi

| Senaryo | Ne yapıyor | Risk | Karar |
|---------|-----------|------|-------|
| A — Şimdi büyük refactor | App.jsx'i bütünüyle böl | YÜKSEK — 2 haftalık iş, subtle bug riski, özellik geliştirme durur | **HAYIR** — prensibe ters |
| B — Yeni modüller ayrı, mevcut dokunulmaz | Yeni işler `modules/` altında, App.jsx büyümez | SIFIR — izole, prensibe uygun | **EVET (şimdi)** |
| C — Kademeli refactor | Yeni özellik yazarken o çevrenin kodunu temizle | DÜŞÜK — disiplin gerektirir | **İLERİDE** (tetikleyicilerle) |

### Karar — Senaryo B Şimdi, Senaryo C İleride

**Şimdi:** App.jsx dokunulmaz. Yeni modüller (`digerMusteriler`, gelecekte `maliyet`, `envanter`) ayrı klasörlerde yazılır. App.jsx'e sadece import + menü item eklenir.

**Şimdi yapılacak küçük yatırım — `src/shared/` iskeletinin kurulması:**
```
src/
├── App.jsx (değişmez)
├── modules/
│   ├── digerMusteriler/   (Faz 1A)
│   ├── maliyet/           (gelecek)
│   └── envanter/          (gelecek)
└── shared/                (YENİ, boş iskelet şimdi kurulur)
    ├── weekUtils.js       (ISO hafta, format fonksiyonları — yeni yazılır)
    ├── moneyFormat.js     (formatMoney, formatMoneyFull — yeni yazılır)
    └── constants.js       (boş, yer tutucu)
```

Bu klasör **şimdi boş** olsun, sadece iskelet. Yeni modül yazılırken **yeni yazılan** ortak fonksiyonlar buraya gelir. App.jsx'teki mevcut fonksiyonlar **taşınmaz** — orada kalır, gelecekteki refactor'da taşınacak.

### Büyük Refactor (Senaryo A/C) Tetikleyicileri

Sistem kendi kendine "refactor zamanı" diyebilsin. Şu koşullardan biri gerçekleşirse **ayrı bir oturumda** kademeli refactor değerlendirilir:

- App.jsx 18.000 satırı geçerse
- Bir hata ayıklama oturumunda Claude Code "bu dosya çok büyük, ilgili bölümü bulmakta zorlanıyorum" derse
- 1 aylık özellik plato'su yaşanırsa
- Yoğun bir Claude Code oturumunda "bu kod beni yoruyor" hissedilirse

### Neden Büyük Refactor Şimdi Yapılmıyor

- Risk toleransı düşük ("başka yerleri bozmak istemem, kötü tecrübelerim var")
- Yoğun özellik geliştirme var (çok müşterili MRP, maliyet modülü hazırlığı, fason)
- Sistem kenar durumları subtle (v18.6 WIP tooltip akışı gibi, v18.16 sayı parse bug gibi)
- Doğru zaman: sistem bir plato'ya oturduğunda, yoğun özellik aşaması bitince

---

## 🔄 Rol Ayrımı — Web Claude ↔ Claude Code

Bu sohbetten sonra iki araç net bir rol ayrımıyla çalışacak. Her ikisinin güçlü yanı farklı, karıştırılmaz.

### 🌐 Web Claude (claude.ai) — Yazım ve Strateji
- Yedek döküman güncellemeleri (.md dosyası hazırlar, Ömer indirir)
- Prototipler (JSX artifact'lar, indirilebilir)
- Örnek verilerin hazırlanması (Excel analizi, alt küme çıkarma)
- Stratejik tartışmalar ve karar verme
- Tasarım iterasyonları (v1 → v2 → v3)
- Kod parçacıkları (fikir göstermek için, entegrasyon Claude Code'un işi)
- **Erişim:** Uzun sohbet context'i, artifact üretme, dosya indirme
- **Sınırı:** App.jsx gibi 14.8k satırlık dosyayı doğrudan düzenleyemez, git yapamaz

### 💻 Claude Code (terminal) — Entegrasyon ve Kodlama
- Dosyaları repo'ya aktarma (web Claude'dan indirilenler)
- App.jsx ve mevcut kodla çalışma (büyük dosyalar, entegrasyon)
- Git commit/push/branch operasyonları
- Firestore okuma/yazma kodu
- Cloud Function düzenlemeleri
- Deploy operasyonları
- Gerçek testler (npm run dev, canlı doğrulama)
- Hata ayıklama (gerçek stack trace'ler üzerinde)
- **Erişim:** Dosya sistemi, git, shell, Node.js, canlı test
- **Sınırı:** Uzun mimari sohbetlerde kaybolur, oturum başına net iş verilmeli

### İş Akışı Sırası

```
1. Web Claude'da sohbet → karar çıkar
2. Web Claude döküman/prototip üretir
3. Ömer indirir (~/Downloads/)
4. Yeni Claude Code oturumu açılır
5. Claude Code dosyaları repo'ya aktarır, git commit eder
6. Claude Code kodlama işlerine geçer (adım adım, her adım bir commit)
7. Tamamlanınca: sonuçlar web Claude'a geri rapor edilir
```

### Yeni Bir Oturum Başlarken

**Web Claude oturumuna geçerken:** Ömer yedek dökümanın son versiyonunu **EKLER** (upload), Claude okur, üzerine konuşur.

**Claude Code oturumuna geçerken:** Claude Code repo'da `docs/` altındaki yedek dökümanı **KENDİ OKUR** (file access var), gerekli bağlamı buradan alır.

---

## 📚 Öğrenilen Mimari Prensipler (21 Nisan 2026 Sohbetinden)

Bu prensipler sadece çok müşterili MRP için değil, **tüm modüller** (maliyet, envanter, fason vs.) için geçerli:

### 1. "Tek motor, çoklu girdi"
MRP motoru bir adet olmalı, farklı talep kaynakları (konteyner, satış siparişi, ileride...) aynı motora beslenmeli. Neden: stok havuzu ortak, satınalma/iş emri listeleri bütünlüklü. Ayrı motorlar = çift sayım + yalan sistem.

### 2. "Planlama ≠ İhtiyaç"
İki farklı zihinsel mod, iki ayrı ekran olmalı. **Planlama** = "ne zaman ne çıkacak" (takvim/zaman). **İhtiyaç** = "bu iş için neler eksik" (sipariş + bileşen ağacı). Aynı ekranda tıkıştırmak kötü UX.

### 3. "Aktif olan, hepsi değil"
Ölü veriyi yüklemek sistemi kirletir. Önce **aktif** (sipariş alan) olanları yükle, sistem akışı BOM eksik uyarısıyla kendini beslesin. "Batch import gereksiz, akış doğal büyür."

### 4. "Adaptör pattern"
Mevcut motoru **bozmadan** girdiyi genişlet. Yeni veri tipini motorun tanıdığı bir "sahte tip" olarak paketle. Refactor yapma, wrapper ekle.

### 5. "Görünürlük sisteme, karar insana"
Sistem veriyi sunar, insan kararı verir. Sessiz otomatik hareketler (VIO termin değişince override'ı silmek gibi) tehlikelidir. Görsel uyarı + insan onayı > sessiz veri hareketi.

### 6. "Sessizce yanlış, sessizce yoktan beter"
Lead time sabit "4 hafta" varsaymak yerine hiç varsayma, Faz 2'ye bırak. Yanlış veri bazlı karar, eksik veri bazlı kararla **aynı değil** — yanlış daha tehlikeli.

### 7. "İzole ekle, kademeli büyüt"
Yeni modüller ayrı klasörde, ayrı Firestore koleksiyonunda. App.jsx'i büyütmek değil, çevresini zenginleştirmek. Refactor bir gün gerekirse ayrı karar alınır.

### 8. "Her değişiklik tek sorumluluk"
Bir commit = bir fikir. 10 iyileştirme tek commit değil, 10 ayrı commit. Her biri bağımsız rollback edilebilir. Claude Code en verimli bu ritimde çalışır.

### 9. "Veri iki katmanda, override'lar korunur"
VIO ham veri üzerine yazılır (mevcut pattern). Manuel kararlar (override'lar) ayrı dokümanda saklanır, import'tan etkilenmez. `_catOverrides`/`_bulkOverrides`/`planOverrides` hepsi bu pattern'in örneği.

### 10. "Prototip karar aracıdır, kod değil"
Prototip tasarım karşılaştırması, karar verme ve yanlışları gösterme için. "Kodlamaya temel" değil. Prototip sonrası kod sıfırdan yazılır, prototipten kopyalanmaz (ama aynı yapı korunur).

---

## 🗺️ Yol Haritası — Faz 1A (Uygulama Planı)

Her adım bir **tek sorumluluk**. Her adım bir **git commit**. Her adımın bir **test kontrolü**.

### Hazırlık — Web Claude → Claude Code Aktarımı
1. Web Claude v19 dökümanı üretir (bu dosya)
2. Ömer indirir → Mac'ine
3. Yeni Claude Code oturumu açılır
4. Claude Code'a verilir: dökümanı + prototipleri + örnek Excel'leri repo'ya ekle, git commit et
   - `docs/SEVKIYAT_PRO_YEDEK_DOKUMAN_v19.md`
   - `docs/prototype/DigerMusterilerPrototip.jsx` (v1)
   - `docs/prototype/DigerMusterilerPrototipV2.jsx` (v2)
   - `docs/samples/ORNEKTOPLUURUNAGACI.xlsx` (repo public ise sanitize)
   - `docs/samples/ORNEKSATISSIPARIS.xlsx` (repo public ise sanitize)

### 🏁 Adım 0 — Hazırlık Oturumu (Kod Yok, Sadece Keşif)

**Amaç:** Claude Code'un mevcut kodu anlaması, risk tespiti, güven inşası.

**Görevler:**
- Yedek döküman v19 oku (özellikle 🆕 Açılan Konu + 🛡️ Güvenlik İlkeleri)
- Prototip v2'yi oku (görsel hedef)
- App.jsx'te menü/routing yapısını bul → "Diğer Müşteriler" için en güvenli eklenti noktası
- `downloadFullBackup` fonksiyonunu oku → yeni koleksiyonları otomatik alıp almayacağını söyle
- `parseAkibetExcel` fonksiyonunu oku → yeni parser için şablon
- `fetchVioReports` yapısını oku → Faz 1B riskini teyit et (sonraya not)

**Çıktı:** 4-5 cümlelik bir rapor: "Şu fonksiyonu şu satırda buldum, buraya ekleyeceğim, şu risk var."

**Kural:** Kod değişmez. Commit yok. Sadece anlayış.

**Süre:** 30-45 dakika.

### 📁 Adım 1 — Klasör İskeleti

**Görevler:**
```
src/
├── modules/
│   └── digerMusteriler/
│       ├── index.js                 (export ana bileşen)
│       ├── DigerMusteriler.jsx      (boş skeleton)
│       ├── hooks.js                 (boş)
│       ├── firestore.js             (boş)
│       └── parser.js                (boş)
└── shared/
    ├── weekUtils.js                 (ISO hafta hesapları)
    ├── moneyFormat.js               (formatMoney, formatMoneyFull)
    └── constants.js                 (boş, yer tutucu)
```

**App.jsx dokunulmaz.**

**Test:** `npm run dev` çalışıyor, mevcut Sevkiyat Pro aynen çalışıyor.

**Commit:** `feat(digerMusteriler): modül klasör iskeleti kuruldu`

**Süre:** 15 dk.

### 🎨 Adım 2 — Skeleton Ekran (Boş, Menüde Görünür)

**Görevler:**
- `DigerMusteriler.jsx` içinde "Yapım aşamasında" yazan basit bir boş ekran
- App.jsx'e **sadece 2 şey** eklenir:
  1. `import DigerMusteriler from './modules/digerMusteriler'`
  2. Menüye 1 item + routing'e 1 case
- Yetki: `canEdit` pattern'i (admin + üretim)

**Test — 14 maddelik hızlı test listesi çalıştırılır.**

**Commit:** `feat(digerMusteriler): boş sekme App.jsx'e bağlandı`

**Git stratejisi:** Feature branch `feature/diger-musteriler`.

**Süre:** 30-45 dk.

### 🗄️ Adım 3 — Firestore Şeması + Okuma

**Görevler:**
- `firestore.js` içinde:
  - `subscribeSalesOrders()` — `appData/salesOrders` dinleyicisi
  - `subscribePlanOverrides()` — `appData/planOverrides` dinleyicisi
- `hooks.js` içinde `useSalesOrders()`, `usePlanOverrides()` hook'ları
- Ekranda debug: "X sipariş, Y override yüklü"

**Test:**
- Firestore Console'dan manuel 1 test kaydı ekle → ekran güncelleniyor mu?
- Kayıt sil → ekran sıfırlanıyor mu?
- Mevcut sayfalar etkilenmemiş

**Commit:** `feat(digerMusteriler): Firestore okuma altyapısı`

**Süre:** 45 dk - 1 saat.

### 📊 Adım 4 — Excel Parser + Manuel Upload

**Görevler:**
- `parser.js` içinde `parseSalesOrderExcel(file)` — `parseAkibetExcel` pattern'i
  - Müşteri başlık satırlarını bul ("Müşteri 120-XXXX...")
  - Veri satırlarını parse et (tarih, stok kodu, teslim tarihi, kalan miktar, bedel)
  - `pNum` yardımcı fonksiyonu kullan (v18.16 fix korumalı, DOKUNMA)
  - Try/catch sarmala
- Ekranda bir **yükleme butonu**
- Yüklenen dosya → Firestore `salesOrders` koleksiyonuna yazılır (clearAndReplace)
- Özet gösterimi: "914 sipariş yüklendi, 3 müşteri"

**Veri şeması (her doküman):**
```
appData/salesOrders/{belgeNo}_{stokKodu}
  = {
    customerCode: "120-0107",
    customerName: "ASELSAN KONYA...",
    orderDate: "2026-01-17",
    belgeNo: 13664,
    stokKodu: "MM-9111-1622",
    stokAdi: "CUBUK PSZCL...",
    teslimTarihi: "2026-01-10",
    brm: "AD",
    orijinalMiktar: 30,
    sevkEdilen: 0,
    kalanMiktar: 30,
    fiyat: 184.40084,
    toplamBedel: 5532.03,
    importedAt: "2026-04-21T..."
  }
```

**Test:**
- `ORNEKSATISSIPARIS.xlsx` yüklenir → Firestore'a 914 sipariş
- Tekrar yükle → üzerine yazılıyor (duplicate değil)
- Mevcut sayfalar etkilenmemiş (14 maddelik test)

**Commit:** `feat(digerMusteriler): satış siparişi Excel parser + upload`

**Süre:** 1-2 saat.

### 📋 Adım 5 — Temel Liste Görünümü

**Görevler — prototip v2'den al:**
- Header + müşteri filtresi + arama + sıralama
- KPI şeridi (TL bedellerle)
- Hafta bazlı detay listesi (override olmadan, sadece VIO termin haftası)
- Sipariş no gruplaması
- Müşteri rozetleri (ASL/DNM/RKT)
- Gecikenler kutusu (sadece görünüm, henüz taşıma yok)
- `hooks.js`'te `useWeekGroupedOrders()` — veriyi haftalara ayırma

**YOK bu adımda:**
- Manuel taşıma (override)
- Drag & drop
- Aylık şerit
- BU HAFTA vurgu bloğu
- Not
- VIO değişti rozeti

**Test:**
- Aselsan'ın 892 siparişi düzgün listeleniyor
- Müşteri filtresi, arama, sıralama çalışıyor
- Performans: 900+ satırda yavaş değil
- Mevcut sayfalar etkilenmemiş

**Commit:** `feat(digerMusteriler): temel liste + filtre + arama + sıralama`

**Süre:** 2-3 saat.

### ✏️ Adım 6 — Manuel Override (Dropdown)

**Görevler:**
- Her satırda plan haftası butonu → dropdown popup
- `WeekPicker` bileşeni (prototipten al)
- Seçilen hafta → Firestore `planOverrides` dokümanına yaz
- Satırda turuncu ✏️ rozeti (override var)
- "Orijinale dön" seçeneği → override siler

**Veri şeması (her override):**
```
appData/planOverrides/{belgeNo}_{stokKodu}
  = {
    plannedWeek: "2026-W22",
    note: "",
    by: "Ömer",
    at: "2026-04-21T14:30:00Z",
    origWeek: "2026-W20"
  }
```

**Test — KRİTİK:**
- Bir siparişi taşı → Firestore'a yazılıyor
- Sayfayı yenile → override korundu
- "Orijinale dön" → Firestore'dan siliniyor
- **Upload testi:** Tekrar Excel yükle → **override'lar kayboldu mu?** (kaybolmamalı!)
- Mevcut sayfalar etkilenmemiş

**Bu testi geçmeden 7. adıma geçme.** İki katmanlı veri modelinin ruhu bu.

**Commit:** `feat(digerMusteriler): manuel hafta override (dropdown)`

**Süre:** 1-2 saat.

### 🎯 Adım 7 — Prototipteki Diğer Ayrıntılar

Her biri ayrı commit, her biri bağımsız rollback edilebilir:

1. **Aylık bedel şeridi** → `feat: aylık bedel şeridi`
2. **Hafta stripi** (üstteki 12 haftalık özet) → `feat: haftalık strip`
3. **BU HAFTA vurgu bloğu** → `feat: bu hafta vurgu`
4. **Drag & drop taşıma** → `feat: drag-drop override`
5. **Gecikenler detayı** (kademeli renk, "hf geç" etiketi) → `feat: gecikme süresi rozeti`
6. **Override notu** → `feat: override not alanı`
7. **VIO değişti rozeti** → `feat: son import değişiklik rozeti`

**Süre:** 1-2 gün toplam (her madde 1-2 saat).

### 🔔 Adım 8 — BOM Eksik Uyarı Sistemi

**Görevler:**
- Satış siparişi stok kodunu `bomMapping` ile karşılaştır (sadece okuma!)
- BOM'u olmayan ürünler için:
  - Satır başında ❓ rozeti (kırmızı)
  - Ekran başında "N ürün BOM eksik" badge
  - Tıklandığında eksik ürünler listesi
- `bomMapping`'e **YAZMA YOK**

**Test:**
- BOM'u yüklü ürün → rozet yok
- Yüklü olmayan ürün → kırmızı ❓
- Mevcut sayfalar etkilenmemiş (bomMapping değişmemiş)

**Commit:** `feat(digerMusteriler): BOM eksik uyarı sistemi`

**Süre:** 1-2 saat.

### 🎉 Adım 9 — Faz 1A Tamamlandı

**Son kontrol listesi:**
- ✅ Yeni sekme çalışıyor, 14 maddelik test geçiyor
- ✅ Excel manuel yükleme çalışıyor
- ✅ Override korunuyor (upload sonrası test geçer)
- ✅ Prototip v2'nin tüm görsel öğeleri mevcut
- ✅ BOM eksik uyarı çalışıyor
- ✅ Mevcut Firestore dokümanları değişmemiş
- ✅ App.jsx'te sadece 2 satır eklenti var

**Main'e merge** → Vercel otomatik deploy → canlıda dene.

**Sonra:** 2-3 hafta stabilize olmasını bekle, gerçek kullanım gözlemle, değişiklikleri not al. **Faz 1B'ye (mail otomasyonu) geçmeden önce** stabilize olduğundan emin ol.

### Toplam Süre Tahmini

| Adım | Süre |
|------|------|
| Aktarım (web → code) | 15 dk |
| 0. Keşif | 30-45 dk |
| 1. İskelet | 15 dk |
| 2. Boş sekme | 30-45 dk |
| 3. Firestore | 45 dk - 1 sa |
| 4. Parser + upload | 1-2 sa |
| 5. Temel liste | 2-3 sa |
| 6. Override | 1-2 sa |
| 7. Detaylar (7 alt) | 1-2 gün |
| 8. BOM eksik | 1-2 sa |
| **Toplam** | **3-5 iş günü** |

### Claude Code İçin Pratik İpuçları

1. **Her oturum başında başlangıç promptu:** "Sevkiyat Pro, Faz 1A Adım X'teyim, docs/v19 oku, şunu yapacağız..."
2. **Küçük, net görevler:** bir commit'lik iş ideal, büyük görevleri ver parçalara bölsün
3. **Her adım sonunda `git diff` ve test iste**
4. **Kötüye giderse `git stash` veya `git reset --hard`** — temiz state'e dön, tekrar anlat
5. **Branch stratejisi:** Faz 1A için tek branch (`feature/diger-musteriler`), adımlar commit, Faz sonunda main'e merge
6. **Önceliğini kaybetme:** Claude Code "bu da iyi olur" diye genişlemek isterse → "bu adımda sadece bu iş var, sonraki adıma"

### Claude Code Açılış Promptu Önerisi (Adım 0 için)

```
Selam, ben Ömer. Sevkiyat Pro'nun sahibiyim. Çok Müşterili MRP
genişlemesi için Faz 1A — Adım 0'a başlıyoruz. Kod yazma, sadece keşif.

Şunları yap:
1. docs/SEVKIYAT_PRO_YEDEK_DOKUMAN_v19.md oku — özellikle 🆕 Açılan
   Konu, 🛡️ Güvenlik İlkeleri, 🗺️ Yol Haritası bölümleri
2. docs/prototype/DigerMusterilerPrototipV2.jsx oku — görsel hedef
3. App.jsx'te menü/routing yapısını bul, "Diğer Müşteriler" sekmesi
   için en güvenli eklenti noktasını belirle
4. downloadFullBackup fonksiyonunu oku → yeni salesOrders ve
   planOverrides koleksiyonlarını otomatik alıp almayacağını söyle
5. parseAkibetExcel fonksiyonunu oku → yeni parser için şablon

Sonunda bana 4-5 cümlelik bir rapor ver: neyi nerede buldun, ne gördün,
hangi riskleri fark ettin. BU OTURUMDA KOD DEĞİŞMEYECEK.
Onaylıyorsan başla.
```

---

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
- **YENİ (21 Nisan 2026):** "Mevcut durumu etkilemeyecek değişiklikler" — her yeni kod için "nereleri etkiler?" sorusu kontrol edilir
- **YENİ (21 Nisan 2026):** Stratejik kararlar Claude Code'a değil, insan + web Claude sohbetine aittir

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

## Kritik Line Numaraları (v18.17 sonrası, ~14844 satır)

- Line 5: Firebase imports (getDocs, collection dahil)
- Line 57: VIO_CODES sözlüğü (temizlenmiş, 171 pid)
- Line 773-797: approveNewProduct (vioCode set + duplika koruma)
- Line 1101-1121: saveEditKg
- Line 1123-1147: downloadFullBackup
- Line 4822: canEdit = isAdmin || isUretim (MRPPlanlama)
- Line 5244: explosionResult state + mrpCacheLoaded + autoCalcPending useRef
- Line 5250-5280: Firestore listeners (BOM mapping + mrpCache)
- Line 5337: saveCatOverride / saveBulkOverride (pattern referans — planOverrides için model)
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
- **`saveBulkOverride(code, manual)`** — saveCatOverride pattern'i (line ~5337) → **`planOverrides` için referans pattern budur**
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

### ✅ Tamamlandı (v19 / 21 Nisan 2026)
- [x] Çok müşterili MRP genişlemesi — çerçeve tamamlandı, prototip v2 üretildi, yol haritası çıktı
- [x] Güvenlik ilkeleri dökümante edildi
- [x] Modülerleşme stratejisi kararı (Senaryo B + shared/ iskeleti)
- [x] Web Claude ↔ Claude Code rol ayrımı netleşti

### Yüksek Öncelik — Faz 1A (Çok Müşterili MRP)
- [ ] **Adım 0 — Keşif** (Claude Code): App.jsx routing, downloadFullBackup, parseAkibetExcel pattern, fetchVioReports yapısı
- [ ] **Adım 1 — Klasör iskeleti** (Claude Code): modules/digerMusteriler + shared/
- [ ] **Adım 2 — Boş sekme** (Claude Code): menüye bağla, 14 test geçsin
- [ ] **Adım 3 — Firestore okuma** (Claude Code): salesOrders, planOverrides koleksiyonları
- [ ] **Adım 4 — Parser + upload** (Claude Code): parseSalesOrderExcel, manuel yükleme UI
- [ ] **Adım 5 — Temel liste** (Claude Code): filtre, arama, sıralama, gruplanmış liste
- [ ] **Adım 6 — Override (dropdown)** (Claude Code): hafta taşıma, KRITIK upload testi
- [ ] **Adım 7 — Prototipteki detaylar** (Claude Code): 7 alt madde (aylık şerit, strip, bu hafta, drag&drop, gecikme rozeti, not, VIO rozeti)
- [ ] **Adım 8 — BOM eksik uyarı** (Claude Code): sadece bu sekme içinde

### Yüksek Öncelik — Devam Eden
- [ ] Tezgah çizelgeleme iyileştirmesi (operasyon süreleri düzeltme — devam eden iş)
- [ ] Fason yönetim modülü (fason alım siparişleri entegrasyonu dahil)

### Orta Öncelik
- [ ] Faz 1B — Mail otomasyonuna satış siparişi raporu entegrasyonu (Faz 1A stabil sonrası 2-3 hafta)
- [ ] Faz 2 — Motor entegrasyonu (adaptör) + sipariş bazlı ihtiyaç paneli
- [ ] Aselsan'ın 176 aktif ürününün BOM'larının Sevkiyat Pro'ya elle yüklenmesi (Ömer + BOM eksik uyarı sistemi kılavuzluğunda)
- [ ] VIO'dan satış siparişi raporuna döviz kolonunun eklenmesi (Ömer, VIO tarafı iş)
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

**Karar:** Yeni maliyet/envanter modülü, App.jsx içinde DEĞİL, ayrı dosyada başlayacak. **Çok müşterili MRP ile aynı mimari prensip — Senaryo B.**

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

**Not (v19):** Çok müşterili MRP sohbetinde satış tarafı döviz kodu VIO'dan alınacak hale geldi → maliyet modülüne geçerken alım tarafı ile beraber bütüncül değerlendirilir. "Satış dövizi + alım dövizi" birleşik sorudur.

**Araştırma yöntemi:** VIO'daki birkaç örnek PO'yu incele (TL ile yapılan alım + dolar/euro ile yapılan alım), kaydın hangi formatta olduğunu gör.

### Bekleyen Stratejik Sorular (Soru 0 sonrası, Aşama 1'e başlarken cevaplanacak)

1. **Maliyet değerleme yöntemi:** son fiyat mı, ağırlıklı ortalama mı? (önerim: başlangıç için son fiyat)
2. **Genel gider:** tek çarpan mı, kategori bazlı mı? (MAKE/FASON ayrı çarpanlar mümkün)
3. **Yetki sınırlaması:** `canSeeCost` rol eklenmeli mi? (operatör maliyet görmemeli)
4. **Tarihsel snapshot:** geçmiş sevkiyatlar için o dönemki maliyet mi, güncel maliyet mi? (başlangıçta sadece anlık, sonra snapshot)

### Sıra Beklemede — Önce Çözülecek İşler (Ömer'in talebi)

1. **Tezgah çizelgeleme iyileştirmesi** (devam eden iş) — operasyon süreleri düzeltme bu çalışmanın içinde
2. **Fason yönetim modülü** — fason alım siparişleri yüklenmesi dahil
3. **Çok müşterili MRP — Faz 1A** (paralel, bu yol haritası devam ediyor)
4. **Sonra** → maliyet modülüne başla (önce Soru 0 = döviz araştırması, sonra yukarıdaki MVP aşaması 1)

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

**v19 — Çok müşterili MRP için eklenecek (Faz 1A):**
| Doküman | İçerik |
|---------|--------|
| appData/salesOrders | VIO satış siparişi raporu (ham, her import'ta üzerine yazılır) |
| appData/planOverrides | Manuel hafta override'ları (import'tan etkilenmez, Ömer'in kararları) |

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
- **v19:** Çok müşterili MRP genişlemesi için Faz 1A kodlamaya hazır

### Dikkat Edilmesi Gerekenler
- `isOrderBulk` mantığına DOKUNMA — cascade, WIP, iş emri kararı hepsi buna bağlı. **v18.17 ile manuel override eklendi**, otomatik mantık korundu
- `calculateSchedule(silent, forceMrp)` parametreleri — manuel buton parametre geçmez (default false,false)
- `plsConfirmedLookup` yumuşak güncelleme — stok > 0 olduğu sürece onay korunur
- VIO_CODES sözlüğü temizlendi (171 pid, duplikalar yok) — yeni ürün eklenirken dikkat
- **pNum fonksiyonlarına DOKUNMA** — v18.16'daki `typeof === "number"` kontrolü kritik (frontend 3 yer + backend 1 yer)
- **parseAkibetExcel yeni alanları (openDate, rem, firstOpenOp, remainingOps, totalRemaining)** — frontend fallback mantığı güvenlik ağı, kaldırılmamalı
- **`_bulkOverrides` Firestore alanı** — `_catOverrides` ile aynı doc içinde (`mrpBomMapping`)
- **Gmail mail pencere süresi 24 saat BİLİNÇLİ** — `index.js`'te `fetchAllVioReports(auth, 24)`. 48'e çıkarma cazibesine direnilecek. Gerekçe: otomasyonun sessizce kendini kurtarmasındansa, 24+ saat gecikmede **erken uyarı** görmeyi tercih ediyoruz.
- **v19:** Yeni modül `src/modules/digerMusteriler/` klasöründe olmalı, App.jsx'e sadece 2 satır eklenti (import + menü item). Mevcut koda dokunma kuralı.

### Hızlı Test Kontrol Listesi (14 Madde)
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

**v19'da eklenecek (Faz 1A tamamlandıktan sonra):**
15. ✅ Diğer Müşteriler sekmesi menüde görünüyor, tıklayınca ekran açılıyor
16. ✅ Satış siparişi Excel yüklenebiliyor, Firestore'a yazılıyor
17. ✅ Manuel override yapılabiliyor, upload sonrası korunuyor
18. ✅ BOM eksik uyarısı çalışıyor
