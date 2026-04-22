import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useSalesOrders, usePlanOverrides } from './hooks';
import { saveSalesOrders } from './firestore';
import { parseSalesOrderExcel } from './parser';

export default function DigerMusteriler({ isAdmin, isUretim }) {
  const canEdit = !!(isAdmin || isUretim);

  const { salesOrders, loaded: ordersLoaded } = useSalesOrders();
  const { planOverrides, loaded: overridesLoaded } = usePlanOverrides();

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null); // { ok, message }
  const fileInputRef = useRef(null);

  const orderCount = Object.keys(salesOrders).length;
  const overrideCount = Object.keys(planOverrides).length;
  const allLoaded = ordersLoaded && overridesLoaded;
  const empty = allLoaded && orderCount === 0 && overrideCount === 0;

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const result = parseSalesOrderExcel(wb);
      await saveSalesOrders(result.ordersMap, { canEdit });
      const extra = result.aggregateCount > 0 ? ` (${result.aggregateCount} duplicate birleştirildi)` : '';
      setUploadResult({
        ok: true,
        message: `✓ ${result.rowCount} satır → ${result.orderCount} unique kayıt, ${result.customerCount} müşteri${extra}`,
      });
    } catch (e) {
      setUploadResult({ ok: false, message: `✗ Hata: ${e.message || String(e)}` });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Diğer Müşteriler</h1>
      <p style={{ color: '#78716c', fontSize: 13 }}>
        Yapım aşamasında. Faz 1A aktif geliştirme.
      </p>

      {/* Upload bölümü */}
      <div style={{ marginTop: 20, padding: 12, border: '1px solid #e7e5e4', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Satış Siparişi Yükleme</div>
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
          {uploading ? 'Yükleniyor...' : 'Satış Siparişi Excel Yükle'}
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

      {/* Debug bölümü */}
      <div style={{ marginTop: 20, padding: 12, border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 12, color: '#44403c', fontFamily: 'ui-monospace, monospace' }}>
        <div>Sipariş sayısı: {allLoaded ? orderCount : '…'}</div>
        <div>Override sayısı: {allLoaded ? overrideCount : '…'}</div>
        {empty && (
          <div style={{ marginTop: 8, color: '#78716c' }}>
            Henüz veri yok — yukarıdaki butonla yükleyebilirsin.
          </div>
        )}
      </div>
    </div>
  );
}
