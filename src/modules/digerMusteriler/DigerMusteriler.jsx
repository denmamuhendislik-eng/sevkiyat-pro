import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSalesOrders, usePlanOverrides, useWeekGroupedOrders, groupByBelgeNo } from './hooks';
import { saveSalesOrders, savePlanOverride, removePlanOverride } from './firestore';
import { parseSalesOrderExcel } from './parser';
import { customerBadge, KNOWN_CUSTOMERS } from './customerMeta';
import { getISOWeek, getWeekMonday, formatDateShort, weeksBetween } from '../../shared/weekUtils';
import { formatMoney } from '../../shared/moneyFormat';

export default function DigerMusteriler({ isAdmin, isUretim }) {
  const canEdit = !!(isAdmin || isUretim);
  const role = isAdmin ? 'admin' : (isUretim ? 'üretim' : 'bilinmiyor');

  const { salesOrders, loaded: ordersLoaded } = useSalesOrders();
  const { planOverrides, loaded: overridesLoaded } = usePlanOverrides();

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const [customerFilter, setCustomerFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState('date');
  const [lateExpanded, setLateExpanded] = useState(false);

  // Picker: null | { orderId, anchorX, anchorY, origWeek, currentPlanWeek }
  const [picker, setPicker] = useState(null);

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
    const { orderId, origWeek, noteText } = picker;
    const note = (noteText || '').trim() ? noteText : '';
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
                  {renderOrderGroups(grouped.late, grouped.currentWeek, true, { canEdit, openPicker, planOverrides })}
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
                  {renderOrderGroups(grouped.byWeek[w], grouped.currentWeek, false, { canEdit, openPicker, planOverrides })}
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
        {multi && (
          <div style={{
            fontSize: 10, color: '#64748b', padding: '3px 10px', fontWeight: 500,
          }}>Belge {g.belgeNo} · {g.items.length} satır</div>
        )}
        {g.items.map(o => renderOrderRow(o, currentWeek, isLateContext, ctx))}
      </div>
    );
  });
}

function renderOrderRow(o, currentWeek, isLateContext, ctx) {
  const { canEdit, openPicker, planOverrides } = ctx;
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
          minWidth: 82, textAlign: 'center',
        }}
      >
        {o.effectiveWeek || '—'}
        {o.isOverride && <span style={{ marginLeft: 4, color: '#c2410c' }}>✎</span>}
        {planOverrides?.[o.id]?.note && <span title={planOverrides[o.id].note} style={{ marginLeft: 3, fontSize: 10 }}>💬</span>}
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
