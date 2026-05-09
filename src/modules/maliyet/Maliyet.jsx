import { useState } from "react";
import MonthlyOverheadsTab from "./MonthlyOverheadsTab";

const TABS = [
  { id: "monthly", icon: "🗓", label: "Aylık Genel Giderler", phase: 2, active: true },
  { id: "machineRates", icon: "⚙️", label: "Tezgah Dakika Ücretleri", phase: 2, active: true },
  { id: "unitCosts", icon: "🏷", label: "Birim Maliyetler", phase: 1, active: false, note: "VIO satın alma raporu Pazartesi yüklenecek" },
  { id: "productCosts", icon: "📦", label: "Mamul Maliyetleri", phase: 3, active: false, note: "Faz 3 — birim + işçilik + fason" },
  { id: "shipmentCosts", icon: "🚛", label: "Sevkiyat Maliyetleri", phase: 4, active: false, note: "Faz 4 — FIFO bazlı" },
  { id: "inventory", icon: "📚", label: "Envanter Değeri", phase: 4, active: false, note: "Faz 4 — 3 aylık dönem" },
  { id: "profitability", icon: "💵", label: "Karlılık", phase: 5, active: false, note: "Faz 5 — satış vs maliyet" },
];

export default function Maliyet({ isAdmin, isUretim }) {
  const [activeTab, setActiveTab] = useState("monthly");
  const canEdit = !!(isAdmin || isUretim);

  if (!isAdmin && !isUretim) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)" }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 14 }}>Maliyet modülü yetkisi yok</div>
      </div>
    );
  }

  const activeMeta = TABS.find(t => t.id === activeTab);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>💰 Maliyet</h2>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          Birim alış · Tezgah dakika ücreti · Mamul maliyeti · FIFO sevkiyat · Karlılık
        </span>
      </div>

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
      {activeTab === "monthly" && <MonthlyOverheadsTab canEdit={canEdit} isAdmin={isAdmin} />}
      {activeTab === "machineRates" && <MachineRatesTab canEdit={canEdit} />}
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

function MachineRatesTab() {
  return (
    <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>⚙️</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Tezgah Dakika Ücretleri</div>
      <div style={{ fontSize: 12 }}>Aylık genel gider girişi sonrası dağıtım algoritması ile hesaplanacak</div>
    </div>
  );
}
