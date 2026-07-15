import { useState, useEffect, useMemo, useRef } from "react";
import {
  subscribeQuoteMaterials, subscribeQuoteFasonWorks, subscribeQuoteOptions,
  subscribeQuotePolicy, subscribeQuotesForYear,
} from "./firestore";

const IMPORT_URL = "https://europe-west1-sevkiyat-pro.cloudfunctions.net/importQuoteExcelHttp";
const PROMOTE_URL = "https://europe-west1-sevkiyat-pro.cloudfunctions.net/promoteQuoteStagingHttp";

export default function Teklifler({ isAdmin, isUretim, isSales }) {
  const canEdit = !!(isAdmin || isSales || isUretim);
  const [activeTab, setActiveTab] = useState("list");

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>📋 Teklifler</h1>
        <span style={{ fontSize: 11, color: "#a8a29e" }}>Yapım aşamasında — Faz 0 (master data import)</span>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #e7e5e4" }}>
        {[
          { id: "list", label: "📋 Teklif Listesi" },
          { id: "master", label: "🎯 Master Data" },
          { id: "import", label: "📥 Excel İçe Aktar", adminOnly: true },
        ].filter(t => !t.adminOnly || isAdmin).map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "8px 14px", border: "none",
              background: activeTab === t.id ? "#534AB7" : "transparent",
              color: activeTab === t.id ? "#fff" : "#57534e",
              fontSize: 13, fontWeight: activeTab === t.id ? 500 : 400,
              cursor: "pointer",
              borderRadius: "6px 6px 0 0",
            }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === "list" && <QuoteListView />}
      {activeTab === "master" && <MasterDataView />}
      {activeTab === "import" && isAdmin && <ImportView />}
    </div>
  );
}

// ==================== Teklif Listesi (arşiv görünümü) ====================

