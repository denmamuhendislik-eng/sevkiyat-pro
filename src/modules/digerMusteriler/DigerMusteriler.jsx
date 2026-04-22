import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useSalesOrders, usePlanOverrides, useWeekGroupedOrders, groupByBelgeNo } from './hooks';
import { saveSalesOrders } from './firestore';
import { parseSalesOrderExcel } from './parser';
import { customerBadge, KNOWN_CUSTOMERS } from './customerMeta';
import { getWeekMonday, formatDateShort, weeksBetween } from '../../shared/weekUtils';
import { formatMoney } from '../../shared/moneyFormat';

export default function DigerMusteriler({ isAdmin, isUretim }) {
  const canEdit = !!(isAdmin || isUretim);
  const { salesOrders, loaded: ordersLoaded } = useSalesOrders();
  const { planOverrides, loaded: overridesLoaded } = usePlanOverrides();

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const [customerFilter, setCustomerFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState('date');
  const [lateExpanded, setLateExpanded] = useState(false);

  const grouped = useWeekGroupedOrders(salesOrders, planOverrides, { customerFilter, searchText, sortMode });

  const allLoaded = ordersLoaded && overridesLoaded;
  const rawOrderCount = Object.keys(salesOrders).length;
  const overrideCount = Object.keys(planOverrides).length;
  const empty = allLoaded && rawOrderCount === 0;

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

      {/* Empty state — veri yoksa yalnızca yükleme kutusunu göster */}
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
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#78716c' }}>
              {grouped.kpi.totalRows} kayıt filtrede · {overrideCount} override
            </div>
          </div>

          {/* KPI strip */}
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {renderKpi('Toplam', grouped.kpi.totalRows, grouped.kpi.totalBedel, '#1e293b', '#fff')}
            {KNOWN_CUSTOMERS.map(c => {
              const s = grouped.kpi.perCustomer[c.code];
              const badge = customerBadge(c.code);
              return renderKpi(c.shortLabel, s?.count || 0, s?.bedel || 0, badge.bg, badge.fg);
            })}
          </div>

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
                <span>⚠ Geciken ({grouped.late.length} sipariş)</span>
                <span style={{ fontSize: 11, color: '#b91c1c' }}>
                  — bugün ({grouped.currentWeek}) öncesi teslim
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {lateExpanded ? 'gizle ▲' : 'aç ▼'}
                </span>
              </div>
              {lateExpanded && (
                <div style={{ marginTop: 10 }}>
                  {renderOrderGroups(grouped.late, grouped.currentWeek, true)}
                </div>
              )}
            </div>
          )}

          {/* noWeek edge case */}
          {grouped.noWeek.length > 0 && (
            <div style={{
              marginTop: 16, padding: 10, borderRadius: 6,
              background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#78350f',
            }}>
              ⚠ {grouped.noWeek.length} sipariş için teslim tarihi yok
            </div>
          )}

          {/* Week list */}
          <div style={{ marginTop: 16 }}>
            {grouped.weekOrder.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
                Filtre/aramaya uyan sipariş yok
              </div>
            ) : (
              grouped.weekOrder.map(w => (
                <div key={w} style={{ marginBottom: 14 }}>
                  <div style={{
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
                      {grouped.byWeek[w].length} sipariş
                    </span>
                  </div>
                  {renderOrderGroups(grouped.byWeek[w], grouped.currentWeek, false)}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Debug — Firestore bağlantı teyidi */}
      <div style={{
        marginTop: 24, padding: 10, border: '1px dashed #e7e5e4', borderRadius: 6,
        fontSize: 11, color: '#78716c', fontFamily: 'ui-monospace, monospace',
      }}>
        Firestore: {allLoaded ? `${rawOrderCount} ham sipariş · ${overrideCount} override` : 'yükleniyor…'}
      </div>
    </div>
  );
}

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

function renderOrderGroups(orders, currentWeek, isLateContext) {
  return groupByBelgeNo(orders).map((g, idx) => {
    const multi = g.items.length > 1;
    return (
      <div key={g.belgeNo + '_' + idx} style={{
        borderLeft: multi ? '3px solid #c7d2fe' : '3px solid transparent',
        background: multi ? 'rgba(199,210,254,0.06)' : 'transparent',
        marginBottom: 2, borderRadius: '0 4px 4px 0',
      }}>
        {multi && (
          <div style={{
            fontSize: 10, color: '#64748b', padding: '3px 10px', fontWeight: 500,
          }}>Belge {g.belgeNo} · {g.items.length} satır</div>
        )}
        {g.items.map(o => renderOrderRow(o, currentWeek, isLateContext))}
      </div>
    );
  });
}

function renderOrderRow(o, currentWeek, isLateContext) {
  const badge = customerBadge(o.customerCode);
  const teslim = o.teslimTarihi ? new Date(o.teslimTarihi + 'T00:00:00Z') : null;
  const lateWeeks = isLateContext && o.effectiveWeek ? weeksBetween(o.effectiveWeek, currentWeek) : 0;
  return (
    <div key={o.id} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px',
      fontSize: 12, borderBottom: '1px solid #f5f5f4',
    }}>
      <span style={{
        display: 'inline-block', padding: '2px 6px', borderRadius: 4,
        fontSize: 10, fontWeight: 600, minWidth: 30, textAlign: 'center',
        background: badge.bg, color: badge.fg,
      }}>{badge.label}</span>
      <span style={{
        fontFamily: 'ui-monospace, monospace', fontWeight: 500, fontSize: 11,
        minWidth: 170, color: '#1c1917',
      }}>{o.stokKodu}</span>
      <span style={{
        flex: 1, color: '#44403c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={o.stokAdi}>{o.stokAdi}</span>
      <span style={{ color: '#78716c', minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {o.kalanMiktar} {o.brm}
      </span>
      <span style={{ fontWeight: 500, minWidth: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(o.toplamBedel)} TL
      </span>
      <span style={{ color: '#78716c', minWidth: 75, textAlign: 'right', fontSize: 11 }}>
        {teslim ? formatDateShort(teslim) : '—'}
      </span>
      {isLateContext && lateWeeks > 0 && (
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 3,
          background: '#fecaca', color: '#991b1b', fontWeight: 600, minWidth: 40, textAlign: 'center',
        }}>
          {lateWeeks} hf geç
        </span>
      )}
    </div>
  );
}
