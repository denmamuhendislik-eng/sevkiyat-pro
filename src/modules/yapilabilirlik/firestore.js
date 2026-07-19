// Yapılabilirlik modülü — Firestore katmanı.
//
// Doküman yapısı: appData/feasibilityStudies_{YYYY}
//   { year: "2026", studies: { [studyNo]: {...} } }
//
// studyNo formatı: YYAAGGXX (teklif ile aynı desen, örn. 26071901)
//
// Bir yapılabilirlik (feasibility study) hem FR-71.1 (Proje) hem
// FR-71.2 (Ürün) bilgilerini tek doküman olarak tutar. Onaylandıktan
// sonra doğrudan teklife dönüşür (quote.feasibilityNo bağlantısı).

import { doc, onSnapshot, setDoc, getDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../firebase";

const APP_COL = "appData";
const YEAR_DOC_PREFIX = "feasibilityStudies_";

// ============================================================
// Subscribe / Read
// ============================================================

export function subscribeFeasibilityForYear(year, callback, { staging = false } = {}) {
  if (!db || !year) return () => {};
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : { studies: {} }),
    (err) => { console.error("feasibility listener:", err); callback({ studies: {} }); }
  );
}

// ============================================================
// Yeni yapılabilirlik no üret — YYAAGGXX
// ============================================================

async function getStudyNosForDate(yy, ay, gg, { staging = false } = {}) {
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const snap = await getDoc(doc(db, APP_COL, name));
  if (!snap.exists()) return [];
  const studies = snap.data()?.studies || {};
  const prefix = `${yy}${ay}${gg}`;
  return Object.values(studies)
    .map(s => String(s.studyNo || ""))
    .filter(n => n.startsWith(prefix));
}

export async function suggestNextStudyNo(date = new Date(), { staging = false } = {}) {
  const yy = String(date.getFullYear()).slice(2);
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const gg = String(date.getDate()).padStart(2, "0");
  const existing = await getStudyNosForDate(yy, ay, gg, { staging });
  const seqs = existing.map(n => Number(n.slice(6, 8))).filter(x => Number.isFinite(x));
  const nextSeq = (seqs.length > 0 ? Math.max(...seqs) : 0) + 1;
  return `${yy}${ay}${gg}${String(nextSeq).padStart(2, "0")}`;
}

// ============================================================
// Kaydet — yeni veya update
// ============================================================

// Yapılabilirlik kaydet. Yeni ise createdAt, edit ise updatedAt damgalar.
// Merge ile mevcut alanlar korunur.
export async function saveFeasibilityStudy(study, { canEdit, staging = false, userEmail = "" } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!study?.studyNo) throw new Error("studyNo zorunlu");
  if (!study.customerCode && !study.customerName) throw new Error("customerCode veya customerName zorunlu");
  const year = "20" + String(study.studyNo).slice(0, 2);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  const patch = {
    ...study,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || "",
  };
  if (!study.createdAt) patch.createdAt = patch.updatedAt;
  if (!study.createdBy) patch.createdBy = userEmail || "";
  await setDoc(ref, {
    year,
    studies: {
      [study.studyNo]: patch,
    },
  }, { merge: true });
  return { studyNo: study.studyNo, year };
}

// ============================================================
// İmza — rol bazlı, yetki devri destekli
// ============================================================

// 6 rol tanımı — masterdada değil, kod içinde sabit (Excel formuyla eşleştirdi).
export const FEASIBILITY_ROLES = [
  { key: "salesProjectManager", label: "Satış ve Proje Yöneticisi" },
  { key: "purchasingPlanningManager", label: "Satınalma ve Tedarik Planlama Sorumlusu" },
  { key: "cadCamExpert", label: "Cad / Cam Uzmanı" },
  { key: "productionManager", label: "Üretim Yöneticisi" },
  { key: "productionPlanning", label: "Üretim Planlama ve Veri Analizi Müh." },
  { key: "generalManager", label: "Genel Müdür" },
];

export const GM_ROLE_KEY = "generalManager";

