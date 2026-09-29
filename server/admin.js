// Admin panel API (Admin + Manager): what a date range holds, a CSV backup of it, and deleting it.
//
//   GET  /local-api/admin/range                       first and last day that has any data
//   GET  /local-api/admin/summary?from=&to=           counts and totals for the range (the preview)
//   GET  /local-api/admin/export?kind=&from=&to=      CSV download; kind = transactions | balances
//   POST /local-api/admin/purge { from, to, expected_count }
//                                                     deletes the range's transactions AND opening
//                                                     balances, in one database transaction
//   POST /local-api/admin/restore/preview { csv }     what restoring a backup CSV would do (data:restore)
//   POST /local-api/admin/restore { csv, expected_count, expected_delete }
//                                                     replace the file's days with the file's rows
//                                                     (data:restore + data:purge)
//
// A transaction's day is transaction_date, or the date part of created_date when it has none —
// the same rule the dashboard uses. Ranges are inclusive, as YYYY-MM-DD.
//
// Stores: every route takes an optional store_id. The Admin (stores:all) works on one store or, with
// none, every store; a Manager always on their own store (server/stores.js).
import { requirePermission } from "./auth.js";
import { parseCsvText } from "./csv.js";
import { LEGACY_OWNER_EMAIL, db } from "./db.js";
import { closedAmong, closedDaysBetween, transactionDay } from "./office.js";
import { PERMISSIONS as P } from "./permissions.js";
import { inScope, readStore, resolveStore, storeById, targetStore } from "./stores.js";

const TX_DAY = "COALESCE(NULLIF(transaction_date, ''), substr(created_date, 1, 10))";

export const TRANSACTION_CSV_COLUMNS = [
  "id", "transaction_date", "type", "amount", "commission", "sender_name", "receiver_name", "phone",
  "customer_number", "reference_number", "service", "note", "currency", "status", "sort_order",
  "created_by", "created_date", "updated_date", "store_id",
];
export const BALANCE_CSV_COLUMNS = ["id", "date", "opening_balance", "created_by", "created_date", "updated_date", "store_id"];
// Backups made before stores have no store_id column; they're still recognised (and restored into
// the store chosen for the restore).
const withoutStore = (columns) => columns.filter((column) => column !== "store_id");

const isIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// { from, to } or { error } (400).
export const parseRange = (from, to) => {
  if (!isIsoDate(from) || !isIsoDate(to)) return { error: "A valid date range is required (from and to, YYYY-MM-DD)" };
  if (from > to) return { error: "The start date must be on or before the end date" };
  return { from, to };
};

// Text a spreadsheet would run as a formula: =…, @…, tab/CR…, or +/- followed by anything but a plain
// number or phone. Shared by the export (adds a leading ') and restore (removes exactly that ').
const needsGuard = (text) => /^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^[+-][\d\s().]*$/.test(text));

// One CSV cell. Quoted when needed (comma, quote, line break). Text that a spreadsheet would run as a
// formula gets a leading ' so the backup can be opened safely in Excel; numbers and phone numbers
// like +96171… are kept exactly.
export const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && needsGuard(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns, rows) =>
  // BOM so Excel reads the Arabic names as UTF-8; CRLF line endings as RFC 4180 recommends.
  "\uFEFF" + [columns.join(","), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(","))].join("\r\n") + "\r\n";

// Prepared when first used: this module is imported before initializeDb() creates the tables.
// `store` is { all: true } or { id }: every store, or one.
const inStore = (store) => (store.all ? { sql: "1 = 1", params: [] } : { sql: "store_id = ?", params: [store.id] });
const selectTransactions = (from, to, store) => {
  const scope = inStore(store);
  return db.prepare(`SELECT * FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ? AND ${scope.sql} ORDER BY store_id, ${TX_DAY}, sort_order, id`).all(from, to, ...scope.params);
};
const selectBalances = (from, to, store) => {
  const scope = inStore(store);
  return db.prepare(`SELECT * FROM daily_balances WHERE date BETWEEN ? AND ? AND ${scope.sql} ORDER BY store_id, date, id`).all(from, to, ...scope.params);
};
const countTransactions = (from, to, store) => {
  const scope = inStore(store);
  return db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ? AND ${scope.sql}`).get(from, to, ...scope.params).n;
};

const summarize = (from, to, store) => {
  const scope = inStore(store);
  const tx = db.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount END), 0) AS total_out,
            COALESCE(SUM(commission), 0) AS total_commission,
            COUNT(DISTINCT ${TX_DAY}) AS days,
            MIN(${TX_DAY}) AS first_date, MAX(${TX_DAY}) AS last_date
     FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ? AND ${scope.sql}`
  ).get(from, to, ...scope.params);
  const balances = db.prepare(`SELECT COUNT(*) AS n FROM daily_balances WHERE date BETWEEN ? AND ? AND ${scope.sql}`).get(from, to, ...scope.params).n;
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    from,
    to,
    store_id: store.all ? null : store.id,
    transactions: tx.count,
    opening_balances: balances,
    days: tx.days,
    first_date: tx.first_date,
    last_date: tx.last_date,
    total_in: round(tx.total_in),
    total_out: round(tx.total_out),
    total_commission: round(tx.total_commission),
  };
};

