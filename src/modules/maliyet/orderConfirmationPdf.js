// Order Confirmation Form (OCF) PDF üretimi.
// Fiyat Listesi taslak simülasyonundan → müşteriye gönderilecek teklif dokümanı.
// HTML template → html2canvas → jsPDF (ihracat/invoicePdf.js ile aynı pattern).
//
// Girdiler:
//   ocf.header: { docNo, docDate, validityDays, currency }
//   ocf.customer: { name, address, attention, city, country }
//   ocf.items: [{ stockCode, name, descriptionEn, qty, unit, unitPrice, lineTotal }]
//   ocf.totals: { subtotal, grandTotal }
//   ocf.terms: { payment, delivery, deliveryTime, packing, shipping, notes }
//   settings (invoiceSettings): logo, companyName, address, taxOffice, taxNo, phone, email,
//                                bankAccounts, kase (kaşe/imza görüntüsü)

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
  const cur = ocf.header?.currency || "EUR";
  const logoImg = settings?.logo ? `<img src="${esc(settings.logo)}" style="max-height:60px;max-width:180px;" />` : "";
  const company = {
    name: settings?.companyName || "DENMA MÜHENDİSLİK LTD. ŞTİ.",
    address: settings?.address || "",
    taxOffice: settings?.taxOffice || "",
    taxNo: settings?.taxNo || "",
    phone: settings?.phone || "",
    email: settings?.email || "",
  };
  const banks = Array.isArray(settings?.bankAccounts) ? settings.bankAccounts : [];
  const bankRow = banks.length > 0 ? banks[0] : null; // ilk banka hesabı (default)
  const kase = settings?.kase || settings?.signature || "";

  const itemRows = ocf.items.map((it, i) => `
    <tr>
      <td style="border:1px solid #ccc;padding:5px 6px;text-align:center;">${i + 1}</td>
      <td style="border:1px solid #ccc;padding:5px 6px;font-family:Consolas,monospace;">${esc(it.stockCode)}</td>
      <td style="border:1px solid #ccc;padding:5px 6px;">${esc(it.descriptionEn || it.name)}</td>
      <td style="border:1px solid #ccc;padding:5px 6px;text-align:right;">${fmt0(it.qty)}</td>
      <td style="border:1px solid #ccc;padding:5px 6px;text-align:center;">${esc(it.unit || "PCS")}</td>
      <td style="border:1px solid #ccc;padding:5px 6px;text-align:right;">${fmt2(it.unitPrice)}</td>
      <td style="border:1px solid #ccc;padding:5px 6px;text-align:right;font-weight:600;">${fmt2(it.lineTotal)}</td>
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
      <td style="padding:4px 8px;font-weight:600;color:#333;width:150px;vertical-align:top;">${esc(t.label)}:</td>
      <td style="padding:4px 8px;color:#333;">${esc(t.value)}</td>
    </tr>
  `).join("");

  const notesBlock = ocf.terms?.notes ? `
    <div style="margin-top:12px;padding:8px;background:#fafaf9;border-left:3px solid #666;font-size:10pt;color:#333;">
      <div style="font-weight:600;margin-bottom:4px;">Notes:</div>
      ${esc(ocf.terms.notes).replace(/\n/g, "<br>")}
    </div>
  ` : "";

  const bankBlock = bankRow ? `
    <div style="margin-top:14px;font-size:9pt;color:#555;">
      <div style="font-weight:600;color:#333;">Bank Details:</div>
      ${bankRow.branchName ? `${esc(bankRow.branchName)} · ` : ""}${bankRow.iban ? `IBAN: ${esc(bankRow.iban)}` : ""}${bankRow.swift ? ` · SWIFT: ${esc(bankRow.swift)}` : ""}
    </div>
  ` : "";

  return `
<div style="font-family:Arial,Helvetica,sans-serif;width:794px;padding:30px;color:#222;background:#fff;box-sizing:border-box;">
  <!-- Header: logo + firma + doküman bilgisi -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr>
      <td style="vertical-align:top;width:60%;">
        ${logoImg}
        <div style="margin-top:6px;font-size:14pt;font-weight:700;color:#1a1a1a;">${esc(company.name)}</div>
        <div style="font-size:9pt;color:#555;line-height:1.4;margin-top:4px;">
          ${esc(company.address)}<br>
          ${company.taxOffice ? `Tax Office: ${esc(company.taxOffice)} · ` : ""}${company.taxNo ? `VAT: ${esc(company.taxNo)}` : ""}<br>
          ${company.phone ? `Tel: ${esc(company.phone)}` : ""}${company.email ? ` · ${esc(company.email)}` : ""}
        </div>
      </td>
      <td style="vertical-align:top;width:40%;text-align:right;">
        <div style="font-size:18pt;font-weight:700;color:#1a1a1a;letter-spacing:1px;">ORDER CONFIRMATION</div>
        <table style="margin-left:auto;margin-top:8px;font-size:10pt;border-collapse:collapse;">
          <tr><td style="padding:2px 8px 2px 0;color:#666;">Ref. No:</td><td style="font-weight:600;">${esc(ocf.header?.docNo || "")}</td></tr>
          <tr><td style="padding:2px 8px 2px 0;color:#666;">Date:</td><td>${esc(ocf.header?.docDate || "")}</td></tr>
          <tr><td style="padding:2px 8px 2px 0;color:#666;">Currency:</td><td>${esc(cur)}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Müşteri bilgisi -->
  <div style="border:1px solid #ccc;padding:10px 12px;margin-bottom:14px;background:#fafafa;">
    <div style="font-size:9pt;color:#666;font-weight:600;margin-bottom:4px;">TO:</div>
    <div style="font-size:11pt;font-weight:700;color:#1a1a1a;">${esc(ocf.customer?.name || "")}</div>
    ${ocf.customer?.attention ? `<div style="font-size:9pt;color:#555;margin-top:2px;">Attention: ${esc(ocf.customer.attention)}</div>` : ""}
    ${ocf.customer?.address ? `<div style="font-size:9pt;color:#555;margin-top:2px;">${esc(ocf.customer.address).replace(/\n/g, "<br>")}</div>` : ""}
    ${(ocf.customer?.city || ocf.customer?.country) ? `<div style="font-size:9pt;color:#555;">${esc(ocf.customer.city || "")}${ocf.customer.city && ocf.customer.country ? " · " : ""}${esc(ocf.customer.country || "")}</div>` : ""}
  </div>

  <!-- Ürün tablosu -->
  <table style="width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:10px;">
    <thead>
      <tr style="background:#e5e7eb;">
        <th style="border:1px solid #999;padding:6px 8px;text-align:center;width:30px;">#</th>
        <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Stock Code</th>
        <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Description</th>
        <th style="border:1px solid #999;padding:6px 8px;text-align:right;width:60px;">Qty</th>
        <th style="border:1px solid #999;padding:6px 8px;text-align:center;width:50px;">Unit</th>
        <th style="border:1px solid #999;padding:6px 8px;text-align:right;width:90px;">Unit Price</th>
        <th style="border:1px solid #999;padding:6px 8px;text-align:right;width:100px;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" style="border:1px solid #999;padding:8px 10px;text-align:right;font-weight:700;background:#f5f5f4;">GRAND TOTAL (${esc(cur)})</td>
        <td style="border:1px solid #999;padding:8px 10px;text-align:right;font-weight:700;font-size:12pt;background:#f5f5f4;color:#1a1a1a;">${fmt2(ocf.totals?.grandTotal || 0)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Şartlar -->
  ${termsRows.length > 0 ? `
    <div style="margin-top:14px;">
      <div style="font-size:11pt;font-weight:700;color:#1a1a1a;margin-bottom:6px;border-bottom:2px solid #333;padding-bottom:3px;">TERMS & CONDITIONS</div>
      <table style="width:100%;border-collapse:collapse;font-size:10pt;">
        ${termsHtml}
      </table>
    </div>
  ` : ""}

  ${notesBlock}
  ${bankBlock}

  <!-- İmza + kaşe -->
  <table style="width:100%;border-collapse:collapse;margin-top:30px;">
    <tr>
      <td style="width:50%;vertical-align:bottom;">
        <div style="font-size:9pt;color:#666;font-weight:600;margin-bottom:6px;">On behalf of Seller:</div>
        <div style="font-size:10pt;font-weight:600;color:#1a1a1a;">${esc(company.name)}</div>
        ${kase ? `<img src="${esc(kase)}" style="max-height:80px;max-width:200px;margin-top:6px;" />` : `<div style="height:60px;border-bottom:1px solid #999;margin-top:20px;"></div>`}
      </td>
      <td style="width:50%;vertical-align:bottom;">
        <div style="font-size:9pt;color:#666;font-weight:600;margin-bottom:6px;">Approved by Buyer:</div>
        <div style="height:60px;border-bottom:1px solid #999;margin-top:20px;"></div>
        <div style="font-size:9pt;color:#666;margin-top:4px;">Signature / Stamp / Date</div>
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
  container.style.top = "-10000px";
  container.style.left = "0";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const target = container.firstElementChild;
    const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfWidth = 210;
    const pdfHeight = 297;
    const imgHeightMm = (canvas.height * pdfWidth) / canvas.width;
    if (imgHeightMm <= pdfHeight) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, imgHeightMm);
    } else {
      // Çok uzun → sayfa böl
      let pos = 0;
      const pxPerMm = canvas.width / pdfWidth;
      const pageHeightPx = Math.floor(pdfHeight * pxPerMm);
      while (pos < canvas.height) {
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.min(pageHeightPx, canvas.height - pos);
        const ctx = sliceCanvas.getContext("2d");
        ctx.drawImage(canvas, 0, pos, canvas.width, sliceCanvas.height, 0, 0, sliceCanvas.width, sliceCanvas.height);
        const sliceHeightMm = (sliceCanvas.height * pdfWidth) / canvas.width;
        if (pos > 0) pdf.addPage();
        pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, sliceHeightMm);
        pos += pageHeightPx;
      }
    }
    const fileName = `OCF_${ocf.header?.docNo || Date.now()}.pdf`;
    pdf.save(fileName);
  } finally {
    document.body.removeChild(container);
  }
}
