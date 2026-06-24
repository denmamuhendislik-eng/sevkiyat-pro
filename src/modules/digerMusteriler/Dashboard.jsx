import React, { useMemo, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts';
import { useSalesOrders, usePlanOverrides, useBomModels, useShipments } from './hooks';
import { resetShipments } from './firestore';
import { customerBadge, KNOWN_CUSTOMERS } from './customerMeta';
import { formatMoney } from '../../shared/moneyFormat';
import { getISOWeek, weeksBetween } from '../../shared/weekUtils';

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

  // Sevk Performansı modal — KPI kartına tıklayınca açılır.
  // dateRange: 'thisMonth' | 'last3Months' | 'all', status: 'all' | 'onTime' | 'late'
  const [shipmentModal, setShipmentModal] = useState(null);
  // ESC ile kapama
  useEffect(() => {
    if (!shipmentModal) return;
    const onKey = (e) => { if (e.key === 'Escape') setShipmentModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shipmentModal]);

  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => getISOWeek(today), [today]);
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthKey = monthKey(today);
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthKey = monthKey(prevMonthDate);

  // Müşteri filtresi — Aselsan/Roketsan/A+R/Tümü. Tüm hesaplar bu filtreden geçer.
  // Default A+R (kullanıcı kararı 2026-06-22): cari ekstre kapsamı.
  const [customerFilter, setCustomerFilter] = useState('AR');
  const customerMatches = useMemo(() => {
    return (customerCode) => {
      if (customerFilter === 'all') return true;
      const c = String(customerCode || '').trim();
      if (customerFilter === 'aselsan') return c === '120-0107' || c.startsWith('120-0107-');
      if (customerFilter === 'roketsan') return c === '120-116' || c.startsWith('120-116-');
      // AR (default): Aselsan veya Roketsan
      return c === '120-0107' || c.startsWith('120-0107-') || c === '120-116' || c.startsWith('120-116-');
    };
  }, [customerFilter]);

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
      if (!customerMatches(o.customerCode)) continue;
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
  }, [salesOrders, currentMonthKey, prevMonthKey, customerMatches]);

  // 2) Teslim yükü — bu hafta + 4 hafta sonrasına kadar (override veya orijinal teslim)
  const deliveryLoad = useMemo(() => {
    const buckets = {};
    for (let i = 0; i < 5; i++) buckets[`+${i}`] = { week: '', count: 0, bedel: 0 };
    let thisWeekCount = 0, thisWeekBedel = 0;
    let next4WeekCount = 0, next4WeekBedel = 0;
    for (const [id, o] of Object.entries(salesOrders || {})) {
      if (!customerMatches(o.customerCode)) continue;
      const ov = planOverrides?.[id];
      if (ov?.status === 'deferred') continue;
      const week = ov?.plannedWeek || (o.teslimTarihi ? getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z')) : '');
      if (!week) continue;
      const remaining = Number(o.kalanMiktar || 0);
      if (remaining <= 0) continue;
      const bedel = Number(o.toplamBedel || 0);
      if (week === currentWeek) { thisWeekCount++; thisWeekBedel += bedel; }
      const wkNum = parseInt(week.split('-W')[1] || '0');
      const curNum = parseInt(currentWeek.split('-W')[1] || '0');
      const diff = wkNum - curNum;
      if (diff >= 0 && diff <= 4) {
        next4WeekCount++; next4WeekBedel += bedel;
      }
    }
    return { thisWeekCount, thisWeekBedel, next4WeekCount, next4WeekBedel };
  }, [salesOrders, planOverrides, currentWeek, customerMatches]);

  // 3) Sevk performansı — cari ekstre (EKSTRE_*) kayıtlarından, musteriTermin bazlı.
  // KURAL (kullanıcı kararı 2026-06-22):
  //   - OTD = "tam teslim zamanında" (Seçenek A): siparişin tüm sevkleri tamamlandığında
  //     son sevk tarihi <= musteriTermin
  //   - musteriTermin: salesOrders'tan eşlenen termin (exact veya borrowed match)
  //   - Bu yıl içinde teslim edilen tamamlanmış siparişler OTD havuzu
  //   - İade satırları: sevk olarak sayılmaz, sadece toplam miktar düzeltir
  //   - Orphan (matchType === "orphan"): OTD'ye katılmaz
  //   - planOverrides deferred: havuza katılmaz
  const shipmentPerf = useMemo(() => {
    const currentYear = String(today.getFullYear());

    // RUNTIME LOOKUP — shipments doc'undaki cache'lenmiş matchedOrderId/musteriTermin'a
    // güvenme. VIO cron salesOrders'ı her gün değiştiriyor, cache stale olabiliyor.
    // Her dashboard render'ında refNo + stokKodu üzerinden salesOrders'tan canlı eşle.
    const orderIndex = {};      // (belgeNo|stokKodu) → [orders]
    const orderByBelgeNo = {};  // belgeNo → [orders]
    for (const [oid, o] of Object.entries(salesOrders || {})) {
      if (!o || !o.belgeNo || !o.stokKodu) continue;
      const belge = String(o.belgeNo).trim();
      const stok = String(o.stokKodu).trim();
      const key = `${belge}|${stok}`;
      if (!orderIndex[key]) orderIndex[key] = [];
      orderIndex[key].push({ id: oid, ...o });
      if (!orderByBelgeNo[belge]) orderByBelgeNo[belge] = [];
      orderByBelgeNo[belge].push({ id: oid, ...o });
    }
    const normalizeRefNo = (refNo) => {
      const s = String(refNo || '').trim();
      if (!s) return s;
      if (/^1000\d+$/.test(s)) {
        const n = Number(s.substring(4));
        if (Number.isFinite(n) && n > 0) return String(n);
      }
      return s;
    };
    const liveMatch = (refNo, stokKodu, ekstreTarih) => {
      const stok = String(stokKodu).trim();
      const raw = String(refNo).trim();
      const normalized = normalizeRefNo(refNo);
      const tryKeys = [raw, normalized].filter((v, i, a) => v && a.indexOf(v) === i);
      // 1) Exact
      for (const k of tryKeys) {
        const candidates = orderIndex[`${k}|${stok}`];
        if (candidates && candidates.length > 0) {
          if (candidates.length === 1) return { ...candidates[0], matchType: 'exact' };
          const sorted = [...candidates].sort((a, b) => (a.teslimTarihi || '9999').localeCompare(b.teslimTarihi || '9999'));
          const future = sorted.find(o => (o.teslimTarihi || '') >= ekstreTarih);
          return { ...(future || sorted[0]), matchType: 'exact' };
        }
      }
      // 2) Borrowed
      for (const k of tryKeys) {
        const fallbackList = orderByBelgeNo[k];
        if (fallbackList && fallbackList.length > 0) {
          const sorted = [...fallbackList].sort((a, b) => (a.teslimTarihi || '9999').localeCompare(b.teslimTarihi || '9999'));
          const future = sorted.find(o => (o.teslimTarihi || '') >= ekstreTarih);
          const chosen = future || sorted[0];
          return { ...chosen, id: null, matchType: 'borrowed' };
        }
      }
      return null;
    };

    // Sipariş bazlı topla — runtime match ile
    const byOrder = {};
    for (const sh of Object.values(shipments || {})) {
      if (!sh) continue;
      if (sh.source !== 'ekstre') continue;
      if (!customerMatches(sh.customerCode)) continue;
      // Live lookup (cache'a güvenmiyoruz)
      const matched = liveMatch(sh.refNo, sh.stokKodu, sh.teslimTarihi);
      if (!matched) continue; // orphan, OTD'ye katılmaz
      const liveMatchedOrderId = matched.id;
      const liveMusteriTermin = matched.teslimTarihi;
      const liveMatchType = matched.matchType;
      if (!liveMusteriTermin) continue;
      const groupKey = liveMatchedOrderId || `${(sh.refNo || '').trim()}|${(sh.stokKodu || '').trim()}`;
      if (!byOrder[groupKey]) byOrder[groupKey] = {
        groupKey,
        musteriTermin: liveMusteriTermin,
        matchType: liveMatchType,
        matchedOrderId: liveMatchedOrderId,
        customerCode: sh.customerCode,
        stokKodu: sh.stokKodu,
        belgeNo: sh.belgeNo,
        sevkQty: 0,
        iadeQty: 0,
        lastShipDate: '',
        firstShipDate: '',
      };
      const grp = byOrder[groupKey];
      const qty = Number(sh.totalShipped || 0);
      if (sh.isIade) grp.iadeQty += Math.abs(qty);
      else {
        grp.sevkQty += qty;
        if (!grp.lastShipDate || sh.teslimTarihi > grp.lastShipDate) grp.lastShipDate = sh.teslimTarihi;
        if (!grp.firstShipDate || sh.teslimTarihi < grp.firstShipDate) grp.firstShipDate = sh.teslimTarihi;
      }
    }
    // Her grup için: salesOrders'ta orijinalMiktar varsa tam teslim kontrolü
    const allFlat = [];
    let totalCompleted = 0, totalOnTime = 0, totalLate = 0;
    let totalLateDays = 0, lateCount = 0;
    let thisYearCompleted = 0, thisYearOnTime = 0;
    const flatLate = []; // geç olanlar listesi
    for (const grp of Object.values(byOrder)) {
      const order = grp.groupKey && grp.groupKey.includes('_') ? salesOrders?.[grp.groupKey] : null;
      const orijinalMiktar = Number(order?.orijinalMiktar || 0);
      const netSevk = grp.sevkQty - grp.iadeQty;
      // Tam teslim mi?
      //   - orijinalMiktar biliniyorsa: net sevk >= orijinal (küçük tolerans)
      //   - Bilinmiyorsa (salesOrders'ta yok): VIO'dan düşmüş = tam teslim varsayımı
      //     Hem exact hem borrowed match için geçerli — exact match'in matchedOrderId
      //     sonradan VIO cron ile salesOrders'tan kalkabilir (sipariş tam teslim olunca).
      const isCompleted = orijinalMiktar > 0
        ? netSevk >= orijinalMiktar - 0.01
        : true; // salesOrders'ta yok = muhtemelen tam teslim olup arşive düşmüş
      if (!isCompleted) continue;
      if (!grp.lastShipDate || !grp.musteriTermin) continue;
      const lastShip = grp.lastShipDate.substring(0, 10);
      const onTime = lastShip <= grp.musteriTermin;
      const item = {
        groupKey: grp.groupKey,
        customerCode: grp.customerCode,
        stokKodu: grp.stokKodu,
        belgeNo: grp.belgeNo,
        musteriTermin: grp.musteriTermin,
        firstShipDate: grp.firstShipDate,
        lastShipDate: grp.lastShipDate,
        sevkQty: grp.sevkQty,
        iadeQty: grp.iadeQty,
        netSevk,
        orijinalMiktar,
        onTime,
        matchType: grp.matchType,
        lateDays: onTime ? 0 : Math.round((new Date(lastShip).getTime() - new Date(grp.musteriTermin).getTime()) / 86400000),
      };
      allFlat.push(item);
      totalCompleted++;
      if (onTime) totalOnTime++;
      else {
        totalLate++;
        if (item.lateDays > 0) { totalLateDays += item.lateDays; lateCount++; }
        flatLate.push(item);
      }
      // Bu yıl içinde teslim edilenler
      if (grp.musteriTermin.startsWith(currentYear)) {
        thisYearCompleted++;
        if (onTime) thisYearOnTime++;
      }
    }
    const otdPct = totalCompleted > 0 ? (totalOnTime / totalCompleted) * 100 : null;
    const thisYearOtdPct = thisYearCompleted > 0 ? (thisYearOnTime / thisYearCompleted) * 100 : null;
    const avgLateDays = lateCount > 0 ? totalLateDays / lateCount : null;
    // Geç olanları gecikme günü büyükten küçüğe sırala
    flatLate.sort((a, b) => b.lateDays - a.lateDays);
    return {
      totalCompleted, totalOnTime, totalLate, otdPct, avgLateDays,
      thisYearCompleted, thisYearOnTime, thisYearOtdPct,
      allFlat, flatLate,
    };
  }, [shipments, salesOrders, today, customerMatches]);

  // 4) Müşteri bedel pastası — top 5 (yıllık toplam)
  const customerPie = useMemo(() => {
    const map = {};
    for (const o of Object.values(salesOrders || {})) {
      if (!customerMatches(o.customerCode)) continue;
      const cc = o.customerCode || '?';
      if (!map[cc]) map[cc] = { code: cc, name: o.customerName || cc, value: 0 };
      map[cc].value += Number(o.toplamBedel || 0);
    }
    const arr = Object.values(map).sort((a, b) => b.value - a.value).slice(0, 5);
    return arr;
  }, [salesOrders, customerMatches]);

  // 5) Aylık trend — son 6 ay: Alındı + Brüt Sevk + İade + Net Sevk (4 seri)
  // Cari ekstre EKSTRE_* kayıtları için toplamBedel zaten TL net (iade negatif).
  // Brüt = sadece positive toplamBedel, İade = negatif olanların abs, Net = Brüt - İade.
  const monthlyTrend = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({
        key: monthKey(d),
        label: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][d.getMonth()] + ' ' + String(d.getFullYear()).slice(2),
        alindi: 0, brut: 0, iade: 0, net: 0,
      });
    }
    const map = Object.fromEntries(months.map(m => [m.key, m]));
    // Alındı (orderDate) — VIO sipariş raporundan
    for (const o of Object.values(salesOrders || {})) {
      if (!o.orderDate) continue;
      if (!customerMatches(o.customerCode)) continue;
      const k = o.orderDate.substring(0, 7);
      if (map[k]) map[k].alindi += Number(o.toplamBedel || 0);
    }
    // Sevk + İade ayrı — EKSTRE_ kayıtları toplamBedel'i kullan (iadelerde negatif)
    const missing = [];
    for (const [id, sh] of Object.entries(shipments || {})) {
      if (!sh) continue;
      if (!customerMatches(sh.customerCode)) continue;
      const bedel = Number(sh.toplamBedel || 0);
      const dateRef = sh.finalShipAt || sh.firstShipAt || sh.lastUpdate || "";
      const k = String(dateRef).substring(0, 7);
      if (!map[k]) continue;
      if (sh.source === 'ekstre' && bedel !== 0) {
        if (sh.isIade || bedel < 0) {
          map[k].iade += Math.abs(bedel);
        } else {
          map[k].brut += bedel;
        }
        continue;
      }
      // Fallback: ekstre olmayan kayıtlar için eski mantık (unitPrice × totalShipped)
      const shipped = Number(sh?.totalShipped || 0);
      if (shipped <= 0) continue;
      let unitPrice = Number(sh?.unitPriceTl) || 0;
      if (!unitPrice) {
        const so = salesOrders?.[id];
        const orjMikt = Number(so?.orijinalMiktar || 0);
        const toplamBedel = Number(so?.toplamBedel || 0);
        if (orjMikt > 0 && toplamBedel > 0) unitPrice = toplamBedel / orjMikt;
      }
      if (unitPrice <= 0) {
        missing.push({
          id, stokKodu: sh.stokKodu || "", stokAdi: sh.stokAdi || "",
          belgeNo: sh.belgeNo || "", customerCode: sh.customerCode || "",
          totalShipped: shipped, finalShipAt: dateRef, monthKey: k,
        });
        continue;
      }
      map[k].brut += shipped * unitPrice;
    }
    for (const m of months) m.net = m.brut - m.iade;
    return { months, missing };
  }, [salesOrders, shipments, today, customerMatches]);

  // monthlyTrend artık { months, missing } döndürüyor; eski .map için months ayır
  const monthlyTrendMonths = monthlyTrend.months;
  const monthlyTrendMissing = monthlyTrend.missing;

  // Orphan ekstre kayıtları — salesOrders'ta eşleşmesi bulunamayan ekstre sevkleri
  // (büyük ihtimalle tam teslim olup VIO'dan düşmüş eski siparişler).
  // Termin bilgisi yok → OTD'ye katılmıyor. Audit listesinde görünür.
  const orphanShipments = useMemo(() => {
    // Runtime lookup — shipments.matchType cache'ine güvenme
    const orderIndex = {};
    const orderByBelgeNo = {};
    for (const [oid, o] of Object.entries(salesOrders || {})) {
      if (!o || !o.belgeNo || !o.stokKodu) continue;
      const belge = String(o.belgeNo).trim();
      const stok = String(o.stokKodu).trim();
      orderIndex[`${belge}|${stok}`] = true;
      orderByBelgeNo[belge] = true;
    }
    const normalizeRefNo = (refNo) => {
      const s = String(refNo || '').trim();
      if (!s) return s;
      if (/^1000\d+$/.test(s)) {
        const n = Number(s.substring(4));
        if (Number.isFinite(n) && n > 0) return String(n);
      }
      return s;
    };
    const isMatched = (refNo, stokKodu) => {
      const stok = String(stokKodu).trim();
      const raw = String(refNo).trim();
      const normalized = normalizeRefNo(refNo);
      const tryKeys = [raw, normalized].filter((v, i, a) => v && a.indexOf(v) === i);
      for (const k of tryKeys) {
        if (orderIndex[`${k}|${stok}`]) return true;
        if (orderByBelgeNo[k]) return true;
      }
      return false;
    };
    const list = [];
    let totalBedel = 0;
    for (const [id, sh] of Object.entries(shipments || {})) {
      if (sh?.source !== 'ekstre') continue;
      if (!customerMatches(sh.customerCode)) continue;
      if (isMatched(sh.refNo, sh.stokKodu)) continue; // eşleşme var, orphan değil
      list.push({ id, ...sh });
      totalBedel += Math.abs(Number(sh.toplamBedel || 0));
    }
    list.sort((a, b) => (b.teslimTarihi || '').localeCompare(a.teslimTarihi || ''));
    return { list, totalBedel, count: list.length };
  }, [shipments, salesOrders, customerMatches]);

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
    // Ortalama hafta kayması — plan ile müşteri teslim haftası arası fark.
    // Pozitif = plan ileride (geç teslimat), negatif = plan geride (erken teslimat).
    // Sadece sapan siparişler dahil (eşit olanlar ortalamayı sıfıra çekmesin).
    let totalDriftWeeks = 0, driftCount = 0;
    for (const [id, o] of Object.entries(salesOrders || {})) {
      if (!customerMatches(o.customerCode)) continue;
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
      if (planKey && musteriKey && planKey !== musteriKey) {
        divergeCount++;
        // Hafta cinsinden kayma hesabı
        const planWeek = ov?.plannedWeek || (musteriDateStr ? getISOWeek(new Date(musteriDateStr + 'T00:00:00Z')) : '');
        const musteriWeek = musteriDateStr ? getISOWeek(new Date(musteriDateStr + 'T00:00:00Z')) : '';
        if (planWeek && musteriWeek) {
          const diff = weeksBetween(musteriWeek, planWeek);
          if (Number.isFinite(diff)) {
            totalDriftWeeks += diff;
            driftCount++;
          }
        }
      }
    }
    const avgDriftWeeks = driftCount > 0 ? totalDriftWeeks / driftCount : 0;
    return { months, totalPlan, totalMusteri, divergeCount, avgDriftWeeks, driftCount };
  }, [salesOrders, planOverrides, today, customerMatches]);

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
      if (!customerMatches(o.customerCode)) continue;
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
  }, [salesOrders, planOverrides, bomSet, currentWeek, customerMatches]);

  // 7) Yıl Başından Beri (YTD) toplamlar + aylık ortalama
  // Alındı: salesOrders.orderDate bu yıl olanlar
  // Brüt/İade/Net: shipments EKSTRE_ kayıtlardan (cari ekstre = authoritative)
  // Aylık ortalama = toplam / geçen ay sayısı (içinde bulunulan ay dahil)
  const ytdStats = useMemo(() => {
    const currentYear = String(today.getFullYear());
    const monthsElapsed = today.getMonth() + 1; // 1-12 (Ocak=1, Haziran=6, vs.)
    let orderCount = 0, orderBedel = 0;
    let brutSevk = 0, iadeBedel = 0;
    for (const o of Object.values(salesOrders || {})) {
      if (!customerMatches(o.customerCode)) continue;
      if (!o.orderDate || !o.orderDate.startsWith(currentYear)) continue;
      orderCount++;
      orderBedel += Number(o.toplamBedel || 0);
    }
    for (const sh of Object.values(shipments || {})) {
      if (!sh) continue;
      if (sh.source !== 'ekstre') continue;
      if (!customerMatches(sh.customerCode)) continue;
      const dateRef = sh.finalShipAt || sh.firstShipAt || sh.teslimTarihi || '';
      if (!String(dateRef).startsWith(currentYear)) continue;
      const bedel = Number(sh.toplamBedel || 0);
      if (sh.isIade || bedel < 0) iadeBedel += Math.abs(bedel);
      else brutSevk += bedel;
    }
    const netSevk = brutSevk - iadeBedel;
    const avgOrderBedel = monthsElapsed > 0 ? orderBedel / monthsElapsed : 0;
    const avgBrutSevk = monthsElapsed > 0 ? brutSevk / monthsElapsed : 0;
    const avgIade = monthsElapsed > 0 ? iadeBedel / monthsElapsed : 0;
    const avgNetSevk = monthsElapsed > 0 ? netSevk / monthsElapsed : 0;
    const avgOrderCount = monthsElapsed > 0 ? orderCount / monthsElapsed : 0;
    return {
      orderCount, orderBedel, brutSevk, iadeBedel, netSevk,
      avgOrderCount, avgOrderBedel, avgBrutSevk, avgIade, avgNetSevk,
      monthsElapsed, currentYear,
    };
  }, [salesOrders, shipments, today, customerMatches]);

  if (!allLoaded) {
    return <div style={{ padding: 24, color: '#78716c' }}>Dashboard yükleniyor…</div>;
  }

  const PIE_COLORS = ['#534AB7', '#0891B2', '#16a34a', '#ea580c', '#a855f7'];

  return (
    <div style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>📊 Müşteri Sipariş Dashboard</h1>
        <span style={{ fontSize: 11, color: '#a8a29e' }}>Bugün {currentWeek}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ color: '#57534e', fontWeight: 500, marginRight: 4 }}>Müşteri:</span>
          {[
            { v: 'AR', label: 'Aselsan + Roketsan' },
            { v: 'aselsan', label: 'Aselsan' },
            { v: 'roketsan', label: 'Roketsan' },
            { v: 'all', label: 'Tümü' },
          ].map(opt => (
            <button
              key={opt.v}
              onClick={() => setCustomerFilter(opt.v)}
              style={{
                padding: '5px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                border: '1px solid ' + (customerFilter === opt.v ? '#534AB7' : '#d6d3d1'),
                background: customerFilter === opt.v ? '#534AB7' : '#fff',
                color: customerFilter === opt.v ? '#fff' : '#44403c',
                cursor: 'pointer',
              }}
            >{opt.label}</button>
          ))}
        </div>
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
          info={
`Veri kaynağı: salesOrders.orderDate

• Bu ay sipariş = orderDate'i bu ay olan tüm satırlar (deferred dahil)
• Bedel = toplamBedel (kdv hariç) toplamı
• Geçen aya göre %: (bu ay − geçen ay) / geçen ay × 100`}
        />
        <KpiCard
          icon="🚚" title="Teslim Yükü"
          primary={`Bu hafta: ${deliveryLoad.thisWeekCount} sipariş`}
          secondary={`${formatMoney(deliveryLoad.thisWeekBedel)} TL`}
          extra={`Önümüzdeki 4 hafta: ${deliveryLoad.next4WeekCount} sipariş · ${formatMoney(deliveryLoad.next4WeekBedel)} TL`}
          info={
`Veri kaynağı: salesOrders + planOverrides
• Effective hafta: override.plannedWeek varsa o, yoksa VIO teslim tarihinden ISO hafta
• Akibeti Belirsiz olanlar dahil değil

• Bu hafta: aktif siparişlerden effective haftası bu hafta olanlar
• Önümüzdeki 4 hafta: bu hafta + sonraki 3`}
        />
        <KpiCard
          onClick={() => setShipmentModal({ dateRange: 'thisYear', status: 'all' })}
          icon="✅" title="Sevk Performansı (OTD)"
          primary={shipmentPerf.thisYearOtdPct !== null ? `%${shipmentPerf.thisYearOtdPct.toFixed(0)} zamanında` : 'Veri yok'}
          secondary={`Bu yıl ${shipmentPerf.thisYearCompleted} tam teslim · ${shipmentPerf.thisYearCompleted - shipmentPerf.thisYearOnTime} gecikmeli`}
          extra={shipmentPerf.avgLateDays !== null
            ? `Tümü: ${shipmentPerf.totalCompleted} tam teslim · ortalama ${shipmentPerf.avgLateDays.toFixed(1)} gün gecikme`
            : `Tümü: ${shipmentPerf.totalCompleted} tam teslim`}
          info={
`Veri kaynağı: shipments doc (cari ekstre EKSTRE_ kayıtları + salesOrders termin eşlemesi)

Hesap (kullanıcı kararı 2026-06-22 — Seçenek A: tam teslim zamanında):
• OTD = (zamanında tam teslim edilen sipariş) / (toplam tam teslim edilen)
• "Zamanında" = son positive sevk tarihi ≤ müşteri termini
• "Tam teslim" = net sevk (sevk − iade) ≥ orijinal miktar (exact match) veya borrowed match (eski sipariş)

Eşleme türleri:
• Exact = cari ekstre refNo + stokKodu → salesOrders.belgeNo birebir
• Borrowed = aynı belgenin başka satırından termin ödünç (sipariş tamamlanmış)
• Orphan = eşleşme yok, OTD'ye katılmaz (audit listesinde)

KPI:
• Bu yıl OTD = teslim tarihi ${today.getFullYear()} olan tam teslimler
• Tümü = tüm tarihler dahil`}
        />
      </div>

      {/* İkinci sıra — Yıl Başından Beri (YTD) toplamlar + aylık ortalama */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard
          icon="📋" title={`Toplam Alınan Sipariş (${ytdStats.currentYear})`}
          primary={`${ytdStats.orderCount} sipariş`}
          secondary={`${formatMoney(ytdStats.orderBedel)} TL`}
          extra={
            <span style={{ color: '#534AB7', fontWeight: 500 }}>
              Aylık ort: {ytdStats.avgOrderCount.toFixed(1)} sipariş · {formatMoney(ytdStats.avgOrderBedel)} TL
            </span>
          }
          info={
`Veri kaynağı: salesOrders.orderDate ${ytdStats.currentYear} olan kayıtlar

• Toplam = yıl başından bugüne tüm siparişler (deferred dahil)
• Bedel = toplamBedel toplamı
• Aylık ort = toplam / geçen ay sayısı (${ytdStats.monthsElapsed} ay)
• Müşteri filtresi (üst sağ) uygulanır`}
        />
        <KpiCard
          icon="✅" title={`Net Sevk (${ytdStats.currentYear})`}
          primary={`${formatMoney(ytdStats.netSevk)} TL`}
          secondary={`Brüt ${formatMoney(ytdStats.brutSevk)} − İade ${formatMoney(ytdStats.iadeBedel)}`}
          extra={
            <span style={{ color: '#16a34a', fontWeight: 500 }}>
              Aylık ort: {formatMoney(ytdStats.avgNetSevk)} TL
            </span>
          }
          info={
`Veri kaynağı: cari ekstre EKSTRE_* kayıtları (source='ekstre')

• Brüt = positive sevk toplamı
• İade = negatif satırların mutlak değeri
• Net = Brüt − İade
• Tarih: finalShipAt veya teslimTarihi (cari fatura tarihi)
• Aylık ort = net / ${ytdStats.monthsElapsed} ay`}
        />
        <KpiCard
          icon="↩️" title={`İade (${ytdStats.currentYear})`}
          primary={`${formatMoney(ytdStats.iadeBedel)} TL`}
          secondary={ytdStats.brutSevk > 0
            ? `Brüt sevkin %${((ytdStats.iadeBedel / ytdStats.brutSevk) * 100).toFixed(1)}'i`
            : 'Brüt sevk yok'}
          extra={
            <span style={{ color: '#dc2626', fontWeight: 500 }}>
              Aylık ort: {formatMoney(ytdStats.avgIade)} TL
            </span>
          }
          info={
`Veri kaynağı: cari ekstre EKSTRE_* kayıtlardan isIade=true veya negatif toplamBedel

• İade TL = sevk faturasının ters yönü
• Oran = iade / brüt sevk × 100
• Aylık ort = iade / ${ytdStats.monthsElapsed} ay`}
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
        <ChartCard title="Aylık Trend — Alındı / Brüt Sevk / İade / Net Sevk (Son 6 Ay)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyTrendMonths} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatMoney(v) + ' TL'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="alindi" name="Alındı" fill="#534AB7" />
              <Bar dataKey="brut" name="Brüt Sevk" fill="#16a34a" />
              <Bar dataKey="iade" name="İade" fill="#dc2626" />
              <Bar dataKey="net" name="Net Sevk" fill="#0891b2" />
            </BarChart>
          </ResponsiveContainer>
          {monthlyTrendMissing.length > 0 && (
            <div
              title={monthlyTrendMissing.slice(0, 30).map(m =>
                `• ${m.stokKodu} (${m.belgeNo}) → ${m.totalShipped} ad · ${m.monthKey || '-'}`
              ).join("\n") + (monthlyTrendMissing.length > 30 ? `\n... ve ${monthlyTrendMissing.length - 30} kayıt daha` : "")}
              style={{
                marginTop: 8, padding: "6px 10px", background: "#FFFBEB",
                border: "1px solid #FCD34D", borderRadius: 6,
                fontSize: 10, color: "#92400E", cursor: "help",
              }}
            >
              ⚠ {monthlyTrendMissing.length} sevk için fiyat bulunamadı (toplam{" "}
              {monthlyTrendMissing.reduce((s, m) => s + (m.totalShipped || 0), 0)} adet) —
              grafik TL toplamına dahil değil. Üzerine gel: detaylar.
            </div>
          )}
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
            {futureLoad.driftCount > 0 && (
              <span>
                Ortalama plan kayması:{' '}
                <b style={{
                  color: futureLoad.avgDriftWeeks > 0.05 ? '#dc2626'
                    : futureLoad.avgDriftWeeks < -0.05 ? '#16a34a' : '#78716c',
                }}>
                  {futureLoad.avgDriftWeeks > 0 ? '+' : ''}{futureLoad.avgDriftWeeks.toFixed(1)} hafta
                  {futureLoad.avgDriftWeeks > 0.05 ? ' (geç)' : futureLoad.avgDriftWeeks < -0.05 ? ' (erken)' : ''}
                </b>
              </span>
            )}
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

      {/* Orphan ekstre sevkleri — salesOrders'ta eşleşme yok (büyük ihtimalle tam teslim
          olup VIO'dan düşmüş eski sipariş). Termin bilgisi yok → OTD'ye katılmıyor. */}
      {orphanShipments.count > 0 && (
        <div style={{ marginTop: 12, background: '#fff', border: '1px solid #fde68a', borderRadius: 8, padding: 14 }}>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#92400e' }}>
              ❓ Eşleşmeyen Cari Ekstre Sevkleri ({orphanShipments.count} kayıt · {formatMoney(orphanShipments.totalBedel)} TL)
              <span style={{ fontSize: 11, fontWeight: 400, color: '#a16207', marginLeft: 8 }}>
                — salesOrders'ta refNo bulunamadı (muhtemelen tam teslim olup arşive düşen eski siparişler)
              </span>
            </summary>
            <div style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto', background: '#fffbeb', borderRadius: 6, fontSize: 11 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#fef3c7', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#78350f' }}>Sevk Tarihi</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#78350f' }}>Müşteri</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#78350f' }}>Fatura</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#78350f' }}>Ref No</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#78350f' }}>Stok Kodu</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#78350f' }}>Miktar</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#78350f' }}>Tutar TL</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#78350f' }}>Tip</th>
                  </tr>
                </thead>
                <tbody>
                  {orphanShipments.list.slice(0, 200).map(sh => {
                    const b = customerBadge(sh.customerCode);
                    return (
                      <tr key={sh.id} style={{ borderBottom: '1px solid #fef3c7' }}>
                        <td style={{ padding: '4px 8px', color: '#92400e', fontVariantNumeric: 'tabular-nums' }}>{sh.teslimTarihi}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: b.bg, color: b.fg }}>{b.label}</span>
                        </td>
                        <td style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace', color: '#57534e' }}>{sh.belgeNo}</td>
                        <td style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace', color: '#57534e' }}>{sh.refNo}</td>
                        <td style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace' }}>{sh.stokKodu}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: sh.isIade ? '#dc2626' : '#44403c' }}>
                          {sh.totalShipped}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: sh.isIade ? '#dc2626' : '#44403c' }}>
                          {formatMoney(Math.abs(sh.toplamBedel || 0))}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: 9, color: sh.isIade ? '#dc2626' : '#16a34a' }}>
                          {sh.isIade ? 'İADE' : 'SEVK'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {orphanShipments.list.length > 200 && (
                <div style={{ padding: 8, textAlign: 'center', color: '#a16207', fontSize: 10 }}>
                  ... ve {orphanShipments.list.length - 200} kayıt daha
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 10, color: '#a8a29e' }}>
          Sevk performansı = cari ekstre kayıtları + salesOrders termin eşlemesi. Orphan kayıtlar OTD'ye dahil değildir.
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

      {/* Sevk Performansı Detay Modal — KPI kartına tıklayınca açılır.
          Veri: shipmentPerf.allFlat (cari ekstre + salesOrders termin eşlemesi). */}
      {shipmentModal && (() => {
        const last3MonthsCutoff = (() => {
          const d = new Date(today.getFullYear(), today.getMonth() - 2, 1);
          return d.toISOString().substring(0, 10);
        })();
        const currentYear = String(today.getFullYear());
        const rows = [];
        for (const r of shipmentPerf.allFlat) {
          const termin = (r.musteriTermin || '').substring(0, 10);
          if (!termin) continue;
          if (shipmentModal.dateRange === 'thisMonth') {
            if (termin.substring(0, 7) !== currentMonthKey) continue;
          } else if (shipmentModal.dateRange === 'last3Months') {
            if (termin < last3MonthsCutoff) continue;
          } else if (shipmentModal.dateRange === 'thisYear') {
            if (!termin.startsWith(currentYear)) continue;
          }
          if (shipmentModal.status === 'onTime' && !r.onTime) continue;
          if (shipmentModal.status === 'late' && r.onTime) continue;
          rows.push(r);
        }
        rows.sort((a, b) => (b.lateDays || 0) - (a.lateDays || 0));
        const totalCount = rows.length;
        const lateCount = rows.filter(r => !r.onTime).length;
        const onTimeCount = totalCount - lateCount;
        const avgLate = lateCount > 0 ? rows.filter(r => !r.onTime).reduce((s, r) => s + (r.lateDays || 0), 0) / lateCount : 0;

        const dateLabel = shipmentModal.dateRange === 'thisMonth' ? 'Bu Ay'
          : shipmentModal.dateRange === 'last3Months' ? 'Son 3 Ay'
          : shipmentModal.dateRange === 'thisYear' ? `${currentYear} Yılı` : 'Tümü';

        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShipmentModal(null); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.45)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}
          >
            <div style={{
              background: '#fff', borderRadius: 10, padding: 0,
              maxWidth: 1100, width: '100%', maxHeight: '90vh',
              boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Başlık + kapat */}
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid #e7e5e4',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 20 }}>✅</span>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#166534' }}>Sevk Performansı Detay</h3>
                <span style={{ fontSize: 11, color: '#78716c' }}>
                  {totalCount} kayıt · {onTimeCount} zamanında · {lateCount} gecikmeli
                  {lateCount > 0 && ` · ortalama ${avgLate.toFixed(1)} gün gecikme`}
                </span>
                <button
                  onClick={() => setShipmentModal(null)}
                  style={{
                    marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, fontSize: 12,
                    border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                  }}
                >Kapat ✕</button>
              </div>

              {/* Filtre satırı */}
              <div style={{
                padding: '10px 20px', borderBottom: '1px solid #e7e5e4',
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12,
              }}>
                <span style={{ color: '#57534e', fontWeight: 500 }}>Tarih:</span>
                {[
                  { v: 'thisMonth', label: 'Bu Ay' },
                  { v: 'last3Months', label: 'Son 3 Ay' },
                  { v: 'thisYear', label: `${today.getFullYear()} Yılı` },
                  { v: 'all', label: 'Tümü' },
                ].map(opt => (
                  <button
                    key={opt.v}
                    onClick={() => setShipmentModal({ ...shipmentModal, dateRange: opt.v })}
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                      border: '1px solid ' + (shipmentModal.dateRange === opt.v ? '#534AB7' : '#d6d3d1'),
                      background: shipmentModal.dateRange === opt.v ? '#534AB7' : '#fff',
                      color: shipmentModal.dateRange === opt.v ? '#fff' : '#44403c',
                      cursor: 'pointer',
                    }}
                  >{opt.label}</button>
                ))}
                <span style={{ color: '#57534e', fontWeight: 500, marginLeft: 14 }}>Durum:</span>
                {[
                  { v: 'all', label: 'Tümü' },
                  { v: 'onTime', label: 'Zamanında' },
                  { v: 'late', label: 'Gecikmeli' },
                ].map(opt => (
                  <button
                    key={opt.v}
                    onClick={() => setShipmentModal({ ...shipmentModal, status: opt.v })}
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                      border: '1px solid ' + (shipmentModal.status === opt.v ? '#534AB7' : '#d6d3d1'),
                      background: shipmentModal.status === opt.v ? '#534AB7' : '#fff',
                      color: shipmentModal.status === opt.v ? '#fff' : '#44403c',
                      cursor: 'pointer',
                    }}
                  >{opt.label}</button>
                ))}
              </div>

              {/* Tablo */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
                {rows.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                    {dateLabel} aralığında bu filtre ile sevk kaydı yok
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#f5f5f4', zIndex: 1 }}>
                      <tr style={{ fontSize: 10, color: '#57534e', textAlign: 'left' }}>
                        <th style={shTh}>Müş</th>
                        <th style={shTh}>Sipariş Belge</th>
                        <th style={shTh}>Stok Kodu</th>
                        <th style={{ ...shTh, textAlign: 'right' }}>Orjinal</th>
                        <th style={{ ...shTh, textAlign: 'right' }}>Sevk</th>
                        <th style={{ ...shTh, textAlign: 'right' }}>İade</th>
                        <th style={{ ...shTh, textAlign: 'right' }}>Net</th>
                        <th style={shTh}>İlk Sevk</th>
                        <th style={shTh}>Son Sevk</th>
                        <th style={shTh}>Müş. Termin</th>
                        <th style={shTh}>Eşleme</th>
                        <th style={{ ...shTh, textAlign: 'right' }}>Gecikme</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const b = customerBadge(r.customerCode);
                        const lateDays = r.lateDays || 0;
                        return (
                          <tr key={r.groupKey} style={{ borderTop: '1px solid #f5f5f4' }}>
                            <td style={shTd}>
                              <span style={{
                                padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                                background: b.bg, color: b.fg, minWidth: 28, display: 'inline-block', textAlign: 'center',
                              }}>{b.label}</span>
                            </td>
                            <td style={{ ...shTd, fontFamily: 'ui-monospace, monospace' }}>{r.belgeNo}</td>
                            <td style={{ ...shTd, fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>{r.stokKodu}</td>
                            <td style={{ ...shTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#78716c' }}>{r.orijinalMiktar || '-'}</td>
                            <td style={{ ...shTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.sevkQty}</td>
                            <td style={{ ...shTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.iadeQty > 0 ? '#dc2626' : '#a8a29e' }}>
                              {r.iadeQty || '-'}
                            </td>
                            <td style={{ ...shTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{r.netSevk}</td>
                            <td style={{ ...shTd, color: '#78716c' }}>{r.firstShipDate}</td>
                            <td style={shTd}>{r.lastShipDate}</td>
                            <td style={{ ...shTd, color: '#78716c' }}>{r.musteriTermin}</td>
                            <td style={{ ...shTd, fontSize: 9 }}>
                              <span style={{
                                padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                                background: r.matchType === 'exact' ? '#dcfce7' : '#fef3c7',
                                color: r.matchType === 'exact' ? '#166534' : '#92400e',
                              }}>{r.matchType === 'exact' ? 'TAM' : 'ÖDÜNÇ'}</span>
                            </td>
                            <td style={{
                              ...shTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                              color: !r.onTime ? '#dc2626' : '#16a34a',
                            }}>
                              {!r.onTime ? `+${lateDays} gün` : (lateDays === 0 ? 'tam zamanında' : `${Math.abs(lateDays)} gün önce`)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer not */}
              <div style={{
                padding: '8px 20px', borderTop: '1px solid #e7e5e4',
                fontSize: 10, color: '#a8a29e',
              }}>
                Veri kaynağı: cari ekstre EKSTRE_* kayıtları + salesOrders termin eşlemesi.
                TAM = refNo + stokKodu birebir eşleşti. ÖDÜNÇ = aynı belgenin başka satırından termin alındı (sipariş tamamlanmış).
                Orphan kayıtlar (eşleşme yok) bu listede gösterilmez — ayrı bölümde audit listesinde.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const shTh = { padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #e7e5e4', fontSize: 10 };
const shTd = { padding: '6px 10px', fontSize: 11 };

function KpiCard({ icon, title, primary, secondary, extra, info, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, padding: 14,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={clickable ? (e) => {
        e.currentTarget.style.borderColor = '#534AB7';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(83,74,183,0.15)';
      } : undefined}
      onMouseLeave={clickable ? (e) => {
        e.currentTarget.style.borderColor = '#e7e5e4';
        e.currentTarget.style.boxShadow = 'none';
      } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#57534e' }}>{title}</span>
        {clickable && (
          <span style={{ fontSize: 10, color: '#7e22ce', fontWeight: 600 }}>tıkla → detay</span>
        )}
        {info && (
          <span
            title={info}
            onClick={(e) => e.stopPropagation()}
            style={{
              marginLeft: 'auto', fontSize: 11, color: '#a8a29e', cursor: 'help',
              border: '1px solid #d6d3d1', borderRadius: '50%',
              width: 14, height: 14, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              fontWeight: 600, fontStyle: 'italic', userSelect: 'none',
            }}
          >i</span>
        )}
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
