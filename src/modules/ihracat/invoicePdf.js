// Commercial Invoice PDF üretimi.
// HTML template → html2canvas → jsPDF (teklif PDF ile aynı pattern).
// Türkçe karakterler browser fontuyla otomatik çalışır.
//
// Referans PDF: /Downloads/INV.NR.CI202668.pdf (OFMER SRL. 2026-07-15)

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]);

// Sayı → "1.234,56" (tr-TR)
function fmt2(n) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fatura HTML template — CSS + inline stiller. A4 (210mm) genişlikte.
// Standart bir kart formu: antet + müşteri/başlık + kalem tablosu + alt bilgi.
function buildInvoiceHtml(invoice, settings) {
  const company = settings?.companyInfo || {
    name: "DENMA DIŞ TİCARET LTD.ŞTİ.",
    address: "Fevzi Çakmak Mah. 10670 Sk. No:31/B Karatay - KONYA / TURKEY",
    phone: "+90 332 606 29 83",
    taxOffice: "Selçuk V.D. 292 139 2109",
    website: "www.denma.com.tr",
    email: "bilgi@denma.com.tr",
  };
  const bank = invoice.bankAccount || {}; // fatura üzerine seçilen hesap
  const stampUrl = settings?.stampImage?.url || "";
  const logoUrl = settings?.logoImage?.url || ""; // opsiyonel — yoksa yazı ile başlık

  const currencySymbol = (() => {
    switch ((invoice.currency || "EUR").toUpperCase()) {
      case "EUR": return "€";
      case "USD": return "$";
      case "GBP": return "£";
      case "TL": return "₺";
      default: return invoice.currency;
    }
  })();

  const paymentPlanRows = Array.isArray(invoice.paymentPlan)
    ? invoice.paymentPlan.map(p => {
        const label = String(p?.label || "").trim();
        const pct = Number(p?.pct) || 0;
        const amount = (Number(invoice.totalAmount) || 0) * (pct / 100);
        const value = pct > 0 ? `%${pct} - ${fmt2(amount)} ${(invoice.currency || "EUR").toUpperCase()}` : "-";
        return `
          <div style="display:flex;font-size:9pt;margin-bottom:2mm;">
            <div style="width:60mm;">${esc(label)}</div>
            <div style="width:5mm;">:</div>
            <div style="flex:1;">${esc(value)}</div>
          </div>`;
      }).join("")
    : "";

  const lineRows = (invoice.lines || []).map(l => `
    <tr>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:9pt;vertical-align:top;">${esc(l.description || "")}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:9pt;text-align:right;vertical-align:top;width:15mm;">${esc(l.qty || 0)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:9pt;vertical-align:top;width:12mm;">${esc(l.unit || "AD")}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:9pt;text-align:right;vertical-align:top;width:25mm;">${fmt2(l.unitPrice)} ${currencySymbol}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:9pt;text-align:right;vertical-align:top;width:28mm;font-weight:600;">${fmt2(l.amount)} ${currencySymbol}</td>
    </tr>
  `).join("");

  const invoiceDateFmt = (() => {
    const d = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  })();

  return `
<div id="invoice-pdf-root" style="width:210mm;padding:15mm;box-sizing:border-box;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#000;">
  <!-- Antet -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm;">
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
  <hr style="border:none;border-top:0.5px solid #666;margin-bottom:8mm;" />

  <!-- Başlık bloğu -->
  <div style="display:flex;justify-content:space-between;margin-bottom:6mm;">
    <!-- Müşteri kutusu -->
    <div style="width:90mm;border:0.5px solid #000;padding:5mm 6mm;min-height:35mm;box-sizing:border-box;">
      <div style="font-weight:700;font-size:10pt;margin-bottom:3mm;">${esc(invoice.customerName || "")}</div>
      <div style="font-size:9pt;line-height:1.4;">
        <div>${esc(invoice.customerAddress || "")}</div>
        ${invoice.customerCity ? `<div>${esc(invoice.customerCity)}</div>` : ""}
        ${invoice.customerCountry ? `<div>${esc(invoice.customerCountry)}</div>` : ""}
      </div>
    </div>
    <!-- Fatura bilgi -->
    <div style="width:80mm;text-align:right;">
      <div style="font-size:16pt;font-weight:700;margin-bottom:4mm;">COMMERCIAL INVOICE</div>
      <div style="font-size:14pt;margin-bottom:3mm;">
        <span style="font-weight:700;">NR.</span> ${esc(invoice.invoiceNo || "")}
      </div>
      <div style="font-size:10pt;margin-bottom:4mm;">
        <span style="font-weight:700;">DATE</span> ${esc(invoiceDateFmt)}
      </div>
      ${stampUrl ? `<div style="text-align:right;margin-top:4mm;"><img src="${stampUrl}" crossorigin="anonymous" style="max-width:50mm;max-height:25mm;object-fit:contain;" /></div>` : ""}
    </div>
  </div>

  <!-- Kalem tablosu -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6mm;">
    <thead>
      <tr style="background:#fff;">
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;">DESCRIPTION</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;width:15mm;">Q.TY</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;width:12mm;">U.M</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;width:25mm;">PRICE</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;width:28mm;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  <!-- Toplam + Order NR -->
  <div style="display:flex;justify-content:space-between;margin-bottom:8mm;margin-top:8mm;">
    <div style="width:80mm;">
      <div style="font-size:10pt;font-weight:700;margin-bottom:2mm;">ORDER NR. &nbsp;: ${esc(invoice.orderNr || "")}</div>
    </div>
    <div style="width:80mm;border:0.5px solid #000;padding:4mm 5mm;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:10pt;font-weight:700;">TOTAL AMOUNT</div>
          <div style="font-size:9pt;margin-top:1mm;">( ${esc(invoice.deliveryTermsShort || invoice.deliveryTerms || "")} )</div>
        </div>
        <div style="font-size:12pt;font-weight:700;">${fmt2(invoice.totalAmount)} ${currencySymbol}</div>
      </div>
    </div>
  </div>

  <!-- Alt bilgi -->
  <div style="margin-top:8mm;font-size:9pt;line-height:1.6;">
    <div style="display:flex;margin-bottom:2mm;">
      <div style="width:60mm;font-weight:600;">DELIVERY TERMS</div>
      <div style="width:5mm;">:</div>
      <div style="flex:1;">${esc(invoice.deliveryTerms || "")}</div>
    </div>
    <div style="display:flex;margin-bottom:2mm;">
      <div style="width:60mm;font-weight:600;">BRANCH BANK/NAME</div>
      <div style="width:5mm;">:</div>
      <div style="flex:1;">${esc(bank.branchName || "")}</div>
    </div>
    <div style="display:flex;margin-bottom:4mm;">
      <div style="width:60mm;font-weight:600;">IBAN / SWIFT CODE</div>
      <div style="width:5mm;">:</div>
      <div style="flex:1;">${esc(bank.iban || "")} / ${esc(bank.swift || "")}</div>
    </div>
    ${paymentPlanRows}
  </div>
</div>`;
}

