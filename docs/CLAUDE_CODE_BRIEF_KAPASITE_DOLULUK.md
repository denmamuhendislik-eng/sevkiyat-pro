# Claude Code Brief — Kapasite & Doluluk Analizi + Tezgah Yük Özeti + Çift Vardiya

> **Tarih:** 29 Nisan 2026
> **Tip:** Analiz + tasarım ön çalışması (web Claude'da genişletilecek, sonra Claude Code'a kod brief'i olarak dönecek)
> **Kapsam:** MRP Planlama → "Kapasite & Çizelge" tab'ı içinde Doluluk Oranı hesabı
> **Hedef:** Bug düzeltme + yeni "Tezgah Yük Özeti" görünümü + WC bazlı özet + çift vardiya mimarisi
> **NOT:** Tab bilgi mimarisi (Sevkiyat / Üretim / Çizelge ayrımı) bu brief'in kapsamı değil — sonraya bırakıldı.

---

## 1. Mevcut Kod Durumu — En İnce Ayrıntı

### 1.1 Vardiya & Verimlilik (global ayar)

**Dosya:** `src/App.jsx`

```js
// Hesabın kalbi — 4 farklı yerde aynı formül
const shiftMin = (workCenters.shiftHours || 9) * 60 * (workCenters.efficiency || 0.85);
```

**Tanım yerleri:**
- `App.jsx:6591` — schedule hesabı içinde (calculateSchedule)
- `App.jsx:8387` — wipLoad memo başında
- `App.jsx:11034` — schedule tab render'ında
- `App.jsx:11040` — mSt (machine stats) hesabı

**UI ayar yeri:** `App.jsx:10429-10444` (İş Merkezleri tab'ı üst bandı)
- "Günlük vardiya:" `workCenters.shiftHours` (varsayılan 9 saat)
- "Verimlilik:" `workCenters.efficiency` (varsayılan 0.85)
- Hesaplanan: "= 459 dk/gün efektif" (small print)

**Firestore yeri:** `appData/workCenters` doc, root field: `shiftHours`, `efficiency`.

**Kritik gözlem:** Bu **TEK GLOBAL DEĞER**. Tüm tezgahlar/WC'ler aynı vardiya kullanır. Çift vardiya tezgah yok şu an.

### 1.2 Toplam İş Günü (totalWorkDays)

**Tanım:** Çizelgenin başlangıç → bitiş aralığında haftasonu olmayan gün sayısı.

```js
// App.jsx:6946-6949 (server-side)
let totalWorkDays = 0;
let d = new Date(minDate);
while (d <= maxDate) { if (!isWeekend(d)) totalWorkDays++; d = addDays(d, 1); }

// App.jsx:11042-11047 (client-side mSt)
let totalWorkDays = 0;
if (s.minDate && s.maxDate) {
  let d = new Date(s.minDate);
  const end = new Date(s.maxDate);
  while (d <= end) { if (d.getDay() !== 0 && d.getDay() !== 6) totalWorkDays++; ... }
}
```

**Aralık kaynağı:** `minDate` = jobs içindeki en erken `op.startDate`, `maxDate` = en geç `op.endDate`. Yani **çizelge ne kadar uzunsa kapasite o kadar büyük**.

**Sorun:** Tatil günleri (`ms.capacity?.holidays`) burada **kullanılmıyor**. Sadece Cumartesi/Pazar atlanır. Resmi tatil olsa bile iş günü sayılır.

### 1.3 Kapasite (totalCapMin)

```js
// App.jsx:6953 (server)
const totalCapMin = totalWorkDays * machineCount * shiftMin;

// App.jsx:11049 (client mSt)
const perMachineCap = totalWorkDays * shiftMin;
```

**Anlam:** İş günü × tezgah sayısı × efektif dakika/gün. Standart tek vardiya varsayımıyla.

**Görseldeki sayı doğrulama:** 979s × 60 = 58 740 dk. 58 740 / 459 dk = 128 iş günü. PRES/KAYNAK/MONTAJ/TESTERE hepsi 1 tezgah olduğu için kapasite aynı (979s).

### 1.4 Plan Yükü (loadMin)

**Hesap (server):** `App.jsx:6955-6957`

```js
let loadMin = 0;
jobs.forEach(j => j.operations.forEach(op => {
  if (op.wcCode === wcCode && !op.isFason) loadMin += op.totalMin;
}));
```

**Anlam:** Schedule motoru tarafından üretilen `jobs[]`'ın o WC'ye atanmış op'larının `totalMin` toplamı.

**`op.totalMin`:** `App.jsx:6644` — `setupTime + cycleTime × qty`. Fason op'lar için 0 (lead time'a gider, tezgah tüketmez).

**Tezgah seviyesi (mSt) loadMin:** `App.jsx:11053-11058`

```js
let mLoad = 0;
jobs.forEach(j => j.operations.forEach(op => {
  if (op.machineId === m.id && !op.isFason) {
    mLoad += op.totalMin || 0;
  }
}));
```

### 1.5 WIP Yükü (wipMin)

**Memo:** `App.jsx:8486` (`wipLoad` useMemo, deps: `[akibet, workCenters, bomModels, wipAssignments]`)

**Veri kaynağı:** Akibet (Bekleyen Operasyonlar) raporu — yarı mamul kalan miktarlar.

**Akış (akPart → akOp döngüsü):**

1. `matchWC(akOp.name)` ile op adından WC tespiti:
   - Kullanıcı tanımlı alias (`workCenters.opAliases`)
   - Hardcoded alias (`hardcodedAliases` — örn "ÖLÇÜM VE KALİTE KONTROL" → "KALİTE")
   - Tam isim eşleşme
   - `contains` veya `reverse` eşleşme
   - İlk kelime eşleşmesi
2. Çevrim süresi 3 katmanlı:
   - **BOM birebir** (`getBomCycleTime` — bomLookup'tan, `cycleTime > 0`)
   - **WC ortalama** (`wcAvgCycle[wcCode]` — BOM'daki tüm op'ların aritmetik ortalaması)
   - **5 dk/adet varsayılan**
3. `wipMin = setupTime + cycleTime × akOp.remaining`
4. Atama:
   - `wipAssignments[wipKey]` varsa → `byMachine[machineId]`
   - Yoksa → `byWC[wcCode]`

**BOM Projeksiyon (`App.jsx:8712`+):** Akibet'te eksik kalan sonraki BOM op'ları "projection" olarak `byWC`'ye eklenir. Cascade miktarı en yüksek aktif WIP miktarına eşit varsayılır.

**Çıktı yapısı:**

```js
{
  byWC: { [wcCode]: { totalMin, count } },         // atanmamış WIP
  byMachine: { [machineId]: { totalMin, count } }, // atanmış WIP
  items: [{ key, code, opCode, opName, wcCode, wipMin, ... }],
  totalMin, totalItems,
  projectedCount, projectedMin,
  debug: { total, matched, bomMatch, avgMatch, defMatch, fason, noWC, noWip, noOps, unmatchedOps, wcAvgCycle }
}
```

### 1.6 Doluluk Oranı UI Hesabı (kart başlığı)

**Render:** `App.jsx:13107-13163` (`Doluluk Dashboard` bloğu)

```js
// App.jsx:13123-13129
const wcWip = wipLoad.byWC[code];
const wipMin = (wcWip?.totalMin || 0)
            + wcMachines.reduce((s, [mId]) =>
                (wipLoad.byMachine[mId]?.totalMin || 0), 0);   // ← BUG
const totalLoad = st.loadMin + wipMin;
const totalUtil = st.totalCapMin > 0 ? Math.round((totalLoad / st.totalCapMin) * 100) : 0;
const barColor = totalUtil > 90 ? "#EF4444" : totalUtil > 70 ? "#F59E0B" : "#10B981";
const plannedPct = st.totalCapMin > 0 ? Math.min(100, Math.round((st.loadMin / st.totalCapMin) * 100)) : 0;
const wipPct = st.totalCapMin > 0 ? Math.min(100 - plannedPct, Math.round((wipMin / st.totalCapMin) * 100)) : 0;
```

**UI gösterim (App.jsx:13156-13162):**
- Sol: tezgah sayısı (`{st.machineCount} tezgah`)
- Sağ: `{wipMin}s WIP + {loadMin}s plan / {totalCapMin}s kap.`
- Bar: turuncu (WIP) + renkli (plan) iki katmanlı
- Yüzde: WIP+Plan/Kap (totalUtil)

### 1.7 Darboğaz Tespiti

**Server:** `App.jsx:6967-6970`

```js
let bottleneck = null, maxUtil = 0;
for (const [code, st] of Object.entries(wcStats)) {
  if (st.utilization > maxUtil) { maxUtil = st.utilization; bottleneck = code; }
}
```

**`st.utilization`:** `App.jsx:6962` — `Math.round((loadMin / totalCapMin) * 100)`. **WIP DAHIL DEĞİL.**

**Tezgah darboğazı (`machBn`):** `App.jsx:11079` — `mSt[id].utilization` üzerinden, bu **WIP dahil** (App.jsx:11069: `((mLoad + wipMin) / perMachineCap) * 100`).

**Tutarsızlık:** WC darboğazı sadece plan'a bakar, tezgah darboğazı WIP+Plan'a. UI'da iki KPI yanyana (`Darboğaz (Merkez)` + `Darboğaz (Tezgah)`) — farklı temellerde hesaplandığı bilinmiyor.

---

## 2. Bug'lar — Önceliklendirilmiş

### 🔴 Bug #1 — Reduce Accumulator Atlanmış (KRİTİK)

**Dosya/Satır:** `App.jsx:13123-13124`

```js
const wipMin = (wcWip?.totalMin || 0)
            + wcMachines.reduce((s, [mId]) =>
                (wipLoad.byMachine[mId]?.totalMin || 0), 0);
//             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//             accumulator `s` kullanılmıyor — sadece son tezgah sayılıyor
```

**Etki:** Bir WC'de N>1 tezgah varsa, **sadece sonuncu**nun atanmış WIP'i toplama dahil oluyor. Geri kalan tezgahların WIP'i kayıp.

**Sayısal kanıt (29 Nis görsel):**
- `wipLoad.totalMin / 60` (debug raporu): **1992s**
- 8 WC kartının WIP toplamı: 61+748+20+365+147+222+87+173 = **1823s**
- Fark: **169s eksik** — bug kaynaklı

**Düzeltme:**
```js
+ wcMachines.reduce((s, [mId]) => s + (wipLoad.byMachine[mId]?.totalMin || 0), 0);
```

**Risk:** Sıfır. Tek satır değişimi, mantık net. UI yüzdesi anında düzelir.

---

### 🟡 Bug #2 — Darboğaz Hesabı WIP Dahil Değil

**Dosya/Satır:** `App.jsx:6967-6970`

WC darboğazı `st.utilization = loadMin/totalCapMin` üzerinden, ama UI'da gösterilen yüzde `(loadMin+wipMin)/totalCapMin`. İki rakam aynı tab'da görünür ama farklı tabandır.

**Senaryo:** PRES HATTI %45 (UI kart), `wcStats[PRES].utilization` = 8 (sadece plan). PRES darboğaz değil sayılır halbuki WIP+Plan görünüşünde zirve.

**Önerilen düzeltme — iki yaklaşım:**

**A) wcStats'a wipMin alanı ekle, server'da hesapla:**
```js
// calculateSchedule içinde wcStats[wcCode] objesine ekle:
const wipForThisWC = (wipLoad?.byWC[wcCode]?.totalMin || 0)
                   + (wc.machines || []).reduce((s, m) =>
                       s + (wipLoad?.byMachine[m.id]?.totalMin || 0), 0);
wcStats[wcCode] = {
  ...,
  loadMin: Math.round(loadMin),
  wipMin: Math.round(wipForThisWC),
  totalLoadMin: Math.round(loadMin + wipForThisWC),
  utilization: ... // sadece plan (geriye uyumluluk için)
  totalUtilization: totalCapMin > 0 ? Math.round(((loadMin + wipForThisWC) / totalCapMin) * 100) : 0
};
// Bottleneck hesabı:
if (st.totalUtilization > maxUtil) { maxUtil = st.totalUtilization; bottleneck = code; }
```

**B) Client-side darboğaz hesabını kart UI'sıyla aynı yere koy:**
Kart hesabı zaten yaptığı için `totalUtil` değerini state'e (örn. `wcSt[code].totalUtil`) yansıt, KPI satırı bunu okusun. Server'a dokunulmaz.

