// FAI PDF üretimi — SAE AS9102 3 sayfa (Form 1 / Form 2 / Form 3).
// A4 dikey, modern minimal (COC/Yapılabilirlik PDF ile aynı stil).
// jsPDF + html2canvas ile HTML → görüntü → PDF.

import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { LOGO_DENMA } from "../cocLogo";
import { SIGNATURE_SERDAL, SIGNATURE_OMER } from "../cocSignatures";

// COC modülündeki imza rol etiketleri — burada da tekrar tanımlıyoruz
const SIGNATURES = { engineer: "Serdal Büyükduymaz", manager: "Ömer Yasin Akbuğa" };
import {
  DETAIL_OR_ASSEMBLY_OPTIONS, FAI_TYPE_OPTIONS, CUSTOMER_APPROVAL_OPTIONS,
  CHARACTERISTIC_TYPES, FAI_STATUSES,
} from "./schema";

const FORM_NO = "FR-57 Rev.Tar./No: 24.04.2026 / 01";

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

// Renk sistemleri — talimatta belirtildiği gibi
const yellowCell = "background:#fef3c7;";  // zorunlu
const blueCell = "background:#dbeafe;";    // şarta bağlı
const whiteCell = "background:#fff;";      // opsiyonel

// Tek bir kutu (label + değer)
function fieldBox(label, value, colorStyle = whiteCell, monospace = false) {
  return `
    <div style="border:1px solid #d6d3d1; padding:4px 6px; ${colorStyle}">
      <div style="font-size:7px; color:#57534e; font-weight:600; text-transform:uppercase; letter-spacing:0.3px;">${esc(label)}</div>
      <div style="font-size:10px; color:#1c1917; font-weight:500; margin-top:2px; min-height:12px; ${monospace ? "font-family:'JetBrains Mono','Courier New',monospace;" : ""}">${esc(value) || "&nbsp;"}</div>
    </div>
  `;
}

