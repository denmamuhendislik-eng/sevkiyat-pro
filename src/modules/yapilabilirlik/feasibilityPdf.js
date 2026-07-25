// Yapılabilirlik PDF üretimi — A4 dikey, modern minimal.
// FR-71.1 (Proje) + FR-71.2 (Ürün) formlarını tek belge halinde çıkarır.
// jsPDF + html2canvas ile HTML → görüntü → PDF.

import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { LOGO_DENMA } from "../digerMusteriler/cocLogo";
import {
  EVALUATION_QUESTIONS, EVALUATION_DEPARTMENTS, WORK_TYPES, DECISIONS,
  RECEIVED_DATA_TYPES, ITEM_CATEGORIES,
  SALES_QUESTIONS, TECHNICAL_QUESTIONS,
  computeStudyScore, getRecommendation, getNegotiationHints, scoreForAnswer,
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

// Bir soru bölümü için puan tablosu (Satış / Teknik). PDF'te iki kez çağrılır.
function renderScoringSection(title, color, bg, questions, evalMap, sectionScore) {
  return `
    <div style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <div style="font-size:9px; font-weight:600; color:${color}; padding:3px 6px; background:${bg}; border-radius:3px; display:inline-block;">
          ${esc(title)}
        </div>
        <div style="font-size:9px; color:#44403c;">
          Toplam: <b>${sectionScore.score}/${sectionScore.max}</b> (${sectionScore.percent}%)
        </div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:9px;">
        <thead>
          <tr style="background:#f5f5f4; color:#44403c; text-align:left;">
            <th style="padding:4px 6px; font-weight:600; font-size:8px; width:22px; text-align:center;">#</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Soru</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px; width:60px; text-align:center;">Cevap</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px; width:55px; text-align:right;">Puan</th>
            <th style="padding:4px 6px; font-weight:600; font-size:8px;">Not</th>
          </tr>
        </thead>
        <tbody>
          ${questions.map((q, i) => {
            const v = evalMap[q.key] || {};
            const ans = v.answer;
            const points = scoreForAnswer(q, ans);
            const isEmpty = ans == null || ans === "";
            let ansDisplay = "—";
            let ansBg = "#f5f5f4", ansColor = "#a8a29e";
            if (!isEmpty) {
              if (q.type === "slider") { ansDisplay = String(ans); ansBg = "#dbeafe"; ansColor = "#1e40af"; }
              else {
                const key = String(ans).toUpperCase();
                if (key === "EVET") { ansDisplay = "EVET"; ansBg = "#dcfce7"; ansColor = "#166534"; }
                else if (key === "HAYIR") { ansDisplay = "HAYIR"; ansBg = "#fee2e2"; ansColor = "#991b1b"; }
                else if (key === "KISMEN") { ansDisplay = "KISMEN"; ansBg = "#fef3c7"; ansColor = "#92400e"; }
              }
            }
            return `
              <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                <td style="padding:4px 6px; text-align:center; color:#78716c;">${i + 1}</td>
                <td style="padding:4px 6px; white-space:pre-wrap;">${esc(q.label)}</td>
                <td style="padding:4px 6px; text-align:center;">
                  <span style="display:inline-block; padding:1px 6px; border-radius:2px; font-weight:600; font-size:8px; background:${ansBg}; color:${ansColor};">
                    ${esc(ansDisplay)}
                  </span>
                </td>
                <td style="padding:4px 6px; text-align:right; font-family:'JetBrains Mono','Courier New',monospace; font-weight:600; color:${isEmpty ? '#a8a29e' : '#1c1917'};">
                  ${isEmpty ? "—" : `${points}/${q.max}`}
                </td>
                <td style="padding:4px 6px; color:#57534e; font-style:italic;">${esc(v.note || "")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
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
  // Fason: parça başına × sipariş miktarı (kalem qty UI'dan kaldırıldı)
  const partQty = Number(study.quantity) || 1;
  const fasonTotal = fasonItems.reduce((s, it) => s + (Number(it.unitCost) || 0), 0) * partQty;

  const opsDetails = study.operations?.details || [];
  const opCount = opsDetails.length > 0 ? opsDetails.length : (Number(study.operations?.count) || 0);
  const opMin = opsDetails.length > 0
    ? opsDetails.reduce((s, d) => s + (Number(d.minutes) || 0), 0)
    : (Number(study.operations?.totalMinutes) || 0);

  // Puanlama + öneri
  const scoreInfo = computeStudyScore(study);
  const recommendation = getRecommendation(scoreInfo.percent);
  const negotiationHints = getNegotiationHints(study);

  return `
<div id="feas-pdf-root" style="width:794px; padding:22px 40px 40px; background:#fff; font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif; color:#1c1917; box-sizing:border-box;">
  <!-- HEADER -->
  <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:14px; border-bottom:2px solid #1e40af;">
    <img src="${LOGO_DENMA}" style="height:52px; width:auto; object-fit:contain;" alt="DENMA" />
    <div style="text-align:right;">
      <div style="font-size:16px; font-weight:700; color:#1e40af; letter-spacing:0.5px;">YAPILABİLİRLİK FORMU</div>
      <div style="font-size:9px; color:#78716c;">FEASIBILITY STUDY</div>
    </div>
  </div>

  <!-- KAPAK — YAPILABILIRLIK NO + META -->
  <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:12px; margin-top:10px;">
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
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
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
    <div style="margin-top:8px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
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
    <div style="margin-top:8px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
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
      <div style="margin-top:8px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
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
              // Fason: parça başına × sipariş miktarı. Tooling: kalem qty × birim.
              const effectiveQty = cat.key === "fason" ? partQty : (Number(it.qty) || 0);
              const line = effectiveQty * (Number(it.unitCost) || 0);
              return `
                <tr style="background:#fff; border-bottom:1px solid #f5f5f4;">
                  <td style="padding:4px 6px; font-weight:500;">${esc(it.name || "—")}</td>
                  <td style="padding:4px 6px; color:#57534e;">${esc(it.description || "")}</td>
                  <td style="padding:4px 6px; text-align:right;">${effectiveQty}</td>
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
    <div style="margin-top:8px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
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

  <!-- DEĞERLENDİRME — Puanlı, iki bölüm -->
  <div style="margin-top:8px; padding:10px 12px; background:#fafaf9; border-radius:6px; border:1px solid #e7e5e4;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <div style="font-size:9px; color:#78716c; font-weight:600;">✅ YAPILABİLİRLİK DEĞERLENDİRMESİ / FEASIBILITY SCORING</div>
      <div style="font-size:14px; font-weight:800; color:${recommendation.color};">
        ${scoreInfo.totalScore} / ${scoreInfo.totalMax}
        <span style="font-size:10px; color:#78716c; font-weight:500;">(${scoreInfo.percent}%)</span>
      </div>
    </div>

    <!-- Skor progress bar -->
    <div style="height:8px; background:#e7e5e4; border-radius:4px; overflow:hidden; margin-bottom:8px;">
      <div style="width:${scoreInfo.percent}%; height:100%; background:${recommendation.color};"></div>
    </div>

    <!-- Öneri kutucuğu -->
    <div style="padding:8px 10px; background:${recommendation.bg}; border-left:3px solid ${recommendation.color}; border-radius:3px; margin-bottom:10px;">
      <div style="font-size:10px; font-weight:700; color:${recommendation.color};">Sistem Önerisi: ${esc(recommendation.label)}</div>
      <div style="font-size:9px; color:#57534e; margin-top:2px;">${esc(recommendation.description)}</div>
      ${scoreInfo.percent < 50 ? `<div style="font-size:9px; color:#991b1b; margin-top:3px; font-weight:600;">⚠ Teklife dönüşüm için Genel Müdür imzası zorunlu.</div>` : ""}
    </div>

    <!-- Bölüm 1: Satış -->
    ${renderScoringSection("💼 Satış ve Proje", "#1e40af", "#eff6ff", SALES_QUESTIONS, evalMap, scoreInfo.sales)}

    <!-- Bölüm 2: Teknik -->
    ${renderScoringSection("⚙️ Teknik", "#0f766e", "#f0fdfa", TECHNICAL_QUESTIONS, evalMap, scoreInfo.technical)}
  </div>

  <!-- Müzakere ipuçları -->
  ${(negotiationHints.length > 0 && scoreInfo.percent < 75) ? `
    <div style="margin-top:10px; padding:10px 12px; background:#fef3c7; border:1px solid #fde68a; border-radius:6px;">
      <div style="font-size:9px; color:#92400e; font-weight:600; margin-bottom:4px;">
        💬 MÜZAKERE / İYİLEŞTİRME İPUÇLARI (${negotiationHints.length})
      </div>
      <ul style="margin:0; padding-left:16px; font-size:9px; color:#57534e; line-height:1.5;">
        ${negotiationHints.map(h => `<li><span style="color:#44403c;">${esc(h.hint)}</span> <span style="color:#a8a29e;">(puan ${h.score}/${h.max})</span></li>`).join("")}
      </ul>
    </div>
  ` : ""}

  <!-- KARAR + ÖNERİLER + İMZALAR (birleşik blok) -->
  <div style="margin-top:8px; padding:12px 14px; background:${decision ? decision.bg : "#fafaf9"}; border-radius:6px; border:1px solid ${decision ? decision.color : "#e7e5e4"};">
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
      <div style="font-size:9px; color:#78716c; font-weight:600;">🎯 ALINAN KARAR / FINAL DECISION</div>
      <div style="font-size:8px; color:#78716c; font-weight:600;">✍️ İMZALAR / SIGNATURES</div>
    </div>
    ${decision ? `<div style="font-size:14px; font-weight:700; color:${decision.color}; margin-bottom:6px;">${esc(decision.label)}</div>` : ""}
    ${study.recommendations ? `<div style="font-size:10px; color:#1c1917; line-height:1.5; margin-bottom:8px;">${esc(study.recommendations)}</div>` : ""}
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px; padding-top:8px; border-top:1px dashed ${decision ? decision.color : "#e7e5e4"};">
      ${FEASIBILITY_ROLES.map(r => {
        const sig = signatures[r.key];
        const bg = sig ? "#f0fdf4" : "#fff";
        const bc = sig ? "#86efac" : "#e7e5e4";
        return `
          <div style="padding:4px 6px; background:${bg}; border-radius:3px; border:1px solid ${bc}; font-size:8px; line-height:1.4;">
            <div style="font-weight:600; color:#44403c;">${esc(r.label)}</div>
            ${sig ? `
              <div style="color:#166534; font-weight:600;">✓ ${fmtDate(sig.signedAt)}${sig.isDelegate ? ` <span style="color:#d97706; font-weight:400;">(${esc(sig.actualRole)} yerine)</span>` : ""}</div>
            ` : `<span style="color:#a8a29e;">—</span>`}
          </div>
        `;
      }).join("")}
    </div>
  </div>

  <!-- FOOTER -->
  <div style="margin-top:10px; padding-top:6px; border-top:1px solid #e7e5e4; font-size:8px; color:#a8a29e; display:flex; justify-content:space-between;">
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
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
    const pdfWidth = pdf.internal.pageSize.getWidth();   // 210
    const pdfHeight = pdf.internal.pageSize.getHeight(); // 297
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgHeightMm = (canvasHeight * pdfWidth) / canvasWidth;

    // Case 1 — İçerik tam A4'e sığıyor: direkt bas
    if (imgHeightMm <= pdfHeight) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfWidth, imgHeightMm, undefined, "FAST");
      return pdf;
    }
    // Case 2 — Küçük overflow (≤15mm): scale-to-fit. Kesme yerine görüntüyü A4'e
    // sığdıracak şekilde küçültüyoruz (gözle fark edilmez ~%3-5 shrink). Sayfa
    // sayısı arttırmadan bilginin tümü tek sayfada okunabilir.
    // Eskiden tolerance ile klip ediliyordu (footer/imza kayboluyordu) → düzeltildi.
    const SMALL_OVERFLOW_MM = 15;
    if (imgHeightMm <= pdfHeight + SMALL_OVERFLOW_MM) {
      const scale = pdfHeight / imgHeightMm;
      const newWidth = pdfWidth * scale;
      const xOffset = (pdfWidth - newWidth) / 2; // yatayda ortala
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", xOffset, 0, newWidth, pdfHeight, undefined, "FAST");
      return pdf;
    }
    // Case 3 — Gerçek overflow (>15mm): sayfa sayfa dilimle. 2+ sayfada üstte
    // kompakt "devam" şeridi + üst boşluk.
    const pxPerMm = canvasWidth / pdfWidth;
    const CONTINUATION_STRIP_MM = 12;
    const CONTINUATION_TOP_GAP_MM = 8;   // devam şeridinden sonra nefes payı
    const MIN_LAST_PAGE_CONTENT_MM = 60;
    const firstPageContentPx = pdfHeight * pxPerMm;
    const continuationContentPx = (pdfHeight - CONTINUATION_STRIP_MM - CONTINUATION_TOP_GAP_MM) * pxPerMm;

    // Akıllı kesim: canvas'ı yukarıdan aşağıya tarayıp her satırın "yoğunluk"
    // skorunu hesapla (düşük yoğunluk = az/hiç metin var = kesim adayı).
    // İki metrik: (a) düşük yoğunluklu satır kümesi (beyaz veya hafif gri
    // border/padding), (b) fallback için en düşük yoğunluklu satır.
    // Parametreler gevşetildi çünkü html2canvas antialiasing tam beyaz üretmiyor,
    // tablo border-bottom hafif gri, %98 beyaz filtresi hiç match etmiyordu.
    const ctx = canvas.getContext("2d");
    const sampleStep = 2;
    const brightThreshold = 225; // "açık" piksel — border-bottom + padding tolere edilir
    const whiteRatioThreshold = 0.85; // satırın %85+ pikseli açık → boşluk sayılır
    const minGapPx = Math.max(Math.round(1.5 * pxPerMm), 4); // en az 1.5mm boşluk

    // Yatay şerit yoğunluk skoru — 0 = tam beyaz, 1 = çok yoğun. Az meşgul satır
    // = daha iyi kesim adayı. Şu an fallback için de kullanılacak.
    const _rowDensity = (y) => {
      const row = ctx.getImageData(0, y, canvas.width, 1).data;
      let darkSum = 0;
      let count = 0;
      for (let i = 0; i < row.length; i += 4) {
        const b = (row[i] + row[i + 1] + row[i + 2]) / 3;
        if (b < brightThreshold) darkSum++;
        count++;
      }
      return darkSum / count; // 0..1
    };

    // Tarama tek geçişte gap listesi + tüm satır yoğunlukları
    const densities = new Array(Math.ceil(canvas.height / sampleStep));
    const gaps = [];
    let gapStart = -1;
    for (let y = 0, idx = 0; y < canvas.height; y += sampleStep, idx++) {
      const density = _rowDensity(y);
      densities[idx] = density;
      const isGap = density < (1 - whiteRatioThreshold); // ≥85% açık → gap
      if (isGap) {
        if (gapStart < 0) gapStart = y;
      } else {
        if (gapStart >= 0 && (y - gapStart) >= minGapPx) {
          gaps.push((gapStart + y) / 2);
        }
        gapStart = -1;
      }
    }
    if (gapStart >= 0) gaps.push((gapStart + canvas.height) / 2);

    const SNAP_MAX_MM = 70; // uzun tablo satırları için geniş arama
    const snapMaxPx = SNAP_MAX_MM * pxPerMm;
    const snapToGap = (targetY) => {
      // 1) Range içinde geriye doğru en yakın açık gap
      let bestGap = null;
      for (const g of gaps) {
        if (g > targetY) break;
        if (targetY - g <= snapMaxPx) {
          if (bestGap === null || g > bestGap) bestGap = g;
        }
      }
      if (bestGap !== null) return bestGap;
      // 2) Fallback: range içinde en düşük yoğunluklu satır (metin ortası değil,
      //    en azından en boş yer). Range içinde her densities örneğine bak.
      const startIdx = Math.max(0, Math.floor((targetY - snapMaxPx) / sampleStep));
      const endIdx = Math.min(densities.length - 1, Math.floor(targetY / sampleStep));
      let bestIdx = endIdx;
      let bestDens = Infinity;
      for (let i = startIdx; i <= endIdx; i++) {
        if (densities[i] < bestDens) {
          bestDens = densities[i];
          bestIdx = i;
        }
      }
      return bestIdx * sampleStep;
    };

    // Sayfa dilimlerini hesapla — kesim noktalarını beyaz boşluklara snap et
    const slices = [];
    let offset = 0;
    let pageIdx = 0;
    while (offset < canvasHeight) {
      const isFirst = pageIdx === 0;
      const contentPx = isFirst ? firstPageContentPx : continuationContentPx;
      const targetEnd = offset + contentPx;
      let sliceEnd;
      if (targetEnd >= canvasHeight) {
        sliceEnd = canvasHeight; // son sayfa — snap yok, kalan her şey
      } else {
        // Snap yalnız yeterince content varsa (aksi halde sonsuz döngü)
        const snapped = snapToGap(targetEnd);
        sliceEnd = snapped > offset + 20 * pxPerMm ? snapped : targetEnd;
      }
      const sliceHeight = sliceEnd - offset;
      slices.push({ offset, height: sliceHeight, isContinuation: !isFirst });
      offset = sliceEnd;
      pageIdx++;
    }
    // Son sayfa çok az içerik kaldıysa (< MIN_LAST_PAGE_CONTENT_MM):
    // önceki sayfadan içeriği son sayfaya KAYDIR (append DEĞİL — append edersek
    // önceki sayfa A4'ten büyük olur, footer klip edilir). Redistribute yaklaşımı
    // sadece slice sınırını yukarı çekiyor; toplam sayfa sayısı aynı, ama son sayfa
    // "60mm en az" olacak şekilde önceki sayfadan içerik alıyor.
    if (slices.length >= 2) {
      const last = slices[slices.length - 1];
      const lastHeightMm = last.height / pxPerMm;
      if (lastHeightMm < MIN_LAST_PAGE_CONTENT_MM) {
        const neededPx = (MIN_LAST_PAGE_CONTENT_MM - lastHeightMm) * pxPerMm;
        const penultimate = slices[slices.length - 2];
        // Penultimate'ten al, son sayfaya ver (önce sınırı geriye çek, sonra genişlet)
        const canTake = Math.min(neededPx, penultimate.height - 10 * pxPerMm); // en az 10mm bırak
        if (canTake > 0) {
          penultimate.height -= canTake;
          last.offset -= canTake;
          last.height += canTake;
        }
      }
    }
    const totalPages = slices.length;

    for (let i = 0; i < totalPages; i++) {
      const p = slices[i];
      if (i > 0) pdf.addPage();

      let yPosMm = 0;
      if (p.isContinuation) {
        const headerImg = await renderContinuationStrip(study, i + 1, totalPages, pdfWidth);
        pdf.addImage(headerImg.dataUrl, "JPEG", 0, 0, pdfWidth, headerImg.heightMm, undefined, "FAST");
        // Devam şeridinden sonra ekstra üst boşluk — içerik hemen yapışmasın
        yPosMm = headerImg.heightMm + CONTINUATION_TOP_GAP_MM;
      }

      // Canvas slice (ana canvas'tan ilgili dilimi kopyala)
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvasWidth;
      sliceCanvas.height = p.height;
      sliceCanvas.getContext("2d").drawImage(canvas, 0, p.offset, canvasWidth, p.height, 0, 0, canvasWidth, p.height);
      const sliceHeightMm = p.height / pxPerMm;
      pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, yPosMm, pdfWidth, sliceHeightMm, undefined, "FAST");
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
