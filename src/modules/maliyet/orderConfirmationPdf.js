// Order Confirmation Form (OCF) PDF üretimi.
// Fiyat Listesi taslak simülasyonundan → müşteriye gönderilecek teklif dokümanı.
// HTML template → html2canvas → jsPDF (ihracat/invoicePdf.js ile aynı pattern).
//
// A4 dikey (210 × 297 mm). CSS mm cinsinden — jsPDF ile uyumlu.
// Multi-page slicing: content 297mm'i aşarsa canvas dilimlenip birden fazla sayfa üretilir.
// İnvoicePdf paterni birebir — logoImage/stampImage nested URL yapısı + await img load.

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]);

function fmt2(n) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt0(n) {
  return Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function buildOcfHtml(ocf, settings) {
  const cur = (ocf.header?.currency || "EUR").toUpperCase();
  const currencySymbol = (() => {
    switch (cur) {
      case "EUR": return "€";
      case "USD": return "$";
      case "GBP": return "£";
      case "TL": case "TRY": return "₺";
      default: return cur;
    }
  })();
  // Firma bilgisi — invoicePdf.js ile birebir aynı (hardcoded DENMA)
  const company = settings?.companyInfo || {
    name: "DENMA DIŞ TİCARET LTD.ŞTİ.",
    address: "Fevzi Çakmak Mah. 10670 Sk. No:31/B Karatay - KONYA / TURKEY",
    phone: "+90 332 606 29 83",
    taxOffice: "Selçuk V.D. 292 139 2109",
    website: "www.denma.com.tr",
    email: "bilgi@denma.com.tr",
  };
  // Nested URL yapısı — invoiceSettings'te logoImage.url ve stampImage.url
  const logoUrl = settings?.logoImage?.url || "";
  const stampUrl = settings?.stampImage?.url || "";
  // Banka bilgisi — invoiceSettings.bankAccounts ilk kayıt (varsa)
  const banks = Array.isArray(settings?.bankAccounts) ? settings.bankAccounts : [];
  const bankRow = banks.find(b => b.isDefault) || banks[0] || null;

  const itemRows = ocf.items.map((it, i) => `
    <tr>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:center;">${i + 1}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;font-family:Consolas,monospace;">${esc(it.stockCode)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;">${esc(it.descriptionEn || it.name)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:right;">${fmt0(it.qty)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:center;">${esc(it.unit || "PCS")}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:right;">${fmt2(it.unitPrice)} ${currencySymbol}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:right;font-weight:600;">${fmt2(it.lineTotal)} ${currencySymbol}</td>
    </tr>
  `).join("");

  const termsRows = [
    { label: "Payment Terms", value: ocf.terms?.payment },
    { label: "Delivery Terms", value: ocf.terms?.delivery },
    { label: "Delivery Time", value: ocf.terms?.deliveryTime },
    { label: "Packing", value: ocf.terms?.packing },
    { label: "Shipping", value: ocf.terms?.shipping },
    { label: "Validity", value: ocf.header?.validityDays ? `${ocf.header.validityDays} days` : "" },
  ].filter(t => t.value && String(t.value).trim());
  const termsHtml = termsRows.map(t => `
    <tr>
      <td style="padding:1mm 2mm 1mm 0;font-weight:600;color:#000;width:35mm;vertical-align:top;font-size:9pt;">${esc(t.label)}:</td>
      <td style="padding:1mm 2mm;color:#000;font-size:9pt;">${esc(t.value)}</td>
    </tr>
  `).join("");

  const notesBlock = ocf.terms?.notes ? `
    <div style="margin-top:3mm;padding:2mm 3mm;background:#fafaf9;border-left:1mm solid #666;font-size:9pt;color:#333;">
      <div style="font-weight:600;margin-bottom:1mm;">Notes:</div>
      ${esc(ocf.terms.notes).replace(/\n/g, "<br>")}
    </div>
  ` : "";

  const bankBlock = bankRow ? `
    <div style="margin-top:3mm;font-size:8pt;color:#333;">
      <b>Bank Details:</b>
      ${bankRow.branchName ? `${esc(bankRow.branchName)} · ` : ""}${bankRow.iban ? `IBAN: ${esc(bankRow.iban)}` : ""}${bankRow.swift ? ` · SWIFT: ${esc(bankRow.swift)}` : ""}
    </div>
  ` : "";

  return `
<div id="ocf-pdf-root" style="width:210mm;padding:12mm 15mm;box-sizing:border-box;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#000;">
  <!-- Antet -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5mm;">
    <div style="width:80mm;">
      ${logoUrl
        ? `<img src="${logoUrl}" crossorigin="anonymous" style="max-width:70mm;max-height:22mm;object-fit:contain;" />`
        : `<div style="font-size:20pt;font-weight:700;letter-spacing:2px;">DENMA</div>
           <div style="font-size:6pt;letter-spacing:3px;color:#666;">P O W E R &nbsp; F O R &nbsp; M E T A L W O R K I N G</div>`}
    </div>
    <div style="text-align:right;font-size:8pt;line-height:1.35;">
      <div style="font-weight:700;">${esc(company.name)}</div>
      <div>${esc(company.address)}</div>
      <div>Phone: ${esc(company.phone)}</div>
      <div>${esc(company.taxOffice)}</div>
      <div>${esc(company.website)} &nbsp; ${esc(company.email)}</div>
    </div>
  </div>
  <hr style="border:none;border-top:0.5px solid #666;margin-bottom:6mm;" />

  <!-- Başlık + Müşteri kutusu -->
  <div style="display:flex;justify-content:space-between;margin-bottom:6mm;">
    <div style="width:100mm;border:0.5px solid #000;padding:4mm 5mm;box-sizing:border-box;">
      <div style="font-size:8pt;color:#666;font-weight:600;margin-bottom:2mm;">TO:</div>
      <div style="font-weight:700;font-size:10pt;margin-bottom:2mm;">${esc(ocf.customer?.name || "")}</div>
      ${ocf.customer?.attention ? `<div style="font-size:9pt;margin-bottom:1mm;">Attention: ${esc(ocf.customer.attention)}</div>` : ""}
      <div style="font-size:9pt;line-height:1.4;">
        ${ocf.customer?.address ? `<div>${esc(ocf.customer.address).replace(/\n/g, "<br>")}</div>` : ""}
        ${ocf.customer?.city ? `<div>${esc(ocf.customer.city)}</div>` : ""}
        ${ocf.customer?.country ? `<div>${esc(ocf.customer.country)}</div>` : ""}
      </div>
    </div>
    <div style="width:75mm;text-align:right;">
      <div style="font-size:14pt;font-weight:700;margin-bottom:4mm;letter-spacing:1px;">ORDER CONFIRMATION</div>
      <table style="margin-left:auto;font-size:9pt;border-collapse:collapse;">
        <tr><td style="padding:1mm 4mm 1mm 0;color:#666;text-align:right;">Ref. No:</td><td style="font-weight:700;">${esc(ocf.header?.docNo || "")}</td></tr>
        <tr><td style="padding:1mm 4mm 1mm 0;color:#666;text-align:right;">Date:</td><td>${esc(ocf.header?.docDate || "")}</td></tr>
        <tr><td style="padding:1mm 4mm 1mm 0;color:#666;text-align:right;">Currency:</td><td>${esc(cur)}</td></tr>
      </table>
    </div>
  </div>

  <!-- Ürün tablosu -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:4mm;">
    <thead>
      <tr style="background:#e5e7eb;">
        <th style="border:0.5px solid #000;padding:2mm;text-align:center;width:8mm;font-size:8pt;">#</th>
        <th style="border:0.5px solid #000;padding:2mm;text-align:left;width:26mm;font-size:8pt;">Stock Code</th>
        <th style="border:0.5px solid #000;padding:2mm;text-align:left;font-size:8pt;">Description</th>
        <th style="border:0.5px solid #000;padding:2mm;text-align:right;width:14mm;font-size:8pt;">Qty</th>
        <th style="border:0.5px solid #000;padding:2mm;text-align:center;width:12mm;font-size:8pt;">Unit</th>
        <th style="border:0.5px solid #000;padding:2mm;text-align:right;width:24mm;font-size:8pt;">Unit Price</th>
        <th style="border:0.5px solid #000;padding:2mm;text-align:right;width:28mm;font-size:8pt;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-weight:700;background:#f5f5f4;font-size:10pt;">GRAND TOTAL</td>
        <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-weight:700;font-size:11pt;background:#f5f5f4;">${fmt2(ocf.totals?.grandTotal || 0)} ${currencySymbol}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Şartlar -->
  ${termsRows.length > 0 ? `
    <div style="margin-top:5mm;">
      <div style="font-size:10pt;font-weight:700;color:#000;margin-bottom:2mm;border-bottom:0.5px solid #333;padding-bottom:1mm;">TERMS &amp; CONDITIONS</div>
      <table style="width:100%;border-collapse:collapse;">
        ${termsHtml}
      </table>
    </div>
  ` : ""}

  ${notesBlock}
  ${bankBlock}

  <!-- İmza + kaşe -->
  <table style="width:100%;border-collapse:collapse;margin-top:10mm;">
    <tr>
      <td style="width:50%;vertical-align:bottom;">
        <div style="font-size:8pt;color:#666;font-weight:600;margin-bottom:2mm;">On behalf of Seller:</div>
        <div style="font-size:9pt;font-weight:600;">${esc(company.name)}</div>
        ${stampUrl
          ? `<div style="margin-top:2mm;"><img src="${stampUrl}" crossorigin="anonymous" style="max-width:50mm;max-height:26mm;object-fit:contain;" /></div>`
          : `<div style="height:20mm;border-bottom:0.5px solid #999;margin-top:6mm;"></div>
             <div style="font-size:8pt;color:#666;margin-top:1mm;">Authorized Signature</div>`}
      </td>
      <td style="width:50%;vertical-align:bottom;">
        <div style="font-size:8pt;color:#666;font-weight:600;margin-bottom:2mm;">Approved by Buyer:</div>
        <div style="height:20mm;border-bottom:0.5px solid #999;margin-top:6mm;"></div>
        <div style="font-size:8pt;color:#666;margin-top:1mm;">Signature / Stamp / Date</div>
      </td>
    </tr>
  </table>
</div>
`;
}

export async function generateOcfPdf(ocf, settings) {
  const html = buildOcfHtml(ocf, settings || {});
  // Off-screen render
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-9999px";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const root = container.querySelector("#ocf-pdf-root");
    // KRİTİK: imajların (logo + kaşe) yüklenmesini bekle — aksi halde boş çıkar
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }));
    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfWidth = pdf.internal.pageSize.getWidth();   // 210mm
    const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgHeightMm = (canvasHeight * pdfWidth) / canvasWidth;
    // Tek sayfa toleransı (küçük taşma A4'e sığdırılır) — invoicePdf.js paterni
    const SINGLE_PAGE_TOLERANCE_MM = 8;
    if (imgHeightMm <= pdfHeight + SINGLE_PAGE_TOLERANCE_MM) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, Math.min(imgHeightMm, pdfHeight));
    } else {
      // Multi-page slicing — satır sınırında akıllı kesme (beyaz şerit ara)
      const pxPerMm = canvasWidth / pdfWidth;
      const pageContentPx = pdfHeight * pxPerMm;
      // Beyaz şerit arama penceresi: ideal kesme noktasından geriye doğru maks 30mm
      const searchWindowPx = Math.round(30 * pxPerMm);
      const ctxFull = canvas.getContext("2d");
      const isWhiteRow = (y) => {
        // Bir yatay pikseli tara: tüm px >=240 (beyaz sayılır) ise true
        // Performans için her 4. pikselde bir örnekleme yeterli
        const data = ctxFull.getImageData(0, y, canvasWidth, 1).data;
        for (let x = 0; x < canvasWidth; x += 4) {
          const r = data[x * 4], g = data[x * 4 + 1], b = data[x * 4 + 2];
          if (r < 240 || g < 240 || b < 240) return false;
        }
        return true;
      };
      const findBreak = (targetY) => {
        // targetY'den geriye doğru arayıp beyaz şerit (üst üste 2+ beyaz satır) bul
        const minY = Math.max(targetY - searchWindowPx, 0);
        for (let y = targetY; y >= minY; y--) {
          if (isWhiteRow(y) && isWhiteRow(y - 1)) return y;
        }
        return targetY; // fallback: hard-split
      };
      let offset = 0;
      let pageIdx = 0;
      while (offset < canvasHeight) {
        if (pageIdx > 0) pdf.addPage();
        const remaining = canvasHeight - offset;
        let sliceHeight;
        if (remaining <= pageContentPx) {
          sliceHeight = remaining;
        } else {
          const targetEnd = offset + pageContentPx;
          const breakY = findBreak(targetEnd);
          sliceHeight = Math.max(breakY - offset, Math.round(pageContentPx * 0.5));
        }
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvasWidth;
        sliceCanvas.height = sliceHeight;
        sliceCanvas.getContext("2d").drawImage(canvas, 0, offset, canvasWidth, sliceHeight, 0, 0, canvasWidth, sliceHeight);
        const sliceHeightMm = sliceHeight / pxPerMm;
        pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, sliceHeightMm);
        offset += sliceHeight;
        pageIdx++;
      }
    }
    const fileName = `OCF_${(ocf.header?.docNo || Date.now()).toString().replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
    pdf.save(fileName);
  } finally {
    document.body.removeChild(container);
  }
}
