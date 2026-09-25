// Admin panel API (Admin + Manager): what a date range holds, a CSV backup of it, and deleting it.
//
//   GET  /local-api/admin/range                       first and last day that has any data
//   GET  /local-api/admin/summary?from=&to=           counts and totals for the range (the preview)
//   GET  /local-api/admin/export?kind=&from=&to=      CSV download; kind = transactions | balances
//   POST /local-api/admin/purge { from, to, expected_count }
//                                                     deletes the range's transactions AND opening
//                                                     balances, in one database transaction
//   POST /local-api/admin/restore/preview { csv }     what restoring a backup CSV would add (data:restore)
//   POST /local-api/admin/restore { csv, expected_count }   add those rows back
//
// A transaction's day is transaction_date, or the date part of created_date when it has none —
// the same rule the dashboard uses. Ranges are inclusive, as YYYY-MM-DD.
import { requirePermission } from "./auth.js";
import { parseCsvText } from "./csv.js";
import { LEGACY_OWNER_EMAIL, db } from "./db.js";
import { closedAmong, closedDaysBetween, transactionDay } from "./office.js";
import { PERMISSIONS as P } from "./permissions.js";

const TX_DAY = "COALESCE(NULLIF(transaction_date, ''), substr(created_date, 1, 10))";

export const TRANSACTION_CSV_COLUMNS = [
  "id", "transaction_date", "type", "amount", "commission", "sender_name", "receiver_name", "phone",
  "customer_number", "reference_number", "service", "note", "currency", "status", "sort_order",
  "created_by", "created_date", "updated_date",
];
export const BALANCE_CSV_COLUMNS = ["id", "date", "opening_balance", "created_by", "created_date", "updated_date"];

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
const selectTransactions = (from, to) =>
  db.prepare(`SELECT * FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ? ORDER BY ${TX_DAY}, sort_order, id`).all(from, to);
const selectBalances = (from, to) =>
  db.prepare("SELECT * FROM daily_balances WHERE date BETWEEN ? AND ? ORDER BY date, id").all(from, to);
const countTransactions = (from, to) =>
  db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ?`).get(from, to).n;

const summarize = (from, to) => {
  const tx = db.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount END), 0) AS total_out,
            COALESCE(SUM(commission), 0) AS total_commission,
            COUNT(DISTINCT ${TX_DAY}) AS days,
            MIN(${TX_DAY}) AS first_date, MAX(${TX_DAY}) AS last_date
     FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ?`
  ).get(from, to);
  const balances = db.prepare("SELECT COUNT(*) AS n FROM daily_balances WHERE date BETWEEN ? AND ?").get(from, to).n;
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    from,
    to,
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

  app.get("/local-api/admin/range", canExport, (_req, res) => {
    const tx = db.prepare(`SELECT MIN(${TX_DAY}) AS first, MAX(${TX_DAY}) AS last FROM transactions`).get();
    const ob = db.prepare("SELECT MIN(date) AS first, MAX(date) AS last FROM daily_balances").get();
    const dates = [tx.first, tx.last, ob.first, ob.last].filter(Boolean).sort();
    res.json({ first_date: dates[0] ?? null, last_date: dates.at(-1) ?? null });
  });

  app.get("/local-api/admin/summary", canExport, (req, res) => {
    const range = parseRange(req.query.from, req.query.to);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    res.json(summarize(range.from, range.to));
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
    const csv = kind === "transactions"
      ? toCsv(TRANSACTION_CSV_COLUMNS, selectTransactions(range.from, range.to))
      : toCsv(BALANCE_CSV_COLUMNS, selectBalances(range.from, range.to));
    const filename = `${kind === "transactions" ? "transactions" : "opening-balances"}_${range.from}_${range.to}.csv`;
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
    const closed = closedDaysBetween(range.from, range.to);
    if (closed.length) {
      res.status(423).json({ error: "The range includes closed days. Reopen them first.", closed_days: closed });
      return;
    }
    const result = db.transaction(() => {
      const current = countTransactions(range.from, range.to);
      if (current !== expected) return { conflict: current };
      const deletedTransactions = db.prepare(`DELETE FROM transactions WHERE ${TX_DAY} BETWEEN ? AND ?`).run(range.from, range.to).changes;
      const deletedBalances = db.prepare("DELETE FROM daily_balances WHERE date BETWEEN ? AND ?").run(range.from, range.to).changes;
      return { deletedTransactions, deletedBalances };
    })();
    if (result.conflict !== undefined) {
      res.status(409).json({ error: "The data changed since the preview. Check the counts and try again.", transactions: result.conflict });
      return;
    }
    console.log(`[admin] ${req.user.email} deleted ${result.deletedTransactions} transactions and ${result.deletedBalances} opening balances from ${range.from} to ${range.to}`);
    res.json({ from: range.from, to: range.to, deleted_transactions: result.deletedTransactions, deleted_opening_balances: result.deletedBalances });
  });
};

// ═══ Restore from a backup ═══
// Adds back rows from a CSV this panel exported (transactions or opening balances). Rows are matched
// by their original id: ids are never reused (AUTOINCREMENT), so a row whose id still exists is
// already there and is skipped, and a missing one is re-inserted exactly as it was (same id, dates,
// "entered by"). Opening balances are matched by date (one per day). Rows on closed days are skipped.
// Any invalid row rejects the whole file — a damaged or hand-edited backup is never half-restored.

// Undo csvCell's spreadsheet guard: a leading ' is removed only where csvCell would have added it.
const unguard = (text) => (text.startsWith("'") && needsGuard(text.slice(1)) ? text.slice(1) : text);