**Tercih:** A daha temiz (wcStats single source of truth). Ama wipLoad client-side memo, server hesabına geçirmek karmaşık. **Pratik öneri B.**

**Risk:** Düşük. Bottleneck KPI'ı sadece görsel — yanlış değer aksiyonel hata yapmaz, sadece kafa karıştırır.

---

### 🟡 Bug #3 — Kapasitesiz WC Yanıltıcı %0 Gösteriyor

**Senaryo:** SAVUNMA MONTAJ (87+631=718s yük) ve KALİTE KONTROL (173+993=1166s yük) kart yüzdesi %0 — çünkü `machineCount=0` → `totalCapMin=0` → `0/0` = 0.

**Sorun:** Yük var ama görsel "rahat" gösteriyor. Operatör yanılır.

**Düzeltme önerileri:**

**A) Renk + ikon:**
```js
const totalLoadStr = `${wipMin}s WIP + ${loadMin}s plan`;
const isCapless = st.machineCount === 0 && (loadMin + wipMin) > 0;
// Yüzde yerine: "⚠ Kapasite tanımsız · {totalLoadStr} yük"
// Border kırmızı, arka plan açık kırmızı
```

**B) Kart üstüne uyarı bandı:**
```jsx
{isCapless && (
  <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '4px 8px', fontSize: 10 }}>
    ⚠ Kapasite tanımlı değil — {Math.round((loadMin+wipMin)/60)}s yük hesaba katılmıyor
  </div>
)}
```

