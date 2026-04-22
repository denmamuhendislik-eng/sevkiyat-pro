# Sevkiyat Pro — Faz 1A Tamamlandı Retrospektifi

> **Bu döküman web Claude oturumu için hazırlanmıştır.** v19 yedek dökümanının (`docs/SEVKIYAT_PRO_YEDEK_DOKUMAN_v19.md`) tamamlanmış olmasının üzerine, Faz 1A'nın Claude Code oturumunda canlıya taşınması sürecinin retrospektifidir. v20 dökümanı için kaynak olarak kullanılabilir, ya da tasarım sohbeti için context olarak.
>
> **Tarih:** 22 Nisan 2026
> **Canlı:** sevkiyat-pro.vercel.app (main @ `09a64f8`)
> **Oturum:** Web Claude → Claude Code aktarımı + Adım 0-9 + iki post-deploy patch

---

## 1. Bağlam (çok kısa)

- v19'da Faz 1A yol haritası çıkarıldı: "Diğer Müşteriler" modülü (Aselsan Konya, Denma Dış Ticaret, Roketsan için çok müşterili satış siparişi yönetimi)
- Claude Code oturumunda kodlama başlatıldı, 22 Nisan 2026 boyunca Adım 0-9 tamamlandı, canlıya deploy edildi
- Ömer'in rolü: stratejik karar + browser test + onay
- Claude Code rolü: kod yazma, test, git/deploy zincirleri

---

## 2. Faz 1A'da neler yapıldı

### 16 feature + 2 post-deploy patch commit (Faz 1A + cilalar)

| Adım | Özellik | Commit |
|---|---|---|
| Pre-0 | v19 döküman + prototipler + örnek format README | `31a4359` |
| 0 | Keşif — kod yok | — |
| 1 | Klasör iskeleti (`src/modules/digerMusteriler/`, `src/shared/`) | `4738a99` |
| 2 | Sidebar 🤝 Diğer Müşteriler + App.jsx bağlantısı (+4 satır) | `d3e6760` |
| 3 | Firestore okuma altyapısı (`salesOrders` + `planOverrides`) | `adac546` |
| 4 | Excel parser + upload UI | `265fa4c` |
| — | chore: Claude Code auto-approval allowlist | `c29ea99` |
| 5 | Temel liste + filter + arama + sıralama + KPI | `4a33905` |
| 6 | Manuel hafta override (WeekPicker) + override korunma testi | `4084573` |
| 7.1 | Gecikme rozeti kademeli renk | `881df0c` |
| 7.2 | Override notu + 💬 ikonu | `139a9e3` |
| 7.3 | VIO değişti rozeti (mavi ●) | `d1b8849` |
| 7.4 | BU HAFTA vurgu bloğu | `d07f96e` |
| 7.5 | Hafta stripi (12 hafta) | `0ec9e16` |
| 7.6 | Aylık bedel şeridi (12 ay) | `73cb8b1` |
| 7.7 | Drag & drop (row → week header) | `91cf9aa` |
| 8 | BOM eksik uyarı + MRP/Ürün Ağacı navigate | `e33ca8d` |
| 9 | PR #1 main merge → production deploy | `cee3bb6` |
| **Post-deploy 1** | no-teslim edge case (ID fallback + expandable liste) | `499c412` |
| **Post-deploy 2** | **Satış rolü (satis)** — Diğer Müşteriler yeni sahibi, üretim çıktı | `09a64f8` |

### Ana çıktı

- 855 unique satış siparişi kaydı (914 Excel satırından 59 duplicate birleşti) canlı Firestore'da (`appData/salesOrders`)
- 3 müşteri: Aselsan (833 sipariş), Denma (20), Roketsan (2), toplam 64.1M TL
- Manuel plan hafta override sistemi çalışır (appData/planOverrides), upload sonrası korunuyor
- BOM eksik uyarı + MRP navigate + Ürün Ağacı tab auto-open
- Yeni "satis" rolü canlı, user management'tan atanabilir

---

