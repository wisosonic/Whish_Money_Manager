// Test-only: answers the mocked api.dashboard.* calls from in-memory rows, the way the server does
// (server/dashboard.js): the selected day in journal order with day_position, totals over every
// row, all-days search and the sender / receiver reports with the shared matching rules, the wallet
// with the server's own rule, and the 10,000-row cap. Lets dashboard tests keep plain fixtures.
//
//   installFakeDashboard(api, () => rows, () => balances, { maxRows })
import { matchesReceiver, matchesSearch, matchesSender } from "../../server/search.js";
import { walletFigures } from "../../server/wallet.js";

const dayOf = (t) => t.transaction_date || String(t.created_date || "").slice(0, 10);
const journal = (a, b) => dayOf(a).localeCompare(dayOf(b))
  || (a.sort_order ?? 999999) - (b.sort_order ?? 999999)
  || String(a.created_date).localeCompare(String(b.created_date))
  || a.id - b.id;
const round = (n) => Math.round(n * 1000) / 1000;
const totals = (rows) => ({
  count: rows.length,
  deposits: round(rows.filter((t) => t.type === "cash_in").reduce((s, t) => s + (Number(t.amount) || 0), 0)),
  withdrawals: round(rows.filter((t) => t.type === "cash_out").reduce((s, t) => s + (Number(t.amount) || 0), 0)),
  commissions: round(rows.reduce((s, t) => s + (Number(t.commission) || 0), 0)),
});

export const installFakeDashboard = (api, getRows, getBalances = () => [], { maxRows = 10000 } = {}) => {
  const inStore = (storeId) => (row) => storeId == null || row.store_id == null || row.store_id === storeId;
  // Every row, in journal order, numbered within its store's day.
  const numbered = (storeId) => {
    const counts = new Map();
    return [...getRows()].filter(inStore(storeId)).sort(journal).map((row) => {
      const key = `${row.store_id}|${dayOf(row)}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { ...row, day_position: n };
    });
  };
  const capped = (rows) => ({ total: rows.length, truncated: rows.length > maxRows, transactions: rows.slice(0, maxRows) });

  api.dashboard.day.mockImplementation(async (date, storeId) => ({ date, ...capped(numbered(storeId).filter((t) => dayOf(t) === date)) }));
  api.dashboard.summary.mockImplementation(async (date, storeId) => {
    const rows = getRows().filter(inStore(storeId));
    const stores = [...new Set([...rows.map((t) => t.store_id ?? null), ...getBalances().filter(inStore(storeId)).map((b) => b.store_id ?? null)])];
    const wallet = (stores.length ? stores : [null]).reduce((sum, store) => {
      const mine = (x) => (x.store_id ?? null) === store;
      const netOf = (day) => rows.filter((t) => mine(t) && dayOf(t) === day).reduce((s, t) => s + (t.type === "cash_in" ? 1 : t.type === "cash_out" ? -1 : 0) * (Number(t.amount) || 0), 0);
      const figures = walletFigures({ balances: getBalances().filter(mine), date, netOf });
      return { opening_balance: round(sum.opening_balance + figures.openingBalance), net_balance: round(sum.net_balance + figures.netBalance) };
    }, { opening_balance: 0, net_balance: 0 });
    return {
      date,
      day: totals(rows.filter((t) => dayOf(t) === date)),
      month: totals(rows.filter((t) => dayOf(t).startsWith(date.slice(0, 7)))),
      year: totals(rows.filter((t) => dayOf(t).startsWith(date.slice(0, 4)))),
      wallet,
    };
  });
  api.dashboard.search.mockImplementation(async (q, month, storeId) => ({
    q, month: month || null,
    ...capped(q ? numbered(storeId).filter((t) => (!month || dayOf(t).startsWith(month)) && matchesSearch(t, q)) : []),
  }));
  api.dashboard.party.mockImplementation(async ({ party, q, from, to, storeId }) => {
    const match = party === "sender" ? matchesSender : matchesReceiver;
    const rows = q ? numbered(storeId).filter((t) => match(t, q) && (!from || dayOf(t) >= from) && (!to || dayOf(t) <= to)) : [];
    return { party, q, totals: totals(rows), ...capped(rows) };
  });
  api.dashboard.cleanupBalances.mockImplementation(async () => ({ deleted: 0 }));
};
