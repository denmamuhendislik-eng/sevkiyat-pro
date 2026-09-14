// Order Confirmation Form (OCF) PDF üretimi.
// Fiyat Listesi taslak simülasyonundan → müşteriye gönderilecek teklif dokümanı.
// Sayfa yapısı: kalem-chunk paterni — her sayfa ayrı HTML → ayrı canvas → jsPDF page.
//   • İlk sayfa: antet + müşteri kutusu + doc info + tablo (ilk N kalem)
//   • Ara sayfalar: antet + "continued" bilgisi + tablo (sonraki N kalem)
//   • Son sayfa: antet + "continued" bilgisi + tablo + grand total + terms + kaşe/imza
// Böylece satır ortasında kesme olmaz, her sayfada logo/firma antet garanti gelir.

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

const DEFAULT_COMPANY = {
  name: "DENMA DIŞ TİCARET LTD.ŞTİ.",
  address: "Fevzi Çakmak Mah. 10670 Sk. No:31/B Karatay - KONYA / TURKEY",
  phone: "+90 332 606 29 83",
  taxOffice: "Selçuk V.D. 292 139 2109",
  website: "www.denma.com.tr",
  email: "bilgi@denma.com.tr",
};

function currencySymbolOf(cur) {
  switch (cur) {
    case "EUR": return "€";
    case "USD": return "$";
    case "GBP": return "£";
    case "TL": case "TRY": return "₺";
    default: return cur;
  }
}

function headerBlockHtml(company, logoUrl) {
  return `
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
  `;
}

function firstPageInfoBlockHtml(ocf, cur) {
  return `
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
  `;
}

