// Yapılabilirlik modülü — Firestore katmanı.
//
// Doküman yapısı: appData/feasibilityStudies_{YYYY}
//   { year: "2026", studies: { [studyNo]: {...} } }
//
// studyNo formatı: DF-YYAAGGXX (örn. DF-26072101).
// Yasal geriye uyumluluk: prefix'siz eski YYAAGGXX kayıtlar (2 tane) da desteklenir.
// Diğer form numaralandırmalarıyla karışmasın diye DF- prefix'i getirildi (2026-07-21).
//
// Bir yapılabilirlik (feasibility study) hem FR-71.1 (Proje) hem
// FR-71.2 (Ürün) bilgilerini tek doküman olarak tutar. Onaylandıktan
// sonra doğrudan teklife dönüşür (quote.feasibilityNo bağlantısı).

import { doc, onSnapshot, setDoc, getDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../firebase";
import { computeStudyScore } from "./schema";

const APP_COL = "appData";
const YEAR_DOC_PREFIX = "feasibilityStudies_";
const STUDY_NO_PREFIX = "DF-";

// studyNo'dan yılı çıkar — hem "DF-26072101" hem eski "26072101" formatı destekli.
// Dönüş: "2026" (YYYY)
function getYearFromStudyNo(studyNo) {
  const s = String(studyNo || "");
  const core = s.startsWith(STUDY_NO_PREFIX) ? s.slice(STUDY_NO_PREFIX.length) : s;
  return "20" + core.slice(0, 2);
}

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
// Yeni yapılabilirlik no üret — DF-YYAAGGXX
// ============================================================

// Aynı gün oluşturulmuş studyNo'ları döndürür. Hem DF-YYAAGG.. yeni format,
// hem eski YYAAGG.. format kayıtları yakalar (aynı gün varsa sequence çakışmasın).
async function getStudyNosForDate(yy, ay, gg, { staging = false } = {}) {
  const year = "20" + yy;
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const snap = await getDoc(doc(db, APP_COL, name));
  if (!snap.exists()) return [];
  const studies = snap.data()?.studies || {};
  const datePart = `${yy}${ay}${gg}`;
  return Object.values(studies)
    .map(s => String(s.studyNo || ""))
    .filter(n => {
      const core = n.startsWith(STUDY_NO_PREFIX) ? n.slice(STUDY_NO_PREFIX.length) : n;
      return core.startsWith(datePart);
    });
}

export async function suggestNextStudyNo(date = new Date(), { staging = false } = {}) {
  const yy = String(date.getFullYear()).slice(2);
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const gg = String(date.getDate()).padStart(2, "0");
  const existing = await getStudyNosForDate(yy, ay, gg, { staging });
  const seqs = existing.map(n => {
    const core = n.startsWith(STUDY_NO_PREFIX) ? n.slice(STUDY_NO_PREFIX.length) : n;
    return Number(core.slice(6, 8));
  }).filter(x => Number.isFinite(x));
  const nextSeq = (seqs.length > 0 ? Math.max(...seqs) : 0) + 1;
  return `${STUDY_NO_PREFIX}${yy}${ay}${gg}${String(nextSeq).padStart(2, "0")}`;
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
  const year = getYearFromStudyNo(study.studyNo);
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

// 3 rol tanımı — 2026-07-21'de eski 6-rol yapı sadeleştirildi.
// Eski test kayıtları (2 tane) silinecek, backward-compat mapping tutulmuyor.
export const FEASIBILITY_ROLES = [
  { key: "salesManager",    label: "Satış Yöneticisi" },
  { key: "technicalUnit",   label: "Teknik Birim" },
  { key: "generalManager",  label: "Genel Müdür" },
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
  const year = getYearFromStudyNo(studyNo);
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
  const year = getYearFromStudyNo(studyNo);
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
//   "evaluating"  → kaydedildi, gereken imzalar tamamlanmadı
//   "approved"    → gereken imzalar tamam VE karar "accepted"
//   "rejected"    → karar "rejected"
//   "convertedToQuote" → onaylı ve teklife dönüştü (linkedQuoteNo dolu)
//
// İmza gereksinimi puanlamaya bağlı (2026-07-22):
//   %≥50  → Satış + Teknik imzası yeterli, GM opsiyonel
//   %<50  → Satış + Teknik + GM imzası tamamı zorunlu
// Puanlamaya göre zorunlu imza setini döndürür.
export function getRequiredRoleKeys(study) {
  const { percent } = computeStudyScore(study);
  return percent < 50
    ? ["salesManager", "technicalUnit", "generalManager"]
    : ["salesManager", "technicalUnit"];
}

// Aşama bazlı durum akışı (2026-07-22):
//   draft            → hiç kaydedilmedi
//   salesPending     → satış imzası eksik
//   technicalPending → satış tamam, teknik imzası eksik
//   gmPending        → %<50 ve GM imzası eksik
//   evaluating       → imzalar tamam ama karar yok (nadir)
//   approved         → tüm gerekli imzalar + decision "accepted"
//   rejected         → decision "rejected"
//   convertedToQuote → approved + linkedQuoteNo
// Sıra kısıtı gevşek: paralel imza atılabilir, sadece "sıradaki iş kimin?" bilgisi taşınır.
export function computeStudyStatus(study) {
  if (!study) return "draft";
  if (!study.createdAt && !study.updatedAt) return "draft";
  if (study.decision === "rejected") return "rejected";
  const sigs = study.signatures || {};
  const requiredKeys = getRequiredRoleKeys(study);
  const allSigned = requiredKeys.every(k => sigs[k]?.signedAt);
  if (allSigned && study.decision === "accepted") {
    return study.linkedQuoteNo ? "convertedToQuote" : "approved";
  }
  // Hangi aşamada beklediğini belirle — imza sırası: satış → teknik → gm
  if (!sigs.salesManager?.signedAt) return "salesPending";
  if (!sigs.technicalUnit?.signedAt) return "technicalPending";
  if (requiredKeys.includes("generalManager") && !sigs.generalManager?.signedAt) return "gmPending";
  return "evaluating";
}

// Mevcut aşamada aksiyon alması beklenen rol key'i (bildirim + buton için)
export function getPendingRoleForStudy(study) {
  const status = computeStudyStatus(study);
  if (status === "salesPending") return "salesManager";
  if (status === "technicalPending") return "technicalUnit";
  if (status === "gmPending") return "generalManager";
  return null;
}

// Bir kullanıcının rolü mevcut aşamayla eşleşiyor mu? (buton görünürlüğü, badge sayısı)
export function isUserPendingForStudy(study, { isAdmin, isSales, isUretim } = {}) {
  const pending = getPendingRoleForStudy(study);
  if (!pending) return false;
  if (pending === "salesManager") return !!isSales || !!isAdmin;
  if (pending === "technicalUnit") return !!isUretim || !!isAdmin;
  if (pending === "generalManager") return !!isAdmin;
  return false;
}

// Kaç imza atıldı — UI progress bar için. Zorunlu set puana göre.
export function countSignatures(study) {
  const sigs = study?.signatures || {};
  const requiredKeys = getRequiredRoleKeys(study);
  let signed = 0;
  for (const k of requiredKeys) {
    if (sigs[k]?.signedAt) signed++;
  }
  return { signed, total: requiredKeys.length, requiredKeys };
}

// ============================================================
// Teklif bağlantısı
// ============================================================

// Yapılabilirlik → teklife dönüştüğünde çağrılır. linkedQuoteNo yazılır.
export async function linkFeasibilityToQuote(studyNo, quoteNo, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo || !quoteNo) throw new Error("studyNo ve quoteNo zorunlu");
  const year = getYearFromStudyNo(studyNo);
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

// Teklif silindiğinde çağrılır — linkedQuoteNo + convertedAt alanlarını temizle,
// yapılabilirlik tekrar "approved" durumuna döner ve yeniden teklife dönüştürülebilir.
export async function unlinkFeasibilityFromQuote(studyNo, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo) throw new Error("studyNo zorunlu");
  const year = getYearFromStudyNo(studyNo);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);
  await updateDoc(ref, {
    [`studies.${studyNo}.linkedQuoteNo`]: deleteField(),
    [`studies.${studyNo}.convertedAt`]: deleteField(),
    [`studies.${studyNo}.updatedAt`]: new Date().toISOString(),
  });
  return { studyNo };
}

// Yapılabilirliği sil.
// Kural: linkedQuoteNo dolu ise ilgili teklif hâlâ Firestore'da varsa silme
// engellenir ("önce teklifi silin"). Teklif silinmişse yapılabilirlik silinir.
export async function deleteFeasibilityStudy(studyNo, { canEdit, staging = false } = {}) {
  if (!canEdit) throw new Error("Yetki yok");
  if (!studyNo) throw new Error("studyNo zorunlu");
  const year = getYearFromStudyNo(studyNo);
  const name = `${YEAR_DOC_PREFIX}${year}` + (staging ? "_staging" : "");
  const ref = doc(db, APP_COL, name);

  // Linked teklif kontrolü — teklif hâlâ varsa engelle
  const snap = await getDoc(ref);
  const study = snap.exists() ? snap.data()?.studies?.[studyNo] : null;
  const linkedQuoteNo = study?.linkedQuoteNo;
  if (linkedQuoteNo) {
    const quoteYear = "20" + String(linkedQuoteNo).slice(0, 2);
    const quoteDocName = `quotes_${quoteYear}` + (staging ? "_staging" : "");
    const quoteSnap = await getDoc(doc(db, APP_COL, quoteDocName));
    if (quoteSnap.exists()) {
      const quotes = quoteSnap.data()?.quotes || {};
      const stillExists = Object.values(quotes).some(q => q?.quoteNo === linkedQuoteNo);
      if (stillExists) {
        throw new Error(`Teklif ${linkedQuoteNo} hâlâ mevcut. Önce teklifi silin, sonra bu yapılabilirliği silebilirsiniz.`);
      }
    }
    // Teklif silinmiş — yapılabilirlik silinebilir
  }

  await setDoc(ref, {
    studies: { [studyNo]: deleteField() },
  }, { merge: true });
  return { studyNo };
}
