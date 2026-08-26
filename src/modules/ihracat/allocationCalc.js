// İhracat modülü — yardımcı hesaplamalar.
// Pure fonksiyonlar, Firestore'a dokunmaz. UI bileşenleri bunları çağırır.

// ============================================================
// 1) Bakiye türetme
// ============================================================
// Bir siparişin kalanı = orijinalMiktar - sevkedilenBaslangic - Σ(bu siparişe tahsis edilen konteyner kalemleri)
//
// sevkedilenBaslangic: VIO'dan gelen ilk yükleme sırasında "Sevk Edilen Miktar" değeri.
// Sisteme ilk giriş anındaki bakiye takip için. Sistem içi tahsisler tahsisEdilen'e yazılır.

// v23: shipmentsMap eklendi — motor dışı müşteri sevkiyatlarında,
// fatura kesildikten (status === "invoiced") sonra sipariş bakiyesi düşer.
// Motor tarafı (OFMER) için mevcut mantık: containerAllocations tahsis anında sayılır.
// İki mekanizma paralel yaşar — OFMER akışı değişmedi.
export function computeAllocatedByOrder(allocationsMap, shipmentsMap = {}) {
  // allocationsMap: { key: { allocations: [{ orderId, qty }, ...] } }
  const byOrder = new Map(); // orderId → toplam tahsis
  const alloc = allocationsMap || {};
  // 1) Container allocations — motor akışı (OFMER için tahsis anında düşer)
  for (const rec of Object.values(alloc)) {
    const list = Array.isArray(rec?.allocations) ? rec.allocations : [];
    for (const a of list) {
      if (!a?.orderId) continue;
      const q = Number(a.qty) || 0;
      byOrder.set(a.orderId, (byOrder.get(a.orderId) || 0) + q);
    }
  }
  // 2) Shipment allocations — sadece fatura kesilmiş (invoiced) olanlar
  //    Motor dışı müşterilerde fatura kesme anahtar olayı → bakiye o zaman düşer.
  //    Planlanan/paketlenen/sevkedilen ama henüz fatura kesilmemiş sevkiyatlar
  //    bakiyeye yansımaz (kullanıcı tercihi).
  const shipments = shipmentsMap || {};
  for (const s of Object.values(shipments)) {
    if (s?.status !== "invoiced") continue;
    for (const it of (s?.items || [])) {
      for (const a of (it?.allocations || [])) {
        if (!a?.orderId) continue;
        const q = Number(a.qty) || 0;
        byOrder.set(a.orderId, (byOrder.get(a.orderId) || 0) + q);
      }
    }
  }
  return byOrder;
}

// Sevkiyat formunda over-allocation önlemek için: TÜM aktif shipmentlar
// (cancelled hariç) allocations'ı toplanır. Böylece kullanıcı aynı siparişten
// iki farklı sevkiyata fazla adet giremez.
export function computeShipmentAllocatedByOrder(shipmentsMap = {}, excludeShipmentId = null) {
  const byOrder = new Map();
  for (const s of Object.values(shipmentsMap || {})) {
    if (!s?.id) continue;
    if (excludeShipmentId && s.id === excludeShipmentId) continue; // edit modu — kendi shipment'ını sayma
    if (s.status === "cancelled") continue;
    for (const it of (s.items || [])) {
      for (const a of (it.allocations || [])) {
        if (!a?.orderId) continue;
        const q = Number(a.qty) || 0;
        byOrder.set(a.orderId, (byOrder.get(a.orderId) || 0) + q);
      }
    }
  }
  return byOrder;
}

// Bir siparişin gerçek kalan miktarı
export function computeOrderRemaining(order, allocatedByOrderMap) {
  const orij = Number(order?.orijinalMiktar) || 0;
  const sevkBas = Number(order?.sevkedilenBaslangic) || 0;
  const tahsis = allocatedByOrderMap?.get?.(order?.id) || 0;
  const remaining = orij - sevkBas - tahsis;
  return Math.max(0, remaining);
}

// Bir siparişin doluluk durumu
export function computeOrderFillStatus(order, allocatedByOrderMap) {
  const orij = Number(order?.orijinalMiktar) || 0;
  const sevkBas = Number(order?.sevkedilenBaslangic) || 0;
  const tahsis = allocatedByOrderMap?.get?.(order?.id) || 0;
  const consumed = sevkBas + tahsis;
  if (orij <= 0) return { pct: 0, status: "empty", remaining: 0 };
  const pct = Math.round((consumed / orij) * 100);
  const remaining = Math.max(0, orij - consumed);
  let status = "partial";
  if (remaining === 0) status = "full";
  else if (consumed === 0) status = "empty";
  return { pct, status, remaining, consumed };
}

