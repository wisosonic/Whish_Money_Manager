// Office-wide rules that aren't about a single transaction: closed days and the commission rate.
//
//   GET    /local-api/closed-days                     every closed day (anyone who can read transactions)
//   POST   /local-api/closed-days        { date }     close a day                      (days:close)
//   DELETE /local-api/closed-days/:date               reopen it                        (days:close)
//   GET    /local-api/commission-rates[?date=]        history, the current rate, and the rate on `date`
//   PUT    /local-api/commission-rates   { rate, effective_from }   set / correct a rate (settings:office)
//   DELETE /local-api/commission-rates/:effective_from             remove a scheduled (future) rate
//
// Closed days are enforced by every route that changes transactions or opening balances (see
// refuseClosedDays below, used in server/index.js and server/admin.js).
import { requirePermission } from "./auth.js";
import { BASE_RATE_DATE, db, nowIso } from "./db.js";
import { PERMISSIONS as P } from "./permissions.js";

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

// Which of these dates are closed (unique, sorted).
export const closedAmong = (dates) => {
  const unique = [...new Set(dates.filter(Boolean))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => "?").join(",");
  return db.prepare(`SELECT date FROM closed_days WHERE date IN (${placeholders}) ORDER BY date`).all(...unique).map((r) => r.date);
};

// Responds 423 Locked (and returns true) when any of the dates is closed.
export const refuseClosedDays = (res, dates) => {
  const closed = closedAmong(dates);
  if (!closed.length) return false;
  res.status(423).json({ error: CLOSED_DAY_ERROR, closed_days: closed });
  return true;
};

export const closedDaysBetween = (from, to) =>
  db.prepare("SELECT date FROM closed_days WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to).map((r) => r.date);

// ═══ Commission rate ═══

// The office rate (percent) on a given day: the latest entry on or before it. 1% before any entry.
export const commissionRateOn = (date) => {
  const row = db.prepare("SELECT rate FROM commission_rates WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1")
    .get(isIsoDate(date) ? date : todayIso());
  return row ? row.rate : 1;
};

const rateHistory = () =>
  db.prepare("SELECT rate, effective_from, created_by, created_date FROM commission_rates ORDER BY effective_from DESC").all();

// ═══ Routes ═══

export const registerOfficeRoutes = (app) => {
  const canRead = requirePermission(P.TRANSACTIONS_READ);
  const canClose = requirePermission(P.DAYS_CLOSE);
  const canSetRates = requirePermission(P.OFFICE_SETTINGS);

  app.get("/local-api/closed-days", canRead, (_req, res) => {
    res.json(db.prepare("SELECT date, closed_by, closed_at FROM closed_days ORDER BY date DESC").all());
  });

  app.post("/local-api/closed-days", canClose, (req, res) => {
    const date = req.body?.date;
    if (!isIsoDate(date)) {
      res.status(400).json({ error: "A valid date is required (YYYY-MM-DD)" });
      return;
    }
    if (db.prepare("SELECT 1 FROM closed_days WHERE date = ?").get(date)) {
      res.status(409).json({ error: "This day is already closed" });
      return;
    }
    db.prepare("INSERT INTO closed_days (date, closed_by, closed_at) VALUES (?, ?, ?)").run(date, req.user.email, nowIso());
    console.log(`[office] ${req.user.email} closed ${date}`);
    res.status(201).json(db.prepare("SELECT date, closed_by, closed_at FROM closed_days WHERE date = ?").get(date));
  });

  app.delete("/local-api/closed-days/:date", canClose, (req, res) => {
    const { date } = req.params;
    const result = db.prepare("DELETE FROM closed_days WHERE date = ?").run(date);
    if (!result.changes) {
      res.status(404).json({ error: "This day isn't closed" });
      return;
    }
    console.log(`[office] ${req.user.email} reopened ${date}`);
    res.json({ ok: true, date });
  });

  app.get("/local-api/commission-rates", canRead, (req, res) => {
    const date = isIsoDate(req.query.date) ? req.query.date : todayIso();
    res.json({ date, rate: commissionRateOn(date), current: commissionRateOn(todayIso()), history: rateHistory() });
  });

  // Setting a rate for a date that already has one corrects it; otherwise it's a new step in the history.
  app.put("/local-api/commission-rates", canSetRates, (req, res) => {
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
      `INSERT INTO commission_rates (rate, effective_from, created_by, created_date) VALUES (?, ?, ?, ?)
       ON CONFLICT(effective_from) DO UPDATE SET rate = excluded.rate, created_by = excluded.created_by, created_date = excluded.created_date`
    ).run(rate, from, req.user.email, nowIso());
    console.log(`[office] ${req.user.email} set the commission rate to ${rate}% from ${from}`);
    res.json({ rate: commissionRateOn(todayIso()), current: commissionRateOn(todayIso()), history: rateHistory() });
  });

  // Only scheduled (future) rates can be removed: past ones are history, corrected by a newer entry.
  app.delete("/local-api/commission-rates/:effective_from", canSetRates, (req, res) => {
    const from = req.params.effective_from;
    if (!isIsoDate(from) || from <= todayIso()) {
      res.status(400).json({ error: "Only a rate that hasn't started yet can be removed" });
      return;
    }
    const result = db.prepare("DELETE FROM commission_rates WHERE effective_from = ?").run(from);
    if (!result.changes) {
      res.status(404).json({ error: "No rate starts on that date" });
      return;
    }
    res.json({ current: commissionRateOn(todayIso()), history: rateHistory() });
  });
};
