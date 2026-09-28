// The dashboard's data, one query at a time (user's request, 2026-09-28): the browser no longer
// loads every transaction. Each answer covers the stores the user may see (server/stores.js): one
// store (store_id, the Admin's choice) or, for the Admin without one, every store.
//
//   GET  /local-api/dashboard/day?date=                 the day's transactions, in journal order
//   GET  /local-api/dashboard/summary?date=             the day's, month's and year's totals and the
//                                                       wallet figures (exact: counted over every row)
//   GET  /local-api/dashboard/search?q=[&month=YYYY-MM] matching transactions on any day, or on
//                                                       that month's days ("This month")
//   GET  /local-api/dashboard/party?party=sender|receiver&q=[&from=&to=]
//                                                       the sender / receiver report: rows and totals
//   POST /local-api/daily-balances/cleanup { date }     after deletes: remove that day's opening
//                                                       balance of every store left without transactions
//
// The 10,000 rule: a list (a day, a search, a report) returns at most MAX_ROWS rows; `total` is the
// full count and `truncated` says when rows were left out. Totals are always over every matching row.
import { requirePermission } from "./auth.js";
import { db } from "./db.js";
import { isIsoDate, refuseClosedRows } from "./office.js";
import { PERMISSIONS as P, hasPermission } from "./permissions.js";
import { matchesReceiver, matchesSearch, matchesSender } from "./search.js";
import { readStore, seesAllStores } from "./stores.js";
import { walletFigures } from "./wallet.js";

export const MAX_ROWS = 10000;

const isMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value));

const TX_DAY = "COALESCE(NULLIF(transaction_date, ''), substr(created_date, 1, 10))";
// Journal order: day, then import order (rows without one last), then when entered.
const JOURNAL = "day, COALESCE(sort_order, 999999), created_date, id";
const round = (value, places = 3) => Math.round((Number(value) || 0) * 10 ** places) / 10 ** places;

const inStore = (store) => (store.all ? { sql: "1 = 1", params: [] } : { sql: "store_id = ?", params: [store.id] });

// Rows with their day and their number within their store's day (the table's "#").
const journalRows = (store, where = "1 = 1", params = []) => {
  const scope = inStore(store);
  return db.prepare(
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY store_id, day ORDER BY COALESCE(sort_order, 999999), created_date, id) AS day_position
     FROM (SELECT *, ${TX_DAY} AS day FROM transactions WHERE ${scope.sql})
     WHERE ${where}
     ORDER BY ${JOURNAL}`
  );
};

// Keeps the first MAX_ROWS rows, counting them all.
const capped = (rows, keep = () => true) => {
  const kept = [];
  let total = 0;
  for (const row of rows) {
    if (!keep(row)) continue;
    total += 1;
    if (kept.length < MAX_ROWS) kept.push(row);
  }
  return { total, truncated: total > kept.length, transactions: kept };
};

const totalsOf = (store, where, params) => {
  const scope = inStore(store);
  const row = db.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount END), 0) AS deposits,
            COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount END), 0) AS withdrawals,
            COALESCE(SUM(commission), 0) AS commissions
     FROM (SELECT *, ${TX_DAY} AS day FROM transactions WHERE ${scope.sql}) WHERE ${where}`
  ).get(...scope.params, ...params);
  return { count: row.count, deposits: round(row.deposits), withdrawals: round(row.withdrawals), commissions: round(row.commissions) };
};

