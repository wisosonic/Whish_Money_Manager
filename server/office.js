// Per-store rules that aren't about a single transaction: closed days and the commission rate.
// Every route takes the store (`store_id`); without stores:all it's always your own store, and with
// it (the Admin) the one asked for — or the only store, when there's just one (server/stores.js).
//
//   GET    /local-api/closed-days[?store_id=]                   closed days (Admin, no store: every store's)
//   POST   /local-api/closed-days        { date, store_id }     close a store's day          (days:close)
//   DELETE /local-api/closed-days/:date?store_id=               reopen it                    (days:close)
//   GET    /local-api/commission-rates?store_id=[&date=]        a store's history, current rate, and rate on `date`
//   PUT    /local-api/commission-rates   { rate, effective_from, store_id }   set / correct a rate (settings:office)
//   DELETE /local-api/commission-rates/:effective_from?store_id=             remove a scheduled (future) rate
//
// Closed days are enforced by every route that changes transactions or opening balances (see
// refuseClosedDays / refuseClosedRows below, used in server/index.js and server/admin.js).
import { requirePermission } from "./auth.js";
import { BASE_RATE_DATE, db, nowIso } from "./db.js";
import { PERMISSIONS as P } from "./permissions.js";
import { readStore, targetStore } from "./stores.js";

export const isIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// A transaction's day: transaction_date, or the date part of created_date (same rule as the dashboard).
export const transactionDay = (row) =>
  String(row?.transaction_date || "").trim() || String(row?.created_date || nowIso()).slice(0, 10);

const todayIso = () => nowIso().slice(0, 10);

// ═══ Closed days ═══

export const CLOSED_DAY_ERROR = "This day is closed. Reopen it to make changes.";

// Which of these dates are closed in the store (unique, sorted).
export const closedAmong = (storeId, dates) => {
  const unique = [...new Set(dates.filter(Boolean))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => "?").join(",");
  return db.prepare(`SELECT date FROM closed_days WHERE store_id = ? AND date IN (${placeholders}) ORDER BY date`)
    .all(storeId, ...unique).map((r) => r.date);
};

// Responds 423 Locked (and returns true) when any of the store's dates is closed.
export const refuseClosedDays = (res, storeId, dates) => refuseClosedRows(res, dates.map((date) => ({ store_id: storeId, date })));

// The same for rows that may belong to different stores: [{ store_id, date }].
export const refuseClosedRows = (res, rows) => {
  const byStore = new Map();
  rows.filter((row) => row?.date).forEach((row) => byStore.set(row.store_id, [...(byStore.get(row.store_id) || []), row.date]));
  const closed = [...new Set([...byStore].flatMap(([storeId, dates]) => closedAmong(storeId, dates)))].sort();
  if (!closed.length) return false;
  res.status(423).json({ error: CLOSED_DAY_ERROR, closed_days: closed });
  return true;
};