// ============================================================
// 2) FIFO tahsis önerisi
// ============================================================
// Bir konteyner kalemi (pid + qty) için, aynı pid/stokKodu'ndaki AÇIK siparişleri
// teslim tarihine göre (erken önce) sıralayıp bakiyeden düş.
//
// Girdi:
//   pid: konteyner kaleminin pid'si (products.id)
//   stokKodu: yedek eşleşme (pid null olabilir)
//   containerQty: konteyner kalem miktarı
//   ordersMap: { [id]: order }
//   allocatedByOrderMap: Map (yukarıdaki fonksiyondan)
//
// Çıktı: [{ orderId, belgeNo, qty }, ...]  (toplam = min(containerQty, mevcut bakiye))
// containerQty > bakiye ise fazla açıkta kalır (kullanıcı manuel karar).
export function suggestFifoAllocation({ pid, stokKodu, containerQty, ordersMap, allocatedByOrderMap }) {
  const target = Number(containerQty) || 0;
  if (target <= 0) return [];
  const all = Object.values(ordersMap || {});
  const candidates = all
    .filter(o => {
      if ((o?.status || "open") !== "open") return false;
      // Eşleşme: pid varsa pid, yoksa stokKodu
      if (pid != null && o.pid != null && Number(o.pid) === Number(pid)) return true;
      if (stokKodu && o.stokKodu === stokKodu) return true;
      return false;
    })
    .map(o => ({
      order: o,
      remaining: computeOrderRemaining(o, allocatedByOrderMap),
      sortKey: o.teslimTarihi || o.orderDate || "9999-99-99",
    }))
    .filter(x => x.remaining > 0)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey)); // erken termin önce

  const out = [];
  let left = target;
  for (const c of candidates) {
    if (left <= 0) break;
    const take = Math.min(c.remaining, left);
    out.push({
      orderId: c.order.id,
      belgeNo: c.order.belgeNo,
      qty: take,
    });
    left -= take;
  }
  return out;
}