**Risk:** Sıfır. Sadece görsel uyarı.

---

### 🟢 Bug #4 — Tatil Günleri İş Günü Sayılıyor

**Dosya/Satır:** `App.jsx:6946-6949` ve `App.jsx:11042-11047`

```js
while (d <= maxDate) { if (!isWeekend(d)) totalWorkDays++; d = addDays(d, 1); }
```

`workCenters.holidays` veya `ms.capacity.holidays` kullanılmıyor. Veri var ama hesapta yok.

**Düzeltme:**
```js
const holidays = new Set(workCenters?.holidays || []); // "YYYY-MM-DD" listesi
while (d <= maxDate) {
  const ds = dateStr(d); // "YYYY-MM-DD" formatında
  if (!isWeekend(d) && !holidays.has(ds)) totalWorkDays++;
  d = addDays(d, 1);
}
```

**UI eklemesi:** İş Merkezleri tab'ı üstüne (vardiya/verimlilik bandının yanına) "Resmi Tatiller" liste editörü.

**Risk:** Tatil eklendikçe kapasite düşer, doluluk yüzdesi yükselir. Beklenen davranış.

---

### 🟢 Bug #5 — Atanmamış Op'lar Tezgah Görünümünde Kayıp

`mSt` hesabı `op.machineId === m.id` filtresi yapar (`App.jsx:11055`). Schedule motoru bir op'a tezgah atayamadıysa (örn. WC'de tezgah yoksa veya yetenek mismatch) op `wcSt.loadMin`'e dahil olur ama `mSt[id].loadMin`'e olmaz.

