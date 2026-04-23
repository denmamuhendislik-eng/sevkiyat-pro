# SEVKIYAT PRO — YEDEK DÖKÜMAN v20

> Son güncelleme: 23 Nisan 2026 gece (Faz 1A post-deploy + parser bug keşfi + tasarım oturumu)
> Oturum: v19 (21 Nis) → Faz 1A canlıya alındı (22 Nis) → retrospektif → v20 tasarım sohbeti (23 Nis)
> Önceki: `SEVKIYAT_PRO_YEDEK_DOKUMAN_v19.md` (21 Nis 2026, Faz 1A kodlama öncesi)
> Ara: `FAZ_1A_RETROSPEKTIF.md` (22 Nis 2026, Faz 1A deploy sonrası)
>
> **v20'deki farklar:**
> - 🚨 BOM Parser bug — 190 BOM yükleme blocker'ı (en tepeye alındı)
> - Faz 1A'nın retrospektifle 9 sapması resmileşti
> - Faz 2 tasarımı başladı: Ürün Özet iki kart, motor adaptörü yaklaşımı
> - Yeni modül: BOM Yönetimi (birleşik upload + eşleştirme)
> - 5 yeni iyileştirme/bug notu: belge no kaybı, çizelge süre sistemi, VIO import geçmişi, parser bug, BOM yükleme sırası
> - Öncelik sırası güncellendi: parser fix → BOM yükleme → Faz 1B → Faz 2

---

## 🚨 AKTİF BLOCKER — BOM Parser Bug

> **Tarih:** 23 Nis 2026 gece
> **Durum:** Tespit edildi, çözüm bekleniyor
> **Etki:** 190 BOM yükleme sürecinin önünde duruyor
> **Öncelik:** Yarınki Claude Code oturumunun 1 numaralı görevi
> **Detaylı brief:** `docs/CLAUDE_CODE_BRIEF_PARSER_FIX.md` (ayrı döküman)

### Problem

VIO Ürün Ağacı Excel formatında bir ürün şu yapıda gelir:

```
Ürün (151-0006): 330910-01 GÖVDE, 1 AD
├─ Oper: 211 İŞLEME MRK.1 (İŞLEME MERKEZİ)
│   └─ Hammadde: 150-1183-2 (GÖVDE DÖKÜMÜ, 1 AD)
├─ Oper: 212 İŞLEME MRK.2 (İŞLEME MERKEZİ)
└─ Oper: 623 FASON İNDÜKSİYON
```

**VIO mantığı:** Ürün 151-0006'nın 3 operasyonu var. Hammadde tüketimi ilk operasyonda (211 İŞLEME MRK.1). Sonraki operasyonlar (212, 623) aynı ürünün üzerinde devam ediyor, yeni hammadde girişi yok.

**Sevkiyat Pro'nun yanlış yorumu:**
```
151-0006 [MAKE+FASON, 1 op]  ← sadece 211'i görüyor
  └─ 150-1183-2 [RAW, 2 op]  ← 212 ve 623'ü buraya kaydırdı
        ├─ Oper 212 İŞLEME MRK.2
        └─ Oper 623 FASON İNDÜKSİYON
```

Parser, hammaddesiz "Oper:" satırlarını bir önceki hammaddenin altına kaydırıyor. Sonuç: fiziksel olarak var olmayan bir iş akışı.

### Etkiler

