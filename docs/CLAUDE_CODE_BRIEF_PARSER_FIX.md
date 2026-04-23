# Claude Code Brief — BOM Parser Bug Fix

> **Tarih:** 24 Nisan 2026 (ilk Claude Code oturumu)
> **Öncelik:** 🔴 KRİTİK — 190 BOM yükleme blocker'ı
> **Referanslar:** `docs/SEVKIYAT_PRO_YEDEK_DOKUMAN_v20.md` (§🚨 + §2.x), `docs/FAZ_1A_RETROSPEKTIF.md`

---

## Bağlam

Faz 1A 22 Nis'te canlıya alındı. Stabilize penceresinde (22 Nis → ~13 May) Ömer 190 Aselsan/Roketsan/Denma ürününün BOM'larını elle yükleyecek. 23 Nis gece bir test dosyasıyla **mevcut BOM parser'ında kritik bir bug** keşfedildi. 190 BOM yüklemek için önce bu düzeltilmeli.

## Problem — Örnek ile

**Test dosyası:** `151-0006_330910-01_GOVDE.xlsx` (repo'da `samples/` altında olacak — Ömer ekleyecek)

**VIO'nun gönderdiği yapı (Excel içeriği):**

```
DENMA MÜHENDİSLİK...
Ürün Ağacı: 151-0006 - 330910-01 GÖVDE
                   Ürün Ağacı
Ürün (151-0006) 330910-01 GÖVDE    Baz  1 AD

Stok Kodu | Stok Adı | Miktar | Brm
Oper: (211) İŞLEME MRK.1 | İş.Mrk: (200) İŞLEME MERKEZİ
150-1183-2 | 330910-01 GS52 GÖVDE DÖKÜMÜ | 1 | AD
Oper: (212) İŞLEME MRK.2 | İş.Mrk: (200) İŞLEME MERKEZİ
Oper: (623) FASON İNDÜKSİYON | İş.Mrk:
```

**VIO mantığı:**
- Ürün 151-0006'nın **3 operasyonu** var: 211, 212, 623
- İlk operasyonda (211) hammadde tüketimi: 150-1183-2
- Sonraki operasyonlar (212, 623) aynı üründe devam ediyor, yeni hammadde yok

**Sevkiyat Pro'nun mevcut yorumu (YANLIŞ):**

```
151-0006 [MAKE+FASON, 1 op]          ← sadece 211'i görüyor
  └─ 150-1183-2 [RAW, 2 op]          ← 212 ve 623'ü buraya kaydırdı
        ├─ Oper 212 İŞLEME MRK.2
        └─ Oper 623 FASON İNDÜKSİYON
```

**Beklenen doğru yorum:**

```
151-0006 [MAKE+FASON, 3 op]          ← 211, 212, 623 ürüne ait
  ├─ Oper 211 İŞLEME MRK.1 (hammadde tüketimi)
  │    └─ Hammadde: 150-1183-2 (RAW, 1 AD)
  ├─ Oper 212 İŞLEME MRK.2
  └─ Oper 623 FASON İNDÜKSİYON
```

### Sebep tahmini

Parser muhtemelen şu mantıkla çalışıyor:
1. "Oper:" satırı gör → bu bir operasyon
2. Altındaki stok kodu satırını o operasyonun hammaddesi say
3. Bir sonraki "Oper:" satırına kadar olan her şey o operasyona ait

Bu mantık **hammaddesiz op'ları** (son iki örnek) bir önceki hammaddenin altına "kaydırmış" olabilir. Ya da alt ağaç olarak yorumlamış. Kesin neden Aşama 1'de netleşecek.

### Etkiler

1. MRP sonucu yanlış (motor hammaddeyi 3 op'lu gibi görüyor)
2. İş emri önceliği yanlış atanır
3. Çizelge doluluk yanlış iş merkezlerine yazılır
4. Süre hesabı yanlış ürüne atanır
5. Fason maliyeti yanlış ürüne yazılır (maliyet modülü yazıldığında temelden etkiler)

---

## Neden Faz 1A'da görünmedi

Ömer testleri ana müşteri grubu üzerinde yaptı, orada büyük ihtimalle "1 hammaddeli + N op'lu" yapı nadir veya yoktu. Bu bug **hammaddesiz op'ları** tetikleyen özel yapılarda açığa çıkıyor. Aselsan ürünleri bu yapıya daha yakın — o yüzden 190 BOM yüklemeden önce çözülmeli.

Ömer'in tahmini: mevcut yüklü BOM'larda 4-5 tanesi bu yapıda olabilir. Tarama yapılacak.

---

## 3 Aşamalı Plan

### Aşama 1 — Keşif (KOD DEĞİŞMEZ, sadece anlayış)

**Amaç:** Parser mantığını tam olarak anla, bug'ın kaynağını netleştir, mevcut etkiyi ölç.

**Görevler:**

1. **BOM parser'ını bul:**
   - Muhtemelen App.jsx içinde veya `functions/parsers.js`'de
   - `parseBomExcel` / `parseBOMExcel` / benzeri isimlerde
   - Dosya + satır aralığı raporla

2. **Parser mantığını özetle (4-5 cümle):**
   - "Oper:" satırını nasıl tanıyor?
   - Stok kodu satırını hangi op'a bağlıyor?
   - Hammaddesiz "Oper:" satırını gördüğünde ne yapıyor?
   - Ağaç hiyerarşisini nasıl kuruyor?

3. **151-0006 test dosyasıyla çalıştır:**
   - Gerçek parser ile dosyayı parse et
   - Çıktıyı Firestore yazımı formatında göster
   - Beklenen vs gerçek çıktıyı karşılaştır
   - Bug'ın tam olarak hangi adımda oluştuğunu pinpoint et

4. **Mevcut BOM'ları tara:**
   - `appData/bomModels` koleksiyonundaki tüm modelleri oku
   - "Op sayısı > hammadde sayısı + 1" olan kaç model var?
   - Veya "bir parçanın altında 2+ op var ama o parça RAW" durumu
   - Hatalı BOM'ların listesini ver (kod + ürün adı)

5. **Güvenlik kontrolü:**
   - Parser düzeltilirse mevcut 14 maddelik test listesi + Faz 1A'nın 4 maddesi nasıl etkilenir?
   - Regression riski olan alanlar hangileri? (motor? cache? çizelge?)

**Çıktı:** Kısa rapor + mevcut etkilenen BOM listesi. Commit yok, sadece anlayış.

**Kırmızı çizgi:** Bu aşamada **hiçbir kod değişmez**, hiçbir Firestore yazımı yapılmaz.

**Süre tahmini:** 45 dk - 1 saat.

---

### Aşama 2 — Düzeltme

**Beklenen doğru kural:**

- "Oper:" satırı ürünün bir operasyonunu temsil eder, tüm op'lar ürüne aittir
- Hammadde satırı **hangi op'un altındaysa o op'ta tüketilir**
- Op sayısı ≠ hammadde sayısı olabilir (1 hammadde + 3 op normal)
- Hammaddesiz op yine geçerli, sadece iş merkezi kullanımı var
- Alt ağaç (bir parçanın kendi BOM'u olması) ancak **yeni "Ürün (...)" başlığı** varsa başlar

**Değişiklik kapsamı:**
- Sadece parser fonksiyonu değişir
- Firestore şeması **değişmez** (aynı yapıya yazıyor, sadece doğru yazıyor)
- App.jsx'in geri kalanı dokunulmaz
- Motor kodu dokunulmaz

**Commit stratejisi:**
- Ayrı branch: `fix/bom-parser-hammaddesiz-op`
- Küçük, granüler commit'ler
- Her commit sonrası mevcut testler çalışmalı

**Süre tahmini:** 1-2 saat.

---

### Aşama 3 — Test + Migrate

**Test senaryoları:**

1. **Test 1 — Altın standart (151-0006):**
   - Excel'i yükle
   - Beklenen: 151-0006 MAKE+FASON, 3 op. 150-1183-2 RAW, 0 op (op 211'in altında)
   - MRP hesapla → sonuçlar doğru

2. **Test 2 — Hatalı BOM'ları düzelt:**
   - Aşama 1'de tespit edilen 4-5 hatalı BOM'u tek tek tekrar yükle
   - Her birinin doğru yorumlanmış yapısını doğrula
   - Ömer gözle kontrol edecek

3. **Test 3 — Regression:**
   - Ana müşteri grubundan doğru çalıştığı bilinen bir BOM'u yeniden yükle
   - Davranış DEĞİŞMEMELİ (daha önce doğru olan, hâlâ doğru)
   - 14+4 maddelik hızlı test listesi çalıştır → hepsi yeşil

**Başarı kriteri:** 3 test de geçer → 190 BOM yükleme yolu açılır.

**Başarısızlık durumu:** Regresssion varsa → `git revert`, tekrar aşama 1'e dön.

**Süre tahmini:** 30-45 dk.

---

## Toplam süre tahmini

Aşama 1 + 2 + 3 = 2.5 - 4 saat. Tek oturumda bitebilir.

---

## Güvenlik — v19 prensipleri

**Seviye 1 — Veri İzolasyonu:**
- `bomModels` koleksiyonuna yazma **sadece doğru formatta yeniden import**
- Şema değişmiyor, sadece doğru doluyor
- Silme yok — tek tek yeniden yüklenen BOM'lar override eder

**Seviye 2 — Kod İzolasyonu:**
- Sadece parser fonksiyonu değişir
- App.jsx'in mevcut mantığı dokunulmaz
- Motor kodu dokunulmaz

**Seviye 3 — Hata İzolasyonu:**
- Try/catch korumalı
- Regression varsa `git revert` ile dakikalar içinde geri dönüş

**Rollback planı:**
- Her commit ayrı, `git revert <hash>` granüler
- Branch `fix/bom-parser-hammaddesiz-op` merge öncesi PR review
- Production'a push öncesi dev'de 14+4 maddelik test

---

## Test verileri

- ✅ **151-0006** — Ömer repo'ya ekleyecek (`samples/bom_test/151-0006.xlsx`). Altın standart.
- ⏳ **Hatalı BOM 1-2 tane** — Ömer seçecek (Aşama 1 sonrası tespit edilen listeden). Düzeltme test case'i.
- ⏳ **Regression BOM** — Ana müşteri grubundan doğru çalışan bir BOM. Regression test case'i.

---

## İletişim ritmi

- Aşama 1 sonunda **Ömer'e rapor** (keşif bulguları + hatalı BOM listesi)
- Ömer onay verirse Aşama 2'ye geç
- Aşama 2 sonunda **test öncesi ara check-in** (diff'i özetle)
- Aşama 3 sonunda **final rapor** — 3 test durumu + canlıya deploy önerisi
- Regression bulgusu olursa **hemen dur, Ömer'e bilgi ver**

---

## Tamamlama sonrası

1. Sonraki iş: 190 BOM yükleme sürecine başla
2. Ömer birkaç deneme BOM yükleyecek (mevcut ekranla, parser düzeltilmiş halde)
3. BOM Yönetimi modülü paralel geliştirme başlayabilir (v20 §2.3)
4. v20 dökümanındaki sıradaki işler (💡 #1, 💡 #4) stabilize sırasında sırayla ele alınır

---

## Notlar

- Bu bug tek başına bir **refactor değil** — parser kuralındaki ince bir mantık hatası. Küçük ama kritik.
- Ömer iş süresince **gözle doğrulama** yapacak: Aşama 1 raporu + Aşama 3 test sonuçları Ömer'in onayından geçecek.
- v19'un **"her değişiklik tek sorumluluk"** prensibi burada önemli: parser fix bu commit'te, başka iyileştirme yok.

---

**Başarılar. Ömer görüşmek üzere.**

*Hazırlayan: Web Claude, 23 Nis 2026 gece*
*Kaynak: 23 Nis tasarım sohbeti + 151-0006 Excel analizi*
