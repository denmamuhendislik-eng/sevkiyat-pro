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
} from "./firestore";
import OrderList from "./OrderList";
import OrderForm from "./OrderForm";
import ImportPanel from "./ImportPanel";
import ReconciliationPanel from "./ReconciliationPanel";

export default function Ihracat({ canEdit, isAdmin, userEmail, products, remainingByPid }) {
  const [subTab, setSubTab] = useState("list");
  const [editingOrder, setEditingOrder] = useState(null); // düzenlemek için seçilen sipariş

  const [ordersData, setOrdersData] = useState({ orders: {} });
  const [allocationsData, setAllocationsData] = useState({ allocations: {} });
  const [settings, setSettings] = useState({});

  useEffect(() => {
    const u1 = subscribeExportSalesOrders(d => setOrdersData(d || { orders: {} }));
    const u2 = subscribeContainerAllocations(d => setAllocationsData(d || { allocations: {} }));
    const u3 = subscribeExportSettings(d => setSettings(d || {}));
    return () => { u1(); u2(); u3(); };
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

  return (
    <div>
      {/* Alt tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--color-border-tertiary)" }}>
        <TabBtn active={subTab === "list"} onClick={() => setSubTab("list")}>📋 Sipariş Listesi</TabBtn>
        <TabBtn active={subTab === "new"} onClick={openNewForm}>➕ {editingOrder ? "Düzenle" : "Yeni Sipariş"}</TabBtn>
        <TabBtn active={subTab === "import"} onClick={() => setSubTab("import")}>📥 Excel Import</TabBtn>
        <TabBtn active={subTab === "recon"} onClick={() => setSubTab("recon")}>🔍 Mutabakat</TabBtn>
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
        />
      )}
      {subTab === "import" && (
        <ImportPanel
          ordersData={ordersData}
          settings={settings}
          products={products}
          canEdit={canEdit}
          userEmail={userEmail}
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
