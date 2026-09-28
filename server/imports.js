// Import history (user's request, 2026-09-28): one entry per saved statement import — the file's
// name and type, the days its rows cover, the store, how many rows were added and replaced, who
// imported it and when.
//
//   recordImport(...)                 called by POST /transactions/import, inside its db transaction
//   GET /local-api/import-history     the entries the user may see, newest first (at most MAX_ROWS)
//
// Who sees what: the Admin every store's imports (or one store's, with store_id); a Manager their
// store's; a User only their own imports in their store (no imports:read:any). Someone with no
// store sees none.
import { requirePermission } from "./auth.js";
import { MAX_ROWS } from "./dashboard.js";
import { db } from "./db.js";
import { transactionDay } from "./office.js";
import { PERMISSIONS as P, hasPermission } from "./permissions.js";
import { readStore, seesAllStores } from "./stores.js";

export const IMPORT_SOURCES = ["csv", "pdf"];
const MAX_FILE_NAME = 255;

// The name as shown: the last path segment (browsers may send "C:\fakepath\…"), trimmed, without
// control characters, at most 255 characters.
export const cleanFileName = (value) =>
  String(value ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME);

// Prepared on first use: this module is imported before initializeDb() creates the tables.
let insertStatement;
const insert = () => (insertStatement ??= db.prepare(
  `INSERT INTO import_history (store_id, file_name, source, period_from, period_to, row_count, replaced_count, imported_by, imported_at)
   VALUES (@store_id, @file_name, @source, @period_from, @period_to, @row_count, @replaced_count, @imported_by, @imported_at)`
));

// rows: the transactions just saved; statement: { file_name, source } as the client sent it.
// The period, the count and who / when come from the server, never from the client.
export const recordImport = ({ storeId, rows, replaced, user, statement }) => {
  const days = rows.map(transactionDay).filter(Boolean).sort();
  const source = IMPORT_SOURCES.includes(statement?.source) ? statement.source : null;
  return insert().run({
    store_id: storeId,
    file_name: cleanFileName(statement?.file_name),
    source,
    period_from: days[0] ?? null,
    period_to: days[days.length - 1] ?? null,
    row_count: rows.length,
    replaced_count: replaced,
    imported_by: user.email,
    imported_at: new Date().toISOString(),
  }).lastInsertRowid;
};

export const registerImportHistoryRoutes = (app) => {
  app.get("/local-api/import-history", requirePermission(P.TRANSACTIONS_READ), (req, res) => {
    const empty = { total: 0, truncated: false, imports: [] };
    if (!seesAllStores(req.user) && req.user.store_id == null) { res.json(empty); return; }
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;

    const where = [];
    const params = [];
    if (!store.all) { where.push("h.store_id = ?"); params.push(store.id); }
    // Without imports:read:any (Users), only your own imports.
    if (!hasPermission(req.user, P.IMPORTS_READ_ANY)) { where.push("h.imported_by = ?"); params.push(req.user.email); }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM import_history h ${filter}`).get(...params);
    const imports = db.prepare(
      `SELECT h.*, s.name AS store_name, u.full_name AS imported_by_name
       FROM import_history h
       LEFT JOIN stores s ON s.id = h.store_id
       LEFT JOIN users u ON u.email = h.imported_by
       ${filter}
       ORDER BY h.imported_at DESC, h.id DESC
       LIMIT ?`
    ).all(...params, MAX_ROWS);
    res.json({ total, truncated: total > imports.length, imports });
  });
};
