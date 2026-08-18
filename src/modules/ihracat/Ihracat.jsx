// İhracat Modülü — ana giriş noktası.
// VIO Import ekranına yeni bir sekme olarak eklenir. Sidebar öğesi yok.
// Görünürlük: admin + satış.
//
// İç sekmeler:
//   list    → sipariş listesi (kalıcı ana kullanım)
//   new     → yeni sipariş formu (manuel giriş)
//   import  → Excel import (Faz 3'te dolar)
//   recon   → mutabakat paneli (Faz 4'te dolar)

import React, { useState, useEffect } from "react";
import {
  subscribeExportSalesOrders, subscribeContainerAllocations, subscribeExportSettings,
  subscribeExportInvoices,
} from "./firestore";
import OrderList from "./OrderList";
import OrderForm from "./OrderForm";
import ImportPanel from "./ImportPanel";
import ReconciliationPanel from "./ReconciliationPanel";
import InvoiceSettingsPanel from "./InvoiceSettingsPanel";
import InvoiceList from "./InvoiceList";
import SummaryPanel from "./SummaryPanel";

export default function Ihracat({ canEdit, isAdmin, userEmail, products, remainingByPid, syncExportOrderToPlan, combRules, logPriceHistory }) {
  const [subTab, setSubTab] = useState("list");
  const [editingOrder, setEditingOrder] = useState(null); // düzenlemek için seçilen sipariş

  const [ordersData, setOrdersData] = useState({ orders: {} });
  const [allocationsData, setAllocationsData] = useState({ allocations: {} });
  const [settings, setSettings] = useState({});
  const [invoicesData, setInvoicesData] = useState({ invoices: {} });

  // v22: Motor sync flag — appData/exportSettings.motorSyncEnabled (default true)
  const motorSyncEnabled = settings?.motorSyncEnabled !== false;

  useEffect(() => {
    const u1 = subscribeExportSalesOrders(d => setOrdersData(d || { orders: {} }));
    const u2 = subscribeContainerAllocations(d => setAllocationsData(d || { allocations: {} }));
    const u3 = subscribeExportSettings(d => setSettings(d || {}));
    const u4 = subscribeExportInvoices(d => setInvoicesData(d || { invoices: {} }));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const openEditForm = (order) => {
    setEditingOrder(order);
    setSubTab("new");
  };
  const openNewForm = () => {
    setEditingOrder(null);
    setSubTab("new");
  };
  const closeForm = () => {
    setEditingOrder(null);
    setSubTab("list");
  };

  // Motor sync bağlantı objesi — modüle daha aşağıya prop olarak inecek
  const motorSync = { enabled: motorSyncEnabled, apply: syncExportOrderToPlan };

  return (
    <div>
      {!motorSyncEnabled && (
        <div style={{ padding: 8, marginBottom: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 4, fontSize: 11 }}>
          ⚠ <b>Motor Senkronizasyonu KAPALI</b> — ihracat siparişi değişiklikleri Sevkiyat Planı'na yansımıyor.
          {isAdmin && <span> Açmak için: Fatura Ayarları → 🔄 Motor Senkronizasyonu.</span>}
        </div>
      )}
      {/* Alt tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--color-border-tertiary)" }}>
        <TabBtn active={subTab === "list"} onClick={() => setSubTab("list")}>📋 Sipariş Listesi</TabBtn>
        <TabBtn active={subTab === "new"} onClick={openNewForm}>➕ {editingOrder ? "Düzenle" : "Yeni Sipariş"}</TabBtn>
        <TabBtn active={subTab === "import"} onClick={() => setSubTab("import")}>📥 Excel Import</TabBtn>
        <TabBtn active={subTab === "recon"} onClick={() => setSubTab("recon")}>🔍 Mutabakat</TabBtn>
        <TabBtn active={subTab === "invoices"} onClick={() => setSubTab("invoices")}>🧾 Faturalar</TabBtn>
        <TabBtn active={subTab === "summary"} onClick={() => setSubTab("summary")}>📊 Özet</TabBtn>
        {isAdmin && (
          <TabBtn active={subTab === "settings"} onClick={() => setSubTab("settings")}>⚙ Fatura Ayarları</TabBtn>
        )}
      </div>

      {subTab === "list" && (
        <OrderList
          ordersData={ordersData}
          allocationsData={allocationsData}
          settings={settings}
          products={products}
          canEdit={canEdit}
          userEmail={userEmail}
          onEdit={openEditForm}
          motorSync={motorSync}
          combRules={combRules || []}
        />
      )}
      {subTab === "new" && (
        <OrderForm
          editingOrder={editingOrder}
          settings={settings}
          products={products}
          canEdit={canEdit}
          userEmail={userEmail}
          onSaved={closeForm}
          onCancel={closeForm}
          motorSync={motorSync}
          combRules={combRules || []}
          ordersData={ordersData}
          logPriceHistory={logPriceHistory}
        />
      )}
      {subTab === "import" && (
        <ImportPanel
          ordersData={ordersData}
          allocationsData={allocationsData}
          settings={settings}
          products={products}
          canEdit={canEdit}
          userEmail={userEmail}
          remainingByPid={remainingByPid}
        />
      )}
      {subTab === "recon" && (
        <ReconciliationPanel
          ordersData={ordersData}
          allocationsData={allocationsData}
          products={products}
          remainingByPid={remainingByPid}
        />
      )}
      {subTab === "invoices" && (
        <InvoiceList
          canEdit={canEdit}
          userEmail={userEmail}
          products={products}
          ordersData={ordersData}
          allocationsData={allocationsData}
        />
      )}
      {subTab === "summary" && (
        <SummaryPanel invoicesData={invoicesData} ordersData={ordersData} allocationsData={allocationsData} />
      )}
      {subTab === "settings" && isAdmin && (
        <InvoiceSettingsPanel canEdit={canEdit} userEmail={userEmail} products={products} motorSyncEnabled={motorSyncEnabled} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "8px 14px", border: "none", background: "transparent",
        borderBottom: `2px solid ${active ? "#1e40af" : "transparent"}`,
        color: active ? "#1e40af" : "var(--color-text-secondary)",
        fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
        marginBottom: -1,
      }}>
      {children}
    </button>
  );
}
