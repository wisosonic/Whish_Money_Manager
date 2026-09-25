// Admin panel → Reports (Admin + Manager, data:export). Read-only summaries.
//
//   GET /local-api/admin/reports/income?year=YYYY[&store_id=]
//       commissions (profit), cash in, cash out and count per month — the dashboard chart's data
//   GET /local-api/admin/reports/parties?party=sender|receiver&from=&to=&by=volume|count&limit=[&store_id=]
//       the top senders (of Cash In) or recipients (of Cash Out) in a date range
//   GET /local-api/admin/reports/stores?from=&to=          (stores:all — the Admin)
//       every store side by side: transactions, cash in, cash out, commission, share of the volume
//
// Store: the Admin gets one store (store_id) or, without it, every store; a Manager always their own.
//
// A transaction's day is transaction_date, or the date part of created_date (as everywhere else).
import { parseRange } from "./admin.js";
import { requirePermission } from "./auth.js";
import { db } from "./db.js";
import { PERMISSIONS as P } from "./permissions.js";
import { isPhoneLike, normalizePhone } from "./parties.js";
import { readStore } from "./stores.js";

const TX_DAY = "COALESCE(NULLIF(transaction_date, ''), substr(created_date, 1, 10))";
const round = (value, places = 2) => Math.round((Number(value) || 0) * 10 ** places) / 10 ** places;
// { all: true } or { id } (from readStore) → a condition on store_id.
const inStore = (store) => (store?.all ? { sql: "1 = 1", params: [] } : { sql: "store_id = ?", params: [store.id] });

// ═══ Income by month ═══

// 12 rows of raw sums (months without transactions are zero); the page rounds them and blanks
// months that haven't happened yet, like the dashboard chart (src/lib/monthlyChartData.js).
export const incomeByMonth = (year, store = { all: true }) => {
  const scope = inStore(store);
  const rows = db.prepare(
    `SELECT CAST(substr(day, 6, 2) AS INTEGER) AS month, COUNT(*) AS count,
            COALESCE(SUM(commission), 0) AS profit,
            COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount END), 0) AS cashIn,
            COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount END), 0) AS cashOut
     FROM (SELECT *, ${TX_DAY} AS day FROM transactions WHERE ${scope.sql}) WHERE substr(day, 1, 5) = ? GROUP BY month`
  ).all(...scope.params, `${year}-`);
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return Array.from({ length: 12 }, (_, i) => {
    const row = byMonth.get(i + 1);
    return { month: i + 1, count: row?.count ?? 0, profit: row?.profit ?? 0, cashIn: row?.cashIn ?? 0, cashOut: row?.cashOut ?? 0 };
  });
};

// Years that have transactions, newest first.
export const yearsWithData = (store = { all: true }) =>
  db.prepare(`SELECT DISTINCT substr(${TX_DAY}, 1, 4) AS year FROM transactions WHERE ${inStore(store).sql} ORDER BY year DESC`).all(...inStore(store).params)
    .map((row) => row.year)
    .filter((year) => /^\d{4}$/.test(year));

// ═══ Top senders / recipients ═══

// Senders are who sent money in (Cash In); recipients are who money was sent to (Cash Out). The
// other side of those rows is the office's own account (the importers put the account name there),
// so leaving it out keeps the office itself off both lists.
export const PARTY_REPORTS = {
  sender: { type: "cash_in", nameField: "sender_name" },
  receiver: { type: "cash_out", nameField: "receiver_name" },
};
export const RANK_BY = ["volume", "count"];
export const MAX_LIMIT = 500;

const normalizeName = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
// The most used value; ties go to the shortest (a number's short local form, as the table shows it).
const mostCommon = (counts) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).length - String(b[0]).length || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;