**Etki:** Genişletilmiş kart açıldığında tezgah toplamı, WC toplamından az olur. Tutarsızlık görsel.

**Düzeltme önerisi:** Atanmamış op'ları "WC ortalaması" olarak tezgahlara dağıt veya sanal "atanmamış" satırı ekle (Gantt'ta zaten `wc + "_NONE"` mantığı var, oraya benzer).

**Risk:** Düşük. Görselle hesap matching'i için iyileştirme.

---

### 🟢 Bug #6 — Verimlilik Çarpanı Örtük

```js
shiftMin = (shiftHours || 9) * 60 * (efficiency || 0.85)  // = 459 dk varsayılan
```

Kullanıcı "9 saat vardiya" ayarlarken kapasite gerçekten 9×60=540 dk değil, 459 dk. UI'da "= 459 dk/gün efektif" yazıyor ama small print.

**Öneri:** Kart altında küçük not — "Efektif: %85 verimlilik dahil — değiştirmek için İş Merkezleri tab'ı". Veya tooltip.

**Risk:** Sıfır. Sadece şeffaflık.

---

## 3. YENİ ÖZELLİK — Tezgah Yük Özeti

### 3.1 Niye gerekli?

Kullanıcının ifadesi:
> "Hangi tezgah kaç gün dolu yeni bir iş alırken en erken teslim tarihini bilmem açısından kritik öneme sahip — en azından tezgah bazlı kaç gün dolu kapasitesi ne durumda veya kaç gün sonra boşalıyor."

Mevcut Gantt günlük grid gösterir (görsel) ama "bu tezgah kaç gün dolu" hızlı bakışta görmek zor. **Tablo formunda özet** lazım.

### 3.2 Veri Kaynakları (mevcut state'ten türetilebilir)

Hiçbir yeni Firestore field gerekmiyor. Mevcut `schedule.jobs[]` + `wipLoad.byMachine` yeterli.

