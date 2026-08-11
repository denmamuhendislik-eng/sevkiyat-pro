// Fatura Oluşturma Modal
// Kaynak: Sevkiyat Detay konteyner tahsis paneli "🧾 Fatura Oluştur" butonu
//         VEYA Faturalar sekmesi + Yeni Fatura butonu (nakliye vb. bağımsız)
//
// Akış:
//   1. Konteynerdeki tahsis edilmiş kalemleri belge no bazlı grupla
//   2. Sistem otomatik "aynı ödeme planı" grup önerir
//   3. Kullanıcı checkbox'la manuel değiştirir
//   4. Her grup için: banka hesabı seç + ek satır (nakliye vb.) + oluştur
//   5. getNextInvoiceNumber → saveExportInvoice → PDF indir

import React, { useState, useMemo, useEffect } from "react";
import {
  getNextInvoiceNumber, saveExportInvoice, subscribeInvoiceSettings,
} from "./firestore";
import { generateInvoicePdf } from "./invoicePdf";
import { computeAllocatedByOrder } from "./allocationCalc";

// Ödeme planı array → stable hash (aynı planlar birleşsin)
function hashPaymentPlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return "";
  return plan.map(p => `${(p.label || "").trim()}|${Number(p.pct) || 0}`).sort().join(",");
}

// Sadece "tek satır, %100, teslimatta ödemeli" planları birleştir.
// Diğer tüm planlar (avans + teslimat, farklı yüzdeler, T/T 60 gün gibi)
// birleştirilmez, her sipariş kendi faturasına gider.
function isSimpleFullOnDelivery(plan) {
  if (!Array.isArray(plan)) return false;
  const filled = plan.filter(p => Number(p?.pct) > 0);
  if (filled.length !== 1) return false;
  if (Math.abs(Number(filled[0].pct) - 100) > 0.01) return false;
  const lbl = String(filled[0].label || "").toUpperCase();
  // "IN ADVANCE WITH DELIVERY" veya "ON DELIVERY" veya "AT DELIVERY" varyantları
  return lbl.includes("DELIVERY");
}

// Unique belgeNo (aynı sipariş no'ları tekrarlamasın)
function uniqueBelgeNos(orderIds, sourceOrderLines) {
  const seen = new Set();
  const out = [];
  for (const oid of orderIds) {
    const belge = sourceOrderLines[oid]?.order?.belgeNo;
    if (belge != null && !seen.has(String(belge))) {
      seen.add(String(belge));
      out.push(belge);
    }
  }
  return out.join(", ");
}

