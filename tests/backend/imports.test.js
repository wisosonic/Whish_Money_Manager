// Import history (user's request, 2026-09-28): every saved statement import is recorded (file,
// days, store, rows, who, when) with the import itself, and each role sees its share of it:
// the Admin everything, a Manager their store's, a User only their own imports.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../../server/auth.js";
import { db } from "../../server/db.js";
import { cleanFileName } from "../../server/imports.js";
import { DEFAULT_ROLES, PERMISSIONS, PERMISSIONS_ADDED_LATER } from "../../server/permissions.js";
import { PASSWORD, assignToStore, createTestUsers, firstStoreId, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;
let store1;
let store2;

beforeAll(async () => {
  srv = await startServer();
  const users = createTestUsers(); // manager manages store 1; user and user2 are in it
  store1 = firstStoreId();
  store2 = db.prepare("INSERT INTO stores (name, created_date, updated_date) VALUES ('Tripoli Branch', 'x', 'x')").run().lastInsertRowid;
  db.prepare("INSERT INTO commission_rates (store_id, rate, effective_from, created_by, created_date) VALUES (?, 1, '2000-01-01', 'system', 'x')").run(store2);
  users.manager2 = assignToStore(createUser({ email: "manager2@test.local", full_name: "Second Manager", password: PASSWORD, role: "manager" }), store2);
  users.loose = createUser({ email: "loose@test.local", full_name: "No Store", password: PASSWORD, role: "user" });
  client = await loginAll(makeClient(srv.baseUrl), users);
});
afterAll(() => srv.close());
beforeEach(() => {
  db.prepare("DELETE FROM import_history").run();
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM closed_days").run();
});

let ref = 0;
const row = (day, over = {}) => ({ type: "cash_in", amount: 10, commission: 0.1, reference_number: `tr:${++ref}`, transaction_date: day, ...over });
const importAs = (as, records, body = {}) => client.request("POST", "/transactions/import", {
  as, body: { records, statement: { file_name: "statement.csv", source: "csv" }, ...body },
});
const history = async (as, query = "") => (await client.request("GET", `/import-history${query}`, { as })).body;
const entries = () => db.prepare("SELECT * FROM import_history ORDER BY id").all();

describe("recording an import", () => {
  it("records the file, its days, the store, the rows, who and when, with the import", async () => {
    const before = Date.now();
    const res = await importAs("user", [row("2026-09-23"), row("2026-09-21"), row("2026-09-22")]);
    expect(res.status).toBe(201);
    const [entry] = entries();
    expect(res.body.import_id).toBe(entry.id);
    expect(entry).toMatchObject({
      store_id: store1, file_name: "statement.csv", source: "csv",
      period_from: "2026-09-21", period_to: "2026-09-23",
      row_count: 3, replaced_count: 0, imported_by: "user@test.local",
    });
    expect(Date.parse(entry.imported_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("an overwrite records how many rows it replaced", async () => {
    const first = [row("2026-09-20"), row("2026-09-20")];
    await importAs("manager", first);
    await importAs("manager", first.map((r) => ({ ...r })), { overwrite: true });
    expect(entries().map((e) => [e.row_count, e.replaced_count])).toEqual([[2, 0], [2, 2]]);
  });

  it("the period, count, store and user come from the server, never from the client", async () => {
    await importAs("user", [row("2026-09-05")], {
      statement: { file_name: "a.csv", source: "csv", period_from: "1999-01-01", row_count: 999, imported_by: "admin@test.local", store_id: store2 },
    });
    expect(entries()[0]).toMatchObject({ period_from: "2026-09-05", period_to: "2026-09-05", row_count: 1, imported_by: "user@test.local", store_id: store1 });
  });

  it("a row without transaction_date counts on its created_date's day, as everywhere else", async () => {
    await importAs("admin", [row("", { created_date: "2026-08-30T09:00:00Z" })], { store_id: store2 });
    // created_date is set by the server on insert (now); the entry uses the stored row.
    const today = new Date().toISOString().slice(0, 10);
    expect(entries()[0]).toMatchObject({ period_from: today, period_to: today });
  });

  it("cleans the file name and ignores an unknown type", async () => {
    await importAs("user", [row("2026-09-05")], { statement: { file_name: "C:\\fakepath\\  Sept\u0007 23.pdf ", source: "xlsx" } });
    expect(entries()[0]).toMatchObject({ file_name: "Sept 23.pdf", source: null });
    await importAs("user", [row("2026-09-06")], {}); // the default statement
    await importAs("user", [row("2026-09-07")], { statement: undefined });
    expect(entries()[2]).toMatchObject({ file_name: "", source: null });
    expect(cleanFileName("x".repeat(300))).toHaveLength(255);
    expect(cleanFileName("/home/me/statements/sept.csv")).toBe("sept.csv");
  });

  it("nothing is recorded when nothing is saved: no rows, a refused import", async () => {
    expect((await importAs("user", [])).status).toBe(201);
    // A reference already in another store refuses the import (409).
    await importAs("admin", [row("2026-09-10", { reference_number: "tr:taken" })], { store_id: store2 });
    db.prepare("DELETE FROM import_history").run();
    expect((await importAs("user", [row("2026-09-10", { reference_number: "tr:taken" })])).status).toBe(409);
    // A closed day refuses it too (423).
    await client.request("POST", "/closed-days", { as: "manager", body: { date: "2026-09-11" } });
    expect((await importAs("user", [row("2026-09-11")])).status).toBe(423);
    expect(entries()).toEqual([]);
  });
});

describe("who sees which imports", () => {
  beforeEach(async () => {
    await importAs("user", [row("2026-09-01")]);
    await importAs("user2", [row("2026-09-02")]);
    await importAs("manager", [row("2026-09-03")]);
    await importAs("manager2", [row("2026-09-04")]);
  });
  const who = (body) => body.imports.map((e) => e.imported_by);

  it("the Admin sees every store's imports, newest first, with the store and the importer's name", async () => {
    const body = await history("admin");
    expect(who(body)).toEqual(["manager2@test.local", "manager@test.local", "user2@test.local", "user@test.local"]);
    expect(body).toMatchObject({ total: 4, truncated: false });
    expect(body.imports[0]).toMatchObject({ store_name: "Tripoli Branch", imported_by_name: "Second Manager" });
  });

  it("the Admin can ask for one store", async () => {
    expect(who(await history("admin", `?store_id=${store2}`))).toEqual(["manager2@test.local"]);
    expect(who(await history("admin", `?store_id=${store1}`))).toHaveLength(3);
  });

  it("a Manager sees every import into their store (anyone's), none of another store's", async () => {
    expect(who(await history("manager"))).toEqual(["manager@test.local", "user2@test.local", "user@test.local"]);
    expect(who(await history("manager2"))).toEqual(["manager2@test.local"]);
    const other = await client.request("GET", `/import-history?store_id=${store2}`, { as: "manager" });
    expect(other.status).toBe(403);
  });

  it("a User sees only their own imports", async () => {
    expect(who(await history("user"))).toEqual(["user@test.local"]);
    expect(who(await history("user2"))).toEqual(["user2@test.local"]);
  });

  it("someone with no store sees none; without a session, 401", async () => {
    expect(await history("loose")).toEqual({ total: 0, truncated: false, imports: [] });
    expect((await client.request("GET", "/import-history")).status).toBe(401);
  });

  it("the permission: Admin and Manager can see others' imports, a User can't (also granted to existing databases)", () => {
    const perms = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, r.permissions]));
    expect(perms.admin).toContain(PERMISSIONS.IMPORTS_READ_ANY);
    expect(perms.manager).toContain(PERMISSIONS.IMPORTS_READ_ANY);
    expect(perms.user).not.toContain(PERMISSIONS.IMPORTS_READ_ANY);
    expect(PERMISSIONS_ADDED_LATER[PERMISSIONS.IMPORTS_READ_ANY]).toEqual(["admin", "manager"]);
  });
});

describe("the history outlives what it describes", () => {
  it("deleting the imported rows keeps the entry; deleting the store keeps it without a store", async () => {
    const store3 = (await client.request("POST", "/stores", { as: "admin", body: { name: "Pop-up" } })).body.id;
    await importAs("admin", [row("2026-09-12")], { store_id: store3 });
    db.prepare("DELETE FROM transactions WHERE store_id = ?").run(store3);
    expect((await client.request("DELETE", `/stores/${store3}`, { as: "admin" })).status).toBe(200);
    const [entry] = (await history("admin")).imports;
    expect(entry).toMatchObject({ store_id: null, store_name: null, row_count: 1 });
  });

  it("an email change moves the user's entries with them (they still see their imports)", async () => {
    const mover = createUser({ email: "mover@test.local", full_name: "Mover", password: PASSWORD, role: "user" });
    assignToStore(mover, store1);
    await client.login("mover", "mover@test.local");
    await importAs("mover", [row("2026-09-13")]);
    const res = await client.request("PUT", "/auth/profile", { as: "mover", body: { email: "moved@test.local", current_password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(entries()[0].imported_by).toBe("moved@test.local");
    expect((await history("mover")).imports.map((e) => e.imported_by)).toEqual(["moved@test.local"]);
  });
});