const RESTORE_LIMITS = { maxRows: 100000, maxErrorsShown: 20 };

const parseBackup = (csv) => {
  const text = String(csv || "").replace(/^﻿/, "");
  const rows = parseCsvText(text, ",").filter((row) => row.some((cell) => cell !== ""));
  if (!rows.length) return { error: "The file is empty" };
  const header = rows[0].map((h) => h.trim());
  const has = (columns) => columns.every((c) => header.includes(c));
  const kind = has(TRANSACTION_CSV_COLUMNS) ? "transactions" : has(BALANCE_CSV_COLUMNS) ? "balances" : null;
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

// What restoring the file would do, without changing anything.
const planRestore = (csv) => {
  const parsed = parseBackup(csv);
  if (parsed.error) return parsed;
  const { kind, records } = parsed;
  const validate = kind === "transactions" ? validateTransaction : validateBalance;
  // Each invalid row is reported as { line, field } — the first column whose value isn't valid.
  const invalid = records.map((r) => ({ line: r.line, field: validate(r) })).filter((x) => x.field);
  const dayOf = (r) => (kind === "transactions" ? transactionDay(r) : r.date);
  const closed = new Set(closedAmong(records.map(dayOf)));

  const existsById = db.prepare("SELECT 1 FROM transactions WHERE id = ?");
  const existsByDate = db.prepare("SELECT 1 FROM daily_balances WHERE date = ?");
  const seen = new Set();
  const plan = { toAdd: [], existing: 0, onClosedDays: 0, duplicatesInFile: 0 };
  if (!invalid.length) {
    for (const r of records) {
      const key = kind === "transactions" ? Number(r.id) : r.date;
      if (seen.has(key)) { plan.duplicatesInFile += 1; continue; }
      seen.add(key);
      if (closed.has(dayOf(r))) plan.onClosedDays += 1;
      else if (kind === "transactions" ? existsById.get(key) : existsByDate.get(key)) plan.existing += 1;
      else plan.toAdd.push(r);
    }
  }
  const days = plan.toAdd.map(dayOf).sort();
  const sum = (type) => Math.round(plan.toAdd.filter((r) => r.type === type).reduce((s, r) => s + number(r.amount), 0) * 100) / 100;
  return {
    kind,
    records,
    plan,
    summary: {
      kind,
      rows: records.length,
      to_add: plan.toAdd.length,
      existing: plan.existing,
      on_closed_days: plan.onClosedDays,
      duplicates_in_file: plan.duplicatesInFile,
      closed_days: [...closed].sort(),
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
       reference_number, service, currency, status, transaction_date, sort_order, created_by, created_date, updated_date)
     VALUES (@id, @type, @amount, @commission, @sender_name, @receiver_name, @phone, @customer_number, @note,
       @reference_number, @service, @currency, @status, @transaction_date, @sort_order, @created_by, @created_date, @updated_date)`
  ).run({
    id: Number(r.id), type: r.type, amount: number(r.amount), commission: number(r.commission || "0"),
    sender_name: r.sender_name, receiver_name: r.receiver_name, phone: r.phone, customer_number: r.customer_number,
    note: r.note, reference_number: r.reference_number, service: r.service, currency: r.currency || "USD",
    status: r.status || "completed", transaction_date: r.transaction_date || null, sort_order: Number(r.sort_order) || 0,
    created_by: r.created_by || LEGACY_OWNER_EMAIL, created_date: r.created_date, updated_date: r.updated_date || r.created_date,
  });

const insertBackupBalance = (r) =>
  db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date) VALUES (?, ?, ?, ?, ?)")
    .run(r.date, number(r.opening_balance), r.created_by || LEGACY_OWNER_EMAIL, r.created_date, r.updated_date || r.created_date);

export const registerRestoreRoutes = (app) => {
  const canRestore = requirePermission(P.DATA_RESTORE);

  app.post("/local-api/admin/restore/preview", canRestore, (req, res) => {
    const result = planRestore(req.body?.csv);
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.summary);
  });

  // `expected_count` is the number of rows the preview said would be added. The plan is recomputed
  // inside the database transaction; if it changed (someone added or deleted meanwhile), nothing
  // is written and the fresh summary is returned.
  app.post("/local-api/admin/restore", canRestore, (req, res) => {
    const expected = req.body?.expected_count;
    if (!Number.isInteger(expected) || expected < 0) {
      res.status(400).json({ error: "expected_count is required" });
      return;
    }
    let outcome;
    db.transaction(() => {
      const result = planRestore(req.body?.csv);
      if (result.error) { outcome = { status: 400, body: { error: result.error } }; return; }
      if (result.summary.invalid_count) { outcome = { status: 400, body: { error: "The backup has invalid rows", ...result.summary } }; return; }
      if (result.plan.toAdd.length !== expected) {
        outcome = { status: 409, body: { error: "The data changed since the preview. Check the counts and try again.", ...result.summary } };
        return;
      }
      result.plan.toAdd.forEach(result.kind === "transactions" ? insertBackupTransaction : insertBackupBalance);
      outcome = { status: 200, body: { kind: result.kind, restored: result.plan.toAdd.length, skipped_existing: result.plan.existing, skipped_closed: result.plan.onClosedDays } };
    })();
    if (outcome.status === 200) {
      console.log(`[admin] ${req.user.email} restored ${outcome.body.restored} ${outcome.body.kind} from a backup`);
    }
    res.status(outcome.status).json(outcome.body);
  });
};
