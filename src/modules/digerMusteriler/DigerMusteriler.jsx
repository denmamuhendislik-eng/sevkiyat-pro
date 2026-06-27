import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSalesOrders, usePlanOverrides, useBomModels, useShipments, useAutomationLog, useWeekGroupedOrders, groupByBelgeNo, useCocParts, useCocCertificates, useCocCertificatesMulti, useDriveConfig } from './hooks';
import {
  saveCocCertificate, updateCocCertificate, deleteCocCertificate,
  saveCocPart, deleteCocPart, suggestNextCertNo,
  uploadCocAttachment, deleteCocAttachment, downloadCocAttachmentBlob,
  appendCocCertificateAttachment, setCocCertificateAttachmentList, setCocCertificateOthers,
  setCocCertificateNaCategories,
  uploadCocPartStandardAttachment, setCocPartStandardAttachmentList,
  getReusableAttachmentList, getCocAttachmentList,
  saveDriveConfig, getCocPartDriveAltName, setCocPartDriveAltName,
  COC_ATTACHMENT_CATEGORIES,
} from './firestore';
import { saveSalesOrders, savePlanOverride, savePlanOverrides, removePlanOverride, saveShipments } from './firestore';
import { generateCocPdf, buildCocPdfBlob } from './cocPdf';
import { searchCocDrive, importCocDriveFile } from './driveClient';
import JSZip from 'jszip';
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

  // COC (Uygunluk Belgesi)
  const currentYearStr = String(new Date().getFullYear());
  const { cocParts } = useCocParts();
  const { cocCertificates } = useCocCertificates(currentYearStr);
  const [cocModalOrders, setCocModalOrders] = useState(null); // [order, ...] — açıkken modal göster
  const [cocSelected, setCocSelected] = useState(new Set()); // toplu COC için seçilen sipariş id'leri
  const toggleCocSelection = (orderId) => {
    setCocSelected(prev => {
      const s = new Set(prev);
      if (s.has(orderId)) s.delete(orderId); else s.add(orderId);
      return s;
    });
  };
  // Tek satır için modal aç (mevcut tek-COC akışı)
  const openCocModal = (order) => setCocModalOrders([order]);
  // Çoklu sipariş için modal aç (toplu COC)
  const openCocBulkModal = () => {
    if (cocSelected.size === 0) return;
    const list = [];
    for (const id of cocSelected) {
      const o = salesOrders[id];
      if (o) list.push({ id, ...o });
    }
    if (list.length === 0) return;
    setCocModalOrders(list);
  };
  const closeCocModal = () => {
    setCocModalOrders(null);
    setCocSelected(new Set()); // modal kapanınca seçim sıfırla
  };

  // Sipariş satırı rozetinden açılan COC detay modal'ı (arşive gitmeye gerek kalmadan)
  const [cocDetailFromBadge, setCocDetailFromBadge] = useState(null);
  // certNo verilince allCerts içinden aynı certNo'lu tüm satırları grupla (multi-line için)
  const openCocDetailFromBadge = (certNo) => {
    if (!certNo || !cocCertificates?.certificates) return;
    const lines = Object.values(cocCertificates.certificates)
      .filter(c => c.certNo === certNo)
      .sort((a, b) => (Number(a.siraNo) || 1) - (Number(b.siraNo) || 1));
    if (lines.length === 0) return;
    const first = lines[0];
    const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    setCocDetailFromBadge({
      ...first,
      lines,
      lineCount: lines.length,
      totalQty,
    });
  };

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
  const backfillFileInputRef = useRef(null);

  const [customerFilter, setCustomerFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState('date');
  const [lateExpanded, setLateExpanded] = useState(false);
  const [deferredExpanded, setDeferredExpanded] = useState(false);
  const [staleExpanded, setStaleExpanded] = useState(false);
  const [orphanExpanded, setOrphanExpanded] = useState(false);
  const [inconsistentExpanded, setInconsistentExpanded] = useState(false);
  const [vioSyncExpanded, setVioSyncExpanded] = useState(false);
  // Hafta listesi default kapalı — kullanıcı tıklayarak açar (accordion).
  const [weekExpanded, setWeekExpanded] = useState({});
  const toggleWeek = (w) => setWeekExpanded(prev => ({ ...prev, [w]: !prev[w] }));
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
      const currentPlan = ov?.plannedWeek || teslimWeek;
      // "Geciken" = effectiveWeek (override varsa o, yoksa teslim) < currentWeek.
      // Sayfadaki "⚠ Geciken (X sipariş)" kutusu ile aynı tanım. Kullanıcı override yapıp
      // ileri haftaya almışsa "geciken" sayılmaz — zaten yeni plan yapmış.
      const isLate = currentPlan < grouped.currentWeek;
      if (isLate && !includeLate) continue;
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
  // 2 kategoriye ayırıyoruz:
  // - "replacement": Aynı (belgeNo+stokKodu) güncel salesOrders'ta farklı ID ile var
  //   (VIO teslim tarihini güncelledi → 3-tuple ID değişti → migration atlandı). Bu durumda
  //   eski ID'nin sevk geçmişi yeni ID'ye taşınmaz → shipments'ta kayıt eksik (Kayıp B).
  // - "deleted": Gerçekten silinmiş, replacement yok. shipments'ta vio-removed event ile
  //   yakalanmış olmalı (sevk kaybı yok), planOverrides'ta sadece ölü kayıt kaldı.
  const orphanOverrides = useMemo(() => {
    if (!allLoaded) return [];
    // belgeNo+stokKodu → güncel salesOrders'taki ID'ler
    const newBelgeStokIndex = {};
    for (const [id, o] of Object.entries(salesOrders || {})) {
      if (!o?.belgeNo || !o?.stokKodu) continue;
      const key = `${o.belgeNo}|${o.stokKodu}`;
      if (!newBelgeStokIndex[key]) newBelgeStokIndex[key] = [];
      newBelgeStokIndex[key].push(id);
    }
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
        // Replacement tespiti — aynı belgeNo+stokKodu yeni salesOrders'ta var mı?
        const replacementIds = belgeNo && stokKodu
          ? (newBelgeStokIndex[`${belgeNo}|${stokKodu}`] || [])
          : [];
        const isReplacement = replacementIds.length > 0;
        return {
          id, belgeNo, stokKodu, teslimTarihi,
          orphanKind: isReplacement ? 'replacement' : 'deleted',
          replacementIds,
          ...ov,
        };
      })
      .sort((a, b) => {
        // replacement orphanlar (kayıp riski olan) önce
        if (a.orphanKind !== b.orphanKind) return a.orphanKind === 'replacement' ? -1 : 1;
        return (a.belgeNo || '').localeCompare(b.belgeNo || '');
      });
  }, [planOverrides, salesOrders, allLoaded]);

  // VIO Sevk Senkron Audit — aktif siparişlerde shipments.totalShipped < salesOrders.sevkEdilen
  // olan kayıtları tespit eder. Bu fark = Kayıp B'nin görünür yüzü: VIO daha fazla sevk gördüğünü
  // raporluyor ama bizim shipments'a yazılmamış (replacement migration eksiği, baseline kaybı, vs.)
  // Toplam kayıp tutarı tahmini: delta × birim fiyat. Vio-resync server-side eklenince otomatik
  // düzelir; şimdilik sadece raporlama.
  const vioSyncAudit = useMemo(() => {
    if (!allLoaded) return { count: 0, totalDelta: 0, totalLostTl: 0, byCustomer: {}, items: [] };
    const items = [];
    let totalDelta = 0, totalLostTl = 0;
    const byCustomer = {};
    for (const [id, o] of Object.entries(salesOrders || {})) {
      const vioShipped = Number(o?.sevkEdilen || 0);
      const shipDoc = shipments?.[id];
      const ourShipped = Number(shipDoc?.totalShipped || 0);
      if (vioShipped <= ourShipped) continue;
      const delta = vioShipped - ourShipped;
      // Birim fiyat fallback: shipment snapshot → salesOrders bedeli
      let unitPrice = Number(shipDoc?.unitPriceTl || 0);
      if (!unitPrice) {
        const orj = Number(o?.orijinalMiktar || 0);
        const bedel = Number(o?.toplamBedel || 0);
        if (orj > 0 && bedel > 0) unitPrice = bedel / orj;
      }
      const lostTl = delta * unitPrice;
      totalDelta += delta;
      totalLostTl += lostTl;
      const ck = o.customerCode || '?';
      if (!byCustomer[ck]) byCustomer[ck] = {
        customerCode: ck, customerName: o.customerName || '', count: 0, delta: 0, lostTl: 0,
      };
      byCustomer[ck].count++;
      byCustomer[ck].delta += delta;
      byCustomer[ck].lostTl += lostTl;
      items.push({
        id,
        belgeNo: o.belgeNo,
        stokKodu: o.stokKodu,
        stokAdi: o.stokAdi,
        customerCode: ck,
        customerName: o.customerName,
        teslimTarihi: o.teslimTarihi,
        ourShipped,
        vioShipped,
        delta,
        unitPrice,
        lostTl,
      });
    }
    items.sort((a, b) => b.lostTl - a.lostTl);
    return {
      count: items.length,
      totalDelta,
      totalLostTl,
      byCustomer: Object.values(byCustomer).sort((a, b) => b.lostTl - a.lostTl),
      items,
    };
  }, [salesOrders, shipments, allLoaded]);
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

  // Eski Excel'den fiyat backfill — geçmiş bug zamanında veya tam-sevk olup VIO'dan
  // düşmüş shipments için unitPriceTl boş kalmış olabilir. Eski Excel'i yükleyerek
  // sadece stokKodu × birim fiyat tablosu çıkarılır ve mevcut shipments'a uygulanır.
  // Önemli: salesOrders'a DOKUNMAZ — sadece shipments.unitPriceTl/toplamBedel doldurulur.
  const handleBackfillFile = async (file) => {
    if (!file || !isAdmin) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const result = parseSalesOrderExcel(wb);
      // Stok kodu → unitPriceTl map (Excel'deki her satır)
      const priceMap = {};
      for (const o of Object.values(result.ordersMap || {})) {
        const orj = Number(o?.orijinalMiktar || 0);
        const bedel = Number(o?.toplamBedel || 0);
        if (o?.stokKodu && orj > 0 && bedel > 0) {
          // Aynı stokKodu birden fazla satırda olabilir → ortalama veya son? Son alınır
          priceMap[o.stokKodu] = bedel / orj;
        }
      }
      const priceMapCount = Object.keys(priceMap).length;

      // Mevcut shipments'ı tara, fiyatsız olanları doldur (sadece stokKodu match)
      const newShipments = { ...shipments };
      let filled = 0;
      let stillMissing = 0;
      for (const [id, sh] of Object.entries(newShipments)) {
        if (!sh) continue;
        if (Number(sh.unitPriceTl) > 0) continue;  // zaten fiyatlı
        if (!sh.stokKodu) continue;
        const price = priceMap[sh.stokKodu];
        if (price > 0) {
          newShipments[id] = {
            ...sh,
            unitPriceTl: price,
            // toplamBedel hesapla — orijinalMiktar varsa
            ...(Number(sh.orijinalMiktar) > 0 && !sh.toplamBedel ? { toplamBedel: price * Number(sh.orijinalMiktar) } : {}),
          };
          filled++;
        } else {
          stillMissing++;
        }
      }

      if (filled > 0) {
        await saveShipments(newShipments, { canEdit });
      }
      setUploadResult({
        ok: true,
        message: `💵 Fiyat Backfill: ${priceMapCount} stok kodu Excel'den çıkarıldı · ${filled} shipment fiyatlandı${stillMissing > 0 ? ` · ${stillMissing} hâlâ eksik (Excel'de yok)` : ""}`,
      });
    } catch (e) {
      setUploadResult({ ok: false, message: `✗ Backfill hatası: ${e.message || String(e)}` });
    } finally {
      setUploading(false);
      if (backfillFileInputRef.current) backfillFileInputRef.current.value = '';
    }
  };

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
          // Birim fiyat snapshot — VIO'dan sevk olup salesOrders'tan düşse bile burada kalır.
          // toplamBedel / orijinalMiktar = TL/AD. Dashboard aylık TL hesabı için kritik.
          const orjMikt = Number(o.orijinalMiktar) || 0;
          const toplamBedel = Number(o.toplamBedel) || 0;
          const unitPriceTl = orjMikt > 0 ? toplamBedel / orjMikt : 0;
          newShipments[id] = {
            customerCode: o.customerCode || '',
            customerName: o.customerName || '',
            stokKodu: o.stokKodu || '',
            stokAdi: o.stokAdi || '',
            belgeNo: o.belgeNo || '',
            orijinalMiktar: orjMikt,
            toplamBedel,
            unitPriceTl,
            teslimTarihi: o.teslimTarihi || '',
            events: [],
            totalShipped: 0,
            fullyDelivered: false,
            firstShipAt: '',
            finalShipAt: '',
            lastUpdate: importedAt,
          };
        } else {
          // Backfill: mevcut shipment'ta unitPriceTl yoksa veya bedel/miktar field'ı eksikse,
          // bu import'taki salesOrders verisiyle güncelle. Eski shipment'lar için telafi.
          const sh = newShipments[id];
          if (!sh.unitPriceTl || !sh.toplamBedel) {
            const orjMikt = Number(o.orijinalMiktar) || sh.orijinalMiktar || 0;
            const toplamBedel = Number(o.toplamBedel) || 0;
            if (orjMikt > 0 && toplamBedel > 0) {
              sh.toplamBedel = toplamBedel;
              sh.unitPriceTl = toplamBedel / orjMikt;
              if (!sh.orijinalMiktar) sh.orijinalMiktar = orjMikt;
            }
          }
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
      // Replacement (3-tuple ID değişimi) sırasında eski ID için kümülatif sevk değerini
      // final event olarak kalıcı yazar. VIO yeni ID için sevkEdilen'i sıfırdan başlattığı
      // için vio-resync de yakalayamıyordu (cron + client aynı pattern).
      const captureReplacementFinal = (id, oldO) => {
        const oldSevkEdilen = Number(oldO.sevkEdilen || 0);
        if (oldSevkEdilen <= 0) return;
        ensureShipmentDoc(id, oldO);
        const sh = newShipments[id];
        const currentTotal = Number(sh.totalShipped || 0);
        if (oldSevkEdilen <= currentTotal) return;
        const delta = oldSevkEdilen - currentTotal;
        pushEvent(id, {
          at: importedAt,
          deltaQty: delta,
          cumulative: oldSevkEdilen,
          source: 'vio-replacement-final',
          final: true,
        });
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
              // Önleyici: eski ID için kümülatif sevkleri final event olarak yakala.
              captureReplacementFinal(id, oldO);
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
            // Önleyici: eski ID için kümülatif sevkleri final event olarak yakala.
            captureReplacementFinal(id, oldO);
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
      // 2b) vio-resync — VIO raporundaki sevkEdilen ile shipments.totalShipped sapması varsa kapat.
      //     Kayıp B (replacement migration sonrası baseline kaybı, diff atlamaları) kalıcı çözümü.
      //     Sadece vioTotal > ourTotal yönünde yazılır.
      let resyncCount = 0;
      for (const [id, newO] of Object.entries(result.ordersMap)) {
        const vioTotal = Number(newO.sevkEdilen || 0);
        if (vioTotal <= 0) continue;
        const shipDoc = newShipments[id];
        const ourTotal = Number(shipDoc?.totalShipped || 0);
        if (vioTotal <= ourTotal) continue;
        const delta = vioTotal - ourTotal;
        ensureShipmentDoc(id, newO);
        pushEvent(id, {
          at: importedAt,
          deltaQty: delta,
          cumulative: vioTotal,
          source: 'vio-resync',
        });
        resyncCount++;
      }
      // 3) Backfill pass — tüm mevcut shipments için, salesOrders'ta hâlâ aktif olanlardan
      // unitPriceTl + toplamBedel doldur (önceki bug zamanında bu alanlar yazılmadıysa).
      // event üretmese bile mevcut shipment'ın TL field'ları güncellenir.
      let backfillCount = 0;
      for (const [id, sh] of Object.entries(newShipments)) {
        if (sh.unitPriceTl && sh.toplamBedel) continue;
        const so = result.ordersMap[id];
        if (!so) continue;
        const orjMikt = Number(so.orijinalMiktar) || 0;
        const toplamBedel = Number(so.toplamBedel) || 0;
        if (orjMikt > 0 && toplamBedel > 0) {
          sh.toplamBedel = toplamBedel;
          sh.unitPriceTl = toplamBedel / orjMikt;
          if (!sh.orijinalMiktar) sh.orijinalMiktar = orjMikt;
          backfillCount++;
        }
      }
      // Save: salesOrders + shipments (event veya backfill varsa) + planOverrides
      await saveSalesOrders(result.ordersMap, { canEdit });
      if (eventCount > 0 || backfillCount > 0) {
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
      const resyncExtra = resyncCount > 0 ? ` · ${resyncCount} VIO sapma kapatıldı` : '';
      const backfillExtra = backfillCount > 0 ? ` · ${backfillCount} birim fiyat backfill` : '';
      setUploadResult({
        ok: true,
        message: `✓ ${result.rowCount} satır → ${result.orderCount} unique kayıt, ${result.customerCount} müşteri${extra}${shipExtra}${resyncExtra}${cancelExtra}${backfillExtra}`,
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
        {isAdmin && (
          <>
            <input
              ref={backfillFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => handleBackfillFile(e.target.files?.[0])}
            />
            <button
              onClick={() => backfillFileInputRef.current?.click()}
              disabled={uploading}
              title="Eski Excel'den fiyat lookup — sadece shipments.unitPriceTl boş olanları doldurur, salesOrders'a dokunmaz. Mayıs sevki gibi fiyatsız geçmiş kayıtlar için."
              style={{
                marginLeft: 8, padding: '6px 14px', borderRadius: 6, fontSize: 12,
                border: '1px solid #C2410C',
                background: 'transparent',
                color: '#C2410C',
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              💵 Eski Excel'den Fiyat Backfill
            </button>
          </>
        )}
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
              <button
                onClick={() => setViewMode('coc')}
                style={{
                  padding: '5px 10px', fontSize: 12, border: 'none',
                  background: viewMode === 'coc' ? '#534AB7' : '#fff',
                  color: viewMode === 'coc' ? '#fff' : '#44403c',
                  cursor: 'pointer', fontWeight: viewMode === 'coc' ? 500 : 400,
                  borderLeft: '1px solid #d6d3d1',
                }}
              >📄 Uygunluk Belgeleri</button>
              {isAdmin && (
                <button
                  onClick={() => setViewMode('driveConfig')}
                  style={{
                    padding: '5px 10px', fontSize: 12, border: 'none',
                    background: viewMode === 'driveConfig' ? '#534AB7' : '#fff',
                    color: viewMode === 'driveConfig' ? '#fff' : '#44403c',
                    cursor: 'pointer', fontWeight: viewMode === 'driveConfig' ? 500 : 400,
                    borderLeft: '1px solid #d6d3d1',
                  }}
                >🔌 Drive Ayarları</button>
              )}
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#78716c' }}>
              {viewMode === 'orders'
                ? `${grouped.kpi.totalRows} kayıt filtrede · ${overrideLabel}`
                : viewMode === 'products'
                ? `${productSummary.length} ürün · ${grouped.kpi.totalRows} sipariş`
                : 'COC arşivi'}
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

          {/* Uyarılar Çubuğu — 5 paneli kompakt rozetler halinde göster, tıkla → ilgili
              panel açılır. Default tüm paneller kapalı. Sayı 0 ise rozet gizli. */}
          {(grouped.staleOverrides.length > 0 || grouped.deferred.length > 0 ||
            (isAdmin && orphanOverrides.length > 0) ||
            grouped.inconsistentPairs.length > 0 ||
            (isAdmin && vioSyncAudit.count > 0)) && (
            <div style={{
              marginTop: 14, padding: '8px 12px', borderRadius: 8,
              background: '#fafaf9', border: '1px solid #e7e5e4',
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 11, color: '#78716c', fontWeight: 500, marginRight: 4 }}>⚠ Uyarılar:</span>
              {grouped.staleOverrides.length > 0 && (
                <button onClick={() => setStaleExpanded(!staleExpanded)} style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: '1px solid ' + (staleExpanded ? '#ca8a04' : '#fde68a'),
                  background: staleExpanded ? '#ca8a04' : '#fef3c7',
                  color: staleExpanded ? '#fff' : '#854d0e',
                }}>● {grouped.staleOverrides.length} VIO Termin Değişti</button>
              )}
              {grouped.deferred.length > 0 && (
                <button onClick={() => setDeferredExpanded(!deferredExpanded)} style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: '1px solid ' + (deferredExpanded ? '#57534e' : '#e7e5e4'),
                  background: deferredExpanded ? '#57534e' : '#f5f5f4',
                  color: deferredExpanded ? '#fff' : '#44403c',
                }}>⏸ {grouped.deferred.length} Akibeti Belirsiz</button>
              )}
              {isAdmin && orphanOverrides.length > 0 && (
                <button onClick={() => setOrphanExpanded(!orphanExpanded)} style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: '1px solid ' + (orphanExpanded ? '#b91c1c' : '#fecaca'),
                  background: orphanExpanded ? '#b91c1c' : '#fef2f2',
                  color: orphanExpanded ? '#fff' : '#991b1b',
                }}>⚠ {orphanOverrides.length} Orphan Override</button>
              )}
              {grouped.inconsistentPairs.length > 0 && (
                <button onClick={() => setInconsistentExpanded(!inconsistentExpanded)} style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: '1px solid ' + (inconsistentExpanded ? '#6b21a8' : '#ddd6fe'),
                  background: inconsistentExpanded ? '#6b21a8' : '#f3e8ff',
                  color: inconsistentExpanded ? '#fff' : '#6b21a8',
                }}>⇅ {grouped.inconsistentPairs.length} Plan Sırası Tutarsız</button>
              )}
              {isAdmin && vioSyncAudit.count > 0 && (
                <button onClick={() => setVioSyncExpanded(!vioSyncExpanded)} style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: '1px solid ' + (vioSyncExpanded ? '#92400e' : '#fde68a'),
                  background: vioSyncExpanded ? '#92400e' : '#fffbeb',
                  color: vioSyncExpanded ? '#fff' : '#92400e',
                }}>🔍 {vioSyncAudit.count} VIO Sevk Audit</button>
              )}
            </div>
          )}

          {/* Toplu COC bar — sipariş satırı checkbox'larından seçim yapıldığında görünür */}
          {cocSelected.size > 0 && (
            <div style={{
              marginTop: 14, padding: '10px 14px', borderRadius: 8,
              background: '#eff6ff', border: '1px solid #bfdbfe',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>📄 {cocSelected.size} sipariş satırı seçildi</span>
              <span style={{ fontSize: 11, color: '#1e3a8a' }}>
                — aynı stok kodlu satırlar tek COC'ta birleşir, farklıysa uyarı çıkar
              </span>
              <button onClick={() => setCocSelected(new Set())} style={{
                marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: 'pointer',
              }}>Seçimi Temizle</button>
              <button onClick={openCocBulkModal} disabled={!canEdit} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: '1px solid #1e40af', background: '#1e40af', color: '#fff',
                cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.5,
              }}>Toplu COC Oluştur</button>
            </div>
          )}

          {/* VIO Termin Değişti — sadece expand edilince görünür (uyarılar çubuğundan tetiklenir) */}
          {grouped.staleOverrides.length > 0 && staleExpanded && (
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

          {/* VIO Sevk Senkron Audit — admin only. salesOrders'taki sevkEdilen değeri ile
              shipments'taki totalShipped arasında fark olan kayıtlar. Bu fark = Kayıp B
              (replacement migration sonrası baseline kaybı, vs.) görünür yüzü. */}
          {isAdmin && vioSyncAudit.count > 0 && vioSyncExpanded && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#fffbeb', border: '1px solid #fcd34d',
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#92400e' }}>
                🔍 VIO Sevk Senkron Audit ({vioSyncAudit.count} sipariş · ~{formatMoney(vioSyncAudit.totalLostTl)} TL kayıp)
              </div>
              {true && (<>
              <div style={{ fontSize: 11, color: '#78716c', marginTop: 10, marginBottom: 10 }}>
                Bu siparişlerin VIO'da raporlanan <b>sevkEdilen</b> değeri, bizim <b>shipments.totalShipped</b> değerinden büyük.
                Yani VIO daha fazla sevk gördüğünü söylüyor ama bizim sevk geçmişinde kayıt yok (Kayıp B —
                3-tuple ID değişimi sonrası baseline kaybı, vb.). Vio-resync server-side eklenince otomatik düzelir.
              </div>
              {/* Müşteri bazlı kırılım */}
              <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {vioSyncAudit.byCustomer.map(c => (
                  <div key={c.customerCode} style={{
                    padding: '4px 10px', background: '#fff', borderRadius: 4,
                    border: '1px solid #fde68a', fontSize: 11,
                  }}>
                    <b>{c.customerCode}</b> {c.customerName ? ` · ${c.customerName.slice(0, 30)}` : ''} —
                    <span style={{ color: '#92400e', fontWeight: 600, marginLeft: 4 }}>
                      {c.count} sipariş · {formatMoney(c.lostTl)} TL
                    </span>
                  </div>
                ))}
              </div>
              {/* İlk 30 detay (overflow ise toplam göster) */}
              <div style={{ maxHeight: 240, overflowY: 'auto', background: '#fff', borderRadius: 6 }}>
                {vioSyncAudit.items.slice(0, 30).map(it => (
                  <div key={it.id} style={{
                    display: 'grid', gridTemplateColumns: '80px 120px 1fr 80px 90px 110px',
                    gap: 8, padding: '4px 10px', fontSize: 11, borderBottom: '1px solid #f5f5f4', alignItems: 'center',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#57534e' }}>{it.belgeNo}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{it.stokKodu}</span>
                    <span style={{ fontSize: 10, color: '#78716c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.stokAdi}>{it.stokAdi}</span>
                    <span style={{ fontSize: 10, color: '#57534e', textAlign: 'right' }}>
                      <span style={{ color: '#a8a29e' }}>biz:</span> {it.ourShipped}
                    </span>
                    <span style={{ fontSize: 10, color: '#92400e', fontWeight: 600, textAlign: 'right' }}>
                      <span style={{ color: '#a8a29e', fontWeight: 400 }}>VIO:</span> {it.vioShipped} <span style={{ color: '#dc2626' }}>(+{it.delta})</span>
                    </span>
                    <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 600, textAlign: 'right' }}>
                      {formatMoney(it.lostTl)} TL
                    </span>
                  </div>
                ))}
                {vioSyncAudit.items.length > 30 && (
                  <div style={{ padding: 8, fontSize: 10, color: '#78716c', textAlign: 'center' }}>
                    + {vioSyncAudit.items.length - 30} sipariş daha
                  </div>
                )}
              </div>
              </>)}
            </div>
          )}

          {/* Orphan override uyarısı — admin only.
              salesOrders'ta artık olmayan ama planOverrides'ta hâlâ duran ölü kayıtlar.
              Replacement detection (3-tuple ID değişimi) sonucu kalan deferred/cancelled. */}
          {isAdmin && orphanOverrides.length > 0 && orphanExpanded && (() => {
            const replacementCount = orphanOverrides.filter(o => o.orphanKind === 'replacement').length;
            const deletedCount = orphanOverrides.length - replacementCount;
            return (
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
                  — <b>{replacementCount}</b> replacement (sevk geçmişi kayıp riski) · <b>{deletedCount}</b> silinmiş (temiz)
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
                    const kindBadge = o.orphanKind === 'replacement'
                      ? { label: '↻ repl', bg: '#fef3c7', color: '#92400e', title: 'Replacement orphan — VIO\'da teslim tarihi değişmiş, sevk geçmişi kayıp riski yüksek' }
                      : { label: '✓ silinmiş', bg: '#dcfce7', color: '#166534', title: 'Gerçek silinme — shipments\'a vio-removed event ile yakalandı, temiz' };
                    return (
                      <div key={o.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                        fontSize: 12, borderBottom: '1px solid #f5f5f4',
                      }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          minWidth: 60, textAlign: 'center',
                          background: kindBadge.bg, color: kindBadge.color,
                        }} title={kindBadge.title}>{kindBadge.label}</span>
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
            );
          })()}

          {/* Plan Sırası Tutarsız — uyarılar çubuğundan tetiklenir */}
          {grouped.inconsistentPairs.length > 0 && inconsistentExpanded && (
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

          {/* Akibeti belirsiz kutusu — uyarılar çubuğundan tetiklenir */}
          {grouped.deferred.length > 0 && deferredExpanded && (
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
                  {renderOrderGroups(grouped.deferred, grouped.currentWeek, false, { canEdit, openPicker, planOverrides, bomSet, openCocModal, cocCertificates, cocParts, cocSelected, toggleCocSelection, openCocDetailFromBadge })}
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
                  {renderOrderGroups(grouped.late, grouped.currentWeek, true, { canEdit, openPicker, planOverrides, bomSet, openCocModal, cocCertificates, cocParts, cocSelected, toggleCocSelection, openCocDetailFromBadge })}
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
                  {renderOrderGroups(grouped.noWeek, grouped.currentWeek, false, { canEdit, openPicker, planOverrides, bomSet, openCocModal, cocCertificates, cocParts, cocSelected, toggleCocSelection, openCocDetailFromBadge })}
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
              grouped.weekOrder.map(w => {
                const isOpen = !!weekExpanded[w];
                return (
                <div key={w} style={{ marginBottom: 14 }}>
                  <div
                    onClick={() => toggleWeek(w)}
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
                    cursor: 'pointer',
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
                    <span style={{ fontSize: 11, color: '#78716c', minWidth: 50, textAlign: 'right' }}>
                      {isOpen ? 'gizle ▲' : 'aç ▼'}
                    </span>
                  </div>
                  {isOpen && renderOrderGroups(grouped.byWeek[w], grouped.currentWeek, false, { canEdit, openPicker, planOverrides, bomSet, openCocModal, cocCertificates, cocParts, cocSelected, toggleCocSelection, openCocDetailFromBadge })}
                </div>
                );
              })
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

          {viewMode === 'coc' && (
            <CocArchiveView searchText={searchText} customerFilter={customerFilter} canEdit={canEdit} cocParts={cocParts} />
          )}

          {viewMode === 'driveConfig' && (
            <DriveConfigView canEdit={canEdit && isAdmin} />
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

      {/* COC (Uygunluk Belgesi) oluşturma modal — sipariş satırı 📄 butonuna tıklanınca açılır.
          Pre-fill: müşteri/sipariş/stok/parça/FAİ/revizyon (cocParts master'dan). Kullanıcı düzenleyebilir:
          miktar (kısmi sevk), kontrol tarihi, seri no, feragat. Sertifika no auto-suggest (YYYYAA-NNN). */}
      {cocModalOrders && cocModalOrders.length > 0 && (
        <CocModal
          orders={cocModalOrders}
          cocParts={cocParts}
          cocCertificates={cocCertificates}
          canEdit={canEdit}
          onClose={closeCocModal}
        />
      )}

      {/* Sipariş rozetinden açılan COC detay modal — kullanıcı arşive gitmeden geçmiş COC'a bakabilir */}
      {cocDetailFromBadge && (
        <CocDetailModal
          cert={cocDetailFromBadge}
          canEdit={canEdit}
          onClose={() => setCocDetailFromBadge(null)}
        />
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
              // Form'daki anlık geciken sayısı — sayfadaki Geciken kutusu ile aynı tanım:
              // effectiveWeek (override varsa o, yoksa teslim haftası) < currentWeek.
              let lateCount = 0;
              for (const [id, o] of Object.entries(salesOrders || {})) {
                if (!o || !o.teslimTarihi) continue;
                if (Number(o.kalanMiktar || 0) <= 0) continue;
                if (autoPlanModal.customerFilter !== 'all' && o.customerCode !== autoPlanModal.customerFilter) continue;
                const ov = planOverrides[id];
                if (ov?.status === 'deferred' || ov?.status === 'cancelled') continue;
                const week = ov?.plannedWeek || getISOWeek(new Date(o.teslimTarihi + 'T00:00:00Z'));
                if (week < grouped.currentWeek) lateCount++;
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

// CSS Grid kolon tanımı — tüm satırlar (header + data) bu grid'i kullanır.
// Sıra: [seçim] [müşteri] [stok kodu] [stok adı (flex)] [kalan] [bedel] [teslim] [plan] [COC] [geç]
const ORDER_ROW_GRID = '20px 36px 170px minmax(180px, 1fr) 70px 90px 70px 110px 145px 50px';

function OrderRowHeader({ isLateContext, hasCocColumn }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: ORDER_ROW_GRID,
      gap: 8, padding: '4px 10px',
      fontSize: 9, fontWeight: 600, color: '#78716c',
      borderBottom: '1px solid #e7e5e4', background: '#fafaf9',
      textTransform: 'uppercase', letterSpacing: 0.3,
    }}>
      <span />
      <span style={{ textAlign: 'center' }}>MÜŞ</span>
      <span>STOK KODU</span>
      <span>STOK ADI</span>
      <span style={{ textAlign: 'right' }}>KALAN</span>
      <span style={{ textAlign: 'right' }}>BEDEL</span>
      <span style={{ textAlign: 'right' }}>TESLİM</span>
      <span style={{ textAlign: 'center' }}>PLAN</span>
      <span style={{ textAlign: 'center' }}>{hasCocColumn ? 'COC' : ''}</span>
      <span style={{ textAlign: 'center' }}>{isLateContext ? 'GEÇ' : ''}</span>
    </div>
  );
}

function renderOrderGroups(orders, currentWeek, isLateContext, ctx) {
  if (!orders || orders.length === 0) return null;
  // COC kolonu sadece A+R için anlamlı — listede A+R varsa kolon başlığı gösterilir
  const hasCocColumn = orders.some(o =>
    o.customerCode === '120-0107' || o.customerCode === '120-116' ||
    String(o.customerCode || '').startsWith('120-0107-') ||
    String(o.customerCode || '').startsWith('120-116-')
  );
  return (
    <>
      <OrderRowHeader isLateContext={isLateContext} hasCocColumn={hasCocColumn} />
      {groupByBelgeNo(orders).map((g, idx) => {
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
      })}
    </>
  );
}

function renderOrderRow(o, currentWeek, isLateContext, ctx) {
  const { canEdit, openPicker, planOverrides, bomSet, openCocModal, cocCertificates, cocParts, cocSelected, toggleCocSelection, openCocDetailFromBadge } = ctx;
  const badge = customerBadge(o.customerCode);
  const teslim = o.teslimTarihi ? new Date(o.teslimTarihi + 'T00:00:00Z') : null;
  const lateWeeks = isLateContext && o.effectiveWeek ? weeksBetween(o.effectiveWeek, currentWeek) : 0;
  const override = planOverrides?.[o.id];
  const vioCurrentWeek = teslim ? getISOWeek(teslim) : '';
  const vioChanged = override && override.origWeek && vioCurrentWeek && vioCurrentWeek !== override.origWeek;
  const bomMissing = bomSet && !bomSet.has(o.stokKodu);
  const isAR = o.customerCode === '120-0107' || o.customerCode === '120-116' ||
    String(o.customerCode || '').startsWith('120-0107-') ||
    String(o.customerCode || '').startsWith('120-116-');
  return (
    <div
      key={o.id}
      draggable={canEdit}
      onDragStart={canEdit ? (e) => {
        e.dataTransfer.setData('text/plain', o.id);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: ORDER_ROW_GRID,
        gap: 8, alignItems: 'center', padding: '5px 10px',
        fontSize: 12, borderBottom: '1px solid #f5f5f4',
        cursor: canEdit ? 'grab' : 'default',
        opacity: o.isDeferred ? 0.55 : 1,
        background: o.isDeferred ? 'rgba(120,113,108,0.05)' : 'transparent',
      }}>
      {/* 1) Seçim checkbox veya deferred ikonu */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {o.isDeferred ? (
          <span title="Akibeti belirsiz — MRP demand'ına dahil değil" style={{ color: '#78716c', fontSize: 12, lineHeight: 1 }}>⏸</span>
        ) : (toggleCocSelection && isAR ? (
          <input
            type="checkbox"
            checked={cocSelected?.has(o.id) || false}
            onChange={(e) => { e.stopPropagation(); toggleCocSelection(o.id); }}
            onClick={(e) => e.stopPropagation()}
            title="Toplu COC için seç"
            style={{ cursor: 'pointer', width: 14, height: 14, margin: 0 }}
          />
        ) : null)}
      </span>
      {/* 2) Müşteri rozeti */}
      <span style={{
        display: 'inline-block', padding: '2px 6px', borderRadius: 4,
        fontSize: 10, fontWeight: 600, textAlign: 'center',
        background: badge.bg, color: badge.fg, whiteSpace: 'nowrap',
      }}>{badge.label}</span>
      {/* 3) Stok kodu */}
      <span style={{
        fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11,
        color: '#1c1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {bomMissing && <span title="BOM yok — MRP → Ürün Ağacı'nda yükle" style={{ color: '#dc2626', marginRight: 4, fontWeight: 700 }}>❓</span>}
        {o.stokKodu}
      </span>
      {/* 4) Stok adı (esnek) */}
      <span style={{
        color: '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={o.stokAdi}>{o.stokAdi}</span>
      {/* 5) Kalan miktar */}
      <span style={{ color: '#78716c', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {o.kalanMiktar} {o.brm}
      </span>
      {/* 6) Bedel */}
      <span style={{ fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {formatMoney(o.toplamBedel)} TL
      </span>
      {/* 7) Teslim tarihi */}
      <span style={{ color: '#78716c', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>
        {teslim ? formatDateShort(teslim) : '—'}
      </span>
      {/* 8) Plan butonu */}
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
          textAlign: 'center', whiteSpace: 'nowrap',
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
      {/* 9) COC kolonu — sadece A+R için (kolonu hep göster, içerik şarta bağlı) */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
        {openCocModal && !o.isDeferred && isAR && (() => {
          const oRefNo = (o.refNo || '').trim();
          const oBelgeNo = (o.belgeNo || '').trim();
          const matchingCerts = Object.values(cocCertificates?.certificates || {}).filter(c => {
            if (c.stokKodu !== o.stokKodu) return false;
            const cOrderNo = (c.orderNo || '').trim();
            const cRefNo = (c.refNo || '').trim();
            const cVioBelgeNo = (c.vioBelgeNo || '').trim();
            if (oRefNo && (cOrderNo === oRefNo || cRefNo === oRefNo)) return true;
            if (oBelgeNo && (cOrderNo === oBelgeNo || cVioBelgeNo === oBelgeNo)) return true;
            return false;
          });
          const uniqueCerts = [...new Set(matchingCerts.map(c => c.certNo))];
          uniqueCerts.sort((a, b) => b.localeCompare(a));
          const latestCert = uniqueCerts.length > 0 ? matchingCerts.find(c => c.certNo === uniqueCerts[0]) : null;
          if (latestCert) {
            const stats = getCocAttachmentStats(latestCert);
            const isFull = stats.totalFiles > 0 && stats.filled === stats.totalCats;
            const isEmpty = stats.totalFiles === 0;
            const bg = isFull ? '#dcfce7' : isEmpty ? '#fef2f2' : '#fef3c7';
            const fg = isFull ? '#166534' : isEmpty ? '#991b1b' : '#92400e';
            const multiCocLabel = uniqueCerts.length > 1 ? ` +${uniqueCerts.length - 1}` : '';
            const tooltip = uniqueCerts.length > 1
              ? `Mevcut COC'lar: ${uniqueCerts.join(', ')}\nKısmi sevk için yeni COC eklemek için ➕ butonu`
              : `COC: ${latestCert.certNo} (${latestCert.controlDateIso || ''}) · ${stats.filled}/${stats.totalCats} doküman${stats.othersCount > 0 ? ` + ${stats.othersCount} ek` : ''}\nKısmi sevk varsa yeni COC için ➕ butonu`;
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); if (openCocDetailFromBadge) openCocDetailFromBadge(latestCert.certNo); }}
                  title={tooltip + '\n(Tıkla → COC detayını aç)'}
                  style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                    background: bg, color: fg, cursor: 'pointer', border: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                  }}
                >
                  <span>✓ {latestCert.certNo}{multiCocLabel}</span>
                  <span style={{ fontSize: 8, padding: '0 3px', borderRadius: 2, background: 'rgba(0,0,0,0.08)' }}>{stats.filled}/{stats.totalCats}</span>
                </button>
                {canEdit && (
                  <button
                    onClick={(e) => { e.stopPropagation(); openCocModal(o); }}
                    title={`Kısmi sevk veya yeni teslim için ek COC oluştur (mevcut: ${uniqueCerts.length} COC)`}
                    style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 11, fontWeight: 600, lineHeight: 1,
                      border: '1px solid #2563eb', background: '#eff6ff', color: '#1e40af', cursor: 'pointer',
                    }}
                  >➕</button>
                )}
              </span>
            );
          }
          return (
            <button
              onClick={(e) => { e.stopPropagation(); openCocModal(o); }}
              disabled={!canEdit}
              title="Uygunluk Belgesi (COC) oluştur"
              style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                border: '1px solid #2563eb', background: '#eff6ff', color: '#1e40af',
                cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.5, whiteSpace: 'nowrap',
              }}
            >📄 COC</button>
          );
        })()}
      </span>
      {/* 10) Geç rozet kolonu */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isLateContext && lateWeeks > 0 && (() => {
          const lc = lateWeeks >= 7 ? { bg: '#fecaca', fg: '#991b1b' }
                  : lateWeeks >= 3 ? { bg: '#fed7aa', fg: '#9a3412' }
                  : { bg: '#fef3c7', fg: '#854d0e' };
          return (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 3,
              background: lc.bg, color: lc.fg, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap',
            }}>
              {lateWeeks} hf
            </span>
          );
        })()}
      </span>
    </div>
  );
}

// ====================================================================
// COC (Uygunluk Belgesi) Modal — sipariş satırı 📄 butonundan açılır.
// Form: müşteri+sipariş+stok+parça read-only, revizyon dropdown, miktar editable
// (kısmi sevk), kontrol tarihi, seri no, feragat. Auto-suggest: sertifika no.
// ====================================================================
function CocModal({ orders, cocParts, cocCertificates, canEdit, onClose }) {
  const today = new Date();
  const yyyy = String(today.getFullYear());
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const todayIso = `${yyyy}-${mm}-${String(today.getDate()).padStart(2, '0')}`;

  // Çoklu sipariş kontrolü — hepsi aynı stokKodu mu?
  const orderList = Array.isArray(orders) ? orders : [orders];
  const firstOrder = orderList[0];
  const uniqueStokKodlari = [...new Set(orderList.map(o => o.stokKodu))];
  const stokMismatch = uniqueStokKodlari.length > 1;

  // Parça master (ilk siparişin stok kodu — tüm satırlar aynı stok varsayımı)
  const partMaster = cocParts?.parts?.[firstOrder.stokKodu] || null;

  // Sertifika no auto-suggest
  const suggestedCertNo = useMemo(() => suggestNextCertNo(cocCertificates?.certificates || {}, yyyy, mm), [cocCertificates, yyyy, mm]);

  // Ana form state
  const [certNo, setCertNo] = useState(suggestedCertNo);
  const [controlDate, setControlDate] = useState(todayIso);
  const [revision, setRevision] = useState(partMaster?.revisions?.[partMaster.revisions.length - 1] || '');
  const [feragatVar, setFeragatVar] = useState(false);
  const [feragatText, setFeragatText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Çoklu satır state — her sipariş için bir line item
  const [lineItems, setLineItems] = useState(() => orderList.map((o, i) => ({
    siraNo: i + 1,
    orderId: o.id || '',
    orderNo: (o.refNo && o.refNo.trim()) || o.belgeNo || '',
    refNo: o.refNo || '',
    vioBelgeNo: o.belgeNo || '',
    quantity: Number(o.kalanMiktar) || 0,
    serialNo: '---',
    hasRefNo: !!(o.refNo && o.refNo.trim()),
  })));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const customerMeta = (firstOrder.customerCode === '120-0107' || String(firstOrder.customerCode || '').startsWith('120-0107-'))
    ? { name: 'ASELSAN KONYA SİLAH SİSTEMLERİ A.Ş.', address: 'Aşağıpınarbaşı, Fatih Sultan Mehmet Cd. No:2, 42280 Selçuklu/Konya' }
    : (firstOrder.customerCode === '120-116' || String(firstOrder.customerCode || '').startsWith('120-116-'))
    ? { name: 'ROKETSAN ROKET SANAYİİ VE TİCARET A.Ş.', address: 'Kemalpaşa Mah. Şehit Yüzbaşı Adem Kutlu Sok., Elmadağ/Ankara' }
    : { name: firstOrder.customerName || '', address: '' };

  const totalQty = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0), 0);

  const updateLine = (idx, key, val) => {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [key]: val } : li));
  };
  const removeLine = (idx) => {
    setLineItems(prev => prev.filter((_, i) => i !== idx).map((li, i) => ({ ...li, siraNo: i + 1 })));
  };

  // Tek line için sertifika objesi (her line ayrı kayıt yazılır)
  const buildCertForLine = (li) => ({
    certNo,
    siraNo: String(li.siraNo),
    controlDateIso: controlDate,
    kayitTarihi: `${yyyy} - ${mm}`,
    customerCode: firstOrder.customerCode,
    customerName: customerMeta.name,
    customerAddress: customerMeta.address,
    orderNo: li.orderNo,
    refNo: li.refNo,
    vioBelgeNo: li.vioBelgeNo,
    stokKodu: firstOrder.stokKodu,
    description: partMaster?.description || firstOrder.stokAdi || '',
    faiNo: partMaster?.faiNo || '',
    revisionCode: revision,
    quantity: String(li.quantity),
    serialNo: li.serialNo,
    feragatText: feragatVar ? feragatText : '',
    feragatStatus: feragatVar ? 'VAR' : 'YOK',
    source: 'ui',
  });

  // PDF için tek cert objesi — birden fazla line varsa lineItems array'i ekle
  const buildCertForPdf = () => {
    const base = buildCertForLine(lineItems[0]);
    return {
      ...base,
      siraNo: '1', // PDF'de hep 1'den başlar
      lineItems: lineItems.map(li => ({
        siraNo: li.siraNo,
        orderNo: li.orderNo,
        quantity: li.quantity,
        serialNo: li.serialNo,
      })),
      // Multi-line için: toplam adet base.quantity'ye yazılır (geriye dönük PDF için)
      quantity: String(totalQty),
    };
  };

  const validate = () => {
    if (stokMismatch) {
      setError(`Farklı stok kodları seçildi (${uniqueStokKodlari.join(', ')}). Her stok için ayrı COC oluştur.`);
      return false;
    }
    if (!certNo || !/^\d{6}-\d{3,}$/.test(certNo)) {
      setError('Sertifika no formatı: YYYYAA-NNN (örn. 202606-038)');
      return false;
    }
    if (lineItems.length === 0) {
      setError('En az 1 satır olmalı');
      return false;
    }
    for (const li of lineItems) {
      if (!li.orderNo || !li.orderNo.trim()) {
        setError(`Sıra ${li.siraNo}: Sipariş no boş`);
        return false;
      }
      if (!li.quantity || li.quantity <= 0) {
        setError(`Sıra ${li.siraNo}: Miktar 0'dan büyük olmalı`);
        return false;
      }
    }
    return true;
  };

  const saveAllLines = async () => {
    // Her line için ayrı saveCocCertificate çağrısı (siraNo farklı → ID farklı)
    for (const li of lineItems) {
      await saveCocCertificate(buildCertForLine(li), { canEdit });
    }
  };

  const handleSave = async () => {
    if (!canEdit || !validate()) return;
    setSaving(true);
    setError('');
    try {
      await saveAllLines();
      onClose();
    } catch (e) {
      setError(e.message || 'Kaydetme hatası');
      setSaving(false);
    }
  };

  const handleSaveAndPdf = async () => {
    if (!canEdit || !validate()) return;
    setSaving(true);
    setError('');
    try {
      await saveAllLines();
      await generateCocPdf(buildCertForPdf());
      onClose();
    } catch (e) {
      setError(e.message || 'Kaydetme veya PDF hatası');
      setSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.45)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 10, padding: 0,
        maxWidth: 860, width: '100%', maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        {/* Başlık */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📄</span>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e40af' }}>
            Uygunluk Belgesi (COC) Oluştur
            {lineItems.length > 1 && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: '#1e3a8a' }}>· {lineItems.length} satır</span>}
          </h3>
          <button onClick={() => !saving && onClose()} disabled={saving} style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, fontSize: 12,
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: saving ? 'not-allowed' : 'pointer',
          }}>Kapat ✕</button>
        </div>

        {/* Müşteri + stok özet (read-only) */}
        <div style={{ padding: '14px 20px', background: '#f9fafb', borderBottom: '1px solid #e7e5e4', fontSize: 12 }}>
          {stokMismatch && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11, color: '#991b1b' }}>
              ⚠ Farklı stok kodlu satırlar seçildi: <b>{uniqueStokKodlari.join(', ')}</b>. COC tek bir parça için olur — her stok için ayrı seçim yapıp ayrı COC oluştur.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px' }}>
            <span style={{ color: '#78716c' }}>Müşteri:</span>
            <span style={{ fontWeight: 500 }}>{customerMeta.name}</span>
            <span style={{ color: '#78716c' }}>Adres:</span>
            <span style={{ fontSize: 11, color: '#57534e' }}>{customerMeta.address}</span>
            <span style={{ color: '#78716c' }}>Stok Kodu:</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>{firstOrder.stokKodu}</span>
            <span style={{ color: '#78716c' }}>Parça Adı:</span>
            <span>{partMaster?.description || firstOrder.stokAdi || <span style={{ color: '#a8a29e', fontStyle: 'italic' }}>(parça master'da yok)</span>}</span>
            <span style={{ color: '#78716c' }}>FAİ Kodu:</span>
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>
              {partMaster?.faiNo || <span style={{ color: '#a8a29e', fontStyle: 'italic' }}>—</span>}
            </span>
          </div>
        </div>

        {/* Form alanları */}
        <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Sertifika no */}
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>
              Sertifika No * <span style={{ color: '#a8a29e', fontWeight: 400 }}>(önerilen: {suggestedCertNo})</span>
            </label>
            <input
              type="text"
              value={certNo}
              onChange={(e) => setCertNo(e.target.value)}
              disabled={saving}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}
            />
          </div>

          {/* Kontrol tarihi */}
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>Kontrol Tarihi *</label>
            <input
              type="date"
              value={controlDate}
              onChange={(e) => setControlDate(e.target.value)}
              disabled={saving}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 12 }}
            />
          </div>

          {/* Revizyon */}
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>
              Revizyon Kodu * {!partMaster && <span style={{ color: '#dc2626' }}>(parça master'da yok — manuel gir)</span>}
            </label>
            {partMaster && partMaster.revisions?.length > 0 ? (
              <select value={revision} onChange={(e) => setRevision(e.target.value)} disabled={saving}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 12 }}>
                {partMaster.revisions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                disabled={saving}
                placeholder="örn. AA, D01"
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}
              />
            )}
          </div>

          {/* Feragat */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <input type="checkbox" checked={feragatVar} onChange={(e) => setFeragatVar(e.target.checked)} disabled={saving} />
              Feragat var
            </label>
            {feragatVar && (
              <textarea
                value={feragatText}
                onChange={(e) => setFeragatText(e.target.value)}
                disabled={saving}
                rows={3}
                placeholder="Feragat metni..."
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 11, fontFamily: 'inherit' }}
              />
            )}
          </div>
        </div>

        {/* Sevkiyat tablosu (multi-line) */}
        <div style={{ padding: '0 20px 14px', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500 }}>
              Sevkiyat Satırları ({lineItems.length}) · Toplam: <b>{totalQty}</b> adet
            </label>
          </div>
          <div style={{ border: '1px solid #e7e5e4', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#f5f5f4', textAlign: 'left', color: '#44403c' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 10, width: 40 }}>SIRA</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 10 }}>SİPARİŞ NO *</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 10, width: 100, textAlign: 'right' }}>MİKTAR *</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 10 }}>SERİ NO</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 10, width: 40, textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, idx) => (
                  <tr key={idx} style={{ borderTop: '1px solid #f5f5f4' }}>
                    <td style={{ padding: '4px 8px', fontWeight: 600, color: '#1e40af', textAlign: 'center' }}>{li.siraNo}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="text"
                        value={li.orderNo}
                        onChange={(e) => updateLine(idx, 'orderNo', e.target.value)}
                        disabled={saving}
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid #d6d3d1', borderRadius: 3, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
                      />
                      {!li.hasRefNo && (
                        <div style={{ fontSize: 9, color: '#92400e', marginTop: 2 }}>⚠ Ref.No yok — VIO belge no kullanıldı</div>
                      )}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        value={li.quantity}
                        onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value) || 0)}
                        disabled={saving}
                        min="1"
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid #d6d3d1', borderRadius: 3, fontSize: 11, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="text"
                        value={li.serialNo}
                        onChange={(e) => updateLine(idx, 'serialNo', e.target.value)}
                        disabled={saving}
                        placeholder="---"
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid #d6d3d1', borderRadius: 3, fontSize: 11 }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      {lineItems.length > 1 && (
                        <button
                          onClick={() => removeLine(idx)}
                          disabled={saving}
                          title="Bu satırı kaldır"
                          style={{
                            padding: '2px 6px', borderRadius: 3, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer',
                            border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                          }}
                        >🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Hata */}
        {error && (
          <div style={{ margin: '0 20px 12px', padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11, color: '#991b1b' }}>
            ⚠ {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e7e5e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={() => !saving && onClose()} disabled={saving} style={{
            padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: saving ? 'not-allowed' : 'pointer',
          }}>İptal</button>
          <button onClick={handleSave} disabled={saving || !canEdit} style={{
            padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            border: '1px solid #1e40af', background: '#fff', color: '#1e40af',
            cursor: (saving || !canEdit) ? 'not-allowed' : 'pointer', opacity: (saving || !canEdit) ? 0.6 : 1,
          }}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
          <button onClick={handleSaveAndPdf} disabled={saving || !canEdit} style={{
            padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            border: '1px solid #1e40af', background: '#1e40af', color: '#fff',
            cursor: (saving || !canEdit) ? 'not-allowed' : 'pointer', opacity: (saving || !canEdit) ? 0.6 : 1,
          }}>📄 {saving ? 'İşleniyor...' : 'Kaydet ve PDF İndir'}</button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// COC (Uygunluk Belgesi) Arşiv Görünümü — viewMode='coc' altında.
// 2024-2025-2026 yıllarındaki tüm sertifikalar (1679 + UI'dan eklenenler) tek listede.
// Filtreler: müşteri (DigerMusteriler üst filtresinden), yıl, arama (certNo/orderNo/stokKodu/desc).
// Tıkla → detay modal + PDF tekrar üret.
// ====================================================================
function CocArchiveView({ searchText, customerFilter, canEdit, cocParts }) {
  const currentYear = new Date().getFullYear();
  const yearList = useMemo(() => {
    return [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear].map(String);
  }, [currentYear]);
  const { certificates, byYear, loaded } = useCocCertificatesMulti(yearList);
  const [yearFilter, setYearFilter] = useState('all');
  const [detailCert, setDetailCert] = useState(null);
  const [cocSearch, setCocSearch] = useState('');
  // Alt-tab: 'certificates' (sertifika arşivi) | 'parts' (parça master yönetimi)
  const [subTab, setSubTab] = useState('certificates');

  // Filtreleme + sıralama — üst ana arama VE coc-specific aramayı birleştir
  // Filtreden geçen ham satırlar
  const filteredRaw = useMemo(() => {
    const qMain = (searchText || '').trim().toLocaleLowerCase('tr-TR');
    const qCoc = (cocSearch || '').trim().toLocaleLowerCase('tr-TR');
    const list = Object.values(certificates).filter(c => {
      if (!c?.certNo) return false;
      if (yearFilter !== 'all' && c.certNo.substring(0, 4) !== yearFilter) return false;
      if (customerFilter && customerFilter !== 'all' && c.customerCode !== customerFilter) return false;
      const hay = `${c.certNo} ${c.orderNo || ''} ${c.stokKodu || ''} ${c.description || ''} ${c.serialNo || ''}`.toLocaleLowerCase('tr-TR');
      if (qMain && !hay.includes(qMain)) return false;
      if (qCoc && !hay.includes(qCoc)) return false;
      return true;
    });
    return list;
  }, [certificates, yearFilter, customerFilter, searchText, cocSearch]);

  // certNo bazlı grupla — multi-line COC'larda her satır ayrı kayıt olarak Firestore'da
  // saklanıyor ama UI'da tek bir COC gibi göstermek gerek (kullanıcı görüş).
  // Grup içindeki tüm satırlar lines[] array'inde, üst satır gösterim için ilk satır kullanılır.
  const filtered = useMemo(() => {
    const byCertNo = {};
    for (const c of filteredRaw) {
      if (!byCertNo[c.certNo]) byCertNo[c.certNo] = [];
      byCertNo[c.certNo].push(c);
    }
    const groups = Object.entries(byCertNo).map(([certNo, lines]) => {
      const sortedLines = [...lines].sort((a, b) => (Number(a.siraNo) || 1) - (Number(b.siraNo) || 1));
      const first = sortedLines[0];
      const totalQty = sortedLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
      return {
        ...first,                  // ilk satır metadata (müşteri, kontrol tarihi, stok, vs.)
        lines: sortedLines,        // tüm satırlar (detay modal + PDF için)
        lineCount: sortedLines.length,
        totalQty,
      };
    });
    groups.sort((a, b) => (b.certNo || '').localeCompare(a.certNo || ''));
    return groups;
  }, [filteredRaw]);

  const yearCounts = useMemo(() => {
    const out = {};
    for (const y of yearList) out[y] = Object.keys(byYear[y] || {}).length;
    return out;
  }, [byYear, yearList]);

  return (
    <div style={{ marginTop: 16 }}>
      {/* Alt-tab geçişi: Sertifikalar / Parça Master */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid #e7e5e4' }}>
        <button onClick={() => setSubTab('certificates')} style={{
          padding: '8px 14px', fontSize: 12, border: 'none', background: 'transparent',
          color: subTab === 'certificates' ? '#1e40af' : '#78716c',
          fontWeight: subTab === 'certificates' ? 600 : 400,
          borderBottom: '2px solid ' + (subTab === 'certificates' ? '#1e40af' : 'transparent'),
          cursor: 'pointer', marginBottom: -1,
        }}>📋 Sertifikalar ({Object.keys(certificates).length})</button>
        <button onClick={() => setSubTab('parts')} style={{
          padding: '8px 14px', fontSize: 12, border: 'none', background: 'transparent',
          color: subTab === 'parts' ? '#1e40af' : '#78716c',
          fontWeight: subTab === 'parts' ? 600 : 400,
          borderBottom: '2px solid ' + (subTab === 'parts' ? '#1e40af' : 'transparent'),
          cursor: 'pointer', marginBottom: -1,
        }}>🔧 Parça Master ({Object.keys(cocParts?.parts || {}).length})</button>
      </div>

      {subTab === 'parts' && (
        <CocPartsView cocParts={cocParts} customerFilter={customerFilter} searchText={searchText} canEdit={canEdit} />
      )}

      {subTab === 'certificates' && (<>
      {/* Üst kontrol — yıl filtreleri */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        padding: '8px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e7e5e4',
      }}>
        <span style={{ fontSize: 11, color: '#57534e', fontWeight: 500, marginRight: 4 }}>Yıl:</span>
        <button onClick={() => setYearFilter('all')} style={{
          padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: 'pointer',
          border: '1px solid ' + (yearFilter === 'all' ? '#1e40af' : '#d6d3d1'),
          background: yearFilter === 'all' ? '#1e40af' : '#fff',
          color: yearFilter === 'all' ? '#fff' : '#44403c',
        }}>Hepsi ({Object.values(yearCounts).reduce((s, n) => s + n, 0)})</button>
        {yearList.map(y => (
          <button key={y} onClick={() => setYearFilter(y)} style={{
            padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            border: '1px solid ' + (yearFilter === y ? '#1e40af' : '#d6d3d1'),
            background: yearFilter === y ? '#1e40af' : '#fff',
            color: yearFilter === y ? '#fff' : '#44403c',
          }}>{y} ({yearCounts[y] || 0})</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#78716c' }}>
          {loaded ? `${filtered.length} kayıt görüntüleniyor` : 'yükleniyor…'}
        </span>
      </div>

      {/* COC-specific arama */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="🔍 Sertifika no, sipariş no, stok kodu, tanım, seri no ile ara..."
          value={cocSearch}
          onChange={(e) => setCocSearch(e.target.value)}
          style={{
            flex: 1, padding: '7px 12px', borderRadius: 6, border: '1px solid #d6d3d1',
            fontSize: 12, outline: 'none',
          }}
        />
        {cocSearch && (
          <button onClick={() => setCocSearch('')} style={{
            padding: '6px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c',
          }}>Temizle</button>
        )}
      </div>

      {/* Tablo */}
      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f5f5f4', textAlign: 'left', color: '#44403c' }}>
              <th style={cocTh}>Sertifika No</th>
              <th style={cocTh}>Kontrol Tarihi</th>
              <th style={cocTh}>Müşteri</th>
              <th style={cocTh}>Sipariş No</th>
              <th style={cocTh}>Stok Kodu</th>
              <th style={{ ...cocTh, minWidth: 240 }}>Tanım</th>
              <th style={{ ...cocTh, textAlign: 'right' }}>Miktar</th>
              <th style={cocTh}>Seri No</th>
              <th style={{ ...cocTh, textAlign: 'center' }}>Doküman</th>
              <th style={{ ...cocTh, textAlign: 'center' }}>Feragat</th>
              <th style={{ ...cocTh, textAlign: 'center', width: 50 }}>Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 30, textAlign: 'center', color: '#a8a29e', fontSize: 12 }}>
                {loaded ? 'Filtre/aramaya uyan COC kaydı bulunamadı' : 'Yükleniyor…'}
              </td></tr>
            ) : filtered.slice(0, 500).map(c => {
              const badge = customerBadge(c.customerCode);
              const fStatus = c.feragatStatus || (c.feragatText ? 'VAR' : 'YOK');
              const isMulti = c.lineCount > 1;
              return (
                <tr key={c.certNo} style={{ borderTop: '1px solid #f5f5f4' }}>
                  <td style={{ ...cocTd, fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#1e40af' }}>
                    {c.certNo}
                    {isMulti && <span title={`${c.lineCount} satırlı COC`} style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>{c.lineCount} satır</span>}
                  </td>
                  <td style={{ ...cocTd, color: '#57534e' }}>{c.controlDateIso || '—'}</td>
                  <td style={cocTd}>
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                      background: badge.bg, color: badge.fg,
                    }}>{badge.label}</span>
                  </td>
                  <td style={{ ...cocTd, fontFamily: 'ui-monospace, monospace' }}>
                    {isMulti ? <span style={{ color: '#78716c', fontSize: 10 }} title={c.lines.map(l => l.orderNo).join(', ')}>{c.lineCount} sipariş</span> : (c.orderNo || '—')}
                  </td>
                  <td style={{ ...cocTd, fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>{c.stokKodu || '—'}</td>
                  <td style={{ ...cocTd, color: '#44403c', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.description}>{c.description || '—'}</td>
                  <td style={{ ...cocTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: isMulti ? 600 : 400 }}>{isMulti ? c.totalQty : (c.quantity || '—')}</td>
                  <td style={{ ...cocTd, color: '#78716c', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={isMulti ? c.lines.map(l => l.serialNo).join(' | ') : c.serialNo}>
                    {isMulti ? <span style={{ fontSize: 10 }}>(çoklu)</span> : (c.serialNo || '—')}
                  </td>
                  <td style={{ ...cocTd, textAlign: 'center' }}>
                    {(() => {
                      const stats = getCocAttachmentStats(c);
                      if (stats.totalFiles === 0) {
                        return <span title="Hiç doküman yok" style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: '#fef2f2', color: '#991b1b' }}>0/{stats.totalCats}</span>;
                      }
                      const isFull = stats.filled === stats.totalCats;
                      return (
                        <span title={`${stats.filled}/${stats.totalCats} kategori dolu · toplam ${stats.totalFiles} dosya`} style={{
                          padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                          background: isFull ? '#dcfce7' : '#fef3c7',
                          color: isFull ? '#166534' : '#92400e',
                        }}>
                          {isFull ? '✓' : '⚠'} {stats.filled}/{stats.totalCats}{stats.othersCount > 0 ? `+${stats.othersCount}` : ''}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ ...cocTd, textAlign: 'center' }}>
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                      background: fStatus === 'VAR' ? '#fef2f2' : '#f0fdf4',
                      color: fStatus === 'VAR' ? '#991b1b' : '#166534',
                    }}>{fStatus}</span>
                  </td>
                  <td style={{ ...cocTd, textAlign: 'center' }}>
                    <button onClick={() => setDetailCert(c)} title="Detay göster" style={{
                      padding: '2px 6px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                      border: '1px solid #d6d3d1', background: '#fff', color: '#44403c',
                    }}>👁</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div style={{ padding: 10, fontSize: 11, color: '#78716c', textAlign: 'center', background: '#fafaf9', borderTop: '1px solid #e7e5e4' }}>
            İlk 500 kayıt gösteriliyor — arama veya yıl filtresiyle daraltın
          </div>
        )}
      </div>

      {/* Detay modal */}
      {detailCert && <CocDetailModal cert={detailCert} canEdit={canEdit} onClose={() => setDetailCert(null)} />}
      </>)}
    </div>
  );
}

const cocTh = { padding: '8px 10px', fontWeight: 600, fontSize: 10, borderBottom: '1px solid #e7e5e4' };
const cocTd = { padding: '6px 10px', fontSize: 11 };

// COC Detay Modal — geçmiş sertifika bilgileri + PDF tekrar üret + düzenle + sil
function CocDetailModal({ cert: initialCert, canEdit, onClose }) {
  const [cert, setCert] = useState(initialCert);
  const [generating, setGenerating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  // Edit form state
  const [editForm, setEditForm] = useState(cert);

  const busy = generating || saving || deleting;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const handleDownload = async () => {
    setGenerating(true);
    try {
      // Multi-line COC: cert.lines varsa hepsini lineItems formatına çevir, PDF tek belgede basar
      const certForPdf = (cert.lines && cert.lines.length > 1) ? {
        ...cert,
        siraNo: '1',
        lineItems: cert.lines.map(l => ({
          siraNo: l.siraNo,
          orderNo: l.orderNo,
          quantity: l.quantity,
          serialNo: l.serialNo,
        })),
        quantity: String(cert.totalQty || cert.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)),
      } : cert;
      await generateCocPdf(certForPdf);
    } catch (e) {
      alert('PDF üretim hatası: ' + (e.message || e));
    } finally {
      setGenerating(false);
    }
  };

  const handleStartEdit = () => {
    setEditForm({ ...cert });
    setEditMode(true);
    setError('');
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditForm(cert);
    setError('');
  };

  const handleSaveEdit = async () => {
    if (!canEdit) return;
    if (!editForm.certNo || !/^\d{6}[-/]\d{3,}$/.test(editForm.certNo)) {
      setError('Sertifika no formatı: YYYYAA-NNN');
      return;
    }
    // Sertifika no yıl değişimini engelle (year-bazlı doc'a göre yazılıyor)
    if (editForm.certNo.substring(0, 4) !== cert.certNo.substring(0, 4)) {
      setError('Sertifika no yıl değiştirilemez (kayıt başka yıl doc\'una taşınmaz)');
      return;
    }
    const qty = Number(editForm.quantity);
    if (!qty || qty <= 0) {
      setError('Miktar 0\'dan büyük olmalı');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = {
        ...editForm,
        feragatStatus: editForm.feragatText ? 'VAR' : 'YOK',
      };
      await updateCocCertificate(updated, { canEdit });
      setCert(updated);
      setEditMode(false);
    } catch (e) {
      setError(e.message || 'Güncelleme hatası');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit) return;
    setDeleting(true);
    setError('');
    try {
      // Multi-line: tüm satırları sil (cert.lines varsa her birinin siraNo'su için ayrı çağrı)
      if (cert.lines && cert.lines.length > 1) {
        for (const l of cert.lines) {
          await deleteCocCertificate(cert.certNo, l.siraNo || '1', { canEdit });
        }
      } else {
        await deleteCocCertificate(cert.certNo, cert.siraNo || '1', { canEdit });
      }
      onClose();
    } catch (e) {
      setError(e.message || 'Silme hatası');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const fStatus = cert.feragatStatus || (cert.feragatText ? 'VAR' : 'YOK');

  // Edit form helper
  const updateField = (key, val) => setEditForm(prev => ({ ...prev, [key]: val }));
  const editInput = { padding: '4px 8px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 12, width: '100%', boxSizing: 'border-box' };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.45)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 10, padding: 0,
        maxWidth: 680, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📄</span>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e40af' }}>
              {cert.certNo}{editMode && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: '#c2410c' }}>(düzenleniyor)</span>}
            </h3>
            <div style={{ fontSize: 10, color: '#78716c' }}>{cert.controlDateIso} · {cert.customerName}</div>
          </div>
          <button onClick={() => !busy && onClose()} disabled={busy} style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, fontSize: 12,
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: busy ? 'not-allowed' : 'pointer',
          }}>Kapat ✕</button>
        </div>

        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 14px', fontSize: 12, alignItems: 'center' }}>
          <span style={{ color: '#78716c' }}>Sertifika No:</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{cert.certNo}</span>

          <span style={{ color: '#78716c' }}>Kontrol Tarihi:</span>
          {editMode
            ? <input type="date" value={editForm.controlDateIso || ''} onChange={(e) => updateField('controlDateIso', e.target.value)} style={editInput} />
            : <span>{cert.controlDateIso || '—'}</span>}

          <span style={{ color: '#78716c' }}>Müşteri:</span>
          <span style={{ fontWeight: 500 }}>{cert.customerName}</span>

          <span style={{ color: '#78716c' }}>Adres:</span>
          <span style={{ fontSize: 11, color: '#57534e' }}>{cert.customerAddress || '—'}</span>

          {(!cert.lines || cert.lines.length <= 1) && (<>
            <span style={{ color: '#78716c' }}>Sipariş No:</span>
            {editMode
              ? <input type="text" value={editForm.orderNo || ''} onChange={(e) => updateField('orderNo', e.target.value)} style={{ ...editInput, fontFamily: 'ui-monospace, monospace' }} />
              : <span style={{ fontFamily: 'ui-monospace, monospace' }}>{cert.orderNo || '—'}</span>}
          </>)}

          <span style={{ color: '#78716c' }}>Stok Kodu:</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{cert.stokKodu || '—'}</span>

          <span style={{ color: '#78716c' }}>Parça Adı:</span>
          {editMode
            ? <input type="text" value={editForm.description || ''} onChange={(e) => updateField('description', e.target.value)} style={editInput} />
            : <span>{cert.description || '—'}</span>}

          <span style={{ color: '#78716c' }}>FAİ Kodu:</span>
          {editMode
            ? <input type="text" value={editForm.faiNo || ''} onChange={(e) => updateField('faiNo', e.target.value)} style={{ ...editInput, fontFamily: 'ui-monospace, monospace' }} />
            : <span style={{ fontFamily: 'ui-monospace, monospace' }}>{cert.faiNo || '—'}</span>}

          <span style={{ color: '#78716c' }}>Revizyon:</span>
          {editMode
            ? <input type="text" value={editForm.revisionCode || ''} onChange={(e) => updateField('revisionCode', e.target.value)} style={{ ...editInput, fontFamily: 'ui-monospace, monospace' }} />
            : <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{cert.revisionCode || '—'}</span>}

          {(!cert.lines || cert.lines.length <= 1) && (<>
            <span style={{ color: '#78716c' }}>Miktar:</span>
            {editMode
              ? <input type="number" min="1" value={editForm.quantity || ''} onChange={(e) => updateField('quantity', e.target.value)} style={editInput} />
              : <span style={{ fontWeight: 600 }}>{cert.quantity || '—'}</span>}

            <span style={{ color: '#78716c' }}>Seri No:</span>
            {editMode
              ? <input type="text" value={editForm.serialNo || ''} onChange={(e) => updateField('serialNo', e.target.value)} style={editInput} />
              : <span>{cert.serialNo || '—'}</span>}
          </>)}

          {cert.lines && cert.lines.length > 1 && (<>
            <span style={{ color: '#78716c', alignSelf: 'start', paddingTop: 4 }}>Satırlar:</span>
            <div style={{ border: '1px solid #e7e5e4', borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#f5f5f4', textAlign: 'left' }}>
                    <th style={{ padding: '5px 8px', fontSize: 10, fontWeight: 600, width: 36 }}>SIRA</th>
                    <th style={{ padding: '5px 8px', fontSize: 10, fontWeight: 600 }}>SİPARİŞ NO</th>
                    <th style={{ padding: '5px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 70 }}>MİKTAR</th>
                    <th style={{ padding: '5px 8px', fontSize: 10, fontWeight: 600 }}>SERİ NO</th>
                  </tr>
                </thead>
                <tbody>
                  {cert.lines.map(l => (
                    <tr key={l.siraNo} style={{ borderTop: '1px solid #f5f5f4' }}>
                      <td style={{ padding: '4px 8px', fontWeight: 600, color: '#1e40af', textAlign: 'center' }}>{l.siraNo}</td>
                      <td style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace' }}>{l.orderNo || '—'}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 500 }}>{l.quantity || '—'}</td>
                      <td style={{ padding: '4px 8px' }}>{l.serialNo || '—'}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#eff6ff', borderTop: '2px solid #1e40af' }}>
                    <td colSpan={2} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1e40af', fontSize: 10 }}>TOPLAM</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: '#1e40af' }}>{cert.totalQty}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>)}

          <span style={{ color: '#78716c' }}>Feragat:</span>
          {editMode ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <input type="checkbox" checked={!!editForm.feragatText} onChange={(e) => updateField('feragatText', e.target.checked ? (editForm.feragatText || ' ') : '')} />
              Feragat var
            </label>
          ) : (
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: fStatus === 'VAR' ? '#fef2f2' : '#f0fdf4',
              color: fStatus === 'VAR' ? '#991b1b' : '#166534',
              width: 'fit-content',
            }}>{fStatus}</span>
          )}

          {editMode && editForm.feragatText !== '' && (<>
            <span style={{ color: '#78716c' }}>Feragat Metni:</span>
            <textarea
              value={editForm.feragatText || ''}
              onChange={(e) => updateField('feragatText', e.target.value)}
              rows={3}
              style={{ ...editInput, fontFamily: 'inherit', resize: 'vertical' }}
              placeholder="Feragat açıklaması..."
            />
          </>)}

          {!editMode && fStatus === 'VAR' && cert.feragatText && (<>
            <span style={{ color: '#78716c' }}>Feragat Metni:</span>
            <span style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#44403c' }}>{cert.feragatText}</span>
          </>)}
        </div>

        {/* 📎 Dokümanlar bölümü — Firebase Storage'a yükle, master tekrar kullanım, sil/indir */}
        {!editMode && (
          <CocAttachmentsSection cert={cert} canEdit={canEdit} />
        )}

        {error && (
          <div style={{ margin: '0 20px 12px', padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11, color: '#991b1b' }}>
            ⚠ {error}
          </div>
        )}

        {confirmDelete && (
          <div style={{ margin: '0 20px 12px', padding: 12, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12 }}>
            <div style={{ color: '#991b1b', fontWeight: 600, marginBottom: 8 }}>⚠ Bu sertifikayı silmek istediğine emin misin?</div>
            <div style={{ color: '#7f1d1d', marginBottom: 10 }}>
              <b>{cert.certNo}</b> · {cert.stokKodu} · {cert.customerName} — bu işlem <b>geri alınamaz</b>.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} style={{
                padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: deleting ? 'not-allowed' : 'pointer',
              }}>İptal</button>
              <button onClick={handleDelete} disabled={deleting} style={{
                padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                border: '1px solid #b91c1c', background: '#b91c1c', color: '#fff',
                cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1,
              }}>{deleting ? 'Siliniyor...' : 'Evet, sil'}</button>
            </div>
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e7e5e4', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {editMode ? (<>
            <button onClick={handleCancelEdit} disabled={busy} style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: busy ? 'not-allowed' : 'pointer',
            }}>İptal</button>
            <button onClick={handleSaveEdit} disabled={busy} style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: '1px solid #1e40af', background: '#1e40af', color: '#fff',
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
            }}>{saving ? 'Kaydediliyor...' : '✓ Değişiklikleri Kaydet'}</button>
          </>) : (<>
            {canEdit && (
              <button onClick={() => setConfirmDelete(true)} disabled={busy} title={cert.lines && cert.lines.length > 1 ? `Bu COC'un ${cert.lines.length} satırının tümü silinir` : ''} style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b',
                cursor: busy ? 'not-allowed' : 'pointer', marginRight: 'auto',
              }}>🗑 Sil{cert.lines && cert.lines.length > 1 ? ` (${cert.lines.length} satır)` : ''}</button>
            )}
            <button onClick={() => !busy && onClose()} disabled={busy} style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: busy ? 'not-allowed' : 'pointer',
            }}>Kapat</button>
            {canEdit && (!cert.lines || cert.lines.length <= 1) && (
              <button onClick={handleStartEdit} disabled={busy} style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                border: '1px solid #1e40af', background: '#fff', color: '#1e40af',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}>✎ Düzenle</button>
            )}
            <button onClick={handleDownload} disabled={busy} style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: '1px solid #1e40af', background: '#1e40af', color: '#fff',
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
            }}>📄 {generating ? 'Üretiliyor...' : 'PDF İndir'}</button>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// COC Parça Master Yönetimi — KONF Excel'den gelen parçalar + UI'dan eklenen.
// Yeni revizyon geldiğinde Excel re-import beklemeden buradan ekle/güncelle.
// ====================================================================
function CocPartsView({ cocParts, customerFilter, searchText, canEdit }) {
  const [partsSearch, setPartsSearch] = useState('');
  const [editingPart, setEditingPart] = useState(null); // obj veya {new:true}
  const [completionFilter, setCompletionFilter] = useState('all'); // 'all' | 'complete' | 'skeleton'

  // Iskelet/Tam tespiti: revisions boş = iskelet (auto-from-salesOrders eklenmiş ama henüz revizyon yok)
  const isSkeleton = (p) => !p.revisions || p.revisions.length === 0;

  const filtered = useMemo(() => {
    const qMain = (searchText || '').trim().toLocaleLowerCase('tr-TR');
    const qLocal = (partsSearch || '').trim().toLocaleLowerCase('tr-TR');
    const list = Object.values(cocParts?.parts || {}).filter(p => {
      if (!p?.stokKodu) return false;
      if (customerFilter && customerFilter !== 'all' && p.customerCode !== customerFilter) return false;
      const skel = isSkeleton(p);
      if (completionFilter === 'complete' && skel) return false;
      if (completionFilter === 'skeleton' && !skel) return false;
      const hay = `${p.stokKodu} ${p.description || ''} ${p.faiNo || ''} ${(p.revisions || []).join(' ')}`.toLocaleLowerCase('tr-TR');
      if (qMain && !hay.includes(qMain)) return false;
      if (qLocal && !hay.includes(qLocal)) return false;
      return true;
    });
    list.sort((a, b) => (a.stokKodu || '').localeCompare(b.stokKodu || ''));
    return list;
  }, [cocParts, customerFilter, searchText, partsSearch, completionFilter]);

  const counts = useMemo(() => {
    let total = 0, complete = 0, skel = 0;
    for (const p of Object.values(cocParts?.parts || {})) {
      if (!p?.stokKodu) continue;
      if (customerFilter && customerFilter !== 'all' && p.customerCode !== customerFilter) continue;
      total++;
      if (isSkeleton(p)) skel++; else complete++;
    }
    return { total, complete, skel };
  }, [cocParts, customerFilter]);

  return (
    <div>
      {/* Completion filtresi — Tümü / Tam / Eksik */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        padding: '8px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e7e5e4',
      }}>
        <span style={{ fontSize: 11, color: '#57534e', fontWeight: 500, marginRight: 4 }}>Durum:</span>
        {[
          { v: 'all', label: 'Tümü', count: counts.total },
          { v: 'complete', label: 'Tam tanımlı', count: counts.complete },
          { v: 'skeleton', label: '⚠ Eksik (revizyonsuz)', count: counts.skel },
        ].map(opt => (
          <button key={opt.v} onClick={() => setCompletionFilter(opt.v)} style={{
            padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            border: '1px solid ' + (completionFilter === opt.v ? '#1e40af' : '#d6d3d1'),
            background: completionFilter === opt.v ? '#1e40af' : '#fff',
            color: completionFilter === opt.v ? '#fff' : (opt.v === 'skeleton' && opt.count > 0 ? '#92400e' : '#44403c'),
          }}>{opt.label} ({opt.count})</button>
        ))}
        {counts.skel > 0 && completionFilter !== 'skeleton' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#92400e' }}>
            ⚠ {counts.skel} parçanın revizyonu eksik
          </span>
        )}
      </div>

      {/* Toolbar — arama + yeni parça */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="🔍 Stok kodu, tanım, FAİ no veya revizyon ile ara..."
          value={partsSearch}
          onChange={(e) => setPartsSearch(e.target.value)}
          style={{ flex: 1, padding: '7px 12px', borderRadius: 6, border: '1px solid #d6d3d1', fontSize: 12, outline: 'none' }}
        />
        {partsSearch && (
          <button onClick={() => setPartsSearch('')} style={{
            padding: '6px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c',
          }}>Temizle</button>
        )}
        {canEdit && (
          <button onClick={() => setEditingPart({ new: true })} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            border: '1px solid #1e40af', background: '#1e40af', color: '#fff', cursor: 'pointer',
          }}>+ Yeni Parça</button>
        )}
      </div>

      {/* Liste */}
      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f5f5f4', textAlign: 'left', color: '#44403c' }}>
              <th style={cocTh}>Müşteri</th>
              <th style={cocTh}>Stok Kodu</th>
              <th style={{ ...cocTh, minWidth: 280 }}>Tanım</th>
              <th style={cocTh}>FAİ No</th>
              <th style={cocTh}>Revizyonlar</th>
              <th style={{ ...cocTh, textAlign: 'center', width: 90 }}>Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: '#a8a29e', fontSize: 12 }}>
                {Object.keys(cocParts?.parts || {}).length === 0
                  ? 'Henüz parça master yok — KONF Excel yükle veya yukarıdaki "+ Yeni Parça" butonu ile ekle'
                  : 'Filtre/aramaya uyan parça bulunamadı'}
              </td></tr>
            ) : filtered.slice(0, 500).map(p => {
              const badge = customerBadge(p.customerCode);
              const skel = isSkeleton(p);
              return (
                <tr key={p.stokKodu} style={{ borderTop: '1px solid #f5f5f4', background: skel ? '#fffbeb' : 'transparent' }}>
                  <td style={cocTd}>
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                      background: badge.bg, color: badge.fg,
                    }}>{badge.label}</span>
                  </td>
                  <td style={{ ...cocTd, fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#1e40af' }}>
                    {p.stokKodu}
                    {skel && <span title="Revizyon eksik — sipariş raporundan otomatik eklenmiş iskelet" style={{ marginLeft: 6, padding: '1px 4px', borderRadius: 3, fontSize: 8, fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>⚠ EKSİK</span>}
                  </td>
                  <td style={{ ...cocTd, color: '#44403c' }} title={p.description}>{p.description || '—'}</td>
                  <td style={{ ...cocTd, fontFamily: 'ui-monospace, monospace' }}>{p.faiNo || '—'}</td>
                  <td style={cocTd}>
                    {(p.revisions || []).length === 0 ? (
                      <span style={{ color: '#a8a29e' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {p.revisions.map(r => (
                          <span key={r} style={{
                            padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                            background: '#eff6ff', color: '#1e40af', fontFamily: 'ui-monospace, monospace',
                          }}>{r}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...cocTd, textAlign: 'center' }}>
                    {canEdit ? (
                      <button onClick={() => setEditingPart(p)} title="Düzenle" style={{
                        padding: '2px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                        border: '1px solid #d6d3d1', background: '#fff', color: '#44403c',
                      }}>✎</button>
                    ) : <span style={{ color: '#a8a29e' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div style={{ padding: 10, fontSize: 11, color: '#78716c', textAlign: 'center', background: '#fafaf9', borderTop: '1px solid #e7e5e4' }}>
            İlk 500 parça gösteriliyor — arama ile daraltın
          </div>
        )}
      </div>

      {/* Edit/Create modal */}
      {editingPart && (
        <CocPartModal
          part={editingPart.new ? null : editingPart}
          canEdit={canEdit}
          onClose={() => setEditingPart(null)}
        />
      )}
    </div>
  );
}

// COC Parça Düzenle/Yeni Ekle Modal
function CocPartModal({ part, canEdit, onClose }) {
  const isNew = !part;
  const [stokKodu, setStokKodu] = useState(part?.stokKodu || '');
  const [customerCode, setCustomerCode] = useState(part?.customerCode || '120-0107');
  const [description, setDescription] = useState(part?.description || '');
  const [faiNo, setFaiNo] = useState(part?.faiNo || '');
  const [revisions, setRevisions] = useState(part?.revisions || []);
  const [newRev, setNewRev] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const busy = saving || deleting;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const addRevision = () => {
    const v = newRev.trim();
    if (!v) return;
    if (revisions.includes(v)) { setError(`Revizyon "${v}" zaten var`); return; }
    setRevisions([...revisions, v]);
    setNewRev('');
    setError('');
  };

  const removeRevision = (r) => setRevisions(revisions.filter(x => x !== r));

  const handleSave = async () => {
    if (!canEdit) return;
    if (!stokKodu.trim()) { setError('Stok kodu zorunlu'); return; }
    if (!customerCode) { setError('Müşteri seçimi zorunlu'); return; }
    if (revisions.length === 0) { setError('En az 1 revizyon eklemelisin'); return; }
    setSaving(true);
    setError('');
    try {
      await saveCocPart({
        stokKodu: stokKodu.trim(),
        customerCode,
        description: description.trim(),
        faiNo: faiNo.trim() || null,
        revisions,
      }, { canEdit });
      onClose();
    } catch (e) {
      setError(e.message || 'Kaydetme hatası');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !part) return;
    setDeleting(true);
    setError('');
    try {
      await deleteCocPart(part.stokKodu, { canEdit });
      onClose();
    } catch (e) {
      setError(e.message || 'Silme hatası');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const inp = { padding: '6px 10px', border: '1px solid #d6d3d1', borderRadius: 4, fontSize: 12, width: '100%', boxSizing: 'border-box' };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.45)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 10, padding: 0,
        maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔧</span>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e40af' }}>
            {isNew ? 'Yeni Parça Ekle' : `Parça Düzenle — ${part.stokKodu}`}
          </h3>
          <button onClick={() => !busy && onClose()} disabled={busy} style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, fontSize: 12,
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: busy ? 'not-allowed' : 'pointer',
          }}>Kapat ✕</button>
        </div>

        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>Müşteri *</label>
            <select value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} disabled={!isNew || busy} style={inp}>
              <option value="120-0107">Aselsan</option>
              <option value="120-116">Roketsan</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>Stok Kodu *</label>
            <input type="text" value={stokKodu} onChange={(e) => setStokKodu(e.target.value)} disabled={!isNew || busy} placeholder="örn. MM-9111-0944" style={{ ...inp, fontFamily: 'ui-monospace, monospace' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>Tanım</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} placeholder="Parça açıklaması" style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>FAİ No</label>
            <input type="text" value={faiNo} onChange={(e) => setFaiNo(e.target.value)} disabled={busy} placeholder="opsiyonel" style={{ ...inp, fontFamily: 'ui-monospace, monospace' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 4 }}>Yeni Revizyon Ekle</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input type="text" value={newRev} onChange={(e) => setNewRev(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRevision(); } }} disabled={busy} placeholder="örn. AB, D02" style={{ ...inp, fontFamily: 'ui-monospace, monospace' }} />
              <button onClick={addRevision} disabled={busy || !newRev.trim()} style={{
                padding: '6px 10px', borderRadius: 4, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer',
                border: '1px solid #1e40af', background: '#1e40af', color: '#fff', whiteSpace: 'nowrap',
              }}>+</button>
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 11, color: '#57534e', fontWeight: 500, display: 'block', marginBottom: 6 }}>
              Revizyonlar ({revisions.length}) {revisions.length === 0 && <span style={{ color: '#dc2626', fontWeight: 400 }}>— en az 1 gerekli</span>}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minHeight: 36, padding: 8, border: '1px solid #e7e5e4', borderRadius: 4, background: '#fafaf9' }}>
              {revisions.length === 0 ? (
                <span style={{ fontSize: 11, color: '#a8a29e', alignSelf: 'center' }}>Yukarıdan revizyon ekle</span>
              ) : revisions.map(r => (
                <span key={r} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 4px 3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: '#eff6ff', color: '#1e40af', fontFamily: 'ui-monospace, monospace',
                }}>
                  {r}
                  {!busy && (
                    <button onClick={() => removeRevision(r)} title="Kaldır" style={{
                      border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                      fontSize: 12, color: '#dc2626', lineHeight: 1, fontWeight: 700,
                    }}>×</button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div style={{ margin: '0 20px 12px', padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11, color: '#991b1b' }}>
            ⚠ {error}
          </div>
        )}

        {confirmDelete && (
          <div style={{ margin: '0 20px 12px', padding: 12, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12 }}>
            <div style={{ color: '#991b1b', fontWeight: 600, marginBottom: 8 }}>⚠ Parça master kaydını silmek istediğine emin misin?</div>
            <div style={{ color: '#7f1d1d', marginBottom: 10 }}>
              <b>{part?.stokKodu}</b> — bu parça için yeni COC oluştururken master verisi olmayacak (manuel girersin). Geçmiş sertifikalar etkilenmez.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} style={{
                padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: deleting ? 'not-allowed' : 'pointer',
              }}>İptal</button>
              <button onClick={handleDelete} disabled={deleting} style={{
                padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                border: '1px solid #b91c1c', background: '#b91c1c', color: '#fff',
                cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1,
              }}>{deleting ? 'Siliniyor...' : 'Evet, sil'}</button>
            </div>
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e7e5e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!isNew && canEdit && (
            <button onClick={() => setConfirmDelete(true)} disabled={busy} style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b',
              cursor: busy ? 'not-allowed' : 'pointer', marginRight: 'auto',
            }}>🗑 Sil</button>
          )}
          <button onClick={() => !busy && onClose()} disabled={busy} style={{
            padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            border: '1px solid #d6d3d1', background: '#fff', color: '#44403c', cursor: busy ? 'not-allowed' : 'pointer',
          }}>İptal</button>
          <button onClick={handleSave} disabled={busy || !canEdit} style={{
            padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            border: '1px solid #1e40af', background: '#1e40af', color: '#fff',
            cursor: (busy || !canEdit) ? 'not-allowed' : 'pointer', opacity: (busy || !canEdit) ? 0.6 : 1,
          }}>{saving ? 'Kaydediliyor...' : (isNew ? 'Ekle' : 'Kaydet')}</button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// COC ATTACHMENT (Doküman) Bölümü — CocDetailModal içinde kullanılır.
// Firebase Storage + Firestore meta. Sabit 6 kategori + serbest "Diğer".
// Master tekrar kullanım: hammadde sertifikası (stok bazlı), balonlu resim
// (stok+revizyon bazlı) — kullanıcı önceki seçimleri yeniden kullanabilir.
// ====================================================================
function CocAttachmentsSection({ cert: initialCert, canEdit }) {
  const { cocParts } = useCocParts();
  // Live cert subscriber — yüklemeden sonra anında güncellenir, modal kapatmaya gerek yok
  const year = initialCert.certNo.substring(0, 4);
  const { cocCertificates } = useCocCertificates(year);
  const certId = `${initialCert.certNo}_${initialCert.siraNo || '1'}`;
  const liveCert = cocCertificates?.certificates?.[certId];
  const cert = liveCert
    ? { ...initialCert, ...liveCert, attachments: liveCert.attachments || {}, naCategories: liveCert.naCategories || [] }
    : initialCert;
  const attachments = cert.attachments || {};
  const others = Array.isArray(attachments.others) ? attachments.others : [];
  const naCategoriesRaw = Array.isArray(cert.naCategories) ? cert.naCategories : [];
  // Otomatik N/A kuralları: feragat YOK ise Feragat kategorisi otomatik uygulanmaz
  const feragatYok = (cert.feragatStatus || (cert.feragatText ? 'VAR' : 'YOK')) === 'YOK';
  const isAutoNa = (catKey) => catKey === 'waiver' && feragatYok;
  const naCategories = [...new Set([
    ...naCategoriesRaw,
    ...(feragatYok ? ['waiver'] : []),
  ])];
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [masterOpen, setMasterOpen] = useState({}); // {[cat.key]: bool}
  const [driveModal, setDriveModal] = useState(null); // { category, results, loading, error, selected: Set<fileId>, strategy }
  const fileInputs = useRef({});

  const fmtSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // Master tekrar kullanım: aynı parça+revizyon için yüklenmiş tüm dosyaları çek
  const getReusable = (cat) => {
    if (!cat.reuseScope) return [];
    return getReusableAttachmentList(cocParts, cert.stokKodu, cat.key, cert.revisionCode, cat.reuseScope);
  };

  // Master listesine yeni dosya ekle (her upload sonrası master güncellenir)
  const appendToMaster = async (cat, partMeta) => {
    if (!cat.reuseScope) return;
    const existing = getReusableAttachmentList(cocParts, cert.stokKodu, cat.key, cert.revisionCode, cat.reuseScope);
    const newList = [...existing, partMeta];
    await setCocPartStandardAttachmentList(cert.stokKodu, cat.key, newList, {
      canEdit, scope: cat.reuseScope, revision: cert.revisionCode,
    });
  };

  const handleUpload = async (cat, file, opts = {}) => {
    if (!file || !canEdit) return;
    setBusy(cat.key);
    setError('');
    try {
      const meta = await uploadCocAttachment(cert.certNo, year, cat.key, file);
      if (cat.key === 'others') {
        const newOthers = [...others, { ...meta, customName: opts.customName || file.name }];
        await setCocCertificateOthers(cert.certNo, cert.siraNo || '1', newOthers, { canEdit });
      } else {
        const currentList = getCocAttachmentList(cert, cat.key);
        await appendCocCertificateAttachment(cert.certNo, cert.siraNo || '1', cat.key, meta, currentList, { canEdit });
        // Master'a da ekle
        if (cat.reuseScope) {
          const opts2 = cat.reuseScope === 'stok+revizyon' && cert.revisionCode ? { revision: cert.revisionCode } : {};
          const partMeta = await uploadCocPartStandardAttachment(cert.stokKodu, cat.key, file, opts2);
          await appendToMaster(cat, partMeta);
        }
      }
    } catch (e) {
      setError(e.message || 'Yükleme hatası');
    } finally {
      setBusy(null);
    }
  };

  // Çoklu dosya yükleme — Storage paralel, Firestore tek yazım (race condition'sız)
  const handleUploadMultiple = async (cat, fileList) => {
    if (!fileList?.length || !canEdit) return;
    if (fileList.length === 1) return handleUpload(cat, fileList[0]);
    setBusy(cat.key);
    setError('');
    try {
      const files = Array.from(fileList);
      // 1) Tüm dosyaları COC storage'a paralel yükle
      const certMetas = await Promise.all(
        files.map(file => uploadCocAttachment(cert.certNo, year, cat.key, file))
      );
      // 2) COC list'i tek seferde güncelle (race condition yok)
      const currentList = getCocAttachmentList(cert, cat.key);
      const newList = [...currentList, ...certMetas];
      await setCocCertificateAttachmentList(cert.certNo, cert.siraNo || '1', cat.key, newList, { canEdit });
      // 3) Master'a da ekle (reuseScope varsa)
      if (cat.reuseScope) {
        const opts2 = cat.reuseScope === 'stok+revizyon' && cert.revisionCode ? { revision: cert.revisionCode } : {};
        const partMetas = await Promise.all(
          files.map(file => uploadCocPartStandardAttachment(cert.stokKodu, cat.key, file, opts2))
        );
        const existingMaster = getReusableAttachmentList(cocParts, cert.stokKodu, cat.key, cert.revisionCode, cat.reuseScope);
        const newMasterList = [...existingMaster, ...partMetas];
        await setCocPartStandardAttachmentList(cert.stokKodu, cat.key, newMasterList, {
          canEdit, scope: cat.reuseScope, revision: cert.revisionCode,
        });
      }
    } catch (e) {
      setError(e.message || 'Yükleme hatası');
    } finally {
      setBusy(null);
    }
  };

  // Master dosyasını sil — Storage + master listesi (COC kayıtları dokunmaz, broken reference olabilir)
  const handleDeleteMaster = async (cat, masterFile) => {
    if (!canEdit) return;
    if (!confirm(`Master'dan "${masterFile.filename}" silinsin mi?\n\nUYARI: Bu dosyayı tekrar kullanan COC'lar varsa, onlardaki bağlantı bozulur. Yanlış kategoriye yüklenmiş bir dosyayı temizliyorsan güvenli.`)) return;
    setBusy(cat.key);
    setError('');
    try {
      await deleteCocAttachment(masterFile.storagePath, { canEdit });
      const existingMaster = getReusableAttachmentList(cocParts, cert.stokKodu, cat.key, cert.revisionCode, cat.reuseScope);
      const newMasterList = existingMaster.filter(m => m.storagePath !== masterFile.storagePath);
      await setCocPartStandardAttachmentList(cert.stokKodu, cat.key, newMasterList, {
        canEdit, scope: cat.reuseScope, revision: cert.revisionCode,
      });
    } catch (e) {
      setError(e.message || 'Master silme hatası');
    } finally {
      setBusy(null);
    }
  };

  const handleReuse = async (cat, reusableMeta) => {
    if (!reusableMeta || !canEdit) return;
    setBusy(cat.key);
    setError('');
    try {
      const currentList = getCocAttachmentList(cert, cat.key);
      const reused = { ...reusableMeta, sourceType: 'reuse', reusedAt: new Date().toISOString() };
      await appendCocCertificateAttachment(cert.certNo, cert.siraNo || '1', cat.key, reused, currentList, { canEdit });
    } catch (e) {
      setError(e.message || 'Tekrar kullanım hatası');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (cat, att, idx) => {
    if (!canEdit) return;
    if (!confirm(`"${att.filename}" silinsin mi?`)) return;
    setBusy(cat.key);
    setError('');
    try {
      // Reuse ise storage path master'da, dokunma. Yoksa Storage'dan da sil.
      if (att.sourceType !== 'reuse') {
        await deleteCocAttachment(att.storagePath, { canEdit });
      }
      if (cat.key === 'others') {
        const newOthers = others.filter((_, i) => i !== idx);
        await setCocCertificateOthers(cert.certNo, cert.siraNo || '1', newOthers, { canEdit });
      } else {
        const currentList = getCocAttachmentList(cert, cat.key);
        const newList = currentList.filter((_, i) => i !== idx);
        await setCocCertificateAttachmentList(cert.certNo, cert.siraNo || '1', cat.key, newList, { canEdit });
      }
    } catch (e) {
      setError(e.message || 'Silme hatası');
    } finally {
      setBusy(null);
    }
  };

  const triggerFileInput = (key) => { if (fileInputs.current[key]) fileInputs.current[key].click(); };

  // Sayım — Uygulanmaz işaretli kategoriler hariç (paydadan da düşer)
  const applicableCategories = COC_ATTACHMENT_CATEGORIES.filter(c => !naCategories.includes(c.key));
  const filledCategories = applicableCategories.filter(c => getCocAttachmentList(cert, c.key).length > 0).length;
  const totalFiles = COC_ATTACHMENT_CATEGORIES.reduce((s, c) => s + getCocAttachmentList(cert, c.key).length, 0) + others.length;

  const toggleNaCategory = async (catKey) => {
    if (!canEdit) return;
    const newList = naCategories.includes(catKey)
      ? naCategories.filter(k => k !== catKey)
      : [...naCategories, catKey];
    setBusy(catKey);
    setError('');
    try {
      await setCocCertificateNaCategories(cert.certNo, cert.siraNo || '1', newList, { canEdit });
    } catch (e) {
      setError(e.message || 'Uygulanmaz durumu güncellenemedi');
    } finally {
      setBusy(null);
    }
  };

  // Toplu ZIP indirme — kategoriye göre klasörlenmiş + uygunluk belgesi PDF kökte
  const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  const dedupeName = (used, name) => {
    if (!used.has(name)) { used.add(name); return name; }
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.substring(0, dot) : name;
    const ext = dot > 0 ? name.substring(dot) : '';
    let i = 2;
    while (used.has(`${base} (${i})${ext}`)) i++;
    const out = `${base} (${i})${ext}`;
    used.add(out);
    return out;
  };

  const handleDownloadZip = async () => {
    setBusy('zip');
    setError('');
    try {
      const zip = new JSZip();

      // 1) Uygunluk Belgesi PDF kökte
      const pdfBlob = await buildCocPdfBlob(cert);
      zip.file(`Uygunluk Belgesi ${sanitize(cert.certNo)}.pdf`, pdfBlob);

      // 2) Kategori bazlı klasörler — sadece dolu olanlar (storagePath üzerinden, fetch yerine SDK getBlob — CORS uyumlu)
      const fetchAll = [];
      for (const cat of COC_ATTACHMENT_CATEGORIES) {
        const list = getCocAttachmentList(cert, cat.key);
        if (list.length === 0) continue;
        const folder = zip.folder(sanitize(cat.label));
        const used = new Set();
        for (const att of list) {
          if (!att?.storagePath) continue;
          const name = dedupeName(used, sanitize(att.filename));
          fetchAll.push(
            downloadCocAttachmentBlob(att.storagePath).then(b => folder.file(name, b))
          );
        }
      }
      // 3) "Diğer Dokümanlar" klasörü
      if (others.length > 0) {
        const folder = zip.folder('Diğer Dokümanlar');
        const used = new Set();
        for (const o of others) {
          if (!o?.storagePath) continue;
          const display = o.customName ? `${sanitize(o.customName)}__${sanitize(o.filename)}` : sanitize(o.filename);
          const name = dedupeName(used, display);
          fetchAll.push(
            downloadCocAttachmentBlob(o.storagePath).then(b => folder.file(name, b))
          );
        }
      }

      await Promise.all(fetchAll);

      const blob = await zip.generateAsync({ type: 'blob' });
      const zipName = `${sanitize(cert.stokKodu)}_${sanitize(cert.refNo || cert.orderNo || '')}_${sanitize(cert.certNo)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'ZIP oluşturma hatası');
    } finally {
      setBusy(null);
    }
  };

  // Drive'dan arama — modal açar, sonuçları gösterir
  const openDriveSearch = async (cat) => {
    if (!canEdit) return;
    setDriveModal({ category: cat, results: [], loading: true, error: '', selected: new Set(), strategy: null });
    try {
      const altName = getCocPartDriveAltName(cocParts, cert.stokKodu, cat.key);
      const out = await searchCocDrive({ category: cat.key, stokKodu: cert.stokKodu, altName });
      setDriveModal((prev) => prev ? {
        ...prev,
        results: out.results || [],
        loading: false,
        error: out.message || '',
        strategy: out.strategy || null,
      } : null);
    } catch (e) {
      setDriveModal((prev) => prev ? {
        ...prev,
        results: [],
        loading: false,
        error: e.message || 'Arama hatası',
      } : null);
    }
  };

  const toggleDriveSelect = (fileId) => {
    setDriveModal((prev) => {
      if (!prev) return null;
      const next = new Set(prev.selected);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return { ...prev, selected: next };
    });
  };

  // Seçilen Drive dosyalarını import et — backend Storage'a yükler, frontend Firestore'a metadata yazar
  const importSelectedDriveFiles = async () => {
    if (!driveModal || driveModal.selected.size === 0) return;
    const cat = driveModal.category;
    setBusy(cat.key);
    setError('');
    try {
      const year = cert.certNo.substring(0, 4);
      const files = driveModal.results.filter(r => driveModal.selected.has(r.id));
      // Tek tek import et (paralel olabilir ama Firestore yazımı race-condition'a açık)
      const cocMetas = [];
      const masterMetas = [];
      for (const f of files) {
        const out = await importCocDriveFile({
          fileId: f.id,
          certNo: cert.certNo,
          certYear: year,
          category: cat.key,
          stokKodu: cert.stokKodu,
        });
        cocMetas.push(out.coc);
        masterMetas.push(out.master);
      }
      // Firestore'a yaz — COC listesi tek seferde
      const currentList = getCocAttachmentList(cert, cat.key);
      const newList = [...currentList, ...cocMetas];
      await setCocCertificateAttachmentList(cert.certNo, cert.siraNo || '1', cat.key, newList, { canEdit });
      // Master listesi
      if (cat.reuseScope) {
        const existingMaster = getReusableAttachmentList(cocParts, cert.stokKodu, cat.key, cert.revisionCode, cat.reuseScope);
        const newMasterList = [...existingMaster, ...masterMetas];
        await setCocPartStandardAttachmentList(cert.stokKodu, cat.key, newMasterList, {
          canEdit, scope: cat.reuseScope, revision: cert.revisionCode,
        });
      }
      setDriveModal(null);
    } catch (e) {
      setError(e.message || 'Drive import hatası');
      setDriveModal((prev) => prev ? { ...prev, error: e.message || 'Import hatası' } : null);
    } finally {
      setBusy(null);
    }
  };

  // altName master'a kaydet (bulamadığında satışçı gerçek hammadde adını öğretir)
  const saveDriveAltName = async (cat, altName) => {
    if (!canEdit) return;
    try {
      await setCocPartDriveAltName(cert.stokKodu, cat.key, altName, { canEdit });
    } catch (e) {
      setError(e.message || 'altName kaydedilemedi');
    }
  };

  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid #e7e5e4', background: '#fafaf9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>📎 Dokümanlar</span>
        <span style={{ fontSize: 11, color: '#78716c' }}>
          {filledCategories}/{applicableCategories.length} kategori dolu · toplam {totalFiles} dosya
          {naCategories.length > 0 && (
            <span style={{ marginLeft: 6, color: '#a8a29e' }}>
              ({naCategories.length} uygulanmaz)
            </span>
          )}
        </span>
        <button
          onClick={handleDownloadZip}
          disabled={busy === 'zip'}
          title="Uygunluk belgesi PDF + tüm yüklü dosyalar kategori klasörleri halinde tek ZIP'te"
          style={{
            marginLeft: 'auto',
            padding: '4px 12px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: busy === 'zip' ? 'not-allowed' : 'pointer',
            border: '1px solid #7c3aed',
            background: busy === 'zip' ? '#f5f3ff' : '#ede9fe',
            color: '#5b21b6',
          }}
        >
          {busy === 'zip' ? 'ZIP hazırlanıyor...' : '📦 Toplu ZIP İndir'}
        </button>
      </div>
      {error && (
        <div style={{ marginBottom: 10, padding: 8, borderRadius: 4, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11, color: '#991b1b' }}>
          ⚠ {error}
        </div>
      )}

      {/* Sabit kategoriler */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {COC_ATTACHMENT_CATEGORIES.map(cat => {
          const list = getCocAttachmentList(cert, cat.key);
          const reusable = getReusable(cat);
          // Master'da var ama bu COC'a henüz eklenmeyenler
          const unusedReusable = reusable.filter(r => !list.some(l => l.storagePath === r.storagePath));
          const isBusy = busy === cat.key;
          const isNa = naCategories.includes(cat.key);
          return (
            <div key={cat.key} style={{
              background: isNa ? '#f5f5f4' : '#fff',
              border: '1px solid #e7e5e4',
              borderRadius: 6, padding: '8px 10px', fontSize: 12,
              opacity: isNa ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: !isNa && list.length > 0 ? 6 : 0 }}>
                <span style={{ fontWeight: 500, textDecoration: isNa ? 'line-through' : 'none' }}>
                  {cat.icon} {cat.label}
                  {cat.reuseScope && !isNa && (
                    <span title={`Tekrar kullanım: ${cat.reuseScope}`} style={{ marginLeft: 5, padding: '1px 4px', fontSize: 8, fontWeight: 600, background: '#dbeafe', color: '#1e40af', borderRadius: 3 }}>
                      {cat.reuseScope === 'stok+revizyon' ? 'STOK+REV' : 'STOK'}
                    </span>
                  )}
                  {isNa && (
                    <span
                      title={isAutoNa(cat.key) ? "Bu COC'ta 'Feragat yok' işaretli — otomatik uygulanmaz" : undefined}
                      style={{ marginLeft: 5, padding: '1px 5px', fontSize: 9, fontWeight: 600, background: '#e7e5e4', color: '#57534e', borderRadius: 3 }}>
                      {isAutoNa(cat.key) ? 'UYGULANMAZ (FERAGAT YOK)' : 'UYGULANMAZ'}
                    </span>
                  )}
                  {!isNa && list.length > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#78716c' }}>({list.length} dosya)</span>}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {!isNa && unusedReusable.length > 0 && canEdit && (
                    <select
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        if (idx >= 0) handleReuse(cat, unusedReusable[idx]);
                        e.target.value = '';
                      }}
                      disabled={isBusy}
                      style={{
                        padding: '3px 6px', borderRadius: 3, fontSize: 11, cursor: isBusy ? 'not-allowed' : 'pointer',
                        border: '1px solid #16a34a', background: '#dcfce7', color: '#166534',
                      }}
                    >
                      <option value="">↻ Master'dan Kullan ({unusedReusable.length})</option>
                      {unusedReusable.map((r, i) => (
                        <option key={i} value={i}>{r.filename}</option>
                      ))}
                    </select>
                  )}
                  {!isNa && cat.reuseScope && reusable.length > 0 && canEdit && (
                    <button
                      onClick={() => setMasterOpen(prev => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                      title="Master dosyalarını görüntüle / sil"
                      style={{
                        padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                        border: '1px solid #a8a29e', background: masterOpen[cat.key] ? '#f5f5f4' : '#fff', color: '#44403c',
                      }}>⚙ Master ({reusable.length})</button>
                  )}
                  {!isNa && canEdit && ['rawMaterialCert', 'measurement', 'fai', 'surfaceTreatment'].includes(cat.key) && (
                    <button
                      onClick={() => openDriveSearch(cat)}
                      disabled={isBusy}
                      title="Drive'da bu stok kodu için belge ara ve öner"
                      style={{
                        padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: isBusy ? 'not-allowed' : 'pointer',
                        border: '1px solid #ea580c', background: '#fff7ed', color: '#9a3412',
                      }}>🔍 Drive'dan Öner</button>
                  )}
                  {!isNa && canEdit && (
                    <>
                      <input
                        ref={(el) => { fileInputs.current[cat.key] = el; }}
                        type="file"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => { const fs = e.target.files; if (fs?.length) handleUploadMultiple(cat, fs); e.target.value = ''; }}
                      />
                      <button
                        onClick={() => triggerFileInput(cat.key)}
                        disabled={isBusy}
                        title="Birden fazla dosya seçebilirsiniz (Cmd/Ctrl + tıklama)"
                        style={{
                          padding: '3px 10px', borderRadius: 3, fontSize: 11, fontWeight: 500, cursor: isBusy ? 'not-allowed' : 'pointer',
                          border: '1px solid #1e40af', background: isBusy ? '#fff' : '#eff6ff', color: '#1e40af',
                        }}>{isBusy ? 'Yükleniyor...' : '⬆ Yükle (Çoklu)'}</button>
                    </>
                  )}
                  {canEdit && !isAutoNa(cat.key) && (
                    <button
                      onClick={() => toggleNaCategory(cat.key)}
                      disabled={isBusy}
                      title={isNa ? "Tekrar aktif yap" : "Bu kategori bu COC için uygulanmıyor — paydadan çıkar"}
                      style={{
                        padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: isBusy ? 'not-allowed' : 'pointer',
                        border: '1px solid ' + (isNa ? '#16a34a' : '#a8a29e'),
                        background: isNa ? '#dcfce7' : '#fff',
                        color: isNa ? '#166534' : '#57534e',
                      }}>{isNa ? '✓ Aktif Et' : '⊘ Uygulanmaz'}</button>
                  )}
                </div>
              </div>
              {list.length === 0 ? (
                <div style={{ fontSize: 11, color: '#a8a29e', fontStyle: 'italic', paddingLeft: 24 }}>— henüz dosya yok</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 24 }}>
                  {list.map((att, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', fontSize: 11, background: '#fafaf9', borderRadius: 3 }}>
                      <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" style={{
                        flex: 1, color: '#1e40af', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>📄 {att.filename}</a>
                      <span style={{ fontSize: 10, color: '#78716c' }}>{fmtSize(att.size)}</span>
                      {att.sourceType === 'reuse' && (
                        <span title="Master'dan tekrar kullanıldı" style={{ padding: '1px 4px', fontSize: 9, fontWeight: 600, background: '#dcfce7', color: '#166534', borderRadius: 3 }}>↻ Tekrar</span>
                      )}
                      {canEdit && (
                        <button onClick={() => handleDelete(cat, att, idx)} title="Sil" style={{
                          padding: '2px 6px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                          border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                        }}>🗑</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {masterOpen[cat.key] && reusable.length > 0 && (
                <div style={{ marginTop: 8, padding: 8, background: '#fafaf9', border: '1px dashed #d6d3d1', borderRadius: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#57534e', marginBottom: 4 }}>
                    🗂 Master Dosyaları — bu stok{cat.reuseScope === 'stok+revizyon' && cert.revisionCode ? `+${cert.revisionCode}` : ''} için saklananlar
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {reusable.map((m, i) => {
                      const inUse = list.some(l => l.storagePath === m.storagePath);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', fontSize: 11, background: '#fff', borderRadius: 3, border: '1px solid #e7e5e4' }}>
                          <a href={m.downloadUrl} target="_blank" rel="noopener noreferrer" style={{
                            flex: 1, color: '#1e40af', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>📄 {m.filename}</a>
                          <span style={{ fontSize: 10, color: '#78716c' }}>{fmtSize(m.size)}</span>
                          {inUse ? (
                            <span title="Bu COC'a eklenmiş" style={{ padding: '1px 5px', fontSize: 9, fontWeight: 600, background: '#dcfce7', color: '#166534', borderRadius: 3 }}>✓ Kullanımda</span>
                          ) : (
                            canEdit && (
                              <button onClick={() => handleReuse(cat, m)} title="Bu COC'a ekle" disabled={isBusy} style={{
                                padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: isBusy ? 'not-allowed' : 'pointer',
                                border: '1px solid #16a34a', background: '#dcfce7', color: '#166534',
                              }}>↻ Kullan</button>
                            )
                          )}
                          {canEdit && (
                            <button onClick={() => handleDeleteMaster(cat, m)} title="Master'dan kalıcı sil" disabled={isBusy} style={{
                              padding: '2px 6px', borderRadius: 3, fontSize: 10, cursor: isBusy ? 'not-allowed' : 'pointer',
                              border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                            }}>🗑 Master</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Diğer (serbest kategori) */}
      <div style={{ marginTop: 10, padding: 10, border: '1px solid #e7e5e4', borderRadius: 6, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>📂 Diğer Dokümanlar ({others.length})</span>
          {canEdit && (
            <>
              <input
                ref={(el) => { fileInputs.current['others'] = el; }}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const customName = prompt('Doküman adı (örn. "Boyahane Onay Formu"):', f.name) || f.name;
                    handleUpload({ key: 'others' }, f, { customName });
                  }
                  e.target.value = '';
                }}
              />
              <button onClick={() => triggerFileInput('others')} disabled={busy === 'others'} style={{
                marginLeft: 'auto', padding: '3px 10px', borderRadius: 3, fontSize: 11, cursor: busy === 'others' ? 'not-allowed' : 'pointer',
                border: '1px solid #1e40af', background: '#eff6ff', color: '#1e40af',
              }}>{busy === 'others' ? 'Yükleniyor...' : '+ Ekle'}</button>
            </>
          )}
        </div>
        {others.length === 0 ? (
          <div style={{ fontSize: 11, color: '#a8a29e', fontStyle: 'italic', padding: 6 }}>
            Henüz ek doküman yok. Standart kategorilerin dışındaki belgeler için kullanın.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {others.map((o, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                fontSize: 11, background: '#fafaf9', borderRadius: 4,
              }}>
                <span style={{ minWidth: 180, fontWeight: 500 }}>{o.customName || o.filename}</span>
                <a href={o.downloadUrl} target="_blank" rel="noopener noreferrer" style={{
                  flex: 1, color: '#1e40af', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>📄 {o.filename}</a>
                <span style={{ fontSize: 10, color: '#78716c' }}>{fmtSize(o.size)}</span>
                {canEdit && (
                  <button onClick={() => handleDelete({ key: 'others' }, o, idx)} title="Sil" style={{
                    padding: '2px 6px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                    border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                  }}>🗑</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {driveModal && (
        <DriveSearchModal
          driveModal={driveModal}
          cert={cert}
          cocParts={cocParts}
          canEdit={canEdit}
          onClose={() => setDriveModal(null)}
          onToggleSelect={toggleDriveSelect}
          onImport={importSelectedDriveFiles}
          onSaveAltName={saveDriveAltName}
          onRetry={() => openDriveSearch(driveModal.category)}
          isBusy={busy === driveModal.category.key}
          fmtSize={fmtSize}
        />
      )}
    </div>
  );
}

function DriveSearchModal({ driveModal, cert, cocParts, canEdit, onClose, onToggleSelect, onImport, onSaveAltName, onRetry, isBusy, fmtSize }) {
  const cat = driveModal.category;
  const altNameSaved = getCocPartDriveAltName(cocParts, cert.stokKodu, cat.key);
  const [altNameDraft, setAltNameDraft] = useState(altNameSaved);

  const handleAltNameSave = async () => {
    if (altNameDraft === altNameSaved) return;
    await onSaveAltName(cat, altNameDraft.trim());
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, width: 'min(720px, 92vw)', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>🔍 Drive'dan Öner — {cat.icon} {cat.label}</span>
          <span style={{ fontSize: 11, color: '#78716c' }}>Stok: <b>{cert.stokKodu}</b></span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', padding: '3px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
            border: '1px solid #d6d3d1', background: '#fff',
          }}>✕ Kapat</button>
        </div>

        <div style={{ padding: '14px 18px', overflow: 'auto', flex: 1 }}>
          {driveModal.loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#78716c' }}>⏳ Drive'da aranıyor...</div>
          ) : driveModal.error ? (
            <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 4, fontSize: 12, color: '#92400e' }}>
              ⚠ {driveModal.error}
            </div>
          ) : driveModal.results.length === 0 ? (
            <div style={{ padding: 16, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 4, fontSize: 12, color: '#92400e' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Bu stok için Drive'da eşleşme bulunamadı.</div>
              <div>
                Hammadde gibi ortak isimle saklanıyorsa (örn. <code style={{background:'#fff', padding:'1px 4px', borderRadius:3}}>Q32 316</code>),
                gerçek dosya adını aşağı yaz, master'a kaydedelim — bir sonraki COC'ta otomatik aratırız.
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="Örn. Q32 316"
                  value={altNameDraft}
                  onChange={(e) => setAltNameDraft(e.target.value)}
                  disabled={!canEdit}
                  style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: '1px solid #d6d3d1', borderRadius: 4 }}
                />
                <button
                  onClick={async () => { await handleAltNameSave(); onRetry(); }}
                  disabled={!canEdit || !altNameDraft.trim()}
                  style={{ padding: '5px 12px', fontSize: 12, cursor: canEdit && altNameDraft.trim() ? 'pointer' : 'not-allowed',
                    background: '#1e40af', color: '#fff', border: 'none', borderRadius: 4 }}
                >Kaydet + Tekrar Ara</button>
              </div>
            </div>
          ) : (
            <>
              {driveModal.strategy && (
                <div style={{ fontSize: 10, color: '#78716c', marginBottom: 8 }}>
                  Strateji: <b>{driveModal.strategy === 'fulltext' ? 'PDF içerik araması' : 'Klasör tabanlı'}</b>
                  · {driveModal.results.length} sonuç bulundu
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {driveModal.results.map((r) => {
                  const isSelected = driveModal.selected.has(r.id);
                  return (
                    <label key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      background: isSelected ? '#eff6ff' : '#fafaf9', border: '1px solid ' + (isSelected ? '#1e40af' : '#e7e5e4'),
                      borderRadius: 4, cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(r.id)}
                        disabled={!canEdit}
                      />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#1c1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          📄 {r.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#78716c', marginTop: 2 }}>
                          {r.modifiedTime ? new Date(r.modifiedTime).toLocaleDateString('tr-TR') : '—'} · {fmtSize(r.size)}
                          {r.parentFolderName && <> · klasör: {r.parentFolderName}</>}
                        </div>
                      </div>
                      <a href={r.webViewLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 10, color: '#1e40af', textDecoration: 'none' }}>
                        Drive'da aç ↗
                      </a>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {driveModal.results.length > 0 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#78716c' }}>
              {driveModal.selected.size} dosya seçildi
            </span>
            <button onClick={onClose} style={{
              marginLeft: 'auto', padding: '6px 14px', fontSize: 12, cursor: 'pointer',
              border: '1px solid #d6d3d1', background: '#fff', borderRadius: 4,
            }}>İptal</button>
            <button
              onClick={onImport}
              disabled={driveModal.selected.size === 0 || isBusy || !canEdit}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                cursor: driveModal.selected.size === 0 || isBusy ? 'not-allowed' : 'pointer',
                background: driveModal.selected.size === 0 ? '#d6d3d1' : '#1e40af', color: '#fff',
                border: 'none', borderRadius: 4,
              }}>
              {isBusy ? 'İndiriliyor...' : `📥 Seçilenleri Yükle (${driveModal.selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// COC için doluluk hesabı (liste gösterimleri için): tüm kategorilerin file count toplamı + others
// Uygulanmaz işaretli kategoriler hem paydadan hem dolu sayımından düşülür.
// Otomatik kural: feragatStatus === 'YOK' ise Feragat kategorisi de uygulanmaz sayılır.
function getCocAttachmentStats(cert) {
  const naRaw = Array.isArray(cert?.naCategories) ? cert.naCategories : [];
  const feragatYok = (cert?.feragatStatus || (cert?.feragatText ? 'VAR' : 'YOK')) === 'YOK';
  const naCategories = new Set([...naRaw, ...(feragatYok ? ['waiver'] : [])]);
  const applicableCats = COC_ATTACHMENT_CATEGORIES.filter(c => !naCategories.has(c.key));
  let filled = 0, totalFiles = 0;
  for (const cat of applicableCats) {
    const list = getCocAttachmentList(cert, cat.key);
    if (list.length > 0) filled++;
    totalFiles += list.length;
  }
  const others = Array.isArray(cert?.attachments?.others) ? cert.attachments.others.length : 0;
  return {
    filled,
    totalCats: applicableCats.length,
    totalFiles: totalFiles + others,
    othersCount: others,
    naCount: naCategories.size,
  };
}

// Drive entegrasyon ayarları sayfası — sadece admin görür.
// Per-kategori kök klasör ID listesi + strateji seçimi.
function DriveConfigView({ canEdit }) {
  const { driveConfig, loaded } = useDriveConfig();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  // Drive entegrasyonu olan kategoriler
  const driveCategories = [
    { key: 'measurement', label: '📏 Ölçüm Raporu', defaultStrategy: 'folder' },
    { key: 'fai', label: '📋 FAİ Raporu', defaultStrategy: 'folder' },
    { key: 'rawMaterialCert', label: '🧪 Hammadde Kalite Sertifikası', defaultStrategy: 'fulltext' },
    { key: 'surfaceTreatment', label: '🔥 Isıl İşlem / Kaplama / Boya', defaultStrategy: 'fulltext' },
  ];

  // Sadece ilk yüklemede initialize et — sonradan driveConfig değişse de kullanıcının
  // henüz kaydetmediği değişikliklerin üzerine yazma (race condition önlenir).
  useEffect(() => {
    if (!loaded || draft !== null) return;
    const initial = driveConfig || {
      foldersByCategory: {},
      strategyByCategory: {},
    };
    setDraft({
      foldersByCategory: { ...(initial.foldersByCategory || {}) },
      strategyByCategory: { ...(initial.strategyByCategory || {}) },
    });
  }, [loaded, driveConfig, draft]);

  if (!loaded || !draft) {
    return <div style={{ padding: 20, color: '#78716c' }}>Yükleniyor…</div>;
  }

  const updateFolders = (catKey, idsText) => {
    const ids = idsText.split(/[\s,\n]+/).map(s => s.trim()).filter(Boolean);
    setDraft(d => ({
      ...d,
      foldersByCategory: { ...d.foldersByCategory, [catKey]: ids },
    }));
  };

  const updateStrategy = (catKey, strategy) => {
    setDraft(d => ({
      ...d,
      strategyByCategory: { ...d.strategyByCategory, [catKey]: strategy },
    }));
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError('');
    try {
      await saveDriveConfig(draft, { canEdit });
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 920 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1c1917', margin: 0 }}>🔌 Drive Entegrasyonu Ayarları</h2>
        <div style={{ fontSize: 12, color: '#78716c', marginTop: 4 }}>
          Per-kategori Drive kök klasör ID'lerini yapılandır. Service account: <code style={{ background: '#f5f5f4', padding: '1px 4px', borderRadius: 3 }}>coc-drive-reader@sevkiyat-pro.iam.gserviceaccount.com</code>
        </div>
        <div style={{ fontSize: 11, color: '#92400e', marginTop: 6, padding: 8, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 4 }}>
          ⚠ Klasörlerin yukarıdaki SA email'i ile <b>"Görüntüleyen"</b> yetkisinde paylaşılmış olması gerekir.
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12, color: '#991b1b' }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {driveCategories.map(cat => {
          const ids = draft.foldersByCategory[cat.key] || [];
          const strategy = draft.strategyByCategory[cat.key] || cat.defaultStrategy;
          return (
            <div key={cat.key} style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 6, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{cat.label}</span>
                <span style={{ fontSize: 10, color: '#78716c' }}>
                  ({ids.length} klasör · strateji: {strategy === 'fulltext' ? 'PDF içerik' : 'Klasör'})
                </span>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#57534e', marginBottom: 4 }}>
                  Drive Kök Klasör ID'leri (her satıra bir tane veya virgülle ayır)
                </label>
                <textarea
                  value={ids.join('\n')}
                  onChange={(e) => updateFolders(cat.key, e.target.value)}
                  disabled={!canEdit}
                  placeholder="1aBcDeFgHiJk..."
                  style={{
                    width: '100%', minHeight: 60, padding: 8, fontSize: 11,
                    fontFamily: 'monospace', border: '1px solid #d6d3d1', borderRadius: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#57534e', marginBottom: 4 }}>
                  Arama Stratejisi
                </label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: canEdit ? 'pointer' : 'default' }}>
                    <input
                      type="radio"
                      checked={strategy === 'folder'}
                      onChange={() => updateStrategy(cat.key, 'folder')}
                      disabled={!canEdit}
                    />
                    📁 Klasör (stok kodu adında alt klasör → içindeki dosyalar)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: canEdit ? 'pointer' : 'default' }}>
                    <input
                      type="radio"
                      checked={strategy === 'fulltext'}
                      onChange={() => updateStrategy(cat.key, 'fulltext')}
                      disabled={!canEdit}
                    />
                    🔍 PDF İçerik (dosya adı/içeriğinde stok kodu)
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={handleSave}
          disabled={!canEdit || saving}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            cursor: canEdit && !saving ? 'pointer' : 'not-allowed',
            background: canEdit ? '#1e40af' : '#d6d3d1', color: '#fff', border: 'none', borderRadius: 4,
          }}
        >{saving ? 'Kaydediliyor...' : '💾 Kaydet'}</button>
        {savedAt && (
          <span style={{ fontSize: 11, color: '#16a34a' }}>
            ✓ Kaydedildi {savedAt.toLocaleTimeString('tr-TR')}
          </span>
        )}
        {!canEdit && (
          <span style={{ fontSize: 11, color: '#a8a29e' }}>(salt okunur — admin değilsin)</span>
        )}
      </div>
    </div>
  );
}
