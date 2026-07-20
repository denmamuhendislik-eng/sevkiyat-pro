// FAI (First Article Inspection) — ana görünüm.
// Diğer Müşteriler modülü altında "🔬 FAİ Belgeleri" sekmesinden açılır.
// 2 alt sekme: 📋 Liste · ➕ Yeni FAI

import React, { useState, useEffect, useMemo } from "react";
import {
  subscribeFaiForYear, suggestNextFaiNo, saveFaiRecord,
  updateFaiStatus, signFaiRole, unsignFaiRole, deleteFaiRecord,
  uploadFaiAttachment, deleteFaiAttachment,
  computeFaiStatus, countFaiSignatures,
} from "./firestore";
import {
  makeEmptyFai, FAI_STATUSES, FAI_ROLES,
  DETAIL_OR_ASSEMBLY_OPTIONS, FAI_TYPE_OPTIONS, CUSTOMER_APPROVAL_OPTIONS,
  CHARACTERISTIC_TYPES, FAI_ATTACHMENT_CATEGORIES,
} from "./schema";
import { customerBadge, matchCustomer, isKnownCustomer, OTHER_CUSTOMER_CODE } from "../customerMeta";
import {
  subscribeQuoteCustomers, subscribeQuoteParts,
} from "../../teklifler/firestore";
import { generateFaiPdf, buildFaiPdfBlob } from "./faiPdf";
import { downloadCocAttachmentBlob } from "../firestore";
import { searchCocDrive, importCocDriveFile } from "../driveClient";
import JSZip from "jszip";

