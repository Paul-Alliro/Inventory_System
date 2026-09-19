import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  PlusCircle,
  ArrowUpCircle,
  ArrowDownCircle,
  History,
  Image as ImageIcon,
  X,
  Boxes,
  Package,
  LayoutDashboard,
  AlertTriangle,
  Pencil,
  Trash2,
  Download,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  Legend,
} from "recharts";

const TOKENS = {
  bg: "#F5F4EF",
  surface: "#FFFFFF",
  surfaceAlt: "#EFEDE4",
  ink: "#1C2333",
  inkSoft: "#5B6270",
  border: "#E1DFD5",
  teal: "#0F766E",
  tealSoft: "#E4F1EF",
  amber: "#B45309",
  amberSoft: "#FCEEDA",
  red: "#B91C1C",
  redSoft: "#FBE7E5",
  green: "#15803D",
  greenSoft: "#E4F3E7",
};

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');";

// Points at the Express + MySQL backend in /backend. Change this if you deploy the API elsewhere.
const API_URL = "http://localhost:3001/api";

async function apiFetch(path, options) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function money(n) {
  return `₱${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function resizeImage(file, maxW = 480) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function stockStatus(qty, threshold = 5) {
  if (qty <= 0) return { key: "out", label: "Out of stock", color: TOKENS.red, bg: TOKENS.redSoft };
  if (qty <= threshold) return { key: "low", label: "Low stock", color: TOKENS.amber, bg: TOKENS.amberSoft };
  return { key: "ok", label: "In stock", color: TOKENS.green, bg: TOKENS.greenSoft };
}

function Barcode({ value = "" }) {
  const bars = useMemo(() => {
    const out = [];
    const seedStr = value || "000000";
    for (let i = 0; i < seedStr.length; i++) {
      out.push((seedStr.charCodeAt(i) % 5) + 1);
    }
    while (out.length < 18) {
      out.push(((out.length * 7 + seedStr.length * 5) % 5) + 1);
    }
    return out;
  }, [value]);

  const gap = 1;
  let x = 0;
  const height = 22;
  const totalWidth = bars.reduce((s, w) => s + w + gap, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px" }}>
      <svg width={Math.min(totalWidth, 90)} height={height} viewBox={`0 0 ${totalWidth} ${height}`} preserveAspectRatio="none">
        {bars.map((w, i) => {
          const rect = <rect key={i} x={x} y={0} width={w} height={height} fill={TOKENS.ink} />;
          x += w + gap;
          return rect;
        })}
      </svg>
      <span className="inv-mono" style={{ fontSize: "9px", color: TOKENS.inkSoft, letterSpacing: "0.02em" }}>
        {value || "—"}
      </span>
    </div>
  );
}

function downloadCSV(items) {
  const headers = ["Name", "SKU", "Condition", "Category", "Quantity", "Unit", "Reorder Threshold", "Status"];
  const rows = items.map((it) => {
    const status = stockStatus(it.quantity, it.threshold);
    return [
      it.name,
      it.sku || "",
      it.condition === "used" ? "Used" : "New",
      it.category || "",
      it.quantity,
      it.unit,
      it.threshold ?? 5,
      status.label,
    ];
  });
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InventorySystem() {
  const [items, setItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [detailItem, setDetailItem] = useState(null);
  const [actionType, setActionType] = useState(null); // 'stock_in' | 'stock_out'
  const [editItem, setEditItem] = useState(null); // item being edited, or {} for none
  const [loadError, setLoadError] = useState("");
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [itemsData, txData] = await Promise.all([
          apiFetch("/items"),
          apiFetch("/transactions"),
        ]);
        setItems(itemsData);
        setTransactions(txData);
      } catch (e) {
        setLoadError(
          "Could not reach the backend at " + API_URL + ". Make sure the MySQL + Express server is running (see backend/README.md)."
        );
      }
      loadedRef.current = true;
      setReady(true);
    })();
  }, []);

  const categories = useMemo(() => {
    const set = new Set(items.map((it) => it.category).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter((it) => {
      const matchesQ =
        !q ||
        it.name.toLowerCase().includes(q) ||
        (it.category || "").toLowerCase().includes(q) ||
        (it.sku || "").toLowerCase().includes(q);
      const matchesCat = categoryFilter === "all" || it.category === categoryFilter;
      return matchesQ && matchesCat;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === "quantity") return (a.quantity - b.quantity) * dir;
      if (sortKey === "status") {
        const order = { out: 0, low: 1, ok: 2 };
        return (order[stockStatus(a.quantity, a.threshold).key] - order[stockStatus(b.quantity, b.threshold).key]) * dir;
      }
      if (sortKey === "category") return (a.category || "").localeCompare(b.category || "") * dir;
      if (sortKey === "sku") return (a.sku || "").localeCompare(b.sku || "", undefined, { numeric: true }) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
    return list;
  }, [items, search, categoryFilter, sortKey, sortDir]);

  const totals = useMemo(() => {
    const totalItems = items.length;
    const totalUnits = items.reduce((s, it) => s + it.quantity, 0);
    const lowStock = items.filter((it) => it.quantity > 0 && it.quantity <= (it.threshold ?? 5));
    const outOfStock = items.filter((it) => it.quantity <= 0);
    return { totalItems, totalUnits, lowStock, outOfStock };
  }, [items]);

  async function addItem(newItemDraft) {
    try {
      const { item: newItem, transaction } = await apiFetch("/items", {
        method: "POST",
        body: JSON.stringify(newItemDraft),
      });
      setItems((prev) => [...prev, newItem]);
      setTransactions((prev) => [transaction, ...prev]);
      setView("items");
    } catch (e) {
      alert("Could not add item: " + e.message);
    }
  }

  async function applyAction({ item, type, qty, remarks }) {
    try {
      const { item: updatedItem, transaction } = await apiFetch("/transactions", {
        method: "POST",
        body: JSON.stringify({ itemId: item.id, type, qty, remarks }),
      });
      setItems((prev) => prev.map((it) => (it.id === updatedItem.id ? updatedItem : it)));
      setTransactions((prev) => [transaction, ...prev]);
      setActionType(null);
      setDetailItem(null);
    } catch (e) {
      alert("Could not record transaction: " + e.message);
    }
  }

  async function saveEditedItem(patch) {
    try {
      const updatedItem = await apiFetch(`/items/${patch.id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setItems((prev) => prev.map((it) => (it.id === updatedItem.id ? updatedItem : it)));
      setEditItem(null);
    } catch (e) {
      alert("Could not save changes: " + e.message);
    }
  }

  async function deleteItem(id) {
    try {
      await apiFetch(`/items/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== id));
      setTransactions((prev) => prev.filter((t) => t.itemId !== id));
      setEditItem(null);
      setDetailItem(null);
    } catch (e) {
      alert("Could not delete item: " + e.message);
    }
  }

  const itemHistory = (itemId) => transactions.filter((t) => t.itemId === itemId);

/* ---------------- Whole Web Frame---------------- */

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: TOKENS.bg,
        color: TOKENS.ink,
        position:"fixed",
        inset:0,
        display: "flex",
        overflow: "hidden",
      }}
    >
      <style>{`
        ${FONT_IMPORT}
        .inv-display { font-family: 'Space Grotesk', sans-serif; }
        .inv-mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .inv-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .inv-scroll::-webkit-scrollbar-thumb { background: ${TOKENS.border}; border-radius: 8px; }
        .inv-navbtn { transition: background .15s ease, color .15s ease; }
        .inv-row { transition: background .12s ease; }
        .inv-row:hover { background: ${TOKENS.surfaceAlt}; }
        .inv-btn { transition: filter .15s ease, transform .1s ease; }
        .inv-btn:hover { filter: brightness(0.94); }
        .inv-btn:active { transform: scale(0.98); }
        .inv-kpi { transition: box-shadow .15s ease, transform .15s ease; }
        .inv-kpi:hover { box-shadow: 0 4px 16px rgba(28,35,51,0.08); transform: translateY(-1px); }
        .inv-icon-btn { transition: background .12s ease; }
        .inv-icon-btn:hover { background: ${TOKENS.surfaceAlt}; }
        .inv-th { cursor: pointer; user-select: none; }
        .inv-th:hover { color: ${TOKENS.ink}; }
        input, select { outline: none; }
        input:focus, select:focus { box-shadow: 0 0 0 3px ${TOKENS.tealSoft}; border-color: ${TOKENS.teal} !important; }
        .inv-table { width: 100%; table-layout: fixed; }
        .inv-barcode-cell { min-width: 145px; }
        .inv-barcode svg { width: 130px !important; height: 30px !important; }
        .inv-alert-list { max-height: 220px; overflow-y: auto; padding-right: 4px; }
        .inv-alert-list::-webkit-scrollbar { width: 6px; }
        .inv-alert-list::-webkit-scrollbar-thumb { background: ${TOKENS.border}; border-radius: 8px; }
        .inv-add-form { width: 100%; }
        .inv-edit-modal { width: min(760px, calc(100vw - 32px)); max-width: 760px; overflow: hidden; }
        .inv-edit-layout { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 20px; }
        .inv-edit-fields { min-width: 0; }
        .inv-log-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 900px) {
          .inv-table { min-width: 760px; }
          .inv-items-scroll { overflow-x: auto !important; }
        }
        @media (max-width: 640px) {
          .inv-edit-modal { width: calc(100vw - 20px); padding: 16px !important; }
          .inv-edit-layout { grid-template-columns: 1fr; }
          .inv-edit-image { display: flex; justify-content: center; }
          .inv-edit-fields > div { width: 100%; }
          .inv-log-filter { width: 100%; }
          .inv-log-filter input { flex: 1; min-width: 120px; }
        }

      `}</style>
     
      {/* Sidebar */}
      <div
        style={{
        width: "220px",
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,

        background: TOKENS.ink,
        color: "#F5F4EF",

        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",

        overflowY: "auto",
        boxSizing: "border-box",
         zIndex: 100,
      }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "28px", paddingLeft: "8px" }}>
          <Boxes size={22} color={TOKENS.tealSoft} />
          <span className="inv-display" style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            Stockroom
          </span>
        </div>

        {[
          { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
          { key: "items", label: "Items", icon: Package },
          { key: "add", label: "Add Item", icon: PlusCircle },
          { key: "log", label: "Transaction Log", icon: History },
        ].map((nav) => {
          const Icon = nav.icon;
          const active = view === nav.key;
          return (
            <button
              key={nav.key}
              onClick={() => {
                setView(nav.key);
                setDetailItem(null);
              }}
              className="inv-navbtn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "13.5px",
                fontWeight: 600,
                background: active ? TOKENS.teal : "transparent",
                color: active ? "#fff" : "#C7CBD6",
              }}
            >
              <Icon size={16} />
              {nav.label}
            </button>
          );
        })}

        <div style={{ marginTop: "auto", paddingTop: "20px", borderTop: "1px solid #333A4C" }}>
          <div className="inv-mono" style={{ fontSize: "11px", color: "#8890A0", lineHeight: 1.6 }}>
            <div>{totals.totalItems} item(s)</div>
            <div>{totals.totalUnits} total units</div>
            {totals.lowStock.length > 0 && <div style={{ color: TOKENS.amber }}>{totals.lowStock.length} low stock</div>}
            {totals.outOfStock.length > 0 && <div style={{ color: "#F87171" }}>{totals.outOfStock.length} out of stock</div>}
          </div>
        </div>
      </div>

      {/* Main */}
      <div 
        style={{
          marginLeft: "220px", // same width as the fixed sidebar
          flex: 1,
          height: "100vh",

          display: "flex",
          flexDirection: "column",

          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
       >
        {!ready ? (
          <div style={{ padding: "40px", color: TOKENS.inkSoft }}>Loading...</div>
        ) : loadError ? (
          <div style={{ padding: "40px", color: TOKENS.red, maxWidth: "480px" }}>
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>Backend unreachable</div>
            <div style={{ fontSize: "13px", lineHeight: 1.6 }}>{loadError}</div>
          </div>
        ) : view === "dashboard" ? (
          <DashboardView
            items={items}
            transactions={transactions}
            totals={totals}
            onGoToItems={() => setView("items")}
            onSelectItem={(it) => {
              setView("items");
              setDetailItem(it);
            }}
          />
        ) : view === "items" ? (
          <ItemsView
            items={filteredItems}
            allCount={items.length}
            search={search}
            setSearch={setSearch}
            categories={categories}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key) => {
              if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              else {
                setSortKey(key);
                setSortDir("asc");
              }
            }}
            onSelect={setDetailItem}
            onEdit={setEditItem}
            onExport={() => downloadCSV(filteredItems)}
          />
        ) : view === "add" ? (
          <AddItemView onAdd={addItem} />
        ) : (
          <LogView transactions={transactions} />
        )}
      </div>

      {detailItem && (
        <ItemDetailModal
          item={items.find((it) => it.id === detailItem.id) || detailItem}
          history={itemHistory(detailItem.id)}
          onClose={() => {
            setDetailItem(null);
            setActionType(null);
          }}
          actionType={actionType}
          setActionType={setActionType}
          onAction={applyAction}
          onEdit={(it) => {
            setDetailItem(null);
            setActionType(null);
            setEditItem(it);
          }}
        />
      )}

      {editItem && (
        <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSave={saveEditedItem} onDelete={deleteItem} />
      )}
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

function DashboardView({ items, transactions, totals, onGoToItems, onSelectItem }) {
  const kpis = [
    { label: "Total items", value: totals.totalItems, color: TOKENS.ink },
    { label: "Total units", value: totals.totalUnits, color: TOKENS.teal },
    { label: "Low stock", value: totals.lowStock.length, color: TOKENS.amber },
    { label: "Out of stock", value: totals.outOfStock.length, color: TOKENS.red },
  ];

  const recentTx = transactions.slice(0, 6);
  const alerts = [...totals.outOfStock, ...totals.lowStock].slice(0, 6);

  const typeMeta = {
    stock_in: { label: "Stock in", color: TOKENS.green, bg: TOKENS.greenSoft, icon: ArrowUpCircle },
    stock_out: { label: "Stock out", color: TOKENS.amber, bg: TOKENS.amberSoft, icon: ArrowDownCircle },
  };

  const categoryData = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      const cat = it.category || "Uncategorized";
      map[cat] = (map[cat] || 0) + it.quantity;
    });
    return Object.entries(map)
      .map(([name, units]) => ({ name, units }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 8);
  }, [items]);

  const trendData = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push(d.getTime());
    }
    const buckets = days.map((ts) => ({ ts, day: fmtDay(ts), in: 0, out: 0 }));
    transactions.forEach((t) => {
      if (!t.ts) return;
      const d = new Date(t.ts);
      d.setHours(0, 0, 0, 0);
      const idx = buckets.findIndex((b) => b.ts === d.getTime());
      if (idx === -1) return;
      if (t.type === "stock_in") buckets[idx].in += t.qty;
      else buckets[idx].out += t.qty;
    });
    return buckets;
  }, [transactions]);

  return (
    <div className="inv-scroll" style={{ padding: "24px", overflowY: "auto", flex: 1, minHeight: 0 }}>
      <h2 className="inv-display" style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 18px" }}>
        Dashboard
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        {kpis.map((k) => (
          <div
            key={k.label}
            className="inv-kpi"
            style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, borderRadius: "12px", padding: "16px" }}
          >
            <div style={{ fontSize: "11px", fontWeight: 600, color: TOKENS.inkSoft, marginBottom: "6px" }}>{k.label}</div>
            <div className="inv-mono" style={{ fontSize: "22px", fontWeight: 600, color: k.color }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, borderRadius: "12px", padding: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px" }}>Stock movement (last 14 days)</div>
          {trendData.some((d) => d.in || d.out) ? (
            <div style={{ height: "200px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={TOKENS.border} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: TOKENS.inkSoft }} axisLine={{ stroke: TOKENS.border }} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10, fill: TOKENS.inkSoft }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: `1px solid ${TOKENS.border}` }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Line type="monotone" dataKey="in" name="Stock in" stroke={TOKENS.green} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="out" name="Stock out" stroke={TOKENS.amber} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ fontSize: "12.5px", color: TOKENS.inkSoft, padding: "40px 0", textAlign: "center" }}>No activity in this period.</div>
          )}
        </div>

        <div style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, borderRadius: "12px", padding: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px" }}>Units by category</div>
          {categoryData.length > 0 ? (
            <div style={{ height: "200px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={TOKENS.border} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: TOKENS.inkSoft }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10, fill: TOKENS.inkSoft }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: `1px solid ${TOKENS.border}` }} />
                  <Bar dataKey="units" fill={TOKENS.teal} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ fontSize: "12.5px", color: TOKENS.inkSoft, padding: "40px 0", textAlign: "center" }}>No items yet.</div>
          )}
        </div>
      </div>

      {/* ----------- STOCK ALERTS --------------- */}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "16px" }}>
              <div style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, borderRadius: "12px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
                  <AlertTriangle size={15} color={TOKENS.amber} />
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>Stock alerts</span>
                </div>
                {alerts.length === 0 ? (
                  <div style={{ fontSize: "12.5px", color: TOKENS.inkSoft }}>Everything is well stocked.</div>
                ) : (
                  <div
                    className="inv-scroll"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      maxHeight: "190px",
                      overflowY: "auto",
                      paddingRight: "4px",
                    }}
                  >
                    {alerts.map((it) => {
                      const status = stockStatus(it.quantity, it.threshold);
                      return (
                        <button
                          key={it.id}
                          onClick={() => onSelectItem(it)}
                          className="inv-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 8px",
                            borderRadius: "8px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ fontSize: "12.5px", fontWeight: 600 }}>{it.name}</span>
                          <span
                            className="inv-mono"
                            style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", color: status.color, background: status.bg }}
                          >
                            {it.quantity} {it.unit}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={onGoToItems}
                  className="inv-btn"
                  style={{ marginTop: "12px", fontSize: "12px", fontWeight: 600, color: TOKENS.teal, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  View all items →
                </button>
              </div>
      
             {/* ------------------ RECENT_ACTIVITY--------------------- */}
      
              <div style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, borderRadius: "12px", padding: "16px"}}>
                <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>Recent activity</div>
                {recentTx.length === 0 ? (
                  <div style={{ fontSize: "12.5px", color: TOKENS.inkSoft }}>No transactions yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {recentTx.map((t) => {
                      const m = typeMeta[t.type] || typeMeta.stock_out;
                      const Icon = m.icon;
                      return (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: m.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Icon size={13} color={m.color} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.itemName}
                            </div>
                            <div style={{ fontSize: "10.5px", color: TOKENS.inkSoft }}>{fmtDate(t.ts)}</div>
                          </div>
                          <div className="inv-mono" style={{ fontSize: "12px", fontWeight: 600, color: m.color, flexShrink: 0 }}>
                            {t.type === "stock_in" ? "+" : "-"}
                            {t.qty}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
    </div>
  );
}

/* ---------------- Items table ---------------- */

function SortIcon({ active, dir }) {
  if (!active) return <ArrowUpDown size={11} style={{ opacity: 0.4 }} />;
  return dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
}

function ItemsView({
  items,
  allCount,
  search,
  setSearch,
  categories,
  categoryFilter,
  setCategoryFilter,
  sortKey,
  sortDir,
  onSort,
  onSelect,
  onEdit,
  onExport,
}) {
  const colsBeforeBarcode = [{ key: "name", label: "Item" }];
  const colsAfterBarcode = [
    { key: "category", label: "Category" },
    { key: "quantity", label: "Quantity" },
    { key: "status", label: "Status" },
  ];
  const renderSortTh = (c) => (
    <th
      key={c.key}
      className="inv-th"
      onClick={() => onSort(c.key)}
      style={{
        textAlign: c.key === "quantity" ? "right" : "left",
        fontSize: "11px",
        fontWeight: 700,
        color: TOKENS.inkSoft,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        padding: "0 10px 10px",
        borderBottom: `1px solid ${TOKENS.border}`,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexDirection: c.key === "quantity" ? "row-reverse" : "row" }}>
        {c.label}
        <SortIcon active={sortKey === c.key} dir={sortDir} />
      </span>
    </th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${TOKENS.border}`, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", flexShrink: 0 }}>
        <h2 className="inv-display" style={{ fontSize: "18px", fontWeight: 700, margin: 0, flexShrink: 0 }}>
          Items
        </h2>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: "8px", border: `1px solid ${TOKENS.border}`, fontSize: "12.5px", background: TOKENS.surface, marginLeft: "8px" }}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div style={{ position: "relative", flex: 1, maxWidth: "300px", marginLeft: "auto" }}>
          <Search size={15} color={TOKENS.inkSoft} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, category, or SKU..."
            style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: "8px", border: `1px solid ${TOKENS.border}`, fontSize: "13px", background: TOKENS.surface, boxSizing: "border-box" }}
          />
        </div>

        <button
          onClick={onExport}
          className="inv-btn"
          disabled={items.length === 0}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 12px",
            borderRadius: "8px",
            border: `1px solid ${TOKENS.border}`,
            background: TOKENS.surface,
            fontSize: "12.5px",
            fontWeight: 600,
            cursor: items.length === 0 ? "not-allowed" : "pointer",
            opacity: items.length === 0 ? 0.5 : 1,
          }}
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      <div className="inv-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 24px 24px" }}>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: TOKENS.inkSoft }}>
            <Package size={32} style={{ opacity: 0.4, marginBottom: "10px" }} />
            <div style={{ fontSize: "14px" }}>{allCount > 0 ? "No items match your filters." : "No items yet. Add one from the 'Add Item' tab."}</div>
          </div>
        ) : (
          <table className="inv-table" style={{ borderCollapse: "collapse", marginTop: "16px" }}>
            <thead>
              <tr>
                <th style={{ width: "48px", borderBottom: `1px solid ${TOKENS.border}` }}></th>
                {colsBeforeBarcode.map(renderSortTh)}
                <th
                  className="inv-th inv-barcode-cell"
                  onClick={() => onSort("sku")}
                  style={{ textAlign: "left", fontSize: "11px", fontWeight: 700, color: TOKENS.inkSoft, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 10px 10px", borderBottom: `1px solid ${TOKENS.border}` }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    Barcode <SortIcon active={sortKey === "sku"} dir={sortDir} />
                  </span>
                </th>
                {colsAfterBarcode.map(renderSortTh)}
                <th style={{ borderBottom: `1px solid ${TOKENS.border}` }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const status = stockStatus(it.quantity, it.threshold);
                return (
                  <tr key={it.id} className="inv-row" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
                    <td style={{ padding: "10px", cursor: "pointer" }} onClick={() => onSelect(it)}>
                      <div style={{ width: "38px", height: "38px", borderRadius: "7px", background: it.image ? `url(${it.image}) center/cover` : TOKENS.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {!it.image && <ImageIcon size={14} color={TOKENS.inkSoft} style={{ opacity: 0.5 }} />}
                      </div>
                    </td>
                    <td style={{ padding: "10px", cursor: "pointer" }} onClick={() => onSelect(it)}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600 }}>{it.name}</span>
                        <span
                          style={{
                            fontSize: "9.5px",
                            fontWeight: 700,
                            padding: "1.5px 6px",
                            borderRadius: "999px",
                            color: it.condition === "used" ? TOKENS.amber : TOKENS.teal,
                            background: it.condition === "used" ? TOKENS.amberSoft : TOKENS.tealSoft,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {it.condition === "used" ? "Used" : "New"}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "10px", cursor: "pointer" }} onClick={() => onSelect(it)}>
                      <Barcode value={it.sku} />
                    </td>
                    <td style={{ padding: "10px", fontSize: "12.5px", color: TOKENS.inkSoft, cursor: "pointer" }} onClick={() => onSelect(it)}>
                      {it.category || "—"}
                    </td>
                    <td className="inv-mono" style={{ padding: "10px", fontSize: "13px", textAlign: "right", cursor: "pointer" }} onClick={() => onSelect(it)}>
                      {it.quantity} <span style={{ fontSize: "11px", color: TOKENS.inkSoft, fontFamily: "'Inter', sans-serif" }}>{it.unit}</span>
                    </td>
                    <td style={{ padding: "10px", cursor: "pointer" }} onClick={() => onSelect(it)}>
                      <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "3px 9px", borderRadius: "999px", color: status.color, background: status.bg, whiteSpace: "nowrap" }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={{ padding: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "2px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(it);
                          }}
                          className="inv-icon-btn"
                          title="Edit item"
                          style={{ width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Pencil size={14} color={TOKENS.inkSoft} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------------- Add Item ---------------- */

function AddItemView({ onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("new");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [threshold, setThreshold] = useState("5");
  const [image, setImage] = useState(null);
  const [err, setErr] = useState("");

  async function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setImage(await resizeImage(file));
    } catch {
      setErr("Could not load that picture.");
    }
  }

  function submit() {
    if (!name.trim()) return setErr("Item name is required.");
    const q = Number(quantity);
    if (quantity === "" || isNaN(q) || q < 0) return setErr("Enter a valid starting quantity.");
    setErr("");
    onAdd({
      id: uid("item"),
      name: name.trim(),
      category: category.trim(),
      condition,
      quantity: q,
      unit: unit.trim() || "pcs",
      threshold: threshold === "" ? 5 : Number(threshold),
      image,
      ts: Date.now(),
    });
  }

  return (
    <div className="inv-scroll" style={{ padding: "24px", overflowY: "auto", flex: 1, minHeight: 0 }}>
      <h2 className="inv-display" style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 18px" }}>
        Add Item
      </h2>

      <div className="inv-add-form" style={{ display: "flex", gap: "24px" }}>
        <div style={{ flexShrink: 0 }}>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "150px",
              height: "150px",
              borderRadius: "10px",
              border: `1.5px dashed ${TOKENS.border}`,
              background: image ? `url(${image}) center/cover` : TOKENS.surface,
              cursor: "pointer",
              gap: "6px",
            }}
          >
            {!image && (
              <>
                <ImageIcon size={22} color={TOKENS.inkSoft} />
                <span style={{ fontSize: "11px", color: TOKENS.inkSoft, textAlign: "center", padding: "0 10px" }}>Upload a picture</span>
              </>
            )}
            <input type="file" accept="image/*" onChange={handleImage} style={{ display: "none" }} />
          </label>
          {image && (
            <button onClick={() => setImage(null)} style={{ marginTop: "6px", fontSize: "11px", color: TOKENS.red, background: "none", border: "none", cursor: "pointer" }}>
              Remove picture
            </button>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
          <Field label="Item name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ballpen, 12mm Plywood" style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: "12px" }}>
            <Field label="Category" style={{ flex: 1 }}>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" style={inputStyle} />
            </Field>
            <Field label="Condition" style={{ flex: 1 }}>
              <select value={condition} onChange={(e) => setCondition(e.target.value)} style={inputStyle}>
                <option value="new">New</option>
                <option value="used">Used / Old</option>
              </select>
            </Field>
          </div>
          <div style={{ fontSize: "11px", color: TOKENS.inkSoft }}>SKU / barcode is assigned automatically once you add this item.</div>
          <div style={{ display: "flex", gap: "12px" }}>
            <Field label="Starting quantity" style={{ flex: 1 }}>
              <input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label="Unit" style={{ flex: 1 }}>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, box, kg..." style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <Field label="Low-stock threshold" style={{ flex: 1 }}>
              <input type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="5" style={inputStyle} />
            </Field>
            <div style={{ flex: 1 }} />
          </div>

          {err && <div style={{ fontSize: "12.5px", color: TOKENS.red }}>{err}</div>}

          <button
            onClick={submit}
            className="inv-btn"
            style={{ marginTop: "6px", width: "fit-content", minWidth: "180px", alignSelf: "center", justifyContent: "center", padding: "10px 20px", borderRadius: "8px", border: "none", background: TOKENS.teal, color: "#fff", fontWeight: 600, fontSize: "13.5px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }} >
            <PlusCircle size={15} /> Add to Inventory
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px", ...style }}>
      <label style={{ fontSize: "11.5px", fontWeight: 600, color: TOKENS.inkSoft }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "8px 10px",
  borderRadius: "7px",
  border: `1px solid ${TOKENS.border}`,
  fontSize: "13px",
  boxSizing: "border-box",
  fontFamily: "'Inter', sans-serif",
};

/* ---------------- Transaction log ---------------- */

function LogView({ transactions }) {
  const typeMeta = {
    stock_in: { label: "Stock In", color: TOKENS.green, bg: TOKENS.greenSoft, icon: ArrowUpCircle },
    stock_out: { label: "Stock Out", color: TOKENS.amber, bg: TOKENS.amberSoft, icon: ArrowDownCircle },
  };
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
    return transactions.filter((t) => t.ts >= from && t.ts <= to);
  }, [transactions, fromDate, toDate]);

  useEffect(() => setPage(1), [fromDate, toDate]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="inv-scroll" style={{ padding: "24px", overflowY: "auto", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap", marginBottom: "18px" }}>
        <h2 className="inv-display" style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
          Transaction Log
        </h2>
        <div className="inv-log-filter">
          <label style={{ fontSize: "11.5px", color: TOKENS.inkSoft, fontWeight: 600 }}>From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, background: TOKENS.surface }} />
          <label style={{ fontSize: "11.5px", color: TOKENS.inkSoft, fontWeight: 600 }}>To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, background: TOKENS.surface }} />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(""); setToDate(""); }} style={{ ...inputStyle, cursor: "pointer", background: TOKENS.surface }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: TOKENS.inkSoft, fontSize: "13.5px" }}>
          {transactions.length ? "No transactions match the selected date range." : "No transactions yet."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            {pageItems.map((t) => {
              const m = typeMeta[t.type] || typeMeta.stock_out;
              const Icon = m.icon;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "10px", border: `1px solid ${TOKENS.border}`, background: TOKENS.surface }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: m.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={16} color={m.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{t.itemName}</div>
                    <div style={{ fontSize: "11.5px", color: TOKENS.inkSoft }}>
                      {m.label}{t.remarks ? ` · ${t.remarks}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="inv-mono" style={{ fontSize: "13px", fontWeight: 600, color: m.color }}>
                      {t.type === "stock_in" ? "+" : "-"}{t.qty}
                    </div>
                    <div style={{ fontSize: "10.5px", color: TOKENS.inkSoft }}>{fmtDate(t.ts)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "16px", paddingTop: "14px", borderTop: `1px solid ${TOKENS.border}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: "11.5px", color: TOKENS.inkSoft }}>
              Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ ...inputStyle, cursor: currentPage === 1 ? "not-allowed" : "pointer", opacity: currentPage === 1 ? 0.45 : 1, background: TOKENS.surface }}>
                ← Previous
              </button>
              <span className="inv-mono" style={{ fontSize: "12px", padding: "0 6px" }}>{currentPage} / {pageCount}</span>
              <button disabled={currentPage === pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} style={{ ...inputStyle, cursor: currentPage === pageCount ? "not-allowed" : "pointer", opacity: currentPage === pageCount ? 0.45 : 1, background: TOKENS.surface }}>
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Item detail / action modal ---------------- */

function ItemDetailModal({ item, history, onClose, actionType, setActionType, onAction, onEdit }) {
  const status = stockStatus(item.quantity, item.threshold);
  const [qty, setQty] = useState("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    setQty("");
    setRemarks("");
    setErr("");
  }, [actionType]);

  function submitAction() {
    const q = Number(qty);
    if (qty === "" || isNaN(q) || q <= 0) return setErr("Enter a valid quantity.");
    if (actionType === "stock_out" && q > item.quantity) return setErr("That's more than the available stock.");
    if (actionType === "stock_out" && !remarks.trim()) return setErr("Enter a reason for this deduction.");
    setErr("");
    onAction({
      item,
      type: actionType,
      qty: q,
      remarks,
    });
  }

  const actionMeta = {
    stock_in: { title: "Add Stock", color: TOKENS.green, icon: ArrowUpCircle, qtyLabel: "Quantity received" },
    stock_out: { title: "Deduct Stock", color: TOKENS.amber, icon: ArrowDownCircle, qtyLabel: "Quantity to deduct" },
  };


  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,35,51,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} className="inv-scroll" style={{ background: TOKENS.bg, borderRadius: "14px", width: "480px", maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", fontFamily: "'Inter', sans-serif" }}>
        <div style={{ position: "relative" }}>
          <div style={{ height: "150px", background: item.image ? `url(${item.image}) center/cover` : TOKENS.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center", borderTopLeftRadius: "14px", borderTopRightRadius: "14px" }}>
            {!item.image && <ImageIcon size={28} color={TOKENS.inkSoft} style={{ opacity: 0.5 }} />}
          </div>
          <button onClick={onClose} style={{ position: "absolute", top: "10px", right: "10px", width: "28px", height: "28px", borderRadius: "50%", border: "none", background: "rgba(28,35,51,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={15} />
          </button>
          <button onClick={() => onEdit(item)} style={{ position: "absolute", top: "10px", right: "48px", width: "28px", height: "28px", borderRadius: "50%", border: "none", background: "rgba(28,35,51,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Edit item details">
            <Pencil size={13} />
          </button>
        </div>

        <div style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
            <div>
              <h3 className="inv-display" style={{ fontSize: "17px", fontWeight: 700, margin: 0 }}>{item.name}</h3>
              <div style={{ fontSize: "12px", color: TOKENS.inkSoft, marginTop: "3px" }}>
                {[item.category, item.sku].filter(Boolean).join(" · ") || "No category"}
                {" · "}
                <span style={{ color: item.condition === "used" ? TOKENS.amber : TOKENS.teal, fontWeight: 600 }}>
                  {item.condition === "used" ? "Used / Old" : "New"}
                </span>
              </div>
            </div>
            <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", color: status.color, background: status.bg, flexShrink: 0 }}>{status.label}</span>
          </div>

          <div className="inv-mono" style={{ fontSize: "30px", fontWeight: 600, margin: "14px 0 2px" }}>
            {item.quantity} <span style={{ fontSize: "13px", color: TOKENS.inkSoft, fontFamily: "'Inter', sans-serif" }}>{item.unit} available</span>
          </div>

          {!actionType ? (
            <>
              <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
                <ActionButton icon={ArrowUpCircle} label="Add Stock" color={TOKENS.green} bg={TOKENS.greenSoft} onClick={() => setActionType("stock_in")} />
                <ActionButton icon={ArrowDownCircle} label="Deduct Stock" color={TOKENS.amber} bg={TOKENS.amberSoft} onClick={() => setActionType("stock_out")} disabled={item.quantity <= 0} />
              </div>

              <div style={{ marginTop: "20px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: TOKENS.inkSoft, marginBottom: "8px" }}>Item history</div>
                {history.length === 0 ? (
                  <div style={{ fontSize: "12.5px", color: TOKENS.inkSoft }}>No records yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {history.slice(0, 6).map((t) => (
                      <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: TOKENS.inkSoft }}>
                        <span>
                          {t.type === "stock_in" ? "+" : "-"}
                          {t.qty} {t.remarks ? `(${t.remarks})` : ""}
                        </span>
                        <span>{fmtDate(t.ts)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ marginTop: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {React.createElement(actionMeta[actionType].icon, { size: 16, color: actionMeta[actionType].color })}
                <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{actionMeta[actionType].title}</span>
              </div>

              <Field label={actionMeta[actionType].qtyLabel}>
                <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" style={inputStyle} />
              </Field>

              <Field label={actionType === "stock_in" ? "Remarks (optional)" : "Remarks / reason for deduction"}>
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={actionType === "stock_in" ? "e.g. new supply from vendor" : "e.g. transferred to Juan Dela Cruz, damaged, used up, lost"}
                  style={inputStyle}
                />
              </Field>

              {err && <div style={{ fontSize: "12.5px", color: TOKENS.red }}>{err}</div>}

              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <button onClick={() => setActionType(null)} className="inv-btn" style={{ padding: "9px 16px", borderRadius: "8px", border: `1px solid ${TOKENS.border}`, background: TOKENS.surface, fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                  Back
                </button>
                <button onClick={submitAction} className="inv-btn" style={{ padding: "9px 16px", borderRadius: "8px", border: "none", background: actionMeta[actionType].color, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                  Confirm
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, color, bg, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inv-btn"
      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", padding: "10px 6px", borderRadius: "10px", border: "none", background: disabled ? TOKENS.surfaceAlt : bg, color: disabled ? TOKENS.inkSoft : color, fontSize: "11.5px", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}
    >
      <Icon size={17} />
      {label}
    </button>
  );
}

/* ---------------- Edit item modal ---------------- */

function EditItemModal({ item, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category || "");
  const [condition, setCondition] = useState(item.condition || "new");
  const [unit, setUnit] = useState(item.unit);
  const [threshold, setThreshold] = useState(item.threshold ?? 5);
  const [image, setImage] = useState(item.image || null);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setImage(await resizeImage(file));
    } catch {
      setErr("Could not load that picture.");
    }
  }

  function submit() {
    if (!name.trim()) return setErr("Item name is required.");
    setErr("");
    onSave({
      id: item.id,
      name: name.trim(),
      category: category.trim(),
      condition,
      unit: unit.trim() || "pcs",
      threshold: threshold === "" ? 5 : Number(threshold),
      image,
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,35,51,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} className="inv-edit-modal" style={{ background: TOKENS.bg, borderRadius: "14px", fontFamily: "'Inter', sans-serif", padding: "22px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h3 className="inv-display" style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Edit Item</h3>
          <button onClick={onClose} style={{ width: "26px", height: "26px", borderRadius: "50%", border: "none", background: TOKENS.surfaceAlt, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={14} />
          </button>
        </div>

        <div className="inv-edit-layout">
          <div style={{ flexShrink: 0 }}>
            <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "130px", height: "130px", borderRadius: "10px", border: `1.5px dashed ${TOKENS.border}`, background: image ? `url(${image}) center/cover` : TOKENS.surface, cursor: "pointer", gap: "6px" }}>
              {!image && (
                <>
                  <ImageIcon size={20} color={TOKENS.inkSoft} />
                  <span style={{ fontSize: "10.5px", color: TOKENS.inkSoft, textAlign: "center", padding: "0 8px" }}>Upload picture</span>
                </>
              )}
              <input type="file" accept="image/*" onChange={handleImage} style={{ display: "none" }} />
            </label>
            {image && (
              <button onClick={() => setImage(null)} style={{ marginTop: "6px", fontSize: "10.5px", color: TOKENS.red, background: "none", border: "none", cursor: "pointer" }}>
                Remove
              </button>
            )}
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
            <Field label="Item name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <div style={{ display: "flex", gap: "10px" }}>
              <Field label="Category" style={{ flex: 1 }}>
                <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Condition" style={{ flex: 1 }}>
                <select value={condition} onChange={(e) => setCondition(e.target.value)} style={inputStyle}>
                  <option value="new">New</option>
                  <option value="used">Used / Old</option>
                </select>
              </Field>
            </div>
            <Field label="SKU / Barcode (auto-assigned)">
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 10px", borderRadius: "7px", border: `1px solid ${TOKENS.border}`, background: TOKENS.surfaceAlt }}>
                <Barcode value={item.sku} />
              </div>
            </Field>
            <div style={{ display: "flex", gap: "10px" }}>
              <Field label="Unit" style={{ flex: 1 }}>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Low-stock threshold" style={{ flex: 1 }}>
                <input type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={inputStyle} />
              </Field>
            </div>
          </div>
        </div>

        <div style={{ fontSize: "11px", color: TOKENS.inkSoft, marginTop: "10px" }}>
          To change quantity, use Add Stock / Deduct Stock from the item detail view — edits here only update the item's details.
        </div>

        {err && <div style={{ fontSize: "12.5px", color: TOKENS.red, marginTop: "8px" }}>{err}</div>}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "18px" }}>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="inv-btn" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "8px", border: `1px solid ${TOKENS.redSoft}`, background: TOKENS.redSoft, color: TOKENS.red, fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}>
              <Trash2 size={14} /> Delete item
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: TOKENS.red, fontWeight: 600 }}>Delete this item permanently?</span>
              <button onClick={() => onDelete(item.id)} className="inv-btn" style={{ padding: "7px 12px", borderRadius: "7px", border: "none", background: TOKENS.red, color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                Yes, delete
              </button>
              <button onClick={() => setConfirmDelete(false)} className="inv-btn" style={{ padding: "7px 12px", borderRadius: "7px", border: `1px solid ${TOKENS.border}`, background: TOKENS.surface, fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}

          <button onClick={submit} className="inv-btn" style={{ padding: "9px 20px", borderRadius: "8px", border: "none", background: TOKENS.teal, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