async function renderInvoicePdf(invoice, settings) {
  const html = buildInvoiceHtml(invoice, settings);
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const root = container.querySelector("#invoice-pdf-root");
    // İmajların (logo + kaşe) yüklenmesini bekle
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }));
    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgHeightMm = (canvasHeight * pdfWidth) / canvasWidth;
    // Tek sayfa (küçük taşma toleransı)
    const SINGLE_PAGE_TOLERANCE_MM = 8;
    if (imgHeightMm <= pdfHeight + SINGLE_PAGE_TOLERANCE_MM) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, imgHeightMm);
      return pdf;
    }
    // Çok satırlı fatura — multi-page slicing (teklif PDF pattern)
    const pxPerMm = canvasWidth / pdfWidth;
    const firstPageContentPx = pdfHeight * pxPerMm;
    let offset = 0;
    let pageIdx = 0;
    while (offset < canvasHeight) {
      if (pageIdx > 0) pdf.addPage();
      const sliceHeight = Math.min(firstPageContentPx, canvasHeight - offset);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvasWidth;
      sliceCanvas.height = sliceHeight;
      sliceCanvas.getContext("2d").drawImage(canvas, 0, offset, canvasWidth, sliceHeight, 0, 0, canvasWidth, sliceHeight);
      const sliceHeightMm = sliceHeight / pxPerMm;
      pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, sliceHeightMm);
      offset += sliceHeight;
      pageIdx++;
    }
    return pdf;
  } finally {
    document.body.removeChild(container);
  }
}

// PDF indir
export async function generateInvoicePdf(invoice, settings) {
  const pdf = await renderInvoicePdf(invoice, settings);
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  const filename = `INV.NR.${safe(invoice.invoiceNo)}.pdf`;
  pdf.save(filename);
}

// Blob döndür (mail eki veya arşiv için)
export async function buildInvoicePdfBlob(invoice, settings) {
  const pdf = await renderInvoicePdf(invoice, settings);
  return pdf.output("blob");
}
