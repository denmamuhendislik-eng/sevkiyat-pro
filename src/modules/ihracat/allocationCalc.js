// İhracat modülü — yardımcı hesaplamalar.
// Pure fonksiyonlar, Firestore'a dokunmaz. UI bileşenleri bunları çağırır.

// ============================================================
// 1) Bakiye türetme
// ============================================================
// Bir siparişin kalanı = orijinalMiktar - sevkedilenBaslangic - Σ(bu siparişe tahsis edilen konteyner kalemleri)
//
// sevkedilenBaslangic: VIO'dan gelen ilk yükleme sırasında "Sevk Edilen Miktar" değeri.
// Sisteme ilk giriş anındaki bakiye takip için. Sistem içi tahsisler tahsisEdilen'e yazılır.

export function computeAllocatedByOrder(allocationsMap) {
  // allocationsMap: { key: { allocations: [{ orderId, qty }, ...] } }
  const byOrder = new Map(); // orderId → toplam tahsis
  const alloc = allocationsMap || {};
  for (const rec of Object.values(alloc)) {
    const list = Array.isArray(rec?.allocations) ? rec.allocations : [];
    for (const a of list) {
      if (!a?.orderId) continue;
      const q = Number(a.qty) || 0;
      byOrder.set(a.orderId, (byOrder.get(a.orderId) || 0) + q);
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
