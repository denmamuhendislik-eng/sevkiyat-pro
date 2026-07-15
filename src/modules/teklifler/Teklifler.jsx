import { useState, useEffect, useMemo, useRef } from "react";
import {
  subscribeQuoteMaterials, subscribeQuoteFasonWorks, subscribeQuoteOptions,
  subscribeQuotePolicy, subscribeQuotesForYear, subscribeQuoteParts, subscribeQuoteCustomers,
  saveQuotePolicyUpdate, saveQuoteCustomer,
} from "./firestore";
import NewQuoteView from "./NewQuoteView";
import { generateQuotePdf } from "./quotePdf";
import { calculateQuoteTotal } from "./quoteCalc";

const IMPORT_URL = "https://europe-west1-sevkiyat-pro.cloudfunctions.net/importQuoteExcelHttp";
const PROMOTE_URL = "https://europe-west1-sevkiyat-pro.cloudfunctions.net/promoteQuoteStagingHttp";

export default function Teklifler({ isAdmin, isUretim, isSales }) {
  const canEdit = !!(isAdmin || isSales || isUretim);
  const [activeTab, setActiveTab] = useState("new");

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>📋 Teklifler</h1>
        <span style={{ fontSize: 11, color: "#a8a29e" }}>Yapım aşamasında — Faz 0 (master data import)</span>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #e7e5e4" }}>
        {[
          { id: "new", label: "➕ Yeni Teklif" },
          { id: "list", label: "📋 Teklif Listesi" },
          { id: "parts", label: "🔩 Parça Kütüphanesi" },
          { id: "customers", label: "👥 Müşteriler" },
          { id: "master", label: "🎯 Master Data" },
          { id: "margins", label: "💰 Marj Editörü", adminOnly: true },
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

      {activeTab === "new" && <NewQuoteView canEdit={canEdit} isAdmin={isAdmin} onSaved={() => setActiveTab("list")} />}
      {activeTab === "list" && <QuoteListView />}
      {activeTab === "parts" && <PartsLibraryView />}
      {activeTab === "customers" && <CustomersView canEdit={canEdit} />}
      {activeTab === "master" && <MasterDataView />}
      {activeTab === "margins" && isAdmin && <MarginEditorView canEdit={canEdit && isAdmin} />}
      {activeTab === "import" && isAdmin && <ImportView />}
    </div>
  );
}

// ==================== Müşteri Master Sekmesi ====================

function CustomersView({ canEdit }) {
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ customers: {} });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // { name, isNew, phone, email, ... }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeQuoteCustomers(setData, { staging });
    return unsub;
  }, [staging]);

  const customers = useMemo(() => {
    const arr = Object.values(data?.customers || {});
    const s = search.trim().toLocaleLowerCase("tr-TR");
    const filtered = s ? arr.filter(c => (c.name || "").toLocaleLowerCase("tr-TR").includes(s)) : arr;
    return filtered.sort((a, b) => (b.totalQuotes || 0) - (a.totalQuotes || 0));
  }, [data, search]);

  const openNew = () => setEditing({ name: "", isNew: true, phone: "", email: "", defaultPaymentTerm: "60 Gün Vade", defaultShipping: "", defaultCurrency: "TL" });
  const openEdit = (c) => setEditing({ ...c, isNew: false });

  const handleSave = async () => {
    if (!editing) return;
    const key = editing.name?.trim();
    if (!key) { alert("Müşteri adı zorunlu"); return; }
    setSaving(true);
    try {
      await saveQuoteCustomer(key, {
        name: key,
        phone: editing.phone || "",
        email: editing.email || "",
        defaultPaymentTerm: editing.defaultPaymentTerm || "",
        defaultShipping: editing.defaultShipping || "",
        defaultCurrency: editing.defaultCurrency || "TL",
      }, { canEdit, staging });
      setEditing(null);
    } catch (e) {
      alert("Kayıt hatası: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔎 Müşteri ara"
          style={{ flex: 1, minWidth: 240, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }} />
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging
        </label>
        {canEdit && <button onClick={openNew} style={btnPrimary}>+ Yeni Müşteri</button>}
        <span style={{ fontSize: 11, color: "#78716c" }}>{customers.length} müşteri</span>
      </div>

      {customers.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          Müşteri yok. Yeni ekle veya arşivi import et.
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                <th style={th}>Müşteri</th>
                <th style={th}>Tel / E-mail</th>
                <th style={th}>Default Ödeme</th>
                <th style={th}>Default Nakliye</th>
                <th style={{ ...th, textAlign: "right" }}>Teklif</th>
                <th style={{ ...th, textAlign: "right" }}>Toplam TL</th>
                <th style={th}>Son Teklif</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.name} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ ...td, fontWeight: 500 }}>{c.name}</td>
                  <td style={{ ...td, fontSize: 10 }}>
                    {c.phone || "—"}
                    {c.email && <div style={{ color: "#a8a29e" }}>{c.email}</div>}
                  </td>
                  <td style={{ ...td, fontSize: 10 }}>{c.defaultPaymentTerm || "—"}</td>
                  <td style={{ ...td, fontSize: 10 }}>{c.defaultShipping || "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{c.totalQuotes || 0}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {Number(c.totalPriceTl || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ ...td, fontSize: 10 }}>{c.lastQuoteDate || "—"}</td>
                  <td style={td}>
                    {canEdit && (
                      <button onClick={() => openEdit(c)} style={{ padding: "3px 8px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}>✏️</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !saving) setEditing(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 8, width: "min(500px, 92vw)", padding: 20 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {editing.isNew ? "➕ Yeni Müşteri" : "✏️ Müşteri Düzenle"}
            </h3>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "#57534e", display: "block", marginBottom: 4 }}>Müşteri Adı *</label>
                <input value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} disabled={!editing.isNew}
                  style={{ width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 11, color: "#57534e", display: "block", marginBottom: 4 }}>Telefon</label>
                  <input value={editing.phone || ""} onChange={e => setEditing({ ...editing, phone: e.target.value })} style={{ width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" }} />
                </div>
                <div><label style={{ fontSize: 11, color: "#57534e", display: "block", marginBottom: 4 }}>E-mail</label>
                  <input value={editing.email || ""} onChange={e => setEditing({ ...editing, email: e.target.value })} style={{ width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#57534e", display: "block", marginBottom: 4 }}>Default Ödeme Şekli (marj hesabında kullanılır)</label>
                <select value={editing.defaultPaymentTerm || ""} onChange={e => setEditing({ ...editing, defaultPaymentTerm: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}>
                  <option value="">— seç —</option>
                  <option value="30 Gün Vade">30 Gün Vade</option>
                  <option value="60 Gün Vade">60 Gün Vade</option>
                  <option value="90 Gün Vade">90 Gün Vade</option>
                  <option value="PEŞİN ÖDEME">PEŞİN ÖDEME</option>
                  <option value="%100 Teslimde Ödeme">%100 Teslimde Ödeme</option>
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 11, color: "#57534e", display: "block", marginBottom: 4 }}>Default Nakliye</label>
                  <input value={editing.defaultShipping || ""} onChange={e => setEditing({ ...editing, defaultShipping: e.target.value })} style={{ width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12, boxSizing: "border-box" }} />
                </div>
                <div><label style={{ fontSize: 11, color: "#57534e", display: "block", marginBottom: 4 }}>Default Döviz</label>
                  <select value={editing.defaultCurrency || "TL"} onChange={e => setEditing({ ...editing, defaultCurrency: e.target.value })}
                    style={{ width: "100%", padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}>
                    <option value="TL">TL</option><option value="DOLAR">DOLAR</option><option value="EURO">EURO</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditing(null)} disabled={saving} style={{ padding: "7px 14px", fontSize: 12, border: "1px solid #d6d3d1", background: "#fff", borderRadius: 4, cursor: "pointer" }}>İptal</button>
              <button onClick={handleSave} disabled={saving || !canEdit} style={btnPrimary}>
                {saving ? "Kaydediliyor..." : "💾 Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
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
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => (
                <tr key={q.quoteNo + "__" + q.customerName} style={{ borderTop: "1px solid #f5f5f4" }}>
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
                  <td style={td}>
                    <button
                      onClick={async () => {
                        try {
                          // Arşivden gelen kayıtta lineResults yok — sadece linePrice var, calc'ı basit oluştur
                          const fakeLineResults = (q.lines || []).map(l => ({
                            weightKg: Number(l.weightKg) || 0,
                            quantity: Number(l.quantity) || 1,
                            perUnit: { totalCost: 0, salePrice: Number(l.salePricePerUnit || (l.linePrice / (l.quantity || 1))) || 0, material: 0, labor: 0, fason: 0, specialTool: 0 },
                            total: { totalCost: 0, salePrice: Number(l.linePrice) || 0, profit: 0, material: 0, labor: 0, fason: 0, specialTool: 0 },
                            margins: {},
                            separateTool: { inLine: true, cost: 0, sale: 0, profit: 0, margin: 0, description: "" },
                          }));
                          const calcForPdf = {
                            lineResults: fakeLineResults,
                            separateToolItems: [],
                            totalCostTl: 0,
                            totalSaleTl: Number(q.totalPriceTl) || 0,
                            totalProfitTl: 0,
                            overallMarginPct: 0,
                            currency: q.currency || "TL",
                            displayFactor: 1,
                            totalSaleDisplay: Number(q.totalPriceTl) || 0,
                            totalCostDisplay: 0,
                          };
                          await generateQuotePdf(q, calcForPdf);
                        } catch (e) {
                          alert("PDF hatası: " + e.message);
                        }
                      }}
                      title="Teklifi PDF olarak indir"
                      style={{ padding: "3px 8px", fontSize: 10, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 3, cursor: "pointer" }}
                    >📄 PDF</button>
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

// ==================== Parça Kütüphanesi (arşivden çıkarılan hafıza) ====================

function PartsLibraryView() {
  const [staging, setStaging] = useState(false);
  const [data, setData] = useState({ parts: {} });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = subscribeQuoteParts(setData, { staging });
    return unsub;
  }, [staging]);

  const parts = useMemo(() => {
    const arr = Object.values(data?.parts || {});
    const s = search.trim().toLocaleLowerCase("tr-TR");
    const filtered = s ? arr.filter(p =>
      (p.stokKodu || "").toLocaleLowerCase("tr-TR").includes(s) ||
      (p.stokAdi || "").toLocaleLowerCase("tr-TR").includes(s) ||
      (p.musteriKodu || "").toLocaleLowerCase("tr-TR").includes(s)
    ) : arr;
    // Kullanım sayısı desc — en çok teklif verilen üstte
    return filtered.sort((a, b) => (b.kullanimSayisi || 0) - (a.kullanimSayisi || 0));
  }, [data, search]);

  const totalUsage = parts.reduce((s, p) => s + (p.kullanimSayisi || 0), 0);

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, fontSize: 11, color: "#1e40af" }}>
        💡 <b>Parça Kütüphanesi</b> — arşivdeki her benzersiz stok kodu için otomatik oluşturulan "hafıza". Yeni teklif verirken sistem burayı sorgulayıp önceden yapılabilirlik onaylanmış parçalar için hızlı yol sunar. Müşteri parça kodu yeni tekliftte manuel eklenir → sonraki aramalar için hazır olur.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input
          type="text" placeholder="🔎 Stok kodu / müşteri kodu / parça adı"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 260, padding: "6px 10px", border: "1px solid #d6d3d1", borderRadius: 4, fontSize: 12 }}
        />
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging
        </label>
        <span style={{ fontSize: 11, color: "#78716c" }}>
          {parts.length} parça · {totalUsage} kullanım
        </span>
      </div>

      {parts.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e", border: "1px dashed #d6d3d1", borderRadius: 6 }}>
          Kütüphane boş. Excel arşivi yüklendikten sonra otomatik doldurulur.
        </div>
      ) : (
        <div style={{ border: "1px solid #e7e5e4", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f5f4", fontSize: 10, color: "#57534e", textAlign: "left" }}>
                <th style={th}>Stok Kodu</th>
                <th style={th}>Müş. Kodu</th>
                <th style={th}>Parça Adı</th>
                <th style={th}>Hammadde</th>
                <th style={th}>Makineler</th>
                <th style={th}>Fason</th>
                <th style={{ ...th, textAlign: "right" }}>Kullanım</th>
                <th style={th}>Son Teklif</th>
              </tr>
            </thead>
            <tbody>
              {parts.slice(0, 200).map(p => (
                <tr key={p.stokKodu} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 500 }}>{p.stokKodu}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", color: "#a8a29e" }}>{p.musteriKodu || "—"}</td>
                  <td style={td} title={p.stokAdi}>{(p.stokAdi || "").substring(0, 45)}{(p.stokAdi || "").length > 45 ? "…" : ""}</td>
                  <td style={{ ...td, fontSize: 10, color: "#57534e" }}>
                    {p.hammadde?.tur || "—"}
                    {p.hammadde?.ebat && <div style={{ color: "#a8a29e" }}>{p.hammadde.ebat}</div>}
                  </td>
                  <td style={{ ...td, fontSize: 10 }}>
                    {p.operasyonlar?.makineler || "—"}
                    {p.operasyonlar?.toplamSureDk > 0 && <div style={{ color: "#a8a29e" }}>{p.operasyonlar.toplamSureDk} dk</div>}
                  </td>
                  <td style={{ ...td, fontSize: 10 }}>
                    {p.fason?.isler || "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{p.kullanimSayisi || 0}</td>
                  <td style={{ ...td, fontSize: 10 }}>
                    {p.sonTeklifTarihi || "—"}
                    {p.sonMusteri && <div style={{ color: "#a8a29e" }}>{p.sonMusteri.substring(0, 24)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {parts.length > 200 && (
            <div style={{ padding: 10, textAlign: "center", fontSize: 11, color: "#78716c", background: "#f5f5f4" }}>
              İlk 200 parça gösteriliyor. Arama ile daralt.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Marj Editörü (admin) ====================

function MarginEditorView({ canEdit }) {
  const [staging, setStaging] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribeQuotePolicy((d) => {
      setPolicy(d);
      if (!draft) setDraft(d ? JSON.parse(JSON.stringify(d)) : null);
    }, { staging });
    return unsub;
  }, [staging]);

  if (!draft) return <div style={{ padding: 20, color: "#78716c" }}>Yükleniyor…</div>;

  const qm = draft.quantityMargins || [];
  const cgm = draft.customerGroupMargins || {};   // vade bazlı ilave marj (30/60/90 → GRUP1/2/3)
  const mlm = draft.materialLaborMargins || {};   // malzeme × vade

  const updateQuantity = (idx, field, value) => {
    setDraft(d => {
      const next = { ...d, quantityMargins: [...d.quantityMargins] };
      next.quantityMargins[idx] = { ...next.quantityMargins[idx], [field]: Number(value) };
      return next;
    });
  };
  const updateGroupMargin = (grp, value) => {
    setDraft(d => ({ ...d, customerGroupMargins: { ...d.customerGroupMargins, [grp]: Number(value) / 100 } }));
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true); setError("");
    try {
      await saveQuotePolicyUpdate(draft, { canEdit, staging });
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || "Kayıt hatası");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12, padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, fontSize: 11, color: "#92400e" }}>
        ⚠ <b>Uyarı:</b> Değişiklikler tüm yeni tekliflerdeki hesabı etkiler. Excel'deki mevcut değerler korunur, üstüne yazma değil ilave güncelleme. Yanlış giriş sonucu maliyet hataları doğurabilir — dikkat.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ fontSize: 11 }}>
          <input type="checkbox" checked={staging} onChange={e => setStaging(e.target.checked)} /> Staging'e yaz
        </label>
        <button onClick={handleSave} disabled={!canEdit || saving} style={btnPrimary}>
          {saving ? "Kaydediliyor..." : "💾 Kaydet"}
        </button>
        {savedAt && <span style={{ fontSize: 11, color: "#16a34a" }}>✓ {savedAt.toLocaleTimeString("tr-TR")}</span>}
        {error && <span style={{ fontSize: 11, color: "#dc2626" }}>⚠ {error}</span>}
      </div>

      <Card title="📊 Miktar Bazlı Marj Tablosu">
        <div style={{ fontSize: 11, color: "#78716c", marginBottom: 8 }}>
          Formül: <b>Satış = Maliyet × (1 + marj)</b>. Örn. 1 adet için işçilik marjı <b>6.0</b> → maliyetin <b>7 katı</b> (%600 ilave).
          Az adet → yüksek marj (aparat/setup tek parçaya yayılır).
        </div>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f5f5f4" }}>
              <th style={miniTh}>Aralık</th>
              <th style={miniThR}>İşçilik</th>
              <th style={miniThR}>Malz/Fason</th>
              <th style={miniTh}>Örnek: 100 TL maliyet ise</th>
            </tr>
          </thead>
          <tbody>
            {qm.map((b, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f5f5f4" }}>
                <td style={miniTd}>{b.min === b.max ? b.min : `${b.min}-${b.max}`}</td>
                <td style={miniTdR}>
                  <input type="number" step="0.01" value={b.laborPct}
                    onChange={e => updateQuantity(i, "laborPct", e.target.value)}
                    disabled={!canEdit}
                    style={{ width: 60, padding: "3px 6px", fontSize: 11, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 3 }} />
                </td>
                <td style={miniTdR}>
                  <input type="number" step="0.01" value={b.materialFasonPct}
                    onChange={e => updateQuantity(i, "materialFasonPct", e.target.value)}
                    disabled={!canEdit}
                    style={{ width: 60, padding: "3px 6px", fontSize: 11, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 3 }} />
                </td>
                <td style={{ ...miniTd, fontSize: 10, color: "#78716c" }}>
                  İşç: {(100 * (1 + b.laborPct)).toFixed(0)} TL · Malz: {(100 * (1 + b.materialFasonPct)).toFixed(0)} TL
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="📅 Vade Bazlı Hammadde İlave Marj">
        <div style={{ fontSize: 11, color: "#78716c", marginBottom: 8 }}>
          Vade uzadıkça hammadde maliyetine ilave marj (kur riski + tahsilat gecikmesi). Bu değerler yukarıdaki marjlara EKLENİR.
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {["GRUP1", "GRUP2", "GRUP3"].map((g, i) => {
            const label = ["30 gün", "60 gün", "90 gün"][i];
            const val = Math.round((cgm[g] || 0) * 1000) / 10;
            return (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 6, padding: 8, background: "#f5f5f4", borderRadius: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{label}:</span>
                <input type="number" step="0.5" min="0" max="100" value={val}
                  onChange={e => updateGroupMargin(g, e.target.value)}
                  disabled={!canEdit}
                  style={{ width: 60, padding: "4px 6px", fontSize: 12, textAlign: "right", border: "1px solid #d6d3d1", borderRadius: 3 }} />
                <span style={{ fontSize: 11 }}>%</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="🧪 Malzeme Türü × Vade Marj Matrisi (özel)">
        <div style={{ fontSize: 11, color: "#78716c", marginBottom: 8 }}>
          Bazı özel malzemelerde (KROM sac, ZIRH sacı vs) ekstra işçilik marjı uygulanır. Genelde 0 — sadece istisnalar dolu.
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
            <thead>
              <tr style={{ background: "#f5f5f4" }}>
                <th style={miniTh}>Malzeme</th>
                <th style={miniThR}>30 gün</th>
                <th style={miniThR}>60 gün</th>
                <th style={miniThR}>90 gün</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(mlm).filter(([_, v]) => v && (v.grup1 > 0 || v.grup2 > 0 || v.grup3 > 0)).map(([mat, v]) => (
                <tr key={mat} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={miniTd}>{mat}</td>
                  <td style={miniTdR}>{(v.grup1 * 100).toFixed(1)}%</td>
                  <td style={miniTdR}>{(v.grup2 * 100).toFixed(1)}%</td>
                  <td style={miniTdR}>{(v.grup3 * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {Object.entries(mlm).filter(([_, v]) => v && (v.grup1 > 0 || v.grup2 > 0 || v.grup3 > 0)).length === 0 && (
                <tr><td colSpan="4" style={{ padding: 20, textAlign: "center", color: "#a8a29e" }}>Özel marj tanımlı malzeme yok — tümü 0.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
