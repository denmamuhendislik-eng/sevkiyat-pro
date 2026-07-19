import { useState, useEffect, useMemo } from "react";
import {
  subscribeFeasibilityForYear, suggestNextStudyNo, saveFeasibilityStudy,
  signFeasibilityRole, unsignFeasibilityRole, deleteFeasibilityStudy,
  FEASIBILITY_ROLES, GM_ROLE_KEY, computeStudyStatus, countSignatures,
} from "./firestore";
import {
  EVALUATION_QUESTIONS, PRODUCT_DIMENSIONS, WORK_TYPES, DECISIONS,
  RECEIVED_DATA_TYPES, makeEmptyStudy,
} from "./schema";

export default function Yapilabilirlik({ isAdmin, isUretim, isSales }) {
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
            onClick={() => setActiveTab(t.id)}
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
          canEdit={canEdit} isAdmin={isAdmin} isSales={isSales} isUretim={isUretim}
          initialStudy={pendingOpen?.study || null}
          readOnly={!!pendingOpen?.readOnly}
          onSaved={() => { setPendingOpen(null); setActiveTab("list"); }}
        />
      )}
      {activeTab === "list" && <FeasibilityListView canEdit={canEdit} isAdmin={isAdmin} onOpen={openStudy} />}
    </div>
  );
}

// ==================== Yeni Yapılabilirlik Form ====================

