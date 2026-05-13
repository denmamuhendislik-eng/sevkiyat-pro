import { useState, useEffect, useMemo } from "react";
import MonthlyOverheadsTab from "./MonthlyOverheadsTab";
import MachineRatesTab from "./MachineRatesTab";
import UnitCostsTab from "./UnitCostsTab";
import FasonRatesTab from "./FasonRatesTab";
import ProductCostsTab from "./ProductCostsTab";
import InventoryTab from "./InventoryTab";
import SuppliesTab from "./SuppliesTab";
import MaliyetDashboard from "./MaliyetDashboard";
import { subscribeCurrencyRates } from "./firestore";
import { CURRENCIES, CURRENCY_SYMBOLS, CURRENCY_LABELS, getLatestRates, resolveActiveRates } from "./currency";

const TABS = [
  { id: "dashboard", icon: "📊", label: "Dashboard", phase: 4, active: true, note: "Envanter trendi, KPI'lar, aylık snapshot grafiği" },
  { id: "monthly", icon: "🗓", label: "Aylık Genel Giderler", phase: 2, active: true },
  { id: "supplies", icon: "🛢", label: "Stok Sarf Hareketleri", phase: 2, active: true, note: "Kesici takım, kesme yağı, PPE vs. — talaşlı imalat WC'lerine dağıtılır" },
  { id: "machineRates", icon: "⚙️", label: "Tezgah Dakika Ücretleri", phase: 2, active: true },
  { id: "unitCosts", icon: "🏷", label: "Birim Maliyetler", phase: 1, active: true },
  { id: "fasonRates", icon: "🔧", label: "Fason Ücretleri", phase: 3, active: true, note: "Geçici tablo — fason takip modülü gelene kadar" },
  { id: "productCosts", icon: "📦", label: "Mamul Maliyetleri", phase: 3, active: true },
  { id: "shipmentCosts", icon: "🚛", label: "Sevkiyat Maliyetleri", phase: 4, active: false, note: "Faz 4 — FIFO bazlı" },
  { id: "inventory", icon: "📚", label: "Envanter Değeri", phase: 4, active: true },
  { id: "profitability", icon: "💵", label: "Karlılık", phase: 5, active: false, note: "Faz 5 — satış vs maliyet" },
];

// Sekmenin döviz toggle'ından etkilenip etkilenmediği
const CURRENCY_AWARE = new Set(["dashboard", "machineRates", "productCosts", "inventory"]);

