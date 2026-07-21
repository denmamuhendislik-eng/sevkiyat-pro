// COC (Uygunluk Belgesi) PDF üretimi.
// Yaklaşım: HTML template'i off-screen DOM'a mount → html2canvas ile image → jsPDF A4.
// Türkçe karakter güvenliği için image yaklaşımı kullanılır (jsPDF text TR font sorunu).
//
// İleride: LOGO_DENMA shared bir asset dosyasına taşınmalı (şu an App.jsx'te kopya var).
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// DENMA logo — App.jsx:1913'deki base64 değerinin kopyası
// (ileride shared/assets.js'e taşınacak)
import { LOGO_DENMA } from "./cocLogo";
import { SIGNATURE_SERDAL, SIGNATURE_OMER } from "./cocSignatures";

// ISO form numarası — revizyon/tarih güncellemesinde bu string değişir
const FORM_NO = "FR-70 Rev.Tar./No: 29.06.2026 / 02";

// Sabit kalite beyanı metinleri — eski FR-70 UYGUNLUK BELGESİ Rev01.xlsm'den birebir
const QUALITY_DECLARATION_EN = "The products with the description, part number, revision, quantity, and serial number given below are hereby certified to meet the contract requirements and are verified by inspection and/or testing in accordance with the Quality Management System of DENMA MÜHENDİSLİK MAK. OTOM. İNŞ. SAN. TİC. LTD. ŞTİ.";
const QUALITY_DECLARATION_TR = "Aşağıda tanım, parça numarası, revizyonu, adedi, ve seri numarası verilen ürünlerin sözleşme gereksinimlerini karşıladığının, DENMA MÜHENDİSLİK MAK. OTOM. İNŞ. SAN. TİC. LTD. ŞTİ. Kalite Yönetim Sistemine uygun olarak denetim ve/veya test ile doğrulandığı iş bu belge ile taahhüt edilmektedir.";

// İmza meta — şimdilik sabit, ileride Settings'ten gelecek
const SIGNATURES = {
  engineer: "SERDAL BÜYÜKDUYMAZ",
  manager: "ÖMER YASİN AKBUĞA",
};