export default function FaiView({ canEdit, isAdmin, customerFilter, searchText, cocParts, bomModels, pendingFromFeasibility, onConsumeFeasibility }) {
  const [subTab, setSubTab] = useState("list");
  const [pendingOpen, setPendingOpen] = useState(null); // { record, readOnly }
  const openRecord = (record, { readOnly = false } = {}) => {
    setPendingOpen({ record, readOnly });
    setSubTab("new");
  };

  // Feasibility'den FAI Başlat — payload'ı FAI initialRecord'a çevir ve Yeni FAI sekmesini aç
  useEffect(() => {
    if (pendingFromFeasibility) {
      import("./fromFeasibility").then(({ feasibilityToFaiPayload }) => {
        const payload = feasibilityToFaiPayload(pendingFromFeasibility);
        if (payload) {
          setPendingOpen({ record: payload, readOnly: false });
          setSubTab("new");
        }
        onConsumeFeasibility && onConsumeFeasibility();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFromFeasibility]);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        <button onClick={() => setSubTab("list")}
          style={{ padding: "6px 14px", border: "none",
            background: subTab === "list" ? "#534AB7" : "transparent",
            color: subTab === "list" ? "#fff" : "#57534e",
            fontSize: 12, fontWeight: subTab === "list" ? 500 : 400,
            cursor: "pointer", borderRadius: "4px 4px 0 0" }}>
          📋 Liste
        </button>
        <button onClick={() => { setPendingOpen(null); setSubTab("new"); }}
          style={{ padding: "6px 14px", border: "none",
            background: subTab === "new" ? "#534AB7" : "transparent",
            color: subTab === "new" ? "#fff" : "#57534e",
            fontSize: 12, fontWeight: subTab === "new" ? 500 : 400,
            cursor: "pointer", borderRadius: "4px 4px 0 0" }}>
          ➕ Yeni FAI
        </button>
      </div>

      {subTab === "list" && <FaiListView canEdit={canEdit} isAdmin={isAdmin}
        customerFilter={customerFilter} searchText={searchText}
        onOpen={openRecord} />}
      {subTab === "new" && <NewFaiView canEdit={canEdit} isAdmin={isAdmin}
        cocParts={cocParts} bomModels={bomModels}
        initialRecord={pendingOpen?.record || null}
        readOnly={!!pendingOpen?.readOnly}
        onSaved={() => { setPendingOpen(null); setSubTab("list"); }} />}
    </div>
  );
}

// ==================== Yeni FAI Form ====================

function NewFaiView({ canEdit, isAdmin, cocParts, bomModels, initialRecord, readOnly, onSaved }) {
  const [faiNo, setFaiNo] = useState("");
  const [record, setRecord] = useState(() => makeEmptyFai(""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveResult, setSaveResult] = useState(null);
  const [staging, setStaging] = useState(false);
  const [activeForm, setActiveForm] = useState(1); // 1 | 2 | 3

  // Subscribe: müşteri + parça kütüphaneleri (otomatik doldurma için)
  const [customersData, setCustomersData] = useState({ customers: {} });
  const [quotePartsLib, setQuotePartsLib] = useState({ parts: {} });
  useEffect(() => {
    const u1 = subscribeQuoteCustomers(d => setCustomersData(d || { customers: {} }), { staging });
    const u2 = subscribeQuoteParts(d => setQuotePartsLib(d || { parts: {} }), { staging });
    return () => { u1(); u2(); };
  }, [staging]);
  const customerList = useMemo(() => Object.values(customersData?.customers || {}), [customersData]);

  useEffect(() => {
    if (initialRecord) {
      setRecord({ ...makeEmptyFai(initialRecord.faiNo || ""), ...initialRecord });
      setFaiNo(initialRecord.faiNo || "");
    }
  }, [initialRecord]);

  useEffect(() => {
    if (!faiNo && (!initialRecord || !initialRecord.faiNo)) {
      suggestNextFaiNo(new Date(), { staging }).then(no => {
        setFaiNo(no);
        setRecord(prev => ({ ...prev, faiNo: no, fairNumber: no })); // Alan 4 default = faiNo
      }).catch(() => {});
    }
  }, [faiNo, initialRecord, staging]);

  const update = (key, value) => setRecord(prev => ({ ...prev, [key]: value }));

  // Müşteri seçilince otomatik doldur
  const applyCustomer = (name) => {
    update("customerName", name);
    const c = customersData?.customers?.[name];
    if (c) {
      if (c.code) update("customerCode", c.code);
    }
  };

  // Parça arama (cocParts + quoteParts birleştirilmiş)
  const [partSearchQuery, setPartSearchQuery] = useState("");
  const [partSearchOpen, setPartSearchOpen] = useState(false);
  const partSearchResults = useMemo(() => {
    const q = partSearchQuery.trim().toLocaleLowerCase("tr-TR");
    if (!q || q.length < 2) return [];
    const results = [];
    // 1) cocParts (öncelikli — Aselsan/Roketsan parça master)
    for (const p of Object.values(cocParts?.parts || {})) {
      if (!p?.stokKodu) continue;
      const hay = `${p.stokKodu} ${p.description || ""} ${p.faiNo || ""}`.toLocaleLowerCase("tr-TR");
      if (hay.includes(q)) {
        results.push({ source: "coc", stokKodu: p.stokKodu, adı: p.description, faiNo: p.faiNo, revisions: p.revisions, customerCode: p.customerCode });
      }
    }
    // 2) quoteParts (teklif kütüphanesi — yapılabilirlik veya teklifle eklenen)
    for (const p of Object.values(quotePartsLib?.parts || {})) {
      if (!p?.stokKodu) continue;
      if (results.find(r => r.stokKodu === p.stokKodu)) continue; // dedup
      const hay = `${p.stokKodu} ${p.stokAdi || ""} ${p.musteriKodu || ""}`.toLocaleLowerCase("tr-TR");
      if (hay.includes(q)) {
        results.push({ source: "quote", stokKodu: p.stokKodu, adı: p.stokAdi, musteriKodu: p.musteriKodu, hammadde: p.hammadde });
      }
    }
    return results.slice(0, 15);
  }, [partSearchQuery, cocParts, quotePartsLib]);

  const applyPart = (part) => {
    setRecord(prev => {
      const next = { ...prev };
      next.partNumber = part.stokKodu || next.partNumber;
      next.partName = part.adı || next.partName;
      next.stockCode = part.stokKodu;
      if (part.source === "coc") {
        // COC master'dan revizyon
        if (Array.isArray(part.revisions) && part.revisions.length > 0) {
          next.partRevision = part.revisions[part.revisions.length - 1];
        }
        if (part.faiNo) next.drawingNumber = part.faiNo; // FAI No çizim ile ilişkili olabilir
      }
      return next;
    });
    setPartSearchOpen(false);
    setPartSearchQuery("");
  };

  // Form 2 — malzeme/proses ekleme
  const addMaterialProcess = () => setRecord(prev => ({
    ...prev,
    materialsAndProcesses: [...(prev.materialsAndProcesses || []), {
      materialOrProcessName: "", specificationNumber: "", code: "",
      supplier: "", customerApprovalVerification: "", certificateNumber: "",
    }],
  }));
  const updateMatProcess = (idx, key, value) => setRecord(prev => ({
    ...prev,
    materialsAndProcesses: (prev.materialsAndProcesses || []).map((it, i) => i === idx ? { ...it, [key]: value } : it),
  }));
  const removeMatProcess = (idx) => setRecord(prev => ({
    ...prev,
    materialsAndProcesses: (prev.materialsAndProcesses || []).filter((_, i) => i !== idx),
  }));

  const addFunctionalTest = () => setRecord(prev => ({
    ...prev,
    functionalTests: [...(prev.functionalTests || []), { procedureNumber: "", procedureRevision: "", acceptanceReportNo: "" }],
  }));
  const updateFunctionalTest = (idx, key, value) => setRecord(prev => ({
    ...prev,
    functionalTests: (prev.functionalTests || []).map((it, i) => i === idx ? { ...it, [key]: value } : it),
  }));
  const removeFunctionalTest = (idx) => setRecord(prev => ({
    ...prev,
    functionalTests: (prev.functionalTests || []).filter((_, i) => i !== idx),
  }));

  // Form 3 — karakteristik ölçüm ekleme (F-3'te detaylandırılacak)
  const addCharacteristic = () => setRecord(prev => {
    const nextNo = (prev.characteristics || []).length + 1;
    return {
      ...prev,
      characteristics: [...(prev.characteristics || []), {
        characteristicNo: String(nextNo),
        referenceLocation: "", characteristicType: "", requirement: "",
        results: "", specialToolId: "", nonconformanceNumber: "",
        occurrenceCount: 1, // "N Yer" — çoklu ölçüm için
      }],
    };
  });
  const updateCharacteristic = (idx, key, value) => setRecord(prev => ({
    ...prev,
    characteristics: (prev.characteristics || []).map((c, i) => i === idx ? { ...c, [key]: value } : c),
  }));
  const removeCharacteristic = (idx) => setRecord(prev => ({
    ...prev,
    characteristics: (prev.characteristics || []).filter((_, i) => i !== idx).map((c, i) => ({ ...c, characteristicNo: String(i + 1) })),
  }));

  // Alt bileşenler (Form 1 Alan 15-17) — montaj için
  const addSubComponent = () => setRecord(prev => ({
    ...prev,
    subComponents: [...(prev.subComponents || []), { partNumber: "", partName: "", serialNumber: "", fairNumber: "" }],
  }));
  const updateSubComponent = (idx, key, value) => setRecord(prev => ({
    ...prev,
    subComponents: (prev.subComponents || []).map((s, i) => i === idx ? { ...s, [key]: value } : s),
  }));
  const removeSubComponent = (idx) => setRecord(prev => ({
    ...prev,
    subComponents: (prev.subComponents || []).filter((_, i) => i !== idx),
  }));

  const status = computeFaiStatus(record);
  const sigCount = countFaiSignatures(record);
  const isLocked = status === "customerApproved"; // sadece müşteri onayı sonrası tam kilit
  const readonlyForm = readOnly || isLocked;

  // Belge yükleme (F-4)
  const [uploadingCat, setUploadingCat] = useState({}); // { catKey: bool }

  const handleUpload = async (categoryKey, file) => {
    if (!file) return;
    if (!faiNo) { alert("Önce FAI No belirle"); return; }
    setUploadingCat(u => ({ ...u, [categoryKey]: true }));
    try {
      const meta = await uploadFaiAttachment(faiNo, categoryKey, file, { canEdit });
      const cat = FAI_ATTACHMENT_CATEGORIES.find(c => c.key === categoryKey);
      setRecord(prev => {
        const attach = { ...(prev.attachments || {}) };
        if (cat?.multi) {
          const list = Array.isArray(attach[categoryKey]) ? attach[categoryKey] : [];
          attach[categoryKey] = [...list, meta];
        } else {
          attach[categoryKey] = meta;
        }
        return { ...prev, attachments: attach };
      });
    } catch (e) {
      alert("Yükleme hatası: " + e.message);
    } finally {
      setUploadingCat(u => ({ ...u, [categoryKey]: false }));
    }
  };

  // Drive önerisi state + handler (F-9A)
  const [driveSearchState, setDriveSearchState] = useState(null);

  const runDriveSearch = async (categoryKey) => {
    const cat = FAI_ATTACHMENT_CATEGORIES.find(c => c.key === categoryKey);
    if (!cat?.driveCategory) { alert("Bu kategori için Drive arama tanımlanmamış"); return; }
    if (!record.partNumber) { alert("Önce Parça No gir (Form 1 Alan 1)"); return; }
    setDriveSearchState({ categoryKey, category: cat.driveCategory, results: null, loading: true, error: null });
    try {
      const res = await searchCocDrive({ category: cat.driveCategory, stokKodu: record.partNumber, altName: record.partName || "" });
      setDriveSearchState({ categoryKey, category: cat.driveCategory, results: res?.results || [], loading: false, error: res?.message || null });
    } catch (e) {
      setDriveSearchState({ categoryKey, category: cat.driveCategory, results: [], loading: false, error: e.message });
    }
  };
  const closeDriveSearch = () => setDriveSearchState(null);

  const importFromDrive = async (categoryKey, fileId) => {
    if (!faiNo) { alert("Önce FAI No belirle"); return; }
    const cat = FAI_ATTACHMENT_CATEGORIES.find(c => c.key === categoryKey);
    setUploadingCat(u => ({ ...u, [categoryKey]: true }));
    try {
      const year = "20" + String(faiNo).slice(0, 2);
      const res = await importCocDriveFile({
        fileId, certNo: faiNo, certYear: year,
        category: cat?.driveCategory || "fai", stokKodu: record.partNumber || "",
      });
      if (!res?.success) throw new Error(res?.message || "Drive import başarısız");
      const meta = res.coc || {};
      const newDoc = {
        url: meta.downloadUrl, path: meta.storagePath,
        name: meta.filename || "drive-file.pdf", size: meta.size || 0,
        category: categoryKey, uploadedAt: meta.uploadedAt || new Date().toISOString(),
        source: "drive",
      };
      setRecord(prev => {
        const attach = { ...(prev.attachments || {}) };
        if (cat?.multi) {
          const list = Array.isArray(attach[categoryKey]) ? attach[categoryKey] : [];
          attach[categoryKey] = [...list, newDoc];
        } else {
          attach[categoryKey] = newDoc;
        }
        return { ...prev, attachments: attach };
      });
      closeDriveSearch();
    } catch (e) {
      alert("Drive dosyası aktarılamadı: " + e.message);
    } finally {
      setUploadingCat(u => ({ ...u, [categoryKey]: false }));
    }
  };

  const handleDeleteAttachment = async (categoryKey, index = null) => {
    const cat = FAI_ATTACHMENT_CATEGORIES.find(c => c.key === categoryKey);
    const attach = record.attachments || {};
    let target;
    if (cat?.multi) {
      const list = Array.isArray(attach[categoryKey]) ? attach[categoryKey] : [];
      target = list[index];
    } else {
      target = attach[categoryKey];
    }
    if (!target?.path) return;
    if (!confirm(`${target.name || 'Dosya'} silinsin mi?`)) return;
    try {
      await deleteFaiAttachment(target.path);
      setRecord(prev => {
        const a = { ...(prev.attachments || {}) };
        if (cat?.multi) {
          const list = Array.isArray(a[categoryKey]) ? a[categoryKey] : [];
          a[categoryKey] = list.filter((_, i) => i !== index);
        } else {
          a[categoryKey] = null;
        }
        return { ...prev, attachments: a };
      });
    } catch (e) {
      alert("Silme hatası: " + e.message);
    }
  };

  const handleSave = async () => {
    if (readonlyForm) return;
    if (!canEdit) return;
    if (!faiNo) { setError("FAI No boş"); return; }
    if (!record.partNumber) { setError("Parça No zorunlu (Form 1 Alan 1)"); return; }
    if (!record.partName) { setError("Parça Adı zorunlu (Form 1 Alan 2)"); return; }
    if (!record.manufacturingOrderNo) { setError("Üretim İş Emri No zorunlu (Form 1 Alan 9)"); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...record, faiNo };
      const out = await saveFaiRecord(payload, { canEdit, staging });
      setSaveResult({ ok: true, ...out, message: `FAI kaydedildi: ${faiNo}` });
      onSaved && onSaved();
    } catch (e) {
      setError(e.message || "Kaydetme hatası");
    } finally {
      setSaving(false);
    }
  };

  // İmza akışı (F-7)
  const handleSignRoleUi = async (roleKey) => {
    if (!faiNo) { alert("Önce FAI'yi kaydet"); return; }
    const role = FAI_ROLES.find(r => r.key === roleKey);
    try {
      await signFaiRole(faiNo, roleKey, {
        canEdit, staging,
        userEmail: "kullanici",
        roleLabel: role?.label || "",
      });
      // Optimist güncelle
      setRecord(prev => ({
        ...prev,
        signatures: { ...(prev.signatures || {}), [roleKey]: { signedAt: new Date().toISOString(), signedBy: "kullanici", signedRoleLabel: role?.label } },
      }));
    } catch (e) { alert(e.message); }
  };

  const handleUnsignRoleUi = async (roleKey) => {
    const role = FAI_ROLES.find(r => r.key === roleKey);
    if (!confirm(`${role?.label} imzası iptal edilsin mi?`)) return;
    try {
      await unsignFaiRole(faiNo, roleKey, { canEdit, staging });
      setRecord(prev => {
        const next = { ...prev, signatures: { ...(prev.signatures || {}) } };
        delete next.signatures[roleKey];
        return next;
      });
    } catch (e) { alert(e.message); }
  };

  // Durum değiştirme (F-7)
  const handleChangeStatus = async (newStatus) => {
    if (!faiNo) { alert("Önce FAI'yi kaydet"); return; }
    const badge = FAI_STATUSES.find(s => s.key === newStatus);
    const note = newStatus === "rejected"
      ? prompt(`Reddedildi olarak işaretle. Not (opsiyonel):`, "")
      : "";
    try {
      await updateFaiStatus(faiNo, newStatus, { canEdit, staging, note: note || "" });
      setRecord(prev => ({ ...prev, status: newStatus }));
    } catch (e) { alert(e.message); }
  };

  const badgeForStatus = FAI_STATUSES.find(s => s.key === status);

  // Basit stiller
  const cardStyle = { padding: 14, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff", marginBottom: 12 };
  const labelStyle = { display: "block", fontSize: 11, color: "#57534e", marginBottom: 3, fontWeight: 500 };
  const inputStyle = { width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
  const requiredMark = <span style={{ color: "#dc2626" }}>*</span>;
  // Zorunlu alanlar için hafif sarı bg (talimatta belirtilen)
  const yellowBg = { background: "#fef3c7" };
  const blueBg = { background: "#dbeafe" };

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
        🔬 <b>İlk Ürün Muayenesi (FAI)</b> — SAE AS9102 uyumlu. Sarı alanlar zorunlu, mavi alanlar şarta bağlı, beyaz alanlar opsiyoneldir.
      </div>

      {record.linkedFeasibilityNo && (
        <div style={{ marginBottom: 12, padding: 10, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, fontSize: 11, color: "#166534" }}>
          🎯 <b>Yapılabilirlik'ten oluşturuldu</b> — <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{record.linkedFeasibilityNo}</span>
          <br /><span style={{ fontSize: 10, color: "#15803d" }}>Parça bilgisi + hammadde + fason kalemleri otomatik dolduruldu. Karakteristik ölçümler ve Form 3 elle doldurulmalıdır.</span>
        </div>
      )}

      {isLocked && (
        <div style={{ marginBottom: 12, padding: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 4, fontSize: 12, color: "#166534", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🎉</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Müşteri Onayladı — Kilitli</div>
            <div style={{ fontSize: 11, color: "#15803d", marginTop: 2 }}>
              Bu FAI müşteri tarafından onaylandı, düzenleme kilitli. Yeni FAI için değişiklik olması gerekir.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging (test)
        </label>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "#57534e" }}>
          Durum: <b style={{ color: badgeForStatus?.color, background: badgeForStatus?.bg, padding: "2px 8px", borderRadius: 3 }}>{badgeForStatus?.label}</b>
          {" · "}İmza: {sigCount.signed}/{sigCount.total}
        </div>
      </div>

      {/* PARÇA ARAMA (COC + Teklif) */}
      <div style={{ ...cardStyle, background: "#f0f9ff", border: "1px solid #bfdbfe" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>🔍 Parça Ara / Ekle</div>
          {record.stockCode && (
            <span style={{ padding: "2px 8px", background: "#dbeafe", color: "#1e40af", borderRadius: 3, fontSize: 10, fontWeight: 500 }}>
              Bağlantılı: <b style={{ fontFamily: "ui-monospace, monospace" }}>{record.stockCode}</b>
            </span>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <input value={partSearchQuery}
            onChange={e => { setPartSearchQuery(e.target.value); setPartSearchOpen(true); }}
            onFocus={() => setPartSearchOpen(true)}
            placeholder="Stok kodu, parça adı veya FAI no ile ara (COC + Teklif kütüphanesi)..."
            disabled={readonlyForm}
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          />
          {partSearchOpen && partSearchResults.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, background: "#fff", border: "1px solid #d6d3d1", borderRadius: 4, boxShadow: "0 4px 8px rgba(0,0,0,0.08)", zIndex: 10, maxHeight: 300, overflowY: "auto" }}>
              {partSearchResults.map(p => (
                <div key={p.stokKodu + p.source} onClick={() => applyPart(p)}
                  style={{ padding: 8, borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f5f5f4"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 500 }}>{p.stokKodu}</span>
                    <span style={{ padding: "1px 5px", background: p.source === "coc" ? "#dcfce7" : "#eff6ff", color: p.source === "coc" ? "#166534" : "#1e40af", borderRadius: 2, fontSize: 9, fontWeight: 500 }}>
                      {p.source === "coc" ? "COC Master" : "Teklif Kütüphanesi"}
                    </span>
                    {p.faiNo && <span style={{ fontSize: 9, color: "#78716c" }}>FAI: {p.faiNo}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#44403c", marginTop: 2 }}>{p.adı || "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {partSearchOpen && <button onClick={() => setPartSearchOpen(false)} style={{ marginTop: 6, padding: "2px 8px", fontSize: 10, background: "transparent", color: "#78716c", border: "none", cursor: "pointer" }}>× kapat</button>}
      </div>

      {/* ONAY AKIŞI + İMZALAR (F-7) */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>✍️ İmzalar ve Durum</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FAI_STATUSES.filter(s => s.key !== status).map(s => (
              <button key={s.key} onClick={() => handleChangeStatus(s.key)} disabled={!canEdit || !faiNo}
                title={`Durumu değiştir: ${s.label}`}
                style={{ padding: "3px 8px", fontSize: 10, background: s.bg, color: s.color, border: "1px solid " + s.color, borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed", opacity: canEdit ? 1 : 0.5 }}>
                → {s.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {FAI_ROLES.map(r => {
            const sig = record.signatures?.[r.key];
            return (
              <div key={r.key} style={{ padding: 10, border: "1px solid " + (sig ? "#86efac" : "#e7e5e4"), background: sig ? "#f0fdf4" : "#fafaf9", borderRadius: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#44403c", marginBottom: 4 }}>{r.label}</div>
                {sig ? (
                  <>
                    <div style={{ fontSize: 10, color: "#166534", fontWeight: 600 }}>✓ İmzalandı</div>
                    <div style={{ fontSize: 9, color: "#78716c", marginTop: 2 }}>{String(sig.signedAt).slice(0, 10)}</div>
                    {!readonlyForm && canEdit && (
                      <button onClick={() => handleUnsignRoleUi(r.key)}
                        style={{ marginTop: 4, padding: "2px 6px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>↺ İptal</button>
                    )}
                  </>
                ) : (
                  <button onClick={() => handleSignRoleUi(r.key)} disabled={!canEdit || !faiNo}
                    style={{ padding: "4px 8px", fontSize: 10, background: "#1e40af", color: "#fff", border: "none", borderRadius: 3, cursor: (!canEdit || !faiNo) ? "not-allowed" : "pointer" }}>
                    İmzala
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* FORM SEKMESI — 3 form arası geçiş */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #e7e5e4" }}>
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => setActiveForm(n)}
            style={{ padding: "8px 16px", border: "none",
              background: activeForm === n ? "#1e40af" : "transparent",
              color: activeForm === n ? "#fff" : "#57534e",
              fontSize: 13, fontWeight: activeForm === n ? 500 : 400,
              cursor: "pointer", borderRadius: "6px 6px 0 0" }}>
            {n === 1 ? "Form 1: Parça Nitelikleri"
              : n === 2 ? "Form 2: Hammadde / İşlem / Test"
              : "Form 3: Karakteristik Ölçümler"}
          </button>
        ))}
      </div>

      {/* FORM 1 */}
      {activeForm === 1 && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>1️⃣ Parça / Ürün Bilgisi</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>1. Parça No {requiredMark}</label>
                <input value={record.partNumber || ""} onChange={e => update("partNumber", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...yellowBg, fontFamily: "ui-monospace, monospace" }} />
              </div>
              <div>
                <label style={labelStyle}>2. Parça Tanımı {requiredMark}</label>
                <input value={record.partName || ""} onChange={e => update("partName", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...yellowBg }} />
              </div>
              <div>
                <label style={labelStyle}>3. Seri No</label>
                <input value={record.serialNumber || ""} onChange={e => update("serialNumber", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...blueBg }} />
              </div>
              <div>
                <label style={labelStyle}>4. FAI Rapor No {requiredMark}</label>
                <input value={record.fairNumber || faiNo} onChange={e => update("fairNumber", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...yellowBg, fontFamily: "ui-monospace, monospace" }} />
              </div>
              <div>
                <label style={labelStyle}>5. Parça Revizyonu</label>
                <input value={record.partRevision || ""} onChange={e => update("partRevision", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...blueBg }} />
              </div>
              <div>
                <label style={labelStyle}>6. Çizim/Doküman No</label>
                <input value={record.drawingNumber || ""} onChange={e => update("drawingNumber", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...blueBg, fontFamily: "ui-monospace, monospace" }} />
              </div>
              <div>
                <label style={labelStyle}>7. Çizim Revizyonu</label>
                <input value={record.drawingRevision || ""} onChange={e => update("drawingRevision", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...blueBg }} />
              </div>
              <div>
                <label style={labelStyle}>8. Ek Değişiklikler</label>
                <input value={record.additionalChanges || ""} onChange={e => update("additionalChanges", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...blueBg }} />
              </div>
              <div>
                <label style={labelStyle}>9. Üretim İş Emri No {requiredMark}</label>
                <input value={record.manufacturingOrderNo || ""} onChange={e => update("manufacturingOrderNo", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...yellowBg, fontFamily: "ui-monospace, monospace" }} />
              </div>
              <div>
                <label style={labelStyle}>10. Firma Adı {requiredMark}</label>
                <input value={record.organizationName || ""} onChange={e => update("organizationName", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, ...yellowBg }} />
              </div>
              <div>
                <label style={labelStyle}>11. Tedarikçi Kodu</label>
                <input value={record.supplierCode || ""} onChange={e => update("supplierCode", e.target.value)} disabled={readonlyForm} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>12. Müşteri Sipariş No</label>
                <input value={record.customerPoNumber || ""} onChange={e => update("customerPoNumber", e.target.value)} disabled={readonlyForm} style={inputStyle} />
              </div>
            </div>

            {/* Müşteri (bağlantı) */}
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Müşteri Adı</label>
                <input list="faiCustomerList" value={record.customerName || ""} onChange={e => applyCustomer(e.target.value)} disabled={readonlyForm} style={inputStyle} placeholder="Yaz veya listeden seç" />
                <datalist id="faiCustomerList">
                  {customerList.map(c => <option key={c.name} value={c.name}>{c.totalQuotes || 0} teklif</option>)}
                </datalist>
              </div>
              <div>
                <label style={labelStyle}>Müşteri Kodu</label>
                <input value={record.customerCode || ""} onChange={e => update("customerCode", e.target.value)} disabled={readonlyForm} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* FAI Türü */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>2️⃣ FAI Türü</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={labelStyle}>13. Detay Parça / Takım {requiredMark}</label>
                <div style={{ display: "flex", gap: 12 }}>
                  {DETAIL_OR_ASSEMBLY_OPTIONS.map(o => (
                    <label key={o.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <input type="radio" checked={record.detailOrAssembly === o.key} onChange={() => update("detailOrAssembly", o.key)} disabled={readonlyForm} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle}>14. Tam / Kısmi FAI {requiredMark}</label>
                <div style={{ display: "flex", gap: 12 }}>
                  {FAI_TYPE_OPTIONS.map(o => (
                    <label key={o.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <input type="radio" checked={record.faiType === o.key} onChange={() => update("faiType", o.key)} disabled={readonlyForm} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {record.faiType === "partial" && (
              <div style={{ marginTop: 10, padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: "#92400e", marginBottom: 6 }}>⚠ Kısmi FAI seçildi — önceki onaylı konfigürasyon bilgisi gerekli:</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Önceki FAI No</label>
                    <input value={record.previousFairNumber || ""} onChange={e => update("previousFairNumber", e.target.value)} disabled={readonlyForm} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Kısmi FAI Gerekçesi</label>
                    <input value={record.partialFaiReason || ""} onChange={e => update("partialFaiReason", e.target.value)} disabled={readonlyForm} style={inputStyle} placeholder="Örn. tasarım değişikliği" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Alt bileşenler (montaj için) */}
          {record.detailOrAssembly === "assembly" && (
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>3️⃣ Alt Bileşen Listesi (15-18)</div>
                <button onClick={addSubComponent} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ Alt Bileşen</button>
              </div>
              <div style={{ fontSize: 10, color: "#78716c", marginBottom: 8 }}>Her alt bileşenin kendi FAI Rapor Numarasına sahip olması gerekir.</div>
              {(record.subComponents || []).length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz alt bileşen yok</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>15. Parça No</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>16. Parça Tanımı</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>17. Seri No</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>18. FAI Rapor No</th>
                      <th style={{ padding: "5px 8px", width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(record.subComponents || []).map((s, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                        <td style={{ padding: "3px 4px" }}><input value={s.partNumber || ""} onChange={e => updateSubComponent(i, "partNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px" }}><input value={s.partName || ""} onChange={e => updateSubComponent(i, "partName", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px" }}><input value={s.serialNumber || ""} onChange={e => updateSubComponent(i, "serialNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px" }}><input value={s.fairNumber || ""} onChange={e => updateSubComponent(i, "fairNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeSubComponent(i)} disabled={readonlyForm} style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* FORM 2 */}
      {activeForm === 2 && (
        <>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🧪 Hammadde ve Özel İşlem(ler) — Uygunluk Sertifikaları</div>
              <button onClick={addMaterialProcess} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ Malzeme/Proses</button>
            </div>
            <div style={{ fontSize: 10, color: "#78716c", marginBottom: 8 }}>
              Uygulanan özel prosesler (lehim, kaplama, ısıl işlem, kaynak, boya, potting vb.) veya kullanılan hammaddeler için uygunluk sertifikası bilgisi.
            </div>
            {(record.materialsAndProcesses || []).length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz kalem yok</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>5. Malzeme / Süreç Adı</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>6. Spesifikasyon No</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>7. Kod</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>8. Tedarikçi</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10, width: 100 }}>9. Müşteri Onayı</th>
                      <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>10. Uygunluk Belge No</th>
                      <th style={{ padding: "5px 8px", width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(record.materialsAndProcesses || []).map((mp, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                        <td style={{ padding: "3px 4px" }}><input value={mp.materialOrProcessName || ""} onChange={e => updateMatProcess(i, "materialOrProcessName", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} placeholder="Örn. Anodizasyon" /></td>
                        <td style={{ padding: "3px 4px" }}><input value={mp.specificationNumber || ""} onChange={e => updateMatProcess(i, "specificationNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px" }}><input value={mp.code || ""} onChange={e => updateMatProcess(i, "code", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px" }}><input value={mp.supplier || ""} onChange={e => updateMatProcess(i, "supplier", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px" }}>
                          <select value={mp.customerApprovalVerification || ""} onChange={e => updateMatProcess(i, "customerApprovalVerification", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2, background: "#fff" }}>
                            <option value="">—</option>
                            {CUSTOMER_APPROVAL_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "3px 4px" }}><input value={mp.certificateNumber || ""} onChange={e => updateMatProcess(i, "certificateNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                        <td style={{ padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeMatProcess(i)} disabled={readonlyForm} style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Fonksiyonel Testler */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🧪 Fonksiyonel Testler</div>
              <button onClick={addFunctionalTest} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ Test</button>
            </div>
            {(record.functionalTests || []).length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz test yok</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                    <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>11. Prosedür No</th>
                    <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>Prosedür Revizyon/Tarih</th>
                    <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 10 }}>12. Kabul Raporu No</th>
                    <th style={{ padding: "5px 8px", width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(record.functionalTests || []).map((t, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                      <td style={{ padding: "3px 4px" }}><input value={t.procedureNumber || ""} onChange={e => updateFunctionalTest(i, "procedureNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                      <td style={{ padding: "3px 4px" }}><input value={t.procedureRevision || ""} onChange={e => updateFunctionalTest(i, "procedureRevision", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                      <td style={{ padding: "3px 4px" }}><input value={t.acceptanceReportNo || ""} onChange={e => updateFunctionalTest(i, "acceptanceReportNo", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                      <td style={{ padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeFunctionalTest(i)} disabled={readonlyForm} style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>13. Yorumlar</label>
            <textarea value={record.form2Comments || ""} onChange={e => update("form2Comments", e.target.value)} disabled={readonlyForm} rows={3} style={inputStyle} />
          </div>
        </>
      )}

      {/* FORM 3 — F-3'te detaylandırılacak, şimdilik basit */}
      {activeForm === 3 && (
        <>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>📏 Karakteristik Ölçümler</div>
              <button onClick={addCharacteristic} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ Karakteristik</button>
            </div>
            <div style={{ fontSize: 10, color: "#78716c", marginBottom: 8 }}>
              Çizimdeki her balonlu ölçüm için satır ekleyin. Balonlu resim ekiyle birlikte kullanılır.
            </div>
            {(record.characteristics || []).length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Henüz karakteristik yok</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f4", textAlign: "left", color: "#44403c" }}>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 40, textAlign: "center" }}>5. #</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 80 }}>6. Ref</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 90 }}>7. Tür</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10 }}>8. Gereksinim</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 55, textAlign: "center" }}>N Yer</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10 }}>9. Ölçüm Sonucu</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 90 }}>10. Özel Ölçüm</th>
                      <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 90 }}>11. Uygunsuzluk</th>
                      <th style={{ padding: "5px 6px", width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(record.characteristics || []).map((c, i) => {
                      const hasNoncnf = !!(c.nonconformanceNumber && c.nonconformanceNumber.trim());
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #f5f5f4", background: hasNoncnf ? "#fef2f2" : "transparent" }}>
                          <td style={{ padding: "3px 6px", textAlign: "center", fontWeight: 600, color: "#1e40af" }}>{c.characteristicNo}</td>
                          <td style={{ padding: "3px 4px" }}><input value={c.referenceLocation || ""} onChange={e => updateCharacteristic(i, "referenceLocation", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} placeholder="Sf 1/A2" /></td>
                          <td style={{ padding: "3px 4px" }}>
                            <select value={c.characteristicType || ""} onChange={e => updateCharacteristic(i, "characteristicType", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2, background: "#fff" }}>
                              <option value="">—</option>
                              {CHARACTERISTIC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "3px 4px" }}><input value={c.requirement || ""} onChange={e => updateCharacteristic(i, "requirement", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} placeholder="20 ±0.05" /></td>
                          <td style={{ padding: "3px 4px" }}>
                            <input type="number" min="1" value={c.occurrenceCount || 1} onChange={e => updateCharacteristic(i, "occurrenceCount", Number(e.target.value) || 1)} disabled={readonlyForm}
                              title="Aynı özellik parça üzerinde N yerde varsa (ör. 4 Yer). Sonuçlar min-max ile listelenebilir."
                              style={{ width: "100%", padding: 3, fontSize: 10, textAlign: "center", border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={c.results || ""} onChange={e => updateCharacteristic(i, "results", e.target.value)} disabled={readonlyForm}
                              placeholder={Number(c.occurrenceCount || 1) > 1 ? "min-max, örn. 19.98–20.02" : "19.98 veya Geçti"}
                              style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} />
                          </td>
                          <td style={{ padding: "3px 4px" }}><input value={c.specialToolId || ""} onChange={e => updateCharacteristic(i, "specialToolId", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2 }} /></td>
                          <td style={{ padding: "3px 4px" }}><input value={c.nonconformanceNumber || ""} onChange={e => updateCharacteristic(i, "nonconformanceNumber", e.target.value)} disabled={readonlyForm} style={{ width: "100%", padding: 3, fontSize: 10, fontFamily: "ui-monospace, monospace", border: "1px solid #d6d3d1", borderRadius: 2 }} placeholder="opsiyonel" /></td>
                          <td style={{ padding: "3px 4px", textAlign: "center" }}><button onClick={() => removeCharacteristic(i)} disabled={readonlyForm} style={{ background: "transparent", border: "none", color: "#dc2626", cursor: readonlyForm ? "not-allowed" : "pointer" }}>🗑</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>Yorumlar</label>
            <textarea value={record.form3Comments || ""} onChange={e => update("form3Comments", e.target.value)} disabled={readonlyForm} rows={3} style={inputStyle} />
          </div>

          {/* EK BELGELER (F-4) — Form 3 altında konsolide */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>📎 Ek Belgeler</div>
            <div style={{ fontSize: 10, color: "#78716c", marginBottom: 10 }}>
              Bu belgeler FAI paketinin (ZIP) içine dahil edilir. Balonlu resim Form 3 karakteristik referansları için, malzeme sertifikaları Form 2 için gereklidir.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              {FAI_ATTACHMENT_CATEGORIES.map(cat => {
                const items = cat.multi
                  ? (Array.isArray(record.attachments?.[cat.key]) ? record.attachments[cat.key] : [])
                  : (record.attachments?.[cat.key] ? [record.attachments[cat.key]] : []);
                const isUploading = !!uploadingCat[cat.key];
                return (
                  <div key={cat.key} style={{ padding: 10, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#44403c", marginBottom: 6 }}>
                      {cat.icon} {cat.label}
                      {items.length > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: "#166534" }}>({items.length})</span>}
                    </div>
                    {items.length > 0 && (
                      <div style={{ marginBottom: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                        {items.map((meta, idx) => (
                          <div key={idx} style={{ padding: 4, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 3, display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                            <span style={{ flex: 1, color: "#166534", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={meta?.name}>
                              📄 {meta?.name || "dosya"}
                              {meta?.size ? <span style={{ marginLeft: 4, color: "#78716c" }}>· {(meta.size / 1024).toFixed(0)} KB</span> : null}
                            </span>
                            <a href={meta?.url} target="_blank" rel="noreferrer"
                              style={{ padding: "1px 5px", fontSize: 9, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 2, textDecoration: "none" }}>Aç</a>
                            {!readonlyForm && (
                              <button onClick={() => handleDeleteAttachment(cat.key, cat.multi ? idx : null)}
                                style={{ padding: "1px 5px", fontSize: 9, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 2, cursor: "pointer" }}>🗑</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {(!items.length || cat.multi) && !readonlyForm && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <label style={{ display: "inline-block", padding: "5px 10px", fontSize: 10, background: "#f5f5f4", color: "#57534e", border: "1px dashed #d6d3d1", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                          {isUploading ? "Yükleniyor..." : (cat.multi ? "📤 Dosya Ekle" : "📤 Dosya Seç")}
                          <input type="file" accept="application/pdf,image/*"
                            style={{ display: "none" }}
                            disabled={isUploading || !canEdit}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f) handleUpload(cat.key, f);
                              e.target.value = "";
                            }} />
                        </label>
                        {cat.driveCategory && (
                          <button onClick={() => runDriveSearch(cat.key)} disabled={isUploading || !canEdit}
                            style={{ padding: "5px 10px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed" }}>
                            🔍 Drive'dan
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Hata / Save */}
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
          try { await generateFaiPdf({ ...record, faiNo }); }
          catch (e) { alert("PDF hatası: " + e.message); }
        }}
          style={{ padding: "8px 16px", fontSize: 13, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
          📄 PDF Önizle (3 sayfa)
        </button>
        <button onClick={() => downloadFaiZip({ ...record, faiNo })}
          style={{ padding: "8px 16px", fontSize: 13, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
          📦 ZIP İndir
        </button>
        {!readonlyForm && (
          <button onClick={handleSave} disabled={saving || !canEdit}
            style={{ padding: "8px 20px", fontSize: 13, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "wait" : (canEdit ? "pointer" : "not-allowed"), fontWeight: 500 }}>
            {saving ? "Kaydediliyor..." : "💾 Kaydet"}
          </button>
        )}
      </div>

      {/* DRIVE ARAMA SUB-MODAL — F-9A */}
      {driveSearchState && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeDriveSearch(); }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 16, width: "90%", maxWidth: 720, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              🔍 Drive'dan Öner — <span style={{ fontFamily: "ui-monospace, monospace", color: "#1e40af" }}>{record.partNumber}</span>
              <span style={{ marginLeft: 6, padding: "2px 6px", background: "#eff6ff", color: "#1e40af", borderRadius: 3, fontSize: 10, fontWeight: 500 }}>
                {FAI_ATTACHMENT_CATEGORIES.find(c => c.key === driveSearchState.categoryKey)?.label}
              </span>
            </div>
            {driveSearchState.loading && (
              <div style={{ padding: 20, textAlign: "center", color: "#78716c", fontSize: 11 }}>Drive'da aranıyor...</div>
            )}
            {!driveSearchState.loading && driveSearchState.error && (driveSearchState.results || []).length === 0 && (
              <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11, color: "#92400e" }}>
                ⚠ {driveSearchState.error}
              </div>
            )}
            {!driveSearchState.loading && (driveSearchState.results || []).length === 0 && !driveSearchState.error && (
              <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", fontSize: 11 }}>Sonuç bulunamadı</div>
            )}
            {!driveSearchState.loading && (driveSearchState.results || []).length > 0 && (
              <div style={{ flex: 1, overflowY: "auto", border: "1px solid #e7e5e4", borderRadius: 4 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f5f5f4" }}>
                    <tr style={{ textAlign: "left", color: "#44403c" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600, fontSize: 10 }}>Dosya</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, fontSize: 10, width: 120 }}>Klasör</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, fontSize: 10, width: 90, textAlign: "right" }}>Tarih</th>
                      <th style={{ padding: "6px 8px", width: 90 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {driveSearchState.results.map((r, i) => (
                      <tr key={r.id || i} style={{ borderTop: "1px solid #f5f5f4" }}>
                        <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace", fontSize: 10, wordBreak: "break-all" }}>{r.name || r.filename || "—"}</td>
                        <td style={{ padding: "6px 8px", fontSize: 10, color: "#78716c" }}>{r.parentName || r.folder || "—"}</td>
                        <td style={{ padding: "6px 8px", fontSize: 10, color: "#78716c", textAlign: "right" }}>{r.modifiedTime ? String(r.modifiedTime).slice(0, 10) : "—"}</td>
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button onClick={() => importFromDrive(driveSearchState.categoryKey, r.id)}
                            disabled={!canEdit}
                            style={{ padding: "3px 8px", fontSize: 10, background: "#1e40af", color: "#fff", border: "none", borderRadius: 3, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: 500 }}>
                            📥 Aktar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button onClick={closeDriveSearch}
                style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>Kapat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Liste ====================

// FAI paketi ZIP indirme — Faz F-6
async function downloadFaiZip(record) {
  try {
    const zip = new JSZip();
    // 1) FAI PDF kökte
    const pdfBlob = await buildFaiPdfBlob(record);
    const safe = (s) => String(s || "").replace(/[^\w.\-]/g, "_").substring(0, 60);
    zip.file(`FAI_${safe(record.faiNo)}.pdf`, pdfBlob);
    // 2) Ekler kategori bazlı klasörler
    const CAT_LABELS = {
      balloonedDrawing:       "Balonlu Resim",
      materialCertificates:   "Malzeme Sertifikalari",
      testReports:            "Kabul Test Raporlari",
      productionDocs:         "Uretim Dokumanlari",
      nonconformanceDocs:     "Uygunsuzluk Belgeleri",
      customerApprovalLetter: "Musteri Onay Yazisi",
      other:                  "Diger",
    };
    const attach = record.attachments || {};
    const fetchAll = [];
    for (const [key, label] of Object.entries(CAT_LABELS)) {
      const items = Array.isArray(attach[key]) ? attach[key] : (attach[key] ? [attach[key]] : []);
      if (items.length === 0) continue;
      const folder = zip.folder(safe(label));
      const used = new Set();
      for (const meta of items) {
        if (!meta?.path) continue;
        const originalName = meta.name || "dosya.pdf";
        let name = safe(originalName);
        // dedup
        let i = 1;
        while (used.has(name)) {
          const ext = name.includes(".") ? name.substring(name.lastIndexOf(".")) : "";
          const base = name.substring(0, name.length - ext.length);
          name = `${base}_${i++}${ext}`;
        }
        used.add(name);
        fetchAll.push(
          downloadCocAttachmentBlob(meta.path).then(b => folder.file(name, b))
            .catch(e => console.warn(`Ek indirilemedi: ${key}/${name}`, e.message))
        );
      }
    }
    await Promise.all(fetchAll);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const zipName = `FAI_${safe(record.faiNo)}_${safe(record.partNumber || record.partName || "")}.zip`;
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("ZIP hatası: " + e.message);
  }
}

function FaiListView({ canEdit, isAdmin, customerFilter, searchText, onOpen }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ records: {} });
  const [localSearch, setLocalSearch] = useState("");
  const [deleting, setDeleting] = useState({});

  useEffect(() => {
    const unsub = subscribeFaiForYear(year, setData, { staging });
    return unsub;
  }, [year, staging]);

  const records = useMemo(() => {
    const arr = Object.values(data?.records || {});
    // Genel arama (searchText prop) + lokal arama
    const q = (localSearch || searchText || "").trim().toLocaleLowerCase("tr-TR");
    let filtered = arr;
    if (customerFilter && customerFilter !== "all") {
      filtered = filtered.filter(r => {
        if (customerFilter === OTHER_CUSTOMER_CODE) return !isKnownCustomer(r.customerCode);
        return matchCustomer(r.customerCode, customerFilter);
      });
    }
    if (q) filtered = filtered.filter(r =>
      (r.partNumber || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (r.partName || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (r.faiNo || "").includes(q) ||
      (r.customerName || "").toLocaleLowerCase("tr-TR").includes(q)
    );
    return filtered.sort((a, b) => (b.faiNo || "").localeCompare(a.faiNo || ""));
  }, [data, localSearch, searchText, customerFilter]);

  const handleDelete = async (faiNo) => {
    if (!confirm(`FAI ${faiNo} silinsin mi?`)) return;
    setDeleting(d => ({ ...d, [faiNo]: true }));
    try {
      await deleteFaiRecord(faiNo, { canEdit, staging });
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(d => ({ ...d, [faiNo]: false }));
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
        <input value={localSearch} onChange={e => setLocalSearch(e.target.value)}
          placeholder="🔎 FAI no / parça / müşteri" style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }} />
        <span style={{ fontSize: 11, color: "#78716c" }}>{records.length} FAI</span>
      </div>

      {records.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          Bu yılda FAI kaydı yok. "➕ Yeni FAI" ile başla.
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                <th style={{ padding: "8px 10px" }}>FAI No</th>
                <th style={{ padding: "8px 10px" }}>Parça</th>
                <th style={{ padding: "8px 10px" }}>Müşteri</th>
                <th style={{ padding: "8px 10px" }}>Tür</th>
                <th style={{ padding: "8px 10px" }}>Durum</th>
                <th style={{ padding: "8px 10px" }}>İmza</th>
                <th style={{ padding: "8px 10px" }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const status = computeFaiStatus(r);
                const badge = FAI_STATUSES.find(s => s.key === status);
                const sig = countFaiSignatures(r);
                return (
                  <tr key={r.faiNo} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "6px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{r.faiNo}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <div>{r.partName || "—"}</div>
                      {r.partNumber && <div style={{ fontSize: 9, color: "#78716c", fontFamily: "ui-monospace, monospace" }}>{r.partNumber}</div>}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {r.customerName ? (
                        <span style={{ padding: "1px 5px", background: customerBadge(r.customerCode).bg, color: customerBadge(r.customerCode).fg, borderRadius: 2, fontSize: 9, marginRight: 4 }}>
                          {customerBadge(r.customerCode).label}
                        </span>
                      ) : null}
                      {r.customerName || "—"}
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 10, color: "#57534e" }}>
                      {r.faiType === "partial" ? "Kısmi" : "Tam"} · {r.detailOrAssembly === "assembly" ? "Takım" : "Parça"}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ padding: "1px 6px", background: badge?.bg, color: badge?.color, borderRadius: 3, fontSize: 9, fontWeight: 600 }}>{badge?.label}</span>
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 10, color: "#78716c" }}>{sig.signed}/{sig.total}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => onOpen(r, { readOnly: false })}
                          style={{ padding: "3px 8px", fontSize: 10, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 3, cursor: "pointer" }}>✏ Aç</button>
                        <button onClick={async () => { try { await generateFaiPdf(r); } catch (e) { alert("PDF hatası: " + e.message); } }}
                          title="FAI PDF indir (3 sayfa)"
                          style={{ padding: "3px 8px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>📄 PDF</button>
                        <button onClick={() => downloadFaiZip(r)}
                          title="FAI paketi (PDF + ekler) ZIP indir"
                          style={{ padding: "3px 8px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: "pointer" }}>📦 ZIP</button>
                        {isAdmin && status !== "customerApproved" && (
                          <button onClick={() => handleDelete(r.faiNo)} disabled={!!deleting[r.faiNo]}
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
