// Admin panel API: who can use it, the range preview, CSV backups, and deleting a date range.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, grantLaterPermissions } from "../../server/db.js";
import { BALANCE_CSV_COLUMNS, TRANSACTION_CSV_COLUMNS, csvCell, parseRange } from "../../server/admin.js";
import { DEFAULT_ROLES, PERMISSIONS } from "../../server/permissions.js";
import { createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;

beforeAll(async () => {
  srv = await startServer();
  const users = createTestUsers();
  client = await loginAll(makeClient(srv.baseUrl), users);
});

afterAll(() => srv.close());

const now = "2026-09-24T10:00:00.000Z";
const addTx = (tx) =>
  db.prepare(
    `INSERT INTO transactions (type, amount, commission, sender_name, receiver_name, phone, note, reference_number,
       service, transaction_date, sort_order, created_by, created_date, updated_date, store_id)
     VALUES (@type, @amount, @commission, @sender_name, @receiver_name, @phone, @note, @reference_number,
       @service, @transaction_date, @sort_order, 'admin@test.local', @created_date, @created_date, @store_id)`
  ).run({
    type: "cash_in", amount: 10, commission: 0.1, sender_name: "", receiver_name: "", phone: "", note: "",
    reference_number: "", service: "", transaction_date: null, sort_order: 0, created_date: now, store_id: 1, ...tx,
  }).lastInsertRowid;
const addBalance = (date, opening_balance) =>
  db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date, store_id) VALUES (?, ?, 'admin@test.local', ?, ?, 1)")
    .run(date, opening_balance, now, now);

const seed = () => {
  db.exec("DELETE FROM transactions; DELETE FROM daily_balances;");
  addTx({ transaction_date: "2026-08-31", amount: 5, sender_name: "BEFORE RANGE" });
  addTx({ transaction_date: "2026-09-01", amount: 100, commission: 1, sender_name: "خليل فقيه", sort_order: 1, reference_number: "tr:2" });
  addTx({ transaction_date: "2026-09-01", type: "cash_out", amount: 40, commission: 0, sender_name: "Vicario", sort_order: 0, reference_number: "tr:1",
    note: 'said "hi", then left\nsecond line', phone: "+96171389296" });
  addTx({ transaction_date: "2026-09-15", amount: 50, commission: 0.5, sender_name: "=SUM(A1:A9)", receiver_name: "@cmd", service: "+cmd|calc", note: "-12.50" });
  // No transaction_date: its day comes from created_date (the dashboard's rule).
  addTx({ transaction_date: "", amount: 7, commission: 0.07, sender_name: "NO DATE", created_date: "2026-09-30T23:00:00.000Z" });
  addTx({ transaction_date: "2026-10-01", amount: 9, sender_name: "AFTER RANGE" });
  addBalance("2026-08-31", 1);
  addBalance("2026-09-01", 1000);
  addBalance("2026-09-15", 2000);
  addBalance("2026-10-01", 3);
};
beforeEach(seed);

const get = (as, route) => client.request("GET", route, { as });
const purge = (as, body) => client.request("POST", "/admin/purge", { as, body });
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const SEPT = "from=2026-09-01&to=2026-09-30";

describe("who can use the admin panel", () => {
  it.each(["admin", "manager"])("%s can preview, export and delete", async (as) => {
    expect((await get(as, "/admin/range")).status).toBe(200);
    expect((await get(as, `/admin/summary?${SEPT}`)).status).toBe(200);
    expect((await get(as, `/admin/export?kind=transactions&${SEPT}`)).status).toBe(200);
    expect((await purge(as, { from: "2026-10-01", to: "2026-10-01", expected_count: 1 })).status).toBe(200);
  });

  it("a User gets 403 everywhere, and nothing is deleted", async () => {
    for (const route of ["/admin/range", `/admin/summary?${SEPT}`, `/admin/export?kind=transactions&${SEPT}`]) {
      const res = await get("user", route);
      expect(res.status).toBe(403);
      expect(res.body.missing).toEqual([PERMISSIONS.DATA_EXPORT]);
    }
    const res = await purge("user", { from: "2026-09-01", to: "2026-09-30", expected_count: 4 });
    expect(res.status).toBe(403);
    expect(res.body.missing).toEqual([PERMISSIONS.DATA_PURGE]);
    expect(count("transactions")).toBe(6);
    expect(count("daily_balances")).toBe(4);
  });

  it("requires a session", async () => {
    expect((await client.request("GET", "/admin/range")).status).toBe(401);
    expect((await client.request("POST", "/admin/purge", { body: { from: "2026-09-01", to: "2026-09-30", expected_count: 4 } })).status).toBe(401);
    expect(count("transactions")).toBe(6);
  });

  it("the default roles: Admin and Manager have both permissions, User has neither", () => {
    const perms = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, r.permissions]));
    expect(perms.admin).toEqual(expect.arrayContaining([PERMISSIONS.DATA_EXPORT, PERMISSIONS.DATA_PURGE]));
    expect(perms.manager).toEqual(expect.arrayContaining([PERMISSIONS.DATA_EXPORT, PERMISSIONS.DATA_PURGE]));
    expect(perms.user).not.toContain(PERMISSIONS.DATA_EXPORT);
    expect(perms.user).not.toContain(PERMISSIONS.DATA_PURGE);
  });
});

