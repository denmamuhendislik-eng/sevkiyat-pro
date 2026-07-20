// Yapılabilirlik → FAI dönüştürme helper'ı (Faz F-8).
// Onaylı bir feasibility study'yi FAI initialRecord payload'ına çevirir.

import { makeEmptyFai } from "./schema";

export function feasibilityToFaiPayload(study) {
  if (!study) return null;

  const base = makeEmptyFai("");

  // Parça bilgisi
  base.partNumber = study.stockCode || study.partNo || "";
  base.partName = study.partName || "";
  base.stockCode = study.stockCode || study.partNo || "";
  base.customerCode = study.customerCode || "";
  base.customerName = study.customerName || "";

  // Doküman / iş
  base.customerPoNumber = study.customerQuoteNo || "";

  // Form 2 — hammadde ve fason yapılabilirlik'ten geçirilir
  // Fason kalemleri → materialsAndProcesses
  const mps = [];
  for (const f of (study.fasonItems || [])) {
    if (!f.name) continue;
    mps.push({
      materialOrProcessName: f.name,
      specificationNumber: "",
      code: "",
      supplier: f.supplier || "",
      customerApprovalVerification: "",
      certificateNumber: "",
    });
  }
  // Ana hammadde
  if (study.materialType) {
    mps.unshift({
      materialOrProcessName: study.materialType,
      specificationNumber: "",
      code: "",
      supplier: "",
      customerApprovalVerification: "",
      certificateNumber: "",
    });
  }
  base.materialsAndProcesses = mps;

  // Meta — bağlantı
  base.linkedFeasibilityNo = study.studyNo;
  base.source = "from-feasibility";

  return base;
}
