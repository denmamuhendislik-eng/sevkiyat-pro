// FAI (First Article Inspection) — ana görünüm.
// Diğer Müşteriler modülü altında "🔬 FAİ Belgeleri" sekmesinden açılır.
// 2 alt sekme: 📋 Liste · ➕ Yeni FAI

import React, { useState, useEffect, useMemo } from "react";
import {
  subscribeFaiForYear, suggestNextFaiNo, saveFaiRecord,
  updateFaiStatus, signFaiRole, unsignFaiRole, deleteFaiRecord,
  uploadFaiAttachment, deleteFaiAttachment,
  computeFaiStatus, countFaiSignatures,
  subscribeFaiArchive, saveFaiArchiveRecords, deleteFaiArchiveRecord,
  archiveKey, parseFaiArchiveFolderName,
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
import { searchCocDrive, importCocDriveFile, listFaiArchiveFolders } from "../driveClient";
import { parseMeasurementReport, characteristicToFaiRow } from "./measurementReportParser";
import JSZip from "jszip";

export default function FaiView({ canEdit, isAdmin, customerFilter, searchText, cocParts, bomModels, pendingCreate, onPendingCreateConsumed }) {
  const [subTab, setSubTab] = useState("list");
  const [pendingOpen, setPendingOpen] = useState(null); // { record, readOnly }
  const [deltaSource, setDeltaSource] = useState(null); // Delta FAI oluşturma modalı için kaynak FAI
  const openRecord = (record, { readOnly = false } = {}) => {
    setPendingOpen({ record, readOnly });
    setSubTab("new");
  };

  // Dışarıdan (örn. COC listesinden "➕ FAI Oluştur" butonu) tetiklenen ön-doldurma.
  // Yeni FAI formu açılır, parça no + müşteri bilgisi hazırdır.
  useEffect(() => {
    if (!pendingCreate) return;
    const seed = {
      ...makeEmptyFai(""),
      stockCode: pendingCreate.stockCode || "",
      partNumber: pendingCreate.stockCode || pendingCreate.partNumber || "",
      partName: pendingCreate.partName || "",
      customerCode: pendingCreate.customerCode || "",
      customerName: pendingCreate.customerName || "",
    };
    openRecord(seed, { readOnly: false });
    onPendingCreateConsumed && onPendingCreateConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCreate]);

  // Delta (Partial/Kısmi) FAI oluştur — AS9102: proses/tezgah değişiminde
  // aynı parça için yeni FAI, önceki FAI no'ya referans ile
  const confirmDelta = async ({ source, reason, copyForm1, copyForm2, copyForm3 }) => {
    try {
      const newFaiNo = await suggestNextFaiNo(new Date(), { staging: false });
      const base = makeEmptyFai(newFaiNo);
      const newRecord = { ...base, faiNo: newFaiNo };
      if (copyForm1) {
        // Form 1 alanları — parça bilgisi, çizim, organizasyon
        Object.assign(newRecord, {
          partNumber: source.partNumber || "",
          partName: source.partName || "",
          partRevision: source.partRevision || "",
          drawingNumber: source.drawingNumber || "",
          drawingRevision: source.drawingRevision || "",
          organizationName: source.organizationName || newRecord.organizationName,
          supplierCode: source.supplierCode || "",
          customerPoNumber: source.customerPoNumber || "",
          detailOrAssembly: source.detailOrAssembly || "detail",
          subComponents: Array.isArray(source.subComponents) ? source.subComponents.map(s => ({ ...s })) : [],
          customerCode: source.customerCode || "",
          customerName: source.customerName || "",
          stockCode: source.stockCode || "",
          linkedFeasibilityNo: source.linkedFeasibilityNo || null,
        });
      }
      if (copyForm2) {
        newRecord.materialsAndProcesses = Array.isArray(source.materialsAndProcesses)
          ? source.materialsAndProcesses.map(m => ({ ...m })) : [];
        newRecord.functionalTests = Array.isArray(source.functionalTests)
          ? source.functionalTests.map(t => ({ ...t })) : [];
      }
      if (copyForm3) {
        // Karakteristik referansları kopyala — actual/deviation/result BOŞ (yeniden ölçülecek)
        newRecord.characteristics = (source.characteristics || []).map(c => ({
          ...c,
          actual: "",
          deviation: "",
          resultStatus: "",
          // results string'ini de temizle
          results: "",
        }));
      }
      // Partial FAI işaretleri
      newRecord.faiType = "partial";
      newRecord.previousFairNumber = source.faiNo;
      newRecord.partialFaiReason = reason || "";
      newRecord.additionalChanges = source.additionalChanges || "";
      // Meta
      newRecord.source = "delta";
      setDeltaSource(null);
      openRecord(newRecord, { readOnly: false });
    } catch (e) {
      alert("Delta FAI oluşturma hatası: " + (e.message || e));
    }
  };

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
        onOpen={openRecord}
        onCreateDelta={(r) => setDeltaSource(r)} />}
      {subTab === "new" && <NewFaiView canEdit={canEdit} isAdmin={isAdmin}
        cocParts={cocParts} bomModels={bomModels}
        initialRecord={pendingOpen?.record || null}
        readOnly={!!pendingOpen?.readOnly}
        onSaved={() => { setPendingOpen(null); setSubTab("list"); }}
        onCreateDelta={(r) => setDeltaSource(r)} />}

      {/* Delta FAI oluşturma modalı — AS9102 Partial FAI */}
      {deltaSource && (
        <DeltaFaiModal source={deltaSource} onCancel={() => setDeltaSource(null)} onConfirm={confirmDelta} />
      )}
    </div>
  );
}

