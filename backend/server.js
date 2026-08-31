require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "15mb" })); // items can carry a base64 image

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "stockroom",
  waitForConnections: true,
  connectionLimit: 10,
});

/* ---------- helpers ---------- */

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// DB row (snake_case) -> API shape (camelCase), matching the frontend's item objects
function rowToItem(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category || "",
    condition: r.condition,
    unit: r.unit,
    unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
    threshold: r.threshold,
    quantity: r.quantity,
    sku: r.sku,
    image: r.image || null,
  };
}

function rowToTx(r) {
  return {
    id: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    type: r.type,
    qty: r.qty,
    remarks: r.remarks || "",
    ts: Number(r.ts),
  };
}

// Atomically reserve the next SKU, e.g. UTC-0001. Must be called inside a transaction (conn).
async function nextSku(conn) {
  await conn.execute("UPDATE sku_counter SET counter = counter + 1 WHERE id = 1");
  const [rows] = await conn.execute("SELECT counter FROM sku_counter WHERE id = 1");
  const counter = rows[0].counter - 1; // the value before this increment
  return `UTC-${String(counter).padStart(4, "0")}`;
}

function asyncHandler(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  });
}

/* ---------- items ---------- */

app.get("/api/items", asyncHandler(async (req, res) => {
  const [rows] = await pool.execute("SELECT * FROM items ORDER BY created_at ASC");
  res.json(rows.map(rowToItem));
}));

// Create a new item. Body: { id, name, category, condition, unit, unitCost, threshold, image, quantity }
// The frontend already generates a client-side id (uid("item")); we accept it as-is.
app.post("/api/items", asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: "Item name is required." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const sku = await nextSku(conn);
    const id = b.id || uid("item");
    const quantity = Number(b.quantity) || 0;

    await conn.execute(
      `INSERT INTO items (id, name, category, \`condition\`, unit, unit_cost, threshold, quantity, sku, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        b.name.trim(),
        (b.category || "").trim(),
        b.condition === "used" ? "used" : "new",
        (b.unit || "pcs").trim(),
        b.unitCost === "" || b.unitCost === undefined || b.unitCost === null ? null : Number(b.unitCost),
        b.threshold === "" || b.threshold === undefined ? 5 : Number(b.threshold),
        quantity,
        sku,
        b.image || null,
      ]
    );

    const tx = {
      id: uid("tx"),
      itemId: id,
      itemName: b.name.trim(),
      type: "stock_in",
      qty: quantity,
      remarks: "New item added",
      ts: Date.now(),
    };
    await conn.execute(
      `INSERT INTO transactions (id, item_id, item_name, type, qty, remarks, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tx.id, tx.itemId, tx.itemName, tx.type, tx.qty, tx.remarks, tx.ts]
    );

    await conn.commit();

    const [rows] = await pool.execute("SELECT * FROM items WHERE id = ?", [id]);
    res.status(201).json({ item: rowToItem(rows[0]), transaction: tx });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Update item details (name/category/condition/unit/unitCost/threshold/image). Does NOT touch quantity.
app.put("/api/items/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: "Item name is required." });

  await pool.execute(
    `UPDATE items SET name=?, category=?, \`condition\`=?, unit=?, unit_cost=?, threshold=?, image=? WHERE id=?`,
    [
      b.name.trim(),
      (b.category || "").trim(),
      b.condition === "used" ? "used" : "new",
      (b.unit || "pcs").trim(),
      b.unitCost === "" || b.unitCost === undefined || b.unitCost === null ? null : Number(b.unitCost),
      b.threshold === "" || b.threshold === undefined ? 5 : Number(b.threshold),
      b.image || null,
      id,
    ]
  );

  const [rows] = await pool.execute("SELECT * FROM items WHERE id = ?", [id]);
  if (!rows.length) return res.status(404).json({ error: "Item not found." });
  res.json(rowToItem(rows[0]));
}));

app.delete("/api/items/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.execute("DELETE FROM items WHERE id = ?", [id]); // transactions cascade-delete via FK
  res.json({ ok: true });
}));

/* ---------- transactions ---------- */

app.get("/api/transactions", asyncHandler(async (req, res) => {
  const [rows] = await pool.execute("SELECT * FROM transactions ORDER BY ts DESC");
  res.json(rows.map(rowToTx));
}));

// Stock in / stock out. Body: { itemId, type: 'stock_in'|'stock_out', qty, remarks }
// Updates the item's quantity and inserts a transaction row atomically.
app.post("/api/transactions", asyncHandler(async (req, res) => {
  const { itemId, type, qty, remarks } = req.body;
  const q = Number(qty);
  if (!itemId || !["stock_in", "stock_out"].includes(type) || !q || q <= 0) {
    return res.status(400).json({ error: "itemId, a valid type, and a positive qty are required." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [itemRows] = await conn.execute("SELECT * FROM items WHERE id = ? FOR UPDATE", [itemId]);
    if (!itemRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Item not found." });
    }
    const item = itemRows[0];
    const delta = type === "stock_in" ? q : -q;
    const newQty = Math.max(0, item.quantity + delta);

    await conn.execute("UPDATE items SET quantity = ? WHERE id = ?", [newQty, itemId]);

    const tx = {
      id: uid("tx"),
      itemId,
      itemName: item.name,
      type,
      qty: q,
      remarks: remarks || "",
      ts: Date.now(),
    };
    await conn.execute(
      `INSERT INTO transactions (id, item_id, item_name, type, qty, remarks, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tx.id, tx.itemId, tx.itemName, tx.type, tx.qty, tx.remarks, tx.ts]
    );

    await conn.commit();

    const [rows] = await pool.execute("SELECT * FROM items WHERE id = ?", [itemId]);
    res.status(201).json({ item: rowToItem(rows[0]), transaction: tx });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Stockroom API listening on http://localhost:${PORT}`));
