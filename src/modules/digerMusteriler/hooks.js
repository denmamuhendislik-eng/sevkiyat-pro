import { useState, useEffect, useMemo } from "react";
import { subscribeSalesOrders, subscribePlanOverrides, subscribeBomModels } from "./firestore";
import { getISOWeek } from "../../shared/weekUtils";

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
      if (customerFilter && customerFilter !== "all" && o.customerCode !== customerFilter) continue;
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
      const row = { id, ...o, effectiveWeek: week, isOverride: !!ov, isDeferred };
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
    const perCustomer = {};
    for (const o of rows) {
      const cc = o.customerCode || "?";
      if (!perCustomer[cc]) perCustomer[cc] = { count: 0, bedel: 0, name: o.customerName || "" };
      perCustomer[cc].count += 1;
      perCustomer[cc].bedel += o.toplamBedel || 0;
    }

    const deferredBedel = deferredRows.reduce((s, o) => s + (o.toplamBedel || 0), 0);

    return {
      late,
      noWeek,
      byWeek,
      weekOrder,
      currentWeek,
      deferred: deferredRows,
      kpi: { totalRows, totalBedel, perCustomer, deferredCount: deferredRows.length, deferredBedel },
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