export const registerAdminRoutes = (app) => {
  const canExport = requirePermission(P.DATA_EXPORT);
  const canPurge = requirePermission(P.DATA_PURGE);

  app.get("/local-api/admin/range", canExport, (req, res) => {
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;
    const scope = inStore(store);
    const tx = db.prepare(`SELECT MIN(${TX_DAY}) AS first, MAX(${TX_DAY}) AS last FROM transactions WHERE ${scope.sql}`).get(...scope.params);
    const ob = db.prepare(`SELECT MIN(date) AS first, MAX(date) AS last FROM daily_balances WHERE ${scope.sql}`).get(...scope.params);
    const dates = [tx.first, tx.last, ob.first, ob.last].filter(Boolean).sort();
    res.json({ first_date: dates[0] ?? null, last_date: dates.at(-1) ?? null });
  });

  app.get("/local-api/admin/summary", canExport, (req, res) => {
    const range = parseRange(req.query.from, req.query.to);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;
    res.json(summarize(range.from, range.to, store));
  });

  app.get("/local-api/admin/export", canExport, (req, res) => {
    const range = parseRange(req.query.from, req.query.to);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    const kind = req.query.kind || "transactions";
    if (!["transactions", "balances"].includes(kind)) {
      res.status(400).json({ error: "Unknown export kind" });
      return;
    }
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;
    const csv = kind === "transactions"
      ? toCsv(TRANSACTION_CSV_COLUMNS, selectTransactions(range.from, range.to, store))
      : toCsv(BALANCE_CSV_COLUMNS, selectBalances(range.from, range.to, store));
    const storePart = store.all ? "" : `store-${store.id}_`;
    const filename = `${kind === "transactions" ? "transactions" : "opening-balances"}_${storePart}${range.from}_${range.to}.csv`;
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    res.send(csv);
  });

  // The client sends the count it showed the user. If the data changed since (someone imported or
  // deleted in the meantime), nothing is deleted and the new count is returned, so the user never
  // deletes more — or other — rows than they confirmed.
  app.post("/local-api/admin/purge", canPurge, (req, res) => {
    const range = parseRange(req.body?.from, req.body?.to);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    const expected = req.body?.expected_count;
    if (!Number.isInteger(expected) || expected < 0) {
      res.status(400).json({ error: "expected_count is required" });
      return;
    }
    const store = readStore(req, res, req.body?.store_id);
    if (!store) return;
    const scope = inStore(store);
    const closed = closedDaysBetween(store.all ? null : store.id, range.from, range.to);
    if (closed.length) {
      res.status(423).json({ error: "The range includes closed days. Reopen them first.", closed_days: closed });
      return;
    }
    const result = db.transaction(() => {
      const current = countTransactions(range.from, range.to, store);
      if (current !== expected) return { conflict: current };
      const deletedTransactions = db.prepare(`DELETE FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ? AND ${scope.sql}`).run(range.from, range.to, ...scope.params).changes;
      const deletedBalances = db.prepare(`DELETE FROM daily_balances WHERE date BETWEEN ? AND ? AND ${scope.sql}`).run(range.from, range.to, ...scope.params).changes;
      return { deletedTransactions, deletedBalances };
    })();
    if (result.conflict !== undefined) {
      res.status(409).json({ error: "The data changed since the preview. Check the counts and try again.", transactions: result.conflict });
      return;
    }
    console.log(`[admin] ${req.user.email} deleted ${result.deletedTransactions} transactions and ${result.deletedBalances} opening balances from ${range.from} to ${range.to} (${store.all ? "every store" : `store ${store.id}`})`);
    res.json({ from: range.from, to: range.to, store_id: store.all ? null : store.id, deleted_transactions: result.deletedTransactions, deleted_opening_balances: result.deletedBalances });
  });
};