// ============================================================
// 2b) Konteyner öngörülen fatura hesabı
// ============================================================
// Bir konteyner için (fatura kesmeden) beklenen toplam fatura + ödeme etiketi
// bazlı döküm hesaplar. Kaydedilmiş tahsis varsa onu kullanır, yoksa FIFO
// simüle eder. Zaten kesilmiş fatura varsa "kesildi" bucket'ına, yoksa "kalan
// öngörü" bucket'ına gider. Nakliye + yağ da dahildir.
//
// Girdi:
//   containerId, year, items ({pid, qty, name}[]),
//   ordersMap, allocationsMap, allocatedByOrderMap,
//   containerInvoices ({containerId, status, linkedOrderIds, totalAmount, paymentPlan}[]),
//   invoiceSettings ({transportDefault, oilProduct, oilRules}),
//
// Çıktı: {
//   grandTotal, issuedTotal, pendingTotal,
//   byLabel: { [label]: {total, issued, pending} },
//   currency, mixedCurrency: bool,
//   warnings: string[],
// }
export function forecastContainerBilling({
  containerId, year, items,
  ordersMap, allocationsMap, allocatedByOrderMap,
  containerInvoices, invoiceSettings,
}) {
  const byLabel = {}; // label → {total, issued, pending, paid}
  let grandTotal = 0;
  let issuedTotal = 0;
  let pendingTotal = 0;
  let paidTotal = 0;
  const warnings = [];
  const currencies = new Set();

  const bumpLabel = (label, amount, isIssued) => {
    const key = String(label || "").trim() || "(etiketsiz)";
    if (!byLabel[key]) byLabel[key] = { total: 0, issued: 0, pending: 0, paid: 0 };
    byLabel[key].total += amount;
    if (isIssued) byLabel[key].issued += amount;
    else byLabel[key].pending += amount;
  };

  const bumpLabelPaid = (label, amount) => {
    const key = String(label || "").trim() || "(etiketsiz)";
    if (!byLabel[key]) byLabel[key] = { total: 0, issued: 0, pending: 0, paid: 0 };
    byLabel[key].paid = (byLabel[key].paid || 0) + amount;
  };

  const distributeAmount = (orderAmount, paymentPlan, isIssued) => {
    const plan = Array.isArray(paymentPlan) ? paymentPlan.filter(p => Number(p?.pct) > 0) : [];
    if (plan.length === 0) {
      // Etiketsiz → tek bucket
      bumpLabel("(etiketsiz)", orderAmount, isIssued);
      return;
    }
    const totalPct = plan.reduce((s, p) => s + (Number(p.pct) || 0), 0);
    for (const p of plan) {
      const portion = orderAmount * (Number(p.pct) / (totalPct || 100));
      bumpLabel(p.label, portion, isIssued);
    }
  };

  // Ödenen tutarı payment plan etiketleri arasında proportional dağıt
  const distributePaid = (paidAmt, paymentPlan) => {
    if (paidAmt <= 0) return;
    const plan = Array.isArray(paymentPlan) ? paymentPlan.filter(p => Number(p?.pct) > 0) : [];
    if (plan.length === 0) { bumpLabelPaid("(etiketsiz)", paidAmt); return; }
    const totalPct = plan.reduce((s, p) => s + (Number(p.pct) || 0), 0);
    for (const p of plan) {
      bumpLabelPaid(p.label, paidAmt * (Number(p.pct) / (totalPct || 100)));
    }
  };

  // Bu konteynerde aktif ticari faturalar (VOID hariç, linkedOrderIds boş olmayan)
  const activeCommercialInvoices = (containerInvoices || []).filter(inv =>
    (inv.status || "issued") !== "cancelled" &&
    Array.isArray(inv.linkedOrderIds) && inv.linkedOrderIds.length > 0
  );
  const invoicedOrderIds = new Set(
    activeCommercialInvoices.flatMap(inv => inv.linkedOrderIds || [])
  );

  // Bu konteynerde aktif nakliye faturaları (linkedOrderIds boş)
  const activeTransportInvoices = (containerInvoices || []).filter(inv =>
    (inv.status || "issued") !== "cancelled" &&
    (!Array.isArray(inv.linkedOrderIds) || inv.linkedOrderIds.length === 0)
  );

  // ORDER SIDE — her item için allocation → order.paymentPlan
  for (const item of (items || [])) {
    const pid = Number(item.pid);
    const containerQty = Number(item.qty) || 0;
    if (containerQty <= 0) continue;

    const key = `${year}_${containerId}_${pid}`;
    const savedAllocs = Array.isArray(allocationsMap?.[key]?.allocations)
      ? allocationsMap[key].allocations.filter(a => Number(a?.qty) > 0)
      : [];
    const savedTotal = savedAllocs.reduce((s, a) => s + Number(a.qty || 0), 0);

    let allocsToUse = [...savedAllocs];

    // Eğer kaydedilmiş toplam < container qty → geri kalan için FIFO simüle
    if (savedTotal < containerQty) {
      const gap = containerQty - savedTotal;
      // FIFO çağırırken kaydedilmişleri de "allocatedByOrderMap"a ekleyerek çağırmak
      // gerekmez çünkü allocatedByOrderMap zaten TÜM konteynerlerdeki tahsisleri kapsar.
      // Ancak: aynı konteynerdeki bu pid için henüz kaydedilmemiş kısım FIFO'ya dahil
      // olacaksa, savedAllocs'un içindeki orderId'lere zaten allocatedByOrderMap'te
      // sayılmıştır. Sorun yok.
      const fifoResult = suggestFifoAllocation({
        pid, stokKodu: null, containerQty: gap,
        ordersMap, allocatedByOrderMap,
      });
      // savedAllocs'ta zaten olan orderId'leri FIFO'dan çıkarma — ekle, sonda unique yap
      for (const f of fifoResult) {
        const existing = allocsToUse.find(a => a.orderId === f.orderId);
        if (existing) existing.qty = Number(existing.qty) + f.qty;
        else allocsToUse.push({ orderId: f.orderId, belgeNo: f.belgeNo, qty: f.qty });
      }
    }

    const usedTotal = allocsToUse.reduce((s, a) => s + Number(a.qty || 0), 0);
    if (usedTotal < containerQty) {
      warnings.push(`${item.name || `pid ${pid}`}: ${containerQty - usedTotal} adet siparişsiz`);
    }

    for (const a of allocsToUse) {
      const order = ordersMap?.[a.orderId];
      if (!order) continue;
      const qty = Number(a.qty) || 0;
      const price = Number(order.birimFiyat) || 0;
      const orderAmount = qty * price;
      if (orderAmount <= 0) continue;
      if (order.currency) currencies.add(order.currency);
      const isIssued = invoicedOrderIds.has(a.orderId);
      distributeAmount(orderAmount, order.paymentPlan, isIssued);
      grandTotal += orderAmount;
      if (isIssued) issuedTotal += orderAmount;
      else pendingTotal += orderAmount;
    }
  }

  // ÖDENEN — aktif ticari faturaların paidAmount'ları payment label'a proportional dağıt
  for (const inv of activeCommercialInvoices) {
    const paidAmt = Number(inv.paidAmount) || 0;
    if (paidAmt <= 0) continue;
    paidTotal += paidAmt;
    distributePaid(paidAmt, inv.paymentPlan);
  }

  // TRANSPORT SIDE — kesilmiş nakliye faturaları varsa onları kullan, yoksa ayarlardan öngör
  if (activeTransportInvoices.length > 0) {
    for (const inv of activeTransportInvoices) {
      const amt = Number(inv.totalAmount) || 0;
      if (amt <= 0) continue;
      if (inv.currency) currencies.add(inv.currency);
      distributeAmount(amt, inv.paymentPlan, true);
      grandTotal += amt;
      issuedTotal += amt;
      // Nakliye faturası ödenmiş mi?
      const paidAmt = Number(inv.paidAmount) || 0;
      if (paidAmt > 0) {
        paidTotal += paidAmt;
        distributePaid(paidAmt, inv.paymentPlan);
      }
    }
  } else {
    // Nakliye henüz kesilmemiş → ayarlardan öngör
    const transportPrice = Number(invoiceSettings?.transportDefault?.unitPrice) || 0;
    const oilRules = Array.isArray(invoiceSettings?.oilRules) ? invoiceSettings.oilRules : [];
    const oilRuleMap = new Map(oilRules.map(r => [Number(r.pid), Number(r.oilPerUnit) || 0]));
    let totalOil = 0;
    for (const item of (items || [])) {
      const per = oilRuleMap.get(Number(item.pid));
      if (per && Number(item.qty) > 0) totalOil += Number(item.qty) * per;
    }
    const oilPrice = Number(invoiceSettings?.oilProduct?.unitPrice) || 0;
    const transportTotal = transportPrice + (totalOil * oilPrice);
    if (transportTotal > 0) {
      if (invoiceSettings?.transportDefault?.currency) currencies.add(invoiceSettings.transportDefault.currency);
      // Default plan: IN ADVANCE WITH DELIVERY %100 (nakliye faturası varsayılanıyla aynı)
      distributeAmount(transportTotal, [{ label: "IN ADVANCE WITH DELIVERY", pct: 100 }], false);
      grandTotal += transportTotal;
      pendingTotal += transportTotal;
    }
  }

  const currency = currencies.size === 1 ? [...currencies][0] : (currencies.size > 1 ? "MIX" : "EUR");
  return {
    grandTotal, issuedTotal, pendingTotal, paidTotal,
    // "Kesildi ama bekleyen" = kesildi - ödendi (kalan tahsilat)
    issuedNotPaidTotal: Math.max(0, issuedTotal - paidTotal),
    byLabel, currency, mixedCurrency: currencies.size > 1,
    warnings,
  };
}

