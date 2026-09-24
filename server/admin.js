// Admin panel API (Admin + Manager): what a date range holds, a CSV backup of it, and deleting it.
//
//   GET  /local-api/admin/range                       first and last day that has any data
//   GET  /local-api/admin/summary?from=&to=           counts and totals for the range (the preview)
//   GET  /local-api/admin/export?kind=&from=&to=      CSV download; kind = transactions | balances
//   POST /local-api/admin/purge { from, to, expected_count }
//                                                     deletes the range's transactions AND opening
//                                                     balances, in one database transaction
//
// A transaction's day is transaction_date, or the date part of created_date when it has none —
// the same rule the dashboard uses. Ranges are inclusive, as YYYY-MM-DD.
import { requirePermission } from "./auth.js";
import { db } from "./db.js";
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

// One CSV cell. Quoted when needed (comma, quote, line break). Text that a spreadsheet would run as a
// formula (=…, @…, or +/- followed by anything but a plain number or phone) gets a leading ' so the
// backup can be opened safely in Excel; numbers and phone numbers like +96171… are kept exactly.
export const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^[+-][\d\s().]*$/.test(text)))) {
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
