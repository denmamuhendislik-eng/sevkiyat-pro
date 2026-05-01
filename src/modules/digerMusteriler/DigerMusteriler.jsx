import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSalesOrders, usePlanOverrides, useBomModels, useShipments, useAutomationLog, useWeekGroupedOrders, groupByBelgeNo } from './hooks';
import { saveSalesOrders, savePlanOverride, savePlanOverrides, removePlanOverride, saveShipments } from './firestore';
import { parseSalesOrderExcel } from './parser';
import { customerBadge, KNOWN_CUSTOMERS } from './customerMeta';
import { getISOWeek, getWeekMonday, formatDateShort, weeksBetween, nextIsoWeek } from '../../shared/weekUtils';
import { formatMoney } from '../../shared/moneyFormat';

// Sipariş listesinin AD (kalan miktar) + TL (toplam bedel) toplamı.
// Hafta başlıklarında özet göstermek için.
function weekTotals(orders) {
  let ad = 0, tl = 0;
  for (const o of orders || []) {
    ad += Number(o.kalanMiktar || 0);
    tl += Number(o.toplamBedel || 0);
  }
  return { ad, tl };
}

// Override badge'i için kompakt "Wxx" formatı (yıl prefix'i atlanır).
function shortWeek(isoWeek) {
  if (!isoWeek) return '—';
  const m = String(isoWeek).match(/W(\d{1,2})$/);
  return m ? `W${m[1]}` : isoWeek;
}

