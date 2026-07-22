import { useState, useEffect, useMemo } from "react";
import {
  subscribeFeasibilityForYear, suggestNextStudyNo, saveFeasibilityStudy,
  signFeasibilityRole, unsignFeasibilityRole, deleteFeasibilityStudy,
  FEASIBILITY_ROLES, GM_ROLE_KEY, computeStudyStatus, countSignatures,
  getPendingRoleForStudy, isUserPendingForStudy,
  uploadFeasibilityAttachment, deleteFeasibilityAttachment,
} from "./firestore";
import {
  EVALUATION_QUESTIONS, EVALUATION_DEPARTMENTS, PRODUCT_DIMENSIONS,
  ITEM_CATEGORIES, SOURCE_TYPES, WORK_TYPES, DECISIONS, RECEIVED_DATA_TYPES,
  makeEmptyStudy, makeEmptyItem,
  SALES_QUESTIONS, TECHNICAL_QUESTIONS, EVAL_CHOICES,
  computeStudyScore, getRecommendation, getNegotiationHints, scoreForAnswer,
  SALES_MAX, TECHNICAL_MAX, TOTAL_MAX,
} from "./schema";
import {
  subscribeQuoteCustomers, subscribeQuoteParts, subscribeQuoteMaterials,
  subscribeQuotesForYear, saveQuoteCustomer, saveQuotePart,
  subscribeQuoteFasonWorks,
} from "../teklifler/firestore";
import { calculateWeightKg } from "../teklifler/quoteCalc";
import { useMachineRatesForQuote } from "../teklifler/machineRates";
import { generateFeasibilityPdf } from "./feasibilityPdf";