function NewFeasibilityView({ canEdit, isAdmin, isSales, isUretim, initialStudy, readOnly, onSaved }) {
  const isGM = !!isAdmin; // App.jsx'e ekleyeceğimiz özel GM rol prop'una geçilebilir; şimdilik admin = GM
  const [studyNo, setStudyNo] = useState("");
  const [study, setStudy] = useState(() => makeEmptyStudy(""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveResult, setSaveResult] = useState(null);
  const [staging, setStaging] = useState(false);
  const [signRolePicker, setSignRolePicker] = useState(null); // {roleKey}
  const readonlyForm = readOnly;

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

  // Ürün detayı tablosu
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
      setSaveResult({ ok: true, ...out, message: `Yapılabilirlik kaydedildi: ${studyNo}` });
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydetme hatası");
    } finally {
      setSaving(false);
    }
  };

  const handleSignRole = async (roleKey, signerRoleLabel) => {
    if (!studyNo) { setError("Önce yapılabilirliği kaydet"); return; }
    if (roleKey === GM_ROLE_KEY && !isGM) {
      setError("Genel Müdür imzası için sadece GM yetkilidir");
      return;
    }
    try {
      // İmza atanın gerçek rolü — isAdmin/isSales/isUretim'e göre en yakın etiket
      const actualLabel = signerRoleLabel || (isAdmin ? "Genel Müdür"
        : isSales ? "Satış ve Proje Yöneticisi"
        : isUretim ? "Üretim Yöneticisi"
        : "Kullanıcı");
      await signFeasibilityRole(studyNo, roleKey, {
        signerName: "kullanıcı",
        signerRoleLabel: actualLabel,
        isGeneralManager: isGM,
        canEdit,
        staging,
      });
      // State'i optimist güncelle
      setStudy(prev => ({
        ...prev,
        signatures: {
          ...(prev.signatures || {}),
          [roleKey]: {
            signedAt: new Date().toISOString(),
            signedBy: "kullanıcı",
            signedForRole: roleKey,
            actualRole: actualLabel,
            isDelegate: FEASIBILITY_ROLES.find(r => r.key === roleKey)?.label !== actualLabel,
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

  const status = computeStudyStatus(study);
  const sigCount = countSignatures(study);

  const cardStyle = { padding: 14, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff", marginBottom: 12 };
  const labelStyle = { display: "block", fontSize: 11, color: "#57534e", marginBottom: 3, fontWeight: 500 };
  const inputStyle = { width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
  const disabledInput = { ...inputStyle, background: "#f5f5f4", color: "#78716c" };

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
        💡 <b>Yapılabilirlik</b> — müşteri talebi geldiğinde teknik + ticari ekipler değerlendirir. Onaylanınca doğrudan satışçıya düşer, teklife dönüşür.
      </div>

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

      {/* KAPAK */}
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
            <input value={study.customerName || ""} onChange={e => update("customerName", e.target.value)} disabled={readonlyForm} style={inputStyle} />
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
            <label style={labelStyle}>Parça No</label>
            <input value={study.partNo || ""} onChange={e => update("partNo", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
          </div>
          <div>
            <label style={labelStyle}>Malzeme</label>
            <input value={study.material || ""} onChange={e => update("material", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Müşteri Teklif No</label>
            <input value={study.customerQuoteNo || ""} onChange={e => update("customerQuoteNo", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Müşteri İrtibat</label>
            <input value={study.customerContact || ""} onChange={e => update("customerContact", e.target.value)} disabled={readonlyForm} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Yardımcı Malzeme</label>
            <input value={study.otherMaterials || ""} onChange={e => update("otherMaterials", e.target.value)} disabled={readonlyForm} style={inputStyle} />
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

      {/* DEĞERLENDİRME */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>3️⃣ Yapılabilirlik Değerlendirmesi</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
              <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Değerlendirme Sorusu</th>
              <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 60, textAlign: "center" }}>EVET</th>
              <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 60, textAlign: "center" }}>HAYIR</th>
              <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>AÇIKLAMA</th>
            </tr>
          </thead>
          <tbody>
            {EVALUATION_QUESTIONS.map(q => {
              const v = study.evaluation?.[q.key] || {};
              return (
                <tr key={q.key} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "4px 8px" }}>{q.label}</td>
                  <td style={{ padding: "4px 8px", textAlign: "center" }}><input type="radio" name={`eval_${q.key}`} checked={v.answer === "yes"} onChange={() => updateEvaluation(q.key, "answer", "yes")} disabled={readonlyForm} /></td>
                  <td style={{ padding: "4px 8px", textAlign: "center" }}><input type="radio" name={`eval_${q.key}`} checked={v.answer === "no"} onChange={() => updateEvaluation(q.key, "answer", "no")} disabled={readonlyForm} /></td>
                  <td style={{ padding: "3px 4px" }}><input value={v.note || ""} onChange={e => updateEvaluation(q.key, "note", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ÜRÜN DETAYI */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>4️⃣ Ürün Detayı (FR-71.2)</div>
          <button onClick={addProduct} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ Ürün Ekle</button>
        </div>
        {(study.productDetails || []).length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz ürün yok</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                  <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, width: 30 }}>NO</th>
                  <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9 }}>Parça Kodu</th>
                  <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9 }}>Parça Adı</th>
                  {PRODUCT_DIMENSIONS.map(d => (
                    <th key={d.key} colSpan={d.hasSourceType ? 3 : 2} style={{ padding: "5px 6px", fontWeight: 600, fontSize: 9, textAlign: "center", borderLeft: "1px solid #e7e5e4" }}>
                      {d.label}
                    </th>
                  ))}
                  <th style={{ padding: "5px 6px", width: 30 }}></th>
                </tr>
                <tr style={{ background: "#fafaf9", textAlign: "left", color: "#78716c" }}>
                  <th colSpan="3"></th>
                  {PRODUCT_DIMENSIONS.map(d => (
                    <>
                      <th key={`${d.key}_ans`} style={{ padding: "3px 6px", fontSize: 8, textAlign: "center", borderLeft: "1px solid #e7e5e4" }}>E/H</th>
                      <th key={`${d.key}_cost`} style={{ padding: "3px 6px", fontSize: 8, textAlign: "right" }}>Birim TL</th>
                      {d.hasSourceType && <th key={`${d.key}_src`} style={{ padding: "3px 6px", fontSize: 8, textAlign: "center" }}>Kaynak</th>}
                    </>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(study.productDetails || []).map((p, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "3px 6px", fontWeight: 600, textAlign: "center", color: "#1e40af" }}>{p.no}</td>
                    <td style={{ padding: "3px 4px" }}><input value={p.partCode || ""} onChange={e => updateProduct(i, "partCode", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                    <td style={{ padding: "3px 4px" }}><input value={p.partName || ""} onChange={e => updateProduct(i, "partName", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                    {PRODUCT_DIMENSIONS.map(d => {
                      const ansKey = d.key;
                      const costKey = `${d.key}UnitCost`;
                      const srcKey = `${d.key}SourceType`;
                      return (
                        <>
                          <td key={`${d.key}_a`} style={{ padding: "3px 4px", textAlign: "center", borderLeft: "1px solid #e7e5e4" }}>
                            <select value={p[ansKey] || ""} onChange={e => updateProduct(i, ansKey, e.target.value)} disabled={readonlyForm} style={{ width: 55, padding: 2, fontSize: 9, border: "1px solid #d6d3d1", borderRadius: 2 }}>
                              <option value="">—</option>
                              <option value="yes">EVET</option>
                              <option value="no">HAYIR</option>
                            </select>
                          </td>
                          <td key={`${d.key}_c`} style={{ padding: "3px 4px" }}>
                            <input type="number" value={p[costKey] || 0} onChange={e => updateProduct(i, costKey, Number(e.target.value) || 0)} disabled={readonlyForm || p[ansKey] !== "yes"} style={{ width: 70, padding: 3, fontSize: 10, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          {d.hasSourceType && (
                            <td key={`${d.key}_s`} style={{ padding: "3px 4px", textAlign: "center" }}>
                              <select value={p[srcKey] || ""} onChange={e => updateProduct(i, srcKey, e.target.value)} disabled={readonlyForm || p[ansKey] !== "yes"} style={{ width: 65, padding: 2, fontSize: 9, border: "1px solid #d6d3d1", borderRadius: 2 }}>
                                <option value="">—</option>
                                <option value="direct">Direkt</option>
                                <option value="outsource">Fason</option>
                              </select>
                            </td>
                          )}
                        </>
                      );
                    })}
                    <td style={{ padding: "3px 6px", textAlign: "center" }}><button onClick={() => removeProduct(i)} disabled={readonlyForm} style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                    {!readonlyForm && (
                      <button onClick={() => handleUnsignRole(r.key)}
                        style={{ marginTop: 4, padding: "2px 6px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>
                        ↺ İptal
                      </button>
                    )}
                  </>
                ) : (
                  <button onClick={() => canSignThis ? handleSignRole(r.key) : alert("GM imzası için sadece GM yetkilidir")}
                    disabled={readonlyForm || !canEdit}
                    style={{ padding: "4px 8px", fontSize: 10, background: canSignThis ? "#1e40af" : "#e7e5e4", color: canSignThis ? "#fff" : "#a8a29e", border: "none", borderRadius: 3, cursor: (readonlyForm || !canEdit || !canSignThis) ? "not-allowed" : "pointer" }}>
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

      {!readonlyForm && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 20 }}>
          <button onClick={handleSave} disabled={saving || !canEdit}
            style={{ padding: "8px 20px", fontSize: 13, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "wait" : (canEdit ? "pointer" : "not-allowed"), fontWeight: 500 }}>
            {saving ? "Kaydediliyor..." : "💾 Kaydet"}
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== Liste ====================

function FeasibilityListView({ canEdit, isAdmin, onOpen }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ studies: {} });
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState({});

  useEffect(() => {
    const unsub = subscribeFeasibilityForYear(year, setData, { staging });
    return unsub;
  }, [year, staging]);

  const studies = useMemo(() => {
    const arr = Object.values(data?.studies || {});
    const q = search.trim().toLocaleLowerCase("tr-TR");
    const f = q ? arr.filter(s =>
      (s.customerName || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (s.partName || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (s.partNo || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (s.studyNo || "").includes(q)
    ) : arr;
    return f.sort((a, b) => (b.studyNo || "").localeCompare(a.studyNo || ""));
  }, [data, search]);

  const handleDelete = async (studyNo) => {
    if (!confirm(`Yapılabilirlik ${studyNo} silinsin mi?`)) return;
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
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 no / müşteri / parça"
          style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }} />
        <span style={{ fontSize: 11, color: "#78716c" }}>{studies.length} kayıt</span>
      </div>

      {studies.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          Bu yılda yapılabilirlik yok.
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
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
                  : status === "evaluating" ? { bg: "#fef3c7", fg: "#92400e", l: "⏳ Değerlendirmede" }
                  : { bg: "#f5f5f4", fg: "#57534e", l: "📝 Taslak" };
                return (
                  <tr key={s.studyNo} style={{ borderTop: "1px solid #f5f5f4" }}>
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
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => onOpen(s, { readOnly: false })}
                          style={{ padding: "3px 8px", fontSize: 10, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>✏ Aç</button>
                        {isAdmin && status !== "convertedToQuote" && (
                          <button onClick={() => handleDelete(s.studyNo)} disabled={!!deleting[s.studyNo]}
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