// ============================================================
// 3) Ödeme planı doğrulama
// ============================================================
// paymentPlan: [{ label, pct }, ...]
// Yüzde toplamı 100 olmalı; değilse uyarı verilir (kaydı bloklamaz).
export function validatePaymentPlan(paymentPlan) {
  const arr = Array.isArray(paymentPlan) ? paymentPlan : [];
  if (arr.length === 0) return { valid: false, total: 0, warning: "Ödeme planı boş" };
  const total = arr.reduce((s, p) => s + (Number(p?.pct) || 0), 0);
  const rounded = Math.round(total * 100) / 100;
  if (rounded === 100) return { valid: true, total: rounded, warning: null };
  return {
    valid: false,
    total: rounded,
    warning: rounded > 100 ? `Toplam %${rounded} — 100'ü aştı` : `Toplam %${rounded} — 100 olmalı`,
  };
}

// ============================================================
// 4) Mutabakat — Sevkiyat Planı bakiyeleri vs. ihracat sipariş bakiyeleri
// ============================================================
// planByPid: { [pid]: unshippedQty }  (Sevkiyat Planı'ndan — gelen prop)
// ordersMap + allocatedByOrderMap: yukarıdaki gibi
//
// Dönüş: [{ pid, stokKodu, name, planQty, orderQty, diff }]
// diff = planQty - orderQty  (0 → tutuyor, +N → plan fazlası, -N → sipariş fazlası)
// ============================================================
// 5) Preview mutabakat — import ÖNCESİ, henüz Firestore'a yazılmadan
// ============================================================
// Parse edilmiş sipariş listesi (enriched) + Firestore'daki MEVCUT açık siparişler
// birleştirilerek plan ile karşılaştırılır. Kullanıcı checkbox'lardan hangi
// satırları seçtiyse, bu senaryonun mutabakat sonucu canlı hesaplanır.
//
// Skip mode senaryosu: mevcut kayıtlar korunur + yeni seçili satırlar eklenir.
// Overwrite senaryosu: seçili satırlar mevcut ID'yi geçersiz kılar.
export function computePreviewReconciliation({
  planByPid,
  selectedNewOrders,        // kullanıcının seçtiği YENİ satırlar (henüz Firestore'da yok)
  existingOrdersMap,        // Firestore'daki mevcut orders (mutabakata katılan açık olanlar)
  allocatedByOrderMap,      // mevcut konteyner tahsisleri
  mode,                     // "skip" | "overwrite"
  products,
}) {
  // Effective orders map: mevcut + yeni seçili (mode'a göre)
  const effective = {};
  // Mevcut kayıtları alt yapı olarak koy
  for (const [id, o] of Object.entries(existingOrdersMap || {})) {
    effective[id] = o;
  }
  // Yeni seçili satırları uygula
  for (const o of (selectedNewOrders || [])) {
    if (mode === "overwrite" || !effective[o.id]) {
      effective[o.id] = o;
    }
    // Skip modda mevcut varsa dokunma (zaten yukarıda mevcut kayıt korundu)
  }
  return computeReconciliation({
    planByPid,
    ordersMap: effective,
    allocatedByOrderMap,
    products,
  });
}