// Groups the report's rows by person. The phone / customer number on these rows belongs to that
// person, and identifies a wallet better than a spelling does, so rows are grouped by number when
// there is one, and by name otherwise. A name seen without a number joins the number it's used with,
// when it's used with exactly one. Rows with neither are counted as "unnamed".
export const rankParties = (rows, party, { by = "volume", limit = 10 } = {}) => {
  const { nameField } = PARTY_REPORTS[party];
  const groups = new Map();
  const unnamed = { rows: 0, volume: 0 };
  let totalVolume = 0;
  let totalCommission = 0;

  const groupFor = (key) => {
    if (!groups.has(key)) {
      groups.set(key, { key, count: 0, volume: 0, commission: 0, first: null, last: null, names: new Map(), numbers: new Map() });
    }
    return groups.get(key);
  };
  const add = (group, row) => {
    group.count += row.count;
    group.volume += row.volume;
    group.commission += row.commission;
    if (row.first && (!group.first || row.first < group.first)) group.first = row.first;
    if (row.last && (!group.last || row.last > group.last)) group.last = row.last;
    for (const [name, n] of row.names) group.names.set(name, (group.names.get(name) || 0) + n);
    for (const [number, n] of row.numbers) group.numbers.set(number, (group.numbers.get(number) || 0) + n);
  };

  for (const t of rows) {
    const amount = Number(t.amount) || 0;
    const commission = Number(t.commission) || 0;
    totalVolume += amount;
    totalCommission += commission;
    const rawName = String(t[nameField] ?? "").trim().replace(/\s+/g, " ");
    const name = rawName && !isPhoneLike(rawName) ? rawName : "";
    const number = String(t.customer_number ?? "").trim() || String(t.phone ?? "").trim() || (isPhoneLike(rawName) ? rawName : "");
    const numberKey = normalizePhone(number).length >= 7 ? normalizePhone(number) : "";
    const key = numberKey ? `p:${numberKey}` : name ? `n:${normalizeName(name)}` : null;
    if (!key) {
      unnamed.rows += 1;
      unnamed.volume += amount;
      continue;
    }
    add(groupFor(key), {
      count: 1,
      volume: amount,
      commission,
      first: t.day,
      last: t.day,
      names: name ? new Map([[name, 1]]) : new Map(),
      numbers: numberKey ? new Map([[number, 1]]) : new Map(),
    });
  }

  // A name used with exactly one number (and also without one) is the same person.
  const numberGroupsByName = new Map();
  for (const group of groups.values()) {
    if (!group.key.startsWith("p:")) continue;
    for (const name of group.names.keys()) {
      const key = normalizeName(name);
      numberGroupsByName.set(key, new Set([...(numberGroupsByName.get(key) || []), group]));
    }
  }
  for (const group of [...groups.values()]) {
    if (!group.key.startsWith("n:")) continue;
    const matches = [...(numberGroupsByName.get(group.key.slice(2)) || [])];
    if (matches.length === 1) {
      add(matches[0], group);
      groups.delete(group.key);
    }
  }

  const ranked = [...groups.values()].map((group) => {
    const name = mostCommon(group.names);
    const number = mostCommon(group.numbers);
    return {
      name,
      number,
      label: name || number,
      count: group.count,
      volume: round(group.volume),
      average: round(group.volume / group.count),
      commission: round(group.commission, 3),
      share: totalVolume > 0 ? round(group.volume / totalVolume, 4) : 0,
      first_date: group.first,
      last_date: group.last,
    };
  });
  const byVolume = (a, b) => b.volume - a.volume || b.count - a.count;
  const byCount = (a, b) => b.count - a.count || b.volume - a.volume;
  ranked.sort((a, b) => (by === "count" ? byCount(a, b) : byVolume(a, b)) || String(a.label).localeCompare(String(b.label)));

  return {
    party,
    by,
    totals: {
      rows: rows.length,
      volume: round(totalVolume),
      commission: round(totalCommission, 3),
      parties: ranked.length,
      unnamed_rows: unnamed.rows,
      unnamed_volume: round(unnamed.volume),
    },
    rows: ranked.slice(0, limit).map((row, index) => ({ rank: index + 1, ...row })),
  };
};

// ═══ Routes ═══

export const registerReportRoutes = (app) => {
  const canView = requirePermission(P.DATA_EXPORT);

  app.get("/local-api/admin/reports/income", canView, (req, res) => {
    const year = String(req.query.year ?? "");
    if (!/^\d{4}$/.test(year)) {
      res.status(400).json({ error: "A valid year is required (YYYY)" });
      return;
    }
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;
    res.json({ year, store_id: store.all ? null : store.id, years: yearsWithData(store), months: incomeByMonth(year, store) });
  });

  app.get("/local-api/admin/reports/parties", canView, (req, res) => {
    const party = String(req.query.party ?? "");
    if (!PARTY_REPORTS[party]) {
      res.status(400).json({ error: "Unknown report" });
      return;
    }
    const range = parseRange(req.query.from, req.query.to);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    const by = String(req.query.by ?? "volume");
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!RANK_BY.includes(by) || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      res.status(400).json({ error: "Unknown report option" });
      return;
    }
    const store = readStore(req, res, req.query.store_id);
    if (!store) return;
    const scope = inStore(store);
    const { type, nameField } = PARTY_REPORTS[party];
    const rows = db.prepare(
      `SELECT amount, commission, ${nameField}, phone, customer_number, ${TX_DAY} AS day
       FROM transactions WHERE type = ? AND ${TX_DAY} BETWEEN ? AND ? AND ${scope.sql}`
    ).all(type, range.from, range.to, ...scope.params);
    res.json({ from: range.from, to: range.to, store_id: store.all ? null : store.id, ...rankParties(rows, party, { by, limit }) });
  });

  // Every store in the range, busiest first (stores without transactions are listed too, at 0).
  app.get("/local-api/admin/reports/stores", canView, requirePermission(P.STORES_ALL), (req, res) => {
    const range = parseRange(req.query.from, req.query.to);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    const rows = db.prepare(
      `SELECT s.id, s.name, s.location,
              COUNT(t.id) AS count,
              COALESCE(SUM(CASE WHEN t.type = 'cash_in' THEN t.amount END), 0) AS cash_in,
              COALESCE(SUM(CASE WHEN t.type = 'cash_out' THEN t.amount END), 0) AS cash_out,
              COALESCE(SUM(t.commission), 0) AS commission
       FROM stores s
       LEFT JOIN transactions t ON t.store_id = s.id AND COALESCE(NULLIF(t.transaction_date, ''), substr(t.created_date, 1, 10)) BETWEEN ? AND ?
       GROUP BY s.id`
    ).all(range.from, range.to);
    const totalVolume = rows.reduce((sum, row) => sum + row.cash_in + row.cash_out, 0);
    const stores = rows
      .map((row) => {
        const volume = row.cash_in + row.cash_out;
        return {
          id: row.id, name: row.name, location: row.location, count: row.count,
          cash_in: round(row.cash_in), cash_out: round(row.cash_out), volume: round(volume), commission: round(row.commission, 3),
          share: totalVolume > 0 ? round(volume / totalVolume, 4) : 0,
        };
      })
      .sort((a, b) => b.volume - a.volume || b.count - a.count || a.name.localeCompare(b.name));
    const totals = stores.reduce(
      (sum, row) => ({ count: sum.count + row.count, cash_in: round(sum.cash_in + row.cash_in), cash_out: round(sum.cash_out + row.cash_out), volume: round(sum.volume + row.volume), commission: round(sum.commission + row.commission, 3) }),
      { count: 0, cash_in: 0, cash_out: 0, volume: 0, commission: 0 }
    );
    res.json({ from: range.from, to: range.to, totals, stores });
  });
};