// Closed days in a date range, in one store or (storeId null) in every store.
export const closedDaysBetween = (storeId, from, to) =>
  (storeId == null
    ? db.prepare("SELECT DISTINCT date FROM closed_days WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to)
    : db.prepare("SELECT date FROM closed_days WHERE store_id = ? AND date BETWEEN ? AND ? ORDER BY date").all(storeId, from, to)
  ).map((r) => r.date);

// ═══ Commission rate ═══

// A store's rate (percent) on a given day: its latest entry on or before it. 1% before any entry.
export const commissionRateOn = (storeId, date) => {
  const row = db.prepare("SELECT rate FROM commission_rates WHERE store_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1")
    .get(storeId, isIsoDate(date) ? date : todayIso());
  return row ? row.rate : 1;
};

const rateHistory = (storeId) =>
  db.prepare("SELECT rate, effective_from, created_by, created_date FROM commission_rates WHERE store_id = ? ORDER BY effective_from DESC").all(storeId);

// ═══ Routes ═══

export const registerOfficeRoutes = (app) => {
  const canRead = requirePermission(P.TRANSACTIONS_READ);
  const canClose = requirePermission(P.DAYS_CLOSE);
  const canSetRates = requirePermission(P.OFFICE_SETTINGS);

  // Without a store: the Admin gets every store's closed days (each row names its store); others
  // get their own store's. Someone with no store gets none.
  app.get("/local-api/closed-days", canRead, (req, res) => {
    if (req.query.store_id === undefined && req.user.store_id == null && !req.user.permissions.includes(P.STORES_ALL)) {
      res.json([]);
      return;
    }
    const scope = readStore(req, res, req.query.store_id);
    if (!scope) return;
    const rows = scope.all
      ? db.prepare("SELECT store_id, date, closed_by, closed_at FROM closed_days ORDER BY date DESC").all()
      : db.prepare("SELECT store_id, date, closed_by, closed_at FROM closed_days WHERE store_id = ? ORDER BY date DESC").all(scope.id);
    res.json(rows);
  });

  app.post("/local-api/closed-days", canClose, (req, res) => {
    const storeId = targetStore(req, res, req.body?.store_id);
    if (storeId === null) return;
    const date = req.body?.date;
    if (!isIsoDate(date)) {
      res.status(400).json({ error: "A valid date is required (YYYY-MM-DD)" });
      return;
    }
    if (db.prepare("SELECT 1 FROM closed_days WHERE store_id = ? AND date = ?").get(storeId, date)) {
      res.status(409).json({ error: "This day is already closed" });
      return;
    }
    db.prepare("INSERT INTO closed_days (store_id, date, closed_by, closed_at) VALUES (?, ?, ?, ?)").run(storeId, date, req.user.email, nowIso());
    console.log(`[office] ${req.user.email} closed ${date} (store ${storeId})`);
    res.status(201).json(db.prepare("SELECT store_id, date, closed_by, closed_at FROM closed_days WHERE store_id = ? AND date = ?").get(storeId, date));
  });

  app.delete("/local-api/closed-days/:date", canClose, (req, res) => {
    const storeId = targetStore(req, res, req.query.store_id);
    if (storeId === null) return;
    const { date } = req.params;
    const result = db.prepare("DELETE FROM closed_days WHERE store_id = ? AND date = ?").run(storeId, date);
    if (!result.changes) {
      res.status(404).json({ error: "This day isn't closed" });
      return;
    }
    console.log(`[office] ${req.user.email} reopened ${date} (store ${storeId})`);
    res.json({ ok: true, date, store_id: storeId });
  });

  app.get("/local-api/commission-rates", canRead, (req, res) => {
    const storeId = targetStore(req, res, req.query.store_id);
    if (storeId === null) return;
    const date = isIsoDate(req.query.date) ? req.query.date : todayIso();
    res.json({ store_id: storeId, date, rate: commissionRateOn(storeId, date), current: commissionRateOn(storeId, todayIso()), history: rateHistory(storeId) });
  });

  // Setting a rate for a date that already has one corrects it; otherwise it's a new step in the history.
  app.put("/local-api/commission-rates", canSetRates, (req, res) => {
    const storeId = targetStore(req, res, req.body?.store_id);
    if (storeId === null) return;
    const rate = req.body?.rate;
    const from = req.body?.effective_from;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100 || Math.round(rate * 1000) !== rate * 1000) {
      res.status(400).json({ error: "The rate must be a number from 0 to 100, with up to 3 decimals" });
      return;
    }
    if (!isIsoDate(from) || from <= BASE_RATE_DATE) {
      res.status(400).json({ error: "A valid effective date is required (YYYY-MM-DD)" });
      return;
    }
    db.prepare(
      `INSERT INTO commission_rates (store_id, rate, effective_from, created_by, created_date) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(store_id, effective_from) DO UPDATE SET rate = excluded.rate, created_by = excluded.created_by, created_date = excluded.created_date`
    ).run(storeId, rate, from, req.user.email, nowIso());
    console.log(`[office] ${req.user.email} set the commission rate of store ${storeId} to ${rate}% from ${from}`);
    const current = commissionRateOn(storeId, todayIso());
    res.json({ store_id: storeId, rate: current, current, history: rateHistory(storeId) });
  });

  // Only scheduled (future) rates can be removed: past ones are history, corrected by a newer entry.
  app.delete("/local-api/commission-rates/:effective_from", canSetRates, (req, res) => {
    const storeId = targetStore(req, res, req.query.store_id);
    if (storeId === null) return;
    const from = req.params.effective_from;
    if (!isIsoDate(from) || from <= todayIso()) {
      res.status(400).json({ error: "Only a rate that hasn't started yet can be removed" });
      return;
    }
    const result = db.prepare("DELETE FROM commission_rates WHERE store_id = ? AND effective_from = ?").run(storeId, from);
    if (!result.changes) {
      res.status(404).json({ error: "No rate starts on that date" });
      return;
    }
    res.json({ store_id: storeId, current: commissionRateOn(storeId, todayIso()), history: rateHistory(storeId) });
  });
};
