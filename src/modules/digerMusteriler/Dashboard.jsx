import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts';
import { useSalesOrders, usePlanOverrides, useBomModels, useShipments } from './hooks';
import { resetShipments } from './firestore';
import { customerBadge, KNOWN_CUSTOMERS } from './customerMeta';
import { formatMoney } from '../../shared/moneyFormat';
import { getISOWeek } from '../../shared/weekUtils';

// Aşama 2.5 — Diğer Müşteriler için yönetici dashboard'ı.
// Veri kaynakları: salesOrders (aktif siparişler), shipments (sevk geçmişi — VIO diff'inden üretilir).
// Sevkiyat Bazlı İhtiyaç paneli ve mevcut Dashboard (konteyner) kutsal — bu farklı bir sayfa.
export default function MusteriDashboard({ isAdmin, isUretim, isSales }) {
  const canEdit = !!(isAdmin || isUretim || isSales);
  const { salesOrders, loaded: ordersLoaded } = useSalesOrders();
  const { planOverrides } = usePlanOverrides();
  const { bomModels } = useBomModels();
  const { shipments, loaded: shipLoaded } = useShipments();
  const allLoaded = ordersLoaded && shipLoaded;

  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => getISOWeek(today), [today]);
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthKey = monthKey(today);
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthKey = monthKey(prevMonthDate);

  // BOM eksik tespiti (root stok kodları)
  const bomSet = useMemo(() => {
    const s = new Set();
    for (const [k, m] of Object.entries(bomModels || {})) {
      if (k === 'undefined') continue;
      const root = (m?.parts || []).find(p => p.parentIdx === null || p.parentIdx === undefined);
      if (root?.stockCode) s.add(root.stockCode);
    }
    return s;
  }, [bomModels]);

  // 1) Bu ay alınan siparişler (orderDate'e göre) + geçen ay karşılaştırma
  const orderVolume = useMemo(() => {
    let thisMonthCount = 0, thisMonthBedel = 0;
    let prevMonthCount = 0, prevMonthBedel = 0;
    for (const o of Object.values(salesOrders || {})) {
      if (!o.orderDate) continue;
      const k = o.orderDate.substring(0, 7);
      if (k === currentMonthKey) {
        thisMonthCount++;
        thisMonthBedel += Number(o.toplamBedel || 0);
      } else if (k === prevMonthKey) {
        prevMonthCount++;
        prevMonthBedel += Number(o.toplamBedel || 0);
      }
    }
    const bedelChangePct = prevMonthBedel > 0 ? ((thisMonthBedel - prevMonthBedel) / prevMonthBedel) * 100 : null;
    return { thisMonthCount, thisMonthBedel, prevMonthCount, prevMonthBedel, bedelChangePct };
  }, [salesOrders, currentMonthKey, prevMonthKey]);

  // 2) Teslim yükü — bu hafta + 4 hafta sonrasına kadar (override veya orijinal teslim)
  const deliveryLoad = useMemo(() => {
    const buckets = {};
    for (let i = 0; i < 5; i++) buckets[`+${i}`] = { week: '', count: 0, bedel: 0 };
    let thisWeekCount = 0, thisWeekBedel = 0;
    let next4WeekCount = 0, next4WeekBedel = 0;
    for (const [id, o] of Object.entries(salesOrders || {})) {
      const ov = planOverrides?.[id];
      if (ov?.status === 'deferred') continue;
      const week = ov?.plannedWeek || (o.teslimTarihi ? getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z')) : '');
      if (!week) continue;
      const remaining = Number(o.kalanMiktar || 0);
      if (remaining <= 0) continue;
      const bedel = Number(o.toplamBedel || 0);
      if (week === currentWeek) { thisWeekCount++; thisWeekBedel += bedel; }
      // Sonraki 4 hafta için lexicographic karşılaştırma yeterli (ISO format YYYY-Www)
      const wkNum = parseInt(week.split('-W')[1] || '0');
      const curNum = parseInt(currentWeek.split('-W')[1] || '0');
      const diff = wkNum - curNum;
      if (diff >= 0 && diff <= 4) {
        next4WeekCount++; next4WeekBedel += bedel;
      }
    }
    return { thisWeekCount, thisWeekBedel, next4WeekCount, next4WeekBedel };
  }, [salesOrders, planOverrides, currentWeek]);

  // 3) Sevk performansı — shipments'tan
  const shipmentPerf = useMemo(() => {
    let thisMonthEvents = 0, thisMonthQty = 0;
    let totalFullyDelivered = 0, totalOnTime = 0, totalLate = 0;
    let totalLateDays = 0, lateCount = 0;
    for (const [id, sh] of Object.entries(shipments || {})) {
      if (!sh) continue;
      // Bu ay olan event'ler
      for (const ev of (sh.events || [])) {
        if (ev.at && ev.at.substring(0, 7) === currentMonthKey) {
          thisMonthEvents++;
          thisMonthQty += Number(ev.deltaQty || 0);
        }
      }
      // Tamamlanan siparişlerde teslim tarihi karşılaştırması
      if (sh.fullyDelivered && sh.finalShipAt && sh.teslimTarihi) {
        totalFullyDelivered++;
        const finalShip = sh.finalShipAt.substring(0, 10);
        if (finalShip <= sh.teslimTarihi) {
          totalOnTime++;
        } else {
          totalLate++;
          const diff = (new Date(finalShip).getTime() - new Date(sh.teslimTarihi).getTime()) / 86400000;
          if (diff > 0) { totalLateDays += diff; lateCount++; }
        }
      }
    }
    const otdPct = totalFullyDelivered > 0 ? (totalOnTime / totalFullyDelivered) * 100 : null;
    const avgLateDays = lateCount > 0 ? totalLateDays / lateCount : null;
    return { thisMonthEvents, thisMonthQty, totalFullyDelivered, totalOnTime, totalLate, otdPct, avgLateDays };
  }, [shipments, currentMonthKey]);

  // 4) Müşteri bedel pastası — top 5 (yıllık toplam)
  const customerPie = useMemo(() => {
    const map = {};
    for (const o of Object.values(salesOrders || {})) {
      const cc = o.customerCode || '?';
      if (!map[cc]) map[cc] = { code: cc, name: o.customerName || cc, value: 0 };
      map[cc].value += Number(o.toplamBedel || 0);
    }
    const arr = Object.values(map).sort((a, b) => b.value - a.value).slice(0, 5);
    return arr;
  }, [salesOrders]);

  // 5) Aylık trend — son 6 ay alındı vs sevk edildi (bedel)
  const monthlyTrend = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][d.getMonth()] + ' ' + String(d.getFullYear()).slice(2), alindi: 0, sevk: 0 });
    }
    const map = Object.fromEntries(months.map(m => [m.key, m]));
    // Alındı (orderDate)
    for (const o of Object.values(salesOrders || {})) {
      if (!o.orderDate) continue;
      const k = o.orderDate.substring(0, 7);
      if (map[k]) map[k].alindi += Number(o.toplamBedel || 0);
    }
    // Sevk (shipment events — orijinal birim fiyatı * deltaQty)
    for (const sh of Object.values(shipments || {})) {
      if (!sh || !sh.events) continue;
      const unitBedel = sh.orijinalMiktar > 0 ? (Number(sh.events.length > 0 ? 0 : 0)) : 0;
      // Daha güvenli: event başına bedel = (deltaQty / orijinalMiktar) * toplamBedel — ama toplamBedel sh'de yok
      // Bu yüzden basit yaklaşım: sevkEdilen oranı * salesOrders'taki toplamBedel
    }
    // Daha doğru sevk bedeli: salesOrders'taki toplamBedel'i events üzerinden orantıla
    for (const [id, sh] of Object.entries(shipments || {})) {
      if (!sh?.events?.length || !sh.orijinalMiktar) continue;
      const so = salesOrders?.[id];
      const unitPrice = so ? (Number(so.toplamBedel || 0) / Number(so.orijinalMiktar || 1)) : (Number(sh.orijinalMiktar > 0 ? 0 : 0));
      for (const ev of sh.events) {
        if (!ev.at) continue;
        const k = ev.at.substring(0, 7);
        if (map[k]) map[k].sevk += Number(ev.deltaQty || 0) * unitPrice;
      }
    }
    return months;
  }, [salesOrders, shipments, today]);

  // 5b) Gelecek 6 ay yükü — bizim plan vs müşteri teslim (bedel)
  const futureLoad = useMemo(() => {
    const months = [];
    const monthLabels = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      months.push({ key: monthKey(d), label: monthLabels[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2), plan: 0, musteri: 0, planCount: 0, musteriCount: 0 });
    }
    const map = Object.fromEntries(months.map(m => [m.key, m]));
    let totalPlan = 0, totalMusteri = 0, divergeCount = 0;
    for (const [id, o] of Object.entries(salesOrders || {})) {
      const ov = planOverrides?.[id];
      if (ov?.status === 'deferred') continue;
      const remaining = Number(o.kalanMiktar || 0);
      if (remaining <= 0) continue;
      const bedel = Number(o.toplamBedel || 0);
      // Bizim plan tarihi: override.plannedWeek varsa o (Pazartesi'sini al), yoksa teslimTarihi
      let planDateStr = '';
      if (ov?.plannedWeek) {
        // ISO week → Pazartesi (yaklaşık) — YYYY-Www → YYYY-MM ay key'i
        const m = ov.plannedWeek.match(/^(\d{4})-W(\d{1,2})$/);
        if (m) {
          const year = parseInt(m[1]);
          const week = parseInt(m[2]);
          // Pazartesi: 4 Ocak'ın bulunduğu hafta = ISO week 1
          const jan4 = new Date(year, 0, 4);
          const jan4Day = jan4.getDay() || 7;
          const week1Mon = new Date(year, 0, 4 - jan4Day + 1);
          const monday = new Date(week1Mon);
          monday.setDate(week1Mon.getDate() + (week - 1) * 7);
          planDateStr = monday.toISOString().substring(0, 10);
        }
      }
      if (!planDateStr) planDateStr = o.teslimTarihi || '';
      const musteriDateStr = o.teslimTarihi || '';
      const planKey = planDateStr ? planDateStr.substring(0, 7) : '';
      const musteriKey = musteriDateStr ? musteriDateStr.substring(0, 7) : '';
      if (map[planKey]) { map[planKey].plan += bedel; map[planKey].planCount++; totalPlan += bedel; }
      if (map[musteriKey]) { map[musteriKey].musteri += bedel; map[musteriKey].musteriCount++; totalMusteri += bedel; }
      if (planKey && musteriKey && planKey !== musteriKey) divergeCount++;
    }
    return { months, totalPlan, totalMusteri, divergeCount };
  }, [salesOrders, planOverrides, today]);

  // 6) Operasyonel uyarılar
  const ops = useMemo(() => {
    let lateCount = 0, lateBedel = 0;
    let staleCount = 0;
    let deferredCount = 0, deferredBedel = 0;
    let cancelledCount = 0;
    let bomMissingCount = 0;
    const bomMissingSet = new Set();
    const oldestLate = [];
    for (const [id, o] of Object.entries(salesOrders || {})) {
      const ov = planOverrides?.[id];
      const isDeferred = ov?.status === 'deferred';
      if (isDeferred) {
        deferredCount++;
        deferredBedel += Number(o.toplamBedel || 0);
        continue;
      }
      const week = ov?.plannedWeek || (o.teslimTarihi ? getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z')) : '');
      const remaining = Number(o.kalanMiktar || 0);
      if (remaining > 0 && week && week < currentWeek) {
        lateCount++;
        lateBedel += Number(o.toplamBedel || 0);
        oldestLate.push({ id, ...o, week });
      }
      // Stale (VIO termin değişmiş override)
      if (ov?.origWeek && o.teslimTarihi) {
        const vioCur = getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z'));
        if (vioCur && vioCur !== ov.origWeek) staleCount++;
      }
      // BOM eksik
      if (o.stokKodu && bomSet.size > 0 && !bomSet.has(o.stokKodu) && !bomMissingSet.has(o.stokKodu)) {
        bomMissingSet.add(o.stokKodu);
        bomMissingCount++;
      }
    }
    oldestLate.sort((a, b) => (a.week || '').localeCompare(b.week || ''));
    const top5OldestLate = oldestLate.slice(0, 5);
    // İptal edilenler — VIO'dan kaybolan deferred siparişler. salesOrders'ta artık yok,
    // sadece planOverrides'ta status:"cancelled" olarak kayıtlı.
    for (const ov of Object.values(planOverrides || {})) {
      if (ov?.status === 'cancelled') cancelledCount++;
    }
    return { lateCount, lateBedel, staleCount, deferredCount, deferredBedel, bomMissingCount, cancelledCount, top5OldestLate };
  }, [salesOrders, planOverrides, bomSet, currentWeek]);

  if (!allLoaded) {
    return <div style={{ padding: 24, color: '#78716c' }}>Dashboard yükleniyor…</div>;
  }

  const PIE_COLORS = ['#534AB7', '#0891B2', '#16a34a', '#ea580c', '#a855f7'];

  return (
    <div style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>📊 Müşteri Sipariş Dashboard</h1>
        <span style={{ fontSize: 11, color: '#a8a29e' }}>Bugün {currentWeek}</span>
      </div>

      {/* Üst sıra — 3 kart */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard
          icon="📈" title="Bu Ay Alınan Sipariş"
          primary={`${orderVolume.thisMonthCount} sipariş`}
          secondary={`${formatMoney(orderVolume.thisMonthBedel)} TL`}
          extra={orderVolume.bedelChangePct !== null ? (
            <span style={{ color: orderVolume.bedelChangePct >= 0 ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
              {orderVolume.bedelChangePct >= 0 ? '↑' : '↓'} %{Math.abs(orderVolume.bedelChangePct).toFixed(1)} (geçen aya göre)
            </span>
          ) : <span style={{ color: '#a8a29e' }}>geçen ay verisi yok</span>}
        />
        <KpiCard
          icon="🚚" title="Teslim Yükü"
          primary={`Bu hafta: ${deliveryLoad.thisWeekCount} sipariş`}
          secondary={`${formatMoney(deliveryLoad.thisWeekBedel)} TL`}
          extra={`Önümüzdeki 4 hafta: ${deliveryLoad.next4WeekCount} sipariş · ${formatMoney(deliveryLoad.next4WeekBedel)} TL`}
        />
        <KpiCard
          icon="✅" title="Sevk Performansı"
          primary={shipmentPerf.otdPct !== null ? `%${shipmentPerf.otdPct.toFixed(0)} zamanında` : 'Veri yok'}
          secondary={`${shipmentPerf.totalFullyDelivered} tam teslim · ${shipmentPerf.totalLate} gecikmeli`}
          extra={shipmentPerf.avgLateDays !== null
            ? `Bu ay ${shipmentPerf.thisMonthEvents} sevk hareketi · ortalama ${shipmentPerf.avgLateDays.toFixed(1)} gün gecikme`
            : `Bu ay ${shipmentPerf.thisMonthEvents} sevk hareketi`}
        />
      </div>

      {/* Orta sıra — pasta + trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12, marginBottom: 16 }}>
        <ChartCard title="Top 5 Müşteri (Bedel)">
          {customerPie.length === 0 ? <EmptyHint /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={customerPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                  label={(e) => `${customerBadge(e.code).label} ${(e.percent * 100).toFixed(0)}%`}>
                  {customerPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(v) + ' TL'} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Aylık Trend — Alınan vs Sevk Edilen (Son 6 Ay)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatMoney(v) + ' TL'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="alindi" name="Alındı" fill="#534AB7" />
              <Bar dataKey="sevk" name="Sevk Edildi" fill="#16a34a" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Gelecek 6 ay yükü — bizim plan vs müşteri teslim */}
      <div style={{ marginBottom: 16 }}>
        <ChartCard title="Önümüzdeki 6 Ay Yükü — Bizim Plan vs Müşteri Teslim Tarihi">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={futureLoad.months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v, name) => [formatMoney(v) + ' TL', name]}
                labelFormatter={(label, payload) => {
                  const p = payload && payload[0]?.payload;
                  if (!p) return label;
                  return `${label} · Plan: ${p.planCount} sip · Müşteri: ${p.musteriCount} sip`;
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="plan" name="Bizim Plan (override + ham)" fill="#2563eb" />
              <Bar dataKey="musteri" name="Müşteri Teslim Tarihi (orijinal)" fill="#ea580c" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: '#57534e', flexWrap: 'wrap' }}>
            <span>Toplam 6 aylık yük: <b style={{ color: '#ea580c' }}>Müşteri {formatMoney(futureLoad.totalMusteri)} TL</b> · <b style={{ color: '#2563eb' }}>Bizim plan {formatMoney(futureLoad.totalPlan)} TL</b></span>
            {futureLoad.totalMusteri > 0 && (
              <span>Fark: <b style={{ color: futureLoad.totalPlan > futureLoad.totalMusteri ? '#dc2626' : '#16a34a' }}>
                {futureLoad.totalPlan >= futureLoad.totalMusteri ? '+' : ''}{(((futureLoad.totalPlan - futureLoad.totalMusteri) / futureLoad.totalMusteri) * 100).toFixed(1)}%
              </b></span>
            )}
            {futureLoad.divergeCount > 0 && <span>{futureLoad.divergeCount} siparişte plan ≠ müşteri tarihi</span>}
          </div>
        </ChartCard>
      </div>

      {/* Alt sıra — operasyonel uyarılar */}
      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>⚠️ Operasyonel Uyarılar</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
          <AlertChip label="Geciken" count={ops.lateCount} sub={`${formatMoney(ops.lateBedel)} TL`} color="#dc2626" />
          <AlertChip label="VIO Termin Değişen" count={ops.staleCount} sub="override stale" color="#ca8a04" />
          <AlertChip label="Akibeti Belirsiz" count={ops.deferredCount} sub={`${formatMoney(ops.deferredBedel)} TL askıda`} color="#78716c" />
          <AlertChip label="İptal Edilen" count={ops.cancelledCount} sub="deferred + VIO'dan kayboldu" color="#475569" />
          <AlertChip label="BOM Eksik Ürün" count={ops.bomMissingCount} sub="MRP'de tanımlı değil" color="#9333ea" />
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#44403c', marginBottom: 6 }}>En Eski 5 Geciken Sipariş</div>
        {ops.top5OldestLate.length === 0 ? (
          <div style={{ fontSize: 11, color: '#a8a29e', padding: 8 }}>Geciken sipariş yok 🎉</div>
        ) : (
          <div style={{ background: '#fafaf9', borderRadius: 6, overflow: 'hidden' }}>
            {ops.top5OldestLate.map(o => {
              const b = customerBadge(o.customerCode);
              return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', fontSize: 11, borderBottom: '1px solid #f5f5f4' }}>
                  <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: b.bg, color: b.fg, minWidth: 28, textAlign: 'center' }}>{b.label}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, minWidth: 140 }}>{o.stokKodu}</span>
                  <span style={{ flex: 1, color: '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.stokAdi}</span>
                  <span style={{ color: '#dc2626', fontWeight: 600, minWidth: 80, textAlign: 'right' }}>{o.week}</span>
                  <span style={{ color: '#78716c', minWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(o.toplamBedel)} TL</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 10, color: '#a8a29e' }}>
          Sevk performansı VIO yüklemelerine göre yaklaşık değerdir — gerçek sevk tarihi yerine "VIO'dan kaybolduğu yükleme tarihi" baz alınır.
        </div>
        {isAdmin && (
          <button
            onClick={async () => {
              if (!confirm('Sevk geçmişi (shipments) tamamen silinsin mi?\n\nBu işlem ALT_RESET için yapılır — bir sonraki VIO yüklemesinde diff sıfırdan başlar.')) return;
              if (!confirm('EMİN MİSİN? Bu işlem geri alınamaz. Tüm shipment events silinecek.')) return;
              try {
                await resetShipments({ canEdit, isAdmin });
                alert('Shipments doc silindi. Bir sonraki yüklemede sıfırdan tekrar oluşur.');
              } catch (e) {
                alert('Sıfırlama başarısız: ' + (e.message || String(e)));
              }
            }}
            style={{
              padding: '4px 10px', fontSize: 10, borderRadius: 4,
              border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b',
              cursor: 'pointer',
            }}
            title="Geçici hotfix butonu — mail formatı parser bug'ından oluşan sahte event'leri temizler"
          >
            ⚠ Shipments Sıfırla (admin)
          </button>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon, title, primary, secondary, extra }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#57534e' }}>{title}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: '#1c1917', fontVariantNumeric: 'tabular-nums' }}>{primary}</div>
      <div style={{ fontSize: 13, color: '#44403c', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{secondary}</div>
      <div style={{ fontSize: 11, color: '#78716c', marginTop: 6 }}>{extra}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#44403c', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function AlertChip({ label, count, sub, color }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: '#fafaf9', border: '1px solid #e7e5e4' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 11, fontWeight: 500, color: '#57534e' }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 4 }}>{count}</div>
      <div style={{ fontSize: 10, color: '#78716c' }}>{sub}</div>
    </div>
  );
}

function EmptyHint() {
  return <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a8a29e', fontSize: 12 }}>Veri yok</div>;
}
