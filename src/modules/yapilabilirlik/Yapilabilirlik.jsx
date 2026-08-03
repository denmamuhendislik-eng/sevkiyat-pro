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
import { computeFeasibilityStats } from "./stats";

export default function Yapilabilirlik({ isAdmin, isUretim, isSales, authUser, onCreateQuoteFromFeasibility }) {
  const canEdit = !!(isAdmin || isSales || isUretim);
  const [activeTab, setActiveTab] = useState("list");
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
          { id: "kpi", label: "📊 KPI" },
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
      {activeTab === "kpi" && <KpiView />}
    </div>
  );
}

// İmza öncesi rol bazlı eksiklik kontrolü. Blockers (HARD) → imza atılmaz.
// Warnings (SOFT) → confirm ile devam edilebilir.
function validateBeforeSign(role, study, status) {
  const blockers = [];
  const warnings = [];

  if (role === "salesManager") {
    // Zorunlu bilgi
    if (!study?.customerName?.trim()) blockers.push("Müşteri adı");
    if (!study?.partName?.trim() && !study?.partNo?.trim()) blockers.push("Parça adı veya numarası");
    if (!study?.quantity || Number(study.quantity) <= 0) blockers.push("Sipariş miktarı (>0)");
    // Satış-Proje soruları
    const unanswered = SALES_QUESTIONS.filter(q => {
      const v = study?.evaluation?.[q.key]?.answer;
      return v == null || v === "";
    });
    if (unanswered.length > 0) blockers.push(`Satış ve Proje bölümünde ${unanswered.length} cevapsız soru`);
    // Karar aşaması — evaluating iken karar zorunlu
    if (status === "evaluating" && !study?.decision) {
      blockers.push("Karar (Talep Karşılanır / Reddedilir / Değişiklik) seçilmemiş");
    }
    // Soft uyarılar
    if (!study?.customerContact?.trim() && !study?.customerEmail?.trim()) warnings.push("Müşteri iletişim (telefon veya e-mail) boş");
    if (!study?.shipmentAddress?.trim()) warnings.push("Sevkiyat adresi girilmemiş");
    const anyReceived = Object.values(study?.receivedData || {}).some(v => !!v);
    if (!anyReceived) warnings.push("Gelen veri türü işaretlenmemiş");
  }

  if (role === "technicalUnit") {
    // Teknik soruları
    const unanswered = TECHNICAL_QUESTIONS.filter(q => {
      const v = study?.evaluation?.[q.key]?.answer;
      return v == null || v === "";
    });
    if (unanswered.length > 0) blockers.push(`Teknik bölümde ${unanswered.length} cevapsız soru`);
    // Operasyon: tezgah seçili ama süre 0/boş
    const opDetails = Array.isArray(study?.operations?.details) ? study.operations.details : [];
    opDetails.forEach((op, i) => {
      if (op?.machine && (!op?.minutes || Number(op.minutes) <= 0)) {
        blockers.push(`Operasyon #${i + 1}: tezgah seçili ama süre girilmemiş`);
      }
    });
    // Aparat/Takım kalemi: ad var ama adet/fiyat eksik
    const toolingItems = Array.isArray(study?.toolingItems) ? study.toolingItems : [];
    toolingItems.forEach((it, i) => {
      if (it?.name?.trim() && (!Number(it?.qty) || !Number(it?.unitCost))) {
        blockers.push(`Aparat/Takım #${i + 1} (${it.name}): adet veya birim fiyat eksik`);
      }
    });
    // Fason kalemi: ad var ama birim fiyat eksik (qty artık sipariş miktarından türetiliyor)
    const fasonItems = Array.isArray(study?.fasonItems) ? study.fasonItems : [];
    fasonItems.forEach((it, i) => {
      if (it?.name?.trim() && !Number(it?.unitCost)) {
        blockers.push(`Fason #${i + 1} (${it.name}): birim fiyat eksik`);
      }
    });
    // Hammadde bütünlük kontrolü:
    //   Ölçü girilmişse malzeme türü ZORUNLU (density olmadan ağırlık hesaplanamaz).
    //   Aksi halde teknik ekip ölçüyü yazıp materialType seçmeyi unutunca ağırlık 0
    //   kalıyor → teklif malzeme maliyeti sıfır çıkıyor. Sık rastlanan hata.
    const dim = study?.dimensions || {};
    const hasAnyDim = Number(dim.en) || Number(dim.boy) || Number(dim.uzunluk);
    if (hasAnyDim && !study?.materialType?.trim()) {
      blockers.push("Hammadde ölçüleri girilmiş ama malzeme türü seçilmemiş — ağırlık hesaplanamıyor");
    }
    // Soft uyarılar (hammadde detayları)
    if (!study?.materialType?.trim() && !study?.material?.trim()) warnings.push("Malzeme türü / notu girilmemiş");
    if (!hasAnyDim) warnings.push("Hammadde ölçüleri boş");
    if (!Number(study?.weightKg)) warnings.push("Hammadde ağırlığı girilmemiş");
  }

  if (role === "generalManager") {
    if (!study?.decision) blockers.push("Karar (Talep Karşılanır / Reddedilir / Değişiklik) seçilmemiş");
  }

  return { blockers, warnings };
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
  // Fason: parça başına varsayımı — birim maliyet × sipariş miktarı. Kalem qty
  // alanı UI'dan kaldırıldı; toQuote da quantity=0 gönderip quoteCalc'ın
  // parça qty fallback'ini tetikliyor. Batch-based nadir fason gerekirse
  // teklif ekranında override edilebilir.
  const fasonTotal = (study.fasonItems || []).reduce((s, it) => s + (Number(it.unitCost) || 0), 0) * (Number(study.quantity) || 1);

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
      // Ağırlık autofill — kullanıcı manuel yazmadıysa ↺ butonuna basmasa da
      // hesaplanmış değer (dimensions × density) persist edilir. PDF ve parça
      // kütüphanesi boyle "0.000 kg" yerine gerçek değeri görür.
      const effectiveWeightKg = (Number(study.weightKg) > 0) ? Number(study.weightKg) : (autoWeightKg > 0 ? Number(autoWeightKg.toFixed(4)) : 0);
      // Ek hammaddeler için de aynı autofill
      const effectiveAdditionalMaterials = (study.additionalMaterials || []).map(am => {
        if (Number(am?.weightKg) > 0) return am;
        const amMat = materialsData?.materials?.[am?.materialType];
        const amAuto = calculateWeightKg({
          shape: am?.materialShape || amMat?.shape,
          en: am?.dimensions?.en,
          boy: am?.dimensions?.boy,
          uzunluk: am?.dimensions?.uzunluk,
          density: amMat?.density,
        });
        return amAuto > 0 ? { ...am, weightKg: Number(amAuto.toFixed(4)) } : am;
      });
      const payload = { ...study, studyNo, weightKg: effectiveWeightKg, additionalMaterials: effectiveAdditionalMaterials };
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
          // Fason toplam: parça başına × sipariş miktarı (qty alanı UI'dan kaldırıldı)
          const fasonToplam = (study.fasonItems || []).reduce((s, f) => s + (Number(f.unitCost) || 0), 0) * (Number(study.quantity) || 1);
          const aparatToplam = (study.toolingItems || []).reduce((s, t) => s + (Number(t.qty) || 0) * (Number(t.unitCost) || 0), 0);
          const enV = Number(study.dimensions?.en) || 0, boyV = Number(study.dimensions?.boy) || 0, uzV = Number(study.dimensions?.uzunluk) || 0;
          await saveQuotePart(partCode, {
            stokKodu: partCode,
            stokAdi: study.partName || "",
            musteriKodu: study.musteriKodu || "",
            hammadde: {
              tur: study.materialType || study.material || "",
              ebat: (enV || boyV || uzV) ? `EN:${enV} × BOY:${boyV} × UZ:${uzV}` : "",
              agirlikKg: effectiveWeightKg,
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

      // Autofill ile yazılan ağırlığı local state'e de yansıt → PDF preview / sonraki edit tutarlı
      if (effectiveWeightKg > 0 && effectiveWeightKg !== Number(study.weightKg)) {
        setStudy(prev => ({ ...prev, weightKg: effectiveWeightKg }));
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
    // Rol bazlı eksiklik kontrolü — blockers (HARD) + warnings (SOFT)
    const { blockers, warnings } = validateBeforeSign(currentPendingRole, study, status);
    if (blockers.length > 0) {
      alert("Aşağıdaki eksiklikler tamamlanmadan imza atılamaz:\n\n• " + blockers.join("\n• "));
      return;
    }
    if (warnings.length > 0) {
      if (!confirm("Aşağıdaki alanlar eksik. Yine de imza atılsın mı?\n\n• " + warnings.join("\n• "))) return;
    }
    setCompleting(true); setError("");
    try {
      // 1) Kaydet — ağırlık autofill (handleSave ile aynı davranış, ek hammaddeler dahil)
      const effectiveWeightKg = (Number(study.weightKg) > 0) ? Number(study.weightKg) : (autoWeightKg > 0 ? Number(autoWeightKg.toFixed(4)) : 0);
      const effectiveAdditionalMaterials = (study.additionalMaterials || []).map(am => {
        if (Number(am?.weightKg) > 0) return am;
        const amMat = materialsData?.materials?.[am?.materialType];
        const amAuto = calculateWeightKg({
          shape: am?.materialShape || amMat?.shape,
          en: am?.dimensions?.en,
          boy: am?.dimensions?.boy,
          uzunluk: am?.dimensions?.uzunluk,
          density: amMat?.density,
        });
        return amAuto > 0 ? { ...am, weightKg: Number(amAuto.toFixed(4)) } : am;
      });
      const payload = { ...study, studyNo, weightKg: effectiveWeightKg, additionalMaterials: effectiveAdditionalMaterials };
      await saveFeasibilityStudy(payload, { canEdit, staging, userEmail: "" });
      // 2) İmza at
      await signFeasibilityRole(studyNo, currentPendingRole, {
        signerName: userEmail || userDisplayRole,
        signerRoleLabel: userDisplayRole,
        isGeneralManager: isAdmin,
        canEdit, staging,
      });
      // 3) Local state'e imza kaydını da işle → status derhal ilerlesin
      //    Ağırlık autofill'i de yansıt (kullanıcı sonradan form'da görsün).
      const now = new Date().toISOString();
      setStudy(prev => ({
        ...prev,
        weightKg: effectiveWeightKg > 0 ? effectiveWeightKg : (prev.weightKg || 0),
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
    // Eksiklik kontrolü — imzalanacak rolün sorumluluklarına göre.
    // handleCompleteSection ile aynı validate helper'ı kullanır → tutarlı davranış.
    const { blockers, warnings } = validateBeforeSign(roleKey, study, status);
    if (blockers.length > 0) {
      alert("Aşağıdaki eksiklikler tamamlanmadan imza atılamaz:\n\n• " + blockers.join("\n• "));
      return;
    }
    if (warnings.length > 0) {
      if (!confirm("Aşağıdaki alanlar eksik. Yine de imzaya devam edilsin mi?\n\n• " + warnings.join("\n• "))) return;
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
            <label style={{ ...labelStyle, color: "#1e40af", fontWeight: 600 }}>📦 Sipariş Miktarı (Adet)</label>
            <input type="number" min="1" value={study.quantity || 1}
              onChange={e => {
                const q = Number(e.target.value) || 1;
                const oldQ = Number(study.quantity) || 1;
                const oldB = Number(study.batchSize) || 0;
                update("quantity", q);
                // Parti büyüklüğünü sipariş miktarıyla otomatik senkron:
                //   - Parti hiç doldurulmadıysa (0) → miktarla eşitle
                //   - Parti eski miktara eşitse (kullanıcı özelleştirmemiş) → yeni miktarla eşitle
                //   - Parti farklıysa → kullanıcı bilinçli tercih yapmış, dokunma
                if (oldB === 0 || oldB === oldQ) {
                  update("batchSize", q);
                }
              }}
              disabled={readonlyForm}
              style={{ ...inputStyle, borderColor: "#bfdbfe", background: "#eff6ff", fontWeight: 600 }} />
          </div>
          <div>
            <label style={{ ...labelStyle, color: "#7c2d12", fontWeight: 600 }} title="Miktar bazlı marj tablosunda hangi dilime bakılacağını belirler. Boş bırakılırsa sipariş miktarı ile aynı sayılır. Uzun vadeli / parti halinde teslimatlarda gerçekçi marj için kullanılır.">
              🎯 Parti Büyüklüğü <span style={{ fontSize: 9, color: "#9a3412", fontWeight: 500 }}>(marj için)</span>
            </label>
            <input type="number" min="0"
              value={study.batchSize || 0}
              onChange={e => update("batchSize", Number(e.target.value) || 0)}
              placeholder={`boş = ${study.quantity || 1}`}
              disabled={readonlyForm}
              style={{ ...inputStyle, borderColor: "#fed7aa", background: "#fff7ed" }} />
            {Number(study.batchSize) > 0 && Number(study.batchSize) > Number(study.quantity || 1) && (
              <div style={{ fontSize: 9, color: "#dc2626", marginTop: 2 }}>⚠ Parti sipariş miktarından büyük</div>
            )}
            {(!study.batchSize || Number(study.batchSize) === Number(study.quantity || 1)) && (
              <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>Marj bracket'i sipariş miktarından bakılır</div>
            )}
            {Number(study.batchSize) > 0 && Number(study.batchSize) < Number(study.quantity || 1) && (
              <div style={{ fontSize: 9, color: "#166534", marginTop: 2, fontWeight: 500 }}>✓ Marj bracket'i {study.batchSize} adet üzerinden bakılır</div>
            )}
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
          {(() => {
            const shapeUp = String(study.materialShape || selectedMaterialMaster?.shape || "").toUpperCase();
            const isCylinder = shapeUp === "SİLİNDİR";
            return (
              <>
                <div>
                  <label style={labelStyle}>{isCylinder ? "Ø ÇAP (mm)" : "EN (mm)"}</label>
                  <input type="number" value={study.dimensions?.en || 0} onChange={e => update("dimensions", { ...(study.dimensions || {}), en: Number(e.target.value) || 0 })} disabled={readonlyForm} style={inputStyle} />
                </div>
                {!isCylinder && (
                  <div>
                    <label style={labelStyle}>BOY (mm)</label>
                    <input type="number" value={study.dimensions?.boy || 0} onChange={e => update("dimensions", { ...(study.dimensions || {}), boy: Number(e.target.value) || 0 })} disabled={readonlyForm} style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>{isCylinder ? "BOY (mm)" : "UZUNLUK (mm)"}</label>
                  <input type="number" value={study.dimensions?.uzunluk || 0} onChange={e => update("dimensions", { ...(study.dimensions || {}), uzunluk: Number(e.target.value) || 0 })} disabled={readonlyForm} style={inputStyle} />
                </div>
              </>
            );
          })()}
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <div>
            <label style={labelStyle}>Malzeme Notu (eski alan)</label>
            <input value={study.material || ""} onChange={e => update("material", e.target.value)} disabled={readonlyForm} placeholder="opsiyonel" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Yardımcı Malzeme</label>
            <input value={study.otherMaterials || ""} onChange={e => update("otherMaterials", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
        </div>

        {/* EK HAMMADDELER — multi-material desteği. Boşsa hiç görünmez (opsiyonel).
            Kullanıcı "➕ Ek Hammadde Ekle" ile birden fazla malzeme ekleyebilir.
            Teklife aktarımda: additionalMaterials array olarak gider ve quoteCalc
            material cost'una tam olarak katılır (each × TL/kg). Backward-compat:
            eski study'lerde bu array boş kalır → davranış aynı. */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #d6d3d1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#57534e" }}>
              🧱+ Ek Hammaddeler
              {(study.additionalMaterials || []).length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, color: "#78716c", fontWeight: 500 }}>
                  · {study.additionalMaterials.length} ek
                </span>
              )}
              {(() => {
                const addKg = (study.additionalMaterials || []).reduce((s, am) => s + (Number(am?.weightKg) || 0), 0);
                const primKg = Number(study.weightKg) || 0;
                const totalKg = primKg + addKg;
                if (addKg > 0) {
                  return (
                    <span style={{ marginLeft: 10, fontSize: 10, color: "#166534", fontWeight: 500 }}>
                      · Toplam ağırlık: <b>{totalKg.toFixed(3)} kg</b> (primary {primKg.toFixed(3)} + ek {addKg.toFixed(3)})
                    </span>
                  );
                }
                return null;
              })()}
            </div>
            <button onClick={() => {
              const cur = Array.isArray(study.additionalMaterials) ? study.additionalMaterials : [];
              update("additionalMaterials", [...cur, { materialType: "", materialShape: "", dimensions: { en: 0, boy: 0, uzunluk: 0 }, weightKg: 0 }]);
            }} disabled={readonlyForm}
              style={{ padding: "3px 10px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>
              ➕ Ek Hammadde Ekle
            </button>
          </div>
          {(study.additionalMaterials || []).length > 0 && (
            <div style={{ fontSize: 9, color: "#78716c", marginBottom: 6 }}>
              Her ek hammaddenin ağırlığı × TL/kg teklif malzeme maliyetine dahil edilir. Ölçü girildiyse malzeme türü zorunlu (ağırlık ebattan hesaplanabilsin).
            </div>
          )}
          {(study.additionalMaterials || []).map((am, ai) => {
            const amMat = materialsData?.materials?.[am.materialType];
            const amAutoWeight = calculateWeightKg({
              shape: am.materialShape || amMat?.shape,
              en: am.dimensions?.en,
              boy: am.dimensions?.boy,
              uzunluk: am.dimensions?.uzunluk,
              density: amMat?.density,
            });
            const updateAm = (key, val) => {
              const next = [...(study.additionalMaterials || [])];
              next[ai] = { ...next[ai], [key]: val };
              update("additionalMaterials", next);
            };
            const updateAmDim = (dimKey, val) => {
              const next = [...(study.additionalMaterials || [])];
              next[ai] = { ...next[ai], dimensions: { ...(next[ai].dimensions || {}), [dimKey]: Number(val) || 0 } };
              update("additionalMaterials", next);
            };
            const removeAm = () => {
              const next = (study.additionalMaterials || []).filter((_, i) => i !== ai);
              update("additionalMaterials", next);
            };
            const shapeUp = String(am.materialShape || amMat?.shape || "").toUpperCase();
            const isCyl = shapeUp === "SİLİNDİR";
            return (
              <div key={ai} style={{ padding: 6, marginBottom: 4, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 4 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 32px", gap: 6, alignItems: "end" }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 9 }}>Malzeme #{ai + 1}</label>
                    <input list={`amMaterialList_${ai}`} value={am.materialType || ""} onChange={e => updateAm("materialType", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, padding: 4, fontSize: 10 }} placeholder="AL-6061..." />
                    <datalist id={`amMaterialList_${ai}`}>
                      {materialList.map(m => (
                        <option key={m.name} value={m.name}>{m.shape} · {m.priceTlPerKg}TL/kg</option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 9 }}>Şekil</label>
                    <select value={am.materialShape || amMat?.shape || ""} onChange={e => updateAm("materialShape", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, padding: 4, fontSize: 10 }}>
                      <option value="">—</option>
                      <option value="DİKDÖRTGEN">DİKDÖRTGEN</option>
                      <option value="SİLİNDİR">SİLİNDİR</option>
                      <option value="ALTIGEN">ALTIGEN</option>
                      <option value="EBATSIZ">EBATSIZ</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 9 }}>{isCyl ? "Ø ÇAP" : "EN"}</label>
                    <input type="number" value={am.dimensions?.en || 0} onChange={e => updateAmDim("en", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, padding: 4, fontSize: 10 }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 9 }}>{isCyl ? "BOY" : "BOY"}</label>
                    <input type="number" value={am.dimensions?.boy || 0} onChange={e => updateAmDim("boy", e.target.value)} disabled={readonlyForm || isCyl} style={{ ...inputStyle, padding: 4, fontSize: 10, opacity: isCyl ? 0.4 : 1 }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 9 }}>{isCyl ? "UZUNLUK" : "UZUNLUK"}</label>
                    <input type="number" value={am.dimensions?.uzunluk || 0} onChange={e => updateAmDim("uzunluk", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, padding: 4, fontSize: 10 }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 9 }}>Ağırlık kg</label>
                    <input type="number" step="0.001" value={am.weightKg || 0} onChange={e => updateAm("weightKg", Number(e.target.value) || 0)}
                      placeholder={amAutoWeight > 0 ? amAutoWeight.toFixed(3) : "0.000"}
                      disabled={readonlyForm} style={{ ...inputStyle, padding: 4, fontSize: 10, background: "#fef3c7" }} />
                    {amAutoWeight > 0 && Math.abs((am.weightKg || 0) - amAutoWeight) > 0.001 && !readonlyForm && (
                      <button onClick={() => updateAm("weightKg", Number(amAutoWeight.toFixed(4)))}
                        style={{ marginTop: 2, padding: "1px 4px", fontSize: 8, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 2, cursor: "pointer" }}>
                        ↺ {amAutoWeight.toFixed(3)}
                      </button>
                    )}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <button onClick={removeAm} disabled={readonlyForm}
                      title="Bu ek hammaddeyi kaldır"
                      style={{ padding: 4, fontSize: 12, background: "transparent", color: "#dc2626", border: "none", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button>
                  </div>
                </div>
              </div>
            );
          })}
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
                      // Fason: her kalem parça başına — sipariş miktarı ile çarpılır.
                      // Tooling: kalem qty'si kullanılır (bir kalıp = flat maliyet).
                      const effectiveQty = cat.key === "fason" ? (Number(study.quantity) || 1) : (Number(it.qty) || 0);
                      const lineTotal = effectiveQty * (Number(it.unitCost) || 0);
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
                            {cat.key === "fason" ? (
                              <div title={`Sipariş miktarı × birim (parça başına fason varsayımı)`}
                                style={{ padding: 3, fontSize: 10, textAlign: "right", color: "#78716c", fontStyle: "italic" }}>
                                ×{Number(study.quantity) || 1}
                              </div>
                            ) : (
                              <input type="number" step="1" value={it.qty || 0} onChange={e => updateItem(cat.key, i, "qty", Number(e.target.value) || 0)} disabled={readonlyForm}
                                style={{ width: "100%", padding: 3, fontSize: 10, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                            )}
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

// ==================== KPI Görünümü ====================

function KpiView() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [data, setData] = useState({ studies: {} });
  const [staging] = useState(false);

  useEffect(() => {
    const unsub = subscribeFeasibilityForYear(year, setData, { staging });
    return unsub;
  }, [year, staging]);

  const studies = useMemo(() => Object.values(data?.studies || {}), [data]);
  const stats = useMemo(() => computeFeasibilityStats(studies), [studies]);

  const fmtDay = (d) => d == null ? "—" : `${d.toFixed(1)} gün`;
  const fmtPct = (p) => p == null ? "—" : `%${p.toFixed(0)}`;

  if (stats.total === 0) {
    return (
      <div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "#57534e" }}>Yıl:</label>
          <select value={year} onChange={e => setYear(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}>
            {["2024", "2025", "2026"].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          {year} yılında yapılabilirlik yok. KPI'lar veri biriktikçe anlam kazanır.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#57534e" }}>Yıl:</label>
        <select value={year} onChange={e => setYear(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}>
          {["2024", "2025", "2026"].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "#78716c" }}>{stats.total} yapılabilirlik</span>
      </div>

      {/* Üst 4 kart */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <KpiCard label="Teklife Dönüşüm" value={fmtPct(stats.conversionRate)}
          subtitle={`${stats.byStatus.convertedToQuote}/${stats.decidedCount} karar verilen`} color="#16a34a" />
        <KpiCard label="Ort. Dönüşüm Süresi" value={fmtDay(stats.avgConversionDays)}
          subtitle="onay → teklif" color="#1e40af" />
        <KpiCard label="Aktif Bekleyen" value={stats.activePending}
          subtitle={`${stats.byStatus.salesPending} satış · ${stats.byStatus.technicalPending} teknik · ${stats.byStatus.gmPending} GM`} color="#d97706" />
        <KpiCard label="Ort. Puan" value={stats.avgScorePercent != null ? `${stats.avgScorePercent.toFixed(0)}/100` : "—"}
          subtitle={`satış ${(stats.avgSalesPercent || 0).toFixed(0)}% · teknik ${(stats.avgTechnicalPercent || 0).toFixed(0)}%`} color="#7c3aed" />
      </div>

      {/* İkinci sıra: Donut + Süre kart */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <KpiPanel title="🎯 Durum Dağılımı">
          <StatusDonut byStatus={stats.byStatus} />
        </KpiPanel>
        <KpiPanel title="⏱ Aşama Süreleri (medyan · son 10)">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px" }}>
            <StageRow icon="💼" label="Satış aşaması" days={stats.avgSalesDays} color="#1e40af" stat={stats.stageStats?.sales} />
            <StageRow icon="⚙️" label="Teknik aşaması" days={stats.avgTechnicalDays} color="#0f766e" stat={stats.stageStats?.technical} />
            <StageRow icon="⭐" label="GM aşaması" days={stats.avgGmDays} color="#991b1b" stat={stats.stageStats?.gm} />
            <StageRow icon="⏳" label={`Karar Bekliyor (Satış)${stats.evaluatingCount > 0 ? ` — ${stats.evaluatingCount} aktif` : ""}`} days={stats.avgEvaluatingDays} color="#a855f7" stat={stats.stageStats?.evaluating} />
            <div style={{ borderTop: "1px solid #e7e5e4", paddingTop: 8, marginTop: 4 }}>
              <StageRow icon="🏁" label="Toplam (create→onay)" days={stats.avgTotalDays} color="#44403c" bold stat={stats.stageStats?.total} />
            </div>
            <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
              💡 Medyan <b>son 10 study</b> üzerinden (kayan pencere) — geçmiş "hep aynı gün imza" desenleri yakın performansı bastırmasın. Aktif bekleyenler yaşlanma olarak dahil. Hover et → detay + dağılım.
            </div>
          </div>
        </KpiPanel>
      </div>

      {/* Üçüncü sıra: Puan histogramı + Yavaş bekleyenler */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <KpiPanel title="📊 Puan Dağılımı">
          <ScoreHistogram histogram={stats.scoreHistogram} total={stats.total} />
        </KpiPanel>
        <KpiPanel title="🐢 En Yavaş Bekleyen (top 5)">
          {stats.slowestPending.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Aktif bekleyen yok.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#f5f5f4", textAlign: "left" }}>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600 }}>Yapılabilirlik</th>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600 }}>Müşteri</th>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600 }}>Aşama</th>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600, textAlign: "right" }}>Bekleme</th>
                </tr>
              </thead>
              <tbody>
                {stats.slowestPending.map(s => (
                  <tr key={s.studyNo} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "ui-monospace, monospace", fontSize: 10 }}>{s.studyNo}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10 }}>{s.customerName}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10 }}>
                      <StageBadge status={s.status} />
                    </td>
                    <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", fontWeight: 600, color: s.waitDays > 7 ? "#991b1b" : "#44403c" }}>
                      {s.waitDays.toFixed(1)} gün
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </KpiPanel>
      </div>

      {/* Dördüncü sıra: En düşük 3 soru + Müşteri top 5 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <KpiPanel title="❗ En Düşük Puanlı Sorular (top 3)">
          <QuestionRanking questions={stats.questionRanking.slice(0, 3)} />
        </KpiPanel>
        <KpiPanel title="🏢 Müşteri Sıralaması (top 5)">
          {stats.customerRanking.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Müşteri yok.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#f5f5f4", textAlign: "left" }}>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600 }}>Müşteri</th>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600, textAlign: "right" }}>Toplam</th>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600, textAlign: "right" }}>Dönüşüm</th>
                  <th style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600, textAlign: "right" }}>Ort. Puan</th>
                </tr>
              </thead>
              <tbody>
                {stats.customerRanking.slice(0, 5).map(c => (
                  <tr key={c.name} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "5px 8px", fontSize: 10 }}>{c.name}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", fontWeight: 600 }}>{c.total}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", color: c.conversionRate >= 50 ? "#166534" : c.conversionRate >= 25 ? "#92400e" : "#991b1b" }}>
                      {c.converted}/{c.total} <span style={{ opacity: 0.7 }}>({c.conversionRate.toFixed(0)}%)</span>
                    </td>
                    <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", fontWeight: 500 }}>{c.avgScore.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </KpiPanel>
      </div>

      {/* Beşinci sıra: Sistem-Karar tutarlılığı + En sık müzakere ipucu */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <KpiPanel title="🤖 Sistem Önerisi vs Alınan Karar">
          {(stats.systemAgreeCount + stats.systemDisagreeCount) === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz karar verilen yapılabilirlik yok.</div>
          ) : (
            <div style={{ padding: "10px 4px" }}>
              <div style={{ display: "flex", height: 24, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ flex: stats.systemAgreeCount, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                  {stats.systemAgreeCount > 0 && `✓ ${stats.systemAgreeCount}`}
                </div>
                <div style={{ flex: stats.systemDisagreeCount, background: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                  {stats.systemDisagreeCount > 0 && `✗ ${stats.systemDisagreeCount}`}
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#57534e", display: "flex", justifyContent: "space-between" }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#16a34a", borderRadius: 2, marginRight: 4 }} />Uyumlu ({fmtPct(100 * stats.systemAgreeCount / (stats.systemAgreeCount + stats.systemDisagreeCount))})</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#dc2626", borderRadius: 2, marginRight: 4 }} />Çelişkili ({fmtPct(100 * stats.systemDisagreeCount / (stats.systemAgreeCount + stats.systemDisagreeCount))})</span>
              </div>
              <div style={{ fontSize: 10, color: "#78716c", marginTop: 8 }}>
                💡 Uyumsuzluk yüksekse eşik değeri (75/50) revize edilebilir.
              </div>
            </div>
          )}
        </KpiPanel>
        <KpiPanel title="💬 En Sık Tetiklenen Müzakere İpucu (top 5)">
          {stats.hintRanking.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz düşük puanlı cevap yok.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.hintRanking.slice(0, 5).map((h, i) => (
                <div key={h.key} style={{ padding: 6, background: "#fef3c7", borderRadius: 4, fontSize: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: "#44403c" }}>{i + 1}. {h.label}</span>
                    <span style={{ fontSize: 9, padding: "1px 6px", background: "#92400e", color: "#fff", borderRadius: 3, fontWeight: 600 }}>{h.count}×</span>
                  </div>
                  {h.hint && <div style={{ fontSize: 9, color: "#78716c" }}>💡 {h.hint}</div>}
                </div>
              ))}
            </div>
          )}
        </KpiPanel>
      </div>

      {/* Alt bilgi */}
      <div style={{ fontSize: 10, color: "#a8a29e", textAlign: "center", padding: 10 }}>
        {stats.lostOpportunity > 0 && (
          <div style={{ display: "inline-block", padding: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, color: "#991b1b", marginBottom: 4 }}>
            ⚠ <b>{stats.lostOpportunity}</b> onaylı yapılabilirlik teklife dönmemiş — kayıp fırsat izlenmeli.
          </div>
        )}
        <div>KPI'lar cari yıl verisi üzerinden canlı hesaplanır. Yeni study kaydedildikçe otomatik güncellenir.</div>
      </div>
    </div>
  );
}

// KPI kart (üst özet)
function KpiCard({ label, value, subtitle, color }) {
  return (
    <div style={{ padding: 14, background: "#fff", border: "1px solid #e7e5e4", borderTop: `3px solid ${color}`, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: "#78716c", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#78716c", marginTop: 2 }}>{subtitle}</div>
    </div>
  );
}

// KPI panel (grafik/tablo etrafı)
function KpiPanel({ title, children }) {
  return (
    <div style={{ padding: 12, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#44403c", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// Durum donut chart (SVG)
function StatusDonut({ byStatus }) {
  const items = [
    { key: "convertedToQuote", label: "Teklife Dönüştü", color: "#1e40af", count: byStatus.convertedToQuote },
    { key: "approved", label: "Onaylı", color: "#16a34a", count: byStatus.approved },
    { key: "rejected", label: "Reddedildi", color: "#dc2626", count: byStatus.rejected },
    { key: "salesPending", label: "Satışta", color: "#3b82f6", count: byStatus.salesPending },
    { key: "technicalPending", label: "Teknikte", color: "#14b8a6", count: byStatus.technicalPending },
    { key: "gmPending", label: "GM Onayı", color: "#f59e0b", count: byStatus.gmPending },
    { key: "evaluating", label: "Karar Bekliyor", color: "#a855f7", count: byStatus.evaluating },
    { key: "draft", label: "Taslak", color: "#a8a29e", count: byStatus.draft },
  ].filter(it => it.count > 0);
  const total = items.reduce((s, it) => s + it.count, 0);
  if (total === 0) return <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Veri yok</div>;

  const size = 140;
  const cx = size / 2, cy = size / 2;
  const r = 55, strokeW = 22;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
      <svg width={size} height={size}>
        {items.map((it) => {
          const frac = it.count / total;
          const len = frac * circumference;
          const seg = (
            <circle key={it.key} cx={cx} cy={cy} r={r} fill="none" stroke={it.color}
              strokeWidth={strokeW}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`} />
          );
          offset += len;
          return seg;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700" fill="#1c1917">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#78716c">TOPLAM</text>
      </svg>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, fontSize: 10 }}>
        {items.map(it => (
          <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 10, height: 10, background: it.color, borderRadius: 2 }} />
            <span style={{ flex: 1, color: "#44403c" }}>{it.label}</span>
            <span style={{ fontWeight: 600, color: "#1c1917" }}>{it.count}</span>
            <span style={{ color: "#78716c", minWidth: 32, textAlign: "right" }}>({Math.round((it.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Aşama süre satırı
function StageRow({ icon, label, days, color, bold, stat }) {
  const n = stat?.n ?? null;                // toplam study
  const windowN = stat?.windowN ?? null;    // medyan pencere büyüklüğü (son N)
  const samples = stat?.samples || [];
  const bd = stat?.breakdown || null;
  const tooltipLines = [];
  if (n != null) {
    tooltipLines.push(`Toplam study: ${n}${windowN != null && windowN !== n ? ` · medyan son ${windowN} üzerinden` : ""}`);
    if (samples.length > 0) {
      tooltipLines.push(`Son ${samples.length} değer: ${samples.map(v => v.toFixed(2)).join(" · ")} gün`);
    }
    if (bd) {
      tooltipLines.push(`Dağılım (pencere): ${bd.fast} hızlı (<1g) · ${bd.normal} normal (1-7g) · ${bd.slow} yavaş (>7g)`);
    }
  }
  const tooltip = tooltipLines.length > 0 ? tooltipLines.join("\n") : undefined;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={tooltip}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 11, color: "#44403c", fontWeight: bold ? 600 : 400 }}>
        {label}
        {windowN != null && windowN > 0 && (
          <span style={{ marginLeft: 4, fontSize: 9, color: "#a8a29e", fontWeight: 400 }}>
            · son {windowN}{n > windowN ? `/${n}` : ""}
          </span>
        )}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: days == null ? "#a8a29e" : color, fontVariantNumeric: "tabular-nums" }}>
        {days == null ? "—" : `${days.toFixed(1)} gün`}
      </span>
    </div>
  );
}

// Puan histogramı (3 aralık: <50, 50-74, ≥75)
function ScoreHistogram({ histogram, total }) {
  const items = [
    { label: "< %50 (RED / GM)", count: histogram.low, color: "#dc2626", bg: "#fee2e2" },
    { label: "%50-74 (DEĞİŞİKLİK)", count: histogram.mid, color: "#d97706", bg: "#fef3c7" },
    { label: "≥ %75 (KABUL)", count: histogram.high, color: "#16a34a", bg: "#dcfce7" },
  ];
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 4px" }}>
      {items.map(it => {
        const widthPct = (it.count / max) * 100;
        const pct = total > 0 ? Math.round((it.count / total) * 100) : 0;
        return (
          <div key={it.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
              <span style={{ color: "#44403c", fontWeight: 500 }}>{it.label}</span>
              <span style={{ color: it.color, fontWeight: 600 }}>{it.count} ({pct}%)</span>
            </div>
            <div style={{ height: 12, background: "#f5f5f4", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${widthPct}%`, height: "100%", background: it.color, transition: "width 0.3s" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Aşama badge (yavaş bekleyenler tablosunda)
function StageBadge({ status }) {
  const map = {
    salesPending: { l: "💼 Satış", c: "#1e40af", bg: "#eff6ff" },
    technicalPending: { l: "⚙️ Teknik", c: "#0f766e", bg: "#f0fdfa" },
    gmPending: { l: "⭐ GM", c: "#991b1b", bg: "#fef2f2" },
    evaluating: { l: "⏳ Karar", c: "#92400e", bg: "#fef3c7" },
  };
  const b = map[status] || { l: status, c: "#57534e", bg: "#f5f5f4" };
  return (
    <span style={{ padding: "1px 6px", background: b.bg, color: b.c, borderRadius: 3, fontSize: 9, fontWeight: 600 }}>
      {b.l}
    </span>
  );
}

// Soru rankingi (en düşük puanlılar)
function QuestionRanking({ questions }) {
  if (questions.length === 0) {
    return <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz cevaplanmış soru yok.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {questions.map((q, i) => (
        <div key={q.key} style={{ padding: 8, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#44403c" }}>{i + 1}. {q.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: q.avgScorePct < 50 ? "#991b1b" : q.avgScorePct < 75 ? "#92400e" : "#166534" }}>
              {q.avgScorePct}%
            </span>
          </div>
          <div style={{ height: 6, background: "#f5f5f4", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ width: `${q.avgScorePct}%`, height: "100%", background: q.avgScorePct < 50 ? "#dc2626" : q.avgScorePct < 75 ? "#d97706" : "#16a34a" }} />
          </div>
          <div style={{ fontSize: 9, color: "#78716c", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>{q.count} cevap</span>
            {Object.entries(q.answersCount).map(([k, n]) => (
              <span key={k} style={{ opacity: 0.85 }}>{k}: <b>{n}</b></span>
            ))}
          </div>
        </div>
      ))}
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
        <thead>
          <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 28, textAlign: "center" }}>#</th>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: "36%" }}>Soru</th>
            <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 140, textAlign: "center" }}>Cevap</th>
            <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 52, textAlign: "right" }}>Puan</th>
            <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Not / Açıklama</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => {
            const v = evaluation?.[q.key] || {};
            const answer = v.answer;
            const points = scoreForAnswer(q, answer);
            const isEmpty = answer == null || answer === "";
            const zebra = i % 2 === 1 ? "#fafaf9" : "#ffffff";
            return (
              <tr key={q.key} style={{ borderTop: "1px solid #f5f5f4", background: zebra }}>
                <td style={{ padding: "6px 8px", textAlign: "center", color: "#78716c" }}>{i + 1}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{q.label}</td>
                <td style={{ padding: "6px 6px", textAlign: "center" }}>
                  {q.type === "slider" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="range" min={q.min || 0} max={q.max || 10} step="1"
                        value={Number.isFinite(Number(answer)) ? Number(answer) : 0}
                        onChange={e => onUpdate(q.key, "answer", Number(e.target.value))}
                        disabled={!canEdit} style={{ flex: 1, minWidth: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 600, minWidth: 20, textAlign: "right" }}>{Number.isFinite(Number(answer)) ? Number(answer) : "—"}</span>
                    </div>
                  ) : (
                    <div style={{ display: "inline-flex", gap: 3 }}>
                      {EVAL_CHOICES.map(c => {
                        const selected = String(answer).toUpperCase() === c.key;
                        return (
                          <button key={c.key} onClick={() => onUpdate(q.key, "answer", c.key)} disabled={!canEdit}
                            style={{
                              padding: "2px 7px", fontSize: 10, fontWeight: 600, borderRadius: 3,
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
                <td style={{ padding: "6px 6px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 600, color: isEmpty ? "#a8a29e" : "#1c1917" }}>
                  {isEmpty ? "—" : `${points}/${q.max}`}
                </td>
                <td style={{ padding: "3px 4px" }}>
                  <input value={v.note || ""} onChange={e => onUpdate(q.key, "note", e.target.value)} disabled={!canEdit}
                    placeholder="Açıklama / detay..."
                    style={{ width: "100%", padding: "5px 6px", fontSize: 11, border: "1px solid #d6d3d1", borderRadius: 3, boxSizing: "border-box", background: "#fff" }} />
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
  const [statusFilter, setStatusFilter] = useState(""); // "" = tümü

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
    if (statusFilter) {
      f = f.filter(s => computeStudyStatus(s) === statusFilter);
    }
    return f.sort((a, b) => (b.studyNo || "").localeCompare(a.studyNo || ""));
  }, [data, search, onlyMine, statusFilter, isAdmin, isSales, isUretim]);

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

  // Header checkbox — geçerli görünümdeki onaylı yapılabilirlikleri toplu seç/kaldır.
  // Farklı müşteri karışırsa aşağıdaki toolbar zaten uyarı verir.
  const approvedInView = useMemo(
    () => studies.filter(s => computeStudyStatus(s) === "approved"),
    [studies]
  );
  const allApprovedSelected = approvedInView.length > 0 && approvedInView.every(s => selectedIds.has(s.studyNo));
  const someApprovedSelected = approvedInView.some(s => selectedIds.has(s.studyNo));
  const toggleSelectAllApproved = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allApprovedSelected) {
        approvedInView.forEach(s => next.delete(s.studyNo));
      } else {
        approvedInView.forEach(s => next.add(s.studyNo));
      }
      return next;
    });
  };

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
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          title="Duruma göre filtrele"
          style={{ padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, background: statusFilter ? "#eff6ff" : "#fff", fontWeight: statusFilter ? 600 : 400 }}>
          <option value="">Tüm Durumlar</option>
          <option value="draft">📝 Taslak</option>
          <option value="salesPending">💼 Satışta</option>
          <option value="technicalPending">⚙️ Teknikte</option>
          <option value="evaluating">💼 Karar Bekliyor (Satış)</option>
          <option value="gmPending">⭐ GM Onayı</option>
          <option value="approved">✅ Onaylı</option>
          <option value="rejected">❌ Reddedildi</option>
          <option value="convertedToQuote">💼 Teklife Dönüştü</option>
        </select>
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
                <th style={{ padding: "8px 10px", width: 26, textAlign: "center" }} title={approvedInView.length > 0 ? `Görünümdeki ${approvedInView.length} onaylı yapılabilirliği seç/kaldır` : "Onaylı yapılabilirlik yok"}>
                  <input type="checkbox"
                    disabled={approvedInView.length === 0}
                    checked={allApprovedSelected}
                    ref={el => { if (el) el.indeterminate = !allApprovedSelected && someApprovedSelected; }}
                    onChange={toggleSelectAllApproved} />
                </th>
                <th style={{ padding: "8px 10px" }}>Yapılabilirlik No</th>
                <th style={{ padding: "8px 10px" }}>Müşteri</th>
                <th style={{ padding: "8px 10px" }}>Parça</th>
                <th style={{ padding: "8px 10px", width: 90, textAlign: "center" }}>Puan</th>
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
                const scoreInfo = computeStudyScore(s);
                const recommendation = getRecommendation(scoreInfo.percent);
                // Satır arka planı puan rengiyle — form doldurulma aşamalarında
                // (draft/salesPending/technicalPending) toplam puan henüz eksik olduğu
                // için renklendirme yanıltıcı. Sadece değerlendirme sonrası göster.
                const applyScoreColor = status !== "salesPending" && status !== "draft" && status !== "technicalPending";
                const rowBg = isSelected ? "#eff6ff" : (applyScoreColor ? recommendation.bg : "#fff");
                return (
                  <tr key={s.studyNo} style={{ borderTop: "1px solid #f5f5f4", background: rowBg }}>
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
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      <span title={`Satış ${scoreInfo.sales.percent}% · Teknik ${scoreInfo.technical.percent}%`}
                        style={{ padding: "2px 8px", background: recommendation.color, color: "#fff",
                          borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                        {scoreInfo.totalScore}/{scoreInfo.totalMax}
                      </span>
                      <div style={{ fontSize: 9, color: "#78716c", marginTop: 1 }}>%{scoreInfo.percent}</div>
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
