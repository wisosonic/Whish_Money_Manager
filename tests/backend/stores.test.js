// Stores: managing them (Admin), their Manager (one per store) and Users (added by the Manager), and
// store scoping on every route: the Admin sees and works in every store, others only in their own.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "../../server/auth.js";
import { db } from "../../server/db.js";
import { PASSWORD, createTestUsers, firstStoreId, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;
let users;
let store1;
let store2;

const as = (who) => ({
  get: (route) => client.request("GET", route, { as: who }),
  post: (route, body) => client.request("POST", route, { as: who, body }),
  put: (route, body) => client.request("PUT", route, { as: who, body }),
  del: (route) => client.request("DELETE", route, { as: who }),
});
const count = (table, where = "1=1", ...params) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
const tx = (storeId, over = {}) => {
  const now = "2026-09-24T10:00:00.000Z";
  return db.prepare(
    `INSERT INTO transactions (type, amount, commission, sender_name, receiver_name, reference_number, transaction_date, created_by, created_date, updated_date, store_id)
     VALUES (@type, @amount, 0, @sender_name, '', @reference_number, @transaction_date, 'admin@test.local', @now, @now, @store_id)`
  ).run({ type: "cash_in", amount: 10, sender_name: "S", reference_number: "", transaction_date: "2026-09-10", now, store_id: storeId, ...over }).lastInsertRowid;
};

beforeAll(async () => {
  srv = await startServer();
  users = createTestUsers(); // manager manages the first store; user and user2 belong to it
  users.manager2 = createUser({ email: "manager2@test.local", full_name: "Second Manager", password: PASSWORD, role: "manager" });
  users.user3 = createUser({ email: "user3@test.local", full_name: "Third User", password: PASSWORD, role: "user" });
  users.loose = createUser({ email: "loose@test.local", full_name: "No Store", password: PASSWORD, role: "user" });
  client = await loginAll(makeClient(srv.baseUrl), users);
  store1 = firstStoreId();
  const created = await as("admin").post("/stores", { name: "Tripoli Branch", location: "Tripoli, Main street", phone: "+961 6 123 456", email: "tripoli@office.test" });
  store2 = created.body.id;
  await as("admin").put(`/stores/${store2}/manager`, { user_id: users.manager2.id });
  await as("manager2").post(`/stores/${store2}/members`, { user_id: users.user3.id });
});
afterAll(() => srv.close());

describe("managing stores (Admin)", () => {
  it("creates a store with name, location and contact details; it starts with the 1% rate", async () => {
    const { status, body } = await as("admin").post("/stores", { name: "  Online Shop ", location: "Online", phone: "71 000 000", email: "shop@office.test" });
    expect(status).toBe(201);
    expect(body).toMatchObject({ name: "Online Shop", location: "Online", phone: "71 000 000", email: "shop@office.test", manager: null, member_count: 0, transaction_count: 0 });
    expect(db.prepare("SELECT rate, effective_from FROM commission_rates WHERE store_id = ?").all(body.id)).toEqual([{ rate: 1, effective_from: "2000-01-01" }]);
  });

  it("validates: a name is required, unique (any case); a bad email is refused", async () => {
    expect((await as("admin").post("/stores", { name: " " })).body.error).toBe("A store name is required");
    const dup = await as("admin").post("/stores", { name: "tripoli branch" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("A store with this name already exists");
    expect((await as("admin").post("/stores", { name: "X", email: "nope" })).status).toBe(400);
    expect((await as("admin").post("/stores", { name: "Y".repeat(101) })).status).toBe(400);
  });

  it("edits details; lists every store with its Manager and counts", async () => {
    const { body } = await as("admin").put(`/stores/${store2}`, { phone: "+961 6 999 999" });
    expect(body).toMatchObject({ name: "Tripoli Branch", phone: "+961 6 999 999", manager: { id: users.manager2.id, email: "manager2@test.local" }, member_count: 2 });
    const list = (await as("admin").get("/stores")).body;
    expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(["Tripoli Branch", "Online Shop"]));
    expect(list.find((s) => s.id === store1).manager.email).toBe("manager@test.local");
  });

  it("only the Admin manages stores: Managers and Users get 403, and nothing changes", async () => {
    for (const who of ["manager", "user"]) {
      expect((await as(who).post("/stores", { name: `By ${who}` })).status).toBe(403);
      expect((await as(who).put(`/stores/${store1}`, { name: "Renamed" })).status).toBe(403);
      expect((await as(who).del(`/stores/${store2}`)).status).toBe(403);
      expect((await as(who).put(`/stores/${store1}/manager`, { user_id: users.manager.id })).status).toBe(403);
    }
    expect(count("stores", "name LIKE 'By %'")).toBe(0);
  });

  it("deletes only an empty store, never the last one; its members are left without a store", async () => {
    const { body: shop } = await as("admin").post("/stores", { name: "Pop-up" });
    await as("admin").put(`/users/${users.loose.id}`, { store_id: shop.id });
    tx(shop.id);
    const refused = await as("admin").del(`/stores/${shop.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("This store still has transactions or opening balances. Move or delete them first.");
    db.prepare("DELETE FROM transactions WHERE store_id = ?").run(shop.id);
    expect((await as("admin").del(`/stores/${shop.id}`)).status).toBe(200);
    expect(db.prepare("SELECT store_id FROM users WHERE id = ?").get(users.loose.id).store_id).toBeNull();
    expect(count("commission_rates", "store_id = ?", shop.id)).toBe(0);
  });
});

describe("a store's Manager (one per store, one store per Manager)", () => {
  it("only an active user with the Manager role can manage a store", async () => {
    const res = await as("admin").put(`/stores/${store2}/manager`, { user_id: users.user.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Only a user with the Manager role can manage a store");
  });

  it("assigning a Manager replaces the previous one (left without a store); a Manager moved from another store leaves it", async () => {
    const temp = createUser({ email: "temp-manager@test.local", full_name: "Temp", password: PASSWORD, role: "manager" });
    const { body: shop } = await as("admin").post("/stores", { name: "Temp Shop" });
    await as("admin").put(`/stores/${shop.id}/manager`, { user_id: temp.id });
    // Move temp to store2: store2's Manager (manager2) is replaced, and Temp Shop loses its Manager.
    const moved = await as("admin").put(`/stores/${store2}/manager`, { user_id: temp.id });
    expect(moved.body.manager.id).toBe(temp.id);
    expect(db.prepare("SELECT manager_id FROM stores WHERE id = ?").get(shop.id).manager_id).toBeNull();
    expect(db.prepare("SELECT store_id FROM users WHERE id = ?").get(users.manager2.id).store_id).toBeNull();
    // Put things back.
    await as("admin").put(`/stores/${store2}/manager`, { user_id: users.manager2.id });
    expect(db.prepare("SELECT store_id FROM users WHERE id = ?").get(temp.id).store_id).toBeNull();
    const cleared = await as("admin").put(`/stores/${shop.id}/manager`, { user_id: null });
    expect(cleared.body.manager).toBeNull();
    await as("admin").del(`/stores/${shop.id}`);
  });

  it("/auth/me says which store someone works in and whether they manage it", async () => {
    expect((await as("manager2").get("/auth/me")).body).toMatchObject({ store_id: store2, store_name: "Tripoli Branch", manages_store: true });
    expect((await as("user3").get("/auth/me")).body).toMatchObject({ store_id: store2, manages_store: false });
    expect((await as("admin").get("/auth/me")).body).toMatchObject({ store_id: null });
  });
});

describe("a store's Users (added by its Manager)", () => {
  it("the Manager sees who can be added (Users not in a store yet) and adds / removes them", async () => {
    const assignable = (await as("manager2").get(`/stores/${store2}/assignable`)).body.map((u) => u.email);
    expect(assignable).toContain("loose@test.local");
    expect(assignable).not.toContain("user@test.local"); // already in store 1
    const added = await as("manager2").post(`/stores/${store2}/members`, { user_id: users.loose.id });
    expect(added.status).toBe(200);
    expect(added.body.members.map((m) => m.email)).toContain("loose@test.local");
    const removed = await as("manager2").del(`/stores/${store2}/members/${users.loose.id}`);
    expect(removed.body.members.map((m) => m.email)).not.toContain("loose@test.local");
  });

  it("a Manager can't take a User from another store, add a Manager, or manage another store's members", async () => {
    const taken = await as("manager2").post(`/stores/${store2}/members`, { user_id: users.user.id });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("This user already belongs to another store");
    expect((await as("manager2").post(`/stores/${store2}/members`, { user_id: users.manager.id })).status).toBe(400);
    expect((await as("manager2").post(`/stores/${store1}/members`, { user_id: users.loose.id })).status).toBe(404);
    expect(db.prepare("SELECT store_id FROM users WHERE id = ?").get(users.user.id).store_id).toBe(store1);
  });

  it("Users can't manage members; the Admin can move a User between stores", async () => {
    expect((await as("user3").post(`/stores/${store2}/members`, { user_id: users.loose.id })).status).toBe(403);
    await as("admin").post(`/stores/${store2}/members`, { user_id: users.user2.id });
    expect(db.prepare("SELECT store_id FROM users WHERE id = ?").get(users.user2.id).store_id).toBe(store2);
    await as("admin").put(`/users/${users.user2.id}`, { store_id: store1 });
    expect(db.prepare("SELECT store_id FROM users WHERE id = ?").get(users.user2.id).store_id).toBe(store1);
  });

  it("the Users page sets only a User's store; a role change clears the store", async () => {
    expect((await as("admin").put(`/users/${users.manager.id}`, { store_id: store2 })).status).toBe(400);
    const temp = createUser({ email: "promote@test.local", full_name: "Promote", password: PASSWORD, role: "user" });
    await as("admin").put(`/users/${temp.id}`, { store_id: store2 });
    const promoted = await as("admin").put(`/users/${temp.id}`, { role: "manager" });
    expect(promoted.body).toMatchObject({ role: "manager", store_id: null });
  });
});

describe("who sees what", () => {
  let inStore1;
  let inStore2;
  beforeAll(() => {
    inStore1 = tx(store1, { sender_name: "Store one row" });
    inStore2 = tx(store2, { sender_name: "Store two row" });
  });
  const senders = (rows) => rows.map((r) => r.sender_name);

  it("stores: the Admin lists all; others only theirs; someone with no store none", async () => {
    expect((await as("admin").get("/stores")).body.length).toBeGreaterThanOrEqual(2);
    expect((await as("manager2").get("/stores")).body.map((s) => s.id)).toEqual([store2]);
    expect((await as("user").get("/stores")).body.map((s) => s.id)).toEqual([store1]);
    expect((await as("loose").get("/stores")).body).toEqual([]);
    expect((await as("user").get(`/stores/${store2}`)).status).toBe(404);
  });

  it("a store's details: its members are shown to its Manager and the Admin, not to its Users", async () => {
    expect((await as("manager2").get(`/stores/${store2}`)).body.members.map((m) => m.email)).toContain("user3@test.local");
    const asUser = (await as("user3").get(`/stores/${store2}`)).body;
    expect(asUser).toMatchObject({ name: "Tripoli Branch", location: "Tripoli, Main street", manager: { email: "manager2@test.local" } });
    expect(asUser).not.toHaveProperty("members");
  });

  it("transactions: each store's people see only its rows; the Admin sees all, or one store", async () => {
    const list = async (who, filter = {}) => senders((await as(who).post("/transactions/filter", { filter })).body);
    expect(await list("user")).toContain("Store one row");
    expect(await list("user")).not.toContain("Store two row");
    expect(await list("manager2")).toEqual(["Store two row"]);
    expect(await list("user3")).toEqual(["Store two row"]);
    expect(await list("admin")).toEqual(expect.arrayContaining(["Store one row", "Store two row"]));
    expect(await list("admin", { store_id: store2 })).toEqual(["Store two row"]);
    // Asking for another store's rows gives nothing.
    expect(await list("user", { store_id: store2 })).toEqual([]);
    expect(await list("loose")).toEqual([]);
  });

  it("another store's rows can't be edited, deleted or bulk-changed (404), and nothing changes", async () => {
    expect((await as("manager").put(`/transactions/${inStore2}`, { note: "x" })).status).toBe(404);
    expect((await as("manager").del(`/transactions/${inStore2}`)).status).toBe(404);
    const bulk = await as("manager").post("/transactions/bulk-delete", { ids: [inStore1, inStore2] });
    expect(bulk.status).toBe(404);
    expect(bulk.body.not_found).toEqual([inStore2]);
    expect((await as("manager").post("/transactions/bulk-update", { ids: [inStore2], changes: { note: "x" } })).status).toBe(404);
    expect(count("transactions", "id IN (?, ?)", inStore1, inStore2)).toBe(2);
  });

  it("writes go to your own store; asking for another is refused; no store, no writes", async () => {
    const own = await as("user3").post("/transactions/create", { type: "cash_in", amount: 5 });
    expect(own.body.store_id).toBe(store2);
    const other = await as("user3").post("/transactions/create", { type: "cash_in", amount: 5, store_id: store1 });
    expect(other.status).toBe(403);
    expect(other.body.error).toBe("You can only work in your own store");
    const none = await as("loose").post("/transactions/create", { type: "cash_in", amount: 5 });
    expect(none.status).toBe(403);
    expect(none.body.error).toBe("You aren't assigned to a store yet");
  });

  it("the Admin chooses the store (required once there are several) and can move a row", async () => {
    const choose = await as("admin").post("/transactions/create", { type: "cash_in", amount: 5 });
    expect(choose.status).toBe(400);
    expect(choose.body.error).toBe("Choose a store");
    const made = (await as("admin").post("/transactions/create", { type: "cash_in", amount: 5, store_id: store2 })).body;
    expect(made.store_id).toBe(store2);
    expect((await as("admin").put(`/transactions/${made.id}`, { store_id: store1 })).body.store_id).toBe(store1);
    expect((await as("manager").put(`/transactions/${made.id}`, { store_id: store2 })).status).toBe(403);
  });
});

describe("per store: opening balances, closed days, commission rate", () => {
  it("each store has its own opening balance for the same day", async () => {
    await as("manager").post("/daily-balances/create", { date: "2026-08-01", opening_balance: 100 });
    await as("manager2").post("/daily-balances/create", { date: "2026-08-01", opening_balance: 200 });
    await as("manager2").post("/daily-balances/create", { date: "2026-08-01", opening_balance: 250 }); // updates store 2's
    const rows = db.prepare("SELECT store_id, opening_balance FROM daily_balances WHERE date = '2026-08-01' ORDER BY store_id").all();
    expect(rows).toEqual([{ store_id: store1, opening_balance: 100 }, { store_id: store2, opening_balance: 250 }]);
    expect((await as("manager2").post("/daily-balances/filter", {})).body.map((b) => b.opening_balance)).toEqual([250]);
  });

  it("closing a day locks only that store's day", async () => {
    expect((await as("manager").post("/closed-days", { date: "2026-08-02" })).status).toBe(201);
    expect((await as("manager").post("/transactions/create", { type: "cash_in", amount: 1, transaction_date: "2026-08-02" })).status).toBe(423);
    expect((await as("manager2").post("/transactions/create", { type: "cash_in", amount: 1, transaction_date: "2026-08-02" })).status).toBe(201);
    expect((await as("manager2").get("/closed-days")).body.map((d) => d.date)).not.toContain("2026-08-02");
    expect((await as("manager2").del("/closed-days/2026-08-02")).status).toBe(404); // not closed in their store
    const all = (await as("admin").get("/closed-days")).body;
    expect(all.find((d) => d.date === "2026-08-02").store_id).toBe(store1);
    expect((await as("manager").del("/closed-days/2026-08-02")).status).toBe(200);
  });

  it("each store has its own rate, used by its imports", async () => {
    await as("manager2").put("/commission-rates", { rate: 2, effective_from: "2000-01-02" });
    expect((await as("manager2").get("/commission-rates")).body.current).toBe(2);
    expect((await as("manager").get("/commission-rates")).body.current).toBe(1);
    const csv = fs.readFileSync(path.join(__dirname, "../fixtures/statement.csv"), "utf8");
    const credit = (body) => body.transactions.find((t) => t.type === "cash_in");
    const inStore2 = credit((await as("manager2").post("/csv/extract", { text: csv })).body);
    expect(inStore2.commission).toBeCloseTo(inStore2.amount * 0.02, 3);
    const inStore1 = credit((await as("admin").post("/csv/extract", { text: csv, store_id: store1 })).body);
    expect(inStore1.commission).toBeCloseTo(inStore1.amount * 0.01, 3);
    expect((await as("admin").post("/csv/extract", { text: csv })).body.error).toBe("Choose a store");
  });
});

describe("imports across stores", () => {
  it("a reference already imported into another store blocks the import; duplicates are per store", async () => {
    tx(store1, { reference_number: "tr:shared-1" });
    const dup = await as("manager2").post("/transactions/find-duplicates", { references: ["tr:shared-1"] });
    expect(dup.body).toEqual([]);
    const blocked = await as("manager2").post("/transactions/import", { records: [{ type: "cash_in", amount: 3, reference_number: "tr:shared-1", transaction_date: "2026-09-12" }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: "Some of these transactions were already imported into another store", in_other_stores: 1 });
    expect(count("transactions", "reference_number = 'tr:shared-1'")).toBe(1);
    // In its own store, the usual duplicate / overwrite flow.
    expect((await as("manager").post("/transactions/find-duplicates", { references: ["tr:shared-1"] })).body).toHaveLength(1);
    const replaced = await as("manager").post("/transactions/import", { overwrite: true, records: [{ type: "cash_in", amount: 4, reference_number: "tr:shared-1", transaction_date: "2026-09-12" }] });
    expect(replaced.body.replaced).toBe(1);
    expect(replaced.body.records[0].store_id).toBe(store1);
  });
});

describe("admin panel and reports follow the store", () => {
  const SEPT = "from=2026-09-01&to=2026-09-30";
  // A row's day: transaction_date, or the day it was entered (as the app counts it).
  const SEPT_DAY = "COALESCE(NULLIF(transaction_date, ''), substr(created_date, 1, 10)) BETWEEN '2026-09-01' AND '2026-09-30'";

  it("a Manager's summary, backup and delete cover only their store", async () => {
    const mine = count("transactions", `store_id = ? AND ${SEPT_DAY}`, store2);
    expect((await as("manager2").get(`/admin/summary?${SEPT}`)).body).toMatchObject({ store_id: store2, transactions: mine });
    const csv = (await as("manager2").get(`/admin/export?kind=transactions&${SEPT}`)).body;
    const rows = csv.trim().split(/\r\n/).slice(1);
    expect(rows).toHaveLength(mine);
    expect(rows.every((row) => row.endsWith(`,${store2}`))).toBe(true);
    expect((await as("manager2").get(`/admin/summary?${SEPT}&store_id=${store1}`)).status).toBe(403);
    const before1 = count("transactions", "store_id = ?", store1);
    const purged = await as("manager2").post("/admin/purge", { from: "2026-09-01", to: "2026-09-30", expected_count: mine });
    expect(purged.body.deleted_transactions).toBe(mine);
    expect(count("transactions", "store_id = ?", store1)).toBe(before1);
  });

  it("the Admin: one store, or every store", async () => {
    const all = (await as("admin").get(`/admin/summary?${SEPT}`)).body;
    const one = (await as("admin").get(`/admin/summary?${SEPT}&store_id=${store1}`)).body;
    expect(all.store_id).toBeNull();
    expect(one.transactions).toBe(count("transactions", `store_id = ? AND ${SEPT_DAY}`, store1));
    expect(all.transactions).toBeGreaterThanOrEqual(one.transactions);
  });

  it("reports are scoped; the stores comparison is for the Admin only", async () => {
    tx(store2, { amount: 70, transaction_date: "2026-10-05", sender_name: "Two" });
    tx(store1, { amount: 30, transaction_date: "2026-10-05", sender_name: "One" });
    const OCT = { from: "2026-10-01", to: "2026-10-31" };
    const parties = async (who, extra = {}) => (await as(who).get(`/admin/reports/parties?${new URLSearchParams({ party: "sender", ...OCT, ...extra })}`)).body;
    expect((await parties("manager2")).rows.map((r) => r.label)).toEqual(["Two"]);
    expect((await parties("admin")).rows.map((r) => r.label)).toEqual(["Two", "One"]);
    expect((await parties("admin", { store_id: String(store1) })).rows.map((r) => r.label)).toEqual(["One"]);
    expect((await as("manager2").get("/admin/reports/income?year=2026")).body.store_id).toBe(store2);

    expect((await as("manager").get(`/admin/reports/stores?${new URLSearchParams(OCT)}`)).status).toBe(403);
    const { body } = await as("admin").get(`/admin/reports/stores?${new URLSearchParams(OCT)}`);
    const byId = Object.fromEntries(body.stores.map((s) => [s.id, s]));
    expect(byId[store2]).toMatchObject({ name: "Tripoli Branch", count: 1, cash_in: 70, volume: 70, share: 0.7 });
    expect(byId[store1]).toMatchObject({ count: 1, volume: 30, share: 0.3 });
    expect(body.stores[0].id).toBe(store2); // busiest first
    expect(body.totals).toMatchObject({ count: 2, volume: 100 });
  });

  it("restore: rows keep their store; a Manager can't restore another store's rows; old backups go to the chosen store", async () => {
    const id = tx(store2, { transaction_date: "2026-11-02", sender_name: "Backed up" });
    const csv = (await as("admin").get("/admin/export?kind=transactions&from=2026-11-01&to=2026-11-30")).body;
    db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    expect((await as("manager").post("/admin/restore/preview", { csv })).body).toMatchObject({ invalid_count: 1, invalid: [{ field: "store_id" }] });
    const preview = (await as("admin").post("/admin/restore/preview", { csv })).body;
    expect(preview.to_add).toBe(1);
    await as("admin").post("/admin/restore", { csv, expected_count: 1 });
    expect(db.prepare("SELECT store_id FROM transactions WHERE id = ?").get(id).store_id).toBe(store2);

    // A backup from before stores (no store_id column).
    const legacy = csv.split("\r\n").map((line) => line.split(",").slice(0, -1).join(",")).join("\r\n");
    db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    expect((await as("admin").post("/admin/restore/preview", { csv: legacy })).body.invalid_count).toBe(1); // several stores, none chosen
    await as("admin").post("/admin/restore", { csv: legacy, store_id: store1, expected_count: 1 });
    expect(db.prepare("SELECT store_id FROM transactions WHERE id = ?").get(id).store_id).toBe(store1);
  });
});

describe("upgrading a database from before stores", () => {
  it("creates a first store (named after the office account) and gives it every row and the existing staff", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wmm-stores-")), "old.db");
    const old = new Database(file);
    old.exec(`
      CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, commission REAL NOT NULL DEFAULT 0,
        sender_name TEXT, receiver_name TEXT, phone TEXT, customer_number TEXT, note TEXT, reference_number TEXT, service TEXT, currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'completed', transaction_date TEXT, sort_order INTEGER DEFAULT 0, created_by TEXT NOT NULL, created_date TEXT NOT NULL, updated_date TEXT NOT NULL);
      CREATE TABLE daily_balances (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, opening_balance REAL NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
        created_date TEXT NOT NULL, updated_date TEXT NOT NULL, UNIQUE(date, created_by));
      CREATE TABLE closed_days (date TEXT PRIMARY KEY, closed_by TEXT NOT NULL, closed_at TEXT NOT NULL);
      CREATE TABLE commission_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, rate REAL NOT NULL, effective_from TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_date TEXT NOT NULL);
      INSERT INTO transactions (type, amount, sender_name, created_by, created_date, updated_date) VALUES
        ('cash_out', 5, 'Office Account', 'a', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
        ('cash_out', 6, 'Office Account', 'a', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
        ('cash_in', 7, 'Customer', 'a', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
      INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date) VALUES ('2026-09-01', 100, 'a', 'x', 'x');
      INSERT INTO closed_days VALUES ('2026-09-01', 'a', 'x');
      INSERT INTO commission_rates (rate, effective_from, created_by, created_date) VALUES (1, '2000-01-01', 'system', 'x'), (1.5, '2026-01-01', 'a', 'x');
      CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, label TEXT NOT NULL, description TEXT, permissions TEXT NOT NULL DEFAULT '[]', created_date TEXT NOT NULL, updated_date TEXT NOT NULL);
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, full_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
        role_id INTEGER NOT NULL REFERENCES roles(id), is_active INTEGER NOT NULL DEFAULT 1, last_login TEXT, previous_login TEXT, preferences TEXT, created_date TEXT NOT NULL, updated_date TEXT NOT NULL);
      INSERT INTO roles (name, label, created_date, updated_date) VALUES ('admin', 'Admin', 'x', 'x'), ('manager', 'Manager', 'x', 'x'), ('user', 'User', 'x', 'x');
      INSERT INTO users (email, password_hash, role_id, created_date, updated_date) VALUES ('boss@x', 'h', 1, 'x', 'x'), ('lead@x', 'h', 2, 'x', 'x'), ('cashier1@x', 'h', 3, 'x', 'x'), ('cashier2@x', 'h', 3, 'x', 'x');
    `);
    old.close();

    const root = path.resolve(__dirname, "../..");
    const run = () => spawnSync(process.execPath, ["-e", "import('./server/db.js').then((m) => m.initializeDb())"], {
      cwd: root, env: { ...process.env, HAWALAFLOW_DB_PATH: file }, encoding: "utf8",
    });
    expect(run().status).toBe(0);
    expect(run().status).toBe(0); // running it again changes nothing

    const upgraded = new Database(file, { readonly: true });
    const q = (sql) => upgraded.prepare(sql).all();
    expect(q("SELECT id, name FROM stores")).toEqual([{ id: 1, name: "Office Account" }]);
    expect(q("SELECT DISTINCT store_id FROM transactions")).toEqual([{ store_id: 1 }]);
    expect(q("SELECT store_id, date, opening_balance FROM daily_balances")).toEqual([{ store_id: 1, date: "2026-09-01", opening_balance: 100 }]);
    expect(q("SELECT store_id, date FROM closed_days")).toEqual([{ store_id: 1, date: "2026-09-01" }]);
    expect(q("SELECT store_id, rate, effective_from FROM commission_rates ORDER BY effective_from")).toEqual([
      { store_id: 1, rate: 1, effective_from: "2000-01-01" }, { store_id: 1, rate: 1.5, effective_from: "2026-01-01" },
    ]);
    // Existing staff keep seeing the office's data: Users join the store, the single Manager manages it.
    expect(q("SELECT email, store_id FROM users ORDER BY id")).toEqual([
      { email: "boss@x", store_id: null }, { email: "lead@x", store_id: 1 }, { email: "cashier1@x", store_id: 1 }, { email: "cashier2@x", store_id: 1 },
    ]);
    expect(q("SELECT manager_id FROM stores")).toEqual([{ manager_id: 2 }]);
    expect(q("PRAGMA foreign_key_check")).toEqual([]);
    upgraded.close();
  });
});
