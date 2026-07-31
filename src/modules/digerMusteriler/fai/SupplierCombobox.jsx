// Tedarikçi combobox — serbest yazım + master'dan seçim.
// Kullanım: Form 2 tedarikçi hücresi, Malzeme master editörü, vb.
//
// Props:
//   value: string
//   onChange: (str) => void
//   suppliers: { [id]: {name, notes} }  (subscribeFaiSupplierMaster'dan)
//   disabled?: bool
//   placeholder?: string
//   style?: object   (input'a uygulanır)

import React, { useState, useRef, useEffect, useMemo } from "react";

export default function SupplierCombobox({ value, onChange, suppliers, disabled, placeholder, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const list = useMemo(() => {
    const arr = Object.values(suppliers || {}).filter(s => s?.name);
    const q = (query || value || "").trim().toLocaleLowerCase("tr-TR");
    const filtered = q
      ? arr.filter(s => s.name.toLocaleLowerCase("tr-TR").includes(q))
      : arr;
    return filtered.sort((a, b) => a.name.localeCompare(b.name, "tr-TR")).slice(0, 30);
  }, [suppliers, query, value]);

  // Kullanıcının yazdığı değer master'da var mı? (💾 rozet için)
  const isFromMaster = useMemo(() => {
    if (!value) return false;
    const v = value.trim().toLocaleLowerCase("tr-TR");
    return Object.values(suppliers || {}).some(s => (s.name || "").trim().toLocaleLowerCase("tr-TR") === v);
  }, [value, suppliers]);

  const pick = (s) => {
    onChange(s.name);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 3, width: "100%" }}>
        {isFromMaster && <span title="Tedarikçi master listesinde kayıtlı" style={{ fontSize: 10 }}>💾</span>}
        <input
          ref={inputRef}
          type="text"
          value={value || ""}
          onChange={e => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={placeholder || "Tedarikçi..."}
          style={{ flex: 1, padding: 3, fontSize: 10, border: "1px solid #d6d3d1", borderRadius: 2, ...style }}
        />
        <button type="button" onClick={() => { setOpen(o => !o); inputRef.current?.focus(); }} disabled={disabled}
          title="Master listeden seç"
          style={{ padding: "1px 5px", fontSize: 10, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 2, cursor: disabled ? "not-allowed" : "pointer" }}>
          📚
        </button>
      </div>
      {open && !disabled && list.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
          maxHeight: 200, overflow: "auto",
          background: "#fff", border: "1px solid #d6d3d1", borderRadius: 3,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", marginTop: 2,
        }}>
          {list.map((s, i) => (
            <button key={i} type="button" onClick={() => pick(s)}
              style={{ display: "block", width: "100%", padding: "5px 8px", border: "none", borderBottom: "1px solid #f5f5f4",
                background: "#fff", cursor: "pointer", textAlign: "left", fontSize: 11 }}
              onMouseEnter={e => e.currentTarget.style.background = "#f0fdf4"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
              <div style={{ fontWeight: 500, color: "#44403c" }}>{s.name}</div>
              {s.notes && <div style={{ fontSize: 9, color: "#78716c" }}>{s.notes}</div>}
            </button>
          ))}
        </div>
      )}
      {open && !disabled && list.length === 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
          padding: "6px 8px", fontSize: 10, color: "#78716c",
          background: "#fff", border: "1px solid #d6d3d1", borderRadius: 3,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", marginTop: 2,
        }}>
          {Object.keys(suppliers || {}).length === 0
            ? "Henüz tedarikçi master yok — Tedarikçi Master sekmesinden ekle."
            : "Aramaya uyan tedarikçi yok. Yazmaya devam et — serbest metin olarak kaydedilir."}
        </div>
      )}
    </div>
  );
}