```js
function computeMachineLoadSummary(jobs, wipLoad, workCenters, shiftMin, today) {
  const summary = {};
  Object.entries(workCenters?.centers || {}).forEach(([wcCode, wc]) => {
    (wc.machines || []).forEach(m => {
      const ops = jobs.flatMap(j => j.operations).filter(o =>
        o.machineId === m.id && !o.isFason
      );
      const totalMin = ops.reduce((s, o) => s + (o.totalMin || 0), 0);
      const wipMin = wipLoad.byMachine[m.id]?.totalMin || 0;
      const totalLoadMin = totalMin + wipMin;
      const lastEndDate = ops
        .map(o => o.endDate)
        .filter(Boolean)
        .sort()
        .pop();
      const loadDays = Math.ceil(totalLoadMin / shiftMin); // efektif iş günü
      const nextFreeDate = lastEndDate
        ? addBusinessDays(new Date(lastEndDate), 1)
        : today;
      summary[m.id] = {
        machineId: m.id,
        machineName: m.name,
        wcCode, wcName: wc.name,
        opCount: ops.length,
        wipOps: wipLoad.byMachine[m.id]?.count || 0,
        loadMin: totalMin,
        wipMin,
        totalLoadMin,
        loadDays,                    // "kaç gün dolu"
        lastEndDate,                 // "son işin biteceği tarih"
        nextFreeDate,                // "bir sonraki boş slot"
        utilization: shiftMin > 0 ? Math.round((totalLoadMin / (shiftMin * totalWorkDays)) * 100) : 0,
        firstOpDate: ops.map(o => o.startDate).filter(Boolean).sort()[0]
      };
    });
  });
  return summary;
}
```

### 3.3 UI Tasarım (önerim)

**Yer:** Doluluk Oranı kartlarının **altında** yeni blok. Mevcut kart düzeni bozulmaz, sadece ek bilgi.

**Tablo formatı:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ TEZGAH YÜK ÖZETİ                                          Bugün: 29.04.2026     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Tezgah                       │ Yük (gün) │ Bitiş        │ Boş Slot   │ Doluluk  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ TORNA MERKEZİ (5 tezgah)                                                        │
│   🟢 VICTOR CNC TORNA        │   8.5 g   │ 06.05.2026   │ 07.05.2026 │  %35     │
│   🟡 GOODWAY CNC DİK TORNA   │  14.2 g   │ 14.05.2026   │ 15.05.2026 │  %72     │
│   🔴 TOPTURN CNC TORNA       │  25.0 g   │ 28.05.2026   │ 29.05.2026 │  %95     │
│   🟢 YOU JI CNC DİK TORNA    │   4.0 g   │ 03.05.2026   │ 04.05.2026 │  %18     │
│   🟢 DMG C EKSEN CNC TORNA   │   6.5 g   │ 05.05.2026   │ 06.05.2026 │  %30     │
│  ─────────────────────────────────────────────────────────────────              │
│  WC Özet:                      11.6 g ort · en erken boş: 04.05 (YOU JI)        │
├─────────────────────────────────────────────────────────────────────────────────┤
│ İŞLEME MERKEZİ (7 tezgah)                                                       │
│   ...                                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Etkileşim:**
- Sıralama: tezgah adı / doluluk / boş slot tarihine göre
- Filtre: WC bazlı veya "yalnız %X üstü" gibi
- Tıklanabilir tezgah adı → Gantt'ta o tezgahı highlight
- Hover: o tezgahın işlerinin listesi (parça kodları, tarihler)

**Renk kodları:**
- 🟢 Yeşil: %0-50
- 🟡 Sarı: %50-80
- 🔴 Kırmızı: %80+

### 3.4 WC Yük Özeti (tezgah özetinin agregasyonu)

Tezgah özetinin bir üst seviyesi. Mevcut Doluluk Oranı kartları zaten WC bazlı ama özet bilgi eksik. Önerim:

**Mevcut karta ek alan:**
```
TORNA MERKEZİ                         %38 toplam
[doluluk barı]
5 tezgah · 61s WIP + 1315s plan / 4896s kap.
─ EN ERKEN BOŞ: 04.05 (YOU JI) ─
```

veya **kart genişletildiğinde** tezgah listesi yerine bu özet üstte dursun.

### 3.5 "Yeni iş için en erken teslim" — Çözüm yaklaşımı

Kullanıcı: "yeni iş alırken en erken teslim tarihini bilmem açısından kritik."

**İki seviye çözüm:**