// ═══ Restore from a backup ═══
// Puts back a CSV this panel exported (transactions or opening balances) by REPLACING the days it
// covers (user's decision, 2026-09-29): for each store in the file, that store's rows on the file's
// days are deleted, then every row in the file is inserted exactly as it was (same id, dates,
// "entered by", store) — in one database transaction. Before, it only added the rows whose id was
// missing, so a statement re-imported with "replace" since the backup (new ids) came back twice.
//
// Transactions: besides the file's days, the same transactions are removed wherever they are now —
// a row with one of the file's ids (moved to another day since), and a row of the same store with
// one of the file's reference numbers (re-imported since) — so nothing ends up counted twice.
// Opening balances: the store's balance on each of the file's dates is replaced.
//
// Refused as a whole: any invalid row (a damaged or hand-edited backup is never half-restored); a
// closed day among the days written or cleared (423); a reference already used by another
// transaction in another store (409, the import rule). A row's store is its store_id column;
// backups from before stores go to the store chosen for the restore. Without stores:all, every row
// must be for your own store.

// Undo csvCell's spreadsheet guard: a leading ' is removed only where csvCell would have added it.
const unguard = (text) => (text.startsWith("'") && needsGuard(text.slice(1)) ? text.slice(1) : text);

const RESTORE_LIMITS = { maxRows: 100000, maxErrorsShown: 20 };

const parseBackup = (csv) => {
  const text = String(csv || "").replace(/^﻿/, "");
  const rows = parseCsvText(text, ",").filter((row) => row.some((cell) => cell !== ""));
  if (!rows.length) return { error: "The file is empty" };
  const header = rows[0].map((h) => h.trim());
  const has = (columns) => columns.every((c) => header.includes(c));
  const kind = has(withoutStore(TRANSACTION_CSV_COLUMNS)) ? "transactions" : has(withoutStore(BALANCE_CSV_COLUMNS)) ? "balances" : null;
  if (!kind) return { error: "This isn't a backup file from the admin panel" };
  if (rows.length - 1 > RESTORE_LIMITS.maxRows) return { error: "The file has too many rows" };
  const records = rows.slice(1).map((row, i) => {
    const record = { line: i + 2 };
    header.forEach((h, c) => { record[h] = unguard(String(row[c] ?? "")); });
    return record;
  });
  return { kind, records };
};

const number = (value) => (value === "" || value === undefined ? NaN : Number(value));
const isIsoDateTime = (value) => !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);

const validateTransaction = (r) => {
  if (!Number.isInteger(number(r.id)) || number(r.id) <= 0) return "id";
  if (!["cash_in", "cash_out"].includes(r.type)) return "type";
  if (!Number.isFinite(number(r.amount)) || number(r.amount) < 0) return "amount";
  if (!Number.isFinite(number(r.commission || "0"))) return "commission";
  if (r.transaction_date && !isIsoDate(r.transaction_date)) return "transaction_date";
  if (!isIsoDateTime(r.created_date)) return "created_date";
  return null;
};

const validateBalance = (r) => {
  if (!isIsoDate(r.date)) return "date";
  if (!Number.isFinite(number(r.opening_balance))) return "opening_balance";
  if (!isIsoDateTime(r.created_date)) return "created_date";
  return null;
};

