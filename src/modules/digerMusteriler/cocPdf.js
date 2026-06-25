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

// Sabit kalite beyanı metinleri (Excel template'ten)
const QUALITY_DECLARATION_EN = "The products with the description, part number and revision indicated below has been controlled and conformed to the requirements indicated in the engineering drawing of which is provided to the supplier.";
const QUALITY_DECLARATION_TR = "Aşağıda tanım, parça numarası, revizyonu belirtilen ürünler, müşteri tarafından firmamıza ulaştırılan mühendislik çiziminde belirtilen gerekliliklere göre kontrol edilmiş ve uygun bulunmuştur.";

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
        <tr style="background:#fff; border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px; font-weight:500;">${escapeHtml(String(cert.siraNo || "1"))}</td>
          <td style="padding:10px; font-family:'JetBrains Mono','Courier New',monospace; font-weight:500;">${escapeHtml(cert.orderNo || "")}</td>
          <td style="padding:10px; text-align:right; font-weight:600;">${escapeHtml(String(cert.quantity || ""))}</td>
          <td style="padding:10px; font-family:'JetBrains Mono','Courier New',monospace;">${escapeHtml(cert.serialNo || "—")}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${feragatBlock}

  <!-- Signature block -->
  <div style="margin-top:40px; display:grid; grid-template-columns:1fr 1fr; gap:30px;">
    <div style="text-align:center; padding-top:40px; border-top:1px solid #1c1917;">
      <div style="font-size:9px; color:#78716c; font-weight:600;">CHECKED BY / KONTROL EDEN</div>
      <div style="font-size:11px; font-weight:600; color:#1c1917; margin-top:8px;">${SIGNATURES.engineer}</div>
      <div style="font-size:9px; color:#78716c;">ENGINEER / MÜHENDİS</div>
    </div>
    <div style="text-align:center; padding-top:40px; border-top:1px solid #1c1917;">
      <div style="font-size:9px; color:#78716c; font-weight:600;">APPROVED BY / ONAYLAYAN</div>
      <div style="font-size:11px; font-weight:600; color:#1c1917; margin-top:8px;">${SIGNATURES.manager}</div>
      <div style="font-size:9px; color:#78716c;">MANAGER / MÜDÜR</div>
    </div>
  </div>

  <!-- Footer -->
  <div style="position:absolute; bottom:20px; left:50px; right:50px; padding-top:8px; border-top:1px solid #e7e5e4; font-size:8px; color:#a8a29e; display:flex; justify-content:space-between;">
    <span>DENMA Mühendislik · ${escapeHtml(cert.certNo || "")}</span>
    <span>Generated: ${new Date().toLocaleDateString("tr-TR")}</span>
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

// Ana fonksiyon — sertifika objesini PDF olarak indirir.
export async function generateCocPdf(cert) {
  const html = buildCocHtml(cert);
  // Off-screen container — viewport dışında render, sonra silinir
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const root = container.querySelector("#coc-pdf-root");
    // Logo yükleninceye kadar bekle
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const imgW = 210; // A4 width
    const imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, imgW, Math.min(imgH, 297));
    pdf.save(`COC_${cert.certNo}_${cert.stokKodu}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
