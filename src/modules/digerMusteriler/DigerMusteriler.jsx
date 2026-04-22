import React from 'react';
import { useSalesOrders, usePlanOverrides } from './hooks';

export default function DigerMusteriler() {
  const { salesOrders, loaded: ordersLoaded } = useSalesOrders();
  const { planOverrides, loaded: overridesLoaded } = usePlanOverrides();

  const orderCount = Object.keys(salesOrders).length;
  const overrideCount = Object.keys(planOverrides).length;
  const allLoaded = ordersLoaded && overridesLoaded;
  const empty = allLoaded && orderCount === 0 && overrideCount === 0;

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>
        Diğer Müşteriler
      </h1>
      <p style={{ color: '#78716c', fontSize: 13 }}>
        Yapım aşamasında. Faz 1A aktif geliştirme.
      </p>
      <div style={{ marginTop: 20, padding: 12, border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 12, color: '#44403c', fontFamily: 'ui-monospace, monospace' }}>
        <div>Sipariş sayısı: {allLoaded ? orderCount : '…'}</div>
        <div>Override sayısı: {allLoaded ? overrideCount : '…'}</div>
        {empty && (
          <div style={{ marginTop: 8, color: '#78716c' }}>
            Henüz veri yok — Adım 4'te parser ile yükleyeceğiz.
          </div>
        )}
      </div>
    </div>
  );
}
