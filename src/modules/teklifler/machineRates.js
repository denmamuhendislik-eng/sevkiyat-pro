/**
 * Makine dakika ücreti kaynağı — Sevkiyat Pro Maliyet modülündeki
 * calculateMachineRates() sonucundan gerçek zamanlı ratePerMin çeker.
 *
 * Bu, teklif modülünün Sevkiyat Pro'ya asıl entegrasyon noktası.
 * Excel'deki referans oranlar yerine, cari ay hesabından güncel oran alınır.
 *
 * Kullanım:
 *   const { rates, machines, loaded } = useMachineRatesForQuote();
 *   rates: { [machineName]: ratePerMin }  — teklift kullanılır
 *   machines: [ {id, name, wcCode, wcName, ratePerMin} ]  — dropdown için
 */

import { useState, useEffect, useMemo } from "react";
import {
  subscribeWorkCenters, subscribeLaborCosts, subscribeOverheadPolicy,
  subscribeFasonRates,
} from "../maliyet/firestore";
import { calculateMachineRates, DEFAULT_WEIGHTS, getOverheadMonthlyAvg } from "../maliyet/distributionCalc";

const todayMonth = () => new Date().toISOString().slice(0, 7);

export function useMachineRatesForQuote() {
  const [workCenters, setWorkCenters] = useState({ centers: {} });
  const [laborData, setLaborData] = useState({});
  const [policy, setPolicy] = useState(null);
  const [fasonRates, setFasonRates] = useState({});
  const [loaded, setLoaded] = useState({ wc: false, labor: false, policy: false, fason: false });

  useEffect(() => {
    const u = subscribeWorkCenters(d => { setWorkCenters(d || { centers: {} }); setLoaded(p => ({ ...p, wc: true })); });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeLaborCosts(d => { setLaborData(d || {}); setLoaded(p => ({ ...p, labor: true })); });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeOverheadPolicy(d => {
      setPolicy(!d || Object.keys(d).length === 0 ? { weights: { ...DEFAULT_WEIGHTS }, wcSalaryMapping: {} } : d);
      setLoaded(p => ({ ...p, policy: true }));
    });
    return u;
  }, []);
  useEffect(() => {
    const u = subscribeFasonRates(d => { setFasonRates(d || {}); setLoaded(p => ({ ...p, fason: true })); });
    return u;
  }, []);

  const allLoaded = Object.values(loaded).every(Boolean);
  const monthlyOverheads = laborData?.monthlyOverheads || {};
  const monthlySupplies = laborData?.monthlySupplies || {};

  // Referans ay: son tamamlanmış ay (mevcut ay hariç)
  const refMonth = useMemo(() => {
    const months = Object.keys(monthlyOverheads).sort().reverse();
    if (months.length === 0) return null;
    const cur = todayMonth();
    return months.find(m => m < cur) || months[0];
  }, [monthlyOverheads]);

  const calc = useMemo(() => {
    if (!allLoaded || !refMonth || !workCenters?.centers) return null;
    // Maliyet modülüyle aynı: overheadAvgMode default "avg", 6 ay
    const overheadAvgMode = policy?.overheadAvgMode || "avg";
    const overheadAvgWindow = Number(policy?.overheadAvgWindowMonths) || 6;
    let monthData;
    if (overheadAvgMode === "avg") {
      const avg = getOverheadMonthlyAvg(monthlyOverheads, overheadAvgWindow, refMonth);
      monthData = avg?._avgInfo?.monthsUsed > 0 ? avg : monthlyOverheads[refMonth];
    } else {
      monthData = monthlyOverheads[refMonth];
    }
    if (!monthData) return null;
    return calculateMachineRates({
      monthData, policy, workCenters, monthlySupplies, refMonth,
    });
  }, [allLoaded, refMonth, monthlyOverheads, workCenters, policy, fasonRates, monthlySupplies]);

  // Machine dropdown listesi (Sanal/YRD hariç — gerçek üretim tezgahları)
  const machines = useMemo(() => {
    if (!calc?.machines) return [];
    return calc.machines
      .filter(m => !m.isVirtual)
      .map(m => ({
        id: m.id,
        name: m.name,
        wcCode: m.wcCode,
        wcName: m.wcName,
        ratePerMin: Number((calc.machinePay?.[m.id]?.ratePerMin || 0).toFixed(4)),
      }))
      .filter(m => m.ratePerMin > 0)
      .sort((a, b) => (a.wcName || "").localeCompare(b.wcName || "") || (a.name || "").localeCompare(b.name || ""));
  }, [calc]);

  // Ad → ratePerMin map (isim ile lookup için, teklif kaydında ad tutulur)
  const ratesByName = useMemo(() => {
    const map = {};
    for (const m of machines) {
      if (m.name) map[m.name] = m.ratePerMin;
    }
    return map;
  }, [machines]);

  return {
    machines,
    ratesByName,
    refMonth,
    loaded: allLoaded,
    hasData: machines.length > 0,
  };
}