// Ortak sayfa header (her formda üstte)
function pageHeader(faiNo, formTitle, pageNum, totalPages) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:2px solid #1e40af; margin-bottom:10px;">
      <img src="${LOGO_DENMA}" style="height:36px; width:auto; object-fit:contain;" alt="DENMA" />
      <div style="text-align:center; flex:1;">
        <div style="font-size:12px; font-weight:700; color:#1e40af; letter-spacing:0.5px;">İLK ÜRÜN DENETİM FORMU (FAI)</div>
        <div style="font-size:8px; color:#78716c; margin-top:2px;">SAE AS 9102 — ${esc(formTitle)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:8px; color:#78716c;">FAI No</div>
        <div style="font-size:11px; font-weight:700; color:#1e40af; font-family:'JetBrains Mono','Courier New',monospace;">${esc(faiNo)}</div>
        <div style="font-size:7px; color:#a8a29e; margin-top:2px;">Sayfa ${pageNum}/${totalPages}</div>
      </div>
    </div>
  `;
}

// Ortak footer (FR-57 kodu)
function pageFooter() {
  return `
    <div style="margin-top:12px; padding-top:6px; border-top:1px solid #e7e5e4; font-size:7px; color:#a8a29e; display:flex; justify-content:space-between;">
      <span>DENMA Mühendislik · Üretim: ${new Date().toLocaleDateString("tr-TR")}</span>
      <span style="font-family:'JetBrains Mono','Courier New',monospace;">${FORM_NO}</span>
    </div>
  `;
}

// ============================================================
// FORM 1 HTML
// ============================================================
function form1Html(record) {
  const detailOrAssembly = DETAIL_OR_ASSEMBLY_OPTIONS.find(o => o.key === record.detailOrAssembly);
  const faiType = FAI_TYPE_OPTIONS.find(o => o.key === record.faiType);
  const sigs = record.signatures || {};
  const preparedBy = sigs.preparedBy;
  const reviewedBy = sigs.reviewedBy;
  const customerApproved = sigs.customerApprovedBy;

  return `
    ${pageHeader(record.faiNo, "Form 1 — Parça Numarası Nitelikleri", 1, 3)}

    <!-- Ana bilgiler (1-4) -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px; margin-bottom:6px;">
      ${fieldBox("1. Parça No", record.partNumber, yellowCell, true)}
      ${fieldBox("2. Parça Tanımı", record.partName, yellowCell)}
      ${fieldBox("3. Seri No", record.serialNumber, blueCell)}
      ${fieldBox("4. FAI Rapor No", record.fairNumber || record.faiNo, yellowCell, true)}
    </div>

    <!-- Doküman bilgileri (5-8) -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px; margin-bottom:6px;">
      ${fieldBox("5. Parça Revizyonu", record.partRevision, blueCell)}
      ${fieldBox("6. Çizim/Doküman No", record.drawingNumber, blueCell, true)}
      ${fieldBox("7. Çizim Revizyonu", record.drawingRevision, blueCell)}
      ${fieldBox("8. Ek Değişiklikler", record.additionalChanges, blueCell)}
    </div>

    <!-- İş & tedarikçi (9-12) -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px; margin-bottom:6px;">
      ${fieldBox("9. Üretim İş Emri No", record.manufacturingOrderNo, yellowCell, true)}
      ${fieldBox("10. Firma Adı", record.organizationName, yellowCell)}
      ${fieldBox("11. Tedarikçi Kodu", record.supplierCode, whiteCell)}
      ${fieldBox("12. Müşteri Sipariş No", record.customerPoNumber, whiteCell)}
    </div>

    <!-- FAI türü (13-14) -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:6px;">
      ${fieldBox("13. Alt Parça / Takım", detailOrAssembly?.label || record.detailOrAssembly, yellowCell)}
      ${fieldBox("14. Tam / Kısmi FAI", faiType?.label || record.faiType, yellowCell)}
    </div>

    <!-- Kısmi FAI notu -->
    ${record.faiType === "partial" ? `
      <div style="padding:6px 8px; background:#fef3c7; border:1px solid #fde68a; border-radius:3px; margin-bottom:6px; font-size:9px;">
        <div><b>Önceki FAI No:</b> <span style="font-family:'JetBrains Mono','Courier New',monospace;">${esc(record.previousFairNumber)}</span></div>
        <div style="margin-top:2px;"><b>Kısmi FAI Gerekçesi:</b> ${esc(record.partialFaiReason)}</div>
      </div>` : ""}

    <!-- Alt bileşen listesi (15-18) — sadece Takım/Assembly -->
    ${record.detailOrAssembly === "assembly" && (record.subComponents || []).length > 0 ? `
      <div style="margin-top:8px;">
        <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:4px;">Montaj Parçası için Alt Bileşenler (15-18)</div>
        <table style="width:100%; border-collapse:collapse; font-size:9px;">
          <thead>
            <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">15. Parça No</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">16. Parça Tanımı</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">17. Seri No</th>
              <th style="padding:4px 6px; font-weight:600; font-size:8px;">18. FAI Rapor No</th>
            </tr>
          </thead>
          <tbody>
            ${(record.subComponents || []).map(s => `
              <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                <td style="padding:3px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(s.partNumber)}</td>
                <td style="padding:3px 6px;">${esc(s.partName)}</td>
                <td style="padding:3px 6px;">${esc(s.serialNumber) || "—"}</td>
                <td style="padding:3px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(s.fairNumber) || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : ""}

    <!-- İmzalar (19-24) -->
    <div style="margin-top:16px;">
      <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:6px;">İmzalar</div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">
        <!-- Hazırlayan -->
        <div style="border:1px solid #d6d3d1; padding:6px 8px; background:${preparedBy ? "#f0fdf4" : "#fafaf9"};">
          <div style="font-size:8px; color:#57534e; font-weight:600;">19-20. HAZIRLAYAN</div>
          ${preparedBy ? `
            <div style="height:40px; display:flex; align-items:center; justify-content:center;">
              <img src="${SIGNATURE_SERDAL}" style="max-height:36px; max-width:120px; object-fit:contain;" alt="imza" />
            </div>
            <div style="font-size:9px; font-weight:600; color:#166534;">${esc(preparedBy.signedRoleLabel || SIGNATURES.engineer)}</div>
            <div style="font-size:8px; color:#78716c;">${fmtDate(preparedBy.signedAt)}</div>
          ` : `<div style="height:60px; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:9px;">—</div>`}
        </div>
        <!-- Onaylayan -->
        <div style="border:1px solid #d6d3d1; padding:6px 8px; background:${reviewedBy ? "#f0fdf4" : "#fafaf9"};">
          <div style="font-size:8px; color:#57534e; font-weight:600;">21-22. ONAYLAYAN</div>
          ${reviewedBy ? `
            <div style="height:40px; display:flex; align-items:center; justify-content:center;">
              <img src="${SIGNATURE_OMER}" style="max-height:36px; max-width:120px; object-fit:contain;" alt="imza" />
            </div>
            <div style="font-size:9px; font-weight:600; color:#166534;">${esc(reviewedBy.signedRoleLabel || SIGNATURES.manager)}</div>
            <div style="font-size:8px; color:#78716c;">${fmtDate(reviewedBy.signedAt)}</div>
          ` : `<div style="height:60px; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:9px;">—</div>`}
        </div>
        <!-- Müşteri Onayı -->
        <div style="border:1px solid #d6d3d1; padding:6px 8px; background:${customerApproved ? "#f0fdf4" : "#fafaf9"};">
          <div style="font-size:8px; color:#57534e; font-weight:600;">23-24. MÜŞTERİ ONAYI</div>
          ${customerApproved ? `
            <div style="font-size:9px; font-weight:600; color:#166534; margin-top:8px;">✓ Onaylandı</div>
            <div style="font-size:8px; color:#78716c;">${fmtDate(customerApproved.signedAt)}</div>
            ${record.customerApprovalNote ? `<div style="font-size:8px; font-style:italic; color:#57534e; margin-top:2px;">${esc(record.customerApprovalNote)}</div>` : ""}
          ` : `<div style="height:60px; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:9px;">Bekleniyor</div>`}
        </div>
      </div>
    </div>

    ${pageFooter()}
  `;
}

// ============================================================
// FORM 2 HTML
// ============================================================
function form2Html(record) {
  const mp = record.materialsAndProcesses || [];
  const ft = record.functionalTests || [];
  const sig = record.signatures?.preparedBy;

  return `
    ${pageHeader(record.faiNo, "Form 2 — Hammadde, Özel İşlem, Fonksiyonel Test", 2, 3)}

    <!-- 1-4 ortak alanlar -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px; margin-bottom:8px;">
      ${fieldBox("1. Parça No", record.partNumber, yellowCell, true)}
      ${fieldBox("2. Parça Tanımı", record.partName, yellowCell)}
      ${fieldBox("3. Seri No", record.serialNumber, blueCell)}
      ${fieldBox("4. FAI Rapor No", record.fairNumber || record.faiNo, yellowCell, true)}
    </div>

    <!-- Hammadde/Proses tablosu -->
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:4px;">Hammadde ve Özel İşlem(ler) — Uygunluk Sertifikaları</div>
    ${mp.length > 0 ? `
      <table style="width:100%; border-collapse:collapse; font-size:9px; margin-bottom:10px;">
        <thead>
          <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">5. Malzeme/Süreç</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">6. Spesifikasyon</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px; width:60px;">7. Kod</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">8. Tedarikçi</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px; width:70px;">9. Müş Onayı</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">10. Belge No</th>
          </tr>
        </thead>
        <tbody>
          ${mp.map(m => {
            const custApproval = CUSTOMER_APPROVAL_OPTIONS.find(o => o.key === m.customerApprovalVerification);
            return `
              <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                <td style="padding:4px 6px;">${esc(m.materialOrProcessName)}</td>
                <td style="padding:4px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(m.specificationNumber)}</td>
                <td style="padding:4px 6px;">${esc(m.code)}</td>
                <td style="padding:4px 6px;">${esc(m.supplier)}</td>
                <td style="padding:4px 6px; text-align:center;">${custApproval?.label || "—"}</td>
                <td style="padding:4px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(m.certificateNumber)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    ` : `<div style="padding:16px; text-align:center; color:#a8a29e; font-size:10px; border:1px dashed #d6d3d1; margin-bottom:10px;">Bu forma girilen hammadde/işlem yok</div>`}

    <!-- Fonksiyonel testler -->
    <div style="font-size:9px; color:#78716c; font-weight:600; margin-bottom:4px;">Fonksiyonel Testler</div>
    ${ft.length > 0 ? `
      <table style="width:100%; border-collapse:collapse; font-size:9px; margin-bottom:10px;">
        <thead>
          <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">11. Prosedür No</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Rev/Tarih</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">12. Kabul Raporu No</th>
          </tr>
        </thead>
        <tbody>
          ${ft.map(t => `
            <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
              <td style="padding:4px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(t.procedureNumber)}</td>
              <td style="padding:4px 6px;">${esc(t.procedureRevision)}</td>
              <td style="padding:4px 6px; font-family:'JetBrains Mono','Courier New',monospace;">${esc(t.acceptanceReportNo)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : ""}

    <!-- Yorumlar -->
    ${record.form2Comments ? `
      <div style="padding:8px 10px; background:#fafaf9; border:1px solid #e7e5e4; border-radius:3px; margin-bottom:10px;">
        <div style="font-size:8px; color:#78716c; font-weight:600; margin-bottom:2px;">13. YORUMLAR</div>
        <div style="font-size:10px; color:#1c1917;">${esc(record.form2Comments)}</div>
      </div>` : ""}

    <!-- İmza -->
    <div style="margin-top:16px; display:grid; grid-template-columns:1fr 2fr; gap:8px;">
      <div style="border:1px solid #d6d3d1; padding:6px 8px; background:${sig ? "#f0fdf4" : "#fafaf9"};">
        <div style="font-size:8px; color:#57534e; font-weight:600;">14. İMZA</div>
        ${sig ? `
          <div style="height:40px; display:flex; align-items:center; justify-content:center;">
            <img src="${SIGNATURE_SERDAL}" style="max-height:36px; max-width:120px; object-fit:contain;" alt="imza" />
          </div>
          <div style="font-size:9px; font-weight:600; color:#166534;">${esc(sig.signedRoleLabel || SIGNATURES.engineer)}</div>
          <div style="font-size:8px; color:#78716c;">${fmtDate(sig.signedAt)}</div>
        ` : `<div style="height:60px; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:9px;">—</div>`}
      </div>
      <div></div>
    </div>

    ${pageFooter()}
  `;
}

// ============================================================
// FORM 3 HTML
// ============================================================
function form3Html(record) {
  const chars = record.characteristics || [];
  const sig = record.signatures?.preparedBy;

  return `
    ${pageHeader(record.faiNo, "Form 3 — Karakteristik Nitelikler, Doğrulama", 3, 3)}

    <!-- 1-4 ortak alanlar -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px; margin-bottom:8px;">
      ${fieldBox("1. Parça No", record.partNumber, yellowCell, true)}
      ${fieldBox("2. Parça Tanımı", record.partName, yellowCell)}
      ${fieldBox("3. Seri No", record.serialNumber, blueCell)}
      ${fieldBox("4. FAI Rapor No", record.fairNumber || record.faiNo, yellowCell, true)}
    </div>

    <!-- Karakteristik tablosu -->
    ${chars.length > 0 ? `
      <table style="width:100%; border-collapse:collapse; font-size:8px; margin-bottom:10px;">
        <thead>
          <tr style="background:#e7e5e4; color:#44403c; text-align:left;">
            <th style="padding:4px 5px; font-weight:600; font-size:7px; width:25px; text-align:center;">5. #</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px; width:50px;">6. Ref</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px; width:60px;">7. Tür</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px;">8. Gereksinim</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px; width:35px; text-align:center;">N Yer</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px;">9. Sonuç</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px; width:60px;">10. Alet</th>
            <th style="padding:4px 5px; font-weight:600; font-size:7px; width:60px;">11. Uygunsuz</th>
          </tr>
        </thead>
        <tbody>
          ${chars.map(c => {
            const type = CHARACTERISTIC_TYPES.find(t => t.key === c.characteristicType);
            const hasNoncnf = !!(c.nonconformanceNumber && c.nonconformanceNumber.trim());
            return `
              <tr style="background:${hasNoncnf ? "#fef2f2" : "#fff"}; border-bottom:1px solid #f5f5f4;">
                <td style="padding:3px 5px; text-align:center; font-weight:600; color:#1e40af;">${esc(c.characteristicNo)}</td>
                <td style="padding:3px 5px;">${esc(c.referenceLocation)}</td>
                <td style="padding:3px 5px;">${type?.label || "—"}</td>
                <td style="padding:3px 5px;">${esc(c.requirement)}</td>
                <td style="padding:3px 5px; text-align:center;">${c.occurrenceCount || 1}</td>
                <td style="padding:3px 5px; font-weight:500;">${esc(c.results)}</td>
                <td style="padding:3px 5px;">${esc(c.specialToolId)}</td>
                <td style="padding:3px 5px; font-family:'JetBrains Mono','Courier New',monospace; color:${hasNoncnf ? "#991b1b" : "#78716c"};">${esc(c.nonconformanceNumber) || "—"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    ` : `<div style="padding:20px; text-align:center; color:#a8a29e; font-size:10px; border:1px dashed #d6d3d1; margin-bottom:10px;">Karakteristik ölçüm kaydı yok</div>`}

    <!-- Yorumlar -->
    ${record.form3Comments ? `
      <div style="padding:8px 10px; background:#fafaf9; border:1px solid #e7e5e4; border-radius:3px; margin-bottom:10px;">
        <div style="font-size:8px; color:#78716c; font-weight:600; margin-bottom:2px;">Yorumlar</div>
        <div style="font-size:10px; color:#1c1917;">${esc(record.form3Comments)}</div>
      </div>` : ""}

    <!-- Ek belgeler listesi (özet) -->
    ${(() => {
      const attach = record.attachments || {};
      const has = [];
      // Form 1
      if (Array.isArray(attach.productionDocs) && attach.productionDocs.length) has.push(`Üretim İş Emri (${attach.productionDocs.length})`);
      // Form 2
      if (Array.isArray(attach.materialCertificates) && attach.materialCertificates.length) has.push(`HM Sertifikası (${attach.materialCertificates.length})`);
      if (Array.isArray(attach.fasonCertificates) && attach.fasonCertificates.length) has.push(`Fason Sertifikası (${attach.fasonCertificates.length})`);
      // Form 3
      const madCount = (Array.isArray(attach.measurementAndDrawing) ? attach.measurementAndDrawing.length : 0)
        + (Array.isArray(attach.testReports) ? attach.testReports.length : 0)
        + (attach.balloonedDrawing ? 1 : 0);
      if (madCount > 0) has.push(`Ölçüm Raporu + Balonlu Resim (${madCount})`);
      if (Array.isArray(attach.nonconformanceDocs) && attach.nonconformanceDocs.length) has.push(`Uygunsuzluk Belgesi (${attach.nonconformanceDocs.length})`);
      if (attach.customerApprovalLetter) has.push("Müşteri Onay Yazısı");
      if (Array.isArray(attach.other) && attach.other.length) has.push(`Diğer (${attach.other.length})`);
      return has.length > 0 ? `
        <div style="padding:8px 10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:3px; margin-bottom:10px; font-size:9px; color:#1e40af;">
          📎 <b>Ek Belgeler:</b> ${has.join(" · ")}
        </div>
      ` : "";
    })()}

    <!-- İmza -->
    <div style="margin-top:16px; display:grid; grid-template-columns:1fr 2fr; gap:8px;">
      <div style="border:1px solid #d6d3d1; padding:6px 8px; background:${sig ? "#f0fdf4" : "#fafaf9"};">
        <div style="font-size:8px; color:#57534e; font-weight:600;">12. İMZA</div>
        ${sig ? `
          <div style="height:40px; display:flex; align-items:center; justify-content:center;">
            <img src="${SIGNATURE_SERDAL}" style="max-height:36px; max-width:120px; object-fit:contain;" alt="imza" />
          </div>
          <div style="font-size:9px; font-weight:600; color:#166534;">${esc(sig.signedRoleLabel || SIGNATURES.engineer)}</div>
          <div style="font-size:8px; color:#78716c;">${fmtDate(sig.signedAt)}</div>
        ` : `<div style="height:60px; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:9px;">—</div>`}
      </div>
      <div></div>
    </div>

    ${pageFooter()}
  `;
}

// ============================================================
// Ana render — 3 sayfalık PDF
// ============================================================
async function renderFaiPdf(record) {
  const pdf = new jsPDF("p", "mm", "a4");
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const forms = [form1Html, form2Html, form3Html];
  for (let i = 0; i < forms.length; i++) {
    const html = `<div id="fai-pdf-root" style="width:794px; padding:20px 30px; background:#fff; font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif; color:#1c1917; box-sizing:border-box; min-height:1100px;">${forms[i](record)}</div>`;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const root = container.querySelector("#fai-pdf-root");
      const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      if (i > 0) pdf.addPage();
      if (imgHeight <= pdfHeight) {
        pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      } else {
        // sayfa boyunu aşarsa scale et
        const scale = pdfHeight / imgHeight;
        pdf.addImage(imgData, "PNG", 0, 0, imgWidth * scale, pdfHeight);
      }
    } finally {
      document.body.removeChild(container);
    }
  }
  return pdf;
}

export async function generateFaiPdf(record) {
  const pdf = await renderFaiPdf(record);
  const safeName = String(record?.partNumber || record?.partName || "").replace(/[^\w.\-]/g, "_").substring(0, 30);
  pdf.save(`FAI_${record?.faiNo || "NEW"}_${safeName}.pdf`);
}

export async function buildFaiPdfBlob(record) {
  const pdf = await renderFaiPdf(record);
  return pdf.output("blob");
}
