// Import history (user's request, 2026-09-28): one entry per saved statement import — the file's
// name and type, the days its rows cover, the store, how many rows were added and replaced, who
// imported it and when.
//
//   recordImport(...)                 called by POST /transactions/import, inside its db transaction
//   GET    /local-api/import-history     the entries the user may see, newest first (at most MAX_ROWS)
//   DELETE /local-api/import-history     clears the log (data:purge; the store's, or every store's for
//                                       the Admin) — a housekeeping action on the log only, but it
//                                       cascades to any ambiguous rows still pending review there
//   GET    /local-api/ambiguous-rows     the rows those imports set aside as ambiguous, same visibility
//                                       (?count=1: just { total }, for the dashboard button's badge)
//   DELETE /local-api/ambiguous-rows/:id             discard one row for good (transactions:import)
//   POST   /local-api/ambiguous-rows/:id/convert     correct it into a real transaction, then discard
//                                       it (transactions:import + transactions:create; the row's own
//                                       commission is computed the CSV way — the office rate on its
//                                       date, credits only — never sent by the client)
//
// Who sees what: the Admin every store's imports (or one store's, with store_id); a Manager their
// store's; a User only their own imports in their store (no imports:read:any). Someone with no
// store sees none. Discarding and converting follow the same rule, row by row: you must be able to
// see the row to act on it.
import { requirePermission } from "./auth.js";
import { MAX_ROWS } from "./dashboard.js";
import { db } from "./db.js";
import { commissionRateOn, isIsoDate, refuseClosedDays, transactionDay } from "./office.js";
import { PERMISSIONS as P, hasPermission } from "./permissions.js";
import { readStore, seesAllStores } from "./stores.js";

const IMPORT_SOURCES = ["csv", "pdf"];
const AMBIGUITY_REASONS = ["negative", "both", "neither", "invalid_date", "unreadable"];
const MAX_FILE_NAME = 255;
const MAX_TEXT = 500;

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

let insertAmbiguousStatement;
const insertAmbiguous = () => (insertAmbiguousStatement ??= db.prepare(
  `INSERT INTO ambiguous_rows (import_id, line_no, date, reference_number, service, description, debit, credit, balance, reason)
   VALUES (@import_id, @line_no, @date, @reference_number, @service, @description, @debit, @credit, @balance, @reason)`
));

// The set-aside rows as the import screen sent them, reduced to plain short texts. Rows with an
// unknown reason are dropped; at most MAX_ROWS are kept.
const text = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_TEXT);
const cleanAmbiguousRows = (list) => (Array.isArray(list) ? list : [])
  .filter((row) => row && typeof row === "object" && AMBIGUITY_REASONS.includes(row.reason))
  .slice(0, MAX_ROWS)
  .map((row) => ({
    line_no: Number.isInteger(row.line_no) && row.line_no > 0 ? row.line_no : null,
    // As printed, like debit/credit/balance below — not required to be a valid date, since an
    // "invalid_date" row's whole point is that its date column couldn't be parsed as one.
    date: text(row.date),
    reference_number: text(row.reference_number),
    service: text(row.service),
    description: text(row.description),
    debit: text(row.debit),
    credit: text(row.credit),
    balance: text(row.balance),
    reason: row.reason,
  }));