export default function Maliyet({ isAdmin, isUretim }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const canEdit = !!(isAdmin || isUretim);

  // Para birimi state — ortak (tüm sekmelerde aynı kur seçimi)
  const [currency, setCurrency] = useState("TRY");
  const [currencyRates, setCurrencyRates] = useState({});
  const [usdOverride, setUsdOverride] = useState("");
  const [eurOverride, setEurOverride] = useState("");

  useEffect(() => {
    const u = subscribeCurrencyRates(d => setCurrencyRates(d || {}));
    return u;
  }, []);

  const autoRates = useMemo(() => getLatestRates(currencyRates), [currencyRates]);
  const activeRates = useMemo(() => resolveActiveRates({ usd: usdOverride, eur: eurOverride }, autoRates), [usdOverride, eurOverride, autoRates]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)" }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 14 }}>Maliyet modülü yetkisi yok — sadece admin erişebilir</div>
      </div>
    );
  }

  const activeMeta = TABS.find(t => t.id === activeTab);
  const isCurrencyAware = CURRENCY_AWARE.has(activeTab);
  const currencyProps = { currency, rates: activeRates };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>💰 Maliyet</h2>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          Birim alış · Tezgah dakika ücreti · Mamul maliyeti · FIFO sevkiyat · Karlılık
        </span>

        {/* Para birimi toolbar (sağ kenara yaslanmış) */}
        <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "var(--color-background-secondary)", borderRadius: 6, fontSize: 11 }}>
          <span style={{ color: "var(--color-text-tertiary)" }}>Para birimi:</span>
          {CURRENCIES.map(c => {
            const active = currency === c;
            return (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: active ? 700 : 500,
                  border: "1px solid " + (active ? "var(--color-text-info)" : "var(--color-border-tertiary)"),
                  background: active ? "var(--color-text-info)" : "transparent",
                  color: active ? "white" : "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                {CURRENCY_SYMBOLS[c]} {CURRENCY_LABELS[c]}
              </button>
            );
          })}
          <span style={{ borderLeft: "1px solid var(--color-border-tertiary)", paddingLeft: 8, color: "var(--color-text-tertiary)", fontSize: 10 }}>
            Kur:
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10 }}>
            <span>$</span>
            <input
              type="number" step="0.01" min="0"
              value={usdOverride}
              onChange={e => setUsdOverride(e.target.value)}
              placeholder={autoRates?.usd > 0 ? autoRates.usd.toFixed(2) : "—"}
              title={`Manuel override; boş = TCMB ${autoRates?.date || "yok"}`}
              style={{ width: 60, padding: "2px 6px", borderRadius: 3, border: "1px solid " + (usdOverride ? "#C2410C" : "var(--color-border-tertiary)"), fontSize: 10 }}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10 }}>
            <span>€</span>
            <input
              type="number" step="0.01" min="0"
              value={eurOverride}
              onChange={e => setEurOverride(e.target.value)}
              placeholder={autoRates?.eur > 0 ? autoRates.eur.toFixed(2) : "—"}
              title={`Manuel override; boş = TCMB ${autoRates?.date || "yok"}`}
              style={{ width: 60, padding: "2px 6px", borderRadius: 3, border: "1px solid " + (eurOverride ? "#C2410C" : "var(--color-border-tertiary)"), fontSize: 10 }}
            />
          </label>
          {(usdOverride || eurOverride) && (
            <button
              onClick={() => { setUsdOverride(""); setEurOverride(""); }}
              title="Override'ları temizle"
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-text-tertiary)", padding: 0 }}
            >
              ✕
            </button>
          )}
          <span style={{ fontSize: 9, color: activeRates.isOverride ? "#C2410C" : "var(--color-text-tertiary)" }} title={activeRates.source}>
            {activeRates.isOverride ? "🖊 manuel" : (autoRates?.date ? `TCMB ${autoRates.date}` : "kur yok")}
          </span>
        </div>
      </div>

      {currency !== "TRY" && !isCurrencyAware && (
        <div style={{ padding: "6px 12px", marginBottom: 10, background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 6, fontSize: 11, color: "#92400E" }}>
          ℹ Bu sekme TL bazlı verilerle çalışır — döviz toggle sadece Mamul Maliyetleri / Envanter / Tezgah Dakika Ücretleri'nde etkilidir.
        </div>
      )}

      {/* Tab navigation */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", borderBottom: "1px solid var(--color-border-tertiary)", paddingBottom: 0 }}>
        {TABS.map(t => {
          const isActive = activeTab === t.id;
          const isDisabled = !t.active;
          return (
            <div
              key={t.id}
              onClick={() => !isDisabled && setActiveTab(t.id)}
              title={t.note || ""}
              style={{
                padding: "8px 14px",
                cursor: isDisabled ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isDisabled ? "var(--color-text-tertiary)" : isActive ? "var(--color-text-info)" : "var(--color-text-secondary)",
                borderBottom: isActive ? "2px solid var(--color-text-info)" : "2px solid transparent",
                marginBottom: -1,
                opacity: isDisabled ? 0.5 : 1,
                userSelect: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {isDisabled && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)" }}>Yakında</span>}
            </div>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "dashboard" && <MaliyetDashboard {...currencyProps} currencyRates={currencyRates} />}
      {activeTab === "monthly" && <MonthlyOverheadsTab canEdit={canEdit} isAdmin={isAdmin} />}
      {activeTab === "supplies" && <SuppliesTab canEdit={canEdit} isAdmin={isAdmin} />}
      {activeTab === "machineRates" && <MachineRatesTab canEdit={canEdit} {...currencyProps} />}
      {activeTab === "unitCosts" && <UnitCostsTab canEdit={canEdit} isAdmin={isAdmin} />}
      {activeTab === "fasonRates" && <FasonRatesTab canEdit={canEdit} isAdmin={isAdmin} />}
      {activeTab === "productCosts" && <ProductCostsTab canEdit={canEdit} isAdmin={isAdmin} {...currencyProps} />}
      {activeTab === "inventory" && <InventoryTab canEdit={canEdit} isAdmin={isAdmin} {...currencyProps} currencyRates={currencyRates} />}
      {activeMeta && !activeMeta.active && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>{activeMeta.icon}</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{activeMeta.label}</div>
          <div style={{ fontSize: 12 }}>{activeMeta.note || "Bu sekme yakında aktif olacak"}</div>
        </div>
      )}
    </div>
  );
}
