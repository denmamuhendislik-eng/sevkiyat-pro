# Claude Code Brief — Süre Sistemi Yeniden Düzenlemesi + Çizelge Bug Fix

> **Tarih:** 23 Nisan 2026
> **Kapsam:** v20 🐛 #2 + 💡 #3 (süre sistemi) + 🐛 #2.1 (çizelge eşleşme)
> **Referanslar:**
> - `docs/SEVKIYAT_PRO_YEDEK_DOKUMAN_v20.md`
> - Süre sistemi keşif raporu (23 Nis)
> - Çizelge BOM op eşleşme keşif raporu (23 Nis)

---

## Bağlam

23 Nis'te iki keşif raporu üretildi:
1. Süre sistemi genel analizi — manuel edit MES'le ezilir, BOM upload süre yazmaz, "MES" rozeti yalancı
2. Çizelge eşleşme bug'ı — aynı WC'de çoklu op için ilk op süresi kullanılıyor

Web Claude'da tasarım sohbeti yapıldı, kararlar netleşti. Bu brief **tek oturumda** uygulanacak 3 işi kapsar:

1. **Süre kaynak ayrımı** — `mesSource` vs `manualSource` (yeni alan)
2. **MES import sonuç paneli** — manuel üzerine yazılanları anlık göster
3. **Çizelge BOM op eşleşme fix** — `bomSeq` hint kullan

---

## Mimari Kararlar (tasarım sohbetinden)

### Temel felsefe

**MES gerçeği, manuel geçici.** MES sensör verisi manuel tahminden daha güvenilir ve güncel. MES geldiğinde manuel eziyor — bu **bilinçli ve doğru** davranış. Değişiklik yapmayacağız. Sadece **görünürlük** ekliyoruz.

### Değişmeyecek şeyler

- MES import üzerine yazma davranışı (bilinçli)
- BOM upload'un süre yazmaması (VIO süreleri güvenilmez)
- Tek `cycleTime` / `setupTime` alanı (katmanlı alan YOK)
- Okuma mantığı (çizelge fallback: `bom → avg → def`)

### Değişecek şeyler

- `manualSource` alanı eklenecek (manuel edit izi için)
- MES import → manuel üzerine yazarken log tutulacak
- MES import ekranına sonuç paneli eklenecek
- Ürün Ağacı'nda rozet ayrımı: 🟢 MES vs 🟠 MANUEL
- `getBomCycleTime` bomSeq hint alacak (151-0162 bug fix)

### Geçmişe dönük audit YOK

Manuel edit log'u tutulmayacak (hafıza doldurur). Sadece MES import **anında** "neler değişti" paneli. Panel kapatılınca kaybolur (o import özelinde). Sonraki import için yeni panel.

---

## İş 1 — Süre Kaynak Ayrımı (manualSource alanı)

### Veri modeli değişimi

**Önce:**
```javascript
operation = {
  opCode, opName, wcCode,
  setupTime, cycleTime,
  mesSource?, mesImportedAt?, mesRenewalTime?
}
```

**Sonra:**
```javascript
operation = {
  opCode, opName, wcCode,
  setupTime, cycleTime,
  mesSource?, mesImportedAt?, mesRenewalTime?,
  manualSource?, manualAt?, manualBy?  // YENİ
}
```

### Yazma davranışı değişimi

**`updateOpTime` (App.jsx:9228-9236) güncellemesi:**

Manuel edit yapıldığında:
- `cycleTime` veya `setupTime` değişir (mevcut davranış)
- `manualSource` = "manual" set edilir (yeni)
- `manualAt` = şu an (yeni)
- `manualBy` = mevcut kullanıcı role string (yeni, v19 3.5 pattern'i)
- `mesSource`, `mesImportedAt` **temizlenir** (nullify) — çünkü artık manuel

**`handleMesImport` (App.jsx:8938-8987) güncellemesi:**

MES import her op için işlerken:
- `cycleTime` üzerine yazar (mevcut davranış)
- `mesSource`, `mesImportedAt` set edilir (mevcut davranış)
- `manualSource`, `manualAt`, `manualBy` **temizlenir** (yeni) — çünkü artık MES var

### Kritik: üzerine yazma tespiti ve log

MES import üzerine yazmadan ÖNCE, mevcut değeri kontrol et:
- Eğer mevcut op'ta `manualSource` doluysa → manuel üzerine yazılıyor demektir
- Bu durumu log'a ekle (İş 2'deki sonuç paneli için)

