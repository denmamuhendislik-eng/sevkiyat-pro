// Teklif PDF üretimi — A4 dikey, modern minimal tasarım.
// jsPDF + html2canvas ile HTML → görüntü → PDF akışı.
//
// Görsel dil:
//   - Ana renk: #1e40af (koyu mavi)
//   - Accent: #16a34a (yeşil — toplam)
//   - Nötr: #1c1917 (koyu), #78716c (gri), #e7e5e4 (border)
//   - Tipografi: Inter / Segoe UI system stack
//   - Sayı font: JetBrains Mono / monospace
//
// Kullanıcı ekstra maliyet/kar bilgisi görmez — sadece satış tutarları.
// Aparat "ayrı satır" modda olan kalemler kalem tablosunun altında ek bir bölümde listelenir.

import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { LOGO_DENMA } from "../digerMusteriler/cocLogo";

const CURRENCY_SYMBOL = { TL: "₺", DOLAR: "$", EURO: "€", USD: "$", EUR: "€" };

function fmtMoney(n, currency = "TL") {
  const sym = CURRENCY_SYMBOL[currency] || currency || "";
  const num = Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${num} ${sym}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Termin normalizasyonu — sadece sayı girildiyse "gün" ekle, "GÜN" varsa dokunma
function fmtTerm(t) {
  if (t === undefined || t === null || t === "") return "";
  const s = String(t).trim();
  if (!s) return "";
  // Sadece sayı ise "N gün" yap
  if (/^\d+([.,]\d+)?$/.test(s)) return `${s} gün`;
  return s;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * HTML template oluştur — quote + calc verisi ile.
 * quote: kaydedilen teklif objesi (customerName, quoteNo, quoteDate, lines, paymentTerm, shipping, term, currency vb.)
 * calc:  calculateQuoteTotal çıktısı (lineResults, separateToolItems, totalSaleTl, totalSaleDisplay vb.)
 */
function buildQuoteHtml(quote, calc) {
  const currency = quote.currency || "TL";
  const displayFactor = calc?.displayFactor || 1;
  const showInCurrency = (tlValue) => fmtMoney(tlValue * displayFactor, currency);

  // Kalem satırları — kalem başına sadece satış fiyatı görünür (birim + toplam)
  // Birim fiyat: linePrice / quantity  (aparat spread modda dahil)
  const lineRows = (quote.lines || []).map((line, i) => {
    const lr = calc?.lineResults?.[i];
    const qty = Number(line.quantity) || 1;
    const linePrice = lr?.total?.salePrice || 0;
    const unitPrice = linePrice / qty;
    return `
      <tr>
        <td style="padding:8px 10px;font-family:'JetBrains Mono','Courier New',monospace;font-size:9px;color:#57534e;">${esc(i + 1)}</td>
        <td style="padding:8px 10px;font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:600;color:#1c1917;">
          ${esc(line.stockCode || "—")}
          ${line.musteriKodu ? `<div style="font-size:8px;color:#a8a29e;margin-top:2px;">müş: ${esc(line.musteriKodu)}</div>` : ""}
        </td>
        <td style="padding:8px 10px;font-size:10px;color:#1c1917;">
          ${esc(line.stockName || "—")}
          ${line.term ? `<div style="font-size:8px;color:#78716c;margin-top:2px;">Termin / Delivery: ${esc(fmtTerm(line.term))}</div>` : ""}
        </td>
        <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:600;">
          ${qty}
          <span style="font-size:8px;color:#78716c;font-weight:400;"> ${esc(line.unit || "AD")}</span>
        </td>
        <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;color:#57534e;">
          ${showInCurrency(unitPrice)}
        </td>
        <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:700;color:#1c1917;">
          ${showInCurrency(linePrice)}
        </td>
      </tr>
    `;
  }).join("");

  // Aparat/kalıp ayrı satır — varsa ek bölüm
  const separateTools = calc?.separateToolItems || [];
  const separateToolsBlock = separateTools.length > 0 ? `
    <div style="margin-top:16px;padding-top:12px;border-top:2px dashed #d6d3d1;">
      <div style="font-size:10px;font-weight:600;color:#92400e;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">
        Aparat / Kalıp / Özel Takım
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <tbody>
          ${separateTools.map(t => `
            <tr style="border-bottom:1px solid #fef3c7;">
              <td style="padding:6px 10px;color:#1c1917;">${esc(t.description)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-weight:700;color:#92400e;">
                ${showInCurrency(t.sale)}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : "";

  // Toplam bilgi
  const totalSale = calc?.totalSaleTl || 0;
  const totalSaleDisplay = totalSale * displayFactor;
  const separateToolsSale = separateTools.reduce((s, t) => s + (t.sale || 0), 0);
  const linesOnlySale = totalSale - separateToolsSale;
  const shippingCost = Number(quote.shippingCost || 0);
  const shippingIncluded = quote.shippingIncluded !== false;

  const totalRow = shippingCost > 0 && !shippingIncluded
    ? `
      <tr><td style="padding:4px 10px;font-size:10px;color:#57534e;">Ara toplam</td>
        <td style="padding:4px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;">${showInCurrency(totalSale)}</td></tr>
      <tr><td style="padding:4px 10px;font-size:10px;color:#57534e;">Nakliye</td>
        <td style="padding:4px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;">${showInCurrency(shippingCost)}</td></tr>
      <tr style="border-top:2px solid #1e40af;background:#eff6ff;">
        <td style="padding:10px 10px;font-size:12px;font-weight:700;color:#1e40af;">TOPLAM / TOTAL</td>
        <td style="padding:10px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:14px;font-weight:800;color:#1e40af;">
          ${showInCurrency(totalSale + shippingCost)}
        </td></tr>
    `
    : `
      <tr style="border-top:2px solid #1e40af;background:#eff6ff;">
        <td style="padding:10px 10px;font-size:12px;font-weight:700;color:#1e40af;">TOPLAM / TOTAL${shippingIncluded && shippingCost > 0 ? " (Nakliye Dahil)" : ""}</td>
        <td style="padding:10px 10px;text-align:right;font-family:'JetBrains Mono','Courier New',monospace;font-size:14px;font-weight:800;color:#1e40af;">
          ${showInCurrency(totalSale)}
        </td></tr>
    `;

  return `
<div id="quote-pdf-root" style="
  width:794px; min-height:1123px; padding:36px 44px 40px;
  background:#fff; color:#1c1917; font-family:'Inter','Segoe UI',Tahoma,sans-serif;
  box-sizing:border-box; font-size:11px; line-height:1.5;
">
  <!-- HEADER — kompakt, 3 satırlı denge:
       Satır 1: logo (büyük) + TEKLİF başlığı (sağ)
       Satır 2: firma bilgileri (sol) + teklif no & tarih inline mini pill (sağ) -->
  <div style="padding-bottom:12px; border-bottom:2px solid #1e40af;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <img src="${LOGO_DENMA}" style="width:220px;height:auto;" alt="DENMA" />
      <div style="text-align:right;">
        <div style="font-size:28px; font-weight:800; color:#1e40af; letter-spacing:1.5px; line-height:1;">TEKLİF</div>
        <div style="font-size:10px; color:#78716c; letter-spacing:2px; margin-top:2px;">QUOTATION</div>
      </div>
    </div>
    <div style="display:flex; align-items:flex-end; justify-content:space-between; margin-top:10px;">
      <div style="font-size:9px; color:#78716c; line-height:1.5;">
        Denma Mühendislik Mak. Otom. İnş. San. Tic. Ltd. Şti.<br/>
        Fevzi Çakmak Mah. 10670. Sk. No:31/B · Karatay / KONYA<br/>
        Tel: +90 332 606 29 83 · satis@denma.com.tr
      </div>
      <div style="display:flex; gap:8px; flex-shrink:0;">
        <div style="padding:6px 12px; background:#eff6ff; border-radius:6px; border:1px solid #bfdbfe;">
          <div style="font-size:8px; color:#57534e; text-transform:uppercase; letter-spacing:0.5px;">Teklif No / Quote No</div>
          <div style="font-size:14px; font-weight:800; color:#1e40af; font-family:'JetBrains Mono','Courier New',monospace; letter-spacing:1px;">
            ${esc(quote.quoteNo || "—")}
          </div>
        </div>
        <div style="padding:6px 12px; background:#f9fafb; border-radius:6px; border:1px solid #e7e5e4;">
          <div style="font-size:8px; color:#57534e; text-transform:uppercase; letter-spacing:0.5px;">Tarih / Date</div>
          <div style="font-size:14px; font-weight:700; color:#1c1917;">${fmtDate(quote.quoteDate)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- MÜŞTERİ + META -->
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-top:16px;">
    <div style="padding:12px 14px;background:#f9fafb;border-radius:6px;border:1px solid #e7e5e4;">
      <div style="font-size:9px;color:#78716c;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Müşteri / Customer</div>
      <div style="font-size:13px;font-weight:700;color:#1e40af;margin-top:4px;">${esc(quote.customerName || "—")}</div>
      ${quote.customerPhone ? `<div style="font-size:10px;color:#57534e;margin-top:3px;">Tel: ${esc(quote.customerPhone)}</div>` : ""}
      ${quote.customerEmail ? `<div style="font-size:10px;color:#57534e;">E-mail: ${esc(quote.customerEmail)}</div>` : ""}
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:6px;border:1px solid #e7e5e4;font-size:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#78716c;">Ödeme / Payment:</span>
        <span style="color:#1c1917;font-weight:600;">${esc(quote.paymentTerm || "—")}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#78716c;">Nakliye / Shipping:</span>
        <span style="color:#1c1917;font-weight:600;">${esc(quote.shipping || "—")}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="color:#78716c;">Termin / Delivery:</span>
        <span style="color:#1c1917;font-weight:600;">${esc(fmtTerm(quote.term) || "—")}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#78716c;">Döviz / Currency:</span>
        <span style="color:#1c1917;font-weight:600;">${esc(quote.currency || "TL")}</span>
      </div>
    </div>
  </div>

  <!-- KALEM TABLOSU -->
  <div style="margin-top:16px;">
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr style="background:#1e40af;color:#fff;">
          <th style="padding:9px 10px;text-align:left;font-weight:600;font-size:9px;border-radius:6px 0 0 0;">#</th>
          <th style="padding:9px 10px;text-align:left;font-weight:600;font-size:9px;">
            Stok Kodu<br/><span style="font-weight:400;opacity:0.85;">Part No</span>
          </th>
          <th style="padding:9px 10px;text-align:left;font-weight:600;font-size:9px;">
            Parça Adı<br/><span style="font-weight:400;opacity:0.85;">Description</span>
          </th>
          <th style="padding:9px 10px;text-align:right;font-weight:600;font-size:9px;">
            Miktar<br/><span style="font-weight:400;opacity:0.85;">Qty</span>
          </th>
          <th style="padding:9px 10px;text-align:right;font-weight:600;font-size:9px;">
            Birim Fiyat<br/><span style="font-weight:400;opacity:0.85;">Unit Price</span>
          </th>
          <th style="padding:9px 10px;text-align:right;font-weight:600;font-size:9px;border-radius:0 6px 0 0;">
            Toplam<br/><span style="font-weight:400;opacity:0.85;">Total</span>
          </th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>

    ${separateToolsBlock}

    <!-- TOPLAM -->
    <div style="margin-top:14px;display:flex;justify-content:flex-end;">
      <table style="width:60%;border-collapse:collapse;">
        <tbody>
          ${totalRow}
        </tbody>
      </table>
    </div>
  </div>

  ${quote.notes ? `
    <div style="margin-top:18px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
      <div style="font-size:9px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Notlar / Notes</div>
      <div style="font-size:10px;color:#1c1917;line-height:1.5;white-space:pre-wrap;">${esc(quote.notes)}</div>
    </div>
  ` : ""}

  <!-- ŞARTLAR -->
  <div style="margin-top:20px;padding:12px 14px;background:#f9fafb;border-radius:6px;border-left:3px solid #1e40af;">
    <div style="font-size:9px;color:#78716c;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Genel Şartlar / Terms & Conditions</div>
    <ul style="margin:0;padding-left:16px;font-size:9px;color:#57534e;line-height:1.6;">
      <li>Fiyatlarımız KDV hariç ${quote.currency || "TL"} cinsindendir. / Prices are exclusive of VAT.</li>
      <li>Teklifimizin geçerlilik süresi teklif tarihinden itibaren 15 gündür. / Quote valid for 15 days.</li>
      <li>Termin süresi sipariş onayı ile başlar. / Lead time starts upon order confirmation.</li>
      ${quote.currency !== "TL" ? `<li>Döviz kuru sipariş anındaki TCMB satış kuru üzerinden hesaplanır. / Exchange rate at TCMB selling rate on order date.</li>` : ""}
    </ul>
  </div>

  <!-- FOOTER -->
  <div style="position:absolute;bottom:20px;left:44px;right:44px;padding-top:8px;border-top:1px solid #e7e5e4;font-size:8px;color:#a8a29e;display:flex;justify-content:space-between;">
    <span>DENMA Mühendislik · Teklif No: ${esc(quote.quoteNo || "")}</span>
    <span>${new Date().toLocaleDateString("tr-TR")} · Sayfa 1</span>
  </div>
</div>
  `;
}

async function renderQuotePdf(quote, calc) {
  const html = buildQuoteHtml(quote, calc);
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const root = container.querySelector("#quote-pdf-root");
    // Logo yüklenmesini bekle
    const imgs = root.querySelectorAll("img");
    await Promise.all([...imgs].map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }));
    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const imgW = 210;
    const imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, imgW, Math.min(imgH, 297));
    return pdf;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Teklif PDF indir.
 * quote: kaydedilen quote objesi
 * calc:  calculateQuoteTotal sonucu
 */
export async function generateQuotePdf(quote, calc) {
  const pdf = await renderQuotePdf(quote, calc);
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  const filename = `Teklif_${safe(quote.quoteNo)}_${safe(quote.customerName)}.pdf`;
  pdf.save(filename);
}

/**
 * PDF Blob döndürür — mail eki veya zip için.
 */
export async function buildQuotePdfBlob(quote, calc) {
  const pdf = await renderQuotePdf(quote, calc);
  return pdf.output("blob");
}