function QuoteListView() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ quotes: {} });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = subscribeQuotesForYear(year, setData, { staging });
    return unsub;
  }, [year, staging]);

  const quotes = useMemo(() => {
    const q = Object.values(data?.quotes || {});
    const s = search.trim().toLocaleLowerCase("tr-TR");
    const filtered = s ? q.filter(x =>
      (x.customerName || "").toLocaleLowerCase("tr-TR").includes(s) ||
      (x.quoteNo || "").toLocaleLowerCase("tr-TR").includes(s) ||
      (x.lines || []).some(l => (l.stockCode || "").toLocaleLowerCase("tr-TR").includes(s) || (l.stockName || "").toLocaleLowerCase("tr-TR").includes(s))
    ) : q;
    return filtered.sort((a, b) => (b.quoteDate || "").localeCompare(a.quoteDate || ""));
  }, [data, search]);

  const totalLines = quotes.reduce((s, q) => s + (q.lines?.length || 0), 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#57534e" }}>Yıl:</label>
        <select value={year} onChange={e => setYear(e.target.value)} style={selectStyle}>
          {["2024", "2025", "2026"].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} />
          Staging
        </label>
        <input
          type="text" placeholder="🔎 Müşteri / teklif no / stok kodu / ad"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 240, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}
        />
        <span style={{ fontSize: 11, color: "#78716c" }}>
          {quotes.length} teklif · {totalLines} kalem
        </span>
      </div>

      {quotes.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          Bu yılda teklif yok. {staging ? "Staging'den prod'a geçirmek için Master Data sekmesindeki 'Promote' butonunu kullan." : "Excel Import sekmesinden içe aktar."}
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                <th style={th}>Teklif No</th>
                <th style={th}>Tarih</th>
                <th style={th}>Müşteri</th>
                <th style={{ ...th, textAlign: "right" }}>Kalem</th>
                <th style={{ ...th, textAlign: "right" }}>Toplam</th>
                <th style={th}>Döviz</th>
                <th style={th}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => (
                <tr key={q.quoteNo} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{q.quoteNo}</td>
                  <td style={td}>{q.quoteDate || "—"}</td>
                  <td style={td}>{q.customerName}</td>
                  <td style={{ ...td, textAlign: "right" }}>{q.lines?.length || 0}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {Number(q.totalPriceTl || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={td}>{q.currency || "TL"}</td>
                  <td style={td}>
                    <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600,
                      background: q.status === "accepted" ? "#dcfce7" : "#fef3c7",
                      color: q.status === "accepted" ? "#166534" : "#92400e" }}>
                      {q.status === "accepted" ? "✓ KABUL" : "⏳ TEKLİF"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ==================== Master Data görüntüsü ====================

function MasterDataView() {
  const [staging, setStaging] = useState(false);
  const [materials, setMaterials] = useState(null);
  const [fasonWorks, setFasonWorks] = useState(null);
  const [options, setOptions] = useState(null);
  const [policy, setPolicy] = useState(null);

  useEffect(() => {
    const u1 = subscribeQuoteMaterials(setMaterials, { staging });
    const u2 = subscribeQuoteFasonWorks(setFasonWorks, { staging });
    const u3 = subscribeQuoteOptions(setOptions, { staging });
    const u4 = subscribeQuotePolicy(setPolicy, { staging });
    return () => { u1(); u2(); u3(); u4(); };
  }, [staging]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging'e bak
        </label>
      </div>

      <Card title={`Malzemeler (${Object.keys(materials?.materials || {}).length})`}>
        {materials?.currencyRateUsd > 0 && <div style={{ fontSize: 11, color: "#78716c", marginBottom: 8 }}>Döviz kuru: <b>1 $ = {materials.currencyRateUsd} TL</b></div>}
        <div style={{ maxHeight: 300, overflowY: "auto", fontSize: 11 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f5f5f4", textAlign: "left" }}>
              <th style={miniTh}>Ad</th><th style={miniTh}>Şekil</th><th style={miniThR}>Özgül</th><th style={miniThR}>$/kg</th><th style={miniThR}>TL/kg</th>
            </tr></thead>
            <tbody>
              {Object.values(materials?.materials || {}).map(m => (
                <tr key={m.name} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={miniTd}>{m.name}</td>
                  <td style={miniTd}>{m.shape}</td>
                  <td style={miniTdR}>{m.density}</td>
                  <td style={miniTdR}>{m.priceUsdPerKg}</td>
                  <td style={miniTdR}>{Number(m.priceTlPerKg).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Fason İşleri (${(fasonWorks?.works || []).length})`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
          {(fasonWorks?.works || []).map(w => (
            <span key={w.id} style={{ padding: "3px 8px", background: "#f5f5f4", borderRadius: 3 }}>{w.name}</span>
          ))}
        </div>
      </Card>

      <Card title="Marj Politikası">
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Miktar bazlı marj</div>
            <table style={{ fontSize: 11, borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f5f5f4" }}>
                <th style={miniTh}>Aralık</th><th style={miniThR}>İşçilik %</th><th style={miniThR}>Malz/Fason %</th>
              </tr></thead>
              <tbody>
                {(policy?.quantityMargins || []).map((b, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={miniTd}>{b.min === b.max ? b.min : `${b.min}-${b.max}`}</td>
                    <td style={miniTdR}>{b.laborPct}%</td>
                    <td style={miniTdR}>{b.materialFasonPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Firma grubu marj (hammadde)</div>
            <table style={{ fontSize: 11, borderCollapse: "collapse" }}>
              <tbody>
                {Object.entries(policy?.customerGroupMargins || {}).map(([g, r]) => (
                  <tr key={g} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={miniTd}>{g}</td>
                    <td style={miniTdR}>{Math.round(r * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card title="Seçenekler">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, fontSize: 11 }}>
          {options && Object.entries(options).filter(([k]) => Array.isArray(options[k])).map(([k, vals]) => (
            <div key={k}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{k}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {vals.map((v, i) => <span key={i} style={{ padding: "2px 6px", background: "#f5f5f4", borderRadius: 3 }}>{v}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ==================== Excel Import (admin) ====================

function ImportView() {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [staging, setStaging] = useState(true);
  const [mode, setMode] = useState("both"); // master | archive | both
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [promoting, setPromoting] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true); setError(""); setResult(null);
    try {
      const url = `${IMPORT_URL}?staging=${staging}&mode=${mode}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handlePromote = async () => {
    if (!confirm("Staging'deki tüm veri prod'a kopyalanacak, ardından staging silinecek. Devam mı?")) return;
    setPromoting(true); setError("");
    try {
      const res = await fetch(PROMOTE_URL, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      alert(`Promote edildi: ${json.promoted?.join(", ")}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div>
      <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#92400e", marginBottom: 14 }}>
        ⚠ <b>Tek seferlik işlem.</b> Excel'i içe aktardıktan sonra bu sekmeyi tekrar kullanmana gerek yok. Staging modunda test edip prod'a geçirilebilir.
      </div>

      <div style={{ padding: 16, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>1. Excel'i Yükle</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} disabled={uploading} />
            {" "}Staging'e yaz (önerilen — önce test et)
          </label>
          <select value={mode} onChange={e => setMode(e.target.value)} disabled={uploading} style={selectStyle}>
            <option value="both">Hepsi (master + arşiv)</option>
            <option value="master">Sadece Master Data</option>
            <option value="archive">Sadece Arşiv</option>
          </select>
        </div>
        <input ref={fileRef} type="file" accept=".xlsm,.xlsx" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={btnPrimary}>
          {uploading ? "Yükleniyor..." : "📤 Excel Seç ve Yükle"}
        </button>
      </div>

      {error && (
        <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 12, color: "#991b1b", marginBottom: 12 }}>
          ⚠ {error}
        </div>
      )}

      {result && (
        <div style={{ padding: 12, background: "#dcfce7", border: "1px solid #86efac", borderRadius: 6, fontSize: 12, color: "#166534", marginBottom: 12 }}>
          ✓ Yüklendi ({result.staging ? "staging" : "prod"} · {result.mode})
          {result.master && <div>Master: {result.master.summary?.materialCount} malzeme, {result.master.summary?.fasonWorkCount} fason iş, {result.master.summary?.quantityBracketCount} miktar aralığı, kur 1$={result.master.summary?.currencyRateUsd}</div>}
          {result.archive && <div>Arşiv: {result.archive.summary?.totalQuotes} teklif, {result.archive.summary?.totalLines} kalem · yıllar: {Object.keys(result.archive.summary?.byYear || {}).join(", ")}</div>}
        </div>
      )}

      <div style={{ padding: 16, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>2. Staging → Prod Promote</div>
        <div style={{ fontSize: 11, color: "#78716c", marginBottom: 10 }}>
          Staging'de kontrol ettikten sonra bu buton staging doc'ları prod'a taşır ve staging'i siler.
        </div>
        <button onClick={handlePromote} disabled={promoting} style={btnPromote}>
          {promoting ? "Promote ediliyor..." : "✅ Staging → Prod"}
        </button>
      </div>
    </div>
  );
}

// ==================== ortak stiller ====================

function Card({ title, children }) {
  return (
    <div style={{ padding: 14, border: "1px solid #e7e5e4", borderRadius: 6, background: "#fff", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#1c1917" }}>{title}</div>
      {children}
    </div>
  );
}

const th = { padding: "8px 10px", fontWeight: 600, fontSize: 10, borderBottom: "1px solid #e7e5e4" };
const td = { padding: "6px 10px", fontSize: 11 };
const miniTh = { padding: "4px 6px", textAlign: "left", fontWeight: 600, fontSize: 10 };
const miniThR = { padding: "4px 6px", textAlign: "right", fontWeight: 600, fontSize: 10 };
const miniTd = { padding: "3px 6px", fontSize: 11 };
const miniTdR = { padding: "3px 6px", fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const selectStyle = { padding: "5px 8px", borderRadius: 4, border: "1px solid #d6d3d1", fontSize: 12 };
const btnPrimary = { padding: "8px 16px", background: "#534AB7", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: "pointer" };
const btnPromote = { padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: "pointer" };