// HTML string olarak template oluşturur. Container element'ine inject edilip
// html2canvas ile render edilir.
function buildCocHtml(cert) {
  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  const feragatStatus = cert.feragatStatus || (cert.feragatText ? "VAR" : "YOK");
  const feragatBlock = (feragatStatus === "VAR" && cert.feragatText)
    ? `<div style="margin-top:14px;padding:10px;border:1px solid #d6d3d1;border-radius:6px;background:#fffbeb;">
         <div style="font-size:9px;color:#92400e;font-weight:600;margin-bottom:4px;">FERAGAT AÇIKLAMASI / WAIVER DESCRIPTION</div>
         <div style="font-size:10px;color:#1c1917;white-space:pre-wrap;line-height:1.5;">${escapeHtml(cert.feragatText)}</div>
       </div>`
    : "";

  return `
<div id="coc-pdf-root" style="
  width:794px; min-height:1123px; padding:40px 50px;
  background:#fff; color:#1c1917; font-family:'Inter', 'Segoe UI', Tahoma, sans-serif;
  box-sizing:border-box; font-size:11px; line-height:1.5;
">
  <!-- Header: logo + title + meta -->
  <div style="display:flex; align-items:flex-start; gap:20px; padding-bottom:18px; border-bottom:2px solid #1e40af;">
    <img src="${LOGO_DENMA}" style="width:140px; height:auto;" alt="DENMA" />
    <div style="flex:1; text-align:center;">
      <div style="font-size:18px; font-weight:700; color:#1e40af; letter-spacing:0.5px;">CERTIFICATE OF CONFORMITY</div>
      <div style="font-size:13px; font-weight:500; color:#44403c; margin-top:2px;">UYGUNLUK SERTİFİKASI</div>
    </div>
    <div style="text-align:right; font-size:10px;">
      <div style="margin-bottom:4px;">
        <div style="color:#78716c; font-size:9px;">CERTIFICATE NO / SERTİFİKA NO</div>
        <div style="font-weight:700; color:#1e40af; font-size:13px; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(cert.certNo || "")}</div>
      </div>
      <div style="margin-bottom:4px;">
        <div style="color:#78716c; font-size:9px;">CONTROL DATE / KONTROL TARİHİ</div>
        <div style="font-weight:600; color:#1c1917;">${fmtDate(cert.controlDateIso)}</div>
      </div>
      <div>
        <div style="color:#78716c; font-size:9px;">FERAGAT / WAIVER</div>
        <div style="font-weight:700; color:${feragatStatus === 'VAR' ? '#dc2626' : '#16a34a'};">${feragatStatus}</div>
      </div>
    </div>
  </div>

  <!-- Customer block -->
  <div style="margin-top:18px; padding:14px; background:#f9fafb; border-radius:8px; border:1px solid #e7e5e4;">
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:4px;">CUSTOMER / MÜŞTERİ</div>
    <div style="font-size:13px; font-weight:600; color:#1e40af;">${escapeHtml(cert.customerName || "")}</div>
    <div style="font-size:10px; color:#57534e; margin-top:3px;">${escapeHtml(cert.customerAddress || "")}</div>
  </div>

  <!-- Quality declaration -->
  <div style="margin-top:18px;">
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">DECLARATION OF QUALITY / KALİTE BEYANI</div>
    <div style="font-size:10px; color:#1c1917; line-height:1.55; padding:10px; background:#fff; border-left:3px solid #1e40af;">
      <div style="font-style:italic; color:#44403c;">${QUALITY_DECLARATION_EN}</div>
      <div style="margin-top:8px;">${QUALITY_DECLARATION_TR}</div>
    </div>
  </div>

  <!-- Part info -->
  <div style="margin-top:18px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
    <div style="padding:10px; background:#eff6ff; border-radius:6px; border:1px solid #bfdbfe;">
      <div style="font-size:9px; color:#1e40af; font-weight:600; margin-bottom:2px;">PART NO / PARÇA NO</div>
      <div style="font-size:13px; font-weight:700; color:#1c1917; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(cert.stokKodu || "")}</div>
    </div>
    <div style="padding:10px; background:#eff6ff; border-radius:6px; border:1px solid #bfdbfe;">
      <div style="font-size:9px; color:#1e40af; font-weight:600; margin-bottom:2px;">REV. CODE / REV. KODU</div>
      <div style="font-size:13px; font-weight:700; color:#1c1917; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(cert.revisionCode || "—")}</div>
    </div>
    <div style="padding:10px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4; grid-column:1 / -1;">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:2px;">PART NAME / PARÇA ADI</div>
      <div style="font-size:11px; color:#1c1917;">${escapeHtml(cert.description || "")}</div>
    </div>
    <div style="padding:10px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:2px;">FAİ CODE / FAİ KODU</div>
      <div style="font-size:11px; font-weight:600; color:#1c1917; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(cert.faiNo || "—")}</div>
    </div>
    <div style="padding:10px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:2px;">QUANTITY / MİKTAR</div>
      <div style="font-size:11px; font-weight:600; color:#1c1917;">${escapeHtml(String(cert.quantity || ""))}</div>
    </div>
  </div>

  <!-- Shipment table -->
  <div style="margin-top:18px;">
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">SHIPMENT DETAILS / SEVKİYAT DETAYI</div>
    <table style="width:100%; border-collapse:collapse; font-size:10px;">
      <thead>
        <tr style="background:#1e40af; color:#fff;">
          <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:9px; border-radius:6px 0 0 0;">LINE NO<br/><span style="font-weight:400; opacity:0.85;">SATIR NO</span></th>
          <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:9px;">ORDER NO<br/><span style="font-weight:400; opacity:0.85;">SİPARİŞ NO</span></th>
          <th style="padding:8px 10px; text-align:right; font-weight:600; font-size:9px;">QUANTITY<br/><span style="font-weight:400; opacity:0.85;">MİKTAR</span></th>
          <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:9px; border-radius:0 6px 0 0;">SERIAL NO<br/><span style="font-weight:400; opacity:0.85;">SERİ NO</span></th>
        </tr>
      </thead>
      <tbody>
        ${(cert.lineItems && cert.lineItems.length > 0
          ? cert.lineItems.map(li => `
            <tr style="background:#fff; border-bottom:1px solid #e7e5e4;">
              <td style="padding:10px; font-weight:500;">${escapeHtml(String(li.siraNo || ""))}</td>
              <td style="padding:10px; font-family:'JetBrains Mono','Courier New',monospace; font-weight:500;">${escapeHtml(li.orderNo || "")}</td>
              <td style="padding:10px; text-align:right; font-weight:600;">${escapeHtml(String(li.quantity || ""))}</td>
              <td style="padding:10px; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(li.serialNo || "—")}</td>
            </tr>
          `).join("")
          : `
            <tr style="background:#fff; border-bottom:1px solid #e7e5e4;">
              <td style="padding:10px; font-weight:500;">${escapeHtml(String(cert.siraNo || "1"))}</td>
              <td style="padding:10px; font-family:'JetBrains Mono','Courier New',monospace; font-weight:500;">${escapeHtml(cert.orderNo || "")}</td>
              <td style="padding:10px; text-align:right; font-weight:600;">${escapeHtml(String(cert.quantity || ""))}</td>
              <td style="padding:10px; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(cert.serialNo || "—")}</td>
            </tr>
          `)}
        ${cert.lineItems && cert.lineItems.length > 1
          ? `<tr style="background:#eff6ff; border-top:2px solid #1e40af;">
              <td colspan="2" style="padding:10px; text-align:right; font-weight:600; color:#1e40af;">TOPLAM / TOTAL</td>
              <td style="padding:10px; text-align:right; font-weight:700; color:#1e40af; font-size:11px;">${escapeHtml(String(cert.quantity || cert.lineItems.reduce((s, li) => s + (Number(li.quantity) || 0), 0)))}</td>
              <td></td>
            </tr>`
          : ""}
      </tbody>
    </table>
  </div>

  ${feragatBlock}

  <!-- Signature block — gerçek imza görselleri -->
  <div style="margin-top:30px; display:grid; grid-template-columns:1fr 1fr; gap:30px;">
    <div style="text-align:center;">
      <div style="height:60px; display:flex; align-items:flex-end; justify-content:center;">
        <img src="${SIGNATURE_SERDAL}" style="max-height:55px; max-width:180px; object-fit:contain;" alt="Serdal Büyükduymaz" />
      </div>
      <div style="border-top:1px solid #1c1917; padding-top:6px;">
        <div style="font-size:9px; color:#78716c; font-weight:600;">CHECKED BY / KONTROL EDEN</div>
        <div style="font-size:11px; font-weight:600; color:#1c1917; margin-top:4px;">${SIGNATURES.engineer}</div>
        <div style="font-size:9px; color:#78716c;">ENGINEER / MÜHENDİS</div>
      </div>
    </div>
    <div style="text-align:center;">
      <div style="height:60px; display:flex; align-items:flex-end; justify-content:center;">
        <img src="${SIGNATURE_OMER}" style="max-height:55px; max-width:180px; object-fit:contain;" alt="Ömer Yasin Akbuğa" />
      </div>
      <div style="border-top:1px solid #1c1917; padding-top:6px;">
        <div style="font-size:9px; color:#78716c; font-weight:600;">APPROVED BY / ONAYLAYAN</div>
        <div style="font-size:11px; font-weight:600; color:#1c1917; margin-top:4px;">${SIGNATURES.manager}</div>
        <div style="font-size:9px; color:#78716c;">MANAGER / MÜDÜR</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="position:absolute; bottom:20px; left:50px; right:50px; padding-top:8px; border-top:1px solid #e7e5e4; font-size:8px; color:#a8a29e; display:flex; justify-content:space-between; align-items:flex-end;">
    <span>DENMA Mühendislik · ${escapeHtml(cert.certNo || "")} · Generated: ${new Date().toLocaleDateString("tr-TR")}</span>
    <span style="font-family:'JetBrains Mono','Courier New',monospace; font-weight:600; color:#57534e;">${FORM_NO}</span>
  </div>
</div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sadece PDF görüntüsünde: aynı orderNo'ya sahip satırları tek satırda birleştir.
// Miktarlar toplanır, seri no'lar unique + virgüllü. Kayıt yapısı bozulmaz (audit trail).
// Bir COC'de zaten tek stok var (stokMismatch check), o yüzden orderNo tek anahtar.
function groupLineItemsForDisplay(items) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const map = new Map();
  for (const li of items) {
    const key = String(li.orderNo || "");
    if (!map.has(key)) map.set(key, { orderNo: key, quantity: 0, serials: new Set() });
    const g = map.get(key);
    g.quantity += Number(li.quantity) || 0;
    if (li.serialNo && li.serialNo !== "---") g.serials.add(String(li.serialNo));
  }
  return Array.from(map.values()).map((g, i) => ({
    siraNo: i + 1,
    orderNo: g.orderNo,
    quantity: g.quantity,
    serialNo: g.serials.size > 0 ? Array.from(g.serials).join(", ") : "---",
  }));
}

// PDF'te gösterilecek alt bileşenleri döndürür. Standart bağlantı elemanları
// (cıvata, somun, helicoil vs.) COC gerektirmediği için görüntüde saklanır.
// snapshot alındığında classify edilmişti; burada son heuristik eleme uygulanır.
function getVisibleSubComponents(cert) {
  const list = Array.isArray(cert.subComponents) ? cert.subComponents : [];
  if (list.length === 0) return [];
  const STANDARD_KEYS = ["CIVATA", "SOMUN", "HELICOIL", "PUL", "RONDELA", "SEGMAN", "PIN", "VIDA", "SAPLAMA", "TAPA", "TIRTIR", "SETASKUR", "YAY PUL", "RIVETLI"];
  const isStd = (name) => {
    const s = String(name || "").toLocaleUpperCase("tr-TR");
    return STANDARD_KEYS.some(kw => s.includes(kw));
  };
  return list.filter(s => !isStd(s.stokAdi));
}

// Alt bileşen sayfası (Faz — ayrı sayfa) — cert.subComponents snapshot varsa
// tam A4 sayfa döndürür. Kompakt header + geniş tablo + özet.
// Belge durumu: H (hammadde), Ö (ölçüm), F (fason), T (tedarikçi COC).
function buildSubComponentsPageHtml(cert) {
  const shown = getVisibleSubComponents(cert);
  if (shown.length === 0) return "";

  const rows = shown.map((s, i) => {
    const docs = s.docs || {};
    const isBuy = String(s.supplyType || "make").toLowerCase() === "buy";
    const badge = (present, label, title) => present
      ? `<span title="${title}" style="display:inline-block; padding:2px 6px; margin:0 2px; background:#dcfce7; color:#166534; border-radius:3px; font-size:9px; font-weight:700;">${label} ✓</span>`
      : `<span title="${title}" style="display:inline-block; padding:2px 6px; margin:0 2px; background:#fee2e2; color:#991b1b; border-radius:3px; font-size:9px; font-weight:700;">${label} ✗</span>`;
    const docsHtml = isBuy
      ? badge(!!docs.tedarikciCoc, "T", "Tedarikçi COC")
      : `${badge(!!docs.hammaddeSertifikasi, "H", "Hammadde Sertifikası")}${badge(!!docs.olcumRaporu, "Ö", "Ölçüm Raporu")}${badge(!!docs.fasonSertifikasi, "F", "Fason Sertifikası")}`;
    return `
      <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
        <td style="padding:8px 10px; font-size:10px; color:#78716c; text-align:center;">${i + 1}</td>
        <td style="padding:8px 10px; font-family:'JetBrains Mono','Courier New',monospace; font-size:10px; font-weight:500;">${escapeHtml(s.stokKodu || "")}</td>
        <td style="padding:8px 10px; font-size:10px;">${escapeHtml(s.stokAdi || "—")}</td>
        <td style="padding:8px 10px; font-size:10px; text-align:right;">${escapeHtml(String(s.qty || ""))} ${escapeHtml(s.unit || "")}</td>
        <td style="padding:8px 10px; text-align:center;">
          <span style="display:inline-block; padding:2px 6px; background:${isBuy ? "#dbeafe" : "#dcfce7"}; color:${isBuy ? "#1e40af" : "#166534"}; border-radius:3px; font-size:9px; font-weight:700;">${isBuy ? "BUY" : "MAKE"}</span>
        </td>
        <td style="padding:8px 10px; text-align:center;">${docsHtml}</td>
      </tr>
    `;
  }).join("");

  const complete = shown.filter(s => {
    const d = s.docs || {};
    const buy = String(s.supplyType || "make").toLowerCase() === "buy";
    return buy ? !!d.tedarikciCoc : !!(d.hammaddeSertifikasi && d.olcumRaporu && d.fasonSertifikasi);
  }).length;

  return `
<div id="coc-pdf-sub-root" style="
  width:794px; min-height:1123px; padding:40px 50px;
  background:#fff; color:#1c1917; font-family:'Inter', 'Segoe UI', Tahoma, sans-serif;
  box-sizing:border-box; font-size:11px; line-height:1.5; position:relative;
">
  <!-- Kompakt header -->
  <div style="display:flex; align-items:center; gap:20px; padding-bottom:14px; border-bottom:2px solid #1e40af; margin-bottom:18px;">
    <img src="${LOGO_DENMA}" style="width:110px; height:auto;" alt="DENMA" />
    <div style="flex:1;">
      <div style="font-size:15px; font-weight:700; color:#1e40af;">SUB-COMPONENTS / ALT BİLEŞENLER</div>
      <div style="font-size:10px; color:#57534e; margin-top:3px;">
        Certificate No / Sertifika No:
        <span style="font-family:'JetBrains Mono','Courier New',monospace; font-weight:600; color:#1e40af;">${escapeHtml(cert.certNo || "")}</span>
      </div>
    </div>
    <div style="text-align:right; font-size:10px; color:#78716c;">
      <div style="font-weight:600;">Page 2 / Sayfa 2</div>
    </div>
  </div>

  <!-- Ana parça referansı -->
  <div style="padding:12px 14px; background:#eff6ff; border-radius:6px; border:1px solid #bfdbfe; margin-bottom:18px;">
    <div style="display:grid; grid-template-columns:1fr 1.4fr 1fr; gap:14px; font-size:10px;">
      <div>
        <div style="color:#1e40af; font-size:9px; font-weight:600; margin-bottom:2px;">MAIN PART / ANA PARÇA</div>
        <div style="font-family:'JetBrains Mono','Courier New',monospace; font-weight:700; color:#1c1917; font-size:12px;">${escapeHtml(cert.stokKodu || "")}</div>
        <div style="color:#78716c; font-size:9px; margin-top:2px;">Rev: ${escapeHtml(cert.revisionCode || "—")}</div>
      </div>
      <div>
        <div style="color:#1e40af; font-size:9px; font-weight:600; margin-bottom:2px;">DESCRIPTION / AÇIKLAMA</div>
        <div style="color:#1c1917;">${escapeHtml(cert.description || "—")}</div>
      </div>
      <div>
        <div style="color:#1e40af; font-size:9px; font-weight:600; margin-bottom:2px;">STATUS / DURUM</div>
        <div style="color:#1c1917;">
          <strong>${shown.length}</strong> bileşen ·
          <span style="color:${complete === shown.length ? '#16a34a' : '#dc2626'}; font-weight:700;">${complete}/${shown.length} tamam</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Alt bileşen tablosu -->
  <table style="width:100%; border-collapse:collapse; font-size:10px;">
    <thead>
      <tr style="background:#1e40af; color:#fff;">
        <th style="padding:8px 10px; font-weight:600; font-size:9px; width:30px; text-align:center; border-radius:6px 0 0 0;">#</th>
        <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:9px;">STOK KODU<br/><span style="font-weight:400; opacity:0.85;">CODE</span></th>
        <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:9px;">AÇIKLAMA<br/><span style="font-weight:400; opacity:0.85;">DESCRIPTION</span></th>
        <th style="padding:8px 10px; font-weight:600; font-size:9px; text-align:right; width:75px;">MİKTAR<br/><span style="font-weight:400; opacity:0.85;">QTY</span></th>
        <th style="padding:8px 10px; font-weight:600; font-size:9px; text-align:center; width:60px;">TİP<br/><span style="font-weight:400; opacity:0.85;">TYPE</span></th>
        <th style="padding:8px 10px; font-weight:600; font-size:9px; text-align:center; width:150px; border-radius:0 6px 0 0;">BELGELER<br/><span style="font-weight:400; opacity:0.85;">DOCUMENTS</span></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <!-- Legend + durum notu -->
  <div style="margin-top:14px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4; font-size:9px; color:#57534e; line-height:1.6;">
    <div><strong>Belge Kodları / Document Codes:</strong></div>
    <div style="margin-top:2px;">
      <strong>H</strong>: Hammadde Sertifikası (Material Cert) &nbsp;·&nbsp;
      <strong>Ö</strong>: Ölçüm Raporu (Inspection Report) &nbsp;·&nbsp;
      <strong>F</strong>: Fason Sertifikası (Subcontract Cert) &nbsp;·&nbsp;
      <strong>T</strong>: Tedarikçi COC (Supplier CoC)
    </div>
    <div style="margin-top:6px; padding-top:6px; border-top:1px dashed #d6d3d1;">
      <strong>Durum:</strong>
      ${complete === shown.length
        ? '<span style="color:#166534; font-weight:600;">Tüm alt bileşen belgeleri tamamlanmıştır.</span>'
        : `<span style="color:#991b1b; font-weight:600;">${shown.length - complete} bileşende eksik belge bulunmaktadır.</span> Eksik belgeler ana COC ile birlikte iliştirilen dokümantasyon paketinde referans edilmiştir.`
      }
    </div>
    <div style="margin-top:4px; color:#78716c; font-size:8px;">
      Not: Standart bağlantı elemanları (cıvata, somun, pul vs.) COC gerektirmediğinden tabloda yer almaz.
    </div>
  </div>

  <!-- Footer -->
  <div style="position:absolute; bottom:20px; left:50px; right:50px; padding-top:8px; border-top:1px solid #e7e5e4; font-size:8px; color:#a8a29e; display:flex; justify-content:space-between; align-items:flex-end;">
    <span>DENMA Mühendislik · ${escapeHtml(cert.certNo || "")} · Sub-Components · Generated: ${new Date().toLocaleDateString("tr-TR")}</span>
    <span style="font-family:'JetBrains Mono','Courier New',monospace; font-weight:600; color:#57534e;">${FORM_NO}</span>
  </div>
</div>
  `;
}

// Off-screen container'a HTML mount edip html2canvas ile image üretir, PDF sayfası ekler.
async function addHtmlPageToPdf(pdf, html, { isFirstPage }) {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const root = container.firstElementChild;
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgW = 210;
    const imgH = (canvas.height * imgW) / canvas.width;
    if (!isFirstPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, imgW, Math.min(imgH, 297));
  } finally {
    document.body.removeChild(container);
  }
}

// Ortak PDF render — jsPDF instance döndürür.
// Sayfa 1: ana COC. Sayfa 2: alt bileşen tablosu (varsa).
async function renderCocPdf(cert) {
  // Görüntü için satır grupla (kayıt yapısına dokunma — sadece PDF için)
  const displayCert = {
    ...cert,
    lineItems: groupLineItemsForDisplay(cert.lineItems),
  };

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Sayfa 1: ana COC
  await addHtmlPageToPdf(pdf, buildCocHtml(displayCert), { isFirstPage: true });

  // Sayfa 2: alt bileşenler (montajlı parça + gösterilecek bileşen varsa)
  const subHtml = buildSubComponentsPageHtml(displayCert);
  if (subHtml) {
    await addHtmlPageToPdf(pdf, subHtml, { isFirstPage: false });
  }

  return pdf;
}

// Ana fonksiyon — sertifika objesini PDF olarak indirir.
export async function generateCocPdf(cert) {
  const pdf = await renderCocPdf(cert);
  pdf.save(`COC_${cert.certNo}_${cert.stokKodu}.pdf`);
}

// ZIP içine koymak için PDF Blob döndürür.
export async function buildCocPdfBlob(cert) {
  const pdf = await renderCocPdf(cert);
  return pdf.output("blob");
}
