// İhracat Sevkiyat PDF Üretimi — Çeki Listesi + Etiket
// jsPDF + html2canvas (aynı fatura PDF pattern'i — Türkçe font browser'dan)

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]);

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("tr-TR");
const fmt1 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmtDateTR(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return String(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// Ortak render helper: HTML → PDF (jpeg, single page + multi-page slice)
async function renderHtmlToPdf(html, { orientation = "portrait", format = "a4" } = {}) {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const root = container.querySelector("[data-pdf-root]");
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }));
    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation, unit: "mm", format });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgHeightMm = (canvasHeight * pdfWidth) / canvasWidth;
    const TOLERANCE = 8;
    if (imgHeightMm <= pdfHeight + TOLERANCE) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfWidth, imgHeightMm);
      return pdf;
    }
    // Multi-page slicing
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

// ============================================================
// ÇEKİ LİSTESİ (Packing List)
// ============================================================
// Motor tarafındaki packing list'in item-based, paletsiz basit versiyonu.
// shipment.items[] üzerinden ürün, adet, ağırlık listeler.

function buildPackingListHtml(shipment, opts) {
  const { products = [], invoiceSettings = {}, customerDefaults = {} } = opts || {};
  const company = invoiceSettings?.companyInfo || {
    name: "DENMA DIŞ TİCARET LTD.ŞTİ.",
    address: "Fevzi Çakmak Mah. 10670 Sk. No:31/B Karatay - KONYA / TURKEY",
    phone: "+90 332 606 29 83",
    taxOffice: "Selçuk V.D. 292 139 2109",
    website: "www.denma.com.tr",
    email: "bilgi@denma.com.tr",
  };
  const logoUrl = invoiceSettings?.logoImage?.url || "";
  const customerDefault = customerDefaults[shipment.customerCode] || {};
  const customerAddress = customerDefault.address || "";
  const customerCity = customerDefault.city || "";
  const customerCountry = customerDefault.country || "";

  const rows = (shipment.items || []).map((it, idx) => {
    const prod = products.find(p => Number(p.id) === Number(it.pid));
    const unitKg = Number(prod?.kg) || 0;
    const totalNetKg = unitKg * (Number(it.qty) || 0);
    return { idx: idx + 1, ...it, unitKg, totalNetKg, nameEN: it.descriptionEn || prod?.nameEN || it.stokAdi };
  });
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalNetKg = rows.reduce((s, r) => s + r.totalNetKg, 0);

  const rowsHtml = rows.map(r => `
    <tr>
      <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:center;font-size:9pt;">${r.idx}</td>
      <td style="border:0.5px solid #000;padding:2mm 3mm;font-family:Consolas,monospace;font-size:9pt;">${esc(r.stokKodu || "-")}</td>
      <td style="border:0.5px solid #000;padding:2mm 3mm;font-size:9pt;">
        ${esc(r.nameEN || "-")}
      </td>
      <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-size:9pt;font-weight:600;">${fmt0(r.qty)}</td>
      <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-size:9pt;">${r.unitKg > 0 ? fmt1(r.unitKg) : "-"}</td>
      <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-size:9pt;font-weight:600;">${r.totalNetKg > 0 ? fmt1(r.totalNetKg) : "-"}</td>
    </tr>
  `).join("");

  return `
<div data-pdf-root style="width:210mm;padding:15mm;box-sizing:border-box;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#000;">
  <!-- Antet -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm;">
    <div style="width:80mm;">
      ${logoUrl
        ? `<img src="${logoUrl}" crossorigin="anonymous" style="max-width:70mm;max-height:22mm;object-fit:contain;" />`
        : `<div style="font-size:20pt;font-weight:700;letter-spacing:2px;">DENMA</div>`}
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

  <!-- Başlık + Müşteri + Sevkiyat bilgisi -->
  <div style="display:flex;justify-content:space-between;margin-bottom:6mm;">
    <div style="width:100mm;border:0.5px solid #000;padding:4mm 5mm;">
      <div style="font-size:10pt;color:#555;margin-bottom:1mm;">TO / İTHALATÇI</div>
      <div style="font-weight:700;font-size:11pt;">${esc(shipment.customerName || "")}</div>
      <div style="font-size:9pt;line-height:1.4;margin-top:2mm;">
        ${customerAddress ? `<div>${esc(customerAddress)}</div>` : ""}
        ${customerCity ? `<div>${esc(customerCity)}</div>` : ""}
        ${customerCountry ? `<div>${esc(customerCountry)}</div>` : ""}
      </div>
    </div>
    <div style="width:75mm;text-align:right;">
      <div style="font-size:18pt;font-weight:900;letter-spacing:2px;margin-bottom:4mm;">PACKING LIST</div>
      <div style="font-size:16pt;font-weight:800;margin-bottom:1mm;">ÇEKİ LİSTESİ</div>
      <table style="margin-left:auto;font-size:10pt;">
        <tr><td style="padding:1mm 2mm;font-weight:700;">Date</td><td>: ${esc(fmtDateTR(shipment.shipmentDate))}</td></tr>
        <tr><td style="padding:1mm 2mm;font-weight:700;">Ref</td><td>: ${esc(shipment.id || "-")}</td></tr>
      </table>
    </div>
  </div>

  <!-- Kalem tablosu -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:6mm;">
    <thead>
      <tr style="background:#f5f5f4;">
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:center;font-weight:700;width:10mm;">Nr.</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;width:30mm;">CODE</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:left;font-weight:700;">DESCRIPTION</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:right;font-weight:700;width:20mm;">QTY</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:right;font-weight:700;width:22mm;">UNIT KG</th>
        <th style="border:0.5px solid #000;padding:2mm;font-size:9pt;text-align:right;font-weight:700;width:25mm;">TOTAL KG</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr style="background:#f5f5f4;font-weight:700;">
        <td colspan="3" style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-size:10pt;">TOTAL :</td>
        <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-size:10pt;">${fmt0(totalQty)}</td>
        <td style="border:0.5px solid #000;padding:2mm 3mm;"></td>
        <td style="border:0.5px solid #000;padding:2mm 3mm;text-align:right;font-size:10pt;">${totalNetKg > 0 ? fmt1(totalNetKg) + " Kg" : "-"}</td>
      </tr>
    </tbody>
  </table>

  <!-- Alt bilgi -->
  <div style="margin-top:8mm;font-size:10pt;line-height:1.8;">
    <div><b>EXPORTER / İHRACATÇI</b> : ${esc(company.name)}</div>
    <div><b>IMPORTER / İTHALATÇI</b> : ${esc(shipment.customerName || "")}</div>
    <div><b>TOTAL ITEMS / TOPLAM KALEM</b> : ${(shipment.items || []).length}</div>
    <div><b>TOTAL QUANTITY / TOPLAM ADET</b> : ${fmt0(totalQty)}</div>
    ${totalNetKg > 0 ? `<div><b>TOTAL NET WEIGHT / TOPLAM NET AĞIRLIK</b> : ${fmt1(totalNetKg)} Kg</div>` : ""}
    ${shipment.notes ? `<div style="margin-top:4mm;padding:3mm;background:#fafaf9;border:0.5px solid #ccc;"><b>NOTES / NOTLAR:</b> ${esc(shipment.notes)}</div>` : ""}
  </div>
</div>`;
}

