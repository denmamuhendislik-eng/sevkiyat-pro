// İhracat Sipariş Formu — çok kalemli.
// Header: müşteri + belge + tarih + currency + teslim şekli + ödeme planı (ortak)
// Body: kalemler array — her satır stok kodu, ürün adları, miktar, başlangıç sevk, birim fiyat
// Kaydet → her kalem için ayrı saveExportOrder + motor sync
// Edit mode: tek kalemi düzenleme (mevcut davranış aynen), lines array tek elemanla başlar

import React, { useState, useEffect, useMemo } from "react";
import { saveExportOrder, addPaymentLabel, saveCustomerDefaults, addDeliveryTerm, deleteExportOrder } from "./firestore";
import { validatePaymentPlan } from "./allocationCalc";

const CURRENCIES = ["EUR", "USD", "TL", "GBP"];

function buildId(belgeNo, stokKodu, teslimTarihi) {
  const key = (teslimTarihi || "").trim() || "notarih";
  return `${String(belgeNo || "").trim()}_${String(stokKodu || "").trim()}_${key}`;
}

// Yeni boş kalem
function newLine() {
  return { stokKodu: "", pid: null, stokAdi: "", descriptionEn: "", orijinalMiktar: "", sevkedilenBaslangic: "", birimFiyat: "", childPrices: {} };
}