## 3. v19'dan Sapmalar (v20'ye yansıtılacak)

v19 dökümanında yazılanlara göre Faz 1A uygulanmasında yapılan değişiklikler:

### 3.1. ID Şeması — 2-tuple yerine 3-tuple

v19 line ~1236-1240 Firestore şema tablosunda yazılan: `appData/salesOrders/{belgeNo}_{stokKodu}` (2-tuple).

**Problem:** Gerçek `ORNEKSATISSIPARIS.xlsx` analizinde 914 satırdan yalnızca 391 unique key — %57 çakışma. Aynı belgeNo+stokKodu farklı teslim tarihleriyle tekrarlanabiliyor (99 anahtarda 619 satır etkilenir).

**Karar:** 3-tuple `{belgeNo}_{stokKodu}_{teslimTarihi}` — 914 satır → 855 unique + 59 true duplicate aggregate. Teslim tarihi granülaritesi korunur. Haftalık planlama için kritik.

**Post-deploy patch:** Teslim boş olursa fallback zinciri: `teslim || orderDate || row{idx}` — gelecekte VIO no-teslim satır gönderirse collision önlenir (`499c412`).

### 3.2. BOM Eksik Uyarı — "BOM yükle →" Butonu + MRP Auto-Tab

v19 Adım 8'de yazılan: "Satır başında ❓ rozeti + badge (tıklanınca eksik ürünler listesi)".

**Uygulanan (genişletilmiş):** Badge + expandable liste + her eksik ürün için **"BOM yükle →" butonu** → MRP Planlama'ya navigate + **Ürün Ağacı (BOM) sekmesi otomatik açılır**.

**Teknik:** App.jsx'e `pendingMrpTab` state + MRPPlanlama'ya `initialTab` + `onConsumeInitialTab` one-shot props (+21/-5 satır). DigerMusteriler'e `onNavigateToMrp` callback prop.

### 3.3. Yetki Mimarisi

v19'da "admin + üretim (canEdit pattern'i)" yazılı, scope belirtilmemiş.

**Uygulanan:**
- **Sidebar gate:** `canSeeMRP` reused (App root scope, aynı rol seti, yeni değişken gereksizdi)
- **Component internal write gate:** DigerMusteriler kendi `canEdit`'ini türetir (isAdmin/isUretim props üzerinden, component-local). MRPPlanlama'nın scope-local `canEdit`'ine dışarıdan bağımlı değil.
- **Post-deploy 2 ile genişledi:** Yeni `satis` rolü, `canSeeDigerMusteriler = isAdmin || isSales` (üretim çıktı), `canSeeMRP = isAdmin || isUretim || isSales` (satış BOM yükleyebilir), `canPack = isAdmin || isPacker || isSales` (satış paketleme de yapar).

### 3.4. İkon

v19'da belirtilmemişti. Seçilen: **🤝** (iş ortaklığı/müşteri). MRP içindeki 🎯 "Montaj Öncelik" ile karışmaması için.

### 3.5. Override `by` Alanı

v19 Adım 6 spec'inde `by: "Ömer"` (email) yazılı.

**Uygulanan:** `"admin" / "satis" / "üretim" / "bilinmiyor"` role string. authUser prop'unu App.jsx'ten geçirmek ek edit gerektirmiyordu, role-level audit şimdilik yeterli. Email'e terfi ileride (v21+) App.jsx'te authUser drill.

### 3.6. Aggregate Davranışı

v19'da ayrıntı yok.

**Uygulanan:** Aynı `{belgeNo}_{stokKodu}_{teslim}` 3-tuple için miktar (orijinalMiktar, sevkEdilen, kalanMiktar) + toplamBedel sum'lanır. Diğer alanlar (orderDate, stokAdi, fiyat, müşteri) ilk satırdan korunur (true duplicate'lerde zaten aynı).

### 3.7. Drag & Drop — Not Korunur

v19'da belirtilmemişti.

**Uygulanan:** Drag ile satır yeni haftaya atandığında mevcut `planOverrides[id].note` **preserve edilir** — drag sadece `plannedWeek` değiştirir.