function continuedInfoBlockHtml(ocf, pageNum, totalPages) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5mm;font-size:9pt;color:#555;padding:2mm 3mm;background:#f5f5f4;border-radius:2mm;">
      <div>Order Confirmation · Ref: <b>${esc(ocf.header?.docNo || "")}</b></div>
      <div>Page ${pageNum} / ${totalPages}</div>
    </div>
  `;
}

function itemsTableHtml(itemsSlice, startIdx, currencySymbol, withGrandTotal, grandTotal) {
  const rows = itemsSlice.map((it, i) => `
    <tr>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:center;">${startIdx + i + 1}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;font-family:Consolas,monospace;">${esc(it.stockCode)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;">${esc(it.descriptionEn || it.name)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:right;">${fmt0(it.qty)}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:center;">${esc(it.unit || "PCS")}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:right;">${fmt2(it.unitPrice)} ${currencySymbol}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:8pt;text-align:right;font-weight:600;">${fmt2(it.lineTotal)} ${currencySymbol}</td>
    </tr>
  `).join("");

  const tfoot = withGrandTotal ? `
    <tfoot>
      <tr>
        <td colspan="6" style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-weight:700;background:#f5f5f4;font-size:10pt;">GRAND TOTAL</td>
        <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-weight:700;font-size:11pt;background:#f5f5f4;">${fmt2(grandTotal)} ${currencySymbol}</td>
      </tr>
    </tfoot>
  ` : "";

  return `
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
      <tbody>${rows}</tbody>
      ${tfoot}
    </table>
  `;
}

function continuedFooterHtml() {
  return `<div style="text-align:right;font-size:8pt;color:#666;margin-top:2mm;font-style:italic;">Continued on next page...</div>`;
}

function termsBlockHtml(ocf) {
  const termsRows = [
    { label: "Payment Terms", value: ocf.terms?.payment },
    { label: "Delivery Terms", value: ocf.terms?.delivery },
    { label: "Delivery Time", value: ocf.terms?.deliveryTime },
    { label: "Packing", value: ocf.terms?.packing },
    { label: "Shipping", value: ocf.terms?.shipping },
    { label: "Validity", value: ocf.header?.validityDays ? `${ocf.header.validityDays} days` : "" },
  ].filter(t => t.value && String(t.value).trim());
  if (termsRows.length === 0) return "";
  const html = termsRows.map(t => `
    <tr>
      <td style="padding:1mm 2mm 1mm 0;font-weight:600;color:#000;width:35mm;vertical-align:top;font-size:9pt;">${esc(t.label)}:</td>
      <td style="padding:1mm 2mm;color:#000;font-size:9pt;">${esc(t.value)}</td>
    </tr>
  `).join("");
  return `
    <div style="margin-top:5mm;">
      <div style="font-size:10pt;font-weight:700;color:#000;margin-bottom:2mm;border-bottom:0.5px solid #333;padding-bottom:1mm;">TERMS &amp; CONDITIONS</div>
      <table style="width:100%;border-collapse:collapse;">${html}</table>
    </div>
  `;
}

function notesBlockHtml(ocf) {
  return ocf.terms?.notes ? `
    <div style="margin-top:3mm;padding:2mm 3mm;background:#fafaf9;border-left:1mm solid #666;font-size:9pt;color:#333;">
      <div style="font-weight:600;margin-bottom:1mm;">Notes:</div>
      ${esc(ocf.terms.notes).replace(/\n/g, "<br>")}
    </div>
  ` : "";
}

function bankBlockHtml(bankRow) {
  return bankRow ? `
    <div style="margin-top:3mm;font-size:8pt;color:#333;">
      <b>Bank Details:</b>
      ${bankRow.branchName ? `${esc(bankRow.branchName)} · ` : ""}${bankRow.iban ? `IBAN: ${esc(bankRow.iban)}` : ""}${bankRow.swift ? ` · SWIFT: ${esc(bankRow.swift)}` : ""}
    </div>
  ` : "";
}

function signatureBlockHtml(company, stampUrl) {
  return `
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
  `;
}

function buildPageHtml({ ocf, settings, itemsSlice, startIdx, isFirst, isLast, pageNum, totalPages }) {
  const cur = (ocf.header?.currency || "EUR").toUpperCase();
  const currencySymbol = currencySymbolOf(cur);
  const company = settings?.companyInfo || DEFAULT_COMPANY;
  const logoUrl = settings?.logoImage?.url || "";
  const stampUrl = settings?.stampImage?.url || "";
  const banks = Array.isArray(settings?.bankAccounts) ? settings.bankAccounts : [];
  const bankRow = banks.find(b => b.isDefault) || banks[0] || null;
  const grandTotal = ocf.totals?.grandTotal || 0;

  return `
<div id="ocf-pdf-root" style="width:210mm;padding:12mm 15mm;box-sizing:border-box;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#000;">
  ${headerBlockHtml(company, logoUrl)}
  ${isFirst ? firstPageInfoBlockHtml(ocf, cur) : continuedInfoBlockHtml(ocf, pageNum, totalPages)}
  ${itemsTableHtml(itemsSlice, startIdx, currencySymbol, isLast, grandTotal)}
  ${!isLast ? continuedFooterHtml() : ""}
  ${isLast ? termsBlockHtml(ocf) : ""}
  ${isLast ? notesBlockHtml(ocf) : ""}
  ${isLast ? bankBlockHtml(bankRow) : ""}
  ${isLast ? signatureBlockHtml(company, stampUrl) : ""}
</div>
`;
}

// Kalemleri sayfa başına bölmek için plan çıkar:
//   • PAGE_ITEMS: normal sayfada max kalem sayısı (footer'sız)
//   • LAST_MAX_WITH_FOOTER: son sayfada (footer'lı) max kalem sayısı
// Son sayfaya footer + kalem sığmıyorsa ayrı bir footer-only sayfa eklenir.
function planPages(items) {
  const PAGE_ITEMS = 20;
  const LAST_MAX_WITH_FOOTER = 12;
  const pages = [];
  let cursor = 0;
  let isFirst = true;
  while (cursor < items.length) {
    const remaining = items.length - cursor;
    const take = Math.min(PAGE_ITEMS, remaining);
    const remainingAfter = remaining - take;
    const isLastItemPage = remainingAfter === 0;
    const canFitFooter = take <= LAST_MAX_WITH_FOOTER;
    const isLast = isLastItemPage && canFitFooter;
    pages.push({ items: items.slice(cursor, cursor + take), startIdx: cursor, isFirst, isLast });
    cursor += take;
    isFirst = false;
  }
  if (pages.length === 0) {
    pages.push({ items: [], startIdx: 0, isFirst: true, isLast: true });
  } else if (!pages[pages.length - 1].isLast) {
    // Son sayfaya footer sığmadı → footer için ayrı sayfa
    pages.push({ items: [], startIdx: cursor, isFirst: false, isLast: true });
  }
  return pages;
}

async function renderPageToCanvas(html) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-9999px";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const root = container.querySelector("#ocf-pdf-root");
    // KRİTİK: imajların (logo + kaşe) yüklenmesini bekle
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }));
    return await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  } finally {
    document.body.removeChild(container);
  }
}

export async function generateOcfPdf(ocf, settings) {
  const items = Array.isArray(ocf.items) ? ocf.items : [];
  const pages = planPages(items);
  const totalPages = pages.length;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pdfWidth = pdf.internal.pageSize.getWidth();   // 210mm
  const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const html = buildPageHtml({
      ocf,
      settings: settings || {},
      itemsSlice: page.items,
      startIdx: page.startIdx,
      isFirst: page.isFirst,
      isLast: page.isLast,
      pageNum: p + 1,
      totalPages,
    });
    const canvas = await renderPageToCanvas(html);
    const imgHeightMm = (canvas.height * pdfWidth) / canvas.width;
    if (p > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, Math.min(imgHeightMm, pdfHeight));
  }

  const fileName = `OCF_${(ocf.header?.docNo || Date.now()).toString().replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  pdf.save(fileName);
}