// Delta FAI modalı — kullanıcı kaynak FAI'den yeni Partial FAI oluşturur.
// AS9102 Field 14: "partial" işaretli, previousFairNumber + partialFaiReason zorunlu.
function DeltaFaiModal({ source, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const [copyForm1, setCopyForm1] = useState(true);
  const [copyForm2, setCopyForm2] = useState(true);
  const [copyForm3, setCopyForm3] = useState(true);
  const [creating, setCreating] = useState(false);
  const handleConfirm = async () => {
    if (!reason.trim()) { alert("Değişiklik gerekçesi zorunlu (örn. 'Yeni tezgah: X · CAM güncellendi')"); return; }
    setCreating(true);
    try {
      await onConfirm({ source, reason: reason.trim(), copyForm1, copyForm2, copyForm3 });
    } finally {
      setCreating(false);
    }
  };
  return (
    <div onClick={e => { if (e.target === e.currentTarget && !creating) onCancel(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 8, width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Δ Delta (Kısmi/Partial) FAI Oluştur</div>
            <div style={{ fontSize: 10, color: "#78716c", marginTop: 2 }}>Proses/tezgah/malzeme değişikliği için AS9102 Partial FAI</div>
          </div>
          <button onClick={onCancel} disabled={creating} style={{ background: "transparent", border: "none", fontSize: 20, cursor: creating ? "not-allowed" : "pointer", color: "#78716c" }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ padding: 10, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 4, marginBottom: 14, fontSize: 11 }}>
            <div><b>Kaynak FAI:</b> <span style={{ fontFamily: "ui-monospace, monospace" }}>{source.faiNo}</span></div>
            <div><b>Parça:</b> {source.partName || "—"} {source.partNumber && <span style={{ fontFamily: "ui-monospace, monospace", color: "#78716c" }}>({source.partNumber})</span>}</div>
            <div><b>Müşteri:</b> {source.customerName || "—"}</div>
            <div style={{ marginTop: 4, color: "#0369a1", fontSize: 10 }}>Yeni FAI otomatik olarak bugünkü tarih üzerinden numaralanır ve bu FAI'ye referans verir.</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Değişiklik Gerekçesi *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="örn. Yeni tezgah: DMG MORI NLX2500 · CAM güncellendi · Yeni tooling"
              rows={3}
              style={{ width: "100%", padding: 8, fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 4, boxSizing: "border-box", fontFamily: "inherit" }} />
            <div style={{ fontSize: 10, color: "#78716c", marginTop: 3 }}>Bu metin yeni FAI'nin Form 1 Field 14 altında "Kısmi FAI Gerekçesi" olarak PDF'e basılır.</div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Kaynaktan kopyalanacaklar:</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0" }}>
              <input type="checkbox" checked={copyForm1} onChange={e => setCopyForm1(e.target.checked)} />
              <div>
                <div>📝 Form 1 · Parça bilgisi</div>
                <div style={{ fontSize: 10, color: "#78716c" }}>Parça no, isim, çizim no/rev, müşteri, alt bileşenler</div>
              </div>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0" }}>
              <input type="checkbox" checked={copyForm2} onChange={e => setCopyForm2(e.target.checked)} />
              <div>
                <div>🧪 Form 2 · Malzeme & Süreç</div>
                <div style={{ fontSize: 10, color: "#78716c" }}>Malzeme sertifikaları, özel süreçler, fonksiyonel testler</div>
              </div>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0" }}>
              <input type="checkbox" checked={copyForm3} onChange={e => setCopyForm3(e.target.checked)} />
              <div>
                <div>📏 Form 3 · Karakteristik referansları</div>
                <div style={{ fontSize: 10, color: "#78716c" }}>Numara + eleman + nominal + tolerans kopyalanır, <b>ölçüm değerleri boş kalır</b> (yeni tezgahta ölçüm yapılacak)</div>
              </div>
            </label>
            <div style={{ fontSize: 10, color: "#a8a29e", marginTop: 6 }}>
              Not: Ek belgeler (balonlu resim, sertifika PDF'leri) yeniden yüklenir — otomatik kopyalanmaz.
            </div>
          </div>
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid #e7e5e4", display: "flex", gap: 8, justifyContent: "flex-end", background: "#fafaf9" }}>
          <button onClick={onCancel} disabled={creating}
            style={{ padding: "7px 16px", fontSize: 12, background: "#fff", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: creating ? "not-allowed" : "pointer" }}>
            İptal
          </button>
          <button onClick={handleConfirm} disabled={creating || !reason.trim()}
            style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600, background: reason.trim() ? "#1e40af" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: creating || !reason.trim() ? "not-allowed" : "pointer" }}>
            {creating ? "Oluşturuluyor..." : "Δ Delta FAI Oluştur"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Yeni FAI Form ====================

function NewFaiView({ canEdit, isAdmin, cocParts, bomModels, initialRecord, readOnly, onSaved, onCreateDelta }) {
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
  const [archiveData, setArchiveData] = useState({ records: {} });
  useEffect(() => {
    const u1 = subscribeQuoteCustomers(d => setCustomersData(d || { customers: {} }), { staging });
    const u2 = subscribeQuoteParts(d => setQuotePartsLib(d || { parts: {} }), { staging });
    const u3 = subscribeFaiArchive(d => setArchiveData(d || { records: {} }), { staging });
    return () => { u1(); u2(); u3(); };
  }, [staging]);
  const customerList = useMemo(() => Object.values(customersData?.customers || {}), [customersData]);

  // F-9C: Bu parça no için arşivde FAI var mı?
  const archiveMatches = useMemo(() => {
    if (!record.partNumber) return [];
    const arr = Object.values(archiveData?.records || {});
    return arr.filter(a => (a.stockCode || a.partNumber) === record.partNumber);
  }, [record.partNumber, archiveData]);

  useEffect(() => {
    if (initialRecord) {
      // Backward-compat: eski attachments key'lerini yeni yapıya taşı.
      // balloonedDrawing (single) + testReports (array) → measurementAndDrawing (array)
      const src = initialRecord.attachments || {};
      const migrated = { ...src };
      const measurementAndDrawing = Array.isArray(src.measurementAndDrawing) ? [...src.measurementAndDrawing] : [];
      if (Array.isArray(src.testReports) && src.testReports.length > 0) {
        measurementAndDrawing.push(...src.testReports);
        delete migrated.testReports;
      }
      if (src.balloonedDrawing) {
        measurementAndDrawing.push(src.balloonedDrawing);
        delete migrated.balloonedDrawing;
      }
      if (measurementAndDrawing.length > 0) migrated.measurementAndDrawing = measurementAndDrawing;
      const merged = { ...makeEmptyFai(initialRecord.faiNo || ""), ...initialRecord, attachments: migrated };
      setRecord(merged);
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

  // CMM Ölçüm Raporu (FR-92.1 PDF) import — Form 3 karakteristikleri otomatik doldurur
  const [importState, setImportState] = useState(null); // { header, characteristics, fileName } | { error } | null
  const [importParsing, setImportParsing] = useState(false);
  const importReport = async (file) => {
    setImportParsing(true);
    try {
      const parsed = await parseMeasurementReport(file);
      setImportState({ ...parsed, fileName: file.name });
    } catch (e) {
      setImportState({ error: e.message || "Parse hatası" });
    } finally {
      setImportParsing(false);
    }
  };
  const applyImport = ({ replace }) => {
    if (!importState || !importState.characteristics) return;
    const newRows = importState.characteristics.map(characteristicToFaiRow);
    setRecord(prev => ({
      ...prev,
      characteristics: replace ? newRows : [...(prev.characteristics || []), ...newRows],
    }));
    setImportState(null);
  };

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

  // Attachment kartı — ilgili form'a ait kategorileri render eder.
  // Form üstünde yüklenen belgeye tıklayıp önce açıp bakıp sonra formu doldurabilesin diye
  // ekler ilgili form sekmesi altına yerleşiyor.
  const renderAttachmentsForForm = (formNo) => {
    const cats = FAI_ATTACHMENT_CATEGORIES.filter(c => c.form === formNo);
    if (cats.length === 0) return null;
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📎 Bu Bölüm için Ek Belgeler</div>
        <div style={{ fontSize: 10, color: "#78716c", marginBottom: 10 }}>
          Belgeleri şimdi yükleyip açarak formu doldurabilirsin. FAI paketinin (ZIP) içine dahil edilir.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
          {cats.map(cat => {
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
    );
  };

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

      {/* Delta (Partial/Kısmi) FAI banner */}
      {record.faiType === "partial" && record.previousFairNumber && (
        <div style={{ marginBottom: 12, padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11, color: "#92400e" }}>
          Δ <b>Kısmi (Delta) FAI</b> · Kaynak: <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>#{record.previousFairNumber}</span>
          {record.partialFaiReason && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#78350f" }}>
              <b>Gerekçe:</b> {record.partialFaiReason}
            </div>
          )}
          <div style={{ fontSize: 10, color: "#78350f", marginTop: 4 }}>
            AS9102: Sadece değişiklikten etkilenen karakteristikler yeniden ölçülür. Etkilenmeyen kalemler önceki FAI'ye referanslıdır.
          </div>
        </div>
      )}

      {/* Mevcut kayıtlı FAI için "Δ Delta oluştur" hızlı erişim */}
      {faiNo && initialRecord && canEdit && onCreateDelta && record.faiType !== "partial" && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#475569" }}>
            Bu parça için proses/tezgah değişikliği mi var? Bu FAI'yi baz alarak yeni <b>Kısmi FAI</b> oluşturabilirsin.
          </span>
          <button onClick={() => onCreateDelta(record)}
            style={{ padding: "5px 12px", fontSize: 11, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
            Δ Delta FAI Oluştur
          </button>
        </div>
      )}

      {/* F-9C: Bu parça için arşivde FAI varsa uyar */}
      {archiveMatches.length > 0 && (
        <div style={{ marginBottom: 12, padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11, color: "#92400e" }}>
          <div style={{ marginBottom: 6 }}>
            ⚠ <b>Bu parça için arşivde {archiveMatches.length} FAI var:</b>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {archiveMatches.slice(0, 5).map((a, i) => {
              const driveLinks = (a.attachments?.other || []).filter(x => x?.isDriveLink);
              const isCurrentRef = record.faiType === "partial" && record.previousFairNumber === `FAİ-${a.faiNo}`;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {driveLinks.length > 0 ? driveLinks.map((x, j) => (
                    <a key={j} href={x.driveUrl} target="_blank" rel="noreferrer"
                      style={{ padding: "1px 6px", background: "#fff", color: "#92400e", border: "1px solid #fde68a", borderRadius: 2, fontSize: 10, fontWeight: 600, textDecoration: "none" }}>
                      📂 FAİ-{a.faiNo}
                    </a>
                  )) : (
                    <span style={{ padding: "1px 6px", background: "#fff", color: "#92400e", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>
                      FAİ-{a.faiNo}
                    </span>
                  )}
                  {!readonlyForm && (
                    isCurrentRef ? (
                      <span title="Bu FAI'nin kısmisi olarak işaretli"
                        style={{ padding: "1px 6px", background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>
                        ✓ Kısmi işaretlendi
                      </span>
                    ) : (
                      <button onClick={() => {
                        update("faiType", "partial");
                        update("previousFairNumber", `FAİ-${a.faiNo}`);
                      }}
                        title="Bu FAI'yi 'önceki FAI' olarak referans al — mevcut form Kısmi (Delta) FAI olarak işaretlenir. Gerekçeyi Form 1 içinde doldurun."
                        style={{ padding: "1px 8px", background: "#fff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 2, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                        🔗 Bunun Kısmisi
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
          {archiveMatches.length > 5 && <div style={{ fontSize: 10, color: "#78350f", marginTop: 4 }}>+{archiveMatches.length - 5} daha</div>}
          <div style={{ fontSize: 10, color: "#78350f", marginTop: 6 }}>
            Aynı parça için tam FAI zaten var → yeni tezgah/proses değişimi için <b>"🔗 Bunun Kısmisi"</b> ile bağlantı kurabilirsin, yoksa boş bırak (bağımsız Full FAI).
          </div>
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
          {renderAttachmentsForForm(1)}
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
          {renderAttachmentsForForm(2)}
        </>
      )}

      {/* FORM 3 — F-3'te detaylandırılacak, şimdilik basit */}
      {activeForm === 3 && (
        <>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>📏 Karakteristik Ölçümler</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <label style={{ padding: "4px 10px", fontSize: 11, background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 3, cursor: readonlyForm || importParsing ? "not-allowed" : "pointer", opacity: readonlyForm || importParsing ? 0.5 : 1 }}
                  title="Denma FR-92.1 CMM ölçüm raporu PDF'i yükle — karakteristikler otomatik doldurulur">
                  {importParsing ? "⏳ Okunuyor..." : "📥 CMM Raporundan Aktar"}
                  <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={readonlyForm || importParsing}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) importReport(f);
                      e.target.value = "";
                    }} />
                </label>
                <button onClick={addCharacteristic} disabled={readonlyForm} style={{ padding: "4px 10px", fontSize: 11, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: readonlyForm ? "not-allowed" : "pointer" }}>+ Karakteristik</button>
              </div>
            </div>
            <div style={{ fontSize: 10, color: "#78716c", marginBottom: 8 }}>
              Çizimdeki her balonlu ölçüm için satır ekleyin. Balonlu resim ekiyle birlikte kullanılır.
              CMM ölçüm raporu (FR-92.1 PDF) yükleyerek otomatik doldurulabilir.
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

          {/* CMM Raporu Import Önizleme Modal */}
          {importState && (
            <div onClick={e => { if (e.target === e.currentTarget) setImportState(null); }}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div style={{ background: "#fff", borderRadius: 8, width: "min(1100px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>📥 CMM Raporu Önizleme</div>
                    <div style={{ fontSize: 10, color: "#78716c", marginTop: 2 }}>{importState.fileName || ""}</div>
                  </div>
                  <button onClick={() => setImportState(null)} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "#78716c" }}>✕</button>
                </div>
                {importState.error ? (
                  <div style={{ padding: 20, color: "#991b1b", fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Parse Hatası</div>
                    <div>{importState.error}</div>
                    <div style={{ marginTop: 12, fontSize: 11, color: "#78716c" }}>
                      Yalnızca Denma FR-92.1 formatında hazırlanmış, metin katmanlı CMM ölçüm raporu PDF'leri destekleniyor.
                      Taranmış PDF veya farklı şablon çalışmayabilir.
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "12px 18px", background: "#f8fafc", borderBottom: "1px solid #e7e5e4", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 11 }}>
                      {importState.header?.partCode && (
                        <div><b>Parça Kodu:</b> {importState.header.partCode}
                          {record.partNumber && importState.header.partCode !== record.partNumber && (
                            <div style={{ color: "#dc2626", fontSize: 10, marginTop: 2 }}>⚠ FAI parça kodu ile uyumsuz ({record.partNumber})</div>
                          )}
                        </div>
                      )}
                      {importState.header?.cmmDevice && <div><b>CMM:</b> {importState.header.cmmDevice}</div>}
                      {importState.header?.operationName && <div><b>Operasyon:</b> {importState.header.operationName}</div>}
                      {importState.header?.date && <div><b>Tarih:</b> {importState.header.date}</div>}
                      {importState.header?.workOrderNo && <div><b>İş Emri:</b> {importState.header.workOrderNo}</div>}
                      {importState.header?.preparedBy && <div><b>Hazırlayan:</b> {importState.header.preparedBy}</div>}
                    </div>
                    <div style={{ padding: 12, overflow: "auto", flex: 1, minHeight: 0 }}>
                      <div style={{ fontSize: 12, marginBottom: 8, color: "#166534", fontWeight: 500 }}>
                        ✓ {importState.characteristics.length} karakteristik bulundu · {importState.characteristics.filter(c => c.resultStatus === "NOK").length} NOK
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                        <thead>
                          <tr style={{ background: "#f5f5f4", textAlign: "left" }}>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "center", width: 30 }}>#</th>
                            <th style={{ padding: 4, fontWeight: 600 }}>Eleman</th>
                            <th style={{ padding: 4, fontWeight: 600 }}>Datum</th>
                            <th style={{ padding: 4, fontWeight: 600 }}>Tür</th>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "right" }}>Nominal</th>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "right" }}>Ölçülen</th>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "right" }}>+Tol</th>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "right" }}>-Tol</th>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "right" }}>Sapma</th>
                            <th style={{ padding: 4, fontWeight: 600, textAlign: "center", width: 40 }}>Sonuç</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importState.characteristics.map(c => {
                            const bad = c.resultStatus === "NOK";
                            return (
                              <tr key={c.no} style={{ borderTop: "1px solid #f5f5f4", background: bad ? "#fef2f2" : "transparent", color: bad ? "#991b1b" : "inherit" }}>
                                <td style={{ padding: 4, textAlign: "center", fontWeight: 500 }}>{c.no}</td>
                                <td style={{ padding: 4 }}>{c.elementName}</td>
                                <td style={{ padding: 4 }}>{c.datum}</td>
                                <td style={{ padding: 4 }}>{c.toleranceName}</td>
                                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.nominal}</td>
                                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{c.actual}</td>
                                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.tolPlus}</td>
                                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.tolMinus}</td>
                                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.deviation}</td>
                                <td style={{ padding: 4, textAlign: "center", fontWeight: 600 }}>{c.resultStatus}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ padding: "12px 18px", borderTop: "1px solid #e7e5e4", display: "flex", gap: 8, justifyContent: "flex-end", background: "#fafaf9" }}>
                      <button onClick={() => setImportState(null)}
                        style={{ padding: "6px 14px", fontSize: 12, background: "#fff", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>
                        İptal
                      </button>
                      {(record.characteristics || []).length > 0 && (
                        <button onClick={() => applyImport({ replace: false })}
                          style={{ padding: "6px 14px", fontSize: 12, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer" }}>
                          Mevcutlara Ekle
                        </button>
                      )}
                      <button onClick={() => applyImport({ replace: true })}
                        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                        {(record.characteristics || []).length > 0 ? "Değiştir (Mevcutları Sil)" : "Aktar"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div style={cardStyle}>
            <label style={labelStyle}>Yorumlar</label>
            <textarea value={record.form3Comments || ""} onChange={e => update("form3Comments", e.target.value)} disabled={readonlyForm} rows={3} style={inputStyle} />
          </div>

          {renderAttachmentsForForm(3)}
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
      // Form 1
      productionDocs:         "Form1_Uretim_Is_Emri",
      // Form 2
      materialCertificates:   "Form2_HM_Uygunluk_Sertifikasi",
      fasonCertificates:      "Form2_Fason_Uygunluk_Sertifikasi",
      // Form 3
      measurementAndDrawing:  "Form3_Olcum_Raporu_ve_Balonlu_Resim",
      nonconformanceDocs:     "Form3_Uygunsuzluk_Belgeleri",
      customerApprovalLetter: "Musteri_Onay_Yazisi",
      other:                  "Diger",
      // Eski keyler backward-compat (arşiv/geriye dönük FAI'ler için)
      balloonedDrawing:       "Form3_Olcum_Raporu_ve_Balonlu_Resim",
      testReports:            "Form3_Olcum_Raporu_ve_Balonlu_Resim",
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

function FaiListView({ canEdit, isAdmin, customerFilter, searchText, onOpen, onCreateDelta }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ records: {} });
  const [archiveData, setArchiveData] = useState({ records: {} });
  const [showArchive, setShowArchive] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [deleting, setDeleting] = useState({});
  const [archiveImportOpen, setArchiveImportOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeFaiForYear(year, setData, { staging });
    return unsub;
  }, [year, staging]);
  useEffect(() => {
    const unsub = subscribeFaiArchive(setArchiveData, { staging });
    return unsub;
  }, [staging]);

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

  // Delta zincirleri — her FAI için "beni referans alan partial FAI sayısı"
  const deltaCountByFaiNo = useMemo(() => {
    const map = {};
    for (const r of Object.values(data?.records || {})) {
      const prev = r.previousFairNumber;
      if (r.faiType === "partial" && prev) map[prev] = (map[prev] || 0) + 1;
    }
    return map;
  }, [data]);

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

  // Arşiv verilerini de listele — showArchive true ise arşiv, false ise sadece bu yıl
  const archiveRecords = useMemo(() => {
    const arr = Object.values(archiveData?.records || {});
    const q = (localSearch || searchText || "").trim().toLocaleLowerCase("tr-TR");
    let f = arr;
    if (q) f = f.filter(r =>
      (r.partNumber || "").toLocaleLowerCase("tr-TR").includes(q) ||
      (r.faiNo || "").toLocaleLowerCase("tr-TR").includes(q)
    );
    return f.sort((a, b) => Number(b.faiNo || 0) - Number(a.faiNo || 0));
  }, [archiveData, localSearch, searchText]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#57534e" }}>Yıl:</label>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}>
          {["2024", "2025", "2026"].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={showArchive} onChange={e => setShowArchive(e.target.checked)} />
          🗄 Arşiv Göster ({Object.keys(archiveData?.records || {}).length})
        </label>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging
        </label>
        <input value={localSearch} onChange={e => setLocalSearch(e.target.value)}
          placeholder="🔎 FAI no / parça / müşteri" style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }} />
        <span style={{ fontSize: 11, color: "#78716c" }}>{records.length} güncel · {archiveRecords.length} arşiv</span>
        {isAdmin && (
          <button onClick={() => setArchiveImportOpen(true)}
            style={{ padding: "6px 12px", fontSize: 11, background: "#166534", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}>
            📥 Drive Arşiv İçe Aktar
          </button>
        )}
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
                      {r.faiType === "partial" ? (
                        <span title={r.partialFaiReason || ""}
                          style={{ display: "inline-block", padding: "1px 5px", background: "#fef3c7", color: "#92400e", borderRadius: 3, fontWeight: 600, marginRight: 4 }}>
                          Δ Kısmi
                        </span>
                      ) : (
                        <span style={{ display: "inline-block", padding: "1px 5px", background: "#dbeafe", color: "#1e40af", borderRadius: 3, fontWeight: 600, marginRight: 4 }}>
                          ● Tam
                        </span>
                      )}
                      {r.detailOrAssembly === "assembly" ? "Takım" : "Parça"}
                      {r.previousFairNumber && (
                        <div style={{ fontSize: 9, color: "#78716c", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                          ← #{r.previousFairNumber}
                        </div>
                      )}
                      {deltaCountByFaiNo[r.faiNo] > 0 && (
                        <div style={{ fontSize: 9, color: "#92400e", marginTop: 2, fontWeight: 500 }}>
                          Δ {deltaCountByFaiNo[r.faiNo]} kısmi FAI
                        </div>
                      )}
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
                        {canEdit && onCreateDelta && (
                          <button onClick={() => onCreateDelta(r)}
                            title="Bu FAI'den yeni Kısmi (Delta) FAI oluştur — proses/tezgah değişimi için"
                            style={{ padding: "3px 8px", fontSize: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 3, cursor: "pointer", fontWeight: 500 }}>
                            Δ Delta
                          </button>
                        )}
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

      {/* ARŞİV LİSTESİ (F-9B) — showArchive true ise */}
      {showArchive && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#166534" }}>
            🗄 Arşiv — Drive'dan İçe Aktarılmış Eski FAI Kayıtları ({archiveRecords.length})
          </div>
          {archiveRecords.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6, fontSize: 11 }}>
              Arşivde kayıt yok. Admin "📥 Drive Arşiv İçe Aktar" ile içeri alabilir.
            </div>
          ) : (
            <div style={{ border: "1px solid #86efac", borderRadius: 6, overflow: "hidden", background: "#f0fdf4" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#dcfce7", fontSize: 10, color: "#166534", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px" }}>FAI No</th>
                    <th style={{ padding: "8px 10px" }}>Stok Kodu</th>
                    <th style={{ padding: "8px 10px" }}>İçe Aktarıldı</th>
                    <th style={{ padding: "8px 10px" }}>Drive</th>
                    <th style={{ padding: "8px 10px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {archiveRecords.map(r => (
                    <tr key={r.archiveKey || archiveKey(r.stockCode || r.partNumber, r.faiNo)} style={{ borderTop: "1px solid #86efac" }}>
                      <td style={{ padding: "6px 10px", fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "#166534" }}>FAİ-{r.faiNo}</td>
                      <td style={{ padding: "6px 10px", fontFamily: "ui-monospace, monospace" }}>{r.stockCode || r.partNumber}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10, color: "#57534e" }}>{r.importedAt ? String(r.importedAt).slice(0, 10) : "—"}</td>
                      <td style={{ padding: "6px 10px" }}>
                        {(r.attachments?.other || []).filter(a => a?.isDriveLink).map((a, i) => (
                          <a key={i} href={a.driveUrl} target="_blank" rel="noreferrer"
                            style={{ display: "inline-block", padding: "1px 6px", marginRight: 4, background: "#eff6ff", color: "#1e40af", borderRadius: 3, fontSize: 9, textDecoration: "none" }}>
                            📂 {a.name || "Klasör"}
                          </a>
                        ))}
                      </td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        {isAdmin && (
                          <button onClick={async () => {
                            const k = r.archiveKey || archiveKey(r.stockCode || r.partNumber, r.faiNo);
                            if (!confirm(`FAİ-${r.faiNo} arşiv kaydı silinsin mi?`)) return;
                            try { await deleteFaiArchiveRecord(k, { canEdit, staging }); }
                            catch (e) { alert(e.message); }
                          }}
                            style={{ padding: "3px 8px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }}>🗑</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ARŞİV İMPORT MODAL (F-9B) */}
      {archiveImportOpen && (
        <ArchiveImportModal
          onClose={() => setArchiveImportOpen(false)}
          canEdit={canEdit}
          staging={staging}
          existingKeys={new Set(Object.keys(archiveData?.records || {}))}
        />
      )}
    </div>
  );
}

// ==================== Arşiv İmport Modalı (F-9B) ====================

function ArchiveImportModal({ onClose, canEdit, staging, existingKeys }) {
  const [inputValue, setInputValue] = useState("https://drive.google.com/drive/folders/1Cdateqg41bBLcM8snJTbCwwzTcbk0FfA");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [folders, setFolders] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Drive URL veya ID'den folder ID'yi çıkar
  const extractFolderId = (input) => {
    if (!input) return "";
    const s = input.trim();
    // URL formatı: https://drive.google.com/drive/folders/{ID}?usp=... veya .../folders/{ID}/...
    const urlMatch = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    // URL parametresi olabilir
    const queryMatch = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (queryMatch) return queryMatch[1];
    // Sadece ID
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return "";
  };

  const handleList = async () => {
    const folderId = extractFolderId(inputValue);
    if (!folderId) { setError("Drive klasör URL'si veya ID'si gir (örn: https://drive.google.com/drive/folders/1AbC...)"); return; }
    setLoading(true); setError(""); setFolders(null);
    try {
      const res = await listFaiArchiveFolders({ rootFolderId: folderId, limit: 500 });
      setFolders(res?.folders || []);
    } catch (e) {
      // Cloud Function hatalarını daha açıklayıcı hale getir
      const msg = e.message || "Drive listeleme hatası";
      let hint = "";
      if (msg.toLowerCase().includes("internal")) {
        hint = "\n\n💡 Muhtemel nedenler:\n• Service Account'un klasöre erişimi yok — Drive'da klasörü coc-drive-reader@sevkiyat-pro.iam.gserviceaccount.com adresine paylaşın\n• Cloud Function henüz redeploy edilmedi\n• Klasör ID yanlış";
      } else if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("permission")) {
        hint = "\n\n💡 Service Account'un bu klasöre erişimi yok — Drive'da klasörü paylaşın (Görüntüleyen yetkisi):\ncoc-drive-reader@sevkiyat-pro.iam.gserviceaccount.com";
      }
      setError(msg + hint);
    } finally {
      setLoading(false);
    }
  };

  const parsedFolders = useMemo(() => {
    if (!folders) return [];
    return folders.map(f => {
      const parsed = parseFaiArchiveFolderName(f.name);
      return { ...f, parsed };
    });
  }, [folders]);

  const validFolders = parsedFolders.filter(f => f.parsed);
  const invalidFolders = parsedFolders.filter(f => !f.parsed);

  const toggle = (id) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectAll = () => setSelected(new Set(validFolders.map(f => f.id)));
  const clearSelection = () => setSelected(new Set());

  const handleImport = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const records = [];
      for (const f of validFolders) {
        if (!selected.has(f.id)) continue;
        records.push({
          faiNo: f.parsed.faiNo,
          stockCode: f.parsed.stokKodu,
          partNumber: f.parsed.stokKodu,
          partName: "",
          status: "customerApproved",
          source: "drive-archive",
          attachments: {
            other: [{
              name: f.name,
              driveUrl: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
              driveId: f.id,
              modifiedTime: f.modifiedTime,
              isDriveLink: true,
              uploadedAt: new Date().toISOString(),
            }],
          },
        });
      }
      const out = await saveFaiArchiveRecords(records, { canEdit, staging });
      alert(`✓ ${out.count} arşiv kaydı içe aktarıldı`);
      onClose();
    } catch (e) {
      alert("İçe aktarma hatası: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 16, width: "90%", maxWidth: 900, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>📥 Drive Arşiv İçe Aktar</div>
        <div style={{ fontSize: 10, color: "#78716c", marginBottom: 6 }}>
          Drive'daki FAİ KAYITLARI klasörünün <b>URL'sini yapıştır</b> (veya ID'sini gir). Alt klasörler listelenir, seçtiklerin FAI arşivine eklenir. Dosyalar Drive'da kalır — Sevkiyat Pro sadece link tutar.
        </div>
        <div style={{ fontSize: 10, color: "#1e40af", marginBottom: 10, padding: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 3 }}>
          💡 <b>Nasıl bulunur:</b> Drive'da klasörü aç → Adres çubuğundan URL'yi kopyala → aşağıya yapıştır. Örn: <code>https://drive.google.com/drive/folders/1AbC...</code>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={inputValue} onChange={e => setInputValue(e.target.value)}
            placeholder="Drive URL veya klasör ID"
            style={{ flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid #d6d3d1", borderRadius: 4, fontFamily: "ui-monospace, monospace" }} />
          <button onClick={handleList} disabled={loading}
            style={{ padding: "6px 14px", fontSize: 12, background: "#1e40af", color: "#fff", border: "none", borderRadius: 4, cursor: loading ? "wait" : "pointer", fontWeight: 500 }}>
            {loading ? "Aranıyor..." : "🔍 Listele"}
          </button>
        </div>
        {inputValue && extractFolderId(inputValue) && (
          <div style={{ fontSize: 9, color: "#78716c", marginBottom: 8, marginTop: -4 }}>
            ID: <span style={{ fontFamily: "ui-monospace, monospace" }}>{extractFolderId(inputValue)}</span>
          </div>
        )}
        {error && (
          <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11, color: "#991b1b", marginBottom: 10, whiteSpace: "pre-wrap" }}>⚠ {error}</div>
        )}
        {folders && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 11 }}>
              <span>{folders.length} klasör bulundu · {validFolders.length} geçerli · {invalidFolders.length} format uyumsuz</span>
              <button onClick={selectAll} disabled={validFolders.length === 0}
                style={{ marginLeft: "auto", padding: "3px 8px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>
                ✓ Tümünü Seç ({validFolders.length})
              </button>
              {selected.size > 0 && (
                <button onClick={clearSelection}
                  style={{ padding: "3px 8px", fontSize: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }}>
                  ✕ Seçimi Temizle
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid #e7e5e4", borderRadius: 4, marginBottom: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#f5f5f4" }}>
                  <tr style={{ textAlign: "left", color: "#44403c" }}>
                    <th style={{ padding: "5px 6px", width: 30 }}></th>
                    <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10 }}>Klasör Adı</th>
                    <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10 }}>Stok Kodu</th>
                    <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 80 }}>FAI No</th>
                    <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 100 }}>Tarih</th>
                    <th style={{ padding: "5px 6px", fontWeight: 600, fontSize: 10, width: 100 }}>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {validFolders.map(f => {
                    const key = archiveKey(f.parsed.stokKodu, f.parsed.faiNo);
                    const exists = existingKeys.has(key);
                    const isSel = selected.has(f.id);
                    return (
                      <tr key={f.id}
                        onClick={() => toggle(f.id)}
                        style={{ borderTop: "1px solid #f5f5f4", cursor: "pointer", background: isSel ? "#eff6ff" : (exists ? "#fef3c7" : "transparent") }}>
                        <td style={{ padding: "4px 6px" }}>
                          <input type="checkbox" checked={isSel} onChange={() => toggle(f.id)} onClick={e => e.stopPropagation()} />
                        </td>
                        <td style={{ padding: "4px 6px", fontSize: 10 }}>{f.name}</td>
                        <td style={{ padding: "4px 6px", fontFamily: "ui-monospace, monospace", fontSize: 10 }}>{f.parsed.stokKodu}</td>
                        <td style={{ padding: "4px 6px", fontFamily: "ui-monospace, monospace", fontSize: 10, fontWeight: 600, color: "#1e40af" }}>{f.parsed.faiNo}</td>
                        <td style={{ padding: "4px 6px", fontSize: 9, color: "#78716c" }}>{f.modifiedTime ? String(f.modifiedTime).slice(0, 10) : "—"}</td>
                        <td style={{ padding: "4px 6px" }}>
                          {exists ? <span style={{ padding: "1px 5px", background: "#fef3c7", color: "#92400e", borderRadius: 2, fontSize: 9 }}>Mevcut (birleşir)</span>
                                  : <span style={{ padding: "1px 5px", background: "#dcfce7", color: "#166534", borderRadius: 2, fontSize: 9 }}>Yeni</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {invalidFolders.length > 0 && invalidFolders.slice(0, 20).map(f => (
                    <tr key={f.id} style={{ borderTop: "1px solid #f5f5f4", background: "#fafaf9" }}>
                      <td style={{ padding: "4px 6px", color: "#a8a29e", fontSize: 10, textAlign: "center" }}>—</td>
                      <td style={{ padding: "4px 6px", fontSize: 10, color: "#a8a29e" }} colSpan="5">
                        ⚠ Format uyumsuz: {f.name}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: "#57534e" }}>
            <b>{selected.size}</b> klasör seçildi
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving}
              style={{ padding: "6px 14px", fontSize: 12, background: "#f5f5f4", color: "#57534e", border: "1px solid #d6d3d1", borderRadius: 4, cursor: "pointer" }}>İptal</button>
            <button onClick={handleImport} disabled={saving || !canEdit || selected.size === 0}
              style={{ padding: "6px 14px", fontSize: 12, background: selected.size > 0 ? "#166534" : "#a8a29e", color: "#fff", border: "none", borderRadius: 4, cursor: (saving || selected.size === 0) ? "not-allowed" : "pointer", fontWeight: 500 }}>
              {saving ? "İçe aktarılıyor..." : `✓ ${selected.size} Kayıt İçe Aktar`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