**Seviye 1 (kolay) — sadece bilgilendirme:**
Tezgah Yük Özeti zaten "Boş Slot" kolonunu gösterir. Kullanıcı manuel bakar: "bu işe X tezgahı lazım, oradaki en erken boş 04.05" → "X gün üretim, sonraki 04.05+X iş günü = teslim".

**Seviye 2 (gelişmiş) — interaktif simülasyon:**
Yeni bir "Üretim Simülatörü" widget:
```
Parça kodu: [_____________]
Adet: [____]
[Hesapla]

Sonuç:
- BOM operasyonları: 5 op (Torna, İşleme, Pres, Kalite Kontrol, Montaj)
- Toplam üretim süresi: 12.4 iş günü
- Kullanılacak tezgahlar:
  • Torna: VICTOR (en boş, 04.05)
  • İşleme: KAO MING (06.05)
  • Pres: 09.05
- Tahmini en erken teslim: 16.05.2026 (12.4 + 5 fason gün)
```

Seviye 2 yeni iş paketi, bu brief'in kapsamı dışında ama mimari olarak Seviye 1'in üstüne kurulur.

---

## 4. Çift Vardiya — Mimari Seçenekler

### 4.1 Şu Anki Durum

**Tek global ayar:**
```js
shiftMin = (workCenters.shiftHours || 9) * 60 * (workCenters.efficiency || 0.85)
```

Tüm tezgahlar/WC'ler aynı vardiya. Çift vardiya yok.

### 4.2 Seçenek 1 — Tezgah Bazlı `shiftHours` Field

**Veri modeli:**
```js
workCenters.centers[wcCode].machines[i] = {
  id, name,
  shiftHours: 18,  // YENİ — opsiyonel, override
  // ... mevcut alanlar
}
```

**Hesap akışı (her yerde):**
```js
const efficiency = workCenters.efficiency || 0.85;
const machineShiftMin = (m.shiftHours || workCenters.shiftHours || 9) * 60 * efficiency;
const machineCap = totalWorkDays * machineShiftMin;

// WC kapasite = sum of machine caps:
const wcCap = (wc.machines || []).reduce((s, m) => {
  const ms = (m.shiftHours || workCenters.shiftHours || 9) * 60 * efficiency;
  return s + (totalWorkDays * ms);
}, 0);
```

**UI ekleme:** İş Merkezleri tab'ında her tezgah satırına "Vardiya: [9] saat" input. Boş bırakılırsa global kullanılır.

**Pro:**
- Granular — her tezgah kendi vardiyasını alabilir
- Geriye uyumlu — `m.shiftHours` yoksa global fallback
- Mevcut UI minimal değişimle eklenir

**Con:**
- 4-5 yerde shiftMin hesabı dağılmış — hepsini tezgah bazlı yapacak şekilde değiştirmek lazım
- Schedule motoru bir op'u tezgaha atadıktan sonra üretim süresini o tezgahın vardiyasıyla hesaplamalı

**Etki yerleri (tek tek değiştirilecek):**
- `App.jsx:6591` — calculateSchedule başında shiftMin (tezgah-aware olmalı)
- `App.jsx:6802` — daysNeeded hesabı (op'un atandığı tezgahın shiftMin'i)
- `App.jsx:6822` — `remaining -= shiftMin` (forward scheduling)
- `App.jsx:6899` — totalProductionDays
- `App.jsx:6953` — totalCapMin (WC bazlı, tezgahları topla)
- `App.jsx:8387, 8438` — wipLoad
- `App.jsx:11034, 11040` — UI tarafı
- `App.jsx:11049` — perMachineCap (tezgah bazlı)
- `App.jsx:13811` — wipDays

### 4.3 Seçenek 2 — WC Bazlı `shiftHours` Field

**Veri modeli:**
```js
workCenters.centers[wcCode] = {
  name, machines: [...],
  shiftHours: 18,  // YENİ — WC override
  // ...
}
```

**Pro:** Daha az değişiklik (tek seviye fallback hierarchy: WC > global).
**Con:** Aynı WC'deki tezgahlar farklı vardiya çalışamaz. Gerçek senaryo: TORNA MERKEZİ'nde 5 tezgahdan 2'si çift vardiya, 3'ü tek vardiya — bu modelde mümkün değil.

**Verdict:** Yetersiz. Geç.

### 4.4 Seçenek 3 — Vardiya Profili (Preset)