// What restoring the file would do, without changing anything. `user` decides which stores rows
// may go to; `defaultStore` receives rows without a store_id (null: such rows are invalid).
// plan: { toAdd, deleteIds (transactions) | deleteKeys (balances), duplicatesInFile, blocked }.
const planRestore = (csv, user, defaultStore) => {
  const parsed = parseBackup(csv);
  if (parsed.error) return parsed;
  const { kind, records } = parsed;
  // Each row's store: its own store_id column, or the store chosen for the restore.
  records.forEach((r) => { r.store_id = r.store_id ? Number(r.store_id) : defaultStore; });
  const storeProblem = (r) => (!Number.isInteger(r.store_id) || !storeById(r.store_id) || !inScope(user, r) ? "store_id" : null);
  const validate = kind === "transactions" ? validateTransaction : validateBalance;
  // Each invalid row is reported as { line, field } — the first column whose value isn't valid.
  const invalid = records.map((r) => ({ line: r.line, field: validate(r) || storeProblem(r) })).filter((x) => x.field);
  const dayOf = (r) => (kind === "transactions" ? transactionDay(r) : r.date);
  const key = (storeId, day) => `${storeId}|${day}`;

  // The file's rows, once each (the same id — or store and date — twice counts once).
  const plan = { toAdd: [], deleteIds: [], deleteKeys: [], duplicatesInFile: 0, blocked: null };
  const seen = new Set();
  if (!invalid.length) {
    for (const r of records) {
      const id = kind === "transactions" ? Number(r.id) : key(r.store_id, r.date);
      if (seen.has(id)) { plan.duplicatesInFile += 1; continue; }
      seen.add(id);
      plan.toAdd.push(r);
    }
  }
  const fileDays = new Set(plan.toAdd.map((r) => key(r.store_id, dayOf(r))));
  // Every store-day written or cleared, for the closed-day check.
  const touched = new Set(fileDays);
  let deletedElsewhere = 0;
  let inOtherStores = 0;

  if (!invalid.length && kind === "transactions") {
    const toDelete = new Map(); // id → its store-day
    const onDay = db.prepare(`SELECT id FROM transactions WHERE store_id = ? AND ${TX_DAY} = ?`);
    const byId = db.prepare(`SELECT id, store_id, ${TX_DAY} AS day FROM transactions WHERE id = ?`);
    const byReference = db.prepare(`SELECT id, store_id, ${TX_DAY} AS day FROM transactions WHERE reference_number = ?`);
    for (const storeDay of fileDays) {
      const [storeId, day] = storeDay.split("|");
      onDay.all(Number(storeId), day).forEach((row) => toDelete.set(row.id, storeDay));
    }
    // The same transaction elsewhere: its id on another day, or its reference re-imported since.
    const fileIds = new Set(plan.toAdd.map((r) => Number(r.id)));
    for (const r of plan.toAdd) {
      const current = byId.get(Number(r.id));
      if (current && !toDelete.has(current.id)) {
        if (!inScope(user, current)) { invalid.push({ line: r.line, field: "id" }); continue; }
        toDelete.set(current.id, key(current.store_id, current.day));
      }
      const reference = String(r.reference_number || "").trim();
      if (!reference) continue;
      for (const other of byReference.all(reference)) {
        if (toDelete.has(other.id) || fileIds.has(other.id)) continue;
        if (other.store_id === r.store_id) toDelete.set(other.id, key(other.store_id, other.day));
        else inOtherStores += 1; // another store's transaction: the same money can't be in two stores
      }
    }
    plan.deleteIds = [...toDelete.keys()];
    for (const storeDay of toDelete.values()) {
      touched.add(storeDay);
      if (!fileDays.has(storeDay)) deletedElsewhere += 1;
    }
  } else if (!invalid.length) {
    const existing = db.prepare("SELECT 1 FROM daily_balances WHERE store_id = ? AND date = ?");
    plan.deleteKeys = [...fileDays].filter((storeDay) => {
      const [storeId, date] = storeDay.split("|");
      return Boolean(existing.get(Number(storeId), date));
    });
  }

  const closedKeys = new Set();
  if (!invalid.length) {
    const byStore = new Map();
    for (const storeDay of touched) {
      const [storeId, day] = storeDay.split("|");
      byStore.set(storeId, [...(byStore.get(storeId) ?? []), day]);
    }
    for (const [storeId, days] of byStore) {
      closedAmong(Number(storeId), days).forEach((date) => closedKeys.add(key(storeId, date)));
    }
  }
  if (closedKeys.size) plan.blocked = "closed";
  else if (inOtherStores) plan.blocked = "other_stores";

  const days = plan.toAdd.map(dayOf).sort();
  const sum = (type) => Math.round(plan.toAdd.filter((r) => r.type === type).reduce((s, r) => s + number(r.amount), 0) * 100) / 100;
  const toDelete = kind === "transactions" ? plan.deleteIds.length : plan.deleteKeys.length;
  return {
    kind,
    records,
    plan,
    summary: {
      kind,
      rows: records.length,
      to_add: plan.toAdd.length,
      to_delete: toDelete,
      deleted_elsewhere: deletedElsewhere,
      days: fileDays.size,
      duplicates_in_file: plan.duplicatesInFile,
      blocked: plan.blocked,
      closed_days: [...new Set([...closedKeys].map((k) => k.split("|")[1]))].sort(),
      in_other_stores: inOtherStores,
      first_date: days[0] ?? null,
      last_date: days.at(-1) ?? null,
      total_in: kind === "transactions" ? sum("cash_in") : null,
      total_out: kind === "transactions" ? sum("cash_out") : null,
      invalid_count: invalid.length,
      invalid: invalid.slice(0, RESTORE_LIMITS.maxErrorsShown),
    },
  };
};

