# docs/samples — Örnek Veri Format Referansı

Bu klasör MRP / çok müşterili genişleme için kullanılan örnek Excel dosyalarının **formatını** belgelemek içindir. Gerçek dosyaların kendisi buraya girmez (bkz. `.gitignore`) — içlerinde gerçek müşteri, stok kodu ve fiyat bilgisi bulunduğu için repo'ya commit'lenmez.

Gerçek örnek dosyalar Ömer'de (`~/Downloads/ORNEKSATISSIPARIS.xlsx`, `~/Downloads/ORNEKTOPLUURUNAGACI.xlsx`). İhtiyaç duyan geliştirici için format referansı aşağıdaki gibidir; parser ve UI testleri bu şemaya göre yazılabilir.

---

## 1) `ORNEKSATISSIPARIS.xlsx` — Satış Siparişi Dökümü

Tek bir Excel dosyasında birden fazla müşterinin siparişleri, her müşteri bir **başlık satırı** ile ayrılır.

### Yapı

- **Müşteri başlığı satırı:** Kolonların üstünde, o bloğun hangi müşteriye ait olduğunu belirten tek hücrelik bir başlık (cari adı).
- **Kolon başlığı satırı:** Başlığın hemen altında gelen sabit kolon adları.
- **Veri satırları:** Kolon başlığının altında, o müşteriye ait sipariş kalemleri.
- Dosya, bir sonraki müşteri başlığına kadar bu blok yapısını tekrar eder.

### Kolonlar (sabit sıra)

| Kolon | Açıklama |
|---|---|
| Tarih | Sipariş tarihi |
| Belge No | Sipariş belge numarası |
| Stok Kodu | Ürün stok kodu (prefix ile ayrışır, aşağı bkz.) |
| Stok Adı | Ürün adı / tanımı |
| Teslim Tarihi | Müşteriye söz verilen teslim tarihi |
| Brm | Birim (adet, kg, m vs.) |
| Orijinal | Orijinal sipariş miktarı |
| Sevk | Şu ana kadar sevk edilmiş miktar |
| Kalan | Orijinal − Sevk (açık bakiye) |
| Dv.Fiyat | Döviz fiyatı |
| Fiyat | TL fiyat |
| Toplam Bedel | Satır toplam tutarı |

### Stok Kodu Prefix'leri

Parser'ın tanıması gereken prefix grupları:

- **AC-...** — Alt grup (ör. aksesuar / yarı mamul)
- **MM-...** — Mamul (bitmiş ürün, BOM'da üst kırılımlar burada açılır)
- **MN-...** — Yan mamul / ara ürün
- **152-...** — Ticari mal / hammadde alım kodu

Parser:
1. Her satıra bakarken ilk başlık satırından gelen "aktif müşteri" bilgisini saklamalı.
2. Yeni bir müşteri başlığı görülene kadar tüm veri satırları o müşteriye yazılmalı.
3. `Kalan > 0` olan satırlar MRP için açık siparişi temsil eder.

---

## 2) `ORNEKTOPLUURUNAGACI.xlsx` — Toplu Ürün Ağacı (BOM)

Bir Excel dosyası içinde birden fazla mamulün ürün ağacı arka arkaya listelenir; her mamul bir **blok ayıracı satırı** ile başlar.

### Yapı

- **Blok ayıracı satırı:** `Ürün (MM-XXXX-XXXX-Rev:YY)` formatında tek hücrelik bir satır. Bu, yeni bir BOM bloğunun başladığını işaretler.
  - `MM-XXXX-XXXX` → mamul stok kodu
  - `Rev:YY` → revizyon numarası
- **Kolon başlığı satırı:** Blok ayıracından sonra sabit kolonlar.
- **Operasyon satırları:** `Oper:` ile başlayan satırlar, o mamulün üretim operasyonlarını (kesim, büküm, montaj vs.) temsil eder.
- **Hammadde / bileşen satırları:** Operasyonun altında, o operasyonda tüketilen malzeme kalemleri.

### Kolonlar (sabit sıra)

| Kolon | Açıklama |
|---|---|
| Stok Kodu | Bileşen stok kodu (hammadde, yarı mamul vs.) |
| Stok Adı | Bileşen adı / tanımı |
| Miktar | Bir adet mamul için kullanılan miktar |
| Brm | Birim |

### Parse Mantığı

1. Dosyayı sırayla tara; `Ürün (...)` satırı görüldüğünde yeni bir mamul bloğu başlat.
2. Blok ayıracından regex ile mamul kodu ve revizyonu çıkar: `^Ürün \((MM-[\w\-]+)-Rev:(\d+)\)$`.
3. `Oper:` satırları şu anki operasyonu belirler — sonraki bileşen satırları bu operasyona bağlanır.
4. Bileşen satırları (ne `Ürün (...)` ne de `Oper:` ile başlayan, Stok Kodu'nda değer olan satırlar) aktif mamul + aktif operasyona yazılır.
5. Bir sonraki `Ürün (...)` satırı görülene kadar aynı bloğa devam.

---

## Notlar

- Bu format açıklaması v19 yedek dökümanı ve `docs/prototype/DigerMusterilerPrototipV2.jsx` içindeki parser mantığıyla tutarlıdır. Format değişirse her üçünü birlikte güncelle.
- Gerçek dosya gerekirse Ömer'den iste; geliştirme/test için `tests/fixtures/` altında **fake** (uydurma müşteri/stok kodlarıyla) bir mini örnek türetilebilir.