export function computeReconciliation({ planByPid, ordersMap, allocatedByOrderMap, products }) {
  const byPid = {}; // pid → { pid, stokKodu, name, planQty, orderQty }

  // Sipariş bakiyelerini pid bazında topla
  for (const o of Object.values(ordersMap || {})) {
    if ((o?.status || "open") !== "open") continue;
    const rem = computeOrderRemaining(o, allocatedByOrderMap);
    if (rem <= 0) continue;
    const pid = o.pid != null ? Number(o.pid) : null;
    // pid null olan sipariş için stokKodu ile fallback eşleştir
    const key = pid != null ? `pid:${pid}` : `stok:${o.stokKodu}`;
    if (!byPid[key]) {
      const prod = pid != null ? (products || []).find(p => Number(p.id) === pid) : null;
      byPid[key] = {
        pid,
        stokKodu: o.stokKodu || prod?.vioCode || "",
        name: prod?.nameTR || prod?.nameEN || o.stokAdi || o.stokKodu || "",
        planQty: 0,
        orderQty: 0,
      };
    }
    byPid[key].orderQty += rem;
  }

  // Plan miktarlarını ekle (sadece siparişi de olan pid'ler için — sırf plan var ihracat yok'u da eklemek istenirse ayrı loop yapılır)
  for (const [pidStr, planQty] of Object.entries(planByPid || {})) {
    const pid = Number(pidStr);
    const key = `pid:${pid}`;
    if (!byPid[key]) {
      // Sadece planda var, sipariş yok — mutabakat panelinde "eksik sipariş" olarak görünsün
      const prod = (products || []).find(p => Number(p.id) === pid);
      byPid[key] = {
        pid,
        stokKodu: prod?.vioCode || "",
        name: prod?.nameTR || prod?.nameEN || "",
        planQty: Number(planQty) || 0,
        orderQty: 0,
      };
    } else {
      byPid[key].planQty += Number(planQty) || 0;
    }
  }

  return Object.values(byPid).map(x => ({
    ...x,
    diff: x.planQty - x.orderQty,
    match: (x.planQty - x.orderQty) === 0,
  })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
