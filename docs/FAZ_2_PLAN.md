# Faz 2 — Motor Adaptörü + Ürün Özet + Sipariş Bazlı İhtiyaç

**Oturum:** 2026-04-24
**Durum:** Plan onayı alındı, Aşama 2.1 başladı

---

## Amaç

Satış siparişlerini (Faz 1A'da eklenen `salesOrders` doc) konteynerlerin yanında **eşit statülü** bir motor girdisi yap. Çıktıda her talebin **kaynak etiketi** korunsun (`container` | `salesOrder`).

## 4 ana iş paketi

| # | Paket | Risk | Kod tahmini |
|---|---|---|---|
| 2.1 | Motor adaptörü (salesOrders → demand + source etiketi) | 🟡 Orta | ~300 satır |
| 2.2 | Ürün Özet iki kart UI | 🟢 Düşük | ~150 satır |
| 2.3 | Sipariş bazlı ihtiyaç paneli | 🟡 Orta | ~600 satır |
| 2.4 | Override stale uyarısı (VIO termin farkı) | 🟢 Düşük | ~80 satır |

Her paket = ayrı PR = preview check + canlı test arası duruş.

## v20'nin 4 tasarım ekseni — kararlar

1. **Demand list tipi** — birleşik array `[{source, pid, qty, deliveryDate, customer?, containerId?, belgeNo?, stokKodu?}]`. Sahte konteyner yok.
2. **Tarih kaynağı** — öncelik: `planOverrides.plannedWeek` > `teslimTarihi` > (konteynerde) `date`. Override'lar motora iner.
3. **Stok allocation** — Aşama 2.1'de ERTELE. Mevcut sistem grossReq'te tek kodda topluyor, zaman sıralı FIFO Aşama 2.3'te sipariş bazlı panelin gerçek ihtiyacı.
4. **Motor dokunulmazlığı** — sadece girdi noktası değişir. `explodeProduct` recursion + `grossReq` birleşimi **aynı kalır**. Çıktı `sources[]` alanına `source` string'i eklenir.

## Aşama 2.1 — Motor adaptörü detay

**Kapsam:**
- App.jsx'e `salesOrders` Firestore subscribe
- `salesOrdersDemand` useMemo: salesOrders → `{[pid]: {qty, sources:[{source:'salesOrder', ...}]}}`
- `mergedDemand` useMemo: `unshippedDemand` + `salesOrdersDemand` birleştirir
- `runBomExplosion`: girdi olarak `mergedDemand` kullanılır
- `grossReq[code].sources[]`: her kayıtta `source: 'container' | 'salesOrder'` eklenir

**Stok kodu → product ID dönüşümü:**
- `products.find(p => p.vioCode === salesOrder.stokKodu)` → pid bulunursa normal demand
- Bulunamazsa: salesOrder "unmapped" olarak işaretlenir, motor girdisinde görünmez, UI'da uyarı (sonraki aşama). Aşama 2.1'de sadece "products.vioCode uyan" sales orders dahil.

**Tarih kaynağı logic:**
```
effectiveDate = planOverrides[id]?.plannedWeek (Date)
             || salesOrder.teslimTarihi
             || null (uyarı)
```

**Regression kapı testi (PR öncesi):**
1. salesOrders Firestore boşsa → explosionResult eski sürüm ile birebir aynı
2. Tek konteyner (salesOrders boş) → byProduct + grossReq identik
3. Tek salesOrder (konteyner boş) → doğru pid + qty + source='salesOrder'
4. Her ikisi de var → birleşik toplamda mantıklı; grossReq.sources her iki tip'i içerir

## 1000 satır hatasını engelleyen kırmızı çizgiler

1. Her aşama ≤ 600 satır
2. Her aşama ayrı PR
3. Regression kapı testi geçmeden PR açılmaz
4. Motor recursion mantığına dokunulmaz
5. Her aşama sonrası Ömer canlı test, onay ver, sonra bir sonraki aşamaya
6. **Sevkiyat Bazlı İhtiyaç paneli ASLA değiştirilmez** — Aşama 2.3'te yeni "Sipariş Bazlı İhtiyaç" paralel panel olarak yazılır. Eski kod kopyalanabilir ama orijinali dokunulmaz.

## Ömer notları / öneri kuyruğu (ileride bakılacak)

- **Sayılan Konteynerler benzeri "Alınan Siparişler" özet satırı** — MRP Hesaplama'da "2 Hesapla" butonunun üstünde "Sayılan Konteynerler (15) — toplam 8894 ürün" detay expander var. Buna paralel "Alınan Siparişler (N) — toplam Y birim" satırı eklenebilir (müşteri/belge dağılımı içinde). Aşama 2.2 içinde eklenebilir, şimdilik sadece fikir.

## Ön koşul durumu

| Ön koşul | Durum |
|---|---|
| Faz 1A canlı + stabil | ✅ |
| Parser bug fix | ✅ |
| BOM Liste iyileştirmesi | ✅ (24 Nis) |
| 176 Aselsan BOM yüklü | ❌ Aşama 2.3 için gerek, 2.1/2.2/2.4 için değil |
| Motor kodu keşfi | ✅ (24 Nis) |

**Sıralama önerisi:** 2.1 → 2.2 → 2.4 → (BOM yükle) → 2.3

## Bir sonraki adım

Aşama 2.1 kod implementasyonu başladı: `feat/faz2-1-motor-adaptor` branch'ı.

---

## İlerleme Kaydı (24 Nis 2026 oturumu)

### ✅ Tamamlananlar (bu PR)

**Parser genişletme:**
- Aselsan harfli prefix kodlar (AC-, MM-) tanınır
- `-Rev:XX` suffix temizlenir (AC-9111-0063-Rev:AB → AC-9111-0063)
- 3-4 rakamlı sayısal kodlar (5307-0672-0516 gibi standard vida/somun) yakalanır
- Regression: mevcut 17 VIO BOM birebir aynı parse

**Aşama 2.1 — Motor adaptörü:**
- `salesOrders` + `planOverrides` subscribe
- `salesOrdersDemand` useMemo (stok → pid dönüşümü)
- `mergedDemand` useMemo (konteyner + sipariş birleşik)
- Motor girdisi `mergedDemand.byProduct` — `unshippedDemand` dokunulmadı
- Regression kapı testi: salesOrders boş iken çıktı birebir eski

**Aşama 2.1c — Pseudo-pid akışı (v20'nin "asimetri" çözümü):**
- Persistent doc `appData/salesOrderStockIndex` — Aselsan stok kodları için 500000+ pseudo-pid
- Auto-grow useEffect (yeni stok geldiğinde Firestore'a yazar)
- `salesPseudoProducts` lokal liste, `effectiveProducts = products + pseudo`
- MRP Hesaplama tab'ında products aliası effectiveProducts (shadowing)
- Diğer sekmeler (Sevkiyat Planı, Montaj) orijinal products ile devam — etkilenmez

**Aşama 2.1d — autoMap güvenli yenileme:**
- Önceki autoMap: önce yazardı, sonra confirm; "direct:*" otomatik yazardı → yanlış eşleşmeler
- Yeni autoMap: **önce preview modal**, sonra seçilenleri yazar
- 3 grup: ✅ Tam kod eşleşmesi (default checked) / 🟡 İsim eşleşmesi (default unchecked) / ❌ Eşleşme yok (yazma yok)
- İptal = sıfır yazma
- `direct:*` **hiç otomatik yazılmaz** — manuel dropdown'dan seçilmeli
- İsim eşleşmesi sıkılaştırıldı: önceki "ilk token + contains" kaldırıldı, sadece **ilk 3 token tam eşleşmesi**

**Aşama 2.2 — Ürün Özet iki kart:**
- 📦 Konteyner / 🤝 Sipariş ayrı filtreler
- Her ürüne `hasContainer`/`hasSalesOrder` bayrakları
- Filter tıklanınca ayrı tablo, tabloda "Kaynak" kolonu korundu

**UI iyileştirmeleri:**
- Unmapped warning `<details>` ile accordion
- BOM Import confirm: yeni BOM'da sessiz, mevcut BOM'da "üzerine yazılsın mı" onayı, override varsa koruma ayrımı

### ✅ Ek düzeltmeler (PR #13 — akşam oturumu)

**Parser cross-BOM override bug:**
- AC-9111-0077 root'ta yanlış 5 op görünüyordu (beklenen 2)
- Kök sebep: cross-BOM override MAKE parçayı BUY yapıyor → op owner resolution skip ediyor → orphan → synthetic root
- Fix: `_fileSupplyType` geçici field, op owner resolution dosyadaki orijinal supplyType'a göre karar verir
- Override user intent korunur ama op yerleşimini etkilemez

**BOM import confirm modal:**
- `window.confirm` Chrome dialog suppression'a takılıyordu — kullanıcı farkında olmadan override korunuyordu
- İnline React modal (Promise + state)
- Override'lı BOM: **Koru / Sıfırla / İptal** (3 buton)
- Yeni BOM: **Üzerine Yaz / İptal** (2 buton)

### ✅ 26-27 Nisan oturumu — Akibeti Belirsiz + Ürün Özeti + 2.4 + 2.5

**Akibeti Belirsiz (PR #14):**
- planOverrides[id].status = "deferred" → MRP demand'tan çıkarılır (App.jsx salesOrdersDemand)
- DigerMusteriler'de Geciken üstünde gri kutu, ⏸ ikon + soluk arka plan
- Picker modal'da "⏸ Akibeti Belirsiz" / "▶ Tekrar Aktif Et" toggle

**Ürün Özeti view toggle (PR #14):**
- Toolbar 📋 Sipariş / 🧮 Ürün Özeti
- Stok bazlı agregasyon tablosu — toplam adet, tutar, sipariş sayısı, müşteri rozetleri, ilk-son teslim
- Kolon başlığı tıkla → sort

**Aşama 2.4 — Override stale uyarısı (PR #15):**
- Hook'tan staleOverrides[]
- Geciken/Belirsiz üstünde sarı accordion: "● VIO Termin Değişti (N sipariş)"
- Tek-tıkla "↻ VIO'ya Güncelle" → override silinir, ham VIO tarihine döner
- Satırdaki ● mavi → sarı (uyarı tonu)

**Aşama 2.5 — Sevk geçmişi + Müşteri Dashboard (PR #15):**
- Yeni Firestore doc: `appData/shipments` (events array, diff'ten üretilir)
- VIO yüklemesinde otomatik diff hesabı (sevkEdilen artışı + vio-removed final event)
- Yeni sidebar sekmesi 📈 Müşteri Dashboard:
  1) Bu ay alınan sipariş (geçen aya % değişim)
  2) Teslim yükü (bu hafta + 4 hafta)
  3) Sevk performansı (OTD %, ort. gecikme gün)
  4) Top 5 müşteri pasta (yıllık bedel)
  5) Aylık trend (son 6 ay alındı vs sevk)
  6) Önümüzdeki 6 ay yükü (bizim plan vs müşteri teslim 2 bar)
  7) Operasyonel uyarılar (geciken / VIO termin / belirsiz / BOM eksik + en eski 5)
- recharts kütüphanesi (~50KB gzipped)

### ⏳ Beklemede (sonraki oturum)

**Aşama 2.3 — Sipariş Bazlı İhtiyaç paneli:**
- v20'deki 4. ana iş, kritik kural: **Sevkiyat Bazlı İhtiyaç asla değiştirilmez**, yeni paralel panel yazılır
- Aselsan BOM yükleme stabilize bekleniyor — gerçek kullanım sonrası tasarımı netleşir
- ~600 satır, bir sonraki PR'a

**Faz 1B — Mail otomasyonu 4. rapor:**
- BOM yükleme stabilize sonrası

**Dashboard 2. tur (yönetici talebi gelirse):**
- Müşteri uyum karnesi (müşteri bazlı OTD)
- Sipariş yaşı dağılımı (histogram)
- Aselsan/Roketsan iş yükü kırılımı

**Sevk yapısı evrim:**
- İleride Sevkiyat Pro içinden manuel sevk girişi → events[].source = "manual-shipment"
- Mevcut VIO diff yan yana çalışır, yapı değişmez

**Faz 2 uzun vadeli:**
- Mapping UI'nın tamamen kaldırılması (products.vioCode otomatik)
- Motor stokKodu-tabanlı çalışma (pseudo-pid'siz)