const insertBackupTransaction = (r) =>
  db.prepare(
    `INSERT INTO transactions (id, type, amount, commission, sender_name, receiver_name, phone, customer_number, note,
       reference_number, service, currency, status, transaction_date, sort_order, created_by, created_date, updated_date, store_id)
     VALUES (@id, @type, @amount, @commission, @sender_name, @receiver_name, @phone, @customer_number, @note,
       @reference_number, @service, @currency, @status, @transaction_date, @sort_order, @created_by, @created_date, @updated_date, @store_id)`
  ).run({
    id: Number(r.id), type: r.type, amount: number(r.amount), commission: number(r.commission || "0"),
    sender_name: r.sender_name, receiver_name: r.receiver_name, phone: r.phone, customer_number: r.customer_number,
    note: r.note, reference_number: r.reference_number, service: r.service, currency: r.currency || "USD",
    status: r.status || "completed", transaction_date: r.transaction_date || null, sort_order: Number(r.sort_order) || 0,
    created_by: r.created_by || LEGACY_OWNER_EMAIL, created_date: r.created_date, updated_date: r.updated_date || r.created_date,
    store_id: r.store_id,
  });

const insertBackupBalance = (r) =>
  db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date, store_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(r.date, number(r.opening_balance), r.created_by || LEGACY_OWNER_EMAIL, r.created_date, r.updated_date || r.created_date, r.store_id);

export const registerRestoreRoutes = (app) => {
  const canRestore = requirePermission(P.DATA_RESTORE);
  // Restoring deletes the file's days first, so it also needs the right to delete data.
  const canReplace = requirePermission(P.DATA_PURGE);

  // The store that receives rows without a store_id (backups from before stores): the one asked
  // for, your own, or the only store. With several stores and none chosen, such rows are invalid.
  const defaultStoreFor = (req) => resolveStore(req.user, req.body?.store_id).id ?? null;

  app.post("/local-api/admin/restore/preview", canRestore, (req, res) => {
    if (req.body?.store_id != null && targetStore(req, res, req.body.store_id) === null) return;
    const result = planRestore(req.body?.csv, req.user, defaultStoreFor(req));
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.summary);
  });

  // `expected_count` / `expected_delete`: the rows the preview said would be added and deleted. The
  // plan is recomputed inside the database transaction; if either changed (someone added or deleted
  // meanwhile), nothing is written and the fresh summary is returned.
  app.post("/local-api/admin/restore", canRestore, canReplace, (req, res) => {
    const expected = req.body?.expected_count;
    const expectedDelete = req.body?.expected_delete;
    if (!Number.isInteger(expected) || expected < 0 || !Number.isInteger(expectedDelete) || expectedDelete < 0) {
      res.status(400).json({ error: "expected_count is required" });
      return;
    }
    if (req.body?.store_id != null && targetStore(req, res, req.body.store_id) === null) return;
    const defaultStore = defaultStoreFor(req);
    let outcome;
    db.transaction(() => {
      const result = planRestore(req.body?.csv, req.user, defaultStore);
      if (result.error) { outcome = { status: 400, body: { error: result.error } }; return; }
      if (result.summary.invalid_count) { outcome = { status: 400, body: { error: "The backup has invalid rows", ...result.summary } }; return; }
      if (result.plan.blocked === "closed") {
        outcome = { status: 423, body: { error: "The backup's days include closed days. Reopen them first.", ...result.summary } };
        return;
      }
      if (result.plan.blocked === "other_stores") {
        outcome = { status: 409, body: { error: "Some of these transactions are already recorded in another store", ...result.summary } };
        return;
      }
      if (result.summary.to_add !== expected || result.summary.to_delete !== expectedDelete) {
        outcome = { status: 409, body: { error: "The data changed since the preview. Check the counts and try again.", ...result.summary } };
        return;
      }
      const { plan } = result;
      if (result.kind === "transactions") {
        const remove = db.prepare("DELETE FROM transactions WHERE id = ?");
        plan.deleteIds.forEach((id) => remove.run(id));
      } else {
        const remove = db.prepare("DELETE FROM daily_balances WHERE store_id = ? AND date = ?");
        plan.deleteKeys.forEach((storeDay) => { const [storeId, date] = storeDay.split("|"); remove.run(Number(storeId), date); });
      }
      plan.toAdd.forEach(result.kind === "transactions" ? insertBackupTransaction : insertBackupBalance);
      outcome = { status: 200, body: { kind: result.kind, restored: plan.toAdd.length, deleted: result.summary.to_delete, days: result.summary.days } };
    })();
    if (outcome.status === 200) {
      console.log(`[admin] ${req.user.email} restored ${outcome.body.restored} ${outcome.body.kind} from a backup, replacing ${outcome.body.deleted} on ${outcome.body.days} day(s)`);
    }
    res.status(outcome.status).json(outcome.body);
  });
};