Log formatı:
```javascript
{
  stockCode: "151-0162",
  opCode: "102",        // varsa
  opName: "TORNA MRK.2",
  previousValue: 6.83,
  previousBy: "uretim",
  previousAt: "2026-04-20T14:30:00Z",
  newValue: 6.95,
  deltaPercent: 1.76   // ((new-prev)/prev)*100, işaretli
}
```

---

## İş 2 — MES Import Sonuç Paneli

### Firestore şeması

**Yeni koleksiyon yok — in-memory state yeterli.** Panel sadece son import için aktif. Sayfa yenilenirse kaybolur (bilinçli, audit değil anlık görünüm).

State (MES Import ekranında):
```javascript
const [mesImportResult, setMesImportResult] = useState(null);
// null | { importedAt, totalUpdates, manualOverwrites: [...] }
```

### UI — Import ekranında üst bilgilendirme

MES import sonrası ekranın üstünde:

```
┌─ Son MES Import · 23 Nis 2026 17:45 ────────────────────┐
│ ✓ 45 süre güncellendi · 12'si manuel üzerine yazıldı     │
│                                                          │
│ [ Detayları göster ▼ ] [ Kapat × ]                       │
└──────────────────────────────────────────────────────────┘
```

**"Detayları göster" genişleyince:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Ürün / Operasyon     Önceki (Manuel)   Yeni (MES)   Fark        │
│ ───────────────────────────────────────────────────────────     │
│ 151-0162 TORNA MRK.2    6.83 dk/ad ✋  6.95 dk/ad 📊   +%2      │
│ 52014 İŞLEME MRK.1      4.50 dk/ad ✋  5.20 dk/ad 📊   +%15 🟡  │
│ 42013 TORNA MRK.1      10.00 dk/ad ✋  3.40 dk/ad 📊   -%66 🔴  │
│ ...                                                             │
│                                                                 │
│ Sıralama: [Fark % ▼] · Filtre: [Tümü | >5% | >20% ▾]           │
│                                                                 │
│ [ Excel olarak indir ]                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Renk eşikleri (sabit, ayarlanabilir değil — MVP)

- `|delta| > 20%` → 🔴 kırmızı satır vurgu (dikkat)
- `|delta| 5-20%` → 🟡 sarı satır vurgu
- `|delta| < 5%` → normal (beyaz/gri)

### Kapatma davranışı

- "Kapat ×" tıklanınca `mesImportResult = null` → panel gizlenir
- Sayfa yenilenirse de gizlenir (in-memory)
- Bir sonraki MES import → yeni panel açılır
- Geçmiş import'lar saklanmaz (karar verildi, hafıza doldurmasın)

### Excel olarak indir (bonus, zor değilse)

Panel içeriğini CSV/Excel olarak indirme butonu. Kullanıcı offline analiz yapabilir. Yapılması zorsa ileriye ertelenebilir, MVP için kritik değil.

---

## İş 3 — Ürün Ağacı Rozet Ayrımı

### Mevcut durum (App.jsx:9239)

```javascript
const hasMes = op.mesSource;
// Yeşil çerçeve gösterimi
```

### Değişim

```javascript
const hasMes = op.mesSource && !op.manualSource;  // sadece MES ise
const hasManual = op.manualSource;                 // manuel ise
```

### UI rozet

- `hasMes === true` → 🟢 yeşil çerçeve "MES" (mevcut davranış korunur)
- `hasManual === true` → 🟠 **turuncu çerçeve "MANUEL"** (yeni)
- İkisi de false → rozet yok (varsayılan 5 dk/ad fallback devreye)

### Alt bilgi satırı güncellemesi

Mevcut: *"Boş süre alanları varsayılan kullanır (Ayar: 30dk, Çevrim: 5dk/ad) · Yeşil çerçeve = MES · Op kodu ≥600 = FASON"*

Yeni: *"Boş süre alanları varsayılan kullanır (Ayar: 30dk, Çevrim: 5dk/ad) · 🟢 Yeşil = MES · 🟠 Turuncu = Manuel · Op kodu ≥600 = FASON"*

---

## İş 4 — Çizelge BOM Op Eşleşme Fix (Bug #2.1)

### Kök neden (keşif raporundan)

`getBomCycleTime` (App.jsx:8444-8452) sadece `wcCode`'a göre `.find` yapıyor, ilk eşleşen op'u döndürüyor. Oysa `mappedOps` zaten doğru `bomSeq`'i biliyor.

### Çözüm — Opsiyon 1 + 3 birlikte

**`getBomCycleTime` imzası değişir:**