1. MRP sonucu yanlış (motor hammaddeyi 3 op'lu gibi görüyor)
2. İş emri önceliği yanlış
3. Çizelge doluluk yanlış iş merkezlerine yazılıyor
4. Süre hesabı yanlış ürüne atanıyor
5. Fason maliyeti yanlış ürüne yazılıyor (maliyet modülü yazıldığında temelden etkilenir)

### Neden Faz 1A'da görünmedi

Ömer testleri ana müşteri grubu üzerinde yaptı, orada muhtemelen "1 hammaddeli + N op'lu" durum yoktu (her seviyede hammadde var). Bu yapı **hammaddesiz op'ları açığa çıkaran** özel durum. Diğer Müşteriler (Aselsan) ürünleri BU yapıya daha yakın — bu yüzden 190 BOM yüklemeden önce çözülmek zorunda.

### Mevcut etkilenme

Ömer 4-5 üründe aynı durumun olduğunu düşünüyor — parser fix sonrası bu BOM'lar tek tek tekrar yüklenecek. Mevcut BOM'ların taraması Claude Code tarafından yapılacak (keşif aşaması).

### Çözüm sırası

1. **Aşama 1 (keşif, kod değişmez):** Parser kodu oku, mantığı özetle, 151-0006 ile çalıştır, mevcut BOM'ları tara
2. **Aşama 2 (düzeltme):** Parser kuralı düzeltilir (her "Oper:" ürüne ait, hammadde varsa op'ta tüketilir)
3. **Aşama 3 (test + migrate):** 151-0006 yeniden yükle, hatalı BOM'ları düzelt, regression testi
4. **Kriter:** Üç test geçtikten sonra 190 BOM yükleme süreci başlar

Detay: `CLAUDE_CODE_BRIEF_PARSER_FIX.md`.

---

## 1. Faz 1A Tamamlandı — Özet

Ayrıntılı retrospektif: `FAZ_1A_RETROSPEKTIF.md`. Burada sadece v20'yi etkileyen özet:

- **Canlı:** sevkiyat-pro.vercel.app, main @ `09a64f8`
- **16 feature + 2 post-deploy patch commit**
- **Veri:** 855 unique satış siparişi (914 satırdan 59 duplicate birleşti), 3 müşteri (Aselsan 833, Denma 20, Roketsan 2), 64.1M TL
- **Yeni modül:** `src/modules/digerMusteriler/` + `src/shared/` iskeleti kuruldu
- **App.jsx değişimi:** +48/-13 satır (Senaryo B modülerlik ilkesi kanıtlandı)
- **Yeni Firestore:** `salesOrders` (855 unique), `planOverrides` (şu an 0)
- **Yeni rol:** `satis` — Diğer Müşteriler + MRP + Paketleme sahibi, üretim bu modülden çıktı

### v19'dan 9 Sapma (retrospektifin 3. bölümünün özeti)

1. **3-tuple ID** — `{belgeNo}_{stokKodu}_{teslimTarihi}` (v19 2-tuple demişti, gerçek veri %57 collision üretti)
2. **BOM eksik "BOM yükle →" butonu + MRP auto-tab** (v19 sadece rozet demişti)
3. **Yetki mimarisi** — `canEdit` component-local, `satis` rolü post-deploy eklendi
4. **İkon** — 🤝 (v19'da belirtilmemişti)
5. **Override `by` alanı** — role string (v19 email demişti, şimdilik role yeterli)
6. **Aggregate davranışı** — 3-tuple'da miktar + bedel sum, diğer alanlar ilk satırdan
7. **Drag & drop — not korunur** (drag sadece plannedWeek değiştirir)
8. **VIO değişti rozeti (mavi ●)** — 3-tuple ID yüzünden nadir tetiklenir, Faz 2'de stale override'a evrilir
9. **No-teslim edge case** — post-deploy fallback (`teslim || orderDate || row{idx}`)

---

## 2. v20'de Açılan Yeni Konular

### 2.1. MRP Planlama — Ürün Özet İki Kart

**Problem:** Mevcut Ürün Özet kartı konteyner + sipariş talebini birleşik gösteriyor. Üst seviyede "hangi müşteri ne kadar" sorusu cevapsız kalıyor.

**Karar:** Ürün Özet **iki kart yan yana** olacak:

- 📦 **Ürün Özet (Konteyner)** — mevcut yapı, konteyner kaynaklı talep
- 🤝 **Ürün Özet (Sipariş)** — satış siparişi kaynaklı talep (Aselsan + Denma + Roketsan birleşik)

Diğer kartlar (Brüt İhtiyaç, Net Açık, Satınalma, Üretim, Fason, Çapraz Uyumsuz) **birleşik kalır**. Mantık:

- **Kaynak kararı etkiliyorsa ayır** (Ürün Özet: hangi müşteri için ne üreteceksin)
- **Kaynak gürültü ise birleştir** (Satınalma: tedarikçiye tek PO, hammadde zaten paylaşımlı → çift sayım riski)
- **Alt seviyelerde ayrım fiziksel olarak anlamsız** (üretim tezgahları ortak, fason servisleri ortak)

Bu karar **v19'un 1. prensibi "tek motor, çoklu girdi"** ile tam uyumlu. Motor tek havuz üretir, çıktıda kaynak etiketi korunur, UI sadece Ürün Özet'te ayrım gösterir.

**Teknik gereksinim — Faz 2 motor çıktısı:**
Motor çıktısındaki her net talep satırı `source: 'container' | 'salesOrder'` etiketini **korumalı** (tek sayıya çökmemeli). UI iki kartı aynı çıktıdan kaynak filtreleyerek üretir.

### 2.2. Motor Adaptörü (Faz 2 başlangıç)

v19'un çerçevesi: `salesOrders` → demand list dönüştürücü, `runBomExplosion` girdi genişletir, motor kodu aynı kalır.

v20 oturumunda **4 ana tasarım ekseni** belirlendi, henüz her biri için detaylı karar yok:

1. **Demand list tipi** — `{source: 'container' | 'salesOrder', ...}` birlikte mi, yoksa satış siparişi "sahte konteyner" mi? (Konteynerler model-based, satış siparişleri parça-based — ciddi asimetri var.)
2. **Tarih kaynağı** — motor `teslimTarihi` mi, `planOverrides.plannedWeek` mi tüketecek? (Override'lar motora inmeli — aksi halde Diğer Müşteriler'deki manuel karar boşa gider.)
3. **Stok allocation** — Konteyner + satış siparişi zaman sırasına göre ortak havuzdan tüketim. "Gizli RAW" sorunu (v19 son bölüm) satış siparişleri eklendikçe büyüyebilir — Faz 2 ile birlikte çözülmeli mi?
4. **Motor'un "dokunulmazlık" kapsamı** — v19 "motor kodu aynı" diyor. Gerçekte girdi tek nokta mı, yoksa motor yer yer "konteyner varsayımı" yapıyor mu? (Claude Code keşif gerekli.)

**Durum:** Tasarım oturumu bu konuyla başladı ama **önce stabilize + BOM yükleme** tamamlanacak. Detaylı tasarım sohbeti Mayıs ortası sonrası.

**Ön koşullar (Faz 2 başlamadan önce):**
- ✅ Faz 1A stabil canlıda (gerçek kullanım gözlemlendi)
- ⏳ BOM Parser bug düzeltildi
- ⏳ 190 BOM yüklendi (Aselsan aktif ürünlerin BOM'ları mevcut)
- ⏳ Claude Code motor kodu keşfi yaptı (adaptör noktaları belli)

### 2.3. BOM Yönetimi — Yeni Birleşik Modül

**Problem:**
- Mevcut **iki ekran** var: Veri Yönetimi'nde BOM upload + MRP Hesaplama'da Ürün↔BOM Eşleştirme
- 190 BOM yükleme senaryosunda mevcut UI yetersiz:
  - Etiket bulutu görsel olarak çöker
  - Duplicate koruması görünmüyor
  - Arama yok, bulk action yok
  - "Yüklediğim BOM şu ürünle eşleşti mi" sorusuna kolay cevap yok
  - Otomatik eşleştirme güvenilmez (Ömer denedi, yanlış eşledi)
  - Upload sonrası ayrı ekrana geçip eşleştirme gereği — ekstra adım

**Karar: Yeni birleşik modül** — `src/modules/bomYonetimi/`

**Güvenlik prensibi — eskiler yerinde kalır:**
Mevcut iki ekran (`Veri Yönetimi` → BOM upload + `MRP Hesaplama` → Eşleştirme) **dokunulmaz**. Yeni modül paralel bir alternatif. Stabilize olup güvenilirliği doğrulandıktan sonra eskiler pasifleştirilir (ileri bir karar).

**Ekran yapısı:**

```
┌─ BOM Yönetimi ─────────────────────────────┐
│ 📦 N BOM · 🟢 eşleşti · 🟡 eksik · 🔺 ürün BOM yok │
│                                             │
│ [ + BOM Yükle ] ← ana buton                │
│                                             │
│ Arama: [_______]  Filtre: [Tümü ▾]         │
│                                             │
│ ┌─ BOM Listesi ─────────────────────────┐  │
│ │ Kod │ Parça │ Eşleşen Ürün │ Tarih │🟢│  │
│ └──────────────────────────────────────┘  │
│                                            │
│ [Sekme: BOM Listesi | BOM Eksik Ürünler]  │
└─────────────────────────────────────────────┘
```

**Upload akışı — modal:**

```
┌─ BOM Yükle ─────────────────────────┐
│ [Excel sürükle & bırak]             │
│                                     │
│ Yüklendi: 152-0104 ✓                │
│ • REDÜKTÖR DİŞLİ TAKIMLARI C54ST   │
│ • 208 parça · 4 seviye              │
│ • Operasyonlar: TORNA, FREZE...    │
│ • [▾ Ağacı önizle]                 │
│                                     │
│ Ürün eşleştirme:                    │
│ ◉ BOM'u olan ürün → [Dropdown ▾]   │
│ ○ Satın alınan ürün (BUY) → [ ▾ ]  │
│ ○ Şimdilik eşleştirme (taslak)      │
│                                     │
│ ℹ️ Bu BOM şu ağaçlarda alt bileşen: │
│    • TP32/36 REDÜKTÖR               │
│    • TP25/32 REDÜKTÖR               │
│                                     │
│ [ İptal ]  [ Kaydet ve kapat ]      │
│            [ Kaydet ve yeni ] ←     │
└─────────────────────────────────────┘
```

**"Kaydet ve yeni"** — modal kapanmadan sıfırlanır. 190 BOM için bu döngü hayati.

**BUY davranışı — "workaround" değil sistem gerçeği:**
BOM'u olmayan ürünlerde kullanıcı "Satın alınan ürün (BUY)" seçer, arkada eski pattern korunur (ürünü kendisiyle eşle + supply type = BUY, 1 seviyeli sahte ağaç). Mevcut motor bu varsayım üzerine kurulu, **motor kodu dokunulmaz**. UI'da eşit görünürlükte, saklanmamış.

**Nested BOM gösterimi:**
Bir BOM ağaç içinde başka bir ürünün alt bileşeni olabilir (örn. 121299 ayna hem standalone ürün hem TP32/36'nın altında). Bu mevcut `bomModels` yapısının doğal davranışı, motor zaten destekliyor. Modal'da **read-only bilgi satırı** olarak gösterilir — eşleştirme değil, bilgi.

**BOM ↔ Ürün eşleştirmesi:**
1:1 ilişki. Aynı BOM başka ürünlere **eşlenmez** (teyit edildi). Dropdown/radio tek seçim.

**Otomatik eşleştirme:**
Her zaman **öneri**, asla sessiz kabul. "Önerilen: 152-0104 REDÜKTÖR C54ST (%94)" gösterilir, onay kullanıcıdan gelir.

**Override koruması (Claude Code teyit etmeli):**
Aynı BOM kodu tekrar yüklenirse — mevcut davranış muhtemelen `_catOverrides` pattern'i ile korunuyor. Yeni modül aynı davranışı sürdürmeli (uyarı + override koru).

### 2.4. Diğer Müşteriler → BOM Yönetimi Yönlendirmesi

Faz 1A'da Adım 8'de yapılan "BOM yükle →" butonu şu an **mevcut upload ekranına** (`MRPPlanlama → Ürün Ağacı`) yönlendiriyor. Yeni modül canlıya çıktığında **yönlendirme yeni ekrana güncellenmeli.**

**Ek öneri — context koru:**

```
Diğer Müşteriler'de [MM-9111-1622 için BOM yükle →] tıklanır
   ↓
BOM Yönetimi ekranı açılır + modal otomatik açık
   ↓
Banner üstte: "MM-9111-1622 için BOM yükleniyor"
   ↓
Upload sonrası: eşleştirme dropdown'ında bu ürün ön-seçili
```

Özellikle 176 Aselsan ürünü için BOM yükleme dönemi başladığında kritik: satış kullanıcısı "hangi ürün için" sorusuyla geri dönmek zorunda kalmaz.

### 2.5. Geçiş Dönemi Sözleşmesi (yeni genel prensip)

v19'daki 10 mimari prensibe ek olarak:

> **Eski ekran yerde duruyor + yeni ekran paralel → tüm yönlendirmeler (navigation/buton) yeni ekrana yönelir.**

Aksi halde:
- Bazı butonlar eskiye, bazıları yeniye yönlendirir → kullanıcı kafası karışır
- Eski ekran "ölmeye hazır" yerine yaşamaya devam eder
- Kullanım verisi dağılır

Eski ekran pasifleştirme kararı (yeni ekran kanıtlandıktan sonra) bu yönlendirmeler geçmiş olduğundan doğal olur.

Bu prensip BOM Yönetimi geçişi için geçerli. Gelecekte benzer geçiş senaryoları (maliyet modülü, envanter vs.) için de referans.

---

## 3. v20 İyileştirme ve Bug Notları

### 💡 #1 — Diğer Müşteriler: tek satırlı sipariş gruplarında belge no kaybı

**Durum:** Çok satırlı belgelerde "Belge 623 · 3 satır" başlığı görünüyor. Tek satırlık belgelerde belge numarası hiçbir yerde görünmüyor (örn. AC-9111-0077, Belge 12345, tek satır → "Belge" bilgisi yok).

**Çözüm:** Belge numarası stok kodu satırına inline eklenecek (ASL rozetinin yanına). Mobilde test edilecek, taşma varsa fallback (stok kodu altı).

**Ölçek:** Küçük patch, Faz 1A modülünde tek satır edit.

### 🐛 #2 + 💡 #3 — Tezgah Çizelgeleme Süre Sistemi

**Kapsam:** v19'da zaten aktif olan "Tezgah çizelgeleme iyileştirmesi" başlığı altında. Ayrı derin tasarım sohbeti hak ediyor.

**Tespit edilen sorunlar:**
1. Çizelge Doluluk'taki yeşil süre (örn 17.83dk/ad, 4.83dk/ad) **hangi alandan okunduğu belirsiz**. Üstteki "MES: 12 iş · 11699dk" vs "Vars: 14 iş · 4640dk" rozetleri iki kaynak varlığını gösteriyor ama fallback mantığı görünmüyor.
2. Süre bilgisi iki yerde tutuluyor olabilir — **Ürün Ağacı (BOM)** ekranında edit edilebilen süre + **Çizelge Doluluk**'taki süre. İki kaynak, tek gerçek prensibi ihlal riski.
3. Manuel override imkanı belirsiz.

**Claude Code araştırması (tasarımdan önce zorunlu):**
- Yeşil süre hangi Firestore alanından okunuyor? Fallback zinciri ne?
- "MES" vs "Vars" rozet mantığı nedir?
- Ürün Ağacı'ndaki süre ile Çizelge'deki süre aynı alan mı, bağımsız mı?
- Manuel edit şu an mümkün mü? Nereye yazıyor?

**Tasarım taslak — katmanlı model:**

| Katman | Kaynak | Yazma yeri |
|---|---|---|
| 1 (base) | VIO Ürün Ağacı | Ağaç import'u |
| 2 (gerçek) | MES ortalaması | MES import'u |
| 3 (override) | Manuel giriş | Kullanıcı (Ağaç veya Doluluk'tan aynı yere) |

Okuma önceliği: 3 → 2 → 1. Kaynak rozeti: `📊 MES` / `✋ Manuel` / `📄 Ağaç`.

MES çakışma davranışı tercihi: **Manuel korunur + sarı uyarı** ("MES güncellendi, manuel değeriniz eski olabilir"). v19'un 5. prensibi "görünürlük sisteme, karar insana".

**Sıra:** Önce Claude Code keşif (Adım 0 tipi, kod değişmez), sonra tasarım sohbeti.

### 💡 #4 — VIO Import geçmişi + satır detayı

**Durum:** VIO Import ekranı yükleme yapıyor ama sonrası görünmüyor. Diğer Müşteriler'deki "sipariş listesi" mantığı burada yok → tutarsızlık.

**Tasarım:**

```
┌─ VIO Import ───────────────────────────────┐
│ [Yıl seç] [Upload zone]                    │
│ ─────────────────────────────────          │
│ 📋 Son yüklemeler                          │
│                                            │
│ ▼ 22 Nis 16:30 · 2026 · dosya.xlsx · 15 satır│
│    Sipariş No  Tarih     Ürün   Miktar     │
│    K-2401      15 Nis    P54    120        │
│    ...                                      │
│                                            │
│ ▶ 18 Nis 09:45 · 2026 · ... · 12 satır    │
└────────────────────────────────────────────┘
```

Her import expand/collapse. Üst yüklemesi otomatik açık. Yeni Firestore doc: `vioImportHistory` (tarih, dosya, yıl, kullanıcı, satır sayısı, satırlar[]). Mevcut `yearsData/{yıl}` yapısına **dokunulmaz** — sadece yeni doc eklenir (Seviye 1 izolasyon).

**"Geri al" butonu YOK** (güvenlik). Sadece görsel kayıt. Yanlış yükleme Ömer tarafından elle düzeltilir.

**Önkoşul (Claude Code teyit):**
- VIO Import'un okuduğu Excel'de **sipariş no + tarih kolonları** var mı? Fotoda "CODE ve QUANTITY sütunları olmalıdır" yazıyor (sadece 2 kolon okuyor şu an).
- Yoksa VIO tarafında kolon ekletme gerekli (Diğer Müşteriler'in döviz kolonu pattern'i).
- Varsa parser genişletilir.

### 🐛 #5 — BOM Parser bug (KRİTİK, 190 BOM BLOCKER)

Yukarıda **🚨 AKTİF BLOCKER** bölümünde detaylandırıldı. Detaylı brief: `CLAUDE_CODE_BRIEF_PARSER_FIX.md`.

### 💡 #6 — 190 BOM yükleme sırası

**Durum:** Ömer ~190 aktif BOM'u 2 gün içinde elle yükleyecek (Aselsan 176 + mevcut eksiklerin tamamlanması). Ağaçları kontrol ederek tek tek.

**Gereksinimler:**
1. Parser bug düzeltilmeli (🐛 #5) — aksi halde yanlış yüklenir
2. BOM Yönetimi modülü kullanışlı olursa oradan yüklenir (paralel gelişebilir, ama blocker değil)
3. Deneme yükleme sen başlarsın, yeni ekran çıktığında kalan kısım oradan

**Sıra:**
- 🔴 Parser fix + test (Claude Code ilk oturum)
- 🟡 Ömer birkaç deneme BOM yükler (mevcut ekranla, parser düzeltildikten sonra)
- 🟢 BOM Yönetimi modülü canlı çıktığında kalan BOM'lar oradan
- 🟢 176 Aselsan aktif ürünün tamamı yüklendiğinde Faz 2 ön koşulu tamamlanır

---

## 4. Güvenlik İlkeleri (v19'dan devam, hatırlatma)

Yeni modüller aynı 3 seviyede izolasyon sağlar:

### Seviye 1 — Veri İzolasyonu
- **Yeni koleksiyonlar (v20):** `vioImportHistory` (ek audit log)
- **Mevcut koleksiyonlara yazma YOK** — sadece okuma
- Faz 1A'da kanıtlandı: `salesOrders` + `planOverrides` eklendi, eski 7 koleksiyon dokunulmadı

### Seviye 2 — Kod İzolasyonu
- Yeni modüller: `src/modules/bomYonetimi/` (v20'de planlanan)
- App.jsx değişimi **minimal** (sadece import + routing)
- Faz 1A'da kanıtlandı: +48/-13 satır (14.8k+ satırlık dosyada)

### Seviye 3 — Hata İzolasyonu
- Parser try/catch
- Firestore listener error callback
- Upload error → inline UI, ekran çökmez

### Dokunulmaz Alanlar (v19 + v20 eklemeli)

v19'dan devam:
- `isOrderBulk` mantığı
- `calculateSchedule(silent, forceMrp)` parametreleri
- `plsConfirmedLookup` yumuşak güncelleme
- VIO_CODES sözlüğü
- `pNum` fonksiyonları (v18.16 typeof === "number" kontrolü)
- `parseAkibetExcel` yeni alanları
- `_bulkOverrides` Firestore alanı
- Gmail mail pencere süresi (24 saat bilinçli)

v20 ekleri:
- `salesOrders` 3-tuple ID şeması (`{belgeNo}_{stokKodu}_{teslimTarihi}`)
- `planOverrides` doc yapısı (Faz 1A'da kurulan)
- `satis` rolünün yetki kapsamı (canSeeDigerMusteriler + canSeeMRP + canPack)
- ID fallback zinciri (`teslim || orderDate || row{idx}`)
- Parser `pendingMrpTab` + `initialTab` one-shot pattern'i (BOM eksik yönlendirme için)

### Kodlama Kuralları

1. Asla App.jsx'te mevcut fonksiyonu değiştirme — sadece yeni dosyalar + minimum bağlantı
2. Asla mevcut Firestore dokümanını yazma — yeni koleksiyonlara yaz, mevcutları oku
3. Her yeni state/hook/listener yeni modülün içinde
4. Her değişiklikten önce `git diff` kontrolü
5. Deploy öncesi 14 maddelik hızlı test (+ Faz 1A'dan eklenen 4 madde, toplam 18 madde)
6. Rollback: her yeni dosya git'te → `git revert` granüler

---

## 5. Modülerleşme Stratejisi (v19'dan devam, kanıtlandı)

### Senaryo B kanıtlandı

Faz 1A boyunca App.jsx'te **+48/-13 satır** net değişiklik (toplam 14,844 satırın %0.3'ünden az). Tüm iş `src/modules/digerMusteriler/` + `src/shared/` altında kaldı. Refactor baskısı doğmadı.

### Mevcut yapı

```
src/
├── App.jsx (değişmez, ~14.8k satır)
├── modules/
│   ├── digerMusteriler/   (Faz 1A — canlı)
│   ├── bomYonetimi/       (v20 — planlanan)
│   ├── maliyet/           (gelecek, v19'da planlandı)
│   └── envanter/          (gelecek, v19'da planlandı)
└── shared/                (Faz 1A'da iskelet kuruldu)
    ├── weekUtils.js
    ├── moneyFormat.js
    └── constants.js
```

### Refactor tetikleyicileri (v19'dan devam)

- App.jsx 18.000 satırı geçerse
- Claude Code "bu dosya çok büyük" derse
- 1 aylık özellik plato'su
- Yoğun oturumda "bu kod beni yoruyor" hissi

Şu an için Senaryo B devam, Senaryo A/C ihtiyaç doğmadı.

---

## 6. Web Claude ↔ Claude Code Rol Ayrımı (v19'dan devam)

Faz 1A'da kanıtlandı. Kısa hatırlatma:

| Araç | Alanı |
|---|---|
| 🌐 Web Claude | Yazım, strateji, tasarım sohbetleri, prototip (artifact), v20/v21 dökümanları, örnek veri analizi |
| 💻 Claude Code | App.jsx entegrasyon, git, deploy, testler, hata ayıklama, Firestore okuma/yazma kodu |

**İş akışı:** Web Claude'da karar → döküman/brief üret → Ömer indir → Claude Code oturumu → repo + git + test → geri rapor

**Yeni oturumda:**
- Web Claude → Ömer v20 dökümanını ve retrospektifi project knowledge'a ekler (bu sohbete yükleme değil, projeye kalıcı)
- Claude Code → repo'daki `docs/` altından v20'yi kendi okur

### Proje odaklı çalışma notu (23 Nis yeni — Ömer'in ilk projesi)

- **Sohbet ataşması ≠ project knowledge.** Sohbet atasması sadece o sohbette kalır. Project knowledge bütün sohbetlerde context olur.
- v20 dökümanı ve bu retrospektif **project knowledge'a yüklenmeli** (Claude Projects ana sayfasından "Add content").
- Yeni versiyon çıkınca (v21, v22) eski versiyonu silip yenisini yükle (Claude iki versiyonu birden görürse kafası karışabilir).

---

## 7. Öğrenilen Mimari Prensipler (v19'un 10 prensibi + v20 ek)

v19'dan devam, hatırlatma için başlıklar:

1. Tek motor, çoklu girdi
2. Planlama ≠ İhtiyaç
3. Aktif olan, hepsi değil
4. Adaptör pattern
5. Görünürlük sisteme, karar insana
6. Sessizce yanlış, sessizce yoktan beter
7. İzole ekle, kademeli büyüt
8. Her değişiklik tek sorumluluk
9. Veri iki katmanda, override'lar korunur
10. Prototip karar aracıdır, kod değil

**v20 ek prensipler:**

### 11. Geçiş dönemi sözleşmesi
Eski ekran yerde + yeni ekran paralel → tüm navigation yeni ekrana yönelir. (Bölüm 2.5'te detay.)

### 12. Gerçek veriyle erken doğrulama
Faz 1A retrospektif 8.1'den damıtıldı: Prototype verisi yanıltıcı olabilir, ilk fırsatta gerçek veri yüklenmeli. v20'de kanıtlandı tekrar: 151-0006 gerçek dosyası parser bug'ını açığa çıkardı, test verisi yapamazdı.

### 13. Tek gerçek kaynak
Aynı bilgi iki yerde edit edilebilirse çakışma kaçınılmaz. Katmanlı model + kaynak rozetiyle çözülür (bkz 🐛 #2 süre sistemi).

---

## 8. Güncel Yol Haritası — Öncelik Sırası

| Öncelik | İş | Zaman | Durum |
|---|---|---|---|
| 🔴 **1** | **BOM Parser bug fix** | Yarın (24 Nis) Claude Code oturumu | **AKTİF** |
| 🟡 2 | Birkaç hatalı BOM'u tekrar yükle (4-5 ürün) | Parser fix sonrası | Beklemede |
| 🟡 3 | Diğer bulgular: 💡 #1 (belge no), 💡 #4 (VIO import geçmişi) | Stabilize sırası, küçük patch'ler | Beklemede |
| 🟡 4 | Ömer birkaç deneme BOM yüklemesi | Parser fix sonrası | Beklemede |
| 🟢 5 | **BOM Yönetimi modülü** (birleşik upload + eşleştirme) | ~1 hafta paralel geliştirme | Tasarım hazır |
| 🟢 6 | Aselsan 176 aktif ürünün BOM'ları — tamamı yüklenene kadar | BOM Yönetimi canlı sonrası 1-2 hafta | Beklemede |
| 🟠 7 | **Faz 1B** — Mail otomasyonuna satış siparişi 4. rapor | BOM yükleme + stabilize bitince | Beklemede |
| 🔵 8 | **Faz 2** — Motor adaptörü + Ürün Özet iki kart + Sipariş bazlı ihtiyaç paneli | Tüm BOM'lar yüklü olduktan sonra | Tasarım başladı |
| 🔶 9 | Tezgah çizelgeleme süre sistemi (🐛 #2 + 💡 #3) | Ayrı çalışma, ayrı oturumlar | Claude Code keşif bekliyor |
| 🔶 10 | Fason yönetim modülü | v19'dan devam | Beklemede |
| 🔶 11 | Maliyet modülü Aşama 1 (hammadde) | Soru 0 (döviz) netleşince | Beklemede |

**Stabilize penceresi:** 22 Nis → ~13 May (retrospektiften). Parser fix bu pencere içinde. BOM Yönetimi bu pencerede geliştirilebilir. Faz 2 stabilize sonrası.

---

## 9. Pending / Askıdakiler

### ✅ Tamamlandı (Faz 1A, 22 Nis 2026)

Retrospektifteki 16 commit + 2 patch, 855 satış siparişi canlı, satış rolü eklendi. Detay: `FAZ_1A_RETROSPEKTIF.md`.

### 🔴 Aktif (24 Nis 2026 Claude Code oturumu)

- [ ] **BOM Parser bug fix** — 3 aşamalı plan (keşif + düzeltme + test)
  - [ ] Aşama 1: Parser kodu oku, 151-0006 ile test, mevcut BOM tarama
  - [ ] Aşama 2: Düzeltme (parser kuralı)
  - [ ] Aşama 3: Test (151-0006 yeniden yükle + hatalı BOM'lar düzelt + regression)

### 🟡 Sıradaki (stabilize penceresi, Mayıs ilk iki hafta)

- [ ] Birkaç deneme BOM yüklemesi (Ömer)
- [ ] 💡 #1 — Diğer Müşteriler tek satırlı belge no (küçük patch)
- [ ] 💡 #4 — VIO Import geçmişi (önce Excel kolon teyidi, sonra yeni doc + UI)
- [ ] BOM Yönetimi modülü tasarım + kod (paralel, ~1 hafta)
- [ ] Aselsan 176 aktif ürünün BOM yüklemesi başlaması

### 🟢 Orta vadeli (Mayıs sonu - Haziran)

- [ ] Faz 1B — Mail otomasyonuna 4. rapor
- [ ] Faz 2 motor adaptörü detaylı tasarım oturumu (4 eksen)
- [ ] Faz 2 — Sipariş bazlı ihtiyaç paneli UX tasarımı
- [ ] Faz 2 — Override stale uyarısı (Faz 2'nin doğal parçası)

### 🔶 Daha sonra

- [ ] 🐛 #2 + 💡 #3 — Tezgah çizelgeleme süre sistemi (önce Claude Code keşif, sonra tasarım)
- [ ] Fason yönetim modülü
- [ ] Maliyet modülü Aşama 1 (Soru 0: döviz netleşmesi)
- [ ] Gizli RAW sorunu (Opsiyon C/D)
- [ ] Email bazlı `by` alanı (authUser prop drill)
- [ ] Toplu override silme admin butonu
- [ ] 116925-01/04 BOM ağacı "Eşleştirilmemiş" uyarısı

---

## 10. Firestore Şema (v19'dan güncel + v20 ekleri)

| Doküman | İçerik | Durum |
|---|---|---|
| appData/products | Ürün listesi | Mevcut |
| appData/bomModels | BOM ağaçları | Mevcut |
| appData/mrpBomMapping | BOM eşleştirme + cat override + bulk override | Mevcut |
| appData/mrpCache | BOM Explosion cache | Mevcut |
| appData/workCenters | İş merkezleri + kapasite | Mevcut |
| appData/schedJobOrder | Çizelge iş emirleri | Mevcut |
| appData/plsConfirmations | Hat stoğu onayları | Mevcut |
| appData/mrpStock | VIO Stok Raporu | Mevcut |
| appData/mrpAkibet | Bekleyen Operasyonlar (v14 format) | Mevcut |
| appData/mrpPurchaseOrders | Sipariş Kontrol Listesi | Mevcut |
| appData/automationLog | Cloud Function log'ları | Mevcut |
| yearsData/{yıl} | Sevkiyat planı (konteynerler, miktarlar) | Mevcut |
| montajState | Montaj planı | Mevcut |
| **appData/salesOrders** | **Satış siparişi ham (3-tuple ID)** | **Faz 1A ile eklendi ✓** |
| **appData/planOverrides** | **Manuel hafta override'ları** | **Faz 1A ile eklendi ✓** |

**v20'de eklenecek:**

| Doküman | İçerik |
|---|---|
| appData/vioImportHistory | VIO import geçmişi (💡 #4) |

**Gelecekte eklenecek (Faz 2 + maliyet modülü):**

| Doküman | İçerik |
|---|---|
| appData/costSettings | İş merkezi saat ücretleri, genel gider çarpanı |
| appData/partCosts | Parça bazlı hesaplanmış maliyetler |
| appData/inventoryValue | Envanter değer snapshot'ları |
| appData/processingTimes (?) | Katmanlı süre sistemi (🐛 #2) — tasarım sonrası netleşir |

---

## 11. Hızlı Test Kontrol Listesi (14 + Faz 1A'dan 4 = 18 madde)

v19'un 14 maddesi + Faz 1A post-deploy'dan eklenen 4 madde:

1. ✅ Sevkiyat Pro açılır, sol menü çalışır
2. ✅ MRP Planlama → BOM Explosion → sonuç gelir
3. ✅ Çizelge otomatik hesaplanır (Kendi MRP badge'i)
4. ✅ Sayfa yenile → MRP sonucu hâlâ duruyor
5. ✅ Acil Aksiyon paneli: 6 sayaç kartı
6. ✅ Satınalma → Excel Export butonu → popup → dosya iner
7. ✅ VIO otomasyon badge yeşil
8. ✅ Montaj Planı → KPI → "En Son Tamamlanan Model" doğru
9. ✅ Sevkiyat Bazlı İhtiyaç panel → bulk rozeti (⊕/🔒/🔓) görünüyor (v18.17)
10. ✅ WIP tooltip'i doğru formatında
11. ✅ 150-0047 Q240 7131 → Açık Sip. = 4255.32 (v18.16 pNum fix)
12. ✅ Üretim sekmesi → Testere Kesimi + Diğer, yeşil/sarı/kırmızı renkler
13. ✅ Satınalma stok kodu hover tooltip'leri
14. ✅ Montaj Öncelik Önerisi paneli
15. ✅ **Diğer Müşteriler sekmesi (🤝) → menüde görünüyor, açılıyor** (Faz 1A)
16. ✅ **Satış siparişi Excel yüklenebiliyor, Firestore'a yazılıyor** (855 kayıt)
17. ✅ **Manuel override yapılabiliyor, upload sonrası korunuyor**
18. ✅ **BOM eksik uyarısı çalışıyor + "BOM yükle →" navigate + Ürün Ağacı auto-open**

**v20'de eklenecek (sırası geldikçe):**

- BOM Parser fix sonrası: 151-0006 ve benzeri "hammaddesiz op'lu" BOM doğru yorumlanıyor
- BOM Yönetimi modülü canlı sonrası: Upload + eşleştirme tek ekranda, 190 BOM rahat yönetilebiliyor
- MRP Ürün Özet: iki kart (Konteyner + Sipariş) yan yana görünüyor
- VIO Import: yükleme geçmişi altta görünüyor

---

## 12. Yeni Oturum Sahipleri İçin

### Sistem Durumu (23 Nis 2026 gece)

- Faz 1A canlı (sevkiyat-pro.vercel.app, main @ `09a64f8`)
- Cloud Function otomasyonu çalışıyor (her 15 dk, yeşil badge doğrular)
- 855 satış siparişi canlı Firestore'da
- Satış rolü aktif, Diğer Müşteriler'i kullanabilir
- **AKTİF BLOCKER:** BOM parser bug (🚨 en üstte) — yarın düzeltilecek
- **YAKIN İŞ:** 190 BOM yükleme (parser fix sonrası), BOM Yönetimi modülü (paralel)

### Dikkat Edilmesi Gerekenler

**Tüm v19 notları hâlâ geçerli** + v20 eklemeler:

- **3-tuple ID kritik:** `{belgeNo}_{stokKodu}_{teslimTarihi}` — 2-tuple'a geri dönme cazibesine direnilecek (%57 collision riski).
- **No-teslim fallback zinciri:** `teslim || orderDate || row{idx}` — bu zincir kaldırılmamalı.
- **Satış rolü yetki kapsamı:** `canSeeDigerMusteriler`, `canSeeMRP`, `canPack` birlikte. Birini değiştirmek diğerlerini etkiler.
- **BOM parser bug'ı düzelene kadar yeni BOM yüklemek riskli** — mevcut 4-5 hatalı BOM var, eklemeye çalışmak hatalı sonuç üretir.

### Claude Code ilk oturum görevi

`docs/CLAUDE_CODE_BRIEF_PARSER_FIX.md` dökümanı bu iş için hazır. İlk iş bu.

---

**v20 hazır. Sıradaki çıktılar:**

1. `CLAUDE_CODE_BRIEF_PARSER_FIX.md` — yarın ilk iş için hazır brief
2. (Sonra v20 sonrası) Faz 2 motor adaptörü detaylı tasarım sohbeti — stabilize ve BOM yükleme sonrası

*Hazırlayan: Web Claude, Ömer'in talebiyle*
*Tarih: 23 Nisan 2026, gece*
*Kaynak: v19 + Faz 1A retrospektifi + 23 Nis tasarım sohbeti*
