// İhracat Sevkiyat Formu — motor dışı sevkiyat oluştur/düzenle
// Faz 1: müşteri seç → tarih/notlar → sipariş bakiyesinden ürün eklet → kaydet
// Faz 2/3: PDF ve fatura entegrasyonu buradan tetiklenir (edit modu)

import React, { useState, useEffect, useMemo } from "react";
import { saveExportShipment } from "./firestore";
import { computeShipmentAllocatedByOrder, computeAllocatedByOrder, getEffectiveSampleStatus } from "./allocationCalc";

const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR");

function newShipmentId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SHP_${Date.now()}_${rand}`;
}

export default function ExportShipmentForm({ editingShipment, products, ordersData, allocationsData, shipmentsData, exportSettings, canEdit, userEmail, onSaved, onCancel }) {
  const isEdit = !!editingShipment;

  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [shipmentDate, setShipmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [plannedDate, setPlannedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([]); // [{pid, stokKodu, stokAdi, descriptionEn, qty, allocations: [{orderId, belgeNo, qty}], notes}]
  const [status, setStatus] = useState("planned");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editingShipment) {
      setCustomerCode(editingShipment.customerCode || "");
      setCustomerName(editingShipment.customerName || "");
      setShipmentDate(editingShipment.shipmentDate || new Date().toISOString().slice(0, 10));
      setPlannedDate(editingShipment.plannedDate || "");
      setNotes(editingShipment.notes || "");
      setItems(Array.isArray(editingShipment.items) ? editingShipment.items.map(i => ({ ...i })) : []);
      setStatus(editingShipment.status || "planned");
    } else {
      setCustomerCode(""); setCustomerName("");
      setShipmentDate(new Date().toISOString().slice(0, 10));
      setPlannedDate("");
      setNotes("");
      setItems([]);
      setStatus("planned");
    }
    setError("");
  }, [editingShipment]);

  // Müşteri seçenekleri — ihracat siparişlerinden + customerDefaults
  // v23: Motor'a bağlı müşteriler HARİÇ (Sevkiyat Detay ekranında yönetilirler)
  const customerDefaults = exportSettings?.customerDefaults || {};
  const motorLinkedCustomers = Array.isArray(exportSettings?.motorLinkedCustomers) ? exportSettings.motorLinkedCustomers : [];
  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const o of Object.values(ordersData?.orders || {})) {
      if (o?.customerCode && !motorLinkedCustomers.includes(o.customerCode)) {
        map.set(o.customerCode, o.customerName || o.customerCode);
      }
    }
    for (const [code, d] of Object.entries(customerDefaults)) {
      if (motorLinkedCustomers.includes(code)) continue;
      if (!map.has(code)) map.set(code, d.customerName || code);
    }
    return Array.from(map, ([code, name]) => ({ code, name }));
  }, [ordersData, customerDefaults, motorLinkedCustomers]);

  // Motor'a bağlı müşteri seçilmeye çalışılırsa uyar
  const isMotorLinked = customerCode && motorLinkedCustomers.includes(customerCode);

  // Diğer aktif shipmentlarda bu sipariş id'sine tahsis edilmiş miktar
  // (edit modunda: kendi shipment'ını sayma). Fatura kesilmiş dahil değil — o zaten
  // computeAllocatedByOrder → sipariş bakiyesine düşmüş oluyor; burada sadece "başka
  // aktif shipment kaptı ama fatura kesilmedi" senaryosunu ele alıyoruz.
  const shipmentAllocatedByOrder = useMemo(
    () => computeShipmentAllocatedByOrder(shipmentsData?.shipments || {}, editingShipment?.id || null),
    [shipmentsData, editingShipment]
  );

  // Efektif status için allocatedByOrder (container + invoiced shipments)
  const allocatedByOrder = useMemo(
    () => computeAllocatedByOrder(allocationsData?.allocations || {}, shipmentsData?.shipments || {}),
    [allocationsData, shipmentsData]
  );

  // Seçili müşteri için stokKodu → bekleyen numune sipariş var mı?
  // Efektif status ("approved" veya "rejected" ise atlar).
  //   waiting_shipment → henüz sevk edilmemiş → sarı hafif uyarı
  //   sent            → sevkedilmiş ama onay yok → sarı uyarı
  //   rejected        → kırmızı kritik uyarı
  const pendingSampleByStok = useMemo(() => {
    if (!customerCode) return new Map();
    const m = new Map(); // stokKodu → { severity: "waiting"|"sent"|"rejected", latestBelgeNo, count, latestEff }
    for (const o of Object.values(ordersData?.orders || {})) {
      if (!o?.isSample) continue;
      if (o.customerCode !== customerCode) continue;
      if ((o.status || "open") === "cancelled") continue;
      const eff = getEffectiveSampleStatus(o, allocatedByOrder);
      if (eff === "approved") continue; // uyarı yok
      const code = o.stokKodu || "";
      if (!code) continue;
      const cur = m.get(code) || { count: 0, latestBelgeNo: "", severity: null, latestEff: null };
      cur.count += 1;
      cur.latestBelgeNo = o.belgeNo || cur.latestBelgeNo;
      cur.latestEff = eff;
      // severity öncelik: rejected > sent > waiting
      const sev = eff === "rejected" ? "rejected" : eff === "sent" ? "sent" : "waiting";
      const rank = { rejected: 3, sent: 2, waiting: 1 };
      if (!cur.severity || rank[sev] > rank[cur.severity]) cur.severity = sev;
      m.set(code, cur);
    }
    return m;
  }, [customerCode, ordersData, allocatedByOrder]);

  // Seçili müşterinin açık sipariş kalemleri (kalan miktar > 0, isLinkedChild dahil)
  const openOrderLines = useMemo(() => {
    if (!customerCode) return [];
    const orders = Object.values(ordersData?.orders || {})
      .filter(o => o?.customerCode === customerCode && (o.status || "open") === "open");
    return orders
      .map(o => {
        const orij = Number(o.orijinalMiktar) || 0;
        const sevkBas = Number(o.sevkedilenBaslangic) || 0;
        const otherShipmentUsed = shipmentAllocatedByOrder.get(o.id) || 0;
        // Kalan = orijinal - VIO başlangıç - diğer aktif shipment tahsisleri
        const remaining = Math.max(0, orij - sevkBas - otherShipmentUsed);
        // Bu shipment (edit modu) içinde zaten kullanılan miktarı da çıkar
        const usedInThisShipment = items.reduce((sum, it) => {
          const alloc = (it.allocations || []).find(a => a.orderId === o.id);
          return sum + (alloc?.qty || 0);
        }, 0);
        const availableForShipment = Math.max(0, remaining - usedInThisShipment);
        // Numune uyarısı — bu ürün için aynı müşteride bekleyen numune var mı?
        // Sadece SERİ sipariş satırlarında uyar (numunenin kendinde uyarma).
        const isSample = !!o.isSample;
        const sampleInfo = (!isSample && o.stokKodu) ? (pendingSampleByStok.get(o.stokKodu) || null) : null;
        return { order: o, remaining, usedInThisShipment, availableForShipment, isSample, sampleWarn: sampleInfo };
      })
      .filter(x => x.availableForShipment > 0 || x.usedInThisShipment > 0)
      .sort((a, b) => (a.order.teslimTarihi || "9999").localeCompare(b.order.teslimTarihi || "9999"));
  }, [customerCode, ordersData, items, shipmentAllocatedByOrder, pendingSampleByStok]);

  // Bu shipment'ta seçili satırlar arasında bekleyen numune uyarısı olan var mı?
  const pendingSamplesInSelection = useMemo(() => {
    const warned = [];
    for (const it of items) {
      const info = pendingSampleByStok.get(it.stokKodu);
      if (info) warned.push({ stokKodu: it.stokKodu, stokAdi: it.stokAdi, ...info });
    }
    return warned;
  }, [items, pendingSampleByStok]);

  const applyCustomer = (code) => {
    setCustomerCode(code);
    const opt = customerOptions.find(c => c.code === code);
    if (opt) setCustomerName(opt.name);
  };

  const addOrderLineToShipment = (order, addQty) => {
    const qty = Math.max(0, Number(addQty) || 0);
    if (qty <= 0) return;
    const existingIdx = items.findIndex(it => Number(it.pid) === Number(order.pid) && it.stokKodu === order.stokKodu);
    if (existingIdx >= 0) {
      // Aynı pid+stokKodu zaten var — allocation'a ekle veya güncelle
      setItems(prev => prev.map((it, i) => {
        if (i !== existingIdx) return it;
        const allocs = Array.isArray(it.allocations) ? [...it.allocations] : [];
        const allocIdx = allocs.findIndex(a => a.orderId === order.id);
        if (allocIdx >= 0) {
          allocs[allocIdx] = { ...allocs[allocIdx], qty: allocs[allocIdx].qty + qty };
        } else {
          allocs.push({ orderId: order.id, belgeNo: order.belgeNo, qty });
        }
        const newTotalQty = allocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
        return { ...it, qty: newTotalQty, allocations: allocs };
      }));
    } else {
      // Yeni kalem
      const prod = (products || []).find(p => Number(p.id) === Number(order.pid));
      setItems(prev => [...prev, {
        pid: order.pid,
        stokKodu: order.stokKodu || prod?.vioCode || "",
        stokAdi: order.stokAdi || prod?.nameTR || "",
        descriptionEn: order.descriptionEn || prod?.nameEN || "",
        qty,
        allocations: [{ orderId: order.id, belgeNo: order.belgeNo, qty }],
        notes: "",
      }]);
    }
  };

  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateItemAllocQty = (itemIdx, allocIdx, newQty) => {
    const q = Math.max(0, Number(newQty) || 0);
    setItems(prev => prev.map((it, i) => {
      if (i !== itemIdx) return it;
      const allocs = it.allocations.map((a, ai) => ai === allocIdx ? { ...a, qty: q } : a);
      const newTotal = allocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
      return { ...it, allocations: allocs, qty: newTotal };
    }));
  };

  const canSave = customerCode && customerName && shipmentDate && items.length > 0
    && items.every(it => Number(it.qty) > 0)
    && !isMotorLinked; // motor'a bağlı müşteri kaydı engellenir

  const handleSave = async () => {
    if (!canSave) {
      if (!customerCode) { setError("Müşteri zorunlu"); return; }
      if (!customerName) { setError("Müşteri adı zorunlu"); return; }
      if (!shipmentDate) { setError("Sevk tarihi zorunlu"); return; }
      if (items.length === 0) { setError("En az bir ürün eklenmeli"); return; }
      setError("Her kalemin miktarı > 0 olmalı"); return;
    }
    setSaving(true); setError("");
    try {
      const shipment = {
        id: editingShipment?.id || newShipmentId(),
        customerCode: customerCode.trim(),
        customerName: customerName.trim(),
        shipmentDate,
        plannedDate: plannedDate || "",
        notes: notes.trim(),
        items,
        status,
        linkedInvoiceIds: editingShipment?.linkedInvoiceIds || [],
        linkedOrderIds: [...new Set(items.flatMap(it => (it.allocations || []).map(a => a.orderId)))],
      };
      await saveExportShipment(shipment, { canEdit, userEmail });
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  return (
    <div style={modalBg} onClick={() => !saving && onCancel && onCancel()}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{isEdit ? "✏ Sevkiyat Düzenle" : "➕ Yeni Sevkiyat"}</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              {isEdit ? `ID: ${editingShipment.id}` : "Motor dışı ihracat sevkiyatı"}
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {error && <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}
        {isMotorLinked && (
          <div style={{ padding: 8, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11 }}>
            ⚠ <b>Bu müşteri motor'a bağlı</b> — Sevkiyat Detay ekranından yönetilmesi gerekiyor. Bu form üzerinden sevkiyat kaydı oluşturmak <b>tavsiye edilmez</b> (yönetim iki ayrı yerde parçalanır).
            {canEdit && <span style={{ display: "block", marginTop: 4, fontSize: 10 }}>Fatura Ayarları → "Motor'a Bağlı Müşteriler" bölümünden bu bağlantıyı yönetebilirsin.</span>}
          </div>
        )}
        {pendingSamplesInSelection.length > 0 && (() => {
          const hasRejected = pendingSamplesInSelection.some(s => s.severity === "rejected");
          const bg = hasRejected ? "#fef2f2" : "#fef3c7";
          const fg = hasRejected ? "#991b1b" : "#92400e";
          const border = hasRejected ? "#dc2626" : "#f59e0b";
          const title = hasRejected ? "⛔ REDDEDİLEN Numuneli Ürün(ler) Sevk Ediliyor" : "⚠ Numune Süreci Bekleyen Ürün(ler)";
          const labelFor = (sev) =>
            sev === "rejected" ? "✗ REDDEDİLDİ — seri sevki riskli!"
            : sev === "sent" ? "📦 Numune sevk edildi, onay bekleniyor"
            : "⏳ Numune henüz gönderilmedi";
          return (
            <div style={{ padding: 8, marginBottom: 10, background: bg, color: fg, border: `1px solid ${border}`, borderRadius: 4, fontSize: 11 }}>
              {hasRejected ? "⛔" : "⚠"} <b>{title}</b> — {pendingSamplesInSelection.length} kalem:
              <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 10 }}>
                {pendingSamplesInSelection.map((s, i) => (
                  <li key={i}>
                    <b>{s.stokKodu}</b>{s.stokAdi ? ` — ${s.stokAdi}` : ""} · numune belge #{s.latestBelgeNo || "?"} · <b>{labelFor(s.severity)}</b>
                  </li>
                ))}
              </ul>
              <span style={{ display: "block", marginTop: 4, fontSize: 10 }}>
                Kaydetmeye devam edebilirsin — bu sadece bilgi amaçlıdır. Numune onaylandığında Sipariş Listesi'nde satırın 🔬 rozetinden ✓ Onaylandı seç.
              </span>
            </div>
          );
        })()}

        {/* Header info */}
        <Section title="Sevkiyat Bilgisi">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            <Field label="Müşteri *">
              <input list="shp-customer-list" value={customerCode}
                onChange={e => { const v = e.target.value; const opt = customerOptions.find(c => c.code === v); if (opt) applyCustomer(opt.code); else setCustomerCode(v); }}
                placeholder="Örn. 120-0003" style={inp} disabled={isEdit} />
              <datalist id="shp-customer-list">
                {customerOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </datalist>
            </Field>
            <Field label="Müşteri Adı *">
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} style={inp} />
            </Field>
            <Field label="Sevk Tarihi *">
              <input type="date" value={shipmentDate} onChange={e => setShipmentDate(e.target.value)} style={inp} />
            </Field>
            <Field label="Planlanan Tarih">
              <input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} style={inp} />
            </Field>
          </div>
          <Field label="Notlar (opsiyonel)">
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Örn. Ambar A rampa 3, kırmızı etiket" style={inp} />
          </Field>
        </Section>

        {/* Açık sipariş kalemleri — ekleme butonlarıyla */}
        <Section title={`Müşteriye Ait Açık Sipariş Kalemleri ${customerCode ? `(${openOrderLines.length})` : ""}`}>
          {!customerCode ? (
            <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "#a8a29e" }}>Önce müşteri seç.</div>
          ) : openOrderLines.length === 0 ? (
            <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 4 }}>
              Bu müşteriye ait açık sipariş kalemi yok (veya hepsi bu sevkiyata eklenmiş).
            </div>
          ) : (
            <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid #e7e5e4", borderRadius: 4 }}>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead style={{ background: "#f5f5f4", position: "sticky", top: 0 }}>
                  <tr>
                    <th style={th}>Belge</th>
                    <th style={th}>Stok</th>
                    <th style={th}>Ürün</th>
                    <th style={th}>Termin</th>
                    <th style={{ ...th, textAlign: "right" }}>Kalan</th>
                    <th style={{ ...th, textAlign: "center", width: 130 }}>Sevke Ekle</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrderLines.map(x => (
                    <OrderLineRow key={x.order.id} entry={x} onAdd={(q) => addOrderLineToShipment(x.order, q)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Sevkiyata eklenen kalemler */}
        <Section title={`Sevkiyata Eklenen Kalemler (${items.length} kalem · ${fmt0(totalQty)} adet)`}>
          {items.length === 0 ? (
            <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 4 }}>
              Henüz kalem yok. Üstteki açık siparişlerden "Ekle" ile başla.
            </div>
          ) : (
            <div style={{ border: "1px solid #e7e5e4", borderRadius: 4, overflow: "hidden" }}>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead style={{ background: "#f5f5f4" }}>
                  <tr>
                    <th style={th}>Stok</th>
                    <th style={th}>Ürün Adı</th>
                    <th style={{ ...th, textAlign: "right" }}>Toplam Adet</th>
                    <th style={th}>Tahsisler (belge → adet)</th>
                    <th style={{ ...th, width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} style={{ borderTop: "1px solid #f5f5f4" }}>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{it.stokKodu}</td>
                      <td style={td}>
                        <div>{it.stokAdi}</div>
                        {it.descriptionEn && <div style={{ fontSize: 9, color: "#78716c", fontStyle: "italic" }}>{it.descriptionEn}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmt0(it.qty)}</td>
                      <td style={td}>
                        {(it.allocations || []).map((a, ai) => (
                          <div key={ai} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2, fontSize: 9 }}>
                            <span style={{ padding: "1px 5px", background: "#f5f5f4", borderRadius: 2, fontFamily: "ui-monospace, monospace" }}>#{a.belgeNo}</span>
                            <input type="number" value={a.qty} onChange={e => updateItemAllocQty(idx, ai, e.target.value)}
                              min="0" style={{ width: 60, padding: "1px 4px", fontSize: 9, border: "1px solid #d6d3d1", borderRadius: 2, textAlign: "right" }} />
                          </div>
                        ))}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <button onClick={() => removeItem(idx)}
                          style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Kaydet */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14, borderTop: "1px solid #e7e5e4", paddingTop: 10 }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Vazgeç
          </button>
          <button onClick={handleSave} disabled={saving || !canEdit || !canSave}
            style={{ padding: "6px 14px", fontSize: 12, background: canSave ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (saving || !canSave) ? "not-allowed" : "pointer", fontWeight: 500 }}>
            {saving ? "Kaydediliyor…" : (isEdit ? "💾 Güncelle" : "💾 Kaydet")}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderLineRow({ entry, onAdd }) {
  const [addQty, setAddQty] = useState(String(entry.availableForShipment));
  useEffect(() => { setAddQty(String(entry.availableForShipment)); }, [entry.availableForShipment]);
  const { order, remaining, usedInThisShipment, availableForShipment, isSample, sampleWarn } = entry;
  // Uyarı severity'sine göre satır arka planı + rozet metni
  const warnMeta = sampleWarn ? (
    sampleWarn.severity === "rejected" ? { rowBg: "#fef2f2", bg: "#fef2f2", fg: "#991b1b", border: "#dc2626", label: "⛔ Numune REDDEDİLDİ" }
    : sampleWarn.severity === "sent" ? { rowBg: "#fef3c7", bg: "#fef3c7", fg: "#92400e", border: "#f59e0b", label: "📦 Numune onayı bekleniyor" }
    : { rowBg: "#fefce8", bg: "#fefce8", fg: "#854d0e", border: "#eab308", label: "⏳ Numune henüz gönderilmedi" }
  ) : null;
  const rowBg = isSample ? "#faf5ff" : (warnMeta ? warnMeta.rowBg : "transparent");
  return (
    <tr style={{ borderTop: "1px solid #f5f5f4", background: rowBg }}>
      <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>
        #{order.belgeNo}
        {isSample && (
          <span title="Numune satırı" style={{ marginLeft: 4, padding: "0 4px", fontSize: 8, fontWeight: 700, background: "#f5f3ff", color: "#5b21b6", border: "1px solid #ddd6fe", borderRadius: 2 }}>🔬</span>
        )}
        {warnMeta && !isSample && (
          <span title={`Aynı ürünün numunesi ${sampleWarn.severity === "rejected" ? "REDDEDİLDİ" : sampleWarn.severity === "sent" ? "sevk edildi ama onay yok" : "henüz gönderilmedi"} (belge #${sampleWarn.latestBelgeNo || "?"})`}
            style={{ marginLeft: 4, padding: "0 4px", fontSize: 8, fontWeight: 700, background: warnMeta.bg, color: warnMeta.fg, border: `1px solid ${warnMeta.border}`, borderRadius: 2 }}>
            {warnMeta.label}
          </span>
        )}
      </td>
      <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 9 }}>{order.stokKodu}</td>
      <td style={td}>{order.stokAdi || "—"}</td>
      <td style={{ ...td, fontSize: 9, color: "#78716c" }}>{order.teslimTarihi || "—"}</td>
      <td style={{ ...td, textAlign: "right" }}>
        <span style={{ fontWeight: 600, color: "#166534" }}>{fmt0(availableForShipment)}</span>
        {usedInThisShipment > 0 && <span style={{ marginLeft: 4, fontSize: 8, color: "#78716c" }}>· eklenmiş {fmt0(usedInThisShipment)}</span>}
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <div style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
          <input type="number" value={addQty} onChange={e => setAddQty(e.target.value)}
            min="0" max={availableForShipment}
            style={{ width: 55, padding: "1px 4px", fontSize: 9, border: "1px solid #d6d3d1", borderRadius: 2, textAlign: "right" }} />
          <button onClick={() => { onAdd(addQty); setAddQty("0"); }} disabled={Number(addQty) <= 0 || Number(addQty) > availableForShipment}
            style={{ padding: "1px 8px", fontSize: 9, background: Number(addQty) > 0 ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 2, cursor: Number(addQty) > 0 ? "pointer" : "not-allowed", fontWeight: 500 }}>
            + Ekle
          </button>
        </div>
      </td>
    </tr>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px dashed #e7e5e4" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#44403c", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 900, maxHeight: "92vh", overflow: "auto" };
const inp = { width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const th = { padding: "5px 6px", fontWeight: 600, fontSize: 9, textAlign: "left", color: "#44403c" };
const td = { padding: "4px 6px", fontSize: 10, verticalAlign: "middle" };