```javascript
const getBomCycleTime = (akCode, wcCode, bomSeqHint = -1) => {
  const bom = bomLookup[akCode];
  if (!bom || !bom.operations) return null;

  // Hint varsa doğru indeksi direkt al
  if (bomSeqHint >= 0 && bom.operations[bomSeqHint]?.cycleTime > 0) {
    const op = bom.operations[bomSeqHint];
    return { cycle: op.cycleTime, setup: op.setupTime || 0, source: "bom", opCode: op.opCode };
  }

  // Fallback: mevcut davranış (wcCode'a göre ilk eşleşen)
  const op = bom.operations.find(o => o.wcCode === wcCode && o.cycleTime > 0);
  if (op) return { cycle: op.cycleTime, setup: op.setupTime || 0, source: "bom", opCode: op.opCode };

  return null;
};
```

**Çağrı yeri (line 8592):**

```javascript
// Önce (bug):
const bomTime = getBomCycleTime(akPart.code, wcCode);

// Sonra (fix):
const bomTime = getBomCycleTime(akPart.code, wcCode, currentMapped?.bomSeq);
```

**Item'a yazma (line 8605-8611):**

```javascript
// Önce:
opCode: null,

// Sonra:
opCode: bomTime?.opCode || null,   // trace için görünürlük
```

### Test senaryosu — 151-0162 E542

**Önce (bug):**
- TORNA MRK.1 satırı: 16.83 dk/ad × 35 ad = 589 dk ✓
- TORNA MRK.2 satırı: **16.83** dk/ad × 35 ad = **589 dk** ❌

**Sonra (fix):**
- TORNA MRK.1 satırı: 16.83 dk/ad × 35 ad = 589 dk ✓
- TORNA MRK.2 satırı: **6.83** dk/ad × 35 ad = **239 dk** ✓

Toplam fark: 350 dk hata giderildi (tek iş emri, tek parça).

---

## Uygulama Sırası — Tek Oturumda

1. **Hazırlık — Keşif teyidi**
   - `handleMesImport` kodunu oku (App.jsx:8938-8987)
   - `updateOpTime` kodunu oku (App.jsx:9228-9236)
   - `getBomCycleTime` ve çağrısı oku (App.jsx:8444-8452, 8592, 8605-8611)
   - "Üzerine yazma tespiti" için hangi op field'larını karşılaştıracağını netleştir

2. **Commit 1 — Veri modeli ve yazma davranışı**
   - `updateOpTime`: `manualSource`, `manualAt`, `manualBy` set + `mesSource` temizle
   - `handleMesImport`: üzerine yazılanları tespit et + `manualSource` temizle + `mesSource` set
   - **Test:** Manuel bir op gir → Firestore'da `manualSource` dolu. Sonra aynı op MES ile ez → `manualSource` boş, `mesSource` dolu.

3. **Commit 2 — Rozet ayrımı (UI)**
   - `hasMes` ve `hasManual` ayrı ayrı hesapla
   - Turuncu çerçeve "MANUEL" rozeti render
   - Alt bilgi satırı metni güncelle
   - **Test:** Ürün Ağacı'nda manuel girilmiş bir op turuncu görünür, MES'ten gelen yeşil kalır.

4. **Commit 3 — MES import sonuç paneli**
   - `handleMesImport` sonunda `manualOverwrites` listesini döndür
   - State ekle: `mesImportResult`
   - UI: kapatılabilir bilgilendirme barı + detay tablo + renk eşikleri
   - (Opsiyonel) Excel indir butonu
   - **Test:** Manuel değeri olan bir op'u MES ile ez → panel açılır, değişim listede görünür, renk eşikleri doğru.

