// The dashboard's data, one query at a time: the selected day, exact totals, all-days search, the
// sender / receiver reports and the opening-balance cleanup — with the 10,000-row rule on lists.
// (User-reported: with many rows on later days, earlier days showed no data.)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../../server/auth.js";
import { MAX_ROWS } from "../../server/dashboard.js";
import { db } from "../../server/db.js";
import { walletFigures } from "../../server/wallet.js";
import { PASSWORD, assignToStore, createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;
let store2;

beforeAll(async () => {
  srv = await startServer();
  const users = createTestUsers();
  store2 = db.prepare("INSERT INTO stores (name, created_date, updated_date) VALUES ('Second', 'x', 'x')").run().lastInsertRowid;
  users.other = assignToStore(createUser({ email: "other@test.local", full_name: "Other", password: PASSWORD, role: "user" }), store2);
  users.loose = createUser({ email: "loose@test.local", full_name: "Loose", password: PASSWORD, role: "user" });
  client = await loginAll(makeClient(srv.baseUrl), users);
});
afterAll(() => srv.close());
beforeEach(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM daily_balances").run();
  db.prepare("DELETE FROM closed_days").run();
});

const insert = db.prepare(
  `INSERT INTO transactions (type, amount, commission, sender_name, receiver_name, phone, customer_number, transaction_date, sort_order, created_by, created_date, updated_date, store_id)
   VALUES (@type, @amount, @commission, @sender_name, @receiver_name, @phone, @customer_number, @transaction_date, @sort_order, 'admin@test.local', @created_date, @created_date, @store_id)`
);
// `count` rows on `date` (store 1 unless said), entered at `enteredAt` (newest last by default).
const addDay = (date, count, over = {}, enteredAt = `${date}T10:00:00.000Z`) => db.transaction(() => {
  for (let i = 0; i < count; i++) {
    insert.run({ type: "cash_in", amount: 10, commission: 0.1, sender_name: `S${i}`, receiver_name: "", phone: "", customer_number: "",
      transaction_date: date, sort_order: i, created_date: enteredAt, store_id: 1, ...over });
  }
})();
const get = (route, as = "admin") => client.request("GET", route, { as });
const day = (date, as, extra = "") => get(`/dashboard/day?date=${date}${extra}`, as);

describe("the selected day is its own query", () => {
  it("day 1 with 100 rows and day 2 with 1,000: each day shows its own rows (the reported case)", async () => {
    addDay("2026-09-01", 100);
    addDay("2026-09-02", 1000);
    const first = (await day("2026-09-01")).body;
    expect(first).toMatchObject({ date: "2026-09-01", total: 100, truncated: false });
    expect(first.transactions).toHaveLength(100);
    expect((await day("2026-09-02")).body.transactions).toHaveLength(1000);
  });

  it("an old day still shows when more than 10,000 newer rows were entered after it", async () => {
    addDay("2026-08-01", 5, {}, "2026-08-01T10:00:00.000Z");
    addDay("2026-09-10", MAX_ROWS + 20, {}, "2026-09-10T10:00:00.000Z");
    expect((await day("2026-08-01")).body.transactions).toHaveLength(5);
  });

  it("the 10,000 rule: a day returns at most 10,000 rows, and says how many there are", async () => {
    addDay("2026-09-10", MAX_ROWS + 50);
    const { body } = await day("2026-09-10");
    expect(MAX_ROWS).toBe(10000);
    expect(body.transactions).toHaveLength(10000);
    expect(body).toMatchObject({ total: 10050, truncated: true });
  });

  it("rows come in journal order (import order, then time entered), each with its number in the day", async () => {
    insert.run({ type: "cash_in", amount: 1, commission: 0, sender_name: "second", receiver_name: "", phone: "", customer_number: "", transaction_date: "2026-09-05", sort_order: 1, created_date: "2026-09-05T09:00:00Z", store_id: 1 });
    insert.run({ type: "cash_in", amount: 1, commission: 0, sender_name: "first", receiver_name: "", phone: "", customer_number: "", transaction_date: "2026-09-05", sort_order: 0, created_date: "2026-09-05T10:00:00Z", store_id: 1 });
    insert.run({ type: "cash_in", amount: 1, commission: 0, sender_name: "manual", receiver_name: "", phone: "", customer_number: "", transaction_date: "2026-09-05", sort_order: null, created_date: "2026-09-05T08:00:00Z", store_id: 1 });
    const rows = (await day("2026-09-05")).body.transactions;
    expect(rows.map((r) => r.sender_name)).toEqual(["first", "second", "manual"]);
    expect(rows.map((r) => r.day_position)).toEqual([1, 2, 3]);
  });

  it("a row with no transaction date belongs to the day it was entered", async () => {
    addDay("", 2, { transaction_date: "" }, "2026-09-07T12:00:00.000Z");
    expect((await day("2026-09-07")).body.total).toBe(2);
  });

  it("stores: each store's people see its rows; the Admin one store or all; no store, nothing", async () => {
    addDay("2026-09-03", 3);
    addDay("2026-09-03", 2, { store_id: store2 });
    expect((await day("2026-09-03", "user")).body.total).toBe(3);
    expect((await day("2026-09-03", "other")).body.total).toBe(2);
    expect((await day("2026-09-03", "admin")).body.total).toBe(5);
    expect((await day("2026-09-03", "admin", `&store_id=${store2}`)).body.total).toBe(2);
    expect((await day("2026-09-03", "user", `&store_id=${store2}`)).status).toBe(403);
    expect((await day("2026-09-03", "loose")).body).toMatchObject({ total: 0, transactions: [] });
  });

  it("refuses a missing or malformed date", async () => {
    for (const date of ["", "2026-9-1", "yesterday"]) expect((await day(date)).status).toBe(400);
  });
});