### 3.8. VIO Değişti Rozeti (Mavi ●)

Pratikte nadir tetiklenir çünkü 3-tuple ID teslim tarihini içeriyor — VIO teslim değişirse yeni bir ID oluşur, eski override orphan kalır. Mavi ● sadece override.origWeek manuel yanlış girilmişse veya eski bir scheme değişikliği sonrası görünür. Faz 2'de "stale override" tasarımında (v19'un Faz 2 pendingsi) ele alınmalı.

### 3.9. No-Teslim Edge Case

**v19'da sessiz geçti.** Ömer deploy sonrası fark etti: "teslim tarihi olmayan siparişler var mıydı?". Kontrol edildi, mevcut data'da 0 (914/914 teslim dolu). Ama gelecek için defansif yama:

- Parser ID fallback zinciri (bkz 3.1)
- UI `noWeek` kutusu expandable (Gecikenler pattern'iyle tutarlı) — plan butonu ve drag-drop da çalışır
- Override atanırsa satır normal hafta listesine geçer

---

## 4. Canlı Durum (22 Nis 2026, 15:00 TSI itibariyle)

| Metrik | Değer |
|---|---|
| main branch | `09a64f8` (Merge PR #3) |
| Production URL | sevkiyat-pro.vercel.app |
| Vercel deploy | SUCCESS |
| `appData/salesOrders` | 855 unique kayıt (914 satır, 3 müşteri) |
| `appData/planOverrides` | 0 (Ömer test override'larını temizledi) |
| Mevcut Firestore koleksiyonları | Dokunulmadı (Seviye 1 izolasyon ✓) |
| App.jsx değişimi (toplam) | +48 / -13 satır (16 commit + 2 patch boyunca) |
| Yeni dosyalar | 10 (modules + shared + docs) |
| Aktif kullanıcı rolleri | admin, uretim, packer, viewer, operator, **satis** (yeni) |

---

## 5. Güvenlik Teyidi (v19 Seviye 1-2-3)

- ✅ **Seviye 1 — Veri izolasyonu:** Yeni 2 doc (`salesOrders`, `planOverrides`), mevcut 7 doc (`bomModels`, `mrpBomMapping`, `mrpCache`, `mrpStock`, `mrpAkibet`, `mrpPurchaseOrders`, `products`) dokunulmadı. `bomModels` **sadece okundu** (BOM eksik tespiti için).
- ✅ **Seviye 2 — Kod izolasyonu:** Tüm iş `src/modules/digerMusteriler/` + `src/shared/` içinde. App.jsx minimal dokunma (sadece routing + rol gate'leri + prop drill).
- ✅ **Seviye 3 — Hata izolasyonu:** Upload try/catch → inline error box, Firestore listener error callback → sessizce log+devam.
- ✅ **Override korunma testi** canlı veriyle geçti — re-upload planOverrides'a dokunmadı.
- ✅ **Rollback planı:** Her adım ayrı commit → `git revert <hash>` granüler; her PR merge commit'i ile `git revert -m 1 <merge-sha>` ile tüm feature geri alınır.

---

## 6. Kararlar Defteri (Hangi İlke Neden)

### 6.1. Tek motor, çoklu girdi (v19'un ana mimari ilkesi)
MRP motoru bir adet, farklı talep kaynakları (konteyner + satış siparişi) aynı motora beslenir. Faz 1A'da motor entegrasyonu yok (Faz 2), ama veri modeli (`salesOrders`) adaptör katmanı için hazır.

### 6.2. Planlama ≠ İhtiyaç
Diğer Müşteriler modülü **sadece planlama** görünümü. "Bu siparişin bileşenleri neler eksik" (ihtiyaç görünümü) Faz 2'de MRP Planlama içinde sipariş bazlı panel olarak.

### 6.3. Aktif olan, hepsi değil
BOM'ların elle yüklenmesi — sadece sipariş alan ~198 ürün için. Faz 1A'daki BOM eksik uyarı bunu gösterir (admin/satış üretime yönlendirir, gelen uyarıyla yükleme yapılır).

### 6.4. İzole ekle, kademeli büyüt
v19'un Senaryo B kararı: modül ayrı klasör, App.jsx minimum. Faz 1A boyunca doğrulandı — ana App.jsx dosyası büyümedi, karmaşıklık modülde kaldı.

### 6.5. Görünürlük sisteme, karar insana
Override'lar manuel — sistem otomatik taşıma yapmıyor. VIO değişti rozeti uyarı gösterir, karar Ömer'in.

### 6.6. Her değişiklik tek sorumluluk
16 ayrı commit, her biri tek bir Adım için. Rollback granüler.

### 6.7. Veri iki katmanda, override'lar korunur
`salesOrders` (VIO ham) üzerine yazılır, `planOverrides` ayrı doc, upload'tan etkilenmez. Canlı veriyle test edildi, geçti.

---

## 7. Ertelenenler — Faz 1B / Faz 2 / Daha Sonra

| Öncelik | Konu | Zaman | Hazırlık |
|---|---|---|---|
| 🟢 Şimdi (2-3 hafta) | **Stabilize** — gerçek üretim kullanımı gözlemle | Nis 22 → May ~13 | — |
| 🟡 Yakın | **Aselsan 176 aktif ürünün BOM'ları** — elle yükleme | Satış kullanıcısı + üretim | BOM eksik badge rehberlik eder |
| 🟠 Faz 1B | **Mail otomasyonuna 4. rapor** (satış siparişi) | Stabilize sonrası 2-3 hafta | Parser pattern hazır (`parseSalesOrderExcel`) — backend'e taşınabilir, `functions/parsers.js` |
| 🔵 Faz 2 | **Motor entegrasyonu** — `salesOrders` → demand list adaptörü | Faz 1B sonrası | `runBomExplosion` girdi genişletilir, motor kodu aynı |
| 🔵 Faz 2 | **Sipariş bazlı ihtiyaç paneli** — MRP içinde yeni kardeş panel | Faz 2 motorla birlikte | — |
| 🔵 Faz 2 | **Override stale uyarısı** (sarı rozet) | Faz 2 | VIO değişti mavi ●'nin Faz 2 versiyonu — teslim değişiklik + override çatışması |
| 🔶 İleride | **Email bazlı `by` alanı** (`authUser` prop drill App.jsx) | — | Satış/üretim sayısı arttıkça audit gereksinim |
| 🔶 İleride | **Toplu override silme admin butonu** (test temizliği için) | — | — |
| 🔶 İleride | **Maliyet modülü** | Çizelge + fason sonrası | v19'un son bölümü — `src/modules/maliyet/` |

---

## 8. Öğrenilen Dersler

### 8.1. Gerçek veriyle erken doğrulama kritik
v19 spec'indeki 2-tuple ID gerçek data'da %57 collision üretti. Prototype v2'deki uydurma suffix'ler (`a/b/c`) bu sorunu gizliyordu. Gerçek VIO raporu upload edilip parser çalıştırıldığında sorun anında ortaya çıktı ve 3-tuple'a geçtik. **Prototype verisi yanıltıcı olabilir — ilk fırsatta gerçek veri.**

### 8.2. Commit disiplini rollback'i mümkün kılar
16 commit + 2 patch = 18 ayrı commit hash. Production'da tek bir commit'in bozulması durumunda `git revert` granül. Bu güven bir sonraki modülde (maliyet/envanter) aynı disiplinin korunması lazım.

### 8.3. App.jsx'e minimum dokunma ilkesi kanıtlandı
Tüm Faz 1A boyunca App.jsx'te net +48/-13 satır (toplam 14.8k+ satırlık dosyada). Senaryo B (v19'un modülerlik kararı) pratikte çalıştı. Ana dosya sağlığını korudu.

### 8.4. "Orijinale dön" UX görünürlük sorunu
Ömer canlı test sonrası "özelliği görmemişim" dedi — picker içindeki turuncu reset kutusu yeterince prominent değil. İleride (v21+ polish): picker açılınca üstteki mesajın daha belirgin olmasını düşünmeye değer, ya da BOM badge gibi sekme başında "N override var, yönet" linki.

### 8.5. Trust framework kademeli genişliyor
İlk oturum: her Write için onay sorup sundum. Adım 5'te Ömer "auto-Write in module scope" dedi. Adım 8'den sonra "satış rolü değişikliği" için ek onay gerekmediği bir "mevcut durumu bozmayan her değişiklik" seviyesine geçildi. Güven = kanıtlanmış 0 regression + açık kırmızı çizgiler (App.jsx modül dışı, mevcut Firestore yazma, npm install, git push --force).

### 8.6. gh CLI device-code auth tek seferlik
Brew yoksa standalone binary (`/tmp/gh-bundle/gh_2.90.0_macOS_arm64/bin/gh`), ~30 sn kurulum. `gh auth login --web` device code flow (yani `github.com/login/device` + kod yapıştır). Sonra `~/.config/gh/hosts.yml` keyring cache — terminal yeniden açılınca re-auth gerekmez. PR/merge/check akışı web UI'dan 10x daha hızlı.

---

## 9. Web Claude için Rehber (tasarım sohbeti)

### 9.1. Hangi konularda sohbet edilebilir?

- **Stabilize sonrası kullanıcı geri bildirimleri** — satış rolündeki kullanıcılar ne kullanıyor, ne kullanmıyor?
- **Faz 1B planlaması** — mail otomasyonu backend entegrasyonu (risk, parser taşıma, deploy stratejisi)
- **Faz 2 adaptör tasarımı** — `salesOrders` → MRP demand list, motor genişletme
- **Sipariş bazlı ihtiyaç paneli** — UX (ana müşteri MRP panel pattern'inden alınan + farklılaşan kısımlar)
- **Override stale uyarısı** — VIO teslim değişikliği + override çatışması
- **Maliyet modülü** (v19 son bölüm) — Aşama 1 MVP kapsamı, döviz (Soru 0 blocker), veri kaynakları
- **Sevkiyat bazlı kâr analizi** — uzun vadeli hedef, tasarım fikirleri

### 9.2. v20 dökümanı üretilecekse

Web Claude artifact olarak v20 oluşturursa:
1. Bu retrospektif + v19 tamamen birlikte context olarak okunur
2. v20 = v19 yapısı + bu retrospektif'in değişiklikleri + yeni sohbetten çıkan stratejik kararlar
3. Claude Code tarafında `docs/SEVKIYAT_PRO_YEDEK_DOKUMAN_v20.md` olarak kaydedilir (v19 korunur — tarihsel kayıt)

### 9.3. Claude Code'a dönüş için hazırlık

Tasarım kararları netleşince Claude Code oturumuna dönerken:
- v20.md (varsa) + bu retrospektif context olarak yüklenir (Claude Code `docs/`'u okur zaten)
- Faz 1B / Faz 2 / maliyet modülünün hangi alt görevle başlanacağı belirtilir
- Trust framework v2 (auto-Write in module scope) devam eder — kod yazımı hızlı akar

### 9.4. Not

Claude Code oturumunda **`~/.claude/projects/-Users-omeryasinakbuga-sevkiyat-pro/memory/`** altında 9 memory dosyası var (rol mimarisi, trust framework v1/v2, çalışma ritmi, ID şeması, dev server pattern'i, vs.). Bunlar Claude Code'un gelecek oturumlarda otomatik hatırlayacağı şeyler — web Claude'un onlara doğrudan erişimi yok ama bu retrospektif onların özetini içeriyor.

---

**Sevkiyat Pro Faz 1A resmen kapanmıştır. 🎊**

*Hazırlayan: Claude Code (22 Nis 2026)*
*Kaynak: commit history `31a4359..09a64f8`, Claude Code session memory, canlı Firestore snapshot.*