export default function Yapilabilirlik({ isAdmin, isUretim, isSales, authUser, onCreateQuoteFromFeasibility }) {
  const canEdit = !!(isAdmin || isSales || isUretim);
  const [activeTab, setActiveTab] = useState("new");
  const [pendingOpen, setPendingOpen] = useState(null); // {study, readOnly}
  const openStudy = (study, { readOnly = false } = {}) => {
    setPendingOpen({ study, readOnly });
    setActiveTab("new");
  };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>🔬 Yapılabilirlik</h1>
        <span style={{ fontSize: 11, color: "#a8a29e" }}>FR-71.1 Proje + FR-71.2 Ürün</span>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #e7e5e4" }}>
        {[
          { id: "new", label: "➕ Yeni Yapılabilirlik" },
          { id: "list", label: "📋 Liste" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => {
              // "Yeni Yapılabilirlik" tıklandığında açık form varsa temizle;
              // key prop ile NewFeasibilityView remount olur, state sıfırlanır.
              if (t.id === "new") setPendingOpen(null);
              setActiveTab(t.id);
            }}
            style={{
              padding: "8px 14px", border: "none",
              background: activeTab === t.id ? "#534AB7" : "transparent",
              color: activeTab === t.id ? "#fff" : "#57534e",
              fontSize: 13, fontWeight: activeTab === t.id ? 500 : 400,
              cursor: "pointer", borderRadius: "6px 6px 0 0",
            }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === "new" && (
        <NewFeasibilityView
          key={pendingOpen?.study?.studyNo || "new"}
          canEdit={canEdit} isAdmin={isAdmin} isSales={isSales} isUretim={isUretim}
          authUser={authUser}
          initialStudy={pendingOpen?.study || null}
          readOnly={!!pendingOpen?.readOnly}
          onSaved={() => { setPendingOpen(null); setActiveTab("list"); }}
        />
      )}
      {activeTab === "list" && <FeasibilityListView canEdit={canEdit} isAdmin={isAdmin} isSales={isSales} isUretim={isUretim} onOpen={openStudy} onCreateQuote={onCreateQuoteFromFeasibility} />}
    </div>
  );
}

// ==================== Yeni Yapılabilirlik Form ====================

function NewFeasibilityView({ canEdit, isAdmin, isSales, isUretim, authUser, initialStudy, readOnly, onSaved }) {
  const isGM = !!isAdmin; // Şu an admin = GM; ileride ayrı role flag'i eklenebilir
  const userEmail = authUser?.email || "";
  const userDisplayRole = isAdmin ? "Genel Müdür"
    : isSales ? "Satış Yöneticisi"
    : isUretim ? "Teknik Birim"
    : "Kullanıcı";

  const [studyNo, setStudyNo] = useState("");
  const [study, setStudy] = useState(() => makeEmptyStudy(""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveResult, setSaveResult] = useState(null);
  const [staging, setStaging] = useState(false);
  const [signRolePicker, setSignRolePicker] = useState(null); // {roleKey} — delegate seçici popup
  const explicitReadOnly = readOnly;

  // Tezgah listesi (maliyet modülünden) — operasyon detayında dropdown için
  const machineRatesData = useMachineRatesForQuote();

  // Teklif modülünden veri subscribe'ları (Faz Y-3D)
  const [customersData, setCustomersData] = useState({ customers: {} });
  const [partsLib, setPartsLib] = useState({ parts: {} });
  const [materialsData, setMaterialsData] = useState({ materials: {} });
  const [quotesForYear, setQuotesForYear] = useState({ quotes: {} });
  const [fasonWorksData, setFasonWorksData] = useState({ works: [] });
  const currentYear = String(new Date().getFullYear());

  useEffect(() => {
    const u1 = subscribeQuoteCustomers(d => setCustomersData(d || { customers: {} }), { staging });
    const u2 = subscribeQuoteParts(d => setPartsLib(d || { parts: {} }), { staging });
    const u3 = subscribeQuoteMaterials(d => setMaterialsData(d || { materials: {} }), { staging });
    const u4 = subscribeQuotesForYear(currentYear, d => setQuotesForYear(d || { quotes: {} }), { staging });
    const u5 = subscribeQuoteFasonWorks(d => setFasonWorksData(d || { works: [] }), { staging });
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [staging, currentYear]);
  const fasonList = fasonWorksData?.works || [];

  const customerList = useMemo(() => Object.values(customersData?.customers || {}), [customersData]);
  const materialList = useMemo(() => Object.values(materialsData?.materials || {}), [materialsData]);

  // Müşteri seçilince otomatik doldurma
  const applyCustomer = (name) => {
    update("customerName", name);
    const c = customersData?.customers?.[name];
    if (c) {
      if (c.code) update("customerCode", c.code);
      if (c.phone) update("customerContact", c.phone);
      if (c.email) update("customerEmail", c.email);
      // Adres tercihi: c.address > c.defaultShipping (bazı eski kayıtlarda adres nakliye
      // alanında yazılı olabilir — ikisi de yoksa dokunma, mevcut değeri korur)
      const addr = c.address || c.defaultShipping || "";
      if (addr) update("shipmentAddress", addr);
    }
  };

  // Parça arama (Faz Y-3D)
  const [partSearchOpen, setPartSearchOpen] = useState(false);
  const [partSearchQuery, setPartSearchQuery] = useState("");
  const [confirmApplyPart, setConfirmApplyPart] = useState(null); // parça objesi

  const partSearchResults = useMemo(() => {
    const q = partSearchQuery.trim().toLocaleLowerCase("tr-TR");
    if (!q || q.length < 2) return [];
    const arr = Object.values(partsLib?.parts || {});
    return arr.filter(p =>
      (p.stokKodu || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (p.stokAdi || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (p.musteriKodu || "").toLocaleLowerCase("tr-TR").includes(q)
    ).slice(0, 15);
  }, [partSearchQuery, partsLib]);

  const applyPart = (part) => {
    // Kullanıcı onayı ile mevcut değerlerin üzerine yazılır (Karar 1-B)
    setStudy(prev => {
      const next = { ...prev };
      next.stockCode = part.stokKodu || "";
      next.partNo = part.stokKodu || next.partNo;
      next.partName = part.stokAdi || next.partName;
      next.musteriKodu = part.musteriKodu || "";
      // Hammadde
      if (part.hammadde) {
        if (part.hammadde.tur) next.materialType = part.hammadde.tur;
        if (part.hammadde.agirlikKg) next.weightKg = Number(part.hammadde.agirlikKg) || 0;
        // Ebat "EN:20 × BOY:30 × UZ:100" formatındaysa parse et
        if (typeof part.hammadde.ebat === "string") {
          const m = part.hammadde.ebat;
          const en = m.match(/EN\s*:?\s*(\d+(?:[.,]\d+)?)/i);
          const boy = m.match(/BOY\s*:?\s*(\d+(?:[.,]\d+)?)/i);
          const uz = m.match(/UZ(?:UNLUK)?\s*:?\s*(\d+(?:[.,]\d+)?)/i);
          next.dimensions = {
            en: en ? Number(String(en[1]).replace(",", ".")) || 0 : 0,
            boy: boy ? Number(String(boy[1]).replace(",", ".")) || 0 : 0,
            uzunluk: uz ? Number(String(uz[1]).replace(",", ".")) || 0 : 0,
          };
        }
      }
      // Şekil bilgisi materialsData'dan malzeme türüne göre
      const mat = materialsData?.materials?.[next.materialType];
      if (mat?.shape) next.materialShape = mat.shape;
      // Operasyonlar (varsa) — operations.details'a yerleştir
      if (part.operasyonlar) {
        const makineler = String(part.operasyonlar.makineler || "").split(/[,;/]/).map(s => s.trim()).filter(Boolean);
        const toplam = Number(part.operasyonlar.toplamSureDk) || 0;
        if (makineler.length > 0) {
          const per = toplam / makineler.length;
          next.operations = {
            ...(prev.operations || {}),
            count: makineler.length,
            totalMinutes: toplam,
            details: makineler.map(m => ({ operationName: "", machine: m, minutes: per })),
          };
        }
      }
      // Fason işleri
      if (part.fason?.isler) {
        const iskeleti = String(part.fason.isler).split(/[,;/]/).map(s => s.trim()).filter(Boolean);
        if (iskeleti.length > 0) {
          next.fasonItems = iskeleti.map(name => ({ ...makeEmptyItem(), name }));
        }
      }
      // Aparat
      if (part.aparat?.varMi && Number(part.aparat.maliyet) > 0) {
        next.toolingItems = [{
          ...makeEmptyItem(),
          name: part.aparat.aciklama || (part.stokAdi ? `${part.stokAdi} — Aparat` : "Aparat"),
          unitCost: Number(part.aparat.maliyet) || 0,
        }];
      }
      return next;
    });
    setConfirmApplyPart(null);
    setPartSearchOpen(false);
    setPartSearchQuery("");
  };

  // Referans teklifler — seçilen parça için son 12 aylık teklif geçmişi
  const referenceQuotes = useMemo(() => {
    if (!study.stockCode) return [];
    const all = Object.values(quotesForYear?.quotes || {});
    return all
      .filter(q => (q.lines || []).some(l => l.stockCode === study.stockCode))
      .sort((a, b) => (b.quoteDate || "").localeCompare(a.quoteDate || ""))
      .slice(0, 5);
  }, [study.stockCode, quotesForYear]);

  // Ağırlık otomatik hesap (calculateWeightKg helper'ı ile)
  const selectedMaterialMaster = materialsData?.materials?.[study.materialType];
  const autoWeightKg = useMemo(() => calculateWeightKg({
    shape: study.materialShape || selectedMaterialMaster?.shape,
    en: study.dimensions?.en,
    boy: study.dimensions?.boy,
    uzunluk: study.dimensions?.uzunluk,
    density: selectedMaterialMaster?.density,
  }), [study.materialShape, study.dimensions, selectedMaterialMaster]);

  useEffect(() => {
    if (initialStudy) {
      setStudy({ ...makeEmptyStudy(initialStudy.studyNo || ""), ...initialStudy });
      setStudyNo(initialStudy.studyNo || "");
    }
  }, [initialStudy]);

  useEffect(() => {
    if (!studyNo && !initialStudy) {
      suggestNextStudyNo(new Date(), { staging }).then(setStudyNo).catch(() => {});
    }
  }, [studyNo, initialStudy, staging]);

  // Bilgi güncelleme helper'ı
  const update = (key, value) => setStudy(prev => ({ ...prev, [key]: value }));
  const updateReceived = (key, value) => setStudy(prev => ({ ...prev, receivedData: { ...(prev.receivedData || {}), [key]: value } }));
  const updateEvaluation = (key, subkey, value) => setStudy(prev => ({
    ...prev,
    evaluation: { ...(prev.evaluation || {}), [key]: { ...((prev.evaluation || {})[key] || {}), [subkey]: value } },
  }));

  // İSTER tablosu
  const addDemand = () => setStudy(prev => ({ ...prev, demands: [...(prev.demands || []), { demand: "", demandDetail: "", denmaAssessment: "", customerAssessment: "", note: "" }] }));
  const updateDemand = (idx, key, value) => setStudy(prev => ({
    ...prev,
    demands: (prev.demands || []).map((d, i) => i === idx ? { ...d, [key]: value } : d),
  }));
  const removeDemand = (idx) => setStudy(prev => ({ ...prev, demands: (prev.demands || []).filter((_, i) => i !== idx) }));

  // Ürün detayı tablosu (eski yapı — geri uyumluluk için, yeni formda kullanılmıyor)
  const addProduct = () => setStudy(prev => {
    const nextNo = (prev.productDetails || []).length + 1;
    return { ...prev, productDetails: [...(prev.productDetails || []), { no: nextNo, partCode: "", partName: "" }] };
  });
  const updateProduct = (idx, key, value) => setStudy(prev => ({
    ...prev,
    productDetails: (prev.productDetails || []).map((p, i) => i === idx ? { ...p, [key]: value } : p),
  }));
  const removeProduct = (idx) => setStudy(prev => ({
    ...prev,
    productDetails: (prev.productDetails || []).filter((_, i) => i !== idx).map((p, i) => ({ ...p, no: i + 1 })),
  }));

  // YENİ (Faz Y-3A): kalem detay tabloları — tooling ve fason ayrı array'ler
  const addItem = (category) => setStudy(prev => {
    const arrKey = category === "tooling" ? "toolingItems" : "fasonItems";
    return { ...prev, [arrKey]: [...(prev[arrKey] || []), makeEmptyItem()] };
  });
  const updateItem = (category, idx, key, value) => setStudy(prev => {
    const arrKey = category === "tooling" ? "toolingItems" : "fasonItems";
    return {
      ...prev,
      [arrKey]: (prev[arrKey] || []).map((it, i) => i === idx ? { ...it, [key]: value } : it),
    };
  });
  const removeItem = (category, idx) => setStudy(prev => {
    const arrKey = category === "tooling" ? "toolingItems" : "fasonItems";
    return { ...prev, [arrKey]: (prev[arrKey] || []).filter((_, i) => i !== idx) };
  });

  // Operasyonlar (Faz Y-3C) — üretim/CAD-CAM için
  const updateOperations = (key, value) => setStudy(prev => ({
    ...prev,
    operations: { ...(prev.operations || {}), [key]: value },
  }));
  const addOperationDetail = () => setStudy(prev => ({
    ...prev,
    operations: {
      ...(prev.operations || {}),
      details: [...(prev.operations?.details || []), { operationName: "", machine: "", minutes: 0 }],
    },
  }));
  const updateOperationDetail = (idx, key, value) => setStudy(prev => ({
    ...prev,
    operations: {
      ...(prev.operations || {}),
      details: (prev.operations?.details || []).map((d, i) => i === idx ? { ...d, [key]: value } : d),
    },
  }));
  const removeOperationDetail = (idx) => setStudy(prev => ({
    ...prev,
    operations: {
      ...(prev.operations || {}),
      details: (prev.operations?.details || []).filter((_, i) => i !== idx),
    },
  }));
  // Detay sayısı → operasyon sayısı ve toplam süre otomatik hesaplama (detay varsa)
  const opsDetailCount = (study.operations?.details || []).length;
  const opsDetailTotal = (study.operations?.details || []).reduce((s, d) => s + (Number(d.minutes) || 0), 0);
  const effectiveOpCount = opsDetailCount > 0 ? opsDetailCount : (Number(study.operations?.count) || 0);
  const effectiveTotalMin = opsDetailCount > 0 ? opsDetailTotal : (Number(study.operations?.totalMinutes) || 0);

  // Kalem toplamları (UI özet için)
  const toolingTotal = (study.toolingItems || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);
  const fasonTotal = (study.fasonItems || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);

  // Kilit mekanizması — form açılış anındaki durum kilitleme kararı. Kullanıcı
  // karar seçtiğinde (decision = "accepted") status runtime'da "approved"a
  // dönerdi ve form kilitlenip Kaydet butonu kaybolurdu; onun yerine
  // initialStudy bazlı sabit değerlendirme kullanılıyor.
  const status = computeStudyStatus(study);
  const initialStatus = useMemo(() => computeStudyStatus(initialStudy), [initialStudy]);
  const isLocked = initialStatus === "approved" || initialStatus === "convertedToQuote";
  const readonlyForm = explicitReadOnly || isLocked;

  // Puanlama (canlı) — schema.js/computeStudyScore
  const scoreInfo = useMemo(() => computeStudyScore(study), [study]);
  const recommendation = useMemo(() => getRecommendation(scoreInfo.percent), [scoreInfo.percent]);
  const negotiationHints = useMemo(() => getNegotiationHints(study), [study]);

  // Rol bazlı bölüm kilidi (asimetrik):
  // - Admin (GM) her iki bölümü de düzenleyebilir.
  // - Satış her iki bölümü de düzenleyebilir (bazı durumlarda satış teknik alanı da doldurmak zorunda kalıyor).
  // - Üretim sadece teknik bölümü düzenleyebilir, satış bölümüne müdahale edemez.
  // Not: doldurma yetkisi asimetrik olsa da imzalar hâlâ kendi rolüne özel (canCompleteCurrent bakar).
  const canEditSales = !readonlyForm && (isAdmin || isSales);
  const canEditTechnical = !readonlyForm && (isAdmin || isUretim || isSales);

  // Progress: kaç soru cevaplandı
  const salesAnswered = SALES_QUESTIONS.filter(q => study.evaluation?.[q.key]?.answer).length;
  const technicalAnswered = TECHNICAL_QUESTIONS.filter(q => {
    const v = study.evaluation?.[q.key]?.answer;
    return v != null && v !== "";
  }).length;

  const handleSave = async () => {
    if (readonlyForm) return;
    if (!canEdit) return;
    if (!studyNo) { setError("Yapılabilirlik no boş"); return; }
    if (!study.customerName) { setError("Müşteri adı zorunlu"); return; }
    if (!study.partName && !study.partNo) { setError("Parça adı veya no zorunlu"); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...study, studyNo };
      const out = await saveFeasibilityStudy(payload, { canEdit, staging, userEmail: "" });

      // Yeni müşteri ise quoteCustomers'a otomatik ekle (Karar 4)
      if (study.customerName && !customersData?.customers?.[study.customerName]) {
        try {
          await saveQuoteCustomer(study.customerName, {
            name: study.customerName,
            phone: study.customerContact || "",
            email: study.customerEmail || "",
            address: study.shipmentAddress || "",
          }, { canEdit, staging });
        } catch (e) {
          console.warn("Müşteri kütüphaneye eklenemedi:", e.message);
        }
      }

      // Yeni parça ise quoteParts'a otomatik ekle
      const partCode = (study.partNo || study.stockCode || "").trim();
      if (partCode && !partsLib?.parts?.[partCode]) {
        try {
          const machineNames = (study.operations?.details || []).map(d => d.machine).filter(Boolean).join(",");
          const totalMin = (study.operations?.details || []).reduce((s, d) => s + (Number(d.minutes) || 0), 0) || Number(study.operations?.totalMinutes) || 0;
          const fasonNames = (study.fasonItems || []).map(f => f.name).filter(Boolean).join(",");
          const fasonToplam = (study.fasonItems || []).reduce((s, f) => s + (Number(f.qty) || 0) * (Number(f.unitCost) || 0), 0);
          const aparatToplam = (study.toolingItems || []).reduce((s, t) => s + (Number(t.qty) || 0) * (Number(t.unitCost) || 0), 0);
          const enV = Number(study.dimensions?.en) || 0, boyV = Number(study.dimensions?.boy) || 0, uzV = Number(study.dimensions?.uzunluk) || 0;
          await saveQuotePart(partCode, {
            stokKodu: partCode,
            stokAdi: study.partName || "",
            musteriKodu: study.musteriKodu || "",
            hammadde: {
              tur: study.materialType || study.material || "",
              ebat: (enV || boyV || uzV) ? `EN:${enV} × BOY:${boyV} × UZ:${uzV}` : "",
              agirlikKg: Number(study.weightKg) || 0,
            },
            operasyonlar: { makineler: machineNames, toplamSureDk: totalMin },
            fason: { isler: fasonNames, tahminiToplam: fasonToplam },
            aparat: { varMi: aparatToplam > 0, aciklama: "", maliyet: aparatToplam },
            sonMusteri: study.customerName,
            sonTeklifTarihi: new Date().toISOString().slice(0, 10),
            sonTeklifNo: `FEAS-${studyNo}`,
            createdBy: "feasibility",
          }, { canEdit, staging });
        } catch (e) {
          console.warn("Parça kütüphaneye eklenemedi:", e.message);
        }
      }

      setSaveResult({ ok: true, ...out, message: `Yapılabilirlik kaydedildi: ${studyNo}` });
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydetme hatası");
    } finally {
      setSaving(false);
    }
  };

  // "Bölümümü Tamamla ve İmzala" — kullanıcı aşamasındaki rol için tek tıkla
  // kaydeder + imza atar. Aşama sıradaki role otomatik geçer.
  const [completing, setCompleting] = useState(false);
  const currentPendingRole = getPendingRoleForStudy(study);
  const isPendingOnMe = isUserPendingForStudy(study, { isAdmin, isSales, isUretim });
  // Admin (GM) her rol için imzalayabilir; diğerleri sadece kendi rolüne karşılık gelen aşamada.
  const myRoleKey = isAdmin ? currentPendingRole
    : isSales ? "salesManager"
    : isUretim ? "technicalUnit"
    : null;
  const canCompleteCurrent = !readonlyForm && canEdit && !!currentPendingRole && (
    isAdmin || (isSales && currentPendingRole === "salesManager") || (isUretim && currentPendingRole === "technicalUnit")
  );

  const handleCompleteSection = async () => {
    if (readonlyForm || !canEdit || !currentPendingRole) return;
    if (!studyNo) { setError("Yapılabilirlik no boş"); return; }
    if (!study.customerName) { setError("Müşteri adı zorunlu"); return; }
    if (!study.partName && !study.partNo) { setError("Parça adı veya no zorunlu"); return; }
    // Kullanıcının kendi rolünün soruları eksik mi uyar
    if (currentPendingRole === "salesManager" && salesAnswered < SALES_QUESTIONS.length) {
      if (!confirm(`Satış tarafında ${SALES_QUESTIONS.length - salesAnswered} soru cevapsız. Yine de tamamlanıp gönderilsin mi?`)) return;
    }
    if (currentPendingRole === "technicalUnit" && technicalAnswered < TECHNICAL_QUESTIONS.length) {
      if (!confirm(`Teknik tarafta ${TECHNICAL_QUESTIONS.length - technicalAnswered} soru cevapsız. Yine de tamamlanıp gönderilsin mi?`)) return;
    }
    setCompleting(true); setError("");
    try {
      // 1) Kaydet
      const payload = { ...study, studyNo };
      await saveFeasibilityStudy(payload, { canEdit, staging, userEmail: "" });
      // 2) İmza at
      await signFeasibilityRole(studyNo, currentPendingRole, {
        signerName: userEmail || userDisplayRole,
        signerRoleLabel: userDisplayRole,
        isGeneralManager: isAdmin,
        canEdit, staging,
      });
      // 3) Local state'e imza kaydını da işle → status derhal ilerlesin
      const now = new Date().toISOString();
      setStudy(prev => ({
        ...prev,
        signatures: {
          ...(prev.signatures || {}),
          [currentPendingRole]: {
            signedAt: now,
            signedBy: userEmail || userDisplayRole,
            signedForRole: currentPendingRole,
            actualRole: userDisplayRole,
          },
        },
      }));
      setSaveResult({ ok: true, message: `Bölümünüz tamamlandı, imza atıldı — sıradaki aşamaya geçildi.` });
    } catch (e) {
      setError(e.message || "Tamamlama hatası");
    } finally {
      setCompleting(false);
    }
  };

  // Delegate seçici popup — İmzala butonu bunu tetikler.
  // Kullanıcı hangi role için imzalayacağını seçer (kendi rolü veya delegate).
  const openSignPicker = (roleKey) => {
    if (!studyNo) { setError("Önce yapılabilirliği kaydet"); return; }
    if (roleKey === GM_ROLE_KEY && !isGM) {
      setError("Genel Müdür imzası için sadece GM yetkilidir");
      return;
    }
    setSignRolePicker({ roleKey });
  };

  // Gerçek imza atma — popup'ta "Onayla" basınca çağrılır.
  // signerRoleLabel: imzayı atan kişinin GERÇEK rolü (audit için)
  const handleSignRole = async (roleKey, signerRoleLabel) => {
    try {
      await signFeasibilityRole(studyNo, roleKey, {
        signerName: userEmail || "kullanıcı",
        signerRoleLabel: signerRoleLabel || userDisplayRole,
        isGeneralManager: isGM,
        canEdit,
        staging,
      });
      // State'i optimist güncelle
      const targetRoleLabel = FEASIBILITY_ROLES.find(r => r.key === roleKey)?.label;
      setStudy(prev => ({
        ...prev,
        signatures: {
          ...(prev.signatures || {}),
          [roleKey]: {
            signedAt: new Date().toISOString(),
            signedBy: userEmail || "kullanıcı",
            signedForRole: roleKey,
            actualRole: signerRoleLabel || userDisplayRole,
            isDelegate: targetRoleLabel !== (signerRoleLabel || userDisplayRole),
          },
        },
      }));
      setSignRolePicker(null);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleUnsignRole = async (roleKey) => {
    if (!confirm(`${FEASIBILITY_ROLES.find(r => r.key === roleKey)?.label} imzası iptal edilsin mi?`)) return;
    try {
      await unsignFeasibilityRole(studyNo, roleKey, { canEdit, staging });
      setStudy(prev => {
        const next = { ...prev, signatures: { ...(prev.signatures || {}) } };
        delete next.signatures[roleKey];
        return next;
      });
    } catch (e) {
      alert(e.message);
    }
  };

  const sigCount = countSignatures(study);
  // status + readonlyForm tanımları yukarıda (scoreInfo useMemo'larından önce) yapıldı.

  const cardStyle = { padding: 14, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff", marginBottom: 12 };
  const labelStyle = { display: "block", fontSize: 11, color: "#57534e", marginBottom: 3, fontWeight: 500 };
  const inputStyle = { width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
  const disabledInput = { ...inputStyle, background: "#f5f5f4", color: "#78716c" };

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
        💡 <b>Yapılabilirlik</b> — müşteri talebi geldiğinde teknik + ticari ekipler değerlendirir. Onaylanınca doğrudan satışçıya düşer, teklife dönüşür.
      </div>

      {/* KİLİT BANNER — Y-4: onaylı yapılabilirlik form kilitli */}
      {isLocked && (
        <div style={{ marginBottom: 12, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 12, color: "#991b1b", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              {status === "convertedToQuote" ? "Teklife Dönüştü — Kilitli" : "Onaylı — Kilitli"}
            </div>
            <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 2 }}>
              Form alanları düzenleme kilitli. Değişiklik gerekliyse ekipten bir imzayı iptal et → değerlendirmeye döner.
              {status === "convertedToQuote" && study.linkedQuoteNo && (
                <span style={{ marginLeft: 6 }}>Bağlı teklif: <b style={{ fontFamily: "ui-monospace, monospace" }}>{study.linkedQuoteNo}</b></span>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging (test)
        </label>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "#57534e" }}>
          Durum: <b style={{
            color: status === "approved" ? "#166534" : status === "rejected" ? "#991b1b" : status === "convertedToQuote" ? "#1e40af" : "#92400e",
          }}>{
            status === "draft" ? "📝 Taslak"
            : status === "evaluating" ? `⏳ Değerlendirmede (${sigCount.signed}/${sigCount.total})`
            : status === "approved" ? "✅ Onaylı"
            : status === "rejected" ? "❌ Reddedildi"
            : status === "convertedToQuote" ? "💼 Teklife Dönüştü"
            : status
          }</b>
        </div>
      </div>

      {/* PARÇA ARAMA — Faz Y-3D */}
      <div style={{ ...cardStyle, background: "#f0f9ff", border: "1px solid #bfdbfe" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>🔍 Parça Ara / Ekle</div>
          {study.stockCode && (
            <span style={{ padding: "2px 8px", background: "#dbeafe", color: "#1e40af", borderRadius: 3, fontSize: 10, fontWeight: 500 }}>
              Kütüphaneden: <b style={{ fontFamily: "ui-monospace, monospace" }}>{study.stockCode}</b>
            </span>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <input
            value={partSearchQuery}
            onChange={e => { setPartSearchQuery(e.target.value); setPartSearchOpen(true); }}
            onFocus={() => setPartSearchOpen(true)}
            placeholder="Stok kodu, parça adı veya müşteri kodu ile ara (en az 2 karakter)..."
            disabled={readonlyForm}
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          />
          {partSearchOpen && partSearchResults.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, background: "#fff", border: "1px solid #d6d3d1", borderRadius: 4, boxShadow: "0 4px 8px rgba(0,0,0,0.08)", zIndex: 10, maxHeight: 300, overflowY: "auto" }}>
              {partSearchResults.map(p => (
                <div key={p.stokKodu}
                  onClick={() => setConfirmApplyPart(p)}
                  style={{ padding: 8, borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f5f5f4"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 500 }}>{p.stokKodu}</span>
                    {p.musteriKodu && <span style={{ fontSize: 9, color: "#78716c", padding: "1px 5px", background: "#f5f5f4", borderRadius: 2 }}>müş: {p.musteriKodu}</span>}
                    <span style={{ padding: "1px 5px", background: "#dcfce7", color: "#166534", borderRadius: 2, fontSize: 9, fontWeight: 500 }}>
                      {p.kullanimSayisi || 0}× kullanıldı
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#44403c", marginTop: 2 }}>{p.stokAdi || "—"}</div>
                  <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>
                    Son teklif: {p.sonTeklifTarihi || "—"} · {p.sonMusteri || "?"}
                  </div>
                </div>
              ))}
            </div>
          )}
          {partSearchOpen && partSearchQuery.length >= 2 && partSearchResults.length === 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11, color: "#92400e", zIndex: 10 }}>
              🆕 Bu arama için parça bulunamadı — bu **yeni** bir parça. Aşağıdaki formu manuel doldurabilirsin. Kayıt sonrası kütüphaneye eklenir.
            </div>
          )}
        </div>
        {partSearchOpen && (
          <button onClick={() => setPartSearchOpen(false)}
            style={{ marginTop: 6, padding: "2px 8px", fontSize: 10, background: "transparent", color: "#78716c", border: "none", cursor: "pointer" }}>
            × arama kapat
          </button>
        )}

        {/* Referans teklifler */}
        {study.stockCode && referenceQuotes.length > 0 && (
          <div style={{ marginTop: 8, padding: 8, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#44403c", marginBottom: 4 }}>🎯 Referans Teklifler ({currentYear})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {referenceQuotes.map((q, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 10, color: "#57534e" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{q.quoteNo}</span>
                  <span>{q.customerName}</span>
                  <span style={{ color: "#78716c" }}>{q.quoteDate}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(q.totalPriceTl || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {q.currency || "TL"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* KAPAK — Bilgi */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>1️⃣ Bilgi</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Yapılabilirlik No</label>
            <input value={studyNo} onChange={e => setStudyNo(e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontWeight: 500 }} />
          </div>
          <div>
            <label style={labelStyle}>Tarih (bugün)</label>
            <div style={{ ...disabledInput, padding: "6px 10px" }}>{new Date().toISOString().slice(0, 10)}</div>
          </div>
          <div>
            <label style={labelStyle}>Müşteri Adı *</label>
            <input list="feasibilityCustomerList" value={study.customerName || ""} onChange={e => applyCustomer(e.target.value)} disabled={readonlyForm} style={inputStyle} placeholder="Yaz veya listeden seç" />
            <datalist id="feasibilityCustomerList">
              {customerList.map(c => (
                <option key={c.name} value={c.name}>{c.totalQuotes || 0} teklif · son: {c.lastQuoteDate || "—"}</option>
              ))}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Müşteri Kodu</label>
            <input value={study.customerCode || ""} onChange={e => update("customerCode", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Parça Adı</label>
            <input value={study.partName || ""} onChange={e => update("partName", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Parça No / Stok Kodu</label>
            <input value={study.partNo || ""} onChange={e => update("partNo", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
          </div>
          <div>
            <label style={labelStyle}>Müşteri Parça Kodu</label>
            <input value={study.musteriKodu || ""} onChange={e => update("musteriKodu", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
          </div>
          <div>
            <label style={labelStyle}>Müşteri Teklif No</label>
            <input value={study.customerQuoteNo || ""} onChange={e => update("customerQuoteNo", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Müşteri İrtibat (tel)</label>
            <input value={study.customerContact || ""} onChange={e => update("customerContact", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Müşteri E-posta</label>
            <input value={study.customerEmail || ""} onChange={e => update("customerEmail", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Sevkiyat Adresi</label>
            <input value={study.shipmentAddress || ""} onChange={e => update("shipmentAddress", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Diğer Kalite Şartları</label>
            <textarea value={study.otherQualityRequirements || ""} onChange={e => update("otherQualityRequirements", e.target.value)} disabled={readonlyForm} rows={2} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginTop: 10, padding: 8, background: "#f9fafb", borderRadius: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Gelen Veri</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
            {RECEIVED_DATA_TYPES.map(t => (
              <label key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={!!study.receivedData?.[t.key]} onChange={e => updateReceived(t.key, e.target.checked)} disabled={readonlyForm} />
                {t.label}
              </label>
            ))}
          </div>

          {/* Teknik resim seçildiyse dosya yükleme alanı — çoklu dosya destekli */}
          {study.receivedData?.technicalDrawing && (
            <TechnicalDrawingUploader
              studyNo={studyNo}
              files={study.receivedFiles?.technicalDrawing || []}
              onChange={(files) => setStudy(prev => ({
                ...prev,
                receivedFiles: { ...(prev.receivedFiles || {}), technicalDrawing: files },
              }))}
              canEdit={canEdit}
              readonly={readonlyForm}
            />
          )}
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
          <div>
            <label style={labelStyle}>İş Türü</label>
            <div style={{ display: "flex", gap: 10 }}>
              {WORK_TYPES.map(t => (
                <label key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input type="radio" name="workType" checked={study.workType === t.key} onChange={() => update("workType", t.key)} disabled={readonlyForm} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>



      {/* İSTER TABLOSU */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>2️⃣ Müşteri İsterleri</div>
          <button onClick={addDemand} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ İster Ekle</button>
        </div>
        {(study.demands || []).length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz ister yok</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>İSTER</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>İSTER DETAYI</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>DENMA ÖNGÖRÜSÜ</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>MÜŞTERİ ÖNGÖRÜSÜ</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>AÇIKLAMA</th>
                <th style={{ padding: "5px 8px", width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {(study.demands || []).map((d, i) => (
                <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "3px 4px" }}><input value={d.demand || ""} onChange={e => updateDemand(i, "demand", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                  <td style={{ padding: "3px 4px" }}><input value={d.demandDetail || ""} onChange={e => updateDemand(i, "demandDetail", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                  <td style={{ padding: "3px 4px" }}><input value={d.denmaAssessment || ""} onChange={e => updateDemand(i, "denmaAssessment", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                  <td style={{ padding: "3px 4px" }}><input value={d.customerAssessment || ""} onChange={e => updateDemand(i, "customerAssessment", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                  <td style={{ padding: "3px 4px" }}><input value={d.note || ""} onChange={e => updateDemand(i, "note", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                  <td style={{ padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeDemand(i)} disabled={readonlyForm} style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* DEĞERLENDİRME — 2 panel (Satış + Teknik), puanlı */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>3️⃣ Yapılabilirlik Değerlendirmesi</div>
          <div style={{ fontSize: 11, color: "#78716c" }}>
            {salesAnswered + technicalAnswered}/{SALES_QUESTIONS.length + TECHNICAL_QUESTIONS.length} soru cevaplandı
          </div>
        </div>

        {/* Canlı skor + öneri kutucuğu */}
        <div style={{ padding: 12, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 6, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#44403c" }}>Toplam Puan</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: recommendation.color, fontVariantNumeric: "tabular-nums" }}>
              {scoreInfo.totalScore} / {scoreInfo.totalMax} <span style={{ fontSize: 12, color: "#78716c", fontWeight: 500 }}>({scoreInfo.percent}%)</span>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ width: "100%", height: 10, background: "#e7e5e4", borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${scoreInfo.percent}%`, height: "100%", background: recommendation.color, transition: "width 0.3s" }} />
          </div>
          {/* Bölüm bazlı */}
          <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#57534e", marginBottom: 8 }}>
            <div>💼 Satış: <b>{scoreInfo.sales.score}/{scoreInfo.sales.max}</b> ({scoreInfo.sales.percent}%)</div>
            <div>⚙️ Teknik: <b>{scoreInfo.technical.score}/{scoreInfo.technical.max}</b> ({scoreInfo.technical.percent}%)</div>
          </div>
          {/* Öneri */}
          <div style={{ padding: 8, background: recommendation.bg, borderRadius: 4, borderLeft: `4px solid ${recommendation.color}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: recommendation.color }}>
              Sistem Önerisi: {recommendation.label}
            </div>
            <div style={{ fontSize: 10, color: "#57534e", marginTop: 2 }}>{recommendation.description}</div>
            {scoreInfo.percent < 50 && (
              <div style={{ fontSize: 10, color: "#991b1b", marginTop: 4, fontWeight: 500 }}>
                ⚠ Teklife dönüşüm için Genel Müdür imzası zorunlu.
              </div>
            )}
          </div>
        </div>

        {/* Müzakere ipuçları — 50-74 aralığında en yararlı */}
        {negotiationHints.length > 0 && scoreInfo.percent < 75 && (
          <div style={{ padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>
              💬 Müzakere / İyileştirme İpuçları ({negotiationHints.length})
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 10, color: "#78716c" }}>
              {negotiationHints.map((h, i) => (
                <li key={i} style={{ marginBottom: 3 }}>
                  <span style={{ color: "#44403c" }}>{h.hint}</span>
                  <span style={{ marginLeft: 4, color: "#a8a29e" }}>(puan {h.score}/{h.max})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* İki panel: Satış + Teknik */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <EvaluationPanel
            title="💼 Satış ve Proje" color="#1e40af" bg="#eff6ff"
            questions={SALES_QUESTIONS}
            sectionScore={scoreInfo.sales}
            evaluation={study.evaluation || {}}
            onUpdate={updateEvaluation}
            canEdit={canEditSales}
            answered={salesAnswered}
          />
          <EvaluationPanel
            title="⚙️ Teknik" color="#0f766e" bg="#f0fdfa"
            questions={TECHNICAL_QUESTIONS}
            sectionScore={scoreInfo.technical}
            evaluation={study.evaluation || {}}
            onUpdate={updateEvaluation}
            canEdit={canEditTechnical}
            answered={technicalAnswered}
          />
        </div>
      </div>

      {/* HAMMADDE BLOĞU — Faz Y-3D (üretim öncesi bilgiler) */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>🧱 Hammadde Bilgisi</div>
        <div style={{ fontSize: 10, color: "#78716c", marginBottom: 10 }}>
          Malzeme türü + ölçüler + ağırlık — bu bilgiler teklife hammadde olarak birebir aktarılır.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Malzeme Türü</label>
            <input list="feasibilityMaterialList" value={study.materialType || ""} onChange={e => update("materialType", e.target.value)} disabled={readonlyForm} style={inputStyle} placeholder="AL-6061..." />
            <datalist id="feasibilityMaterialList">
              {materialList.map(m => (
                <option key={m.name} value={m.name}>{m.shape} · {m.priceTlPerKg}TL/kg</option>
              ))}
            </datalist>
            {selectedMaterialMaster && (
              <div style={{ fontSize: 9, color: "#1e40af", marginTop: 2 }}>
                💡 {selectedMaterialMaster.shape} · özgül {selectedMaterialMaster.density} · <b>{Number(selectedMaterialMaster.priceTlPerKg || 0).toFixed(2)} TL/kg</b>
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Şekil</label>
            <select value={study.materialShape || selectedMaterialMaster?.shape || ""} onChange={e => update("materialShape", e.target.value)} disabled={readonlyForm} style={inputStyle}>
              <option value="">—</option>
              <option value="DİKDÖRTGEN">DİKDÖRTGEN</option>
              <option value="SİLİNDİR">SİLİNDİR</option>
              <option value="ALTIGEN">ALTIGEN</option>
              <option value="EBATSIZ">EBATSIZ</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>EN (mm)</label>
            <input type="number" value={study.dimensions?.en || 0} onChange={e => update("dimensions", { ...(study.dimensions || {}), en: Number(e.target.value) || 0 })} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>BOY (mm)</label>
            <input type="number" value={study.dimensions?.boy || 0} onChange={e => update("dimensions", { ...(study.dimensions || {}), boy: Number(e.target.value) || 0 })} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>UZUNLUK (mm)</label>
            <input type="number" value={study.dimensions?.uzunluk || 0} onChange={e => update("dimensions", { ...(study.dimensions || {}), uzunluk: Number(e.target.value) || 0 })} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Ağırlık kg <span style={{ fontSize: 9, color: "#78716c" }}>(auto)</span></label>
            <input type="number" step="0.001"
              value={study.weightKg || 0}
              onChange={e => update("weightKg", Number(e.target.value) || 0)}
              placeholder={autoWeightKg > 0 ? autoWeightKg.toFixed(3) : "0.000"}
              disabled={readonlyForm}
              style={{ ...inputStyle, background: "#fef3c7" }} />
            {autoWeightKg > 0 && Math.abs((study.weightKg || 0) - autoWeightKg) > 0.001 && (
              <button onClick={() => update("weightKg", Number(autoWeightKg.toFixed(4)))} disabled={readonlyForm}
                style={{ marginTop: 2, padding: "2px 6px", fontSize: 9, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 2, cursor: "pointer" }}>
                ↺ auto: {autoWeightKg.toFixed(3)}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 3fr", gap: 8, marginTop: 8 }}>
          <div>
            <label style={labelStyle}>Sipariş Miktarı</label>
            <input type="number" value={study.quantity || 1} onChange={e => update("quantity", Number(e.target.value) || 1)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Malzeme Notu (eski alan)</label>
            <input value={study.material || ""} onChange={e => update("material", e.target.value)} disabled={readonlyForm} placeholder="opsiyonel" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Yardımcı Malzeme</label>
            <input value={study.otherMaterials || ""} onChange={e => update("otherMaterials", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* OPERASYONLAR — Üretim / CAD-CAM sorumlusu (Faz Y-3C) */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            ⚙️ Operasyon ve Süre
            {effectiveOpCount > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: "#57534e", fontWeight: 500 }}>
                · {effectiveOpCount} operasyon · Toplam: <b>{effectiveTotalMin.toLocaleString("tr-TR")} dk</b>
                {effectiveTotalMin > 0 && <span style={{ marginLeft: 4, color: "#78716c" }}>({(effectiveTotalMin / 60).toFixed(2)} sa)</span>}
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#78716c", marginBottom: 10 }}>
          Üretim / CAD-CAM sorumlusu: her operasyon için tezgah ve süreyi giriniz. Toplam operasyon sayısı ve süre otomatik hesaplanır; teklife makine bazlı aktarılır.
        </div>

        {/* Detay tablosu — tek giriş yolu (tezgah + süre) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#44403c" }}>
            Operasyon Detayı
            {machineRatesData?.machines?.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 400, color: "#a8a29e" }}>
                · {machineRatesData.machines.length} tezgah listelendi
              </span>
            )}
          </div>
          <button onClick={addOperationDetail} disabled={readonlyForm}
            style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>
            + Operasyon Ekle
          </button>
        </div>
        {opsDetailCount === 0 ? (
          <div style={{ padding: 12, textAlign: "center", color: "#a8a29e", fontSize: 10, background: "#fafaf9", borderRadius: 4 }}>
            Henüz operasyon eklenmedi — üstteki <b>+ Operasyon Ekle</b> ile başlayın.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 40, textAlign: "center" }}>#</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Operasyon Adı</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Makine</th>
                <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 100, textAlign: "right" }}>Süre (dk)</th>
                <th style={{ padding: "5px 8px", width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {(study.operations?.details || []).map((op, i) => (
                <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "3px 6px", textAlign: "center", color: "#78716c" }}>{i + 1}</td>
                  <td style={{ padding: "3px 4px" }}>
                    <input value={op.operationName || ""} onChange={e => updateOperationDetail(i, "operationName", e.target.value)} disabled={readonlyForm}
                      placeholder="örn. Frezeleme" style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <select value={op.machine || ""} onChange={e => updateOperationDetail(i, "machine", e.target.value)} disabled={readonlyForm}
                      style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2, background: "#fff" }}>
                      <option value="">— tezgah seç —</option>
                      {(machineRatesData?.machines || []).map(mc => (
                        <option key={mc.id} value={mc.name}>{mc.name} ({mc.wcName})</option>
                      ))}
                      {op.machine && !(machineRatesData?.machines || []).some(mc => mc.name === op.machine) && (
                        <option value={op.machine}>{op.machine} (eski / listede yok)</option>
                      )}
                    </select>
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <input type="number" step="0.1" min="0" value={op.minutes || 0} onChange={e => updateOperationDetail(i, "minutes", Number(e.target.value) || 0)} disabled={readonlyForm}
                      style={{ width: "100%", padding: 3, fontSize: 10, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "center" }}>
                    <button onClick={() => removeOperationDetail(i)} disabled={readonlyForm}
                      style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f9fafb", borderTop: "2px solid #e7e5e4" }}>
                <td colSpan="3" style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#57534e" }}>Toplam:</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#166534" }}>
                  {opsDetailTotal.toLocaleString("tr-TR")} dk
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}

        <div style={{ marginTop: 8 }}>
          <label style={labelStyle}>Operasyon Notu</label>
          <input value={study.operations?.note || ""} onChange={e => updateOperations("note", e.target.value)} disabled={readonlyForm}
            placeholder="Örn. Hassas tolerans, özel setup gerekli..." style={inputStyle} />
        </div>
      </div>

      {/* KALEM DETAYI — Aparat/Takım/Model/Ölçme + Fason (Faz Y-3A) */}
      {ITEM_CATEGORIES.map(cat => {
        const arrKey = cat.key === "tooling" ? "toolingItems" : "fasonItems";
        const items = study[arrKey] || [];
        const total = cat.key === "tooling" ? toolingTotal : fasonTotal;
        return (
          <div key={cat.key} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {cat.icon} {cat.label}
                {items.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#57534e", fontWeight: 500 }}>
                    · {items.length} kalem · Toplam: <b>{total.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</b>
                  </span>
                )}
              </div>
              <button onClick={() => addItem(cat.key)} disabled={readonlyForm}
                style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>
                + Kalem Ekle
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#78716c", marginBottom: 8 }}>{cat.description}</div>
            {items.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "#a8a29e", fontSize: 11, background: "#fafaf9", borderRadius: 4 }}>Henüz kalem yok</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 780 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9 }}>Ad</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9 }}>Açıklama</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, width: 60, textAlign: "right" }}>Adet</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, width: 90, textAlign: "right" }}>Birim TL</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, width: 90, textAlign: "right" }}>Tutar</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, width: 90 }}>Tedarik</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9 }}>Tedarikçi</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, width: 70, textAlign: "right" }}>Termin (gün)</th>
                      <th style={{ padding: "5px 6px", width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const lineTotal = (Number(it.qty) || 0) * (Number(it.unitCost) || 0);
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                          <td style={{ padding: "3px 4px" }}>
                            {cat.key === "fason" ? (
                              <>
                                <input list={`fasonList_${i}`} value={it.name || ""} onChange={e => updateItem(cat.key, i, "name", e.target.value)} disabled={readonlyForm}
                                  placeholder="Fason iş (listeden seç veya yaz)" style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                                <datalist id={`fasonList_${i}`}>
                                  {fasonList.map(w => <option key={w.id || w.name} value={w.name} />)}
                                </datalist>
                              </>
                            ) : (
                              <input value={it.name || ""} onChange={e => updateItem(cat.key, i, "name", e.target.value)} disabled={readonlyForm}
                                placeholder="örn. Bağlama fikstürü" style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                            )}
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={it.description || ""} onChange={e => updateItem(cat.key, i, "description", e.target.value)} disabled={readonlyForm}
                              placeholder="ebat/özellik" style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input type="number" step="1" value={it.qty || 0} onChange={e => updateItem(cat.key, i, "qty", Number(e.target.value) || 0)} disabled={readonlyForm}
                              style={{ width: "100%", padding: 3, fontSize: 10, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input type="number" step="0.01" value={it.unitCost || 0} onChange={e => updateItem(cat.key, i, "unitCost", Number(e.target.value) || 0)} disabled={readonlyForm}
                              style={{ width: "100%", padding: 3, fontSize: 10, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600, color: "#166534", fontVariantNumeric: "tabular-nums" }}>
                            {lineTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <select value={it.sourceType || "direct"} onChange={e => updateItem(cat.key, i, "sourceType", e.target.value)} disabled={readonlyForm}
                              style={{ width: "100%", padding: 2, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2, background: "#fff" }}>
                              {SOURCE_TYPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={it.supplier || ""} onChange={e => updateItem(cat.key, i, "supplier", e.target.value)} disabled={readonlyForm}
                              placeholder="firma" style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input type="number" step="1" value={it.deliveryDays || 0} onChange={e => updateItem(cat.key, i, "deliveryDays", Number(e.target.value) || 0)} disabled={readonlyForm}
                              style={{ width: "100%", padding: 3, fontSize: 10, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 6px", textAlign: "center" }}>
                            <button onClick={() => removeItem(cat.key, i)} disabled={readonlyForm}
                              style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f9fafb", borderTop: "2px solid #e7e5e4" }}>
                      <td colSpan="4" style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#57534e" }}>Toplam:</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#166534", fontVariantNumeric: "tabular-nums" }}>
                        {total.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL
                      </td>
                      <td colSpan="4"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* KARAR */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>5️⃣ Alınan Karar</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {DECISIONS.map(d => (
            <button key={d.key}
              onClick={() => update("decision", d.key)}
              disabled={readonlyForm}
              style={{
                padding: "8px 14px", border: "1px solid " + (study.decision === d.key ? d.color : "#d6d3d1"),
                background: study.decision === d.key ? d.bg : "#fff",
                color: study.decision === d.key ? d.color : "#57534e",
                fontSize: 12, fontWeight: study.decision === d.key ? 600 : 400,
                borderRadius: 4, cursor: readonlyForm ? "not-allowed" : "pointer",
              }}>
              {d.label}
            </button>
          ))}
        </div>
        <label style={labelStyle}>Açıklama / Müşteriye Yapılacak Öneriler</label>
        <textarea value={study.recommendations || ""} onChange={e => update("recommendations", e.target.value)} disabled={readonlyForm} rows={3} style={inputStyle} />
      </div>

      {/* İMZALAR */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>6️⃣ Yapılabilirlik Ekibi İmzaları
          <span style={{ marginLeft: 8, fontSize: 11, color: "#78716c", fontWeight: 400 }}>({sigCount.signed}/{sigCount.total})</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {FEASIBILITY_ROLES.map(r => {
            const sig = study.signatures?.[r.key];
            const isGmRole = r.key === GM_ROLE_KEY;
            const canSignThis = !isGmRole || isGM; // GM rolüne sadece GM
            return (
              <div key={r.key} style={{ padding: 8, border: "1px solid " + (sig ? "#86efac" : "#e7e5e4"), background: sig ? "#f0fdf4" : "#fafaf9", borderRadius: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#44403c", marginBottom: 4 }}>
                  {isGmRole && "⭐ "}{r.label}
                </div>
                {sig ? (
                  <>
                    <div style={{ fontSize: 9, color: "#166534", fontWeight: 600 }}>✓ İmzalandı</div>
                    <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>
                      {String(sig.signedAt).slice(0, 10)}
                      {sig.isDelegate && <span style={{ display: "block", color: "#d97706" }}>({sig.actualRole} yerine)</span>}
                    </div>
                    {!explicitReadOnly && canEdit && (
                      <button onClick={() => handleUnsignRole(r.key)}
                        style={{ marginTop: 4, padding: "2px 6px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>
                        ↺ İptal
                      </button>
                    )}
                  </>
                ) : (
                  <button onClick={() => canSignThis ? openSignPicker(r.key) : alert("GM imzası için sadece GM yetkilidir")}
                    disabled={!canEdit}
                    style={{ padding: "4px 8px", fontSize: 10, background: canSignThis ? "#1e40af" : "#e7e5e4", color: canSignThis ? "#fff" : "#a8a29e", border: "none", borderRadius: 3, cursor: (!canEdit || !canSignThis) ? "not-allowed" : "pointer" }}>
                    {canSignThis ? "İmzala" : "Sadece GM"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "#78716c", marginTop: 8 }}>
          💡 GM rolü hariç herkes başka rol adına imzalayabilir. GM imzası için sadece Genel Müdür yetkilidir.
        </div>
      </div>

      {/* Hata / Save Result / Save button */}
      {error && (
        <div style={{ margin: "0 0 10px", padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11, color: "#991b1b" }}>
          ⚠ {error}
        </div>
      )}
      {saveResult?.ok && (
        <div style={{ margin: "0 0 10px", padding: 10, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, fontSize: 11, color: "#166534" }}>
          ✓ {saveResult.message}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 20 }}>
        <button onClick={async () => {
          try {
            await generateFeasibilityPdf({ ...study, studyNo });
          } catch (e) {
            alert("PDF hatası: " + e.message);
          }
        }}
          style={{ padding: "8px 16px", fontSize: 13, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
          📄 PDF Önizle
        </button>
        {!readonlyForm && (
          <button onClick={handleSave} disabled={saving || completing || !canEdit}
            style={{ padding: "8px 20px", fontSize: 13, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: (saving || completing) ? "wait" : (canEdit ? "pointer" : "not-allowed"), fontWeight: 500 }}>
            {saving ? "Kaydediliyor..." : "💾 Ara Taslak Kaydet"}
          </button>
        )}
        {!readonlyForm && canCompleteCurrent && (
          <button onClick={handleCompleteSection} disabled={completing || saving}
            title={`${currentPendingRole === "salesManager" ? "Satış" : currentPendingRole === "technicalUnit" ? "Teknik" : "GM"} bölümünü tamamla ve imzala`}
            style={{ padding: "8px 20px", fontSize: 13, background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: completing ? "wait" : "pointer", fontWeight: 600 }}>
            {completing ? "Gönderiliyor..." : "✅ Bölümümü Tamamla ve İmzala"}
          </button>
        )}
      </div>

      {/* DELEGATE İMZA SEÇİCİ POPUP — Y-4 */}
      {signRolePicker && (() => {
        const targetRole = FEASIBILITY_ROLES.find(r => r.key === signRolePicker.roleKey);
        const isGmRole = signRolePicker.roleKey === GM_ROLE_KEY;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { if (e.target === e.currentTarget) setSignRolePicker(null); }}>
            <div style={{ background: "#fff", borderRadius: 8, padding: 20, maxWidth: 480, width: "90%", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                ✍️ İmza — <span style={{ color: "#1e40af" }}>{targetRole?.label}</span>
              </div>
              <div style={{ fontSize: 11, color: "#78716c", marginBottom: 12 }}>
                Bu imzayı kim adına atıyorsun?
              </div>

              {isGmRole ? (
                // GM için sadece GM
                <div style={{ padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "#1e40af", fontWeight: 500 }}>
                    ⭐ Genel Müdür rolü sadece GM tarafından imzalanabilir.
                  </div>
                  <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
                    İmzalayan: <b>{userEmail || "sen"}</b> ({userDisplayRole})
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  {/* Seçenek 1: Kendi rolüm için */}
                  <button onClick={() => handleSignRole(signRolePicker.roleKey, userDisplayRole)}
                    style={{ padding: 10, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>
                      ✓ Kendi rolüm — <span style={{ color: "#1c1917" }}>{userDisplayRole}</span>
                    </div>
                    {targetRole?.label !== userDisplayRole && (
                      <div style={{ fontSize: 10, color: "#d97706", marginTop: 3 }}>
                        ⚠ Bu <b>{targetRole?.label}</b> yerine imzalayacaksın (delegate).
                        PDF'te "({userDisplayRole} yerine)" notu görünür.
                      </div>
                    )}
                  </button>
                  {/* Seçenek 2: Farklı rol adına imzala */}
                  <div style={{ fontSize: 10, color: "#78716c", marginTop: 4, marginBottom: 4 }}>
                    Ya da başka bir rol adına imzala:
                  </div>
                  {FEASIBILITY_ROLES.filter(r => r.key !== GM_ROLE_KEY && r.label !== userDisplayRole).map(r => (
                    <button key={r.key}
                      onClick={() => handleSignRole(signRolePicker.roleKey, r.label)}
                      style={{ padding: 8, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 3, cursor: "pointer", textAlign: "left", fontSize: 11 }}>
                      🎭 <b>{r.label}</b> yerine
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <button onClick={() => setSignRolePicker(null)}
                  style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>İptal</button>
                {isGmRole && (
                  <button onClick={() => handleSignRole(signRolePicker.roleKey, "Genel Müdür")}
                    style={{ padding: "6px 14px", fontSize: 12, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
                    ⭐ İmzala
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* PARÇA UYGULAMA ONAY MODALI — Faz Y-3D Karar 1-B */}
      {confirmApplyPart && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmApplyPart(null); }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 20, maxWidth: 500, width: "90%", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e40af", marginBottom: 10 }}>
              🔄 Bu parçadan doldur?
            </div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{confirmApplyPart.stokKodu}</div>
              <div style={{ color: "#57534e", marginTop: 2 }}>{confirmApplyPart.stokAdi || "—"}</div>
              <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
                Son teklif: {confirmApplyPart.sonTeklifTarihi || "—"} · {confirmApplyPart.sonMusteri || "?"}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#92400e", padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, marginBottom: 12 }}>
              ⚠ Aşağıdaki alanlar bu parçadan gelen değerlerle <b>üzerine yazılacak</b>:
              <ul style={{ margin: "4px 0 0 20px", padding: 0, fontSize: 10 }}>
                <li>Parça No, Parça Adı, Müşteri Parça Kodu</li>
                <li>Hammadde (tür, ölçüler, ağırlık)</li>
                <li>Operasyonlar (makine listesi, süre)</li>
                <li>Aparat kalemi (varsa maliyet)</li>
                <li>Fason iş listesi (fiyatları elle güncelle)</li>
              </ul>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmApplyPart(null)}
                style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>İptal</button>
              <button onClick={() => applyPart(confirmApplyPart)}
                style={{ padding: "6px 14px", fontSize: 12, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
                ✓ Evet, Doldur
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Teknik Resim Yükleme ====================

function TechnicalDrawingUploader({ studyNo, files, onChange, canEdit, readonly }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const disabled = !canEdit || readonly || uploading;

  const handleFiles = async (fileList) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    if (!studyNo) { setErr("Önce yapılabilirlik no belirle (ara taslak kaydet)"); return; }
    setUploading(true); setErr("");
    try {
      const uploaded = [];
      for (const f of arr) {
        const meta = await uploadFeasibilityAttachment(studyNo, "technicalDrawing", f, { canEdit });
        uploaded.push(meta);
      }
      onChange([...(files || []), ...uploaded]);
    } catch (e) {
      setErr(e.message || "Yükleme hatası");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (idx) => {
    const target = files[idx];
    if (!target) return;
    if (!confirm(`Silinsin mi?\n${target.name || ""}`)) return;
    try {
      if (target.path) await deleteFeasibilityAttachment(target.path);
    } catch (e) { console.warn(e); }
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div style={{ marginTop: 8, padding: 8, background: "#fff", border: "1px dashed #bfdbfe", borderRadius: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#1e40af" }}>
          📐 Teknik Resim Dosyaları {files.length > 0 && <span style={{ color: "#78716c" }}>· {files.length} dosya</span>}
        </div>
        <label style={{ display: "inline-block", padding: "3px 8px", fontSize: 10, background: disabled ? "#f5f5f4" : "#eff6ff", color: disabled ? "#a8a29e" : "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: disabled ? "not-allowed" : "pointer" }}>
          {uploading ? "Yükleniyor..." : "📤 Dosya Ekle"}
          <input type="file" multiple accept="application/pdf,image/*,.dwg,.dxf,.step,.stp,.iges,.igs" style={{ display: "none" }} disabled={disabled}
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {err && <div style={{ fontSize: 9, color: "#991b1b", marginBottom: 4 }}>⚠ {err}</div>}
      {files.length === 0 ? (
        <div style={{ fontSize: 9, color: "#a8a29e", textAlign: "center", padding: 6 }}>Henüz dosya eklenmedi</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, padding: "2px 4px", background: "#f9fafb", borderRadius: 3 }}>
              <div style={{ flex: 1, wordBreak: "break-all", color: "#1c1917" }}>
                📄 {f.name || "dosya"}
                {f.size ? <span style={{ color: "#78716c", marginLeft: 4 }}>· {(f.size / 1024).toFixed(0)} KB</span> : null}
              </div>
              <a href={f.url} target="_blank" rel="noreferrer" style={{ padding: "1px 5px", fontSize: 9, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, textDecoration: "none" }}>📥 Aç</a>
              {!readonly && (
                <button onClick={() => handleDelete(i)} disabled={!canEdit}
                  style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>🗑</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Değerlendirme Paneli (bölüm) ====================

function EvaluationPanel({ title, color, bg, questions, sectionScore, evaluation, onUpdate, canEdit, answered }) {
  const complete = answered === questions.length;
  return (
    <div style={{ border: `1px solid ${complete ? "#86efac" : "#e7e5e4"}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", background: bg, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
          <span style={{ color: "#57534e" }}>
            <b>{sectionScore.score}/{sectionScore.max}</b> puan ({sectionScore.percent}%)
          </span>
          <span style={{ padding: "2px 8px", background: complete ? "#dcfce7" : "#fff", color: complete ? "#166534" : "#57534e", borderRadius: 3, fontWeight: 600 }}>
            {complete ? "✓ Tamam" : `${answered}/${questions.length}`}
          </span>
        </div>
      </div>
      {!canEdit && (
        <div style={{ padding: "6px 12px", background: "#fef2f2", fontSize: 10, color: "#991b1b", borderBottom: "1px solid #fecaca" }}>
          🔒 Bu bölümü düzenleme yetkiniz yok — sadece görüntüleme.
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 30, textAlign: "center" }}>#</th>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Soru</th>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 200, textAlign: "center" }}>Cevap</th>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 65, textAlign: "right" }}>Puan</th>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Not</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => {
            const v = evaluation?.[q.key] || {};
            const answer = v.answer;
            const points = scoreForAnswer(q, answer);
            const isEmpty = answer == null || answer === "";
            return (
              <tr key={q.key} style={{ borderTop: "1px solid #f5f5f4" }}>
                <td style={{ padding: "6px 8px", textAlign: "center", color: "#78716c" }}>{i + 1}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "pre-wrap" }}>{q.label}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  {q.type === "slider" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="range" min={q.min || 0} max={q.max || 10} step="1"
                        value={Number.isFinite(Number(answer)) ? Number(answer) : 0}
                        onChange={e => onUpdate(q.key, "answer", Number(e.target.value))}
                        disabled={!canEdit} style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, fontWeight: 600, minWidth: 24, textAlign: "right" }}>{Number.isFinite(Number(answer)) ? Number(answer) : "—"}</span>
                    </div>
                  ) : (
                    <div style={{ display: "inline-flex", gap: 4 }}>
                      {EVAL_CHOICES.map(c => {
                        const selected = String(answer).toUpperCase() === c.key;
                        return (
                          <button key={c.key} onClick={() => onUpdate(q.key, "answer", c.key)} disabled={!canEdit}
                            style={{
                              padding: "3px 10px", fontSize: 10, fontWeight: 600, borderRadius: 3,
                              background: selected ? c.color : "#fff",
                              color: selected ? "#fff" : c.color,
                              border: `1px solid ${c.color}`,
                              cursor: canEdit ? "pointer" : "not-allowed",
                              opacity: canEdit ? 1 : 0.7,
                            }}>{c.label}</button>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 600, color: isEmpty ? "#a8a29e" : "#1c1917" }}>
                  {isEmpty ? "—" : `${points}/${q.max}`}
                </td>
                <td style={{ padding: "3px 4px" }}>
                  <input value={v.note || ""} onChange={e => onUpdate(q.key, "note", e.target.value)} disabled={!canEdit}
                    placeholder="Açıklama / detay..."
                    style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ==================== Liste ====================

function FeasibilityListView({ canEdit, isAdmin, isSales, isUretim, onOpen, onCreateQuote }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ studies: {} });
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState({});
  // Toplu teklif dönüştürme için seçim state'i (Faz F4)
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => {
    const unsub = subscribeFeasibilityForYear(year, setData, { staging });
    return unsub;
  }, [year, staging]);

  const studies = useMemo(() => {
    const arr = Object.values(data?.studies || {});
    const q = search.trim().toLocaleLowerCase("tr-TR");
    let f = q ? arr.filter(s =>
      (s.customerName || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (s.partName || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (s.partNo || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (s.studyNo || "").includes(q)
    ) : arr;
    if (onlyMine) {
      f = f.filter(s => isUserPendingForStudy(s, { isAdmin, isSales, isUretim }));
    }
    return f.sort((a, b) => (b.studyNo || "").localeCompare(a.studyNo || ""));
  }, [data, search, onlyMine, isAdmin, isSales, isUretim]);

  // "Sizden Bekleyen" toplamı — badge için filtrelenmemiş listede sayı
  const myPendingCount = useMemo(() => {
    const arr = Object.values(data?.studies || {});
    return arr.filter(s => isUserPendingForStudy(s, { isAdmin, isSales, isUretim })).length;
  }, [data, isAdmin, isSales, isUretim]);

  // Seçili studies (approved + henüz teklife dönmemiş olmalı — teklif dönüştürme için)
  const selectedStudies = useMemo(() => {
    return studies.filter(s => selectedIds.has(s.studyNo) && computeStudyStatus(s) === "approved");
  }, [studies, selectedIds]);

  const selectedCustomer = selectedStudies[0]?.customerName || selectedStudies[0]?.customerCode || null;
  const selectedCustomersDiffer = selectedStudies.length > 1 &&
    selectedStudies.some(s => (s.customerName || s.customerCode) !== selectedCustomer);

  const toggleSelect = (studyNo) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(studyNo)) next.delete(studyNo); else next.add(studyNo);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkQuote = () => {
    if (selectedStudies.length === 0) {
      alert("Seçili onaylı yapılabilirlik yok.");
      return;
    }
    if (selectedCustomersDiffer) {
      alert("Seçili yapılabilirlikler farklı müşterilere ait. Aynı müşteri için seçim yapın.");
      return;
    }
    if (!onCreateQuote) return;
    // App.jsx callback'e array gönder — Teklifler.jsx array veya tek objeyi kabul ediyor
    onCreateQuote(selectedStudies);
    clearSelection();
  };

  const handleDelete = async (studyNo, isConverted = false) => {
    const msg = isConverted
      ? `Yapılabilirlik ${studyNo} teklife dönüşmüş. Sadece ilgili teklif silinmişse silinebilir. Devam edilsin mi?`
      : `Yapılabilirlik ${studyNo} silinsin mi?`;
    if (!confirm(msg)) return;
    setDeleting(d => ({ ...d, [studyNo]: true }));
    try {
      await deleteFeasibilityStudy(studyNo, { canEdit, staging });
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(d => ({ ...d, [studyNo]: false }));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#57534e" }}>Yıl:</label>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}>
          {["2024", "2025", "2026"].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging
        </label>
        <button onClick={() => setOnlyMine(v => !v)}
          title="Sadece sizden aksiyon bekleyen yapılabilirlikleri göster"
          style={{
            padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 4,
            border: `1px solid ${onlyMine ? "#991b1b" : "#d6d3d1"}`,
            background: onlyMine ? "#fef2f2" : "#fff",
            color: onlyMine ? "#991b1b" : "#57534e",
            cursor: "pointer",
          }}>
          🔔 Sizden Bekleyen{myPendingCount > 0 && ` (${myPendingCount})`}
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 no / müşteri / parça"
          style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }} />
        <span style={{ fontSize: 11, color: "#78716c" }}>{studies.length} kayıt</span>
      </div>

      {/* Toplu teklif dönüştürme toolbar'ı (Faz F4) — sadece 1+ onaylı seçili olduğunda */}
      {selectedStudies.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 12px",
          background: selectedCustomersDiffer ? "#fef2f2" : "#eff6ff",
          border: `1px solid ${selectedCustomersDiffer ? "#fecaca" : "#bfdbfe"}`,
          borderRadius: 6, fontSize: 12,
        }}>
          <span style={{ color: selectedCustomersDiffer ? "#991b1b" : "#1e40af", fontWeight: 500 }}>
            {selectedCustomersDiffer
              ? `⚠ ${selectedStudies.length} seçili — farklı müşteriler var, aynı müşteri şart`
              : `✅ ${selectedStudies.length} onaylı yapılabilirlik seçili — ${selectedCustomer}`}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={handleBulkQuote}
            disabled={selectedCustomersDiffer || !onCreateQuote}
            style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 500,
              background: selectedCustomersDiffer ? "#e7e5e4" : "#1e40af",
              color: selectedCustomersDiffer ? "#a8a29e" : "#fff",
              border: "none", borderRadius: 4,
              cursor: selectedCustomersDiffer ? "not-allowed" : "pointer",
            }}>
            💼 Seçilenleri Teklife Dönüştür
          </button>
          <button onClick={clearSelection}
            style={{ padding: "5px 10px", fontSize: 11, background: "#fff", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
            Seçimi Temizle
          </button>
        </div>
      )}

      {studies.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          Bu yılda yapılabilirlik yok.
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                <th style={{ padding: "8px 10px", width: 26, textAlign: "center" }} title="Onaylı olanları seç"></th>
                <th style={{ padding: "8px 10px" }}>Yapılabilirlik No</th>
                <th style={{ padding: "8px 10px" }}>Müşteri</th>
                <th style={{ padding: "8px 10px" }}>Parça</th>
                <th style={{ padding: "8px 10px" }}>Durum</th>
                <th style={{ padding: "8px 10px" }}>İmza</th>
                <th style={{ padding: "8px 10px" }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {studies.map(s => {
                const status = computeStudyStatus(s);
                const sig = countSignatures(s);
                const badge = status === "approved" ? { bg: "#dcfce7", fg: "#166534", l: "✅ Onaylı" }
                  : status === "rejected" ? { bg: "#fee2e2", fg: "#991b1b", l: "❌ Reddedildi" }
                  : status === "convertedToQuote" ? { bg: "#dbeafe", fg: "#1e40af", l: "💼 Teklife Dönüştü" }
                  : status === "salesPending" ? { bg: "#eff6ff", fg: "#1e40af", l: "💼 Satışta" }
                  : status === "technicalPending" ? { bg: "#f0fdfa", fg: "#0f766e", l: "⚙️ Teknikte" }
                  : status === "gmPending" ? { bg: "#fef2f2", fg: "#991b1b", l: "⭐ GM Onayı" }
                  : status === "evaluating" ? { bg: "#eff6ff", fg: "#1e40af", l: "💼 Karar Bekliyor (Satış)" }
                  : { bg: "#f5f5f4", fg: "#57534e", l: "📝 Taslak" };
                const isSelectable = status === "approved";
                const isSelected = selectedIds.has(s.studyNo);
                return (
                  <tr key={s.studyNo} style={{ borderTop: "1px solid #f5f5f4", background: isSelected ? "#eff6ff" : "transparent" }}>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      {isSelectable && (
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(s.studyNo)}
                          title="Teklife dönüştürmek için seç" />
                      )}
                    </td>
                    <td style={{ padding: "6px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{s.studyNo}</td>
                    <td style={{ padding: "6px 10px" }}>{s.customerName || "—"}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <div>{s.partName || "—"}</div>
                      {s.partNo && <div style={{ fontSize: 9, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>{s.partNo}</div>}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ padding: "1px 6px", background: badge.bg, color: badge.fg, borderRadius: 3, fontSize: 9, fontWeight: 600 }}>{badge.l}</span>
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 10, color: "#78716c" }}>{sig.signed}/{sig.total}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button onClick={() => onOpen(s, { readOnly: false })}
                          style={{ padding: "3px 8px", fontSize: 10, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>✏ Aç</button>
                        <button onClick={async () => { try { await generateFeasibilityPdf(s); } catch (e) { alert("PDF hatası: " + e.message); } }}
                          title="Yapılabilirlik PDF indir"
                          style={{ padding: "3px 8px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>📄 PDF</button>
                        {status === "approved" && onCreateQuote && (
                          <button onClick={() => onCreateQuote(s)}
                            title="Bu yapılabilirlikten yeni teklif oluştur"
                            style={{ padding: "3px 8px", fontSize: 10, background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer", fontWeight: 500 }}>
                            💼 Teklif Oluştur
                          </button>
                        )}
                        {status === "convertedToQuote" && s.linkedQuoteNo && (
                          <span style={{ padding: "3px 8px", fontSize: 10, background: "#dcfce7", color: "#166534", borderRadius: 3, fontFamily: "ui-monospace, monospace" }}>
                            → {s.linkedQuoteNo}
                          </span>
                        )}
                        {isAdmin && (
                          <button onClick={() => handleDelete(s.studyNo, status === "convertedToQuote")} disabled={!!deleting[s.studyNo]}
                            title={status === "convertedToQuote" ? `Teklife dönüşmüş — sadece teklif silinmişse silinir` : "Sil"}
                            style={{ padding: "3px 8px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
