// Yapılabilirlik PDF üretimi — A4 dikey, modern minimal.
// FR-71.1 (Proje) + FR-71.2 (Ürün) formlarını tek belge halinde çıkarır.
// jsPDF + html2canvas ile HTML → görüntü → PDF.

import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { LOGO_DENMA } from "../digerMusteriler/cocLogo";
import {
  EVALUATION_QUESTIONS, EVALUATION_DEPARTMENTS, WORK_TYPES, DECISIONS,
  RECEIVED_DATA_TYPES, ITEM_CATEGORIES,
} from "./schema";
import { FEASIBILITY_ROLES } from "./firestore";

const FORM_NO = "FR-71.1 Rev.Tar./No: 11.12.2025 / 01";

function fmtNum(n, decimals = 2) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildFeasibilityHtml(study) {
  const decision = DECISIONS.find(d => d.key === study.decision);
  const workType = WORK_TYPES.find(t => t.key === study.workType);
  const recv = study.receivedData || {};
  const recvSelected = RECEIVED_DATA_TYPES.filter(t => recv[t.key]);
  const evalMap = study.evaluation || {};
  const signatures = study.signatures || {};

  // Kalem toplamları
  const toolingItems = study.toolingItems || [];
  const fasonItems = study.fasonItems || [];
  const toolingTotal = toolingItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);
  const fasonTotal = fasonItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);

  const opsDetails = study.operations?.details || [];
  const opCount = opsDetails.length > 0 ? opsDetails.length : (Number(study.operations?.count) || 0);
  const opMin = opsDetails.length > 0
    ? opsDetails.reduce((s, d) => s + (Number(d.minutes) || 0), 0)
    : (Number(study.operations?.totalMinutes) || 0);

  // Değerlendirme — departman bazlı grupla
  const questionsByDept = {};
  for (const q of EVALUATION_QUESTIONS) {
    if (!questionsByDept[q.dept]) questionsByDept[q.dept] = [];
    questionsByDept[q.dept].push(q);
  }

  return `
<div id="feas-pdf-root" style="width:794px; padding:40px 50px; background:#fff; font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif; color:#1c1917; box-sizing:border-box;">
  <!-- HEADER -->
  <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:14px; border-bottom:2px solid #1e40af;">
    <img src="${LOGO_DENMA}" style="height:52px; width:auto; object-fit:contain;" alt="DENMA" />
    <div style="text-align:right;">
      <div style="font-size:16px; font-weight:700; color:#1e40af; letter-spacing:0.5px;">YAPILABİLİRLİK FORMU</div>
      <div style="font-size:9px; color:#78716c;">FEASIBILITY STUDY</div>
    </div>
  </div>

  <!-- KAPAK — YAPILABILIRLIK NO + META -->
  <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:12px; margin-top:16px;">
    <div style="padding:10px 12px; background:#eff6ff; border-radius:6px; border:1px solid #bfdbfe;">
      <div style="font-size:8px; color:#78716c; text-transform:uppercase; letter-spacing:0.5px;">Yapılabilirlik No / Study No</div>
      <div style="font-size:14px; font-weight:800; color:#1e40af; font-family:'JetBrains Mono','Courier New',monospace; letter-spacing:1px;">
        ${esc(study.studyNo || "—")}
      </div>
    </div>
    <div style="padding:10px 12px; background:#f9fafb; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:8px; color:#78716c; text-transform:uppercase; letter-spacing:0.5px;">Tarih / Date</div>
      <div style="font-size:12px; font-weight:700; color:#1c1917; margin-top:2px;">${fmtDate(study.createdAt || study.updatedAt)}</div>
    </div>
    <div style="padding:10px 12px; background:${decision ? decision.bg : "#f9fafb"}; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:8px; color:#78716c; text-transform:uppercase; letter-spacing:0.5px;">Karar / Decision</div>
      <div style="font-size:11px; font-weight:700; color:${decision ? decision.color : "#78716c"}; margin-top:2px;">${decision ? decision.label : "—"}</div>
    </div>
  </div>

  <!-- MÜŞTERİ + PARÇA -->
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px;">
    <div style="padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:8px; color:#78716c; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Müşteri / Customer</div>
      <div style="font-size:12px; font-weight:700; color:#1e40af; margin-top:3px;">${esc(study.customerName || "—")}</div>
      ${study.customerCode ? `<div style="font-size:9px; color:#57534e; margin-top:2px;">Kod: ${esc(study.customerCode)}</div>` : ""}
      ${study.customerContact ? `<div style="font-size:9px; color:#57534e;">Tel: ${esc(study.customerContact)}</div>` : ""}
      ${study.customerEmail ? `<div style="font-size:9px; color:#57534e;">E-mail: ${esc(study.customerEmail)}</div>` : ""}
      ${study.customerQuoteNo ? `<div style="font-size:9px; color:#57534e;">Müş.Teklif: ${esc(study.customerQuoteNo)}</div>` : ""}
    </div>
    <div style="padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:8px; color:#78716c; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Parça / Part</div>
      <div style="font-size:12px; font-weight:700; color:#1c1917; margin-top:3px;">${esc(study.partName || "—")}</div>
      ${study.partNo ? `<div style="font-size:9px; color:#57534e; font-family:'JetBrains Mono','Courier New',monospace; margin-top:2px;">${esc(study.partNo)}</div>` : ""}
      ${study.musteriKodu ? `<div style="font-size:9px; color:#57534e;">Müş.Kodu: ${esc(study.musteriKodu)}</div>` : ""}
      ${workType ? `<div style="font-size:9px; color:#57534e; margin-top:2px;">İş Türü: <b>${esc(workType.label)}</b></div>` : ""}
      ${recvSelected.length > 0 ? `<div style="font-size:9px; color:#57534e; margin-top:2px;">Gelen Veri: ${recvSelected.map(r => esc(r.label)).join(", ")}</div>` : ""}
    </div>
  </div>

  <!-- HAMMADDE -->
  ${(study.materialType || study.materialShape || study.dimensions?.en || study.weightKg) ? `
    <div style="margin-top:12px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">🧱 HAMMADDE / RAW MATERIAL</div>
      <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr; gap:8px; font-size:10px;">
        <div><div style="color:#78716c; font-size:8px;">Malzeme</div><div style="font-weight:600;">${esc(study.materialType || "—")}</div></div>
        <div><div style="color:#78716c; font-size:8px;">Şekil</div><div>${esc(study.materialShape || "—")}</div></div>
        <div><div style="color:#78716c; font-size:8px;">EN</div><div>${fmtNum(study.dimensions?.en, 1)} mm</div></div>
        <div><div style="color:#78716c; font-size:8px;">BOY</div><div>${fmtNum(study.dimensions?.boy, 1)} mm</div></div>
        <div><div style="color:#78716c; font-size:8px;">UZUNLUK</div><div>${fmtNum(study.dimensions?.uzunluk, 1)} mm</div></div>
        <div><div style="color:#78716c; font-size:8px;">Ağırlık</div><div style="font-weight:600;">${fmtNum(study.weightKg, 3)} kg</div></div>
      </div>
      ${study.quantity ? `<div style="margin-top:6px; font-size:9px; color:#57534e;">Sipariş Miktarı: <b>${study.quantity}</b> adet · ${study.otherMaterials ? `Yardımcı: ${esc(study.otherMaterials)}` : ""}</div>` : ""}
    </div>` : ""}

  <!-- OPERASYONLAR -->
  ${opCount > 0 ? `
    <div style="margin-top:12px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div style="font-size:9px; color:#78716c; font-weight:600;">⚙️ OPERASYONLAR / OPERATIONS</div>
        <div style="font-size:10px; color:#1c1917;"><b>${opCount}</b> operasyon · Toplam: <b>${fmtNum(opMin, 1)}</b> dk (${fmtNum(opMin / 60, 2)} sa)</div>
      </div>
      ${opsDetails.length > 0 ? `
        <table style="width:100%; border-collapse:collapse; font-size:9px;">
          <thead>
            <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
              <th style="padding:4px 6px; font-weight:600; font-size:8px; width:25px; text-align:center;">#</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">Operasyon</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">Makine</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px; text-align:right; width:70px;">Süre (dk)</th>
            </tr>
          </thead>
          <tbody>
            ${opsDetails.map((d, i) => `
              <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                <td style="padding:4px 6px; text-align:center; color:#78716c;">${i + 1}</td>
                <td style="padding:4px 6px;">${esc(d.operationName || "—")}</td>
                <td style="padding:4px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(d.machine || "—")}</td>
                <td style="padding:4px 6px; text-align:right; font-weight:600;">${fmtNum(d.minutes, 1)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>` : ""}
      ${study.operations?.note ? `<div style="margin-top:6px; font-size:9px; color:#78716c; font-style:italic;">Not: ${esc(study.operations.note)}</div>` : ""}
    </div>` : ""}

  <!-- KALEM DETAYI: TOOLING + FASON -->
  ${ITEM_CATEGORIES.map(cat => {
    const items = cat.key === "tooling" ? toolingItems : fasonItems;
    const total = cat.key === "tooling" ? toolingTotal : fasonTotal;
    if (items.length === 0) return "";
    return `
      <div style="margin-top:12px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size:9px; color:#78716c; font-weight:600;">${cat.icon} ${esc(cat.label).toUpperCase()}</div>
          <div style="font-size:10px; color:#1c1917;"><b>${items.length}</b> kalem · Toplam: <b style="color:#166534;">${fmtNum(total)} TL</b></div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:9px;">
          <thead>
            <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">Ad</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">Açıklama</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px; width:40px; text-align:right;">Adet</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px; width:70px; text-align:right;">Birim TL</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px; width:80px; text-align:right;">Tutar TL</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">Tedarikçi</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px; width:50px; text-align:right;">Termin</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => {
              const line = (Number(it.qty) || 0) * (Number(it.unitCost) || 0);
              return `
                <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                  <td style="padding:4px 6px; font-weight:500;">${esc(it.name || "—")}</td>
                  <td style="padding:4px 6px; color:#57534e;">${esc(it.description || "")}</td>
                  <td style="padding:4px 6px; text-align:right;">${it.qty || 0}</td>
                  <td style="padding:4px 6px; text-align:right;">${fmtNum(it.unitCost)}</td>
                  <td style="padding:4px 6px; text-align:right; font-weight:600; color:#166534;">${fmtNum(line)}</td>
                  <td style="padding:4px 6px; color:#57534e;">${esc(it.supplier || "—")}</td>
                  <td style="padding:4px 6px; text-align:right; color:#57534e;">${it.deliveryDays ? `${it.deliveryDays}g` : "—"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
          <tfoot>
            <tr style="background:#f9fafb; border-top:2px solid #e7e5e4;">
              <td colspan="4" style="padding:5px 6px; text-align:right; font-weight:600; color:#57534e; font-size:9px;">Toplam:</td>
              <td style="padding:5px 6px; text-align:right; font-weight:700; color:#166534; font-size:10px;">${fmtNum(total)} TL</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }).join("")}

  <!-- İSTERLER -->
  ${(study.demands || []).length > 0 ? `
    <div style="margin-top:12px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">📋 MÜŞTERİ İSTERLERİ / CUSTOMER DEMANDS</div>
      <table style="width:100%; border-collapse:collapse; font-size:9px;">
        <thead>
          <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">İster</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Detay</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Denma Öngörüsü</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Müşteri Öngörüsü</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Açıklama</th>
          </tr>
        </thead>
        <tbody>
          ${(study.demands || []).map(d => `
            <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
              <td style="padding:4px 6px;">${esc(d.demand || "")}</td>
              <td style="padding:4px 6px;">${esc(d.demandDetail || "")}</td>
              <td style="padding:4px 6px;">${esc(d.denmaAssessment || "")}</td>
              <td style="padding:4px 6px;">${esc(d.customerAssessment || "")}</td>
              <td style="padding:4px 6px;">${esc(d.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>` : ""}

  <!-- DEĞERLENDİRME — Departman gruplu -->
  <div style="margin-top:12px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">✅ YAPILABİLİRLİK DEĞERLENDİRMESİ / FEASIBILITY EVALUATION</div>
    ${EVALUATION_DEPARTMENTS.map(dept => {
      const qs = questionsByDept[dept.key] || [];
      if (qs.length === 0) return "";
      return `
        <div style="margin-bottom:10px;">
          <div style="font-size:9px; font-weight:600; color:${dept.color}; padding:3px 6px; background:${dept.bg}; border-radius:3px; margin-bottom:4px; display:inline-block;">
            ${dept.icon} ${esc(dept.label)}
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:9px;">
            <tbody>
              ${qs.map(q => {
                const v = evalMap[q.key] || {};
                const yesChecked = v.answer === "yes";
                const noChecked = v.answer === "no";
                return `
                  <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                    <td style="padding:4px 6px;">${esc(q.label)}</td>
                    <td style="padding:4px 6px; text-align:center; width:60px;">
                      <span style="display:inline-block; padding:1px 8px; border-radius:2px; font-weight:600; font-size:8px;
                        background:${yesChecked ? "#dcfce7" : "#f5f5f4"}; color:${yesChecked ? "#166534" : "#a8a29e"};">
                        ${yesChecked ? "✓ EVET" : "EVET"}
                      </span>
                    </td>
                    <td style="padding:4px 6px; text-align:center; width:60px;">
                      <span style="display:inline-block; padding:1px 8px; border-radius:2px; font-weight:600; font-size:8px;
                        background:${noChecked ? "#fee2e2" : "#f5f5f4"}; color:${noChecked ? "#991b1b" : "#a8a29e"};">
                        ${noChecked ? "✓ HAYIR" : "HAYIR"}
                      </span>
                    </td>
                    <td style="padding:4px 6px; color:#57534e; font-style:italic;">${esc(v.note || "")}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `;
    }).join("")}
  </div>

  <!-- KARAR + ÖNERİLER -->
  ${(decision || study.recommendations) ? `
    <div style="margin-top:12px; padding:12px 14px; background:${decision ? decision.bg : "#fafaf9"}; border-radius:6px; border:1px solid ${decision ? decision.color : "#e7e5e4"};">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">🎯 ALINAN KARAR / FINAL DECISION</div>
      ${decision ? `<div style="font-size:14px; font-weight:700; color:${decision.color}; margin-bottom:6px;">${esc(decision.label)}</div>` : ""}
      ${study.recommendations ? `<div style="font-size:10px; color:#1c1917; line-height:1.5;">${esc(study.recommendations)}</div>` : ""}
    </div>` : ""}

  <!-- İMZALAR -->
  <div style="margin-top:16px;">
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">✍️ YAPILABİLİRLİK EKİBİ İMZALARI / SIGNATURES</div>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
      ${FEASIBILITY_ROLES.map(r => {
        const sig = signatures[r.key];
        const bg = sig ? "#f0fdf4" : "#fafaf9";
        const bc = sig ? "#86efac" : "#e7e5e4";
        return `
          <div style="padding:8px 10px; background:${bg}; border-radius:4px; border:1px solid ${bc};">
            <div style="font-size:8px; color:#44403c; font-weight:600; text-transform:uppercase; letter-spacing:0.3px;">${esc(r.label)}</div>
            ${sig ? `
              <div style="font-size:9px; color:#166534; font-weight:600; margin-top:3px;">✓ İmzalandı</div>
              <div style="font-size:8px; color:#57534e; margin-top:2px;">${fmtDate(sig.signedAt)}</div>
              ${sig.isDelegate ? `<div style="font-size:7px; color:#d97706;">(${esc(sig.actualRole)} yerine)</div>` : ""}
            ` : `<div style="font-size:8px; color:#a8a29e; margin-top:3px;">—</div>`}
          </div>
        `;
      }).join("")}
    </div>
  </div>

  <!-- FOOTER -->
  <div style="margin-top:20px; padding-top:8px; border-top:1px solid #e7e5e4; font-size:8px; color:#a8a29e; display:flex; justify-content:space-between;">
    <span>DENMA Mühendislik · ${esc(study.studyNo || "")} · Üretim: ${new Date().toLocaleDateString("tr-TR")}</span>
    <span style="font-family:'JetBrains Mono','Courier New',monospace;">${FORM_NO}</span>
  </div>
</div>
  `;
}

async function renderFeasibilityPdf(study) {
  const html = buildFeasibilityHtml(study);
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const root = container.querySelector("#feas-pdf-root");
    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();   // 210
    const pdfHeight = pdf.internal.pageSize.getHeight(); // 297
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // İçerik tek A4'e sığıyorsa direkt bas
    const imgHeightMm = (canvasHeight * pdfWidth) / canvasWidth;
    if (imgHeightMm <= pdfHeight) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfWidth, imgHeightMm);
      return pdf;
    }

    // Taşma var — sayfa sayfa dilimle. 2+ sayfada üstte kompakt "devam" şeridi çıkar.
    const pxPerMm = canvasWidth / pdfWidth;
    const CONTINUATION_STRIP_MM = 12;
    const firstPageContentPx = pdfHeight * pxPerMm;
    const continuationContentPx = (pdfHeight - CONTINUATION_STRIP_MM) * pxPerMm;

    // Sayfa dilimlerini hesapla
    const slices = [];
    let offset = 0;
    let pageIdx = 0;
    while (offset < canvasHeight) {
      const isFirst = pageIdx === 0;
      const contentPx = isFirst ? firstPageContentPx : continuationContentPx;
      const sliceHeight = Math.min(contentPx, canvasHeight - offset);
      slices.push({ offset, height: sliceHeight, isContinuation: !isFirst });
      offset += sliceHeight;
      pageIdx++;
    }
    const totalPages = slices.length;

    for (let i = 0; i < totalPages; i++) {
      const p = slices[i];
      if (i > 0) pdf.addPage();

      let yPosMm = 0;
      if (p.isContinuation) {
        const headerImg = await renderContinuationStrip(study, i + 1, totalPages, pdfWidth);
        pdf.addImage(headerImg.dataUrl, "JPEG", 0, 0, pdfWidth, headerImg.heightMm);
        yPosMm = headerImg.heightMm;
      }

      // Canvas slice (ana canvas'tan ilgili dilimi kopyala)
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvasWidth;
      sliceCanvas.height = p.height;
      sliceCanvas.getContext("2d").drawImage(canvas, 0, p.offset, canvasWidth, p.height, 0, 0, canvasWidth, p.height);
      const sliceHeightMm = p.height / pxPerMm;
      pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, yPosMm, pdfWidth, sliceHeightMm);
    }

    return pdf;
  } finally {
    document.body.removeChild(container);
  }
}

// Devam sayfalarının üstünde çıkan kompakt şerit — studyNo · müşteri · sayfa n/N
async function renderContinuationStrip(study, pageNo, totalPages, pdfWidthMm) {
  const html = `
    <div style="width:794px; padding:8px 22px; background:#f0fdf4; border-bottom:2px solid #86efac;
      display:flex; align-items:center; gap:14px;
      font-family:'Inter','Segoe UI',sans-serif; box-sizing:border-box;">
      <span style="font-size:11px; font-weight:700; color:#166534;">🔬 Yapılabilirlik</span>
      <span style="font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700; color:#1c1917;">${esc(study.studyNo || "")}</span>
      <span style="color:#a8a29e;">·</span>
      <span style="font-size:10px; color:#44403c;">${esc(study.customerName || "")}</span>
      <span style="color:#a8a29e; margin-left:auto;">·</span>
      <span style="font-size:10px; color:#78716c;">Sayfa ${pageNo} / ${totalPages}</span>
    </div>
  `;
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container.firstElementChild, { scale: 2, backgroundColor: "#ffffff" });
    const heightMm = (canvas.height * pdfWidthMm) / canvas.width;
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), heightMm };
  } finally {
    document.body.removeChild(container);
  }
}

export async function generateFeasibilityPdf(study) {
  const pdf = await renderFeasibilityPdf(study);
  const safeName = String(study?.customerName || "").replace(/[^\w.\-]/g, "_").substring(0, 30);
  pdf.save(`Yapilabilirlik_${study?.studyNo || "NEW"}_${safeName}.pdf`);
}

export async function buildFeasibilityPdfBlob(study) {
  const pdf = await renderFeasibilityPdf(study);
  return pdf.output("blob");
}