// Bir role imza at.
//   roleKey: FEASIBILITY_ROLES.key
//   signerName: imzayı atan gerçek kişinin adı (login email veya display)
//   signerRoleLabel: imzayı atan kişinin gerçek rolü (audit için)
//   isGeneralManager: sadece GM imzalayabildiği için (gm rolü için) kontrol
export async function signFeasibilityRole(studyNo, roleKey, { signerName, signerRoleLabel, isGeneralManager = false, canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo || !roleKey) throw new Error("studyNo ve roleKey zorunlu");
  if (roleKey === GM_ROLE_KEY && !isGeneralManager) {
    throw new Error("Genel Müdür imzası için sadece GM yetkilidir");
  }
  const year = "20" + String(studyNo).slice(0, 2);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  const now = new Date().toISOString();
  await setDoc(ref, {
    studies: {
      [studyNo]: {
        signatures: {
          [roleKey]: {
            signedAt: now,
            signedBy: signerName || "",
            signedForRole: roleKey,
            actualRole: signerRoleLabel || "",
            isDelegate: signerRoleLabel && signerRoleLabel !== roleKey,
          },
        },
        updatedAt: now,
      },
    },
  }, { merge: true });
  return { studyNo, roleKey, signedAt: now };
}

// Bir rolün imzasını iptal et (yanlışlıkla imzalanmışsa).
export async function unsignFeasibilityRole(studyNo, roleKey, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo || !roleKey) throw new Error("studyNo ve roleKey zorunlu");
  const year = "20" + String(studyNo).slice(0, 2);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await updateDoc(ref, {
    [`studies.${studyNo}.signatures.${roleKey}`]: deleteField(),
    [`studies.${studyNo}.updatedAt`]: new Date().toISOString(),
  });
  return { studyNo, roleKey };
}

// ============================================================
// Durum akışı helper'ları
// ============================================================

// Bir yapılabilirliğin efektif durumu:
//   "draft"       → henüz hiç kaydedilmemiş taslak (UI local state)
//   "evaluating"  → kaydedildi, imza toplama sürecinde (herhangi bir imza var ama tümü değil)
//   "approved"    → tüm 6 rol imzaladı VE karar "accepted"
//   "rejected"    → karar "rejected"
//   "convertedToQuote" → onaylı ve teklife dönüştü (linkedQuoteNo dolu)
export function computeStudyStatus(study) {
  if (!study) return "draft";
  if (study.decision === "rejected") return "rejected";
  const sigs = study.signatures || {};
  const allSigned = FEASIBILITY_ROLES.every(r => sigs[r.key]?.signedAt);
  if (allSigned && study.decision === "accepted") {
    return study.linkedQuoteNo ? "convertedToQuote" : "approved";
  }
  return "evaluating";
}

// Kaç imza atıldı — UI progress bar için
export function countSignatures(study) {
  const sigs = study?.signatures || {};
  let signed = 0;
  for (const r of FEASIBILITY_ROLES) {
    if (sigs[r.key]?.signedAt) signed++;
  }
  return { signed, total: FEASIBILITY_ROLES.length };
}

// ============================================================
// Teklif bağlantısı
// ============================================================

// Yapılabilirlik → teklife dönüştüğünde çağrılır. linkedQuoteNo yazılır.
export async function linkFeasibilityToQuote(studyNo, quoteNo, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo || !quoteNo) throw new Error("studyNo ve quoteNo zorunlu");
  const year = "20" + String(studyNo).slice(0, 2);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await setDoc(ref, {
    studies: {
      [studyNo]: {
        linkedQuoteNo: quoteNo,
        convertedAt: new Date().toISOString(),
      },
    },
  }, { merge: true });
  return { studyNo, quoteNo };
}

// Yapılabilirliği sil — sadece taslak veya reddedilmiş olanlar
export async function deleteFeasibilityStudy(studyNo, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo) throw new Error("studyNo zorunlu");
  const year = "20" + String(studyNo).slice(0, 2);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await setDoc(ref, {
    studies: { [studyNo]: deleteField() },
  }, { merge: true });
  return { studyNo };
}