// rows: the transactions just saved; statement: { file_name, source } as the client sent it;
// ambiguous: the rows the engine set aside (kept with this import, never saved as transactions).
// The period, the count and who / when come from the server, never from the client.
export const recordImport = ({ storeId, rows, replaced, user, statement, ambiguous }) => {
  const days = rows.map(transactionDay).filter(Boolean).sort();
  const source = IMPORT_SOURCES.includes(statement?.source) ? statement.source : null;
  const importId = insert().run({
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
  cleanAmbiguousRows(ambiguous).forEach((row) => insertAmbiguous().run({ ...row, import_id: importId }));
  return importId;
};

// The scope shared by the history and its ambiguous rows: the stores you may see (or the one asked
// for), and without imports:read:any, only your own imports. null = a response was already sent.
const historyScope = (req, res) => {
  if (!seesAllStores(req.user) && req.user.store_id == null) return { none: true };
  const store = readStore(req, res, req.query.store_id);
  if (!store) return null;
  const where = [];
  const params = [];
  if (!store.all) { where.push("h.store_id = ?"); params.push(store.id); }
  if (!hasPermission(req.user, P.IMPORTS_READ_ANY)) { where.push("h.imported_by = ?"); params.push(req.user.email); }
  return { filter: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
};

// One ambiguous row, with its import's store and importer, checked against the same rule as the
// list above (row-by-row rather than in the WHERE clause, since there's only one row to check).
// 404 either way, so a row outside your scope doesn't reveal that it exists.
const findRowInScope = (req, res, id) => {
  const row = db.prepare(
    `SELECT a.*, h.store_id, h.imported_by
     FROM ambiguous_rows a JOIN import_history h ON h.id = a.import_id
     WHERE a.id = ?`
  ).get(Number(id));
  const sees = row && (seesAllStores(req.user) || (req.user.store_id != null && row.store_id === req.user.store_id));
  const owns = row && (hasPermission(req.user, P.IMPORTS_READ_ANY) || row.imported_by === req.user.email);
  if (!sees || !owns) { res.status(404).json({ error: "Record not found" }); return null; }
  return row;
};

const TRANSACTION_TYPES = ["cash_in", "cash_out"];

// The corrected fields for "convert": type and a positive amount are required, and a real calendar
// date (the row keeps whatever date the file printed, but the office worker can correct it, the same
// as any other field). Returns the first problem, or null.
const validateConvertBody = (body) => {
  if (!TRANSACTION_TYPES.includes(body?.type)) return "type must be cash_in or cash_out";
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "amount must be a positive number";
  if (!isIsoDate(body?.transaction_date)) return "transaction_date must be YYYY-MM-DD";
  return null;
};

export const registerImportHistoryRoutes = (app) => {
  app.get("/local-api/import-history", requirePermission(P.TRANSACTIONS_READ), (req, res) => {
    const scope = historyScope(req, res);
    if (!scope) return;
    if (scope.none) { res.json({ total: 0, truncated: false, imports: [] }); return; }
    const { filter, params } = scope;

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

  // Clears the import-history log (data:purge, like the admin panel's other destructive actions —
  // not transactions:read, so a User never sees the button). It's a log, so this never touches the
  // transactions themselves — but `ambiguous_rows` has ON DELETE CASCADE to `import_history`, so any
  // row still pending review under a cleared import is discarded with it. The client is told how many
  // (`discarded_ambiguous`) so it can warn before asking to confirm.
  //
  // The client sends the count it showed the user (`expected_count`), the same race-safety pattern as
  // the admin panel's purge: if the log changed since (another import, or someone else clearing it),
  // nothing is deleted and the current count comes back instead, so a "confirm" the user actually saw
  // never wipes more (or different) rows than were shown.
  app.delete("/local-api/import-history", requirePermission(P.DATA_PURGE), (req, res) => {
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;
    const expected = req.body?.expected_count;
    if (!Number.isInteger(expected) || expected < 0) {
      res.status(400).json({ error: "expected_count is required" });
      return;
    }
    const historyWhere = store.all ? "" : "WHERE store_id = ?";
    const joinWhere = store.all ? "" : "WHERE h.store_id = ?";
    const params = store.all ? [] : [store.id];
    const result = db.transaction(() => {
      const current = db.prepare(`SELECT COUNT(*) AS n FROM import_history ${historyWhere}`).get(...params).n;
      if (current !== expected) return { conflict: current };
      const ambiguousDiscarded = db.prepare(
        `SELECT COUNT(*) AS n FROM ambiguous_rows a JOIN import_history h ON h.id = a.import_id ${joinWhere}`
      ).get(...params).n;
      const cleared = db.prepare(`DELETE FROM import_history ${historyWhere}`).run(...params).changes;
      return { cleared, ambiguousDiscarded };
    })();
    if (result.conflict !== undefined) {
      res.status(409).json({ error: "The import history changed since you last saw it. Check the count and try again.", total: result.conflict });
      return;
    }
    console.log(`[imports] ${req.user.email} cleared ${result.cleared} import-history entries (${store.all ? "every store" : `store ${store.id}`}), discarding ${result.ambiguousDiscarded} pending ambiguous row(s)`);
    res.json({ cleared: result.cleared, discarded_ambiguous: result.ambiguousDiscarded });
  });

  // The rows set aside as ambiguous, newest import first, in file order; with their import's file,
  // store and who / when. Same visibility as the history.
  app.get("/local-api/ambiguous-rows", requirePermission(P.TRANSACTIONS_READ), (req, res) => {
    const scope = historyScope(req, res);
    if (!scope) return;
    const countOnly = req.query.count === "1";
    if (scope.none) { res.json(countOnly ? { total: 0 } : { total: 0, truncated: false, rows: [] }); return; }
    const { filter, params } = scope;
    if (countOnly) {
      res.json(db.prepare(`SELECT COUNT(*) AS total FROM ambiguous_rows a JOIN import_history h ON h.id = a.import_id ${filter}`).get(...params));
      return;
    }
    const from = `FROM ambiguous_rows a
       JOIN import_history h ON h.id = a.import_id
       LEFT JOIN stores s ON s.id = h.store_id
       LEFT JOIN users u ON u.email = h.imported_by
       ${filter}`;
    const { total } = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params);
    const rows = db.prepare(
      `SELECT a.*, h.file_name, h.source, h.store_id, h.imported_by, h.imported_at, s.name AS store_name, u.full_name AS imported_by_name
       ${from}
       ORDER BY h.imported_at DESC, h.id DESC, a.line_no, a.id
       LIMIT ?`
    ).all(...params, MAX_ROWS);
    res.json({ total, truncated: total > rows.length, rows });
  });

  // Discard one row for good: it wasn't a transaction, and it stays out of the count and the list.
  app.delete("/local-api/ambiguous-rows/:id", requirePermission(P.TRANSACTIONS_IMPORT), (req, res) => {
    const row = findRowInScope(req, res, req.params.id);
    if (!row) return;
    db.prepare("DELETE FROM ambiguous_rows WHERE id = ?").run(row.id);
    res.json({ ok: true, id: row.id });
  });

  // Correct one row into a real transaction, then discard it (one row can't be both). Body:
  // { type, amount, sender_name?, receiver_name?, phone?, customer_number?, service?, note?,
  //   reference_number?, transaction_date }. Everything else about the row (why it was ambiguous, the
  //   file it came from) is only ever shown, never asked back.
  //
  // Commission is never taken from the client: it's the CSV rule (server/index.js's CSV engine) —
  // the store's office rate on the transaction's date, credits only — because this row came from a
  // CSV, and "stored commissions are never recalculated" applies here just as it does to every other
  // imported row. created_by is the person doing the correction, not the original importer.
  app.post("/local-api/ambiguous-rows/:id/convert", requirePermission(P.TRANSACTIONS_IMPORT), (req, res) => {
    if (!hasPermission(req.user, P.TRANSACTIONS_CREATE)) {
      res.status(403).json({ error: "You don't have permission to do this", missing: [P.TRANSACTIONS_CREATE] });
      return;
    }
    const row = findRowInScope(req, res, req.params.id);
    if (!row) return;
    if (row.store_id == null) { res.status(409).json({ error: "This row's store no longer exists" }); return; }

    const problem = validateConvertBody(req.body);
    if (problem) { res.status(400).json({ error: problem }); return; }

    const { type, transaction_date } = req.body;
    const amount = Number(req.body.amount);
    if (refuseClosedDays(res, row.store_id, [transaction_date])) return;

    const reference_number = text(req.body.reference_number);
    // Same rule as a fresh import: a reference already used by another store's transaction refuses it
    // (the same money can't be recorded in two stores).
    if (reference_number && db.prepare("SELECT 1 FROM transactions WHERE reference_number = ? AND store_id != ?").get(reference_number, row.store_id)) {
      res.status(409).json({ error: "Some of these transactions were already imported into another store" });
      return;
    }

    const transactionId = db.transaction(() => {
      const rate = type === "cash_in" ? commissionRateOn(row.store_id, transaction_date) : 0;
      const commission = Number(((amount * rate) / 100).toFixed(3));
      const now = new Date().toISOString();
      const id = db.prepare(
        `INSERT INTO transactions
           (type, amount, commission, sender_name, receiver_name, phone, customer_number, note,
            reference_number, service, transaction_date, sort_order, created_by, created_date, updated_date, store_id)
         VALUES
           (@type, @amount, @commission, @sender_name, @receiver_name, @phone, @customer_number, @note,
            @reference_number, @service, @transaction_date, 0, @created_by, @created_date, @updated_date, @store_id)`
      ).run({
        type, amount, commission,
        sender_name: text(req.body.sender_name), receiver_name: text(req.body.receiver_name),
        phone: text(req.body.phone), customer_number: text(req.body.customer_number),
        note: text(req.body.note), reference_number, service: text(req.body.service),
        transaction_date, created_by: req.user.email, created_date: now, updated_date: now, store_id: row.store_id,
      }).lastInsertRowid;
      db.prepare("DELETE FROM ambiguous_rows WHERE id = ?").run(row.id);
      return id;
    })();

    res.status(201).json({ transaction: db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId), discarded_id: row.id });
  });
};