export async function generatePackingListPdf(shipment, opts) {
  const html = buildPackingListHtml(shipment, opts);
  const pdf = await renderHtmlToPdf(html, { orientation: "portrait", format: "a4" });
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  const filename = `PackingList_${safe(shipment.customerCode || "")}_${safe(shipment.shipmentDate || "")}.pdf`;
  pdf.save(filename);
}

// ============================================================
// SEVKİYAT ETİKETİ (Shipment Label)
// ============================================================
// Tek büyük etiket (100mm × 150mm) — müşteri adres + ürün özeti + tarih + toplam paket

function buildLabelHtml(shipment, opts) {
  const { products = [], invoiceSettings = {}, customerDefaults = {} } = opts || {};
  const company = invoiceSettings?.companyInfo || { name: "DENMA DIŞ TİCARET LTD.ŞTİ." };
  const logoUrl = invoiceSettings?.logoImage?.url || "";
  const customerDefault = customerDefaults[shipment.customerCode] || {};
  const customerAddress = customerDefault.address || "";
  const customerCity = customerDefault.city || "";
  const customerCountry = customerDefault.country || "";

  const rows = (shipment.items || []).map((it) => {
    const prod = products.find(p => Number(p.id) === Number(it.pid));
    const unitKg = Number(prod?.kg) || 0;
    const totalNetKg = unitKg * (Number(it.qty) || 0);
    return { ...it, unitKg, totalNetKg, nameEN: it.descriptionEn || prod?.nameEN || it.stokAdi };
  });
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalNetKg = rows.reduce((s, r) => s + r.totalNetKg, 0);
  const packageCount = (shipment.items || []).length; // her kalem = 1 paket varsayımı (basit)

  const itemRows = rows.slice(0, 8).map((r, i) => `
    <tr>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;text-align:center;font-size:7pt;">${i + 1}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;font-size:7pt;">${esc(r.nameEN || "-")}</td>
      <td style="border:0.5px solid #000;padding:1.5mm 2mm;text-align:right;font-size:7pt;font-weight:600;">${fmt0(r.qty)}</td>
    </tr>
  `).join("");
  const moreItems = rows.length > 8 ? `<tr><td colspan="3" style="border:0.5px solid #000;padding:1.5mm;text-align:center;font-size:6.5pt;font-style:italic;">+${rows.length - 8} more items…</td></tr>` : "";

  return `
<div data-pdf-root style="width:100mm;height:150mm;padding:5mm;font-family:Arial,Helvetica,sans-serif;color:#000;box-sizing:border-box;background:#fff;">
  <!-- Header: logo + company -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3mm;">
    <div style="flex:1;">
      ${logoUrl
        ? `<img src="${logoUrl}" crossorigin="anonymous" style="max-width:35mm;max-height:12mm;object-fit:contain;display:block;" />`
        : `<div style="font-size:14pt;font-weight:900;letter-spacing:2px;">DENMA</div>`}
      <div style="font-size:6pt;margin-top:1mm;line-height:1.4;">
        <b>${esc(company.name)}</b>
      </div>
    </div>
  </div>

  <!-- Date box -->
  <div style="border:2px solid #000;padding:2mm 4mm;margin-bottom:2mm;text-align:center;">
    <div style="font-size:16pt;font-weight:800;letter-spacing:1px;">${esc(fmtDateTR(shipment.shipmentDate))}</div>
  </div>

  <!-- Customer -->
  <div style="border:2px solid #000;padding:2mm 3mm;margin-bottom:2mm;text-align:center;">
    <div style="font-size:8pt;">TO:</div>
    <div style="font-size:12pt;font-weight:800;">${esc(shipment.customerName || "")}</div>
    ${customerCity ? `<div style="font-size:10pt;font-weight:600;margin-top:1mm;">${esc(customerCity)}${customerCountry ? " / " + esc(customerCountry).toUpperCase() : ""}</div>` : (customerCountry ? `<div style="font-size:10pt;font-weight:600;margin-top:1mm;">${esc(customerCountry).toUpperCase()}</div>` : "")}
  </div>

  <!-- Items summary -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:2mm;">
    <thead>
      <tr style="background:#eee;">
        <th style="border:0.5px solid #000;padding:1.5mm;font-size:7pt;width:8mm;">Nr</th>
        <th style="border:0.5px solid #000;padding:1.5mm;font-size:7pt;text-align:left;">Description</th>
        <th style="border:0.5px solid #000;padding:1.5mm;font-size:7pt;text-align:right;width:15mm;">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${moreItems}
    </tbody>
  </table>

  <!-- Weights + packages -->
  <div style="border:2px solid #000;padding:2mm 3mm;margin-bottom:2mm;">
    <div style="display:flex;justify-content:space-between;font-size:9pt;font-weight:700;margin-bottom:1mm;">
      <span>Total Items</span><span>${(shipment.items || []).length}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:9pt;font-weight:700;margin-bottom:1mm;">
      <span>Total Quantity</span><span>${fmt0(totalQty)}</span>
    </div>
    ${totalNetKg > 0 ? `<div style="display:flex;justify-content:space-between;font-size:9pt;font-weight:700;">
      <span>Total Net Weight</span><span>${fmt1(totalNetKg)} Kg</span>
    </div>` : ""}
  </div>

  <!-- Made in Turkey (bottom) -->
  <div style="text-align:center;font-size:8pt;font-weight:700;padding:2mm;border-top:1px solid #ccc;">
    MADE IN TÜRKİYE 🇹🇷
  </div>
</div>`;
}

export async function generateShipmentLabelPdf(shipment, opts) {
  const html = buildLabelHtml(shipment, opts);
  const pdf = await renderHtmlToPdf(html, { orientation: "portrait", format: [100, 150] });
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  const filename = `Label_${safe(shipment.customerCode || "")}_${safe(shipment.shipmentDate || "")}.pdf`;
  pdf.save(filename);
}