export default function OrderForm({ editingOrder, settings, products, canEdit, userEmail, onSaved, onCancel, motorSync, combRules = [], ordersData }) {
  // Header (ortak)
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerCountry, setCustomerCountry] = useState("");
  const [belgeNo, setBelgeNo] = useState("");
  const [orderDate, setOrderDate] = useState(""); // sipariş alım tarihi (opsiyonel)
  const [teslimTarihi, setTeslimTarihi] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [paymentPlan, setPaymentPlan] = useState([{ label: "", pct: 100 }]);
  const [status, setStatus] = useState("open");
  const [saveDefaultsForCustomer, setSaveDefaultsForCustomer] = useState(false);

  // Body — kalemler
  const [lines, setLines] = useState([newLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Düzenleme modunda alanları doldur
  useEffect(() => {
    if (editingOrder) {
      setCustomerCode(editingOrder.customerCode || "");
      setCustomerName(editingOrder.customerName || "");
      setCustomerAddress(editingOrder.customerAddress || "");
      setCustomerCity(editingOrder.customerCity || "");
      setCustomerCountry(editingOrder.customerCountry || "");
      setBelgeNo(editingOrder.belgeNo || "");
      setOrderDate(editingOrder.orderDate || "");
      setTeslimTarihi(editingOrder.teslimTarihi || "");
      setCurrency(editingOrder.currency || "EUR");
      setDeliveryTerms(editingOrder.deliveryTerms || "");
      setPaymentPlan(Array.isArray(editingOrder.paymentPlan) && editingOrder.paymentPlan.length > 0 ? editingOrder.paymentPlan : [{ label: "", pct: 100 }]);
      setStatus(editingOrder.status || "open");
      // Edit modunda tek kalem (bağlı child fiyatları ayrı useEffect ile hydrate edilir)
      setLines([{
        stokKodu: editingOrder.stokKodu || "",
        pid: editingOrder.pid != null ? editingOrder.pid : null,
        stokAdi: editingOrder.stokAdi || "",
        descriptionEn: editingOrder.descriptionEn || "",
        orijinalMiktar: String(editingOrder.orijinalMiktar || ""),
        sevkedilenBaslangic: String(editingOrder.sevkedilenBaslangic || ""),
        birimFiyat: String(editingOrder.birimFiyat || ""),
        childPrices: {},
      }]);
    } else {
      setCustomerCode(""); setCustomerName("");
      setCustomerAddress(""); setCustomerCity(""); setCustomerCountry("");
      setBelgeNo(""); setOrderDate(new Date().toISOString().slice(0, 10)); setTeslimTarihi("");
      setCurrency("EUR"); setDeliveryTerms("");
      setPaymentPlan([{ label: "", pct: 100 }]); setStatus("open");
      setLines([newLine()]);
    }
    setError("");
  }, [editingOrder]);

  // Müşteri seçilince default'ları yükle
  const customerDefaults = settings?.customerDefaults || {};
  const applyCustomerDefaults = (code, name) => {
    setCustomerCode(code);
    setCustomerName(name);
    if (!editingOrder) {
      const d = customerDefaults[code];
      if (d) {
        if (d.currency) setCurrency(d.currency);
        if (Array.isArray(d.paymentPlan) && d.paymentPlan.length > 0) setPaymentPlan(d.paymentPlan);
        if (d.address) setCustomerAddress(d.address);
        if (d.city) setCustomerCity(d.city);
        if (d.country) setCustomerCountry(d.country);
        if (d.deliveryTerms) setDeliveryTerms(d.deliveryTerms);
      }
    }
  };

  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const [code, d] of Object.entries(customerDefaults)) {
      map.set(code, d.customerName || code);
    }
    return Array.from(map, ([code, name]) => ({ code, name }));
  }, [customerDefaults]);

  // Kalem operasyonları
  const addLine = () => setLines(prev => [...prev, newLine()]);
  const removeLine = (idx) => setLines(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  const updateLine = (idx, patch) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));

  // Ürün seçildiğinde satırı otomatik doldur + fiyat auto-fill
  // Fiyat öncelik: müşteri+pid geçmişi → ürün kartı satış fiyatı (salesPriceEur)
  const lookupPrice = (customerC, pid) => {
    if (customerC) {
      const prior = Object.values(ordersData?.orders || {})
        .filter(o => o.customerCode === customerC && Number(o.pid) === Number(pid) && Number(o.birimFiyat) > 0)
        .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0];
      if (prior?.birimFiyat > 0) return Number(prior.birimFiyat);
    }
    const pm = (products || []).find(p => Number(p.id) === Number(pid));
    if (pm?.salesPriceEur > 0) return Number(pm.salesPriceEur);
    return null;
  };

  const applyProductToLine = (idx, code) => {
    const found = (products || []).find(p => p.vioCode === code);
    const patch = { stokKodu: code };
    if (found) {
      patch.pid = found.id;
      patch.stokAdi = found.nameTR || "";
      const currentLine = lines[idx];
      if (!currentLine?.descriptionEn && found.nameEN) patch.descriptionEn = found.nameEN;
      // Ana kalem fiyatı
      if (!editingOrder && !currentLine?.birimFiyat) {
        const p = lookupPrice(customerCode, found.id);
        if (p != null) patch.birimFiyat = String(p);
      }
      // Cascade children: her child için de fiyat pre-fill (geçmiş → ürün kartı)
      const rules = (combRules || []).filter(r => Number(r.parent) === Number(found.id));
      if (rules.length > 0 && !editingOrder) {
        const childIds = [...new Set(rules.flatMap(r => (r.children || []).map(Number)))];
        const nextChildPrices = { ...(currentLine?.childPrices || {}) };
        for (const cid of childIds) {
          if (nextChildPrices[cid]) continue; // user already typed
          const p = lookupPrice(customerCode, cid);
          if (p != null) nextChildPrices[cid] = String(p);
        }
        patch.childPrices = nextChildPrices;
      }
    }
    updateLine(idx, patch);
  };

  // Edit modunda parent düzenleniyorsa — mevcut bağlı child kayıtlarındaki fiyatları hydrate et
  useEffect(() => {
    if (!editingOrder || editingOrder.isLinkedChild) return;
    if (editingOrder.pid == null || !editingOrder.belgeNo) return;
    const rules = (combRules || []).filter(r => Number(r.parent) === Number(editingOrder.pid));
    if (rules.length === 0) return;
    const childIds = [...new Set(rules.flatMap(r => (r.children || []).map(Number)))];
    const priceMap = {};
    for (const cid of childIds) {
      const cp = (products || []).find(p => Number(p.id) === cid);
      const childStokKodu = cp?.vioCode || "";
      if (!childStokKodu) continue;
      const childId = buildId(editingOrder.belgeNo, childStokKodu, editingOrder.teslimTarihi || "");
      const existingChild = ordersData?.orders?.[childId];
      if (existingChild?.birimFiyat != null) {
        priceMap[cid] = String(existingChild.birimFiyat);
      }
    }
    if (Object.keys(priceMap).length > 0) {
      setLines(prev => prev.map((l, i) => i === 0 ? { ...l, childPrices: priceMap } : l));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingOrder, combRules, products, ordersData]);

  // Müşteri değişince mevcut kalemlerde boş fiyatları auto-fill (ana + cascade children)
  useEffect(() => {
    if (editingOrder) return;
    if (!customerCode) return;
    let anyUpdated = false;
    const updated = lines.map(l => {
      let newLineObj = l;
      // Ana kalem fiyatı
      if (l.pid != null && !l.birimFiyat) {
        const p = lookupPrice(customerCode, l.pid);
        if (p != null) {
          newLineObj = { ...newLineObj, birimFiyat: String(p) };
          anyUpdated = true;
        }
      }
      // Cascade children fiyatları
      if (l.pid != null) {
        const rules = (combRules || []).filter(r => Number(r.parent) === Number(l.pid));
        if (rules.length > 0) {
          const childIds = [...new Set(rules.flatMap(r => (r.children || []).map(Number)))];
          const nextChildPrices = { ...(newLineObj.childPrices || {}) };
          let cpUpdated = false;
          for (const cid of childIds) {
            if (nextChildPrices[cid]) continue;
            const p = lookupPrice(customerCode, cid);
            if (p != null) { nextChildPrices[cid] = String(p); cpUpdated = true; }
          }
          if (cpUpdated) {
            newLineObj = { ...newLineObj, childPrices: nextChildPrices };
            anyUpdated = true;
          }
        }
      }
      return newLineObj;
    });
    if (anyUpdated) setLines(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerCode]);

  // Cascade children hesabı (per pid)
  const getCascadeChildren = (pid) => {
    if (pid == null) return [];
    const rules = (combRules || []).filter(r => Number(r.parent) === Number(pid));
    if (rules.length === 0) return [];
    const childIds = [...new Set(rules.flatMap(r => (r.children || []).map(Number)))];
    return childIds.map(cid => {
      const cp = (products || []).find(p => Number(p.id) === cid);
      return { pid: cid, vioCode: cp?.vioCode || "", nameTR: cp?.nameTR || `pid ${cid}` };
    });
  };

  // Ödeme planı
  const addPlanRow = () => setPaymentPlan([...paymentPlan, { label: "", pct: 0 }]);
  const removePlanRow = (i) => setPaymentPlan(paymentPlan.filter((_, idx) => idx !== i));
  const updatePlanRow = (i, key, val) => setPaymentPlan(paymentPlan.map((p, idx) => idx === i ? { ...p, [key]: key === "pct" ? Number(val) || 0 : val } : p));
  const paymentValidation = validatePaymentPlan(paymentPlan);

  // Kaydedilebilir kalem sayısı
  const validLines = lines.filter(l => l.stokKodu && l.pid != null && Number(l.orijinalMiktar) > 0);
  const canSave = customerCode && customerName && belgeNo && validLines.length > 0;

  const handleSave = async () => {
    if (!canSave) {
      if (!customerCode) { setError("Müşteri kodu zorunlu"); return; }
      if (!customerName) { setError("Müşteri adı zorunlu"); return; }
      if (!belgeNo) { setError("Belge numarası zorunlu"); return; }
      setError("En az bir kalemde stok kodu + miktar girilmeli"); return;
    }
    setSaving(true);
    setError("");
    try {
      const commonPayload = {
        customerCode: customerCode.trim(),
        customerName: customerName.trim(),
        customerAddress: customerAddress.trim(),
        customerCity: customerCity.trim(),
        customerCountry: customerCountry.trim(),
        belgeNo: String(belgeNo).trim(),
        currency,
        orderDate: orderDate || "",
        teslimTarihi: teslimTarihi || "",
        deliveryTerms: deliveryTerms.trim(),
        paymentPlan: paymentPlan.filter(p => (p.label || "").trim() || (Number(p.pct) || 0) > 0),
        status,
        source: editingOrder?.source || "manual",
      };
      // Edit mode: eski payload/motor delta hesabı — mevcut tek kalem senaryosu
      if (editingOrder) {
        const line = lines[0];
        const id = buildId(belgeNo, line.stokKodu, teslimTarihi);
        const payload = {
          id,
          ...commonPayload,
          stokKodu: line.stokKodu.trim(),
          stokAdi: line.stokAdi.trim(),
          descriptionEn: line.descriptionEn.trim(),
          pid: line.pid != null ? Number(line.pid) : null,
          orijinalMiktar: Number(line.orijinalMiktar) || 0,
          sevkedilenBaslangic: Number(line.sevkedilenBaslangic) || 0,
          birimFiyat: Number(line.birimFiyat) || 0,
        };
        const oldId = editingOrder.id;
        const idChanged = oldId && oldId !== id;
        // Yeni kayıt önce yaz — eski ID kaldıysa altta silinir
        await saveExportOrder(payload, { canEdit, userEmail });
        applyMotorSyncForEdit(payload);
        // ID değiştiyse (teslim tarihi veya stok kodu değişimi) → eski parent + bağlı child'ları sil
        // Bu duplicate kayıt oluşmasını engeller
        if (idChanged && !editingOrder?.isLinkedChild) {
          // Eski parent'a bağlı child kayıtları: aynı belgeNo + eski teslim tarihi + linkedParentPid=eski parent pid
          const oldChildren = Object.values(ordersData?.orders || {}).filter(o =>
            o.isLinkedChild &&
            o.belgeNo === editingOrder.belgeNo &&
            o.teslimTarihi === editingOrder.teslimTarihi &&
            Number(o.linkedParentPid) === Number(editingOrder.pid)
          );
          for (const c of oldChildren) {
            try { await deleteExportOrder(c.id, { canEdit, userEmail }); }
            catch (e) { console.warn("Eski bağlı child silinemedi:", c.id, e.message); }
          }
          // Eski parent kaydını sil
          try { await deleteExportOrder(oldId, { canEdit, userEmail }); }
          catch (e) { console.warn("Eski parent silinemedi:", oldId, e.message); }
        }
        // Bağlı child kayıtlarını senkronla — SADECE parent düzenleniyorsa (child'ın child'ı yok)
        if (!editingOrder?.isLinkedChild) {
          await syncLinkedChildren(payload, line.childPrices || {});
        }
      } else {
        // Yeni sipariş: her geçerli kalem için ayrı kayıt + ayrı motor sync
        for (const line of validLines) {
          const id = buildId(belgeNo, line.stokKodu, teslimTarihi);
          const payload = {
            id,
            ...commonPayload,
            stokKodu: line.stokKodu.trim(),
            stokAdi: line.stokAdi.trim(),
            descriptionEn: line.descriptionEn.trim(),
            pid: Number(line.pid),
            orijinalMiktar: Number(line.orijinalMiktar) || 0,
            sevkedilenBaslangic: Number(line.sevkedilenBaslangic) || 0,
            birimFiyat: Number(line.birimFiyat) || 0,
          };
          await saveExportOrder(payload, { canEdit, userEmail });
          applyMotorSyncForNew(payload);
          // Cascade child kayıtları — parent'ın bileşenleri ayrı kalem olarak
          await createLinkedChildren(payload, line.childPrices || {});
        }
      }
      // Teslim şekli + ödeme etiketleri
      if (commonPayload.deliveryTerms) await addDeliveryTerm(commonPayload.deliveryTerms, { canEdit, userEmail });
      for (const p of commonPayload.paymentPlan) {
        if (p.label?.trim()) await addPaymentLabel(p.label, { canEdit, userEmail });
      }
      // Müşteri default'larını güncelle
      if (saveDefaultsForCustomer && customerCode) {
        const existing = customerDefaults[customerCode] || {};
        await saveCustomerDefaults(customerCode, {
          ...existing,
          customerName: customerName.trim() || existing.customerName || "",
          address: customerAddress.trim() || existing.address || "",
          city: customerCity.trim() || existing.city || "",
          country: customerCountry.trim() || existing.country || "",
          deliveryTerms: deliveryTerms.trim() || existing.deliveryTerms || "",
          currency,
          paymentPlan: commonPayload.paymentPlan,
        }, { canEdit, userEmail });
      }
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  // Bağlı child kayıtları oluştur — parent'ın kombine bileşenleri ayrı kalem olarak
  // Motor sync ÇAĞRILMAZ (parent'ın cascade'i zaten yd.orders'a yazıyor — çift sayım önlenir)
  // childPrices: kullanıcının form üzerinden bağlı ürünler için girdiği fiyatlar {pid: string}
  const createLinkedChildren = async (parentPayload, childPrices = {}) => {
    if (!parentPayload?.pid) return;
    if ((parentPayload.status || "open") === "cancelled") return;
    const rules = (combRules || []).filter(r => Number(r.parent) === Number(parentPayload.pid));
    if (rules.length === 0) return;
    const childIds = [...new Set(rules.flatMap(r => (r.children || []).map(Number)))];
    for (const cid of childIds) {
      const child = (products || []).find(p => Number(p.id) === cid);
      if (!child) continue;
      const childStokKodu = child.vioCode || "";
      if (!childStokKodu) continue; // vioCode olmayan ürüne kayıt açmayız
      const childId = buildId(parentPayload.belgeNo, childStokKodu, parentPayload.teslimTarihi);
      // Mevcut child kaydı varsa (edit senaryosu) description KORUNUR
      const existingChild = ordersData?.orders?.[childId];
      // Fiyat önceliği: form input > mevcut kayıt > müşteri+pid geçmişi > ürün kartı salesPriceEur > 0
      const userEnteredPrice = childPrices[cid];
      let effectivePrice = 0;
      if (userEnteredPrice != null && userEnteredPrice !== "") {
        effectivePrice = Number(userEnteredPrice) || 0;
      } else if (existingChild?.birimFiyat != null && Number(existingChild.birimFiyat) > 0) {
        effectivePrice = Number(existingChild.birimFiyat) || 0;
      } else {
        const hist = lookupPrice(parentPayload.customerCode, cid);
        if (hist != null) effectivePrice = hist;
      }
      const childPayload = {
        ...parentPayload,
        id: childId,
        stokKodu: childStokKodu,
        stokAdi: existingChild?.stokAdi || child.nameTR || "",
        descriptionEn: existingChild?.descriptionEn || child.nameEN || "",
        pid: cid,
        // Miktar / başlangıç sevk parent'a bağlı (cascade 1:1)
        orijinalMiktar: parentPayload.orijinalMiktar,
        sevkedilenBaslangic: parentPayload.sevkedilenBaslangic || 0,
        birimFiyat: effectivePrice,
        isLinkedChild: true,
        linkedParentPid: parentPayload.pid,
        linkedParentStokKodu: parentPayload.stokKodu,
        source: existingChild?.source || "cascade",
      };
      await saveExportOrder(childPayload, { canEdit, userEmail });
    }
  };

  // Edit sonrası bağlı child kayıtlarını senkronla — parent'ın yeni değerlerine göre
  const syncLinkedChildren = async (parentPayload, childPrices = {}) => {
    await createLinkedChildren(parentPayload, childPrices);
  };

  // Motor sync helper — yeni sipariş (create)
  const applyMotorSyncForNew = (payload) => {
    if (!motorSync?.enabled || !motorSync.apply) return;
    if (payload.pid == null) return;
    if ((payload.status || "open") === "cancelled") return;
    const netQty = Math.max(0, (Number(payload.orijinalMiktar) || 0) - (Number(payload.sevkedilenBaslangic) || 0));
    if (netQty <= 0) return;
    const year = payload.teslimTarihi
      ? Number(String(payload.teslimTarihi).slice(0, 4))
      : new Date().getFullYear();
    if (Number.isFinite(year) && year > 2020) {
      motorSync.apply({ pid: payload.pid, deltaQty: +netQty, year, cascade: true });
    }
  };

  // Motor sync helper — edit (delta hesabı, pid/yıl değişimi dahil)
  const applyMotorSyncForEdit = (payload) => {
    if (!motorSync?.enabled || !motorSync.apply) return;
    // Bağlı child kaydının edit'inde motor sync tetiklenmez (parent cascade'i sağlar)
    if (editingOrder?.isLinkedChild) return;
    // Yıl bazlı ön kontrol: yıl değişimi durumunda HER İKİ yıl da izin verilen
    // aralıkta olmalı. Aksi halde asymmetric delta oluşur (bir yıldan düşülmez
    // ama diğerine eklenir → çift sayım). Bu durumda motor sync tamamen bypass.
    const cy = new Date().getFullYear();
    const inRange = (y) => Number.isFinite(y) && y >= cy && y <= cy + 1;
    const oldYearPre = editingOrder && editingOrder.teslimTarihi
      ? Number(String(editingOrder.teslimTarihi).slice(0, 4)) : null;
    const newYearPre = payload.teslimTarihi
      ? Number(String(payload.teslimTarihi).slice(0, 4))
      : new Date().getFullYear();
    if (oldYearPre != null && oldYearPre !== newYearPre) {
      // Yıl değişimi var. Her iki taraf da in-range olmalı — aksi halde bypass.
      if (!inRange(oldYearPre) || !inRange(newYearPre)) {
        console.warn("Motor sync bypass — yıl değişimi + en az bir taraf izin verilen aralık dışı", { oldYear: oldYearPre, newYear: newYearPre });
        return;
      }
    }
    const wasActive = editingOrder ? (editingOrder.status || "open") !== "cancelled" : false;
    const isActive = (payload.status || "open") !== "cancelled";
    const oldPid = editingOrder ? editingOrder.pid : null;
    const oldYear = editingOrder && editingOrder.teslimTarihi
      ? Number(String(editingOrder.teslimTarihi).slice(0, 4)) : null;
    const oldNet = (editingOrder && wasActive)
      ? Math.max(0, (Number(editingOrder.orijinalMiktar) || 0) - (Number(editingOrder.sevkedilenBaslangic) || 0))
      : 0;
    const newPid = payload.pid;
    const newYear = payload.teslimTarihi
      ? Number(String(payload.teslimTarihi).slice(0, 4))
      : new Date().getFullYear();
    const newNet = isActive
      ? Math.max(0, (Number(payload.orijinalMiktar) || 0) - (Number(payload.sevkedilenBaslangic) || 0))
      : 0;
    const validYear = (y) => Number.isFinite(y) && y > 2020;
    const samePidYear = oldPid != null && newPid != null
      && Number(oldPid) === Number(newPid)
      && oldYear != null && Number(oldYear) === Number(newYear);
    if (samePidYear) {
      const delta = newNet - oldNet;
      if (delta !== 0 && validYear(newYear)) {
        motorSync.apply({ pid: newPid, deltaQty: delta, year: newYear, cascade: true });
      }
    } else {
      if (oldPid != null && oldNet > 0 && validYear(oldYear)) {
        motorSync.apply({ pid: oldPid, deltaQty: -oldNet, year: oldYear, cascade: true });
      }
      if (newPid != null && newNet > 0 && validYear(newYear)) {
        motorSync.apply({ pid: newPid, deltaQty: +newNet, year: newYear, cascade: true });
      }
    }
  };

  return (
    <div style={{ padding: 12, background: "#fff", border: "1px solid var(--color-border-secondary)", borderRadius: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        {editingOrder ? "✏ Sipariş Düzenle" : "➕ Yeni İhracat Siparişi"}
        {!editingOrder && validLines.length > 0 && (
          <span style={{ marginLeft: 8, fontSize: 10, color: "#78716c" }}>({validLines.length} kalem kaydedilecek)</span>
        )}
      </div>
      {error && (
        <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>⚠ {error}</div>
      )}
      {editingOrder?.isLinkedChild && (
        <div style={{ padding: 8, marginBottom: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11 }}>
          🔗 <b>Bağlı ürünü düzenliyorsun.</b> Bu kalem parent siparişinin (
          {editingOrder.linkedParentStokKodu ? <code>{editingOrder.linkedParentStokKodu}</code> : `pid ${editingOrder.linkedParentPid}`}
          ) kombine bileşenidir. <b>Stok kodu, miktar ve başlangıç sevk</b> parent'a bağlıdır — sadece <b>birim fiyat</b>, <b>ürün adı (İngilizce)</b> ve <b>ödeme/teslim ayarlarını</b> değiştirebilirsin.
        </div>
      )}
      {(() => {
        if (!editingOrder) return null;
        const cy = new Date().getFullYear();
        const inRange = (y) => y != null && y >= cy && y <= cy + 1;
        const oldYear = editingOrder.teslimTarihi ? Number(String(editingOrder.teslimTarihi).slice(0, 4)) : null;
        const newYear = teslimTarihi ? Number(String(teslimTarihi).slice(0, 4)) : null;
        const yearChanged = oldYear != null && newYear != null && oldYear !== newYear;
        // Asymmetric: yıl değişimi var + biri in-range biri değil → motor sync bypass
        if (yearChanged && (!inRange(oldYear) || !inRange(newYear))) {
          return (
            <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
              🚫 <b>Yıl değişimi izin verilen aralık dışında</b> ({oldYear} → {newYear}). Motor sync <b>bypass</b> — Sevkiyat Planı tarafı etkilenmez.
              Sadece {cy}–{cy + 1} arası yıllar birbiriyle senkronize edilir. İhracat kaydı yine güncellenir (duplicate temizlenir), motor tarafını manuel yönetmen gerekebilir.
            </div>
          );
        }
        // Her iki yıl da out-of-range (örn. 2024 → 2025) → motor sync zaten atlanacak (geçmiş yıllara dokunulmaz)
        if (!inRange(oldYear) && !inRange(newYear)) {
          return (
            <div style={{ padding: 8, marginBottom: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
              🚫 <b>Geçmiş / gelecek yıl siparişi</b> ({oldYear || "?"}{newYear && oldYear !== newYear ? ` → ${newYear}` : ""}) — motor sync uygulanmaz.
              Sadece {cy}–{cy + 1} arası yıllar senkronize edilir. Değişiklikler ihracat modülünde kayıtlanır, motor tarafı etkilenmez.
            </div>
          );
        }
        // Her iki yıl da in-range + yıl değişimi
        if (yearChanged) {
          return (
            <div style={{ padding: 8, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11 }}>
              ⚠ <b>Farklı yıla geçiyorsun</b> ({oldYear} → {newYear}). Kaydettiğinde eski kayıt silinip yeni ID ile oluşturulacak (duplicate önlenir). Motor tarafında {oldYear}'dan −miktar düşülür, {newYear}'a +miktar eklenir.
              {editingOrder.pid && ` Bağlı ürünler (varsa) da yeni tarihe taşınır.`}
            </div>
          );
        }
        // Aynı yıl içinde ama teslim tarihi değişiyor → duplicate önlenecek
        if (teslimTarihi && editingOrder.teslimTarihi && teslimTarihi !== editingOrder.teslimTarihi) {
          return (
            <div style={{ padding: 8, marginBottom: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11 }}>
              ℹ Teslim tarihi değişiyor ({editingOrder.teslimTarihi} → {teslimTarihi}). Kaydettiğinde eski kayıt silinip yeni tarih ile oluşturulacak (duplicate önlenir). Motor sync tetiklenmez (aynı yıl).
            </div>
          );
        }
        return null;
      })()}

      {/* Müşteri */}
      <Section title="Müşteri">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <Field label="Müşteri Kodu *">
            <input list="ih-customer-list" value={customerCode}
              onChange={e => {
                const val = e.target.value;
                const found = customerOptions.find(c => c.code === val);
                if (found) applyCustomerDefaults(found.code, found.name);
                else setCustomerCode(val);
              }}
              placeholder="Örn. 120-0003" style={inp} />
            <datalist id="ih-customer-list">
              {customerOptions.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </datalist>
          </Field>
          <Field label="Müşteri Adı *">
            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Örn. OFMER SRL." style={inp} />
          </Field>
        </div>
        <div style={{ marginTop: 6 }}>
          <Field label="Adres (fatura için — opsiyonel)">
            <input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="Örn. VIA ROMA 45" style={inp} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
          <Field label="Şehir">
            <input value={customerCity} onChange={e => setCustomerCity(e.target.value)} placeholder="Örn. 20090 TREZZANO SUL NAVIGLIO (MI)" style={inp} />
          </Field>
          <Field label="Ülke">
            <input value={customerCountry} onChange={e => setCustomerCountry(e.target.value)} placeholder="Örn. ITALY" style={inp} />
          </Field>
        </div>
        {customerCode && (
          <label style={{ fontSize: 10, color: "#57534e", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6 }}>
            <input type="checkbox" checked={saveDefaultsForCustomer} onChange={e => setSaveDefaultsForCustomer(e.target.checked)} />
            Bu müşteri için varsayılanları kaydet (adres, şehir, ülke, para birimi, teslim şekli, ödeme planı)
          </label>
        )}
      </Section>

      {/* Sipariş bilgisi (ortak) */}
      <Section title="Sipariş Bilgisi (tüm kalemler için ortak)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
          <Field label="Belge No *">
            <input value={belgeNo} onChange={e => setBelgeNo(e.target.value)} placeholder="Örn. 378" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
          </Field>
          <Field label="Sipariş Tarihi">
            <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
              title="Siparişin alındığı tarih (özet filtresi bu tarihe göre çalışır)" style={inp} />
          </Field>
          <Field label="Termin (opsiyonel)">
            <input type="date" value={teslimTarihi} onChange={e => setTeslimTarihi(e.target.value)} style={inp} />
          </Field>
          <Field label="Para Birimi">
            <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...inp, background: "#fff" }}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Durum">
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inp, background: "#fff" }}>
              <option value="open">Açık</option>
              <option value="closed">Kapalı</option>
              <option value="cancelled">İptal</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* Kalemler */}
      <Section title={editingOrder ? "Ürün" : `Kalemler (${lines.length})`}>
        {lines.map((line, idx) => {
          const cascadeChildren = getCascadeChildren(line.pid);
          const netQty = (Number(line.orijinalMiktar) || 0) - (Number(line.sevkedilenBaslangic) || 0);
          return (
            <div key={idx} style={{ marginBottom: 10, padding: 8, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#44403c" }}>Kalem #{idx + 1}</div>
                {!editingOrder && lines.length > 1 && (
                  <button onClick={() => removeLine(idx)}
                    style={{ padding: "2px 8px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }}>
                    🗑 Kalemi Sil
                  </button>
                )}
              </div>
              {(() => {
                const linkedLock = !!editingOrder?.isLinkedChild;
                const disabledStyle = { ...inp, background: linkedLock ? "#f5f5f4" : "#fff", color: linkedLock ? "#78716c" : "inherit", cursor: linkedLock ? "not-allowed" : "text" };
                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                      <Field label={linkedLock ? "Stok Kodu (VIO) — 🔒 parent'a bağlı" : "Stok Kodu (VIO) *"}>
                        <input list="ih-product-list" value={line.stokKodu}
                          onChange={e => !linkedLock && applyProductToLine(idx, e.target.value)}
                          disabled={linkedLock}
                          placeholder="Örn. 152-0104" style={{ ...disabledStyle, fontFamily: "ui-monospace, monospace" }} />
                        {line.pid != null && <div style={{ fontSize: 9, color: "#166534", marginTop: 2 }}>✓ pid={line.pid}</div>}
                      </Field>
                      <Field label="Ürün Adı (TR)">
                        <input value={line.stokAdi} onChange={e => updateLine(idx, { stokAdi: e.target.value })} style={inp} />
                      </Field>
                    </div>
                    <Field label="Ürün Adı (İngilizce — fatura için)">
                      <input value={line.descriptionEn} onChange={e => updateLine(idx, { descriptionEn: e.target.value })}
                        placeholder="Örn. GEAR SET C54ST" style={inp} />
                    </Field>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <Field label={linkedLock ? "Miktar — 🔒 parent'a bağlı" : "Miktar *"}>
                        <input type="number" value={line.orijinalMiktar}
                          onChange={e => !linkedLock && updateLine(idx, { orijinalMiktar: e.target.value })}
                          disabled={linkedLock} style={disabledStyle} />
                      </Field>
                      <Field label={linkedLock ? "Başlangıç Sevk (VIO) — 🔒 parent'a bağlı" : "Başlangıç Sevk (VIO)"}>
                        <input type="number" value={line.sevkedilenBaslangic}
                          onChange={e => !linkedLock && updateLine(idx, { sevkedilenBaslangic: e.target.value })}
                          disabled={linkedLock}
                          title="Excel import'ta VIO'daki geçmiş sevk miktarı. Manuel girişte genellikle 0." style={disabledStyle} />
                      </Field>
                      <Field label="Birim Fiyat">
                        <input type="number" step="0.01" value={line.birimFiyat} onChange={e => updateLine(idx, { birimFiyat: e.target.value })} style={inp} />
                      </Field>
                    </div>
                  </>
                );
              })()}

              {/* Cascade önizleme — her bağlı ürün için fiyat girilebilir */}
              {cascadeChildren.length > 0 && (
                <div style={{ marginTop: 6, padding: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 3 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#1e40af", marginBottom: 6 }}>
                    🔗 Bu ürün kombine parent — bağlı ürünler ayrı kalem olarak eklenir. Fiyatları şimdi girebilir veya sonra düzenleyebilirsin.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {cascadeChildren.map(c => {
                      const priceVal = (line.childPrices || {})[c.pid] || "";
                      return (
                        <div key={c.pid} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 90px 40px", gap: 8, alignItems: "center", padding: "4px 8px", background: "#fff", border: "1px solid #bfdbfe", borderRadius: 3, fontSize: 10 }}>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "#1e40af" }}>{c.vioCode || `#${c.pid}`}</span>
                          <span style={{ color: "#57534e" }}>{c.nameTR}</span>
                          <span style={{ fontSize: 9, color: "#78716c" }}>Miktar: <b style={{ color: "#166534" }}>{netQty > 0 ? netQty : "—"}</b></span>
                          <input type="number" step="0.01" value={priceVal}
                            onChange={e => updateLine(idx, { childPrices: { ...(line.childPrices || {}), [c.pid]: e.target.value } })}
                            placeholder="0.00" style={{ ...inp, fontSize: 10, padding: "3px 6px", textAlign: "right" }} />
                          <span style={{ fontSize: 9, color: "#78716c" }}>{currency}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 8, color: "#78716c", marginTop: 4 }}>
                    💡 Fiyat boş bırakırsan 0 kaydedilir (parent fiyatına dahil kabul edilir). Sonradan sipariş listesinden ✏ ile de değiştirebilirsin.
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!editingOrder && (
          <button onClick={addLine}
            style={{ padding: "5px 12px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer" }}>
            + Yeni Kalem Ekle
          </button>
        )}
        <datalist id="ih-product-list">
          {(products || []).filter(p => p.vioCode).map(p => (
            <option key={p.id} value={p.vioCode}>{p.nameTR}</option>
          ))}
        </datalist>
      </Section>

      {/* Teslim & Ödeme */}
      <Section title="Teslim & Ödeme (tüm kalemler için ortak)">
        <Field label="Teslim Şekli">
          <input list="ih-delivery-terms-form" value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)}
            placeholder="Örn. DDP / TREZZO SULL / ADDA (MI)" style={inp} />
          <datalist id="ih-delivery-terms-form">
            {(settings?.deliveryTermsList || []).map(t => <option key={t} value={t} />)}
          </datalist>
        </Field>
        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 600 }}>
              Ödeme Planı
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 500,
                color: paymentValidation.valid ? "#166534" : "#92400e" }}>
                Toplam: %{paymentValidation.total}
                {paymentValidation.warning && <> · ⚠ {paymentValidation.warning}</>}
              </span>
            </div>
            {Array.isArray(settings?.paymentPlanTemplates) && settings.paymentPlanTemplates.length > 0 && (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <label style={{ fontSize: 10, color: "#78716c" }}>Şablondan yükle:</label>
                <select value="" onChange={e => {
                  const tpl = (settings?.paymentPlanTemplates || []).find(t => t.name === e.target.value);
                  if (tpl && Array.isArray(tpl.plan)) setPaymentPlan(tpl.plan.map(p => ({ ...p })));
                }} style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3 }}>
                  <option value="">— seç —</option>
                  {settings.paymentPlanTemplates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
          {paymentPlan.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 80px 30px", gap: 6, marginBottom: 4, alignItems: "center" }}>
              <input list="ih-payment-labels" value={p.label} onChange={e => updatePlanRow(i, "label", e.target.value)}
                placeholder="Örn. IN ADVANCE WITH ORDER" style={inp} />
              <input type="number" step="0.1" value={p.pct} onChange={e => updatePlanRow(i, "pct", e.target.value)}
                placeholder="%" style={{ ...inp, textAlign: "right" }} />
              <button onClick={() => removePlanRow(i)} disabled={paymentPlan.length <= 1}
                style={{ padding: "3px 6px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: paymentPlan.length > 1 ? "pointer" : "not-allowed", opacity: paymentPlan.length > 1 ? 1 : 0.5 }}>🗑</button>
            </div>
          ))}
          <datalist id="ih-payment-labels">
            {(settings?.paymentLabels || []).map(l => <option key={l} value={l} />)}
          </datalist>
          <button onClick={addPlanRow}
            style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>
            + Ödeme Satırı Ekle
          </button>
        </div>
      </Section>

      {/* Kaydet */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
        <button onClick={onCancel} disabled={saving}
          style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
          Vazgeç
        </button>
        <button onClick={handleSave} disabled={saving || !canEdit || !canSave}
          style={{ padding: "6px 14px", fontSize: 12, background: canSave ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (saving || !canSave) ? "not-allowed" : "pointer", fontWeight: 500 }}>
          {saving ? "Kaydediliyor…" : (editingOrder ? "💾 Güncelle" : `💾 Kaydet (${validLines.length} kalem)`)}
        </button>
      </div>
    </div>
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

const inp = { width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box" };