describe("totals are exact, over every row", () => {
  it("the day's, month's and year's totals count every row, beyond 10,000", async () => {
    addDay("2026-09-10", MAX_ROWS + 50); // 10,050 × $10, commission 0.1
    addDay("2026-09-11", 10, { type: "cash_out", commission: 0 });
    addDay("2026-02-01", 1);
    addDay("2025-12-31", 1);
    const { body } = await get("/dashboard/summary?date=2026-09-10");
    expect(body.day).toEqual({ count: 10050, deposits: 100500, withdrawals: 0, commissions: 1005 });
    expect(body.month).toEqual({ count: 10060, deposits: 100500, withdrawals: 100, commissions: 1005 });
    expect(body.year.count).toBe(10061);
  });

  it("the wallet: the day's opening balance, or the previous day's plus its net; and the latest balance day's total", async () => {
    db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date, store_id) VALUES ('2026-09-01', 1000, 'x', 'x', 'x', 1)").run();
    addDay("2026-09-01", 3); // +30
    addDay("2026-09-01", 1, { type: "cash_out", amount: 5, commission: 0 }); // −5
    expect((await get("/dashboard/summary?date=2026-09-01")).body.wallet).toEqual({ opening_balance: 1000, net_balance: 1025 });
    expect((await get("/dashboard/summary?date=2026-09-02")).body.wallet).toEqual({ opening_balance: 1025, net_balance: 1025 });
    expect((await get("/dashboard/summary?date=2026-09-05")).body.wallet.opening_balance).toBe(0);
  });

  it("All stores adds up each store's wallet", async () => {
    db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date, store_id) VALUES ('2026-09-01', 100, 'x', 'x', 'x', 1), ('2026-09-01', 200, 'x', 'x', 'x', ?)").run(store2);
    addDay("2026-09-01", 1, { store_id: store2 }); // +10 in store 2
    expect((await get("/dashboard/summary?date=2026-09-01")).body.wallet).toEqual({ opening_balance: 300, net_balance: 310 });
    expect((await get("/dashboard/summary?date=2026-09-01", "other")).body.wallet).toEqual({ opening_balance: 200, net_balance: 210 });
  });

  it("the wallet rule itself (as the dashboard always did)", () => {
    const netOf = (date) => ({ "2026-09-22": 50 }[date] || 0);
    expect(walletFigures({ balances: [{ date: "2026-09-22", opening_balance: 100 }], date: "2026-09-23", netOf })).toEqual({ openingBalance: 150, netBalance: 150 });
    expect(walletFigures({ balances: [{ date: "2026-09-23", opening_balance: 0 }], date: "2026-09-23", netOf })).toMatchObject({ openingBalance: 0 });
    expect(walletFigures({ balances: [], date: "2026-09-23", netOf })).toEqual({ openingBalance: 0, netBalance: 0 });
  });
});

