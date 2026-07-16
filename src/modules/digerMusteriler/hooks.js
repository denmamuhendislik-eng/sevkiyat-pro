import { useState, useEffect, useMemo } from "react";
import { subscribeSalesOrders, subscribePlanOverrides, subscribeBomModels, subscribeShipments, subscribeAutomationLog, subscribeCocParts, subscribeCocCertificates, subscribeDriveConfig } from "./firestore";
import { getISOWeek } from "../../shared/weekUtils";
import { matchCustomer, KNOWN_CUSTOMERS, isKnownCustomer, OTHER_CUSTOMER_CODE } from "./customerMeta";

export function useSalesOrders() {
  const [salesOrders, setSalesOrders] = useState({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = subscribeSalesOrders((data) => {
      setSalesOrders(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);
  return { salesOrders, loaded };
}

export function usePlanOverrides() {
  const [planOverrides, setPlanOverrides] = useState({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = subscribePlanOverrides((data) => {
      setPlanOverrides(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);
  return { planOverrides, loaded };
}

export function useBomModels() {
  const [bomModels, setBomModels] = useState({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = subscribeBomModels((data) => {
      setBomModels(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);
  return { bomModels, loaded };
}

export function useShipments() {
  const [shipments, setShipments] = useState({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = subscribeShipments((data) => {
      setShipments(data || {});
      setLoaded(true);
    });
    return unsub;
  }, []);
  return { shipments, loaded };
}

export function useAutomationLog() {
  const [automationLog, setAutomationLog] = useState(null);
  useEffect(() => {
    const unsub = subscribeAutomationLog((data) => setAutomationLog(data));
    return unsub;
  }, []);
  return { automationLog };
}

// COC parça master — appData/cocParts ({ parts: {...}, totalCount })
export function useCocParts() {
  const [cocParts, setCocParts] = useState({ parts: {} });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = subscribeCocParts((data) => {
      setCocParts(data || { parts: {} });
      setLoaded(true);
    });
    return unsub;
  }, []);
  return { cocParts, loaded };
}

// COC sertifika arşivi — year-bazlı (appData/cocCertificates_{YYYY})
// Default: içinde bulunulan yıl + bir önceki yıl (sertifika no auto-suggest için son sıra)
export function useCocCertificates(year) {
  const [data, setData] = useState({ certificates: {}, year });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!year) return;
    const unsub = subscribeCocCertificates(year, (d) => {
      setData(d || { certificates: {}, year });
      setLoaded(true);
    });
    return unsub;
  }, [year]);
  return { cocCertificates: data, loaded };
}

// Çoklu yıl COC arşivi — birden fazla year doc'una paralel abone ol, birleştir.
// Arşiv sayfası için (2024-2025-2026 hepsi tek listede gösterilir).
export function useCocCertificatesMulti(years) {
  const [byYear, setByYear] = useState({});
  const [loadedYears, setLoadedYears] = useState(new Set());
  const yearsKey = (years || []).join(",");
  useEffect(() => {
    if (!years || years.length === 0) return;
    const unsubs = years.map(y => subscribeCocCertificates(y, (d) => {
      setByYear(prev => ({ ...prev, [y]: d?.certificates || {} }));
      setLoadedYears(prev => new Set([...prev, y]));
    }));
    return () => unsubs.forEach(fn => fn && fn());
  }, [yearsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Birleştirilmiş map: { id: cert } (ID'ler year doc'larında unique olduğu varsayılıyor)
  const certificates = useMemo(() => {
    const merged = {};
    for (const y of Object.keys(byYear)) {
      for (const [id, c] of Object.entries(byYear[y] || {})) {
        merged[id] = c;
      }
    }
    return merged;
  }, [byYear]);
  const allLoaded = years.every(y => loadedYears.has(y));
  return { certificates, byYear, loaded: allLoaded };
}

// Siparişleri filter + sort + ISO-hafta gruplama + KPI hesabı
// Adım 5: override görünümde yok ama hook zaten override-aware — Adım 6'da UI eklendiğinde mantık hazır
// "Akibeti belirsiz" siparişler ayrı `deferred[]` array'ine düşer (geciken/hafta gruplarına dahil değil) —
// MRP demand'ına da girmez (App.jsx salesOrdersDemand filtre).
export function useWeekGroupedOrders(salesOrders, planOverrides, { customerFilter, searchText, sortMode }) {
  return useMemo(() => {
    const q = (searchText || "").trim().toLocaleLowerCase("tr-TR");
    const currentWeek = getISOWeek(new Date());

    // 1) Filter + attach effectiveWeek
    const rows = [];
    const deferredRows = [];
    for (const [id, o] of Object.entries(salesOrders || {})) {
      if (customerFilter && customerFilter !== "all") {
        if (customerFilter === OTHER_CUSTOMER_CODE) {
          // DĞR filtresi: bilinen müşterilerden HİÇBİRİNE uymayanlar
          if (isKnownCustomer(o.customerCode)) continue;
        } else if (!matchCustomer(o.customerCode, customerFilter)) {
          continue;
        }
      }
      if (q) {
        const hay = `${o.stokKodu || ""} ${o.stokAdi || ""} ${o.belgeNo || ""}`.toLocaleLowerCase("tr-TR");
        if (!hay.includes(q)) continue;
      }
      const ov = planOverrides?.[id];
      const isDeferred = ov?.status === "deferred";
      let week = "";
      if (ov && ov.plannedWeek) {
        week = ov.plannedWeek;
      } else if (o.teslimTarihi) {
        const d = new Date(o.teslimTarihi + "T00:00:00Z");
        if (!isNaN(d.getTime())) week = getISOWeek(d);
      }
      // Override stale: kullanıcı override yaptı (origWeek kayıtlı) ama VIO'da teslim tarihi
      // sonradan değişmiş — yeni VIO haftası override'ın yapıldığı haftadan farklı.
      let vioCurrentWeek = "";
      if (o.teslimTarihi) {
        const d = new Date(o.teslimTarihi + "T00:00:00Z");
        if (!isNaN(d.getTime())) vioCurrentWeek = getISOWeek(d);
      }
      const isStale = !!(ov && ov.origWeek && vioCurrentWeek && vioCurrentWeek !== ov.origWeek);
      const row = { id, ...o, effectiveWeek: week, isOverride: !!ov, isDeferred, isStale, vioCurrentWeek };
      if (isDeferred) {
        deferredRows.push(row);
      } else {
        rows.push(row);
      }
    }

    // 2) Sort fn
    const sortFn = (a, b) => {
      if (sortMode === "price") return (b.toplamBedel || 0) - (a.toplamBedel || 0);
      if (sortMode === "customer") {
        const cc = (a.customerCode || "").localeCompare(b.customerCode || "");
        if (cc !== 0) return cc;
        const d = (a.teslimTarihi || "").localeCompare(b.teslimTarihi || "");
        if (d !== 0) return d;
        return String(a.belgeNo || "").localeCompare(String(b.belgeNo || ""));
      }
      // date (default): teslim + belgeNo gruplaması için
      const d = (a.teslimTarihi || "").localeCompare(b.teslimTarihi || "");
      if (d !== 0) return d;
      return String(a.belgeNo || "").localeCompare(String(b.belgeNo || ""));
    };

    // 3) Split late vs upcoming, group by week
    const late = [];
    const byWeek = {};
    const noWeek = []; // teslim tarihi yok — edge case
    for (const o of rows) {
      if (!o.effectiveWeek) {
        noWeek.push(o);
      } else if (o.effectiveWeek < currentWeek) {
        late.push(o);
      } else {
        (byWeek[o.effectiveWeek] = byWeek[o.effectiveWeek] || []).push(o);
      }
    }
    late.sort(sortFn);
    noWeek.sort(sortFn);
    deferredRows.sort(sortFn);
    for (const w of Object.keys(byWeek)) byWeek[w].sort(sortFn);
    const weekOrder = Object.keys(byWeek).sort();

    // 4) KPI — filter-aware
    const totalRows = rows.length;
    const totalBedel = rows.reduce((s, o) => s + (o.toplamBedel || 0), 0);
    // perCustomer: alt hesapları (120-116-1 vs.) ana hesap (120-116) altında topla.
    // Bilinmeyen müşteriler tek "DĞR" grubu altında birleşir → KPI'da tek kart görünür.
    const perCustomer = {};
    for (const o of rows) {
      const known = KNOWN_CUSTOMERS.find(k => matchCustomer(o.customerCode, k.code));
      const cc = known ? known.code : OTHER_CUSTOMER_CODE;
      if (!perCustomer[cc]) perCustomer[cc] = { count: 0, bedel: 0, name: known ? (o.customerName || "") : "Diğer Müşteriler" };
      perCustomer[cc].count += 1;
      perCustomer[cc].bedel += o.toplamBedel || 0;
    }

    const deferredBedel = deferredRows.reduce((s, o) => s + (o.toplamBedel || 0), 0);

    // Stale override list — VIO termin değişmiş override'lar (filter-aware, deferred dahil değil)
    const staleOverrides = rows.filter(r => r.isStale);
    staleOverrides.sort(sortFn);

    // Plan sırası tutarsızlığı — aynı stokKodu için müşteri teslim sırası ≠ bizim plan sırası.
    // rows zaten deferred ve filtre-aware. teslim/effectiveWeek olmayanları atla.
    // Inversion: ardışık iki sipariş için teslim erken olanın plan haftası geç olanınkinden büyük.
    const byStock = {};
    for (const o of rows) {
      if (!o.stokKodu || !o.effectiveWeek || !o.teslimTarihi) continue;
      (byStock[o.stokKodu] = byStock[o.stokKodu] || []).push(o);
    }
    const inconsistentPairs = [];
    for (const [stokKodu, list] of Object.entries(byStock)) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.teslimTarihi.localeCompare(b.teslimTarihi));
      for (let i = 0; i < sorted.length - 1; i++) {
        const earlier = sorted[i];
        const later = sorted[i + 1];
        if (earlier.teslimTarihi === later.teslimTarihi) continue; // eşit teslim → tutarsızlık yok
        if (earlier.effectiveWeek > later.effectiveWeek) {
          inconsistentPairs.push({ stokKodu, earlier, later });
        }
      }
    }
    inconsistentPairs.sort((a, b) => (a.stokKodu || '').localeCompare(b.stokKodu || ''));

    return {
      late,
      noWeek,
      byWeek,
      weekOrder,
      currentWeek,
      deferred: deferredRows,
      staleOverrides,
      inconsistentPairs,
      kpi: { totalRows, totalBedel, perCustomer, deferredCount: deferredRows.length, deferredBedel, staleCount: staleOverrides.length, inconsistentCount: inconsistentPairs.length },
    };
  }, [salesOrders, planOverrides, customerFilter, searchText, sortMode]);
}

// Hafta içinde aynı belgeNo'lu satırları grupla (sipariş no gruplaması — görsel çerçeve için)
export function groupByBelgeNo(orders) {
  const groups = [];
  let cur = null;
  for (const o of orders) {
    if (!cur || cur.belgeNo !== o.belgeNo) {
      cur = { belgeNo: o.belgeNo, items: [o] };
      groups.push(cur);
    } else {
      cur.items.push(o);
    }
  }
  return groups;
}

export function useDriveConfig() {
  const [driveConfig, setDriveConfig] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const unsub = subscribeDriveConfig((data) => {
      setDriveConfig(data);
      setLoaded(true);
    });
    return unsub;
  }, []);
  return { driveConfig, loaded };
}