describe("range and preview", () => {
  it("reports the first and last day that has any data", async () => {
    const { body } = await get("admin", "/admin/range");
    expect(body).toEqual({ first_date: "2026-08-31", last_date: "2026-10-01" });
  });

  it("summarizes a range: counts, days and totals (both dates included)", async () => {
    const { status, body } = await get("admin", `/admin/summary?${SEPT}`);
    expect(status).toBe(200);
    expect(body).toEqual({
      from: "2026-09-01", to: "2026-09-30", store_id: null,
      transactions: 4, opening_balances: 2, days: 3,
      first_date: "2026-09-01", last_date: "2026-09-30",
      total_in: 157, total_out: 40, total_commission: 1.57,
    });
  });

  it.each([
    ["missing dates", ""],
    ["a malformed date", "from=2026-9-1&to=2026-09-30"],
    ["an impossible date", "from=2026-02-30&to=2026-03-01"],
  ])("rejects %s with 400", async (_label, query) => {
    const res = await get("admin", `/admin/summary?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A valid date range is required (from and to, YYYY-MM-DD)");
  });

  it("rejects a start date after the end date", async () => {
    const res = await get("admin", "/admin/summary?from=2026-09-30&to=2026-09-01");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The start date must be on or before the end date");
  });
});

describe("CSV backup", () => {
  const lines = (text) => text.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("downloads the range's transactions as a CSV attachment, in journal order", async () => {
    const res = await get("admin", `/admin/export?kind=transactions&${SEPT}`);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="transactions_2026-09-01_2026-09-30.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = res.body;
    // The UTF-8 BOM (EF BB BF) so Excel reads Arabic correctly. fetch's text() strips it, so check the bytes.
    const raw = await fetch(`${srv.baseUrl}/admin/export?kind=transactions&${SEPT}`, { headers: { Cookie: client.jar.admin } });
    expect([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, ...rows] = lines(text);
    expect(header).toBe(TRANSACTION_CSV_COLUMNS.join(","));
    // Sept 1 (import order 0, then 1), Sept 15, then the row dated by created_date (Sept 30).
    expect(rows.map((r) => r.split(",")[5])).toHaveLength(4);
    expect(rows[0]).toContain("Vicario");
    expect(rows[1]).toContain("خليل فقيه");
    expect(text).not.toContain("BEFORE RANGE");
    expect(text).not.toContain("AFTER RANGE");
    expect(text).toContain("NO DATE");
  });

  it("quotes commas, quotes and line breaks, and keeps phone numbers and plain numbers as they are", async () => {
    const res = await get("admin", `/admin/export?kind=transactions&${SEPT}`);
    expect(res.body).toContain('"said ""hi"", then left\nsecond line"');
    expect(res.body).toContain(",+96171389296,");
    expect(res.body).toContain(",-12.50,");
  });

  it("neutralizes text a spreadsheet would run as a formula", async () => {
    const res = await get("admin", `/admin/export?kind=transactions&${SEPT}`);
    expect(res.body).toContain(",'=SUM(A1:A9),");
    expect(res.body).toContain(",'@cmd,");
    expect(res.body).toContain(",'+cmd|calc,");
  });

  it("downloads the range's opening balances", async () => {
    const res = await get("manager", `/admin/export?kind=balances&${SEPT}`);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="opening-balances_store-1_2026-09-01_2026-09-30.csv"');
    const [header, ...rows] = lines(res.body);
    expect(header).toBe(BALANCE_CSV_COLUMNS.join(","));
    expect(rows.map((r) => r.split(",").slice(1, 3).join(","))).toEqual(["2026-09-01,1000", "2026-09-15,2000"]);
  });

  it("an empty range still gives a CSV with just the header", async () => {
    const res = await get("admin", "/admin/export?kind=transactions&from=2020-01-01&to=2020-01-31");
    expect(lines(res.body)).toEqual([TRANSACTION_CSV_COLUMNS.join(",")]);
  });

  it("rejects an unknown kind and a bad range", async () => {
    expect((await get("admin", `/admin/export?kind=users&${SEPT}`)).body).toEqual({ error: "Unknown export kind" });
    expect((await get("admin", "/admin/export?kind=transactions&from=x&to=y")).status).toBe(400);
  });

  it("csvCell rules", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell("+961 71 389 296")).toBe("+961 71 389 296");
    expect(csvCell("(71) 389-296")).toBe("(71) 389-296");
    expect(csvCell("-")).toBe("-");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(parseRange("2026-01-01", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });
});

describe("deleting a date range", () => {
  it("deletes the range's transactions and opening balances only, in one go", async () => {
    const res = await purge("admin", { from: "2026-09-01", to: "2026-09-30", expected_count: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "2026-09-01", to: "2026-09-30", store_id: null, deleted_transactions: 4, deleted_opening_balances: 2 });
    const left = db.prepare("SELECT sender_name FROM transactions ORDER BY id").all().map((r) => r.sender_name);
    expect(left).toEqual(["BEFORE RANGE", "AFTER RANGE"]);
    expect(db.prepare("SELECT date FROM daily_balances ORDER BY date").all().map((r) => r.date)).toEqual(["2026-08-31", "2026-10-01"]);
  });

  it("refuses (409) and deletes nothing when the count no longer matches what was confirmed", async () => {
    const res = await purge("manager", { from: "2026-09-01", to: "2026-09-30", expected_count: 3 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "The data changed since the preview. Check the counts and try again.", transactions: 4 });
    expect(count("transactions")).toBe(6);
    expect(count("daily_balances")).toBe(4);
  });

  it("can delete a range that only has opening balances (confirmed count 0)", async () => {
    db.exec("DELETE FROM transactions WHERE transaction_date = '2026-09-15'");
    const res = await purge("admin", { from: "2026-09-15", to: "2026-09-15", expected_count: 0 });
    expect(res.body).toMatchObject({ deleted_transactions: 0, deleted_opening_balances: 1 });
  });

  it.each([
    ["no expected_count", { from: "2026-09-01", to: "2026-09-30" }, "expected_count is required"],
    ["a text expected_count", { from: "2026-09-01", to: "2026-09-30", expected_count: "4" }, "expected_count is required"],
    ["a bad range", { from: "2026-09-30", to: "2026-09-01", expected_count: 4 }, "The start date must be on or before the end date"],
  ])("rejects %s with 400 and deletes nothing", async (_label, body, error) => {
    const res = await purge("admin", body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
    expect(count("transactions")).toBe(6);
  });

  it("must be JSON", async () => {
    const res = await client.request("POST", "/admin/purge", {
      as: "admin", rawBody: "from=2026-09-01&to=2026-09-30&expected_count=4",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
    expect(count("transactions")).toBe(6);
  });
});

describe("upgrading an existing database", () => {
  const permsOf = (name) => JSON.parse(db.prepare("SELECT permissions FROM roles WHERE name = ?").get(name).permissions);
  const setPerms = (name, list) => db.prepare("UPDATE roles SET permissions = ? WHERE name = ?").run(JSON.stringify(list), name);

  it("grants the new permissions once to Admin and Manager, never to User, and never re-adds a removed one", () => {
    // A database from before the admin panel: roles without the new permissions, no record of the grant.
    const without = (list) => list.filter((p) => ![PERMISSIONS.DATA_EXPORT, PERMISSIONS.DATA_PURGE].includes(p));
    setPerms("admin", without(permsOf("admin")));
    setPerms("manager", without(permsOf("manager")));
    db.exec("DELETE FROM app_meta WHERE key LIKE 'granted:%'");

    grantLaterPermissions();
    expect(permsOf("admin")).toEqual(expect.arrayContaining([PERMISSIONS.DATA_EXPORT, PERMISSIONS.DATA_PURGE]));
    expect(permsOf("manager")).toEqual(expect.arrayContaining([PERMISSIONS.DATA_EXPORT, PERMISSIONS.DATA_PURGE]));
    expect(permsOf("user")).not.toContain(PERMISSIONS.DATA_EXPORT);
    expect(db.prepare("SELECT value FROM app_meta WHERE key = 'granted:data:purge'").get().value).toBe('["admin","manager"]');

    // Removed on purpose afterwards: running again doesn't bring it back.
    setPerms("manager", without(permsOf("manager")));
    grantLaterPermissions();
    expect(permsOf("manager")).not.toContain(PERMISSIONS.DATA_PURGE);
    setPerms("manager", [...permsOf("manager"), PERMISSIONS.DATA_EXPORT, PERMISSIONS.DATA_PURGE]);
  });
});