**Veri modeli:**
```js
workCenters.shiftProfiles = {
  "single":     { hours: 9,  label: "Tek vardiya (9 saat)" },
  "double":     { hours: 18, label: "Çift vardiya (18 saat)" },
  "continuous": { hours: 22, label: "Sürekli (22 saat)" },
  "halfday":    { hours: 4.5, label: "Yarım gün" }
};

workCenters.centers[wcCode].machines[i].shiftProfile = "double";
```

**Hesap:**
```js
const profile = workCenters.shiftProfiles[m.shiftProfile || "single"];
const hours = profile?.hours || workCenters.shiftHours || 9;
```

**Pro:**
- Anlaşılır UI: "Bu tezgah çift vardiya" toggle/select
- Profilleri merkezi yönet (preset değiştirince tüm tezgahlar etkilenir)

**Con:**
- Backend mantığı seçenek 1 ile aynı, sadece veri modeli farklı
- Ekstra Firestore alanı (shiftProfiles)

**Verdict:** Seçenek 1'in UI versiyonu. İyi varyasyon.

### 4.5 Seçenek 4 — Vardiya Takvimi (Gün Bazlı)

**Veri modeli:**
```js
workCenters.centers[wcCode].machines[i].calendar = {
  default: { hours: 9 },
  overrides: {
    "2026-05-01": { hours: 0 },     // Resmi tatil
    "2026-05-15": { hours: 4.5 },   // Yarım gün
    "saturday":   { hours: 4.5 }    // Cumartesi yarım
  }
};
```

**Pro:** Maksimum esneklik, vardiya değişimleri tarihsel takip edilir.
**Con:** Çok karmaşık. Hesap her gün için override lookup. Forward scheduling aralık-bazlı yerine gün-bazlı olmalı.

**Verdict:** Aşırı mühendislik. İhtiyaç olursa V2.

### 4.6 ÖNERİM — Seçenek 1 + Seçenek 3 Hibrit

**Yaklaşım:**
1. Veri modelinde **seçenek 1** (tezgah bazlı `shiftHours` integer field, opsiyonel)
2. UI'da **seçenek 3 görünümü** (preset select kutusu — "Tek/Çift/Sürekli/Özel")

```jsx
// İş Merkezleri tab'ında tezgah satırında
<select value={getProfile(m.shiftHours)} onChange={...}>
  <option value="">Varsayılan ({workCenters.shiftHours || 9}s)</option>
  <option value="single">Tek vardiya (9s)</option>
  <option value="double">Çift vardiya (18s)</option>
  <option value="continuous">Sürekli (22s)</option>
  <option value="custom">Özel...</option>
</select>
{custom && <input type="number" placeholder="Saat" />}
```

`getProfile(hours)` kuralları:
- `undefined` → "" (varsayılan)
- 9 → "single"
- 18 → "double"
- 22 → "continuous"
- diğer → "custom"

Backend hesap her zaman `m.shiftHours` integer'ı kullanır.

**Pro:** Basit veri modeli + zengin UI + mevcut sistemle geriye uyumlu (m.shiftHours yoksa global).

**Con:** Hesap yerlerini tek tek tezgah-aware yapacak güncelleme gerekiyor. ~10 yer.

### 4.7 Çift Vardiya — Yan Etki Notu

Çift vardiya sadece kapasite hesabını etkilemez, **schedule motoru forward scheduling**'i de etkiler:
- Bir op için "günlük kapasite × kalan gün" hesabı her tezgahın kendi vardiyasıyla yapılmalı
- Aksi halde 18 saatlik tezgaha 9 saatlik gibi iş yüklenir, tarihler kayar

`App.jsx:6802, 6822` yerlerinde `shiftMin` kullanımları **op.machineId üzerinden** çözümlenmeli:
```js
const opShiftMin = getMachineShiftMin(op.machineId, workCenters);
const daysNeeded = Math.max(1, Math.ceil(op.totalMin / opShiftMin));
```

---

## 5. Diğer İyileştirmeler

### 5.1 Çizelge Aralığı Sabitleme (ileride)

**Sorun:** `totalWorkDays = maxDate - minDate (jobs)` dinamik. Jobs azalınca çizelge kısalır → kapasite küçülür → yüzde değişir.

**Öneri:** "Görünüm penceresi" parametresi — sabit 60/90/180 gün ileri.
```js
const horizon = workCenters.capacityHorizonDays || 90;
const horizonEnd = addBusinessDays(today, horizon);
const totalWorkDays = countBusinessDays(today, horizonEnd) - holidays.size;
```

UI'da "Kapasite ufku: 90 gün" select kutusu. Kart yüzdesi sabit referansa göre hesaplanır.