describe("all-days search", () => {
  it("finds matches on any day, with the dashboard's matching rules, in journal order", async () => {
    addDay("2026-09-01", 1, { sender_name: "MOUNIR TOSKA", phone: "96171588017", customer_number: "71588017" });
    addDay("2026-09-02", 1, { sender_name: "OTHER", amount: 1500 });
    addDay("2026-09-03", 1, { sender_name: "Mounir again" });
    const search = async (q, as = "admin") => (await get(`/dashboard/search?q=${encodeURIComponent(q)}`, as)).body;
    expect((await search("mounir")).transactions.map((r) => r.transaction_date)).toEqual(["2026-09-01", "2026-09-03"]);
    expect((await search("+961 71 588 017")).total).toBe(1);
    expect((await search("$1,500")).transactions[0].sender_name).toBe("OTHER");
    expect((await search("")).total).toBe(0);
    expect((await search("mounir", "other")).total).toBe(0); // another store's rows
  });

  it("'This month': month=YYYY-MM keeps the matches on that month's days only", async () => {
    addDay("2026-08-31", 1, { sender_name: "Rami" });
    addDay("2026-09-01", 1, { sender_name: "Rami" });
    addDay("2026-09-30", 1, { sender_name: "Rami" });
    addDay("2026-10-01", 1, { sender_name: "Rami" });
    addDay("2025-09-15", 1, { sender_name: "Rami" }); // same month, another year
    const { body } = await get("/dashboard/search?q=rami&month=2026-09");
    expect(body.transactions.map((r) => r.transaction_date)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(body).toMatchObject({ month: "2026-09", total: 2, truncated: false });
    // A row without transaction_date counts on its created_date's day, as everywhere else.
    addDay("", 1, { sender_name: "Rami", created_date: "2026-09-12T08:00:00Z" });
    expect((await get("/dashboard/search?q=rami&month=2026-09")).body.total).toBe(3);
    expect((await get("/dashboard/search?q=rami")).body.total).toBe(6);
    expect((await get("/dashboard/search?q=rami&month=2026-09", "other")).body.total).toBe(0); // another store
  });

  it.each(["2026-9", "2026-13", "09-2026", "2026-09-01", "x"])("refuses the month %s", async (month) => {
    const res = await get(`/dashboard/search?q=a&month=${month}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A valid month is required (YYYY-MM)");
  });

  it("the 10,000 rule applies to search results too", async () => {
    addDay("2026-09-10", MAX_ROWS + 5, { sender_name: "Same Name" });
    const { body } = await get("/dashboard/search?q=same");
    expect(body.transactions).toHaveLength(10000);
    expect(body).toMatchObject({ total: 10005, truncated: true });
  });
});

describe("sender / receiver reports", () => {
  it("match like before, over every day (optionally between two dates); totals cover every match", async () => {
    addDay("2026-09-01", 2, { sender_name: "Rami Haddad", amount: 100, commission: 1 });
    addDay("2026-09-05", 1, { type: "cash_out", sender_name: "Rami Haddad", amount: 30, commission: 0 });
    addDay("2026-09-05", 1, { type: "cash_out", receiver_name: "", customer_number: "71588017", amount: 40, commission: 0 });
    const report = async (query) => (await get(`/dashboard/party?${new URLSearchParams(query)}`)).body;
    expect((await report({ party: "sender", q: "rami" })).totals).toEqual({ count: 3, deposits: 200, withdrawals: 30, commissions: 2 });
    expect((await report({ party: "sender", q: "rami", from: "2026-09-02" })).totals.count).toBe(1);
    expect((await report({ party: "receiver", q: "071 588 017" })).totals).toMatchObject({ count: 1, withdrawals: 40 });
    expect((await get("/dashboard/party?party=office&q=x")).status).toBe(400);
  });

  it("rows are capped at 10,000, totals are not", async () => {
    addDay("2026-09-10", MAX_ROWS + 3, { sender_name: "Bulk" });
    const { body } = await get("/dashboard/party?party=sender&q=bulk");
    expect(body.transactions).toHaveLength(10000);
    expect(body).toMatchObject({ total: 10003, truncated: true, totals: { count: 10003 } });
  });
});

describe("opening balance cleanup after deletes", () => {
  const balance = (date, storeId = 1) =>
    db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date, store_id) VALUES (?, 500, 'x', 'x', 'x', ?)").run(date, storeId);
  const cleanup = (body, as = "admin") => client.request("POST", "/daily-balances/cleanup", { as, body });
  const balances = () => db.prepare("SELECT store_id, date FROM daily_balances ORDER BY store_id").all();

  it("removes a day's balance only for stores left without transactions that day", async () => {
    balance("2026-09-01");
    balance("2026-09-01", store2);
    addDay("2026-09-01", 1, { store_id: store2 });
    expect((await cleanup({ date: "2026-09-01" })).body).toEqual({ deleted: 1 });
    expect(balances()).toEqual([{ store_id: store2, date: "2026-09-01" }]);
  });

  it("keeps it while the day still has rows — even an old day behind more than 10,000 newer rows", async () => {
    balance("2026-08-01");
    addDay("2026-08-01", 1, {}, "2026-08-01T10:00:00.000Z");
    addDay("2026-09-10", MAX_ROWS + 1, {}, "2026-09-10T10:00:00.000Z");
    expect((await cleanup({ date: "2026-08-01" })).body).toEqual({ deleted: 0 });
    expect(balances()).toHaveLength(1);
  });

  it("only in your own store, not on a closed day, and only for those who may change balances", async () => {
    balance("2026-09-01");
    balance("2026-09-01", store2);
    expect((await cleanup({ date: "2026-09-01" }, "user")).status).toBe(403); // no balances:write
    expect((await cleanup({ date: "2026-09-01" }, "manager")).body).toEqual({ deleted: 1 }); // their store only
    expect(balances()).toEqual([{ store_id: store2, date: "2026-09-01" }]);
    db.prepare("INSERT INTO closed_days (store_id, date, closed_by, closed_at) VALUES (?, '2026-09-01', 'x', 'x')").run(store2);
    expect((await cleanup({ date: "2026-09-01", store_id: store2 })).status).toBe(423);
    expect(balances()).toHaveLength(1);
  });
});