export default function InvoiceCreateModal({
  containerId,       // opsiyonel — konteynerdeki tahsislerden başlar
  year,              // opsiyonel
  items,             // opsiyonel — konteynerdeki {pid, qty, name} listesi
  products,
  ordersData,
  allocationsData,
  canEdit,
  userEmail,
  onClose,
  onCreated,
  mode = "container", // "container" | "blank" (blank = boş fatura, nakliye vb.)
}) {
  const [settings, setSettings] = useState({});
  useEffect(() => {
    const u = subscribeInvoiceSettings(d => setSettings(d || {}));
    return () => u && u();
  }, []);

  const allocatedByOrder = useMemo(
    () => computeAllocatedByOrder(allocationsData?.allocations || {}),
    [allocationsData]
  );

  // Kaynak kalemleri hazırla: containerId varsa konteyner tahsislerinden
  // (order bazlı grupla), yoksa boş başla.
  const sourceOrderLines = useMemo(() => {
    if (mode !== "container" || !containerId) return {};
    // orderId → { order, lines: [{pid, description, qty, unit, unitPrice}] }
    const byOrder = {};
    for (const item of (items || [])) {
      const key = `${year}_${containerId}_${item.pid}`;
      const alloc = allocationsData?.allocations?.[key];
      if (!alloc || !Array.isArray(alloc.allocations)) continue;
      for (const a of alloc.allocations) {
        if (!a?.orderId || !Number(a.qty)) continue;
        const orderObj = Object.values(ordersData?.orders || {}).find(o => o.id === a.orderId);
        if (!orderObj) continue;
        if (!byOrder[a.orderId]) byOrder[a.orderId] = { order: orderObj, lines: [] };
        const prod = (products || []).find(p => Number(p.id) === Number(item.pid));
        byOrder[a.orderId].lines.push({
          pid: item.pid,
          description: orderObj.descriptionEn || prod?.nameEN || item.name || "",
          qty: Number(a.qty) || 0,
          unit: orderObj.brm || "AD",
          unitPrice: Number(orderObj.birimFiyat) || 0,
          amount: (Number(a.qty) || 0) * (Number(orderObj.birimFiyat) || 0),
          sourceOrderId: a.orderId,
          sourceContainerAllocKey: key,
        });
      }
    }
    return byOrder;
  }, [mode, containerId, year, items, allocationsData, ordersData, products]);

  // Otomatik grup önerisi: aynı paymentPlan hash olanları birleştir
  const initialGroups = useMemo(() => {
    if (mode === "blank") {
      return [{
        key: "blank_1",
        orderIds: [],
        extraLines: [],
        customerCode: "",
        customerName: "",
        customerAddress: "",
        customerCity: "",
        customerCountry: "",
        currency: "EUR",
        deliveryTerms: "",
        deliveryTermsShort: "",
        paymentPlan: [{ label: "", pct: 100 }],
        orderNr: "",
      }];
    }
    // container modu
    // Yeni kural (kullanıcı isteği):
    //   - "Tek satır %100 DELIVERY" tipli sipariş(ler) tek grupta birleşir
    //   - Diğer tüm planlar (avans/taksit vb.) HER SİPARİŞ için AYRI grup
    // Sipariş belge no sırasına göre sırala (kullanıcı deneyimi için stabil).
    const orderIdList = Object.keys(sourceOrderLines).sort((a, b) => {
      const ba = String(sourceOrderLines[a]?.order?.belgeNo || "");
      const bb = String(sourceOrderLines[b]?.order?.belgeNo || "");
      return ba.localeCompare(bb, "tr", { numeric: true });
    });
    const deliveryGroup = [];
    const otherGroups = []; // her biri tek sipariş
    for (const oid of orderIdList) {
      const o = sourceOrderLines[oid].order;
      if (isSimpleFullOnDelivery(o.paymentPlan)) {
        deliveryGroup.push(oid);
      } else {
        otherGroups.push([oid]);
      }
    }
    // Delivery grubu önce (varsa), sonra diğer siparişler
    const allGroups = [];
    if (deliveryGroup.length > 0) allGroups.push(deliveryGroup);
    for (const g of otherGroups) allGroups.push(g);
    return allGroups.map((orderIds, idx) => {
      const first = sourceOrderLines[orderIds[0]].order;
      return {
        key: `grp_${idx + 1}`,
        orderIds,
        extraLines: [],
        customerCode: first.customerCode || "",
        customerName: first.customerName || "",
        customerAddress: first.customerAddress || "",
        customerCity: first.customerCity || "",
        customerCountry: first.customerCountry || "",
        currency: first.currency || "EUR",
        deliveryTerms: first.deliveryTerms || "",
        deliveryTermsShort: shortDelivery(first.deliveryTerms || ""),
        paymentPlan: Array.isArray(first.paymentPlan) ? first.paymentPlan.map(p => ({ ...p })) : [{ label: "", pct: 100 }],
        orderNr: uniqueBelgeNos(orderIds, sourceOrderLines),
      };
    });
  }, [sourceOrderLines, mode]);

  const [groups, setGroups] = useState(initialGroups);
  useEffect(() => setGroups(initialGroups), [initialGroups]);

  const [selectedBankId, setSelectedBankId] = useState("");
  const bankAccounts = useMemo(() => {
    const list = Array.isArray(settings?.bankAccounts) ? settings.bankAccounts : [];
    // Backward-compat: eski bankInfo tek hesap olarak eklenir
    if (list.length === 0 && settings?.bankInfo) {
      return [{ id: "legacy_1", label: "Ana Hesap", ...settings.bankInfo, isDefault: true }];
    }
    return list;
  }, [settings]);
  useEffect(() => {
    if (!selectedBankId && bankAccounts.length > 0) {
      const def = bankAccounts.find(a => a.isDefault) || bankAccounts[0];
      setSelectedBankId(def.id);
    }
  }, [bankAccounts, selectedBankId]);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [createdInvoices, setCreatedInvoices] = useState([]); // {invoiceNo, groupKey}

  // ===== Grup yönetimi =====
  const moveOrderToGroup = (orderId, targetGroupKey) => {
    setGroups(prev => prev.map(g => ({
      ...g,
      orderIds: g.key === targetGroupKey
        ? [...g.orderIds, orderId]
        : g.orderIds.filter(x => x !== orderId),
    })).filter(g => g.orderIds.length > 0 || g.extraLines.length > 0 || mode === "blank"));
  };

  const splitOrderToOwnGroup = (orderId, currentGroupKey) => {
    const source = sourceOrderLines[orderId];
    if (!source) return;
    const first = source.order;
    const newKey = `grp_${Date.now()}`;
    setGroups(prev => {
      // Kaynak gruptan orderId'yi çıkar + orderNr'ı yeniden hesapla
      const updated = prev.map(g => {
        if (g.key !== currentGroupKey) return g;
        const newOrderIds = g.orderIds.filter(x => x !== orderId);
        return { ...g, orderIds: newOrderIds, orderNr: uniqueBelgeNos(newOrderIds, sourceOrderLines) };
      });
      // Yeni grubu oluştur
      const newGroup = {
        key: newKey,
        orderIds: [orderId],
        extraLines: [],
        customerCode: first.customerCode,
        customerName: first.customerName,
        customerAddress: first.customerAddress || "",
        customerCity: first.customerCity || "",
        customerCountry: first.customerCountry || "",
        currency: first.currency || "EUR",
        deliveryTerms: first.deliveryTerms || "",
        deliveryTermsShort: shortDelivery(first.deliveryTerms || ""),
        paymentPlan: Array.isArray(first.paymentPlan) ? first.paymentPlan.map(p => ({ ...p })) : [],
        orderNr: String(first.belgeNo || ""),
      };
      // Kaynak grubun konumu (temizleme öncesi) — yeni grup hemen altına yerleştir
      const sourceIdx = updated.findIndex(g => g.key === currentGroupKey);
      const cleaned = updated.filter(g => g.orderIds.length > 0 || g.extraLines.length > 0);
      // Kaynak grup hala varsa altına, silindiyse eski konumuna
      const stillIdx = cleaned.findIndex(g => g.key === currentGroupKey);
      if (stillIdx >= 0) {
        return [...cleaned.slice(0, stillIdx + 1), newGroup, ...cleaned.slice(stillIdx + 1)];
      }
      const insertAt = Math.min(Math.max(0, sourceIdx), cleaned.length);
      return [...cleaned.slice(0, insertAt), newGroup, ...cleaned.slice(insertAt)];
    });
  };

  // Gruplar arası sıralama — kullanıcı ↑↓ ile değiştirir
  const moveGroup = (groupKey, direction) => {
    setGroups(prev => {
      const idx = prev.findIndex(g => g.key === groupKey);
      if (idx < 0) return prev;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[targetIdx]] = [copy[targetIdx], copy[idx]];
      return copy;
    });
  };

  const updateGroupField = (groupKey, field, value) => {
    setGroups(prev => prev.map(g => g.key === groupKey ? { ...g, [field]: value } : g));
  };

  const addExtraLine = (groupKey) => {
    setGroups(prev => prev.map(g => g.key === groupKey
      ? { ...g, extraLines: [...g.extraLines, { description: "", qty: 1, unit: "AD", unitPrice: 0 }] }
      : g));
  };
  const updateExtraLine = (groupKey, idx, field, value) => {
    setGroups(prev => prev.map(g => {
      if (g.key !== groupKey) return g;
      return {
        ...g,
        extraLines: g.extraLines.map((l, i) => i === idx ? { ...l, [field]: field === "description" || field === "unit" ? value : (Number(value) || 0) } : l),
      };
    }));
  };
  const removeExtraLine = (groupKey, idx) => {
    setGroups(prev => prev.map(g => g.key === groupKey
      ? { ...g, extraLines: g.extraLines.filter((_, i) => i !== idx) }
      : g));
  };

  // Grup için tüm kalemleri hesapla (order lines + extra lines)
  const buildGroupLines = (g) => {
    const orderLines = [];
    for (const orderId of g.orderIds) {
      const entry = sourceOrderLines[orderId];
      if (!entry) continue;
      for (const l of entry.lines) orderLines.push(l);
    }
    const extras = g.extraLines.map(l => ({
      description: l.description,
      qty: Number(l.qty) || 0,
      unit: l.unit || "AD",
      unitPrice: Number(l.unitPrice) || 0,
      amount: (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
      isExtra: true,
    }));
    return [...orderLines, ...extras];
  };

  const groupTotals = groups.map(g => {
    const lines = buildGroupLines(g);
    const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    return { key: g.key, total, lineCount: lines.length };
  });

  // ===== Fatura oluştur =====
  const createAllInvoices = async () => {
    if (!canEdit) return;
    const bank = bankAccounts.find(a => a.id === selectedBankId);
    if (!bank) { setError("Banka hesabı seçilmedi"); return; }
    setProcessing(true);
    setError("");
    const created = [];
    try {
      for (const g of groups) {
        const lines = buildGroupLines(g);
        if (lines.length === 0) continue;
        if (!g.customerName?.trim()) { throw new Error(`Grup #${g.key}: Müşteri adı zorunlu`); }
        const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
        // Atomik numara
        const invoiceNo = await getNextInvoiceNumber({ canEdit, userEmail });
        const invoiceObj = {
          invoiceNo,
          invoiceDate: new Date().toISOString().slice(0, 10),
          customerCode: g.customerCode,
          customerName: g.customerName,
          customerAddress: g.customerAddress,
          customerCity: g.customerCity,
          customerCountry: g.customerCountry,
          currency: g.currency,
          deliveryTerms: g.deliveryTerms,
          deliveryTermsShort: g.deliveryTermsShort,
          paymentPlan: g.paymentPlan.filter(p => (p.label || "").trim() || Number(p.pct) > 0),
          lines,
          totalAmount: total,
          orderNr: g.orderNr,
          containerId: containerId || null,
          year: year || null,
          linkedOrderIds: g.orderIds,
          linkedAllocationKeys: g.orderIds.map(oid => sourceOrderLines[oid]?.lines?.[0]?.sourceContainerAllocKey).filter(Boolean),
          bankAccount: {
            id: bank.id,
            label: bank.label,
            branchName: bank.branchName,
            iban: bank.iban,
            swift: bank.swift,
            currency: bank.currency,
          },
          status: "issued",
          source: mode === "container" ? "container-allocation" : "blank",
        };
        await saveExportInvoice(invoiceObj, { canEdit, userEmail });
        created.push({ invoiceNo, invoiceObj });
      }
      setCreatedInvoices(created.map(c => c.invoiceNo));
      // Her fatura için PDF üret + indir
      for (const c of created) {
        try { await generateInvoicePdf(c.invoiceObj, settings); }
        catch (pdfErr) { console.warn("PDF hatası:", c.invoiceNo, pdfErr.message); }
      }
      onCreated && onCreated(created);
    } catch (e) {
      setError(e.message || "Fatura oluşturulamadı");
    } finally {
      setProcessing(false);
    }
  };

  const totalToCreate = groups.filter(g => buildGroupLines(g).length > 0).length;

  return (
    <div style={modalBg} onClick={() => !processing && onClose && onClose()}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>🧾 Fatura Oluştur</div>
            <div style={{ fontSize: 10, color: "#78716c" }}>
              {mode === "container" ? "Konteyner tahsislerinden" : "Boş fatura"} · {totalToCreate} fatura kesilecek
            </div>
          </div>
          <button onClick={onClose} disabled={processing} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {error && <div style={{ padding: 8, marginBottom: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>}

        {createdInvoices.length > 0 && (
          <div style={{ padding: 8, marginBottom: 8, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, fontSize: 11 }}>
            ✓ {createdInvoices.length} fatura oluşturuldu: {createdInvoices.join(", ")} · PDF'ler indiriliyor…
          </div>
        )}

        {/* Banka seçimi (tümü için ortak) */}
        <div style={{ padding: 10, marginBottom: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#1e40af", marginRight: 6 }}>🏦 Banka Hesabı:</label>
          <select value={selectedBankId} onChange={e => setSelectedBankId(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #bfdbfe", borderRadius: 3 }}>
            {bankAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.label} ({a.currency}) {a.isDefault ? "— default" : ""}</option>
            ))}
          </select>
          {bankAccounts.length === 0 && <span style={{ marginLeft: 8, fontSize: 10, color: "#dc2626" }}>⚠ Banka hesabı tanımlı değil — Ayarlar'a git</span>}
        </div>

        {/* Gruplar */}
        {groups.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 12 }}>
            Konteynerde tahsis edilmiş kalem yok. Önce tahsis yap, sonra fatura oluştur.
          </div>
        ) : (
          groups.map((g, gi) => {
            const totals = groupTotals[gi];
            return (
              <div key={g.key} style={{ marginBottom: 12, padding: 10, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Fatura #{gi + 1}</span>
                    <span style={{ marginLeft: 8, fontSize: 10, color: "#78716c" }}>
                      · {g.orderIds.length} sipariş · {totals.lineCount} kalem · Toplam <b>{totals.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {g.currency}</b>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    <button onClick={() => moveGroup(g.key, "up")} disabled={gi === 0}
                      title="Yukarı taşı (numaralı sırası daha erken olur)"
                      style={{ padding: "2px 6px", fontSize: 10, background: gi === 0 ? "#f5f5f4" : "#eff6ff", color: gi === 0 ? "#a8a29e" : "#1e40af", border: `1px solid ${gi === 0 ? "#d6d3d1" : "#bfdbfe"}`, borderRadius: 3, cursor: gi === 0 ? "not-allowed" : "pointer" }}>↑</button>
                    <button onClick={() => moveGroup(g.key, "down")} disabled={gi === groups.length - 1}
                      title="Aşağı taşı"
                      style={{ padding: "2px 6px", fontSize: 10, background: gi === groups.length - 1 ? "#f5f5f4" : "#eff6ff", color: gi === groups.length - 1 ? "#a8a29e" : "#1e40af", border: `1px solid ${gi === groups.length - 1 ? "#d6d3d1" : "#bfdbfe"}`, borderRadius: 3, cursor: gi === groups.length - 1 ? "not-allowed" : "pointer" }}>↓</button>
                  </div>
                </div>

                {/* Müşteri + teslim + ödeme */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <Field label="Müşteri Adı">
                    <input value={g.customerName} onChange={e => updateGroupField(g.key, "customerName", e.target.value)} style={inp} />
                  </Field>
                  <Field label="Adres">
                    <input value={g.customerAddress} onChange={e => updateGroupField(g.key, "customerAddress", e.target.value)} style={inp} />
                  </Field>
                  <Field label="Şehir">
                    <input value={g.customerCity} onChange={e => updateGroupField(g.key, "customerCity", e.target.value)} style={inp} />
                  </Field>
                  <Field label="Ülke">
                    <input value={g.customerCountry} onChange={e => updateGroupField(g.key, "customerCountry", e.target.value)} style={inp} />
                  </Field>
                  <Field label="Teslim Şekli (uzun)">
                    <input value={g.deliveryTerms} onChange={e => updateGroupField(g.key, "deliveryTerms", e.target.value)} style={inp} />
                  </Field>
                  <Field label="Teslim Kısaltma (TOTAL yanında)">
                    <input value={g.deliveryTermsShort} onChange={e => updateGroupField(g.key, "deliveryTermsShort", e.target.value)}
                      placeholder="Örn. DDP/TREZZO SULL/ADDA (MI)" style={inp} />
                  </Field>
                  <Field label="ORDER NR.">
                    <input value={g.orderNr} onChange={e => updateGroupField(g.key, "orderNr", e.target.value)} style={inp} />
                  </Field>
                  <Field label="Para Birimi">
                    <select value={g.currency} onChange={e => updateGroupField(g.key, "currency", e.target.value)} style={{ ...inp, background: "#fff" }}>
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="TL">TL</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </Field>
                </div>

                {/* Sipariş kalemleri (readonly bilgi) */}
                {g.orderIds.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#57534e", marginBottom: 4 }}>Sipariş Kalemleri (tahsislerden):</div>
                    {g.orderIds.map(oid => {
                      const entry = sourceOrderLines[oid];
                      if (!entry) return null;
                      return (
                        <div key={oid} style={{ padding: 6, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 3, marginBottom: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>Belge #{entry.order.belgeNo}</div>
                            {g.orderIds.length > 1 && (
                              <button onClick={() => splitOrderToOwnGroup(oid, g.key)}
                                title="Bu siparişi ayrı faturaya çıkar"
                                style={{ padding: "1px 6px", fontSize: 9, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 2, cursor: "pointer" }}>
                                ⤴ Ayır
                              </button>
                            )}
                          </div>
                          <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
                            <tbody>
                              {entry.lines.map((l, li) => (
                                <tr key={li} style={{ borderTop: "1px solid #f5f5f4" }}>
                                  <td style={{ padding: "2px 4px" }}>{l.description}</td>
                                  <td style={{ padding: "2px 4px", textAlign: "right", width: 40 }}>{l.qty}</td>
                                  <td style={{ padding: "2px 4px", width: 25 }}>{l.unit}</td>
                                  <td style={{ padding: "2px 4px", textAlign: "right", width: 60 }}>{l.unitPrice.toFixed(2)} {g.currency}</td>
                                  <td style={{ padding: "2px 4px", textAlign: "right", width: 70, fontWeight: 600 }}>{l.amount.toFixed(2)} {g.currency}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Ek satırlar (nakliye vb.) */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#57534e", marginBottom: 4 }}>
                    Ek Kalemler (nakliye, yağ, sarf vs.):
                  </div>
                  {g.extraLines.map((el, ei) => (
                    <div key={ei} style={{ display: "grid", gridTemplateColumns: "3fr 40px 30px 60px 30px", gap: 4, marginBottom: 3, alignItems: "center" }}>
                      <input value={el.description} onChange={e => updateExtraLine(g.key, ei, "description", e.target.value)}
                        placeholder="Örn. KONYA MILAN TRANSPORTATION COST" style={{ ...inp, fontSize: 10 }} />
                      <input type="number" value={el.qty} onChange={e => updateExtraLine(g.key, ei, "qty", e.target.value)} style={{ ...inp, fontSize: 10, textAlign: "right" }} />
                      <input value={el.unit} onChange={e => updateExtraLine(g.key, ei, "unit", e.target.value)} style={{ ...inp, fontSize: 10 }} />
                      <input type="number" step="0.01" value={el.unitPrice} onChange={e => updateExtraLine(g.key, ei, "unitPrice", e.target.value)} style={{ ...inp, fontSize: 10, textAlign: "right" }} />
                      <button onClick={() => removeExtraLine(g.key, ei)}
                        style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>🗑</button>
                    </div>
                  ))}
                  <button onClick={() => addExtraLine(g.key)}
                    style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
                    + Ek Kalem Ekle
                  </button>
                </div>

                {/* Ödeme planı */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#57534e", marginBottom: 4 }}>Ödeme Planı:</div>
                  {g.paymentPlan.map((p, pi) => (
                    <div key={pi} style={{ display: "grid", gridTemplateColumns: "3fr 60px 30px", gap: 4, marginBottom: 3 }}>
                      <input value={p.label} onChange={e => {
                        const newPlan = g.paymentPlan.map((x, i) => i === pi ? { ...x, label: e.target.value } : x);
                        updateGroupField(g.key, "paymentPlan", newPlan);
                      }} style={{ ...inp, fontSize: 10 }} />
                      <input type="number" step="0.1" value={p.pct} onChange={e => {
                        const newPlan = g.paymentPlan.map((x, i) => i === pi ? { ...x, pct: Number(e.target.value) || 0 } : x);
                        updateGroupField(g.key, "paymentPlan", newPlan);
                      }} style={{ ...inp, fontSize: 10, textAlign: "right" }} />
                      <button onClick={() => {
                        const newPlan = g.paymentPlan.filter((_, i) => i !== pi);
                        updateGroupField(g.key, "paymentPlan", newPlan.length ? newPlan : [{ label: "", pct: 0 }]);
                      }} style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>🗑</button>
                    </div>
                  ))}
                  <button onClick={() => {
                    updateGroupField(g.key, "paymentPlan", [...g.paymentPlan, { label: "", pct: 0 }]);
                  }} style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
                    + Ödeme Satırı
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Aksiyon */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
          <button onClick={onClose} disabled={processing}
            style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Vazgeç
          </button>
          <button onClick={createAllInvoices} disabled={processing || !canEdit || totalToCreate === 0 || !selectedBankId}
            style={{ padding: "6px 14px", fontSize: 12, background: (processing || totalToCreate === 0) ? "#a8a29e" : "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: (processing || totalToCreate === 0) ? "not-allowed" : "pointer", fontWeight: 500 }}>
            {processing ? "Oluşturuluyor…" : `🧾 ${totalToCreate} Fatura Oluştur + PDF İndir`}
          </button>
        </div>
      </div>
    </div>
  );
}

// "DDP / TREZZO SULL / ADDA (MI)" → "DDP/TREZZO SULL/ADDA (MI)" (parantez kısaltma)
function shortDelivery(long) {
  return String(long || "").replace(/\s*\/\s*/g, "/");
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 9, fontWeight: 500, color: "#57534e", marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width: "100%", padding: "4px 6px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
const modalBox = { background: "#fff", borderRadius: 8, padding: 16, width: "100%", maxWidth: 900, maxHeight: "92vh", overflow: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.15)" };