5. **Commit 4 — Çizelge eşleşme bug fix**
   - `getBomCycleTime` bomSeqHint parametresi
   - Çağrı yerinde `currentMapped?.bomSeq` geçir
   - Item'a `opCode` yaz
   - **Test:** 151-0162 E542 — TORNA MRK.1 = 589dk, TORNA MRK.2 = 239dk (önce ikisi de 589'du).

6. **Regression — 14+4 maddelik test**
   - Tüm test listesi çalıştır
   - Özellikle: Madde 3 (çizelge otomatik), Madde 8 (KPI), Madde 9 (bulk rozeti)
   - BOM Explosion + çizelge sonuçları yeşil

7. **PR + merge + deploy**
   - Feature branch: `feat/sure-sistemi-kaynak-ayrimi`
   - PR açıklamasında bu brief'in özeti
   - Ömer onay → merge → production deploy

---

## Güvenlik — v19 prensipleri

### Seviye 1 — Veri İzolasyonu

- Mevcut `bomModels` koleksiyonuna yazma **sadece yeni alanlar** ekliyor (`manualSource`, `manualAt`, `manualBy`)
- Mevcut alanlar (`cycleTime`, `setupTime`, `mesSource`, `mesImportedAt`) aynen korunur
- Yeni Firestore koleksiyonu YOK (MES import sonuç paneli in-memory)

### Seviye 2 — Kod İzolasyonu

- Değişiklikler App.jsx'te dar bölgelerde:
  - `updateOpTime` (~5 satır ekleme)
  - `handleMesImport` (~15 satır ekleme — log toplama + manualSource temizleme)
  - `getBomCycleTime` (~5 satır değişim)
  - Ürün Ağacı rozet render (~3 satır değişim)
  - MES Import ekranı sonuç paneli (~40-60 satır yeni UI)
- Motor kodu **dokunulmaz**
- Çizelge fallback zinciri **dokunulmaz**

### Seviye 3 — Hata İzolasyonu

- `manualSource` alanı opsiyonel — yoksa eski davranış
- MES import hatası olursa panel gösterilmez, import tamamlanamasa bile (mevcut try/catch korunur)
- Rozet render — eksik alan güvenli (boolean kontrolü)

### Dokunulmaz Alanlar — hatırlatma

- `isOrderBulk`, `calculateSchedule(silent, forceMrp)` parametreleri, `plsConfirmedLookup`, `pNum` fonksiyonları, `_bulkOverrides`, `_catOverrides`, motor (`runBomExplosion`) — **HİÇBİRİ DEĞİŞMİYOR**

### Rollback

- Her commit ayrı → `git revert <hash>` granüler
- PR merge commit üzerinden toplu revert mümkün
- Manuel rozet ayrımı sadece UI — veri kaybı yok
- Çizelge fix sadece okuma mantığı — veri kaybı yok

---

## Regression Testleri (14 + 4 madde)

Standart hızlı test listesi + süre sistemine özel kontroller:

### Standart 14+4 (v19 + Faz 1A)

1-18. maddeler (v20 §11'de detaylı)

### Süre sistemine özel yeni kontroller

- **S1:** Ürün Ağacı'nda bir op'a manuel süre gir → turuncu MANUEL rozeti görünür
- **S2:** Aynı op için MES import simüle et → yeşil MES rozetine döner, turuncu kaybolur
- **S3:** MES import sonrası — panel açılır, üzerine yazılan manuel değer listede, fark % doğru
- **S4:** Panel "Kapat" → gizlenir, sayfa yenile → yine gizli
- **S5:** Yeni MES import → panel tekrar açılır (yeni içerikle)
- **S6:** 151-0162 Çizelge Doluluk — MRK.1 ve MRK.2 farklı süreler gösteriyor (önce aynıydı)
- **S7:** Başka bir parça (tek op'lu) — çizelge süresi **değişmedi** (sadece aynı WC çoklu op etkilenmeli)

---

## Zaman Tahmini

- Keşif teyidi: 15 dk
- Commit 1 (veri modeli): 30 dk
- Commit 2 (rozet UI): 15 dk
- Commit 3 (sonuç paneli): 1-1.5 saat
- Commit 4 (çizelge fix): 20 dk
- Regression test: 30 dk
- PR + merge + deploy: 20 dk

**Toplam: 3-3.5 saat.** Tek oturumda bitebilir.

---

## Notlar ve sınırlar

1. **Bu bir refactor değil** — mevcut davranışa ek görünürlük ve bir bug fix. Risk düşük.
2. **Manuel edit log'u tutulmuyor** — bilinçli karar. Hafıza doldurmamak için. İleride ihtiyaç çıkarsa ayrı iş.
3. **Excel indir opsiyonel** — zor veya zaman alırsa MVP dışında. Panel yeterli.
4. **Eşik değerleri sabit** (%5, %20). Ayarlanabilir değil. İleride settings'e taşınabilir.
5. **MES import geçmişi yok** — sadece son import için panel. Sonrası kaybolur.

---

## Tamamlama Sonrası

- Deploy canlıya → Ömer gerçek kullanımda test eder
- 190 BOM yükleme yolu tamamen açık (parser fix + bu fix + BOM Yönetimi paralel)
- v20'ye "Tamamlandı" işareti konur: 🐛 #2, 💡 #3, 🐛 #2.1
- Sonraki iş: BOM Yönetimi modülü tasarım sohbeti (ayrı oturum, web Claude)

---

**Hazırlayan:** Web Claude, 23 Nis 2026 gece
**Kaynak:** 2 keşif raporu + tasarım sohbeti (4 kritik bulgu + 5 soru netleşmesi)
