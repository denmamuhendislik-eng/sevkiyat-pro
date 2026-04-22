import { useState, useEffect } from "react";
import { subscribeSalesOrders, subscribePlanOverrides } from "./firestore";

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
