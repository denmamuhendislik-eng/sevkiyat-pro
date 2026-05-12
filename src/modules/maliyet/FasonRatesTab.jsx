import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  subscribeFasonRates, saveFasonRates,
  subscribeWorkCenters, subscribeBomModels,
} from "./firestore";

const SHEET_OP = "Op_Ucretleri";
const SHEET_WEIGHT = "Parca_Agirliklari";
const SHEET_OVERRIDE = "Parca_Ozel_Ucretler";

const fmt2 = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Fason op tespiti (opCode ≥600 ve istisnalar değil — App.jsx ve productCostCalc ile aynı)
function isFasonOpCode(code) {
  const n = Number(code);
  if (isNaN(n)) return false;
  return n >= 600 && ![653, 654, 665].includes(n);
}

export default function FasonRatesTab({ canEdit, isAdmin }) {
  const [fasonRates, setFasonRates] = useState({});
  const [workCenters, setWorkCenters] = useState({});
  const [bomModels, setBomModels] = useState({});
  const [loaded, setLoaded] = useState({ rates: false, wc: false, bom: false });
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { const u = subscribeFasonRates(d => { setFasonRates(d || {}); setLoaded(p => ({ ...p, rates: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeWorkCenters(d => { setWorkCenters(d || {}); setLoaded(p => ({ ...p, wc: true })); }); return u; }, []);
  useEffect(() => { const u = subscribeBomModels(d => { setBomModels(d || {}); setLoaded(p => ({ ...p, bom: true })); }); return u; }, []);

  // Draft state: Firestore'dan gelen veriyi local draft'a kopyala (kullanıcı düzenler, kaydete kadar)
  useEffect(() => {
    if (dirty) return;
    setDraft({
      opDefaults: { ...(fasonRates?.opDefaults || {}) },
      partWeights: { ...(fasonRates?.partWeights || {}) },
      partOverrides: { ...(fasonRates?.partOverrides || {}) },
    });
  }, [fasonRates, dirty]);

  // BOM'da fason op geçen parçaları + op kodlarını topla
  const { fasonOpsFromBom, fasonPartsFromBom } = useMemo(() => {
    const ops = new Map();   // opCode → { name, count }
    const parts = new Map(); // stokKodu → { name, count }
    for (const [mk, model] of Object.entries(bomModels || {})) {
      if (mk === "undefined") continue;
      for (const p of (model.parts || [])) {
        let hasAnyFason = false;
        for (const op of (p.operations || [])) {
          if (isFasonOpCode(op.opCode)) {
            hasAnyFason = true;
            const codeStr = String(op.opCode);
            const existing = ops.get(codeStr) || { name: op.opName || op.name || `Op ${codeStr}`, count: 0 };
            existing.count++;
            if (op.opName || op.name) existing.name = op.opName || op.name;
            ops.set(codeStr, existing);
          }
        }
        if (hasAnyFason && p.stockCode) {
          const existing = parts.get(p.stockCode) || { name: p.stockName || "", count: 0 };
          existing.count++;
          if (p.stockName) existing.name = p.stockName;
          parts.set(p.stockCode, existing);
        }
      }
    }
    return { fasonOpsFromBom: ops, fasonPartsFromBom: parts };
  }, [bomModels]);

  // ==================== ŞABLON İNDİRME ====================
  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Op Ücretleri
    const opRows = [["Op Kodu", "Op Adı", "Birim (AD/KG)", "TL/Birim", "Not"]];
    // workCenters.fason'dan tüm fason op'ları al
    const wcFasonOps = workCenters?.fason || {};
    const allOpCodes = new Set([
      ...Object.keys(wcFasonOps).filter(c => isFasonOpCode(c)),
      ...fasonOpsFromBom.keys(),
      ...Object.keys(draft?.opDefaults || {}),
    ]);
    [...allOpCodes].sort().forEach(opCode => {
      const wcInfo = wcFasonOps[opCode] || {};
      const bomInfo = fasonOpsFromBom.get(opCode) || {};
      const existing = draft?.opDefaults?.[opCode] || {};
      const name = existing.name || wcInfo.name || bomInfo.name || "";
      opRows.push([
        opCode, name,
        existing.unit || "AD",
        existing.unitPriceTl || "",
        existing.note || "",
      ]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(opRows);
    ws1["!cols"] = [{ wch: 10 }, { wch: 35 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws1, SHEET_OP);

    // Sheet 2: Parça Ağırlıkları
    const weightRows = [["Stok Kodu", "Stok Adı", "KG"]];
    const allParts = new Set([
      ...fasonPartsFromBom.keys(),
      ...Object.keys(draft?.partWeights || {}),
    ]);
    [...allParts].sort().forEach(code => {
      const bomInfo = fasonPartsFromBom.get(code) || {};
      const existing = draft?.partWeights?.[code] || {};
      weightRows.push([
        code, existing.name || bomInfo.name || "",
        existing.kg || "",
      ]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(weightRows);
    ws2["!cols"] = [{ wch: 14 }, { wch: 45 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, SHEET_WEIGHT);

    // Sheet 3: Parça-Özel Override (mevcut override'lar + boş başlık)
    const overrideRows = [["Op Kodu", "Stok Kodu", "Stok Adı", "Birim (AD/KG)", "TL/Birim", "Not"]];
    Object.entries(draft?.partOverrides || {}).forEach(([key, v]) => {
      const [opCode, stockCode] = key.split("_");
      overrideRows.push([
        opCode, stockCode, v.name || "",
        v.unit || "AD",
        v.unitPriceTl || "",
        v.note || "",
      ]);
    });
    const ws3 = XLSX.utils.aoa_to_sheet(overrideRows);
    ws3["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 45 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws3, SHEET_OVERRIDE);

    const fileName = `fason_ucret_sablonu_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // ==================== EXCEL YÜKLEME ====================
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      const opDefaults = {};
      const partWeights = {};
      const partOverrides = {};

      // Sheet 1: Op Ücretleri
      if (wb.Sheets[SHEET_OP]) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_OP], { header: 1, defval: "" });
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const code = String(r[0] || "").trim();
          if (!code || !isFasonOpCode(code)) continue;
          const price = Number(r[3]);
          if (!(price > 0)) continue;  // boş fiyat → atla
          opDefaults[code] = {
            name: String(r[1] || "").trim(),
            unit: String(r[2] || "AD").trim().toUpperCase() === "KG" ? "KG" : "AD",
            unitPriceTl: price,
            note: String(r[4] || "").trim(),
          };
        }
      }

      // Sheet 2: Parça Ağırlıkları
      if (wb.Sheets[SHEET_WEIGHT]) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_WEIGHT], { header: 1, defval: "" });
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const code = String(r[0] || "").trim();
          if (!code) continue;
          const kg = Number(r[2]);
          if (!(kg > 0)) continue;
          partWeights[code] = { name: String(r[1] || "").trim(), kg };
        }
      }

      // Sheet 3: Parça-Özel Override
      if (wb.Sheets[SHEET_OVERRIDE]) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_OVERRIDE], { header: 1, defval: "" });
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const opCode = String(r[0] || "").trim();
          const stockCode = String(r[1] || "").trim();
          if (!opCode || !stockCode) continue;
          const price = Number(r[4]);
          if (!(price > 0)) continue;
          partOverrides[`${opCode}_${stockCode}`] = {
            name: String(r[2] || "").trim(),
            unit: String(r[3] || "AD").trim().toUpperCase() === "KG" ? "KG" : "AD",
            unitPriceTl: price,
            note: String(r[5] || "").trim(),
          };
        }
      }

      // Mevcutla birleştir (yüklenen değerler üzerine yazılır)
      setDraft({
        opDefaults: { ...(draft?.opDefaults || {}), ...opDefaults },
        partWeights: { ...(draft?.partWeights || {}), ...partWeights },
        partOverrides: { ...(draft?.partOverrides || {}), ...partOverrides },
      });
      setDirty(true);
      alert(`✓ Yüklendi:\n${Object.keys(opDefaults).length} op default\n${Object.keys(partWeights).length} parça ağırlığı\n${Object.keys(partOverrides).length} parça override\n\n"Kaydet" ile Firestore'a yaz.`);
    } catch (err) {
      alert("Excel okuma hatası: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  // ==================== INLINE EDIT ====================
  const updateOpDef = (opCode, patch) => {
    setDraft(prev => {
      const cur = { ...(prev.opDefaults[opCode] || {}), ...patch };
      return { ...prev, opDefaults: { ...prev.opDefaults, [opCode]: cur } };
    });
    setDirty(true);
  };
  const updateWeight = (code, patch) => {
    setDraft(prev => {
      const cur = { ...(prev.partWeights[code] || {}), ...patch };
      return { ...prev, partWeights: { ...prev.partWeights, [code]: cur } };
    });
    setDirty(true);
  };
  const removeOverride = (key) => {
    setDraft(prev => {
      const next = { ...prev.partOverrides };
      delete next[key];
      return { ...prev, partOverrides: next };
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!canEdit || !draft) return;
    setSaving(true);
    try {
      // Boş değerleri temizle
      const cleaned = {
        opDefaults: {},
        partWeights: {},
        partOverrides: { ...draft.partOverrides },
      };
      for (const [code, v] of Object.entries(draft.opDefaults)) {
        if (Number(v.unitPriceTl) > 0) cleaned.opDefaults[code] = { ...v, unitPriceTl: Number(v.unitPriceTl) };
      }
      for (const [code, v] of Object.entries(draft.partWeights)) {
        if (Number(v.kg) > 0) cleaned.partWeights[code] = { ...v, kg: Number(v.kg) };
      }
      await saveFasonRates(cleaned, { canEdit });
      setDirty(false);
      alert("✓ Kaydedildi");
    } catch (err) {
      alert("Kayıt hatası: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft({
      opDefaults: { ...(fasonRates?.opDefaults || {}) },
      partWeights: { ...(fasonRates?.partWeights || {}) },
      partOverrides: { ...(fasonRates?.partOverrides || {}) },
    });
    setDirty(false);
  };

  const allLoaded = Object.values(loaded).every(Boolean);
  if (!allLoaded || !draft) return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Yükleniyor...</div>;

  // Op listesi: BOM'dan + workCenters'tan + mevcut draft'tan
  const wcFasonOps = workCenters?.fason || {};
  const allOpCodes = [...new Set([
    ...Object.keys(wcFasonOps).filter(c => isFasonOpCode(c)),
    ...fasonOpsFromBom.keys(),
    ...Object.keys(draft.opDefaults),
  ])].sort();

  return (
    <div>
      {/* Üst bant: indir/yükle/kaydet */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: 8, flexWrap: "wrap" }}>
        <button
          onClick={handleDownloadTemplate}
          style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
        >
          📥 Boş şablon indir
        </button>
        {canEdit && (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--color-border-info)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            📤 Excel yükle
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileUpload} />
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          Şablonu indir → KG ve TL alanlarını doldur → geri yükle. {fasonRates?.updatedAt && `Son: ${new Date(fasonRates.updatedAt).toLocaleString("tr-TR")}`}
        </span>
        {canEdit && dirty && (
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
            <button
              onClick={handleReset}
              style={{ padding: "5px 12px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", background: "transparent", fontSize: 11, cursor: "pointer" }}
            >
              Geri al
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #1D9E75", background: "#1D9E75", color: "white", fontWeight: 500, fontSize: 12, cursor: saving ? "default" : "pointer" }}
            >
              {saving ? "Kaydediliyor..." : "✓ Kaydet"}
            </button>
          </span>
        )}
      </div>

      <OpDefaultsSection
        allOpCodes={allOpCodes}
        wcFasonOps={wcFasonOps}
        fasonOpsFromBom={fasonOpsFromBom}
        draft={draft}
        updateOpDef={updateOpDef}
        canEdit={canEdit}
      />

      <WeightsSection
        fasonPartsFromBom={fasonPartsFromBom}
        draft={draft}
        updateWeight={updateWeight}
        canEdit={canEdit}
      />

      <OverridesSection
        draft={draft}
        removeOverride={removeOverride}
        canEdit={canEdit}
      />
    </div>
  );
}

function OpDefaultsSection({ allOpCodes, wcFasonOps, fasonOpsFromBom, draft, updateOpDef, canEdit }) {
  return (
    <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
      <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", fontSize: 12, fontWeight: 600 }}>
        🔧 Op Default Ücretleri ({allOpCodes.length} op)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 110px 1fr", padding: "6px 12px", background: "var(--color-background-primary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
        <span>Op Kodu</span>
        <span>Op Adı</span>
        <span>Birim</span>
        <span style={{ textAlign: "right" }}>TL/Birim</span>
        <span>Not</span>
      </div>
      {allOpCodes.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>BOM'da fason op tanımlı değil</div>
      ) : allOpCodes.map(code => {
        const wcInfo = wcFasonOps[code] || {};
        const bomInfo = fasonOpsFromBom.get(code) || {};
        const existing = draft.opDefaults[code] || {};
        const name = existing.name || wcInfo.name || bomInfo.name || "";
        return (
          <div key={code} style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 110px 1fr", padding: "4px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{code}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name} <span style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>({bomInfo.count || 0} parça)</span></span>
            <select
              value={existing.unit || "AD"}
              onChange={e => updateOpDef(code, { name, unit: e.target.value })}
              disabled={!canEdit}
              style={{ padding: "4px 6px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", fontSize: 10 }}
            >
              <option value="AD">AD</option>
              <option value="KG">KG</option>
            </select>
            <input
              type="number" min="0" step="0.01"
              value={existing.unitPriceTl ?? ""}
              onChange={e => updateOpDef(code, { name, unitPriceTl: e.target.value })}
              disabled={!canEdit}
              placeholder="0"
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", fontSize: 11, textAlign: "right" }}
            />
            <input
              value={existing.note || ""}
              onChange={e => updateOpDef(code, { name, note: e.target.value })}
              disabled={!canEdit}
              placeholder="opsiyonel"
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--color-border-secondary)", fontSize: 10 }}
            />
          </div>
        );
      })}
    </div>
  );
}

function WeightsSection({ fasonPartsFromBom, draft, updateWeight, canEdit }) {
  const [search, setSearch] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  const allParts = [...new Set([
    ...fasonPartsFromBom.keys(),
    ...Object.keys(draft.partWeights),
  ])].sort();

  const q = search.trim().toLocaleLowerCase("tr-TR");
  const filtered = allParts.filter(code => {
    const bomInfo = fasonPartsFromBom.get(code) || {};
    const existing = draft.partWeights[code] || {};
    const name = existing.name || bomInfo.name || "";
    if (showOnlyMissing && existing.kg > 0) return false;
    if (q && !code.toLocaleLowerCase("tr-TR").includes(q) && !name.toLocaleLowerCase("tr-TR").includes(q)) return false;
    return true;
  });
  const missingCount = allParts.filter(c => !(draft.partWeights[c]?.kg > 0)).length;

  return (
    <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
      <div style={{ padding: "8px 14px", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>⚖️ Parça Ağırlıkları ({allParts.length} parça)</span>
        {missingCount > 0 && (
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", fontWeight: 500 }}>
            ⚠ {missingCount} parçada ağırlık yok
          </span>
        )}
        <input
          type="text"
          placeholder="Stok kodu/isim ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 5, border: "1px solid var(--color-border-secondary)", fontSize: 11, minWidth: 200 }}
        />
        <label style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={showOnlyMissing} onChange={e => setShowOnlyMissing(e.target.checked)} />
          Sadece eksik
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 110px 80px", padding: "6px 12px", background: "var(--color-background-primary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
        <span>Stok Kodu</span>
        <span>Stok Adı</span>
        <span style={{ textAlign: "right" }}>KG</span>
        <span style={{ textAlign: "center" }}>BOM</span>
      </div>
      <div style={{ maxHeight: 500, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
            {search || showOnlyMissing ? "Filtre eşleşmedi" : "Fason geçen parça yok"}
          </div>
        ) : filtered.map(code => {
          const bomInfo = fasonPartsFromBom.get(code) || {};
          const existing = draft.partWeights[code] || {};
          const name = existing.name || bomInfo.name || "";
          return (
            <div key={code} style={{ display: "grid", gridTemplateColumns: "140px 1fr 110px 80px", padding: "4px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{code}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              <input
                type="number" min="0" step="0.001"
                value={existing.kg ?? ""}
                onChange={e => updateWeight(code, { name, kg: e.target.value })}
                disabled={!canEdit}
                placeholder="—"
                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid " + (existing.kg > 0 ? "var(--color-border-tertiary)" : "#FCD34D"), fontSize: 11, textAlign: "right", background: existing.kg > 0 ? "var(--color-background-primary)" : "#FFFBEB" }}
              />
              <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", textAlign: "center" }}>{bomInfo.count || 0}×</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverridesSection({ draft, removeOverride, canEdit }) {
  const overrides = Object.entries(draft.partOverrides || {});
  const [showSection, setShowSection] = useState(overrides.length > 0);

  return (
    <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
      <div
        onClick={() => setShowSection(v => !v)}
        style={{ padding: "8px 14px", background: "var(--color-background-secondary)", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8 }}
      >
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{showSection ? "▼" : "▶"}</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>🎯 Parça-Özel Override ({overrides.length})</span>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          Op default'u geçersiz kılar (örn. talaşlı imalat parça başı farklı)
        </span>
      </div>
      {showSection && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "80px 130px 1fr 80px 110px 40px", padding: "6px 12px", background: "var(--color-background-primary)", fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", gap: 8 }}>
            <span>Op</span>
            <span>Stok Kodu</span>
            <span>Stok Adı</span>
            <span>Birim</span>
            <span style={{ textAlign: "right" }}>TL/Birim</span>
            <span></span>
          </div>
          {overrides.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 11 }}>
              Override kayıt yok. Excel Sheet 3'e yazıp yükleyerek ekleyebilirsin.
            </div>
          ) : overrides.map(([key, v]) => {
            const [opCode, stockCode] = key.split("_");
            return (
              <div key={key} style={{ display: "grid", gridTemplateColumns: "80px 130px 1fr 80px 110px 40px", padding: "4px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 11, gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{opCode}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{stockCode}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }}>{v.name || ""}</span>
                <span style={{ fontSize: 10 }}>{v.unit}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{fmt2(v.unitPriceTl)}</span>
                {canEdit && (
                  <button onClick={() => removeOverride(key)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-tertiary)" }} title="Sil">✕</button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