// Wallet figures: per store, added up for "All stores" (each store has its own wallet).
const walletOf = (store) => {
  const storeIds = store.all ? db.prepare("SELECT id FROM stores").all().map((s) => s.id) : [store.id];
  const net = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount END), 0) - COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount END), 0) AS net
     FROM transactions WHERE store_id = ? AND ${TX_DAY} = ?`
  );
  const balances = db.prepare("SELECT date, opening_balance FROM daily_balances WHERE store_id = ?");
  return (date) => storeIds.reduce((sum, storeId) => {
    const figures = walletFigures({ balances: balances.all(storeId), date, netOf: (day) => net.get(storeId, day).net });
    return { opening_balance: round(sum.opening_balance + figures.openingBalance), net_balance: round(sum.net_balance + figures.netBalance) };
  }, { opening_balance: 0, net_balance: 0 });
};

const dateOr400 = (res, value) => {
  if (isIsoDate(value)) return value;
  res.status(400).json({ error: "A valid date is required (YYYY-MM-DD)" });
  return null;
};

export const registerDashboardRoutes = (app) => {
  const canRead = requirePermission(P.TRANSACTIONS_READ);
  // Someone with no store: nothing to show (and no error, the dashboard explains it).
  const storeFor = (req, res) => {
    if (!seesAllStores(req.user) && req.user.store_id == null) return { none: true };
    return readStore(req, res, req.query.store_id ?? req.body?.store_id);
  };
  const empty = { total: 0, truncated: false, transactions: [] };

  app.get("/local-api/dashboard/day", canRead, (req, res) => {
    const date = dateOr400(res, req.query.date);
    if (!date) return;
    const store = storeFor(req, res);
    if (!store) return;
    if (store.none) { res.json({ date, ...empty }); return; }
    res.json({ date, ...capped(journalRows(store, "day = ?").iterate(...inStore(store).params, date)) });
  });

  app.get("/local-api/dashboard/summary", canRead, (req, res) => {
    const date = dateOr400(res, req.query.date);
    if (!date) return;
    const store = storeFor(req, res);
    if (!store) return;
    const zero = { count: 0, deposits: 0, withdrawals: 0, commissions: 0 };
    if (store.none) { res.json({ date, day: zero, month: zero, year: zero, wallet: { opening_balance: 0, net_balance: 0 } }); return; }
    res.json({
      date,
      day: totalsOf(store, "day = ?", [date]),
      month: totalsOf(store, "substr(day, 1, 7) = ?", [date.slice(0, 7)]),
      year: totalsOf(store, "substr(day, 1, 4) = ?", [date.slice(0, 4)]),
      wallet: hasPermission(req.user, P.BALANCES_READ) ? walletOf(store)(date) : null,
    });
  });

  app.get("/local-api/dashboard/search", canRead, (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const month = req.query.month || "";
    if (month && !isMonth(month)) { res.status(400).json({ error: "A valid month is required (YYYY-MM)" }); return; }
    const store = storeFor(req, res);
    if (!store) return;
    if (store.none || !q) { res.json({ q, month: month || null, ...empty }); return; }
    const rows = month
      ? journalRows(store, "substr(day, 1, 7) = ?").iterate(...inStore(store).params, month)
      : journalRows(store).iterate(...inStore(store).params);
    res.json({ q, month: month || null, ...capped(rows, (row) => matchesSearch(row, q)) });
  });

  app.get("/local-api/dashboard/party", canRead, (req, res) => {
    const party = req.query.party;
    const match = party === "sender" ? matchesSender : party === "receiver" ? matchesReceiver : null;
    if (!match) { res.status(400).json({ error: "Unknown report" }); return; }
    const q = String(req.query.q ?? "").trim();
    const from = req.query.from || "";
    const to = req.query.to || "";
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) { res.status(400).json({ error: "A valid date is required (YYYY-MM-DD)" }); return; }
    const store = storeFor(req, res);
    if (!store) return;
    const zero = { count: 0, deposits: 0, withdrawals: 0, commissions: 0 };
    if (store.none || !q) { res.json({ party, q, totals: zero, ...empty }); return; }
    const where = [from ? "day >= ?" : null, to ? "day <= ?" : null].filter(Boolean).join(" AND ") || "1 = 1";
    const params = [from, to].filter(Boolean);
    const totals = { ...zero };
    const result = capped(journalRows(store, where).iterate(...inStore(store).params, ...params), (row) => {
      if (!match(row, q)) return false;
      totals.count += 1;
      if (row.type === "cash_in") totals.deposits += Number(row.amount) || 0;
      if (row.type === "cash_out") totals.withdrawals += Number(row.amount) || 0;
      totals.commissions += Number(row.commission) || 0;
      return true;
    });
    res.json({ party, q, totals: { count: totals.count, deposits: round(totals.deposits), withdrawals: round(totals.withdrawals), commissions: round(totals.commissions) }, ...result });
  });

  // After transactions are deleted: a store's opening balance for the day goes when that store has
  // no transactions left on it (the server counts all of them — the browser can't: it only has one
  // day, capped). Closed days are refused (423), as for any change to their balance.
  app.post("/local-api/daily-balances/cleanup", requirePermission(P.BALANCES_WRITE), (req, res) => {
    const date = dateOr400(res, req.body?.date);
    if (!date) return;
    const store = storeFor(req, res);
    if (!store) return;
    if (store.none) { res.json({ deleted: 0 }); return; }
    const scope = inStore(store);
    const emptied = db.prepare(
      `SELECT b.id, b.store_id, b.date FROM daily_balances b
       WHERE b.date = ? AND ${scope.sql.replace("store_id", "b.store_id")}
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.store_id = b.store_id AND ${TX_DAY.replace(/transaction_date|created_date/g, (c) => `t.${c}`)} = b.date)`
    ).all(date, ...scope.params);
    if (refuseClosedRows(res, emptied)) return;
    const remove = db.prepare("DELETE FROM daily_balances WHERE id = ?");
    db.transaction(() => emptied.forEach((row) => remove.run(row.id)))();
    res.json({ deleted: emptied.length });
  });
};