**Trade-off:** Schedule maxDate horizon'dan ileri olabilir → kapasiteye sığmayan iş "ufuk dışı" olarak işaretlenir.

### 5.2 Verimlilik Şeffaflığı

`workCenters.efficiency` örtük çarpan. Önerim:
- Kart altına: "Efektif: %85 verimlilik dahil ⓘ"
- Tooltip'te formül açıklaması: "9 saat × 60 dk × 0.85 = 459 dk/gün"
- İş Merkezleri tab'ında verimlilik input'una info ikonu

---

## 6. Yedek Doküman — Mevcut Durum Snapshot (29 Nis 2026)

### 6.1 İlgili Dosyalar
- `src/App.jsx` — tüm hesap ve UI tek dosyada
- `appData/workCenters` Firestore doc — `shiftHours`, `efficiency`, `centers`, `fason`, `opAliases`, `holidays`(?)
- `appData/akibet` — Bekleyen Operasyonlar (WIP kaynak verisi)
- `appData/schedule` — calculateSchedule sonucu (`jobs`, `fasonOrders`, `wcStats`, `bottleneck`, `lastCalculated`, `minDate`, `maxDate`)

### 6.2 Hesap Akışı (server-side, calculateSchedule)
1. `explosionResult.parts` → ihtiyaç kalemleri
2. Her ihtiyaç için `bom.part.operations` → jobs[] (op listesiyle)
3. Forward scheduling: `op.startDate`, `op.endDate` atanır (`shiftMin` kullanılarak)
4. Tezgah ataması: `op.machineId` (yetenek + en erken boş)
5. `wcStats[wcCode]` hesaplanır: `loadMin`, `totalCapMin`, `utilization`
6. `bottleneck` = max(utilization)
7. Sonuç Firestore `appData/schedule`'a yazılır

### 6.3 Hesap Akışı (client-side, schedule tab)
1. `wipLoad` (useMemo) — akibet'ten WIP yükü hesaplanır
2. `mSt` (closure içinde IIFE) — tezgah bazlı stats (`wipMin` dahil)
3. `wcSt = schedule.wcStats` — server'dan gelen WC stats
4. UI render: kart başlığı `(loadMin + wipMin) / totalCapMin`

### 6.4 Bilinen Sınırlamalar
- Vardiya: tek global değer
- Tatil: data var, hesapta yok
- Atanmamış op'lar: WC seviyesinde dahil, tezgah seviyesinde değil
- Çizelge aralığı: jobs'a bağlı dinamik
- Verimlilik çarpanı: örtük (small print)
- Doluluk hesabı: 1 satır kritik bug (reduce accumulator)

### 6.5 Mevcut UI Bileşenleri
- `Doluluk Dashboard` — `App.jsx:13107-13260` — kart grid + expanded tezgah detay
- `Mevcut WIP Özeti` — `App.jsx:13045-13104` — debug raporu, eşleşmeyen op alias yöneticisi
- `Üretim Çizelgesi (Gantt)` — `App.jsx:13670+` — günlük tezgah grid
- `İş Merkezleri` tab — `App.jsx:10424+` — vardiya/verimlilik/tezgah/fason ayarları

---

## 7. İleri Adımlar

1. **Bu döküman web Claude'a verilir** — tasarım genişletilir (UI mock, edge case, kullanıcı senaryosu)
2. **Web Claude'dan dönüş** — Claude Code'a kod brief'i olarak iletilir
3. **Claude Code uygulama:**
   - Bug #1 (reduce) — 1 satır
   - Bug #2 (darboğaz WIP) — A veya B yaklaşım
   - Bug #3 (kapasitesiz WC) — UI uyarı
   - Bug #4 (tatil) — opsiyonel, ek UI
   - Yeni: Tezgah Yük Özeti — yeni bileşen
   - Yeni: Çift vardiya altyapısı — seçilen mimariye göre

4. **Tab bilgi mimarisi** — bu işlerin sonrasına bırakıldı, ayrı bir oturumda Sevkiyat / Üretim / Çizelge ayrımı tartışılır.

---

**Brief'i hazırlayan:** Claude Code (Opus 4.7)
**Hazırlanma tarihi:** 29 Nisan 2026, sabah oturumu
**Veri kaynağı:** localhost:3000 canlı oturum + `src/App.jsx` v20 commit `7069adb`
**Ekran görüntüleri:** Müşteri Dashboard (Ömer 29 Nis 10:21) — TORNA %28, İŞLEME %33, vb.