export default function DigerMusteriler({ isAdmin, isUretim, isSales, onNavigateToMrp }) {
  const canEdit = !!(isAdmin || isUretim || isSales);
  const role = isAdmin ? 'admin' : isSales ? 'satis' : (isUretim ? 'üretim' : 'bilinmiyor');

  const { salesOrders, loaded: ordersLoaded } = useSalesOrders();
  const { planOverrides, loaded: overridesLoaded } = usePlanOverrides();
  const { bomModels, loaded: bomLoaded } = useBomModels();
  const { shipments } = useShipments();
  const { automationLog } = useAutomationLog();

  // Son salesOrders başarılı çalıştırması — rozet için.
  // automationLog.entries içinde sondan başa tarayıp salesOrders ok olan en yeni entry'yi bulur.
  // Manuel yükleme automationLog'a yazılmaz; bu rozet sadece mail otomasyon zamanını yansıtır.
  const lastSalesUpdate = useMemo(() => {
    const entries = automationLog?.entries || [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const so = (entry?.results || []).find(r => r.type === 'salesOrders' && r.status === 'ok');
      if (so) return { runAt: entry.runAt, source: entry.source, summary: so.summary };
    }
    // Hiç ok yoksa son entry'i (hata durumu) döndür
    if (entries.length > 0) {
      const last = entries[entries.length - 1];
      const so = (last?.results || []).find(r => r.type === 'salesOrders');
      if (so) return { runAt: last.runAt, source: last.source, status: so.status, error: so.error };
    }
    return null;
  }, [automationLog]);

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const [customerFilter, setCustomerFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState('date');
  const [lateExpanded, setLateExpanded] = useState(false);
  const [deferredExpanded, setDeferredExpanded] = useState(false);
  const [staleExpanded, setStaleExpanded] = useState(false);
  const [orphanExpanded, setOrphanExpanded] = useState(false);
  const [inconsistentExpanded, setInconsistentExpanded] = useState(false);
  // viewMode: 'orders' (default sipariş listesi) | 'products' (stok bazlı agregasyon tablosu)
  const [viewMode, setViewMode] = useState('orders');
  const [productSort, setProductSort] = useState({ col: 'tutar', dir: 'desc' });

  // Picker: null | { orderId, anchorX, anchorY, origWeek, currentPlanWeek }
  const [picker, setPicker] = useState(null);

  // Toplu işlemler — Planı Temizle ve Otomatik Plan modal state'leri (admin-only feature).
  // clearPlanModal: null | { count: silinecek manuel hafta override sayısı, processing: bool }
  // autoPlanModal: null | { view: 'form'|'preview', startWeek, monthlyBudget, customerFilter,
  //                          includeLate, suggestions: [], processing: bool }
  const [clearPlanModal, setClearPlanModal] = useState(null);
  const [autoPlanModal, setAutoPlanModal] = useState(null);

  // Bir sonraki hafta hesaplama — otomatik plan startWeek default'u için.
  const nextWeekIso = useMemo(() => {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() + 7);
    return getISOWeek(now);
  }, []);

  // ConflictModal: null | { orderId, targetWeek, conflicts, ourOrder, resolve, view, suggestions }
  // view: 'warning' (default) | 'preview' (otomatik sıralama önerisi)
  // window.confirm yerine — birden fazla tetiklenebilen onay akışı için React modal + Promise.
  const [conflictModal, setConflictModal] = useState(null);
  const askConflictConfirm = (orderId, targetWeek, conflicts) => {
    return new Promise((resolve) => {
      const ourOrder = salesOrders[orderId];
      setConflictModal({ orderId, targetWeek, conflicts, ourOrder, resolve, view: 'warning', suggestions: [] });
    });
  };

  // Otomatik sıralama önerisi göster — modal warning'den preview'a geç
  const handleAutoSortPreview = () => {
    if (!conflictModal) return;
    const stokKodu = conflictModal.ourOrder?.stokKodu;
    if (!stokKodu) return;
    const suggestions = suggestSortedPlans(stokKodu, conflictModal.orderId, conflictModal.targetWeek);
    setConflictModal({ ...conflictModal, view: 'preview', suggestions });
  };

  // === Toplu işlemler — Planı Temizle ===
  // Sadece manuel hafta override'larını sil. Deferred / cancelled / not'lu kayıtlar korunur.
  // savePlanOverrides null değer = deleteField() ile atomik silme.
  const handleClearPlan = async () => {
    if (!isAdmin || !clearPlanModal) return;
    setClearPlanModal({ ...clearPlanModal, processing: true });
    const updates = {};
    for (const [id, ov] of Object.entries(planOverrides || {})) {
      if (ov?.status === 'deferred' || ov?.status === 'cancelled') continue;
      if ((ov?.note || '').trim()) continue;
      updates[id] = null; // sil (savePlanOverrides null=deleteField)
    }
    try {
      await savePlanOverrides(updates, { canEdit });
      setClearPlanModal(null);
    } catch (e) {
      alert('Planı temizleme başarısız: ' + (e.message || String(e)));
      setClearPlanModal({ ...clearPlanModal, processing: false });
    }
  };

  // === Toplu işlemler — Otomatik Plan algoritması ===
  // Müşteri teslim sırası + haftalık bütçe + startWeek + includeLate.
  // Aktif siparişler (deferred/cancelled hariç, kalanMiktar>0) teslim tarihine göre sıralanır,
  // her haftaya bütçe sığdığı kadar atanır, sığmayan ileriye kaydırılır.
  // Tek başına haftalık bütçeyi aşan büyük sipariş tek haftaya zorla yerleştirilir (boş haftada).
  const computeAutoPlan = ({ startWeek, monthlyBudget, customerFilter, includeLate }) => {
    const weeklyBudget = monthlyBudget / 4;
    const orders = [];
    for (const [id, o] of Object.entries(salesOrders || {})) {
      if (!o || !o.teslimTarihi) continue;
      if (Number(o.kalanMiktar || 0) <= 0) continue;
      if (customerFilter !== 'all' && o.customerCode !== customerFilter) continue;
      const ov = planOverrides[id];
      if (ov?.status === 'deferred' || ov?.status === 'cancelled') continue;
      const teslimDate = new Date(o.teslimTarihi + 'T00:00:00Z');
      if (isNaN(teslimDate.getTime())) continue;
      const teslimWeek = getISOWeek(teslimDate);
      // "Geciken" = bugünkü haftadan önce teslim isteyen siparişler.
      // startWeek değil currentWeek baz alınır — sayfadaki "⚠ Geciken (X sipariş)"
      // kutusu ile aynı tanım (effectiveWeek < currentWeek).
      const isLate = teslimWeek < grouped.currentWeek;
      if (isLate && !includeLate) continue;
      const currentPlan = ov?.plannedWeek || teslimWeek;
      // KORUMA: Kullanıcı bu siparişi zaten startWeek'ten önce bir haftaya atamışsa
      // (erken bitirme niyetiyle), otomatik plan dokunmaz — manuel kararı korunur.
      // Kademeli planlama akışını destekler (rolling forecast).
      if (currentPlan < startWeek) continue;
      orders.push({
        id,
        stokKodu: o.stokKodu,
        stokAdi: o.stokAdi,
        belgeNo: o.belgeNo,
        customerCode: o.customerCode,
        teslimTarihi: o.teslimTarihi,
        teslimWeek,
        isLate,
        bedel: Number(o.toplamBedel || 0),
        kalanMiktar: Number(o.kalanMiktar || 0),
        currentPlan,
        currentOverride: ov,
      });
    }
    // Müşteri teslim tarihine göre sırala (erken → geç), tie-breaker belgeNo
    orders.sort((a, b) => {
      const t = a.teslimTarihi.localeCompare(b.teslimTarihi);
      if (t !== 0) return t;
      return String(a.belgeNo || '').localeCompare(String(b.belgeNo || ''));
    });

    let cursor = startWeek;
    let cursorBudget = weeklyBudget;
    const weeklyDist = {}; // hafta → { count, ad, tl, overflow: bool }
    const result = [];
    for (const order of orders) {
      // Hedef hafta = max(cursor, teslim haftası)
      const minWeek = (order.teslimWeek > cursor) ? order.teslimWeek : cursor;
      if (minWeek > cursor) {
        cursor = minWeek;
        cursorBudget = weeklyBudget;
      }
      // Bütçe yeterli mi? Yoksa boş haftaya kaydır.
      if (order.bedel > cursorBudget) {
        if (cursorBudget < weeklyBudget) {
          // Hafta yarı dolu, sığmıyor → ileri kaydır
          cursor = nextIsoWeek(cursor);
          cursorBudget = weeklyBudget;
        }
        // cursor temiz hafta — sipariş yerleşir (haftalık bütçeyi aşsa bile zorla)
      }
      const newPlan = cursor;
      result.push({
        ...order,
        newPlan,
        changed: order.currentPlan !== newPlan,
      });
      cursorBudget -= order.bedel;
      // İstatistik
      if (!weeklyDist[newPlan]) weeklyDist[newPlan] = { count: 0, ad: 0, tl: 0, overflow: false };
      weeklyDist[newPlan].count++;
      weeklyDist[newPlan].ad += order.kalanMiktar;
      weeklyDist[newPlan].tl += order.bedel;
      if (weeklyDist[newPlan].tl > weeklyBudget) weeklyDist[newPlan].overflow = true;
    }
    return { suggestions: result, weeklyDist, weeklyBudget };
  };

  // Otomatik plan önizlemesi göster
  const handleAutoPlanPreview = () => {
    if (!autoPlanModal) return;
    const { startWeek, monthlyBudget, customerFilter, includeLate } = autoPlanModal;
    if (!startWeek || !monthlyBudget || monthlyBudget <= 0) {
      alert('Başlangıç haftası ve aylık bütçe geçerli olmalı.');
      return;
    }
    const { suggestions, weeklyDist, weeklyBudget } = computeAutoPlan({ startWeek, monthlyBudget, customerFilter, includeLate });
    setAutoPlanModal({ ...autoPlanModal, view: 'preview', suggestions, weeklyDist, weeklyBudget });
  };

  // Otomatik plan uygula — atomik batch
  const handleApplyAutoPlan = async () => {
    if (!autoPlanModal || !autoPlanModal.suggestions) return;
    const changed = autoPlanModal.suggestions.filter(s => s.changed);
    if (changed.length === 0) {
      setAutoPlanModal(null);
      return;
    }
    setAutoPlanModal({ ...autoPlanModal, processing: true });
    const updates = {};
    const at = new Date().toISOString();
    for (const s of changed) {
      const o = salesOrders[s.id];
      if (!o) continue;
      const ov = s.currentOverride;
      const origWeek = ov?.origWeek || (o.teslimTarihi ? getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z')) : '');
      updates[s.id] = {
        plannedWeek: s.newPlan,
        origWeek,
        note: ov?.note || '',
        by: role,
        at,
        autoPlan: true,
      };
    }
    try {
      await savePlanOverrides(updates, { canEdit });
      setAutoPlanModal(null);
    } catch (e) {
      alert('Otomatik plan uygulama başarısız: ' + (e.message || String(e)));
      setAutoPlanModal({ ...autoPlanModal, processing: false });
    }
  };

  // Önerilen değişiklikleri uygula — atomik batch yazım
  const handleApplyAutoSort = async () => {
    if (!conflictModal) return;
    const changed = (conflictModal.suggestions || []).filter(s => s.changed);
    if (changed.length === 0) {
      // Hiç değişiklik yoksa direkt picker'ın seçimini uygula
      conflictModal.resolve(true);
      setConflictModal(null);
      return;
    }
    const updates = {};
    const at = new Date().toISOString();
    for (const s of changed) {
      const o = salesOrders[s.id];
      if (!o) continue;
      const ov = s.currentOverride;
      const origWeek = ov?.origWeek || (o.teslimTarihi ? getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z')) : '');
      updates[s.id] = {
        plannedWeek: s.newPlan,
        origWeek,
        note: ov?.note || '',
        by: role,
        at,
        autoSort: true,
      };
    }
    try {
      await savePlanOverrides(updates, { canEdit });
      // Picker'ın save'i yapmasın — biz zaten yazdık. resolve(false) → handleSelectWeek return
      conflictModal.resolve(false);
      setConflictModal(null);
      setPicker(null);
    } catch (e) {
      alert('Otomatik sıralama başarısız: ' + (e.message || String(e)));
    }
  };

  const grouped = useWeekGroupedOrders(salesOrders, planOverrides, { customerFilter, searchText, sortMode });

  const toggleProductSort = (col) => {
    setProductSort((prev) => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' });
  };

  const allLoaded = ordersLoaded && overridesLoaded && bomLoaded;
  const rawOrderCount = Object.keys(salesOrders).length;
  // Override sayım — status kırılımı (deferred/cancelled/active). Filter-bağımsız (tüm doc).
  // active = status alanı boş veya "deferred"/"cancelled" dışı (manuel hafta override veya sadece not).
  const overrideBreakdown = useMemo(() => {
    let deferred = 0, cancelled = 0, active = 0;
    for (const ov of Object.values(planOverrides || {})) {
      if (ov?.status === 'deferred') deferred++;
      else if (ov?.status === 'cancelled') cancelled++;
      else active++;
    }
    return { total: deferred + cancelled + active, deferred, cancelled, active };
  }, [planOverrides]);
  const overrideLabel = (() => {
    const { total, deferred, cancelled, active } = overrideBreakdown;
    if (total === 0) return '0 override';
    const parts = [];
    if (deferred > 0) parts.push(`${deferred} belirsiz`);
    if (active > 0) parts.push(`${active} not/plan`);
    if (cancelled > 0) parts.push(`${cancelled} iptal`);
    return `${total} override (${parts.join(' · ')})`;
  })();

  // Orphan override tespiti — planOverrides'ta olup salesOrders'ta artık olmayan kayıtlar.
  // Replacement detection (3-tuple ID) yan etkisi: VIO'da teslim tarihi değişince yeni ID üretilir,
  // eski ID'nin override'ı orphan kalır. Diff sırasında deferred→cancelled çevirme replacement
  // durumunu yakalamaz. Admin uyarı paneli ile elle temizlenebilir.
  const orphanOverrides = useMemo(() => {
    if (!allLoaded) return [];
    return Object.entries(planOverrides || {})
      .filter(([id]) => !salesOrders[id])
      .map(([id, ov]) => {
        const parts = id.split('_');
        let belgeNo = id, stokKodu = '', teslimTarihi = '';
        if (parts.length >= 3) {
          teslimTarihi = parts[parts.length - 1];
          stokKodu = parts[parts.length - 2];
          belgeNo = parts.slice(0, parts.length - 2).join('_');
        }
        return { id, belgeNo, stokKodu, teslimTarihi, ...ov };
      })
      .sort((a, b) => (a.belgeNo || '').localeCompare(b.belgeNo || ''));
  }, [planOverrides, salesOrders, allLoaded]);
  const empty = allLoaded && rawOrderCount === 0;

  // Otomatik sıralama önerisi — kullanıcı seçimi öncelikli forward-fill.
  // Kullanıcının picker'da seçtiği hafta hedef siparişe ZORLA atanır.
  // Önceki siparişler (teslim erken): mevcut plan korunur ama targetWeek'i geçemez (tıraşlanır).
  // Sonraki siparişler (teslim geç): mevcut plan korunur ama önceki planın altına düşmez (yükseltilir).
  // Kapasite hesabı YAPMAZ — kullanıcının niyeti öncelikli, gerekirse aynı haftaya çoklu sipariş düşer.
  const suggestSortedPlans = (stokKodu, pendingOrderId, pendingTargetWeek) => {
    const items = [];
    for (const [id, o] of Object.entries(salesOrders || {})) {
      if (o?.stokKodu !== stokKodu) continue;
      if (!o.teslimTarihi) continue;
      const ov = planOverrides[id];
      if (ov?.status === 'deferred' || ov?.status === 'cancelled') continue;
      let week = ov?.plannedWeek;
      if (!week) {
        const d = new Date(o.teslimTarihi + 'T00:00:00Z');
        if (!isNaN(d.getTime())) week = getISOWeek(d);
      }
      if (!week) continue;
      items.push({ id, belgeNo: o.belgeNo, teslimTarihi: o.teslimTarihi, currentPlan: week, currentOverride: ov, customerCode: o.customerCode });
    }
    if (items.length < 2) return [];
    const sorted = [...items].sort((a, b) => {
      const t = (a.teslimTarihi || '').localeCompare(b.teslimTarihi || '');
      if (t !== 0) return t;
      return String(a.belgeNo || '').localeCompare(String(b.belgeNo || ''));
    });
    const targetIdx = sorted.findIndex(x => x.id === pendingOrderId);
    const newPlans = new Array(sorted.length);

    if (targetIdx >= 0 && pendingTargetWeek) {
      // Hedef siparişe kullanıcı seçimi — zorla
      newPlans[targetIdx] = pendingTargetWeek;
      // Geriye doğru: mevcut plan korunur, ama targetWeek'i geçenler tıraşlanır
      let cap = pendingTargetWeek;
      for (let i = targetIdx - 1; i >= 0; i--) {
        const p = sorted[i].currentPlan;
        newPlans[i] = (p > cap) ? cap : p;
        cap = newPlans[i];
      }
      // İleriye doğru: mevcut plan korunur, ama bir önceki planın altına düşenler yükseltilir
      let floor = pendingTargetWeek;
      for (let i = targetIdx + 1; i < sorted.length; i++) {
        const p = sorted[i].currentPlan;
        newPlans[i] = (p < floor) ? floor : p;
        floor = newPlans[i];
      }
    } else {
      // Pending seçim yoksa: mevcut planları monoton artan hale getir (en az değişimle)
      let floor = sorted[0].currentPlan;
      newPlans[0] = floor;
      for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i].currentPlan;
        newPlans[i] = (p < floor) ? floor : p;
        floor = newPlans[i];
      }
    }

    return sorted.map((o, i) => ({
      id: o.id,
      belgeNo: o.belgeNo,
      customerCode: o.customerCode,
      teslimTarihi: o.teslimTarihi,
      oldPlan: o.currentPlan,
      newPlan: newPlans[i],
      changed: o.currentPlan !== newPlans[i],
      currentOverride: o.currentOverride,
    }));
  };

  // Tutarsızlık tespiti — verilen orderId için targetWeek atanırsa aynı stokKodu'nun
  // başka aktif siparişleriyle plan sırası bozulur mu? Bozulan satırların listesini döner.
  // deferred/cancelled hariç. Eşit teslim tarihi → tutarsızlık sayılmaz.
  const detectConflicts = (orderId, targetWeek) => {
    const order = salesOrders[orderId];
    if (!order || !order.stokKodu || !targetWeek || !order.teslimTarihi) return [];
    const conflicts = [];
    for (const [otherId, otherO] of Object.entries(salesOrders)) {
      if (otherId === orderId) continue;
      if (otherO.stokKodu !== order.stokKodu) continue;
      if (!otherO.teslimTarihi) continue;
      if (otherO.teslimTarihi === order.teslimTarihi) continue;
      const otherOv = planOverrides[otherId];
      if (otherOv?.status === 'deferred' || otherOv?.status === 'cancelled') continue;
      let otherWeek = otherOv?.plannedWeek;
      if (!otherWeek && otherO.teslimTarihi) {
        const d = new Date(otherO.teslimTarihi + 'T00:00:00Z');
        if (!isNaN(d.getTime())) otherWeek = getISOWeek(d);
      }
      if (!otherWeek) continue;
      if (order.teslimTarihi < otherO.teslimTarihi) {
        // Bizim teslim daha erken → planımız da erken olmalı (targetWeek <= otherWeek)
        if (targetWeek > otherWeek) {
          conflicts.push({ id: otherId, ...otherO, effectiveWeek: otherWeek, relation: 'we-earlier-but-they-earlier-plan' });
        }
      } else {
        // Bizim teslim daha geç → planımız da geç olmalı (targetWeek >= otherWeek)
        if (targetWeek < otherWeek) {
          conflicts.push({ id: otherId, ...otherO, effectiveWeek: otherWeek, relation: 'we-later-but-they-later-plan' });
        }
      }
    }
    return conflicts;
  };

  // BOM eksik tespiti — root stok kodları seti
  const bomSet = useMemo(() => {
    const s = new Set();
    for (const [modelKey, model] of Object.entries(bomModels || {})) {
      if (modelKey === 'undefined') continue;
      const root = (model?.parts || []).find(p => p.parentIdx === null || p.parentIdx === undefined);
      if (root?.stockCode) s.add(root.stockCode);
    }
    return s;
  }, [bomModels]);

  // Unique eksik stok kodları — en çok sipariş alanlar önce
  const missingBoms = useMemo(() => {
    if (!bomLoaded || !ordersLoaded) return [];
    const seen = new Map();
    for (const o of Object.values(salesOrders || {})) {
      if (!o.stokKodu || bomSet.has(o.stokKodu)) continue;
      const e = seen.get(o.stokKodu) || { stokAdi: o.stokAdi || '', count: 0, customers: new Set() };
      e.count += 1;
      if (o.customerCode) e.customers.add(o.customerCode);
      seen.set(o.stokKodu, e);
    }
    return Array.from(seen.entries())
      .map(([k, v]) => ({ stokKodu: k, stokAdi: v.stokAdi, siparisCount: v.count, customerCount: v.customers.size }))
      .sort((a, b) => b.siparisCount - a.siparisCount);
  }, [salesOrders, bomSet, bomLoaded, ordersLoaded]);

  const [bomExpanded, setBomExpanded] = useState(false);
  const [noWeekExpanded, setNoWeekExpanded] = useState(false);

  // Ürün bazlı agregasyon — viewMode='products' tablosu için.
  // Aktif siparişleri (late + noWeek + byWeek) stok kodu bazlı toplar; deferred dahil değil
  // (deferred ayrı kutuda görünür, MRP demand'ına da dahil değil — semantik tutarlılık).
  const productSummary = useMemo(() => {
    const allRows = [...grouped.late, ...grouped.noWeek, ...Object.values(grouped.byWeek).flat()];
    const byStock = {};
    for (const r of allRows) {
      const code = r.stokKodu || '?';
      if (!byStock[code]) {
        byStock[code] = {
          stokKodu: code,
          stokAdi: r.stokAdi || '',
          adet: 0,
          tutar: 0,
          siparisCount: 0,
          musteriler: new Set(),
          ilkTeslim: null,
          sonTeslim: null,
          bomMissing: bomSet.size > 0 && !bomSet.has(code),
        };
      }
      const ps = byStock[code];
      ps.adet += Number(r.kalanMiktar || 0);
      ps.tutar += Number(r.toplamBedel || 0);
      ps.siparisCount += 1;
      if (r.customerCode) ps.musteriler.add(r.customerCode);
      if (r.teslimTarihi) {
        if (!ps.ilkTeslim || r.teslimTarihi < ps.ilkTeslim) ps.ilkTeslim = r.teslimTarihi;
        if (!ps.sonTeslim || r.teslimTarihi > ps.sonTeslim) ps.sonTeslim = r.teslimTarihi;
      }
    }
    const arr = Object.values(byStock).map(p => ({ ...p, musteriler: [...p.musteriler] }));
    arr.sort((a, b) => {
      let v = 0;
      if (productSort.col === 'stokKodu') v = a.stokKodu.localeCompare(b.stokKodu);
      else if (productSort.col === 'adet') v = a.adet - b.adet;
      else if (productSort.col === 'tutar') v = a.tutar - b.tutar;
      else if (productSort.col === 'siparisCount') v = a.siparisCount - b.siparisCount;
      return productSort.dir === 'desc' ? -v : v;
    });
    return arr;
  }, [grouped, bomSet, productSort]);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const result = parseSalesOrderExcel(wb);
      // Sevk geçmişi diff — yeni vs eski salesOrders → shipments events.
      // VIO sadece aktif siparişleri verir; tam teslim olunca rapordan düşer. Bu yüzden:
      //   1) sevkEdilen artmışsa (kısmi/tam) → delta event yaz
      //   2) Sipariş VIO'dan kaybolmuşsa → kalan miktar tam sevk varsayımı, final event
      // Deferred-aware: planOverrides[id].status === "deferred" → diff'ten muaf,
      // VIO'dan kaybolursa "cancelled" olarak işaretle (sahte sevk event yazma).
      const importedAt = new Date().toISOString();
      const newShipments = { ...shipments };
      const overrideUpdates = {};
      let eventCount = 0;
      let cancelledCount = 0;
      // (belgeNo, stokKodu) → yeni ID listesi: teslim tarihi güncellemelerini sahte
      // vio-removed event'inden ayırmak için. Eski ID kayıpsa ama aynı belge+stok yeni
      // VIO'da varsa teslim güncellemesi varsay, event yazma.
      const newBelgeStokIndex = {};
      for (const [nid, no] of Object.entries(result.ordersMap || {})) {
        if (!no || !no.belgeNo || !no.stokKodu) continue;
        const k = `${no.belgeNo}|${no.stokKodu}`;
        if (!newBelgeStokIndex[k]) newBelgeStokIndex[k] = [];
        newBelgeStokIndex[k].push(nid);
      }
      const hasReplacementInVio = (oldO) => {
        if (!oldO?.belgeNo || !oldO?.stokKodu) return false;
        const arr = newBelgeStokIndex[`${oldO.belgeNo}|${oldO.stokKodu}`];
        return !!(arr && arr.length > 0);
      };
      const ensureShipmentDoc = (id, o) => {
        if (!newShipments[id]) {
          newShipments[id] = {
            customerCode: o.customerCode || '',
            customerName: o.customerName || '',
            stokKodu: o.stokKodu || '',
            stokAdi: o.stokAdi || '',
            belgeNo: o.belgeNo || '',
            orijinalMiktar: o.orijinalMiktar || 0,
            teslimTarihi: o.teslimTarihi || '',
            events: [],
            totalShipped: 0,
            fullyDelivered: false,
            firstShipAt: '',
            finalShipAt: '',
            lastUpdate: importedAt,
          };
        }
        return newShipments[id];
      };
      const pushEvent = (id, event) => {
        const sh = newShipments[id];
        sh.events.push(event);
        sh.totalShipped = event.cumulative;
        sh.lastUpdate = importedAt;
        if (!sh.firstShipAt) sh.firstShipAt = event.at;
        sh.finalShipAt = event.at;
        if (event.final) sh.fullyDelivered = true;
        eventCount++;
      };
      // 1) Eskide var olanları işle
      for (const [id, oldO] of Object.entries(salesOrders || {})) {
        const ov = planOverrides?.[id];
        const isDeferred = ov?.status === 'deferred';
        const newO = result.ordersMap[id];

        if (isDeferred) {
          // Deferred sipariş — diff'ten muaf, sahte sevk event yazma
          if (!newO) {
            if (hasReplacementInVio(oldO)) {
              // Teslim tarihi VIO'da güncellenmiş — iptal değil; eski ID orphan kalır.
              continue;
            }
            // Gerçekten kayboldu + deferred → İPTAL
            overrideUpdates[id] = { ...ov, status: 'cancelled', cancelledAt: importedAt };
            cancelledCount++;
          }
          continue;
        }

        if (newO) {
          // Hala VIO'da → sevkEdilen değişti mi?
          const oldShip = Number(oldO.sevkEdilen || 0);
          const newShip = Number(newO.sevkEdilen || 0);
          const delta = newShip - oldShip;
          if (delta > 0) {
            ensureShipmentDoc(id, newO);
            pushEvent(id, { at: importedAt, deltaQty: delta, cumulative: newShip, source: 'vio-update' });
          }
        } else {
          // VIO'dan kayboldu — gerçek kayıp mı yoksa teslim tarihi güncellemesi mi?
          if (hasReplacementInVio(oldO)) {
            continue;
          }
          // Gerçekten kayboldu → kalan miktar tam sevk varsayımı, final event
          const oldRemaining = Number(oldO.kalanMiktar || 0);
          if (oldRemaining > 0) {
            ensureShipmentDoc(id, oldO);
            const cumulative = Number(oldO.orijinalMiktar || 0);
            pushEvent(id, { at: importedAt, deltaQty: oldRemaining, cumulative, source: 'vio-removed', final: true });
          } else {
            // Zaten kalanMiktar 0 idi (tam teslim önceden işlendi) — sadece final flag
            if (newShipments[id]) {
              newShipments[id].fullyDelivered = true;
              newShipments[id].lastUpdate = importedAt;
            }
          }
        }
      }
      // 2) Yenide olup eskide olmayan siparişler — sevkEdilen > 0 ile geliyorsa initial event yaz
      for (const [id, newO] of Object.entries(result.ordersMap)) {
        if (salesOrders[id]) continue;
        const newShip = Number(newO.sevkEdilen || 0);
        if (newShip > 0) {
          ensureShipmentDoc(id, newO);
          pushEvent(id, { at: importedAt, deltaQty: newShip, cumulative: newShip, source: 'vio-update' });
        }
      }
      // Save: salesOrders + shipments (eğer event üretildiyse) + planOverrides (deferred→cancelled)
      await saveSalesOrders(result.ordersMap, { canEdit });
      if (eventCount > 0) {
        await saveShipments(newShipments, { canEdit });
      }
      if (cancelledCount > 0) {
        // Sadece status değişen override'ları merge ile yaz (diğerleri korunur)
        for (const [orderId, ovData] of Object.entries(overrideUpdates)) {
          await savePlanOverride(orderId, ovData, { canEdit });
        }
      }
      const extra = result.aggregateCount > 0 ? ` (${result.aggregateCount} duplicate birleştirildi)` : '';
      const shipExtra = eventCount > 0 ? ` · ${eventCount} sevk hareketi` : '';
      const cancelExtra = cancelledCount > 0 ? ` · ${cancelledCount} iptal` : '';
      setUploadResult({
        ok: true,
        message: `✓ ${result.rowCount} satır → ${result.orderCount} unique kayıt, ${result.customerCount} müşteri${extra}${shipExtra}${cancelExtra}`,
      });
    } catch (e) {
      setUploadResult({ ok: false, message: `✗ Hata: ${e.message || String(e)}` });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const weekLabel = (iso) => {
    try {
      const d = getWeekMonday(iso);
      return `${iso} · ${formatDateShort(d)}`;
    } catch { return iso; }
  };
  const weekDiffLabel = (iso) => {
    const d = weeksBetween(grouped.currentWeek, iso);
    if (d === 0) return 'bu hafta';
    if (d > 0) return `+${d} hafta`;
    return `${-d} hf geç`;
  };

  // ---- Picker logic ----

  const openPicker = (e, order) => {
    if (!canEdit) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const origWeek = order.teslimTarihi
      ? getISOWeek(new Date(order.teslimTarihi + 'T00:00:00Z'))
      : '';
    // Viewport bound: eğer picker sağa taşarsa butonun sağ kenarına hizala
    const pickerWidth = 240;
    const vw = window.innerWidth;
    let x = rect.left;
    if (x + pickerWidth + 16 > vw) x = Math.max(8, vw - pickerWidth - 16);
    setPicker({
      orderId: order.id,
      anchorX: x,
      anchorY: rect.bottom + 4,
      origWeek,
      currentPlanWeek: order.effectiveWeek,
      noteText: planOverrides[order.id]?.note || '',
    });
  };

  const handleSelectWeek = async (newWeek) => {
    if (!picker) return;
    const { orderId, origWeek, currentPlanWeek, noteText } = picker;
    const note = (noteText || '').trim() ? noteText : '';
    // Tutarsızlık kontrolü — yalnız hafta gerçekten değişiyorsa
    if (newWeek && newWeek !== currentPlanWeek) {
      const conflicts = detectConflicts(orderId, newWeek);
      if (conflicts.length > 0) {
        const ok = await askConflictConfirm(orderId, newWeek, conflicts);
        if (!ok) return; // kullanıcı iptal etti, picker hala açık
      }
    }
    try {
      if (newWeek === origWeek && !note) {
        // Seçim VIO haftasıyla eşit VE not boş → override sil, ham tesliye dön
        await removePlanOverride(orderId, { canEdit });
      } else {
        await savePlanOverride(orderId, {
          plannedWeek: newWeek,
          origWeek,
          note,
          by: role,
          at: new Date().toISOString(),
        }, { canEdit });
      }
      setPicker(null);
    } catch (e) {
      alert('Override kaydı başarısız: ' + (e.message || String(e)));
    }
  };

  const handleSaveNoteOnly = async () => {
    if (!picker) return;
    const { orderId, origWeek, currentPlanWeek, noteText } = picker;
    try {
      await savePlanOverride(orderId, {
        plannedWeek: currentPlanWeek,
        origWeek,
        note: noteText || '',
        by: role,
        at: new Date().toISOString(),
      }, { canEdit });
      setPicker(null);
    } catch (e) {
      alert('Not kaydı başarısız: ' + (e.message || String(e)));
    }
  };

  const handleReset = async () => {
    if (!picker) return;
    try {
      await removePlanOverride(picker.orderId, { canEdit });
      setPicker(null);
    } catch (e) {
      alert('Override silme başarısız: ' + (e.message || String(e)));
    }
  };

  // Orphan override silme — admin-only. VIO replacement (3-tuple ID değişimi) sonucu kalan
  // ölü deferred/cancelled kayıtları temizler. Confirm yeterli (tek tetikli akış).
  const handleOrphanDelete = async (orderId) => {
    if (!isAdmin) return;
    if (!window.confirm(`Bu orphan override silinsin mi?\n\n${orderId}\n\n(salesOrders'ta zaten yok, sadece planOverrides'taki ölü kayıt silinecek.)`)) return;
    try {
      await removePlanOverride(orderId, { canEdit });
    } catch (e) {
      alert('Orphan silme başarısız: ' + (e.message || String(e)));
    }
  };

  // VIO Termin Değişti accordion'undan tek-tıkla aksiyon: override silinir → ham VIO tarihine döner.
  const handleSyncToVio = async (orderId) => {
    if (!canEdit) return;
    try {
      await removePlanOverride(orderId, { canEdit });
    } catch (e) {
      alert('VIO senkronizasyonu başarısız: ' + (e.message || String(e)));
    }
  };

  // Akibeti belirsiz: müşteri net iptal demediği ama işleme almadığı siparişler.
  // status: "deferred" set edilir → MRP demand'ına dahil edilmez (App.jsx salesOrdersDemand filtre).
  // Mevcut plannedWeek/note korunur — kullanıcı "tekrar aktif et" derse motora geri döner.
  const handleMarkDeferred = async () => {
    if (!picker) return;
    const { orderId, origWeek, currentPlanWeek, noteText } = picker;
    try {
      await savePlanOverride(orderId, {
        plannedWeek: currentPlanWeek,
        origWeek,
        note: noteText || '',
        status: 'deferred',
        by: role,
        at: new Date().toISOString(),
      }, { canEdit });
      setPicker(null);
    } catch (e) {
      alert('Akibeti belirsiz işaretleme başarısız: ' + (e.message || String(e)));
    }
  };

  const handleUnmarkDeferred = async () => {
    if (!picker) return;
    const { orderId, origWeek, currentPlanWeek, noteText } = picker;
    try {
      // Eğer sipariş VIO haftasında + not yok ise tamamen sıfırla, aksi takdirde status'u kaldır
      if (currentPlanWeek === origWeek && !(noteText || '').trim()) {
        await removePlanOverride(orderId, { canEdit });
      } else {
        await savePlanOverride(orderId, {
          plannedWeek: currentPlanWeek,
          origWeek,
          note: noteText || '',
          by: role,
          at: new Date().toISOString(),
        }, { canEdit });
      }
      setPicker(null);
    } catch (e) {
      alert('Akibeti aktif etme başarısız: ' + (e.message || String(e)));
    }
  };

  // Drag & drop — satır → hafta başlığı
  const handleDropOnWeek = async (orderId, targetWeek) => {
    if (!canEdit) return;
    const o = salesOrders[orderId];
    if (!o || !targetWeek) return;
    const origWeek = o.teslimTarihi ? getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z')) : '';
    const existingNote = planOverrides[orderId]?.note || '';
    // Tutarsızlık kontrolü — drop hedef haftaya gönderilmeden önce
    const currentWeek = planOverrides[orderId]?.plannedWeek || origWeek;
    if (targetWeek !== currentWeek) {
      const conflicts = detectConflicts(orderId, targetWeek);
      if (conflicts.length > 0) {
        const ok = await askConflictConfirm(orderId, targetWeek, conflicts);
        if (!ok) return;
      }
    }
    try {
      if (targetWeek === origWeek && !existingNote) {
        await removePlanOverride(orderId, { canEdit });
      } else {
        await savePlanOverride(orderId, {
          plannedWeek: targetWeek,
          origWeek,
          note: existingNote,
          by: role,
          at: new Date().toISOString(),
        }, { canEdit });
      }
    } catch (e) {
      alert('Sürükle-bırak başarısız: ' + (e.message || String(e)));
    }
  };

  // Outside-click → close picker
  useEffect(() => {
    if (!picker) return;
    const handler = (e) => {
      if (e.target.closest('[data-picker-container]')) return;
      setPicker(null);
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [picker]);

  // Picker hafta listesi — cari hafta -4 ile +20 arası (25 hafta)
  const pickerWeeks = useMemo(() => {
    const list = [];
    const startMonday = getWeekMonday(grouped.currentWeek);
    startMonday.setUTCDate(startMonday.getUTCDate() - 28);
    for (let i = 0; i < 25; i++) {
      const mon = new Date(startMonday);
      mon.setUTCDate(startMonday.getUTCDate() + i * 7);
      list.push(getISOWeek(mon));
    }
    return list;
  }, [grouped.currentWeek]);

  // Hafta stripi — cari hafta -1 ile +10 arası (12 hafta)
  const weekStrip = useMemo(() => {
    const list = [];
    const startMonday = getWeekMonday(grouped.currentWeek);
    startMonday.setUTCDate(startMonday.getUTCDate() - 7);
    for (let i = 0; i < 12; i++) {
      const mon = new Date(startMonday);
      mon.setUTCDate(startMonday.getUTCDate() + i * 7);
      list.push(getISOWeek(mon));
    }
    return list;
  }, [grouped.currentWeek]);

  // Aylık şerit — cari aydan başlayarak 12 ay (bedel + sipariş sayısı)
  const monthlyStrip = useMemo(() => {
    const monthNames = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
    const now = new Date();
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const y = d.getUTCFullYear();
      const mIdx = d.getUTCMonth();
      const key = `${y}-${String(mIdx + 1).padStart(2, '0')}`;
      months.push({ key, label: `${monthNames[mIdx]} ${String(y).slice(2)}`, bedel: 0, count: 0 });
    }
    const monthMap = {};
    months.forEach(m => { monthMap[m.key] = m; });
    for (const w of Object.keys(grouped.byWeek)) {
      try {
        const mon = getWeekMonday(w);
        const key = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}`;
        const bucket = monthMap[key];
        if (bucket) {
          for (const o of grouped.byWeek[w]) {
            bucket.bedel += o.toplamBedel || 0;
            bucket.count += 1;
          }
        }
      } catch {}
    }
    return months;
  }, [grouped.byWeek]);

  // ---- Render ----

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Diğer Müşteriler</h1>
        <span style={{ fontSize: 11, color: '#a8a29e' }}>Bugün {grouped.currentWeek}</span>
      </div>
      <p style={{ color: '#78716c', fontSize: 13, marginTop: 2 }}>
        Yapım aşamasında. Faz 1A aktif geliştirme.
      </p>

      {/* Upload bölümü */}
      <div style={{ marginTop: 20, padding: 12, border: '1px solid #e7e5e4', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Satış Siparişi Yükleme</div>
          {lastSalesUpdate && (() => {
            const runAt = new Date(lastSalesUpdate.runAt);
            const ageMin = Math.floor((Date.now() - runAt.getTime()) / 60000);
            const ageStr = ageMin < 1 ? 'az önce'
              : ageMin < 60 ? `${ageMin} dk önce`
              : ageMin < 1440 ? `${Math.floor(ageMin / 60)} sa önce`
              : `${Math.floor(ageMin / 1440)} gün önce`;
            const isToday = runAt.toDateString() === new Date().toDateString();
            const timeStr = runAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const dateStr = runAt.toLocaleDateString('tr-TR');
            const sourceLbl = lastSalesUpdate.source?.includes('morning') ? 'Sabah'
              : lastSalesUpdate.source?.includes('midday') ? 'Öğle'
              : lastSalesUpdate.source === 'http' ? 'Manuel'
              : 'Otomatik';
            const failed = lastSalesUpdate.status && lastSalesUpdate.status !== 'ok';
            let bg, border, color, dot;
            if (failed) {
              bg = '#fef2f2'; border = '#fca5a5'; color = '#b91c1c'; dot = '#dc2626';
            } else if (ageMin > 1440) {
              bg = '#fef2f2'; border = '#fca5a5'; color = '#b91c1c'; dot = '#dc2626';
            } else if (ageMin > 360) {
              bg = '#fffbeb'; border = '#fcd34d'; color = '#92400e'; dot = '#d97706';
            } else {
              bg = '#f0fdf4'; border = '#86efac'; color = '#166534'; dot = '#16a34a';
            }
            const orderCount = lastSalesUpdate.summary?.orderCount;
            const tooltip = `Çalıştırma: ${runAt.toLocaleString('tr-TR')}\nKaynak: ${lastSalesUpdate.source || '—'}` +
              (orderCount != null ? `\n${orderCount} sipariş yüklendi` : '') +
              (lastSalesUpdate.summary?.shipmentEvents ? `\n${lastSalesUpdate.summary.shipmentEvents} sevk hareketi` : '') +
              (lastSalesUpdate.summary?.cancelledOrders ? `\n${lastSalesUpdate.summary.cancelledOrders} iptal` : '') +
              (lastSalesUpdate.error ? `\nHata: ${lastSalesUpdate.error}` : '');
            return (
              <div
                title={tooltip}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                  background: bg, border: `1px solid ${border}`, color,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, display: 'inline-block' }} />
                <span>
                  {failed ? 'Otomasyon hatası' : `Son güncelleme · ${ageStr}`}
                  {' · '}
                  <span style={{ fontWeight: 400 }}>{sourceLbl} {isToday ? timeStr : dateStr}</span>
                </span>
              </div>
            );
          })()}
        </div>
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fefce8', border: '1px solid #fde047', borderRadius: 6, fontSize: 11, color: '#854d0e', lineHeight: 1.5 }}>
          ℹ️ <b>Mail otomasyonu aktif</b> — VIO sipariş raporu mailden otomatik yüklenir (4. rapor). Manuel yükleme <b>acil durum</b> içindir; sıradaki mail yüklemesi ile sync olur.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!canEdit || uploading}
          title={!canEdit ? 'Sadece admin/üretim yükleyebilir' : ''}
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12,
            border: '1px solid ' + (canEdit ? '#534AB7' : '#d6d3d1'),
            background: canEdit ? '#534AB7' : '#f5f5f4',
            color: canEdit ? '#fff' : '#a8a29e',
            cursor: (canEdit && !uploading) ? 'pointer' : 'not-allowed',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? 'Yükleniyor...' : 'Satış Siparişi Excel Yükle (acil durum)'}
        </button>
        {uploadResult && (
          <div style={{
            marginTop: 10, padding: 10, borderRadius: 6, fontSize: 12,
            background: uploadResult.ok ? '#dcfce7' : '#fee2e2',
            color: uploadResult.ok ? '#166534' : '#991b1b',
            border: '1px solid ' + (uploadResult.ok ? '#86efac' : '#fca5a5'),
          }}>
            {uploadResult.message}
          </div>
        )}
      </div>

      {/* Empty state */}
      {empty && (
        <div style={{ marginTop: 20, padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
          Henüz sipariş yüklenmemiş — yukarıdaki butonla başla.
        </div>
      )}

      {/* Main içerik — veri varsa */}
      {!empty && allLoaded && (
        <>
          {/* Toolbar */}
          <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setCustomerFilter('all')}
                style={filterBtnStyle(customerFilter === 'all')}
              >Tümü</button>
              {KNOWN_CUSTOMERS.map(c => (
                <button
                  key={c.code}
                  onClick={() => setCustomerFilter(c.code)}
                  style={filterBtnStyle(customerFilter === c.code)}
                >{c.shortLabel}</button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Ara: stok kodu / ad / belge no"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                flex: '0 1 280px', padding: '6px 10px', borderRadius: 6,
                border: '1px solid #d6d3d1', fontSize: 12, outline: 'none',
              }}
            />
            {viewMode === 'orders' && (
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={{
                  padding: '6px 10px', borderRadius: 6, border: '1px solid #d6d3d1',
                  fontSize: 12, background: '#fff', cursor: 'pointer',
                }}
              >
                <option value="date">Sıralama: Tarih</option>
                <option value="price">Sıralama: Tutar</option>
                <option value="customer">Sıralama: Müşteri</option>
              </select>
            )}
            <div style={{ display: 'flex', gap: 0, border: '1px solid #d6d3d1', borderRadius: 6, overflow: 'hidden' }}>
              <button
                onClick={() => setViewMode('orders')}
                style={{
                  padding: '5px 10px', fontSize: 12, border: 'none',
                  background: viewMode === 'orders' ? '#534AB7' : '#fff',
                  color: viewMode === 'orders' ? '#fff' : '#44403c',
                  cursor: 'pointer', fontWeight: viewMode === 'orders' ? 500 : 400,
                }}
              >📋 Sipariş</button>
              <button
                onClick={() => setViewMode('products')}
                style={{
                  padding: '5px 10px', fontSize: 12, border: 'none',
                  background: viewMode === 'products' ? '#534AB7' : '#fff',
                  color: viewMode === 'products' ? '#fff' : '#44403c',
                  cursor: 'pointer', fontWeight: viewMode === 'products' ? 500 : 400,
                  borderLeft: '1px solid #d6d3d1',
                }}
              >🧮 Ürün Özeti</button>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#78716c' }}>
              {viewMode === 'orders'
                ? `${grouped.kpi.totalRows} kayıt filtrede · ${overrideLabel}`
                : `${productSummary.length} ürün · ${grouped.kpi.totalRows} sipariş`}
            </div>
          </div>

          {/* Toplu işlemler — admin only. Otomatik plan kurma + manuel hafta planlarını temizleme.
              Geri alınamaz işlemler olduğu için iki onay (modal + uygula). */}
          {isAdmin && viewMode === 'orders' && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setAutoPlanModal({
                  view: 'form',
                  startWeek: nextWeekIso,
                  monthlyBudget: 8000000,
                  customerFilter: 'all',
                  includeLate: false,
                  suggestions: null,
                  processing: false,
                })}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  border: '1px solid #16a34a', background: '#dcfce7', color: '#166534',
                  cursor: 'pointer',
                }}
                title="Aktif siparişleri haftalık bütçe + müşteri teslim sırasına göre otomatik dağıt"
              >🤖 Otomatik Plan</button>
              <button
                onClick={() => {
                  let count = 0;
                  for (const ov of Object.values(planOverrides || {})) {
                    if (ov?.status === 'deferred' || ov?.status === 'cancelled') continue;
                    if ((ov?.note || '').trim()) continue;
                    count++;
                  }
                  setClearPlanModal({ count, processing: false });
                }}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  border: '1px solid #b91c1c', background: '#fee2e2', color: '#991b1b',
                  cursor: 'pointer',
                }}
                title="Sadece manuel hafta override'larını sil — deferred / cancelled / not'lu kayıtlar korunur"
              >🧹 Planı Temizle</button>
            </div>
          )}

          {/* BOM eksik uyarı */}
          {missingBoms.length > 0 && (
            <div style={{
              marginTop: 14, padding: 12, borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#991b1b', flexWrap: 'wrap',
              }} onClick={() => setBomExpanded(!bomExpanded)}>
                <span>❓ {missingBoms.length} ürün BOM eksik</span>
                <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 400 }}>
                  — bu ürünlerin BOM ağacı Sevkiyat Pro'da tanımlı değil
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {bomExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {bomExpanded && (
                <div style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto' }}>
                  {missingBoms.slice(0, 100).map(m => (
                    <div key={m.stokKodu} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '5px 8px', fontSize: 11,
                      borderBottom: '1px solid #fecaca',
                    }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11,
                        minWidth: 170, color: '#1c1917',
                      }}>{m.stokKodu}</span>
                      <span style={{ flex: 1, color: '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.stokAdi}>
                        {m.stokAdi || '—'}
                      </span>
                      <span style={{ color: '#78716c', fontSize: 10, minWidth: 70, textAlign: 'right' }}>
                        {m.siparisCount} sip{m.customerCount > 1 ? ` · ${m.customerCount} müş` : ''}
                      </span>
                      <button
                        onClick={() => onNavigateToMrp && onNavigateToMrp('bom')}
                        disabled={!onNavigateToMrp}
                        title="MRP Planlama → Ürün Ağacı sekmesine git"
                        style={{
                          padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                          border: '1px solid #dc2626',
                          background: '#fff',
                          color: '#dc2626',
                          cursor: onNavigateToMrp ? 'pointer' : 'not-allowed',
                        }}
                      >BOM yükle →</button>
                    </div>
                  ))}
                  {missingBoms.length > 100 && (
                    <div style={{ padding: '6px 8px', fontSize: 10, color: '#78716c', textAlign: 'center' }}>
                      … ve {missingBoms.length - 100} daha (ilk 100 gösteriliyor)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* KPI strip */}
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {renderKpi('Toplam', grouped.kpi.totalRows, grouped.kpi.totalBedel, '#1e293b', '#fff')}
            {KNOWN_CUSTOMERS.map(c => {
              const s = grouped.kpi.perCustomer[c.code];
              const badge = customerBadge(c.code);
              return renderKpi(c.shortLabel, s?.count || 0, s?.bedel || 0, badge.bg, badge.fg);
            })}
          </div>

          {/* Hafta stripi — 12 hafta mini özet */}
          <div style={{ marginTop: 12, display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
            {weekStrip.map(w => {
              const cellOrders = grouped.byWeek[w] || [];
              const bedel = cellOrders.reduce((s, o) => s + (o.toplamBedel || 0), 0);
              const isCurrent = w === grouped.currentWeek;
              return (
                <div key={w} style={{
                  flex: '0 0 72px', padding: 6, borderRadius: 6, fontSize: 10,
                  background: isCurrent ? '#dbeafe' : '#fff',
                  border: '1px solid ' + (isCurrent ? '#60a5fa' : '#e7e5e4'),
                  textAlign: 'center',
                }}>
                  <div style={{ fontWeight: 600, color: isCurrent ? '#1e40af' : '#44403c' }}>{w.slice(-3)}</div>
                  <div style={{ color: '#78716c', fontSize: 9, marginTop: 2 }}>{cellOrders.length} sip</div>
                  <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, marginTop: 2, fontSize: 10 }}>
                    {bedel > 0 ? formatMoney(bedel) : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Aylık bedel şeridi — 12 ay */}
          <div style={{ marginTop: 6, display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
            {monthlyStrip.map(m => (
              <div key={m.key} style={{
                flex: '0 0 80px', padding: 6, borderRadius: 6, fontSize: 10,
                background: '#faf9f7',
                border: '1px solid #e7e5e4',
                textAlign: 'center',
              }}>
                <div style={{ fontWeight: 600, color: '#44403c' }}>{m.label}</div>
                <div style={{ color: '#78716c', fontSize: 9, marginTop: 2 }}>{m.count} sipariş</div>
                <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, marginTop: 2, fontSize: 10 }}>
                  {m.bedel > 0 ? formatMoney(m.bedel) + ' TL' : '—'}
                </div>
              </div>
            ))}
          </div>

          {viewMode === 'orders' && (<>
          {/* VIO Termin Değişti — override stale uyarısı (Aşama 2.4) */}
          {grouped.staleOverrides.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#fefce8', border: '1px solid #fde047',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#854d0e',
              }} onClick={() => setStaleExpanded(!staleExpanded)}>
                <span style={{ color: '#ca8a04' }}>●</span>
                <span>VIO Termin Değişti ({grouped.staleOverrides.length} sipariş)</span>
                <span style={{ fontSize: 11, color: '#a16207', fontWeight: 400 }}>
                  — VIO'da teslim tarihi güncellendi, override stale
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {staleExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {staleExpanded && (
                <div style={{ marginTop: 10, background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                  {grouped.staleOverrides.map(o => {
                    const ov = planOverrides[o.id];
                    return (
                      <div key={o.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                        fontSize: 12, borderBottom: '1px solid #f5f5f4',
                      }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          minWidth: 30, textAlign: 'center',
                          background: customerBadge(o.customerCode).bg,
                          color: customerBadge(o.customerCode).fg,
                        }}>{customerBadge(o.customerCode).label}</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11, minWidth: 170, color: '#1c1917' }}>
                          {o.stokKodu}
                        </span>
                        <span style={{ flex: 1, color: '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.stokAdi}>
                          {o.stokAdi}
                        </span>
                        <span style={{ fontSize: 11, color: '#78716c' }}>
                          Override: <b style={{ color: '#c2410c' }}>{ov?.plannedWeek || '—'}</b>
                          <span style={{ margin: '0 4px' }}>·</span>
                          VIO yeni: <b style={{ color: '#15803d' }}>{o.vioCurrentWeek}</b>
                          <span style={{ margin: '0 4px' }}>·</span>
                          önceki VIO: <span style={{ color: '#a8a29e' }}>{ov?.origWeek}</span>
                        </span>
                        <button
                          onClick={() => handleSyncToVio(o.id)}
                          disabled={!canEdit}
                          title="Override'ı sil — sipariş ham VIO tarihine döner"
                          style={{
                            padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                            border: '1px solid #15803d', background: '#dcfce7', color: '#166534',
                            cursor: canEdit ? 'pointer' : 'not-allowed',
                            opacity: canEdit ? 1 : 0.6,
                          }}
                        >↻ VIO'ya Güncelle</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Orphan override uyarısı — admin only.
              salesOrders'ta artık olmayan ama planOverrides'ta hâlâ duran ölü kayıtlar.
              Replacement detection (3-tuple ID değişimi) sonucu kalan deferred/cancelled. */}
          {isAdmin && orphanOverrides.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#991b1b',
              }} onClick={() => setOrphanExpanded(!orphanExpanded)}>
                <span>⚠️ Orphan Override ({orphanOverrides.length} kayıt)</span>
                <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 400 }}>
                  — salesOrders'ta yok, planOverrides'ta ölü kayıt
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {orphanExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {orphanExpanded && (
                <div style={{ marginTop: 10, background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                  {orphanOverrides.map(o => {
                    const statusLabel = o.status === 'deferred' ? 'belirsiz'
                      : o.status === 'cancelled' ? 'iptal'
                      : 'not/plan';
                    const statusColor = o.status === 'deferred' ? '#57534e'
                      : o.status === 'cancelled' ? '#a8a29e'
                      : '#c2410c';
                    return (
                      <div key={o.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                        fontSize: 12, borderBottom: '1px solid #f5f5f4',
                      }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          minWidth: 50, textAlign: 'center',
                          background: '#fee2e2', color: statusColor,
                        }}>{statusLabel}</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11, minWidth: 90, color: '#1c1917' }}>
                          {o.belgeNo || '—'}
                        </span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, minWidth: 140, color: '#44403c' }}>
                          {o.stokKodu || '—'}
                        </span>
                        <span style={{ fontSize: 11, color: '#78716c', minWidth: 90 }}>
                          Teslim: <b style={{ color: '#44403c' }}>{o.teslimTarihi || '—'}</b>
                        </span>
                        <span style={{ flex: 1, fontSize: 11, color: '#78716c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.note || ''}>
                          {o.note ? `💬 ${o.note} · ` : ''}
                          {o.plannedWeek && `plan: ${o.plannedWeek}`}
                          {o.origWeek && ` (VIO o an: ${o.origWeek})`}
                          {o.at && ` · ${o.at.substring(0, 10)}`}
                          {o.by && ` · 👤 ${o.by}`}
                        </span>
                        <button
                          onClick={() => handleOrphanDelete(o.id)}
                          title="Ölü override kaydını sil"
                          style={{
                            padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                            border: '1px solid #b91c1c', background: '#fee2e2', color: '#991b1b',
                            cursor: 'pointer',
                          }}
                        >🗑️ Sil</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Plan Sırası Tutarsız — aynı stokKodu için müşteri teslim sırası ile bizim plan
              sırası uyuşmuyor. Filter-aware (deferred hariç). Tıkla → picker aç. */}
          {grouped.inconsistentPairs.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#faf5ff', border: '1px solid #d8b4fe',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#6b21a8',
              }} onClick={() => setInconsistentExpanded(!inconsistentExpanded)}>
                <span>⇅ Plan Sırası Tutarsız ({grouped.inconsistentPairs.length} çift)</span>
                <span style={{ fontSize: 11, color: '#7e22ce', fontWeight: 400 }}>
                  — aynı ürün, müşteri teslim sırası ≠ bizim plan sırası
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {inconsistentExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {inconsistentExpanded && (
                <div style={{ marginTop: 10, background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                  {grouped.inconsistentPairs.map((p, idx) => (
                    <div key={`${p.stokKodu}-${p.earlier.id}-${p.later.id}-${idx}`} style={{
                      padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #f5f5f4',
                    }}>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11, color: '#1c1917', marginBottom: 4 }}>
                        {p.stokKodu}
                        <span style={{ marginLeft: 8, fontFamily: 'inherit', fontWeight: 400, color: '#78716c' }}>
                          {p.earlier.stokAdi}
                        </span>
                      </div>
                      {/* Erken teslim, geç plan = sorunlu satır */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          minWidth: 30, textAlign: 'center',
                          background: customerBadge(p.earlier.customerCode).bg,
                          color: customerBadge(p.earlier.customerCode).fg,
                        }}>{customerBadge(p.earlier.customerCode).label}</span>
                        <span style={{ fontSize: 11, color: '#44403c', minWidth: 80 }}>
                          Belge {p.earlier.belgeNo}
                        </span>
                        <span style={{ fontSize: 11, color: '#78716c', minWidth: 130 }}>
                          teslim <b style={{ color: '#15803d' }}>{p.earlier.teslimTarihi}</b>
                        </span>
                        <span style={{ fontSize: 11, color: '#78716c', minWidth: 110 }}>
                          plan <b style={{ color: '#dc2626' }}>{p.earlier.effectiveWeek}</b> ← geç
                        </span>
                        <button
                          onClick={(e) => openPicker(e, p.earlier)}
                          disabled={!canEdit}
                          title="Bu siparişin haftasını düzelt"
                          style={{
                            padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                            border: '1px solid #7e22ce', background: '#f3e8ff', color: '#6b21a8',
                            cursor: canEdit ? 'pointer' : 'not-allowed',
                            opacity: canEdit ? 1 : 0.6, marginLeft: 'auto',
                          }}
                        >📅 Düzelt</button>
                      </div>
                      {/* Geç teslim, erken plan = referans satır */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          minWidth: 30, textAlign: 'center',
                          background: customerBadge(p.later.customerCode).bg,
                          color: customerBadge(p.later.customerCode).fg,
                        }}>{customerBadge(p.later.customerCode).label}</span>
                        <span style={{ fontSize: 11, color: '#44403c', minWidth: 80 }}>
                          Belge {p.later.belgeNo}
                        </span>
                        <span style={{ fontSize: 11, color: '#78716c', minWidth: 130 }}>
                          teslim <b style={{ color: '#dc2626' }}>{p.later.teslimTarihi}</b>
                        </span>
                        <span style={{ fontSize: 11, color: '#78716c', minWidth: 110 }}>
                          plan <b style={{ color: '#15803d' }}>{p.later.effectiveWeek}</b> ← erken
                        </span>
                        <button
                          onClick={(e) => openPicker(e, p.later)}
                          disabled={!canEdit}
                          title="Bu siparişin haftasını düzelt"
                          style={{
                            padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                            border: '1px solid #7e22ce', background: '#f3e8ff', color: '#6b21a8',
                            cursor: canEdit ? 'pointer' : 'not-allowed',
                            opacity: canEdit ? 1 : 0.6, marginLeft: 'auto',
                          }}
                        >📅 Düzelt</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Akibeti belirsiz kutusu — gecikenin üstünde, MRP demand'ına dahil değil */}
          {grouped.deferred.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#f5f5f4', border: '1px solid #d6d3d1',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#57534e',
              }} onClick={() => setDeferredExpanded(!deferredExpanded)}>
                <span>⏸ Akibeti Belirsiz ({grouped.deferred.length} sipariş · {weekTotals(grouped.deferred).ad} AD · {formatMoney(grouped.kpi.deferredBedel)} TL)</span>
                <span style={{ fontSize: 11, color: '#78716c' }}>
                  — MRP demand'ına dahil değil
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {deferredExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {deferredExpanded && (
                <div style={{ marginTop: 10 }}>
                  {renderOrderGroups(grouped.deferred, grouped.currentWeek, false, { canEdit, openPicker, planOverrides, bomSet })}
                </div>
              )}
            </div>
          )}

          {/* Gecikenler kutusu */}
          {grouped.late.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#991b1b',
              }} onClick={() => setLateExpanded(!lateExpanded)}>
                <span>⚠ Geciken ({grouped.late.length} sipariş · {weekTotals(grouped.late).ad} AD · {formatMoney(weekTotals(grouped.late).tl)} TL)</span>
                <span style={{ fontSize: 11, color: '#b91c1c' }}>
                  — bugün ({grouped.currentWeek}) öncesi teslim
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {lateExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {lateExpanded && (
                <div style={{ marginTop: 10 }}>
                  {renderOrderGroups(grouped.late, grouped.currentWeek, true, { canEdit, openPicker, planOverrides, bomSet })}
                </div>
              )}
            </div>
          )}

          {/* noWeek edge case — expandable, plan butonu ile yönetilebilir */}
          {grouped.noWeek.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#fffbeb', border: '1px solid #fde68a',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: '#78350f', flexWrap: 'wrap',
              }} onClick={() => setNoWeekExpanded(!noWeekExpanded)}>
                <span>⚠ {grouped.noWeek.length} sipariş için teslim tarihi yok</span>
                <span style={{ fontSize: 11, color: '#92400e', fontWeight: 400 }}>
                  — plan haftası atayarak takvime al
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {noWeekExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {noWeekExpanded && (
                <div style={{ marginTop: 10 }}>
                  {renderOrderGroups(grouped.noWeek, grouped.currentWeek, false, { canEdit, openPicker, planOverrides, bomSet })}
                </div>
              )}
            </div>
          )}

          {/* BU HAFTA vurgu */}
          {(grouped.byWeek[grouped.currentWeek]?.length || 0) > 0 && (() => {
            const thisWeek = grouped.byWeek[grouped.currentWeek] || [];
            const { ad, tl } = weekTotals(thisWeek);
            return (
              <div style={{
                marginTop: 16, padding: 12, borderRadius: 8,
                background: '#dcfce7', border: '1px solid #86efac',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#166534', fontWeight: 500, flexWrap: 'wrap' }}>
                  <span>📅 BU HAFTA ({grouped.currentWeek})</span>
                  <span style={{ fontSize: 12, color: '#15803d', fontWeight: 400 }}>
                    — {thisWeek.length} sipariş · {ad} AD · {formatMoney(tl)} TL
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#166534' }}>sevke hazır olmalı</span>
                </div>
              </div>
            );
          })()}

          {/* Week list */}
          <div style={{ marginTop: 16 }}>
            {grouped.weekOrder.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                Filtre/aramaya uyan sipariş yok
              </div>
            ) : (
              grouped.weekOrder.map(w => (
                <div key={w} style={{ marginBottom: 14 }}>
                  <div
                    onDragOver={canEdit ? (e) => { e.preventDefault(); e.currentTarget.style.background = '#dcfce7'; } : undefined}
                    onDragLeave={canEdit ? (e) => { e.currentTarget.style.background = '#f5f5f4'; } : undefined}
                    onDrop={canEdit ? (e) => {
                      e.preventDefault();
                      const orderId = e.dataTransfer.getData('text/plain');
                      e.currentTarget.style.background = '#f5f5f4';
                      handleDropOnWeek(orderId, w);
                    } : undefined}
                    style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px', background: '#f5f5f4', borderRadius: 6,
                    fontSize: 12, fontWeight: 600, color: '#44403c', marginBottom: 4,
                  }}>
                    <span>{weekLabel(w)}</span>
                    <span style={{
                      fontSize: 10, color: w === grouped.currentWeek ? '#1e40af' : '#78716c',
                      fontWeight: w === grouped.currentWeek ? 700 : 400,
                    }}>({weekDiffLabel(w)})</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#78716c', fontWeight: 400 }}>
                      {(() => {
                        const { ad, tl } = weekTotals(grouped.byWeek[w]);
                        return `${grouped.byWeek[w].length} sipariş · ${ad} AD · ${formatMoney(tl)} TL`;
                      })()}
                    </span>
                  </div>
                  {renderOrderGroups(grouped.byWeek[w], grouped.currentWeek, false, { canEdit, openPicker, planOverrides, bomSet })}
                </div>
              ))
            )}
          </div>
          </>)}

          {viewMode === 'products' && (
            <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f5f5f4', fontSize: 11, color: '#44403c', textAlign: 'left' }}>
                    <th onClick={() => toggleProductSort('stokKodu')} style={pTh}>Stok Kodu {productSort.col === 'stokKodu' && (productSort.dir === 'desc' ? '▼' : '▲')}</th>
                    <th style={pTh}>Ad</th>
                    <th onClick={() => toggleProductSort('adet')} style={{ ...pTh, textAlign: 'right' }}>Toplam Adet {productSort.col === 'adet' && (productSort.dir === 'desc' ? '▼' : '▲')}</th>
                    <th onClick={() => toggleProductSort('tutar')} style={{ ...pTh, textAlign: 'right' }}>Toplam Tutar {productSort.col === 'tutar' && (productSort.dir === 'desc' ? '▼' : '▲')}</th>
                    <th onClick={() => toggleProductSort('siparisCount')} style={{ ...pTh, textAlign: 'right' }}>Sip {productSort.col === 'siparisCount' && (productSort.dir === 'desc' ? '▼' : '▲')}</th>
                    <th style={pTh}>Müşteri</th>
                    <th style={pTh}>İlk Teslim</th>
                    <th style={pTh}>Son Teslim</th>
                  </tr>
                </thead>
                <tbody>
                  {productSummary.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#a8a29e' }}>Filtre/aramaya uyan sipariş yok</td></tr>
                  ) : productSummary.map((p) => {
                    const tFirst = p.ilkTeslim ? new Date(p.ilkTeslim + 'T00:00:00Z') : null;
                    const tLast = p.sonTeslim ? new Date(p.sonTeslim + 'T00:00:00Z') : null;
                    return (
                      <tr key={p.stokKodu} style={{ borderTop: '1px solid #f5f5f4' }}>
                        <td style={pTd}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, color: '#1c1917' }}>
                            {p.bomMissing && <span title="BOM yok" style={{ color: '#dc2626', marginRight: 4, fontWeight: 700 }}>❓</span>}
                            {p.stokKodu}
                          </span>
                        </td>
                        <td style={{ ...pTd, color: '#44403c', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.stokAdi}>{p.stokAdi}</td>
                        <td style={{ ...pTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.adet}</td>
                        <td style={{ ...pTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatMoney(p.tutar)} TL</td>
                        <td style={{ ...pTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#78716c' }}>{p.siparisCount}</td>
                        <td style={pTd}>
                          <div style={{ display: 'flex', gap: 3 }}>
                            {p.musteriler.map(c => {
                              const b = customerBadge(c);
                              return (
                                <span key={c} style={{
                                  padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                                  background: b.bg, color: b.fg,
                                }}>{b.label}</span>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{ ...pTd, color: '#78716c', fontSize: 11 }}>{tFirst ? formatDateShort(tFirst) : '—'}</td>
                        <td style={{ ...pTd, color: '#78716c', fontSize: 11 }}>{tLast ? formatDateShort(tLast) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Debug — Firestore bağlantı teyidi */}
      <div style={{
        marginTop: 24, padding: 10, border: '1px dashed #e7e5e4', borderRadius: 6,
        fontSize: 11, color: '#78716c', fontFamily: 'ui-monospace, monospace',
      }}>
        Firestore: {allLoaded ? `${rawOrderCount} ham sipariş · ${overrideLabel}` : 'yükleniyor…'}
      </div>

      {/* Planı Temizle modal — admin only, iki onay (modal aç + buton bas).
          Sadece manuel hafta override'larını siler, deferred / cancelled / not'lu kayıtlar korunur. */}
      {clearPlanModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !clearPlanModal.processing) setClearPlanModal(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.45)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{
            background: '#fff', borderRadius: 10, padding: 22, maxWidth: 540, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>🧹</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#991b1b' }}>Planı Temizle</h3>
            </div>
            <p style={{ fontSize: 13, color: '#44403c', margin: '0 0 14px 0', lineHeight: 1.5 }}>
              <b>{clearPlanModal.count} manuel hafta override</b> silinecek — sipariş ham VIO teslim haftasına döner.
              Deferred (akibeti belirsiz), iptal edilen ve not içeren kayıtlar <b>korunur</b>.
            </p>
            <div style={{
              padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: 11, color: '#991b1b', marginBottom: 16,
            }}>
              ⚠ Bu işlem <b>geri alınamaz</b>. Yanlış uygulamadan emin olmak için Otomatik Plan kurmadan önce dikkat edin.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setClearPlanModal(null)}
                disabled={clearPlanModal.processing}
                style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  border: '1px solid #d6d3d1', background: '#fff', color: '#44403c',
                  cursor: clearPlanModal.processing ? 'not-allowed' : 'pointer',
                  opacity: clearPlanModal.processing ? 0.6 : 1,
                }}
              >İptal</button>
              <button
                onClick={handleClearPlan}
                disabled={clearPlanModal.processing || clearPlanModal.count === 0}
                style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  border: '1px solid #b91c1c', background: '#b91c1c', color: '#fff',
                  cursor: (clearPlanModal.processing || clearPlanModal.count === 0) ? 'not-allowed' : 'pointer',
                  opacity: (clearPlanModal.processing || clearPlanModal.count === 0) ? 0.6 : 1,
                }}
              >{clearPlanModal.processing ? 'Temizleniyor…' : `🗑️ Temizle (${clearPlanModal.count})`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Otomatik Plan modal — admin only, iki view (form + preview).
          Form: startWeek, aylık bütçe, müşteri filtresi, geciken dahil checkbox.
          Preview: hafta-hafta dağılım + değişen sipariş listesi + uygula. */}
      {autoPlanModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !autoPlanModal.processing) setAutoPlanModal(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.45)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{
            background: '#fff', borderRadius: 10, padding: 0,
            maxWidth: autoPlanModal.view === 'preview' ? 1000 : 560, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🤖</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#166534' }}>
                {autoPlanModal.view === 'form' ? 'Otomatik Plan Kur' : 'Önerilen Plan — Önizleme'}
              </h3>
              {autoPlanModal.view === 'preview' && (
                <span style={{ fontSize: 11, color: '#78716c' }}>
                  {autoPlanModal.suggestions?.filter(s => s.changed).length} sipariş değişecek · {autoPlanModal.suggestions?.length} sipariş toplam
                </span>
              )}
              <button
                onClick={() => setAutoPlanModal(null)}
                disabled={autoPlanModal.processing}
                style={{
                  marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, fontSize: 12,
                  border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                  opacity: autoPlanModal.processing ? 0.6 : 1,
                }}
              >Kapat ✕</button>
            </div>

            {autoPlanModal.view === 'form' && (() => {
              // Form'daki anlık geciken sayısı (filtreye göre).
              // "Geciken" = bugünkü haftadan önce teslim — sayfadaki Geciken kutusu ile aynı tanım.
              let lateCount = 0;
              for (const [id, o] of Object.entries(salesOrders || {})) {
                if (!o || !o.teslimTarihi) continue;
                if (Number(o.kalanMiktar || 0) <= 0) continue;
                if (autoPlanModal.customerFilter !== 'all' && o.customerCode !== autoPlanModal.customerFilter) continue;
                const ov = planOverrides[id];
                if (ov?.status === 'deferred' || ov?.status === 'cancelled') continue;
                const teslimWeek = getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z'));
                if (teslimWeek < grouped.currentWeek) lateCount++;
              }
              const weeklyBudget = autoPlanModal.monthlyBudget / 4;
              return (
                <div style={{ padding: 20, overflowY: 'auto' }}>
                  <p style={{ fontSize: 12, color: '#57534e', margin: '0 0 16px 0', lineHeight: 1.5 }}>
                    Aktif siparişler müşteri teslim sırasına göre, haftalık bütçe sınırına göre otomatik dağıtılır.
                    Önizleme zorunlu — uygulamadan önce sonucu göreceksin.
                  </p>
                  {/* Başlangıç haftası */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#44403c', marginBottom: 4 }}>Başlangıç haftası</label>
                    <input
                      type="text"
                      value={autoPlanModal.startWeek}
                      onChange={(e) => setAutoPlanModal({ ...autoPlanModal, startWeek: e.target.value })}
                      placeholder="2026-W19"
                      style={{
                        padding: '6px 10px', borderRadius: 4, border: '1px solid #d6d3d1',
                        fontSize: 13, fontFamily: 'ui-monospace, monospace', width: 140,
                      }}
                    />
                    <span style={{ marginLeft: 10, fontSize: 11, color: '#78716c' }}>
                      Bu haftadan önce hiçbir sipariş plana atanmaz
                    </span>
                  </div>
                  {/* Aylık bütçe */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#44403c', marginBottom: 4 }}>Aylık bütçe (TL)</label>
                    <input
                      type="number"
                      value={autoPlanModal.monthlyBudget}
                      onChange={(e) => setAutoPlanModal({ ...autoPlanModal, monthlyBudget: Number(e.target.value) || 0 })}
                      style={{
                        padding: '6px 10px', borderRadius: 4, border: '1px solid #d6d3d1',
                        fontSize: 13, fontVariantNumeric: 'tabular-nums', width: 200,
                      }}
                    />
                    <span style={{ marginLeft: 10, fontSize: 11, color: '#78716c' }}>
                      = haftalık ~<b>{formatMoney(weeklyBudget)} TL</b>
                    </span>
                  </div>
                  {/* Müşteri filtresi */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#44403c', marginBottom: 4 }}>Müşteri filtresi</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => setAutoPlanModal({ ...autoPlanModal, customerFilter: 'all' })}
                        style={{
                          padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                          border: '1px solid ' + (autoPlanModal.customerFilter === 'all' ? '#534AB7' : '#d6d3d1'),
                          background: autoPlanModal.customerFilter === 'all' ? '#534AB7' : '#fff',
                          color: autoPlanModal.customerFilter === 'all' ? '#fff' : '#44403c',
                          cursor: 'pointer',
                        }}
                      >Tümü</button>
                      {KNOWN_CUSTOMERS.map(c => (
                        <button
                          key={c.code}
                          onClick={() => setAutoPlanModal({ ...autoPlanModal, customerFilter: c.code })}
                          style={{
                            padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                            border: '1px solid ' + (autoPlanModal.customerFilter === c.code ? '#534AB7' : '#d6d3d1'),
                            background: autoPlanModal.customerFilter === c.code ? '#534AB7' : '#fff',
                            color: autoPlanModal.customerFilter === c.code ? '#fff' : '#44403c',
                            cursor: 'pointer',
                          }}
                        >{c.shortLabel}</button>
                      ))}
                    </div>
                  </div>
                  {/* Geciken dahil checkbox */}
                  <div style={{ marginBottom: 18, padding: 10, borderRadius: 6, background: '#fef9c3', border: '1px solid #fde047' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#854d0e', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={autoPlanModal.includeLate}
                        onChange={(e) => setAutoPlanModal({ ...autoPlanModal, includeLate: e.target.checked })}
                        style={{ width: 16, height: 16 }}
                      />
                      <span>
                        Geciken siparişleri ({lateCount} sipariş) plana dahil et
                      </span>
                    </label>
                    <div style={{ fontSize: 10, color: '#a16207', marginTop: 6, paddingLeft: 24 }}>
                      Dahil edilirse: en erken haftaya çekilirler. Edilmezse mevcut planları korunur (manuel olarak değerlendirebilirsin).
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setAutoPlanModal(null)}
                      style={{
                        padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                        border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                      }}
                    >İptal</button>
                    <button
                      onClick={handleAutoPlanPreview}
                      style={{
                        padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                        border: '1px solid #16a34a', background: '#16a34a', color: '#fff', cursor: 'pointer',
                      }}
                    >🔍 Önizleme Göster</button>
                  </div>
                </div>
              );
            })()}

            {autoPlanModal.view === 'preview' && (() => {
              const changed = autoPlanModal.suggestions.filter(s => s.changed);
              const sortedWeeks = Object.keys(autoPlanModal.weeklyDist || {}).sort();
              const overflowCount = Object.values(autoPlanModal.weeklyDist || {}).filter(w => w.overflow).length;
              return (
                <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                  {/* Özet */}
                  <div style={{
                    padding: 10, borderRadius: 6, background: '#f0fdf4', border: '1px solid #86efac',
                    fontSize: 12, marginBottom: 14, color: '#166534',
                  }}>
                    <b>{changed.length} sipariş</b> mevcut planından değişecek · toplam <b>{autoPlanModal.suggestions.length}</b> sipariş plana atandı
                    · haftalık bütçe <b>{formatMoney(autoPlanModal.weeklyBudget)} TL</b>
                    {overflowCount > 0 && (
                      <span style={{ color: '#b45309', marginLeft: 8 }}>
                        ⚠ {overflowCount} hafta bütçeyi aşıyor (büyük tek sipariş zorla yerleştirildi)
                      </span>
                    )}
                  </div>

                  {/* Hafta hafta dağılım */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#44403c', marginBottom: 6 }}>Haftalık Dağılım</div>
                    <div style={{ borderRadius: 6, border: '1px solid #e7e5e4', overflow: 'hidden' }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '90px 1fr 80px 110px 60px',
                        gap: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600,
                        background: '#f5f5f4', color: '#57534e',
                      }}>
                        <span>Hafta</span>
                        <span>Yük</span>
                        <span>Sip</span>
                        <span>TL</span>
                        <span>AD</span>
                      </div>
                      {sortedWeeks.map(w => {
                        const d = autoPlanModal.weeklyDist[w];
                        const pct = Math.min(100, (d.tl / autoPlanModal.weeklyBudget) * 100);
                        return (
                          <div key={w} style={{
                            display: 'grid', gridTemplateColumns: '90px 1fr 80px 110px 60px',
                            gap: 8, padding: '6px 10px', fontSize: 11, alignItems: 'center',
                            borderTop: '1px solid #f5f5f4',
                          }}>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>{w}</span>
                            <div style={{ height: 8, borderRadius: 4, background: '#f5f5f4', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', width: pct + '%',
                                background: d.overflow ? '#dc2626' : '#16a34a',
                              }} />
                            </div>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{d.count}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: d.overflow ? '#dc2626' : '#44403c', fontWeight: d.overflow ? 600 : 400 }}>
                              {formatMoney(d.tl)} TL
                            </span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#78716c' }}>{d.ad}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Değişen sipariş listesi */}
                  {changed.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#44403c', marginBottom: 6 }}>
                        Değişecek Siparişler ({changed.length})
                      </div>
                      <div style={{ borderRadius: 6, border: '1px solid #e7e5e4', overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
                        <div style={{
                          display: 'grid', gridTemplateColumns: '40px 80px 130px 1fr 90px 90px 90px',
                          gap: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600,
                          background: '#f5f5f4', color: '#57534e', position: 'sticky', top: 0,
                        }}>
                          <span>Müş</span>
                          <span>Belge</span>
                          <span>Stok</span>
                          <span>Ad</span>
                          <span>Teslim</span>
                          <span>Eski</span>
                          <span>Yeni</span>
                        </div>
                        {changed.map(s => {
                          const b = customerBadge(s.customerCode);
                          return (
                            <div key={s.id} style={{
                              display: 'grid', gridTemplateColumns: '40px 80px 130px 1fr 90px 90px 90px',
                              gap: 8, padding: '5px 10px', fontSize: 11, alignItems: 'center',
                              borderTop: '1px solid #f5f5f4',
                            }}>
                              <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: b.bg, color: b.fg, textAlign: 'center' }}>{b.label}</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.belgeNo}</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>{s.stokKodu}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#78716c' }} title={s.stokAdi}>{s.stokAdi}</span>
                              <span style={{ color: '#78716c' }}>{s.teslimTarihi}</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', color: '#dc2626' }}>{s.currentPlan}</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', color: '#15803d', fontWeight: 600 }}>{s.newPlan}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {autoPlanModal.view === 'preview' && (
              <div style={{
                padding: '12px 20px', borderTop: '1px solid #e7e5e4',
                display: 'flex', gap: 8, justifyContent: 'flex-end',
              }}>
                <button
                  onClick={() => setAutoPlanModal({ ...autoPlanModal, view: 'form' })}
                  disabled={autoPlanModal.processing}
                  style={{
                    padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                    border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                    opacity: autoPlanModal.processing ? 0.6 : 1,
                  }}
                >← Geri</button>
                <button
                  onClick={handleApplyAutoPlan}
                  disabled={autoPlanModal.processing || autoPlanModal.suggestions.filter(s => s.changed).length === 0}
                  style={{
                    padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                    border: '1px solid #16a34a', background: '#16a34a', color: '#fff',
                    cursor: autoPlanModal.processing ? 'not-allowed' : 'pointer',
                    opacity: autoPlanModal.processing ? 0.6 : 1,
                  }}
                >{autoPlanModal.processing ? 'Uygulanıyor…' : `✓ Hepsini Uygula (${autoPlanModal.suggestions.filter(s => s.changed).length})`}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conflict modal — iki view: warning (uyarı) + preview (otomatik sıralama önerisi).
          window.confirm yerine React + Promise pattern (birden fazla tetiklenebilen onay). */}
      {conflictModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: 22,
            maxWidth: 720, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            maxHeight: '85vh', overflowY: 'auto',
          }}>
            {conflictModal.view === 'warning' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>⇅</span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#6b21a8' }}>Plan Sırası Tutarsızlığı</h3>
                </div>
                <p style={{ fontSize: 13, color: '#44403c', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                  Bu hafta ataması, aynı ürünün başka sipariş(ler)i ile <b>müşteri teslim sırası ≠ bizim plan sırası</b> tutarsızlığına yol açıyor.
                </p>
                <div style={{
                  padding: 10, borderRadius: 6, background: '#faf5ff', border: '1px solid #d8b4fe',
                  fontSize: 12, marginBottom: 10,
                }}>
                  <div style={{ fontWeight: 600, color: '#6b21a8', marginBottom: 6 }}>Senin siparişin</div>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#1c1917' }}>
                    {conflictModal.ourOrder?.stokKodu} — {conflictModal.ourOrder?.stokAdi}
                  </div>
                  <div style={{ fontSize: 11, color: '#44403c', marginTop: 4 }}>
                    Belge {conflictModal.ourOrder?.belgeNo} · teslim <b>{conflictModal.ourOrder?.teslimTarihi}</b> · yeni plan <b style={{ color: '#7e22ce' }}>{conflictModal.targetWeek}</b>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#57534e', marginBottom: 6 }}>
                  Çakışan sipariş{conflictModal.conflicts.length > 1 ? `ler (${conflictModal.conflicts.length})` : ''}:
                </div>
                <div style={{ borderRadius: 6, border: '1px solid #e7e5e4', overflow: 'hidden', marginBottom: 16 }}>
                  {conflictModal.conflicts.map((c) => {
                    const weEarlier = c.relation === 'we-earlier-but-they-earlier-plan';
                    return (
                      <div key={c.id} style={{
                        padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #f5f5f4', background: '#fff',
                      }}>
                        <div style={{ fontSize: 11, color: '#44403c' }}>
                          Belge <b>{c.belgeNo}</b> · teslim <b style={{ color: weEarlier ? '#dc2626' : '#15803d' }}>{c.teslimTarihi}</b> · plan <b style={{ color: weEarlier ? '#15803d' : '#dc2626' }}>{c.effectiveWeek}</b>
                        </div>
                        <div style={{ fontSize: 10, color: '#7e22ce', marginTop: 3 }}>
                          {weEarlier
                            ? '↑ Bu siparişin teslimi seninkinden geç AMA planı senin yeni planından erken'
                            : '↑ Bu siparişin teslimi seninkinden erken AMA planı senin yeni planından geç'}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { conflictModal.resolve(false); setConflictModal(null); }}
                    style={{
                      padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                    }}
                  >İptal</button>
                  <button
                    onClick={handleAutoSortPreview}
                    disabled={!canEdit}
                    style={{
                      padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      border: '1px solid #16a34a', background: '#dcfce7', color: '#166534',
                      cursor: canEdit ? 'pointer' : 'not-allowed',
                      opacity: canEdit ? 1 : 0.6,
                    }}
                  >🪄 Otomatik Sırala — Öneri Göster</button>
                  <button
                    onClick={() => { conflictModal.resolve(true); setConflictModal(null); }}
                    style={{
                      padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      border: '1px solid #7e22ce', background: '#7e22ce', color: '#fff', cursor: 'pointer',
                    }}
                  >Yine de Devam Et</button>
                </div>
              </>
            )}

            {conflictModal.view === 'preview' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>🪄</span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#166534' }}>Önerilen Plan Sıralaması</h3>
                </div>
                <p style={{ fontSize: 12, color: '#44403c', margin: '0 0 10px 0', lineHeight: 1.5 }}>
                  <b>{conflictModal.ourOrder?.stokKodu}</b> ürünü için {conflictModal.suggestions?.length || 0} aktif sipariş — senin seçtiğin <b style={{ color: '#7e22ce' }}>{conflictModal.targetWeek}</b> haftası baz alınarak teslim sırasına göre yeniden hizalandı.
                </p>
                <div style={{
                  padding: 8, borderRadius: 6, background: '#fef9c3', border: '1px solid #fde047',
                  fontSize: 11, color: '#854d0e', marginBottom: 12,
                }}>
                  ℹ️ Senin seçimin sabit, önceki teslimliler (varsa) bu haftaya çekilir, sonraki teslimliler ileriye itilir. <b>Kapasite hesabı yapmaz</b> — aynı haftaya çoklu sipariş düşebilir, tezgah müsaitliğini kontrol etmek size kalmış.
                </div>
                <div style={{ borderRadius: 6, border: '1px solid #e7e5e4', overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '50px 90px 110px 90px 90px 70px',
                    gap: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600,
                    background: '#f5f5f4', color: '#57534e',
                  }}>
                    <span></span>
                    <span>Belge</span>
                    <span>Teslim</span>
                    <span>Eski Plan</span>
                    <span>Yeni Plan</span>
                    <span>Durum</span>
                  </div>
                  {(conflictModal.suggestions || []).map((s) => (
                    <div key={s.id} style={{
                      display: 'grid', gridTemplateColumns: '50px 90px 110px 90px 90px 70px',
                      gap: 8, padding: '6px 10px', fontSize: 11, alignItems: 'center',
                      borderTop: '1px solid #f5f5f4',
                      background: s.changed ? '#fff' : '#fafaf9',
                      color: s.changed ? '#1c1917' : '#a8a29e',
                    }}>
                      <span style={{
                        padding: '2px 5px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                        textAlign: 'center',
                        background: customerBadge(s.customerCode).bg,
                        color: customerBadge(s.customerCode).fg,
                      }}>{customerBadge(s.customerCode).label}</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.belgeNo}</span>
                      <span>{s.teslimTarihi}</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', color: s.changed ? '#dc2626' : '#a8a29e' }}>
                        {s.oldPlan}
                      </span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: s.changed ? 600 : 400, color: s.changed ? '#15803d' : '#a8a29e' }}>
                        {s.newPlan}
                      </span>
                      <span style={{ fontSize: 10, color: s.changed ? '#7e22ce' : '#a8a29e' }}>
                        {s.changed ? 'değişecek' : 'aynı'}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setConflictModal({ ...conflictModal, view: 'warning' })}
                    style={{
                      padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                    }}
                  >← Geri</button>
                  <button
                    onClick={() => { conflictModal.resolve(false); setConflictModal(null); }}
                    style={{
                      padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
                    }}
                  >İptal</button>
                  <button
                    onClick={handleApplyAutoSort}
                    disabled={!canEdit || !(conflictModal.suggestions || []).some(s => s.changed)}
                    style={{
                      padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                      border: '1px solid #16a34a', background: '#16a34a', color: '#fff',
                      cursor: (canEdit && (conflictModal.suggestions || []).some(s => s.changed)) ? 'pointer' : 'not-allowed',
                      opacity: (canEdit && (conflictModal.suggestions || []).some(s => s.changed)) ? 1 : 0.6,
                    }}
                  >✓ Hepsini Uygula ({(conflictModal.suggestions || []).filter(s => s.changed).length})</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Week picker popup */}
      {picker && (
        <div
          data-picker-container
          style={{
            position: 'fixed',
            top: picker.anchorY,
            left: picker.anchorX,
            background: '#fff',
            border: '1px solid #d6d3d1',
            borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            padding: 8,
            zIndex: 100,
            minWidth: 240,
            maxHeight: 400,
            overflowY: 'auto',
            fontSize: 12,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#44403c', padding: '2px 6px', marginBottom: 4 }}>
            Plan haftası seç
          </div>
          <div style={{ padding: '0 6px', marginBottom: 8 }}>
            <textarea
              placeholder="Not (isteğe bağlı)…"
              value={picker.noteText || ''}
              onChange={(e) => setPicker({ ...picker, noteText: e.target.value })}
              rows={2}
              style={{
                width: '100%', padding: 6, fontSize: 11, borderRadius: 4,
                border: '1px solid #d6d3d1', outline: 'none',
                resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleSaveNoteOnly}
              style={{
                marginTop: 4, padding: '3px 10px', fontSize: 10, borderRadius: 4,
                border: '1px solid #a8a29e', background: '#fff', cursor: 'pointer',
                color: '#44403c',
              }}
            >Notu kaydet</button>
          </div>
          {planOverrides[picker.orderId]?.status === 'deferred' ? (
            <button
              onClick={handleUnmarkDeferred}
              style={{
                width: '100%', textAlign: 'left', padding: '6px 10px',
                background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 4,
                fontSize: 11, color: '#047857', cursor: 'pointer', marginBottom: 6,
                fontWeight: 500,
              }}
            >
              ▶ Tekrar Aktif Et (demand'a dahil olur)
            </button>
          ) : (
            <button
              onClick={handleMarkDeferred}
              style={{
                width: '100%', textAlign: 'left', padding: '6px 10px',
                background: '#f5f5f4', border: '1px solid #d6d3d1', borderRadius: 4,
                fontSize: 11, color: '#57534e', cursor: 'pointer', marginBottom: 6,
                fontWeight: 500,
              }}
            >
              ⏸ Akibeti Belirsiz (demand'tan çıkar)
            </button>
          )}
          {picker.currentPlanWeek !== picker.origWeek && picker.origWeek && (
            <button
              onClick={handleReset}
              style={{
                width: '100%', textAlign: 'left', padding: '6px 10px',
                background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 4,
                fontSize: 11, color: '#c2410c', cursor: 'pointer', marginBottom: 6,
                fontWeight: 500,
              }}
            >
              ↺ Orijinale dön ({picker.origWeek} — VIO teslim)
            </button>
          )}
          {pickerWeeks.map(w => {
            const isCurrent = w === picker.currentPlanWeek;
            const isOrig = w === picker.origWeek;
            return (
              <div
                key={w}
                onClick={() => handleSelectWeek(w)}
                style={{
                  padding: '5px 10px', cursor: 'pointer',
                  background: isCurrent ? '#dbeafe' : 'transparent',
                  borderRadius: 4,
                  fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
                  fontWeight: isCurrent ? 600 : 400,
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = '#f5f5f4'; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ minWidth: 80 }}>{w}</span>
                <span style={{ color: '#78716c', fontSize: 10 }}>{weekDiffLabel(w)}</span>
                {isOrig && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 9, padding: '1px 5px', borderRadius: 3,
                    background: '#fed7aa', color: '#9a3412', fontWeight: 600,
                  }}>VIO</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const pTh = { padding: '6px 10px', fontWeight: 600, cursor: 'pointer', userSelect: 'none', borderBottom: '1px solid #d6d3d1' };
const pTd = { padding: '6px 10px' };

function filterBtnStyle(active) {
  return {
    padding: '4px 12px', borderRadius: 6, fontSize: 12,
    border: '1px solid ' + (active ? '#534AB7' : '#d6d3d1'),
    background: active ? '#534AB7' : '#fff',
    color: active ? '#fff' : '#44403c',
    cursor: 'pointer',
    fontWeight: active ? 500 : 400,
  };
}

function renderKpi(label, count, bedel, bg, fg) {
  return (
    <div key={label} style={{
      padding: '10px 14px', borderRadius: 8, background: '#fff',
      border: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
        background: bg, color: fg,
      }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1c1917', fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(bedel)} TL
        </span>
        <span style={{ fontSize: 10, color: '#78716c' }}>{count} sipariş</span>
      </div>
    </div>
  );
}

function renderOrderGroups(orders, currentWeek, isLateContext, ctx) {
  return groupByBelgeNo(orders).map((g, idx) => {
    const multi = g.items.length > 1;
    return (
      <div key={g.belgeNo + '_' + idx} style={{
        borderLeft: multi ? '3px solid #c7d2fe' : '3px solid transparent',
        background: multi ? 'rgba(199,210,254,0.06)' : 'transparent',
        marginBottom: 2, borderRadius: '0 4px 4px 0',
      }}>
        <div style={{
          fontSize: 10, color: '#64748b', padding: '3px 10px', fontWeight: 500,
        }}>Belge {g.belgeNo}{multi ? ` · ${g.items.length} satır` : ''}</div>
        {g.items.map(o => renderOrderRow(o, currentWeek, isLateContext, ctx))}
      </div>
    );
  });
}

function renderOrderRow(o, currentWeek, isLateContext, ctx) {
  const { canEdit, openPicker, planOverrides, bomSet } = ctx;
  const badge = customerBadge(o.customerCode);
  const teslim = o.teslimTarihi ? new Date(o.teslimTarihi + 'T00:00:00Z') : null;
  const lateWeeks = isLateContext && o.effectiveWeek ? weeksBetween(o.effectiveWeek, currentWeek) : 0;
  const override = planOverrides?.[o.id];
  const vioCurrentWeek = teslim ? getISOWeek(teslim) : '';
  const vioChanged = override && override.origWeek && vioCurrentWeek && vioCurrentWeek !== override.origWeek;
  const bomMissing = bomSet && !bomSet.has(o.stokKodu);
  return (
    <div
      key={o.id}
      draggable={canEdit}
      onDragStart={canEdit ? (e) => {
        e.dataTransfer.setData('text/plain', o.id);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px',
        fontSize: 12, borderBottom: '1px solid #f5f5f4',
        cursor: canEdit ? 'grab' : 'default',
        opacity: o.isDeferred ? 0.55 : 1,
        background: o.isDeferred ? 'rgba(120,113,108,0.05)' : 'transparent',
      }}>
      {o.isDeferred && <span title="Akibeti belirsiz — MRP demand'ına dahil değil" style={{ color: '#78716c', fontSize: 12, lineHeight: 1 }}>⏸</span>}
      <span style={{
        display: 'inline-block', padding: '2px 6px', borderRadius: 4,
        fontSize: 10, fontWeight: 600, minWidth: 30, textAlign: 'center',
        background: badge.bg, color: badge.fg,
      }}>{badge.label}</span>
      <span style={{
        fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11,
        minWidth: 170, color: '#1c1917',
      }}>
        {bomMissing && <span title="BOM yok — MRP → Ürün Ağacı'nda yükle" style={{ color: '#dc2626', marginRight: 4, fontWeight: 700 }}>❓</span>}
        {o.stokKodu}
      </span>
      <span style={{
        flex: 1, color: '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={o.stokAdi}>{o.stokAdi}</span>
      <span style={{ color: '#78716c', minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {o.kalanMiktar} {o.brm}
      </span>
      <span style={{ fontWeight: 500, minWidth: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(o.toplamBedel)} TL
      </span>
      <span style={{ color: '#78716c', minWidth: 60, textAlign: 'right', fontSize: 11 }}>
        {teslim ? formatDateShort(teslim) : '—'}
      </span>
      <button
        data-picker-container
        onClick={(e) => openPicker(e, o)}
        disabled={!canEdit}
        title={canEdit ? 'Plan haftasını değiştir' : 'Sadece admin/üretim düzenleyebilir'}
        style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
          border: '1px solid ' + (o.isOverride ? '#fb923c' : '#d6d3d1'),
          background: o.isOverride ? '#fff7ed' : '#fff',
          color: o.isOverride ? '#c2410c' : '#44403c',
          cursor: canEdit ? 'pointer' : 'not-allowed',
          opacity: canEdit ? 1 : 0.6,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 110, textAlign: 'center',
        }}
      >
        {(() => {
          // Override aktif + hafta gerçekten değişmiş ise: (origWeek) plan +diff göster
          const ov = override;
          if (ov && ov.origWeek && ov.origWeek !== o.effectiveWeek) {
            const diff = weeksBetween(ov.origWeek, o.effectiveWeek);
            if (Number.isFinite(diff) && diff !== 0) {
              const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
              const diffColor = diff > 0 ? '#b45309' : '#15803d';
              return (
                <>
                  <span style={{ color: '#a8a29e', fontSize: 9, marginRight: 3 }} title={`VIO orijinal: ${ov.origWeek}`}>({shortWeek(ov.origWeek)})</span>
                  {o.effectiveWeek}
                  <span style={{ color: diffColor, fontSize: 9, fontWeight: 700, marginLeft: 3 }}>{diffStr}</span>
                </>
              );
            }
          }
          return o.effectiveWeek || '—';
        })()}
        {o.isOverride && <span style={{ marginLeft: 4, color: '#c2410c' }}>✎</span>}
        {planOverrides?.[o.id]?.note && <span title={planOverrides[o.id].note} style={{ marginLeft: 3, fontSize: 10 }}>💬</span>}
        {vioChanged && <span title={`VIO teslim değişti: ${override.origWeek} → ${vioCurrentWeek} — üstteki "VIO Termin Değişti" kutusundan güncelle`} style={{ marginLeft: 3, color: '#ca8a04', fontSize: 14, lineHeight: 1, fontWeight: 700 }}>●</span>}
      </button>
      {isLateContext && lateWeeks > 0 && (() => {
        const lc = lateWeeks >= 7 ? { bg: '#fecaca', fg: '#991b1b' }
                : lateWeeks >= 3 ? { bg: '#fed7aa', fg: '#9a3412' }
                : { bg: '#fef3c7', fg: '#854d0e' };
        return (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 3,
            background: lc.bg, color: lc.fg, fontWeight: 600, minWidth: 40, textAlign: 'center',
          }}>
            {lateWeeks} hf geç
          </span>
        );
      })()}
    </div>
  );
}
