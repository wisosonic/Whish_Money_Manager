// Import history (user's request, 2026-09-28): every saved statement import is recorded (file,
// days, store, rows, who, when) with the import itself, and each role sees its share of it:
// the Admin everything, a Manager their store's, a User only their own imports.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../../server/auth.js";
import { db } from "../../server/db.js";
import { cleanFileName } from "../../server/imports.js";
import { DEFAULT_ROLES, PERMISSIONS, PERMISSIONS_ADDED_LATER } from "../../server/permissions.js";
import { PASSWORD, assignToStore, createTestUsers, firstStoreId, loginAll, makeClient, startServer } from "./helpers.js";

const withoutPermission = (permission) => DEFAULT_ROLES.find((r) => r.name === "admin").permissions.filter((p) => p !== permission);

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

describe("ambiguous rows kept with the import (user's request, 2026-09-29)", () => {
  const set = (line, reason, over = {}) => ({ line_no: line, date: "2026-09-05", reference_number: `tr:a${line}`, service: "W2W", description: `ROW ${line}`, debit: "-5.00", credit: "0.00", balance: "10.00", reason, ...over });
  const ambiguousAs = async (as, query = "") => (await client.request("GET", `/ambiguous-rows${query}`, { as })).body;
  beforeEach(() => db.prepare("DELETE FROM ambiguous_rows").run());

  it("are stored with the import (never as transactions), as printed, with the import's details when listed", async () => {
    const res = await importAs("user", [row("2026-09-05")], { ambiguous: [set(2, "negative"), set(3, "both", { debit: "3.00", credit: "2.00" }), set(4, "neither", { debit: "", credit: "" })] });
    expect(res.status).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n).toBe(1);
    const body = await ambiguousAs("user");
    expect(body).toMatchObject({ total: 3, truncated: false });
    expect(body.rows.map((r) => [r.line_no, r.reason, r.debit, r.credit])).toEqual([[2, "negative", "-5.00", "0.00"], [3, "both", "3.00", "2.00"], [4, "neither", "", ""]]);
    expect(body.rows[0]).toMatchObject({ import_id: res.body.import_id, file_name: "statement.csv", imported_by: "user@test.local", imported_by_name: "Test User", store_id: store1, description: "ROW 2" });
  });

  it("only known reasons are kept, texts are cut short and cleaned, and bad lines / dates become empty", async () => {
    await importAs("user", [row("2026-09-06")], { ambiguous: [
      set(2, "made-up"), { reason: "both", line_no: -1, date: "yesterday", description: "x".repeat(600) + "\u0007", debit: { a: 1 } }, "junk", null,
    ] });
    const { rows } = await ambiguousAs("user");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "both", line_no: null, date: null, debit: "[object Object]" });
    expect(rows[0].description).toHaveLength(500);
    expect(rows[0].description).not.toMatch(/\u0007/);
  });

  it("follow the import history's visibility: Admin every store, a Manager their store's, a User their own", async () => {
    await importAs("user", [row("2026-09-01")], { ambiguous: [set(1, "negative")] });
    await importAs("user2", [row("2026-09-02")], { ambiguous: [set(2, "both")] });
    await importAs("manager2", [row("2026-09-03")], { ambiguous: [set(3, "neither")] });
    const lines = (body) => body.rows.map((r) => r.line_no).sort();
    expect(lines(await ambiguousAs("admin"))).toEqual([1, 2, 3]);
    expect(lines(await ambiguousAs("admin", `?store_id=${store2}`))).toEqual([3]);
    expect(lines(await ambiguousAs("manager"))).toEqual([1, 2]);
    expect(lines(await ambiguousAs("manager2"))).toEqual([3]);
    expect(lines(await ambiguousAs("user"))).toEqual([1]);
    expect(lines(await ambiguousAs("user2"))).toEqual([2]);
    expect(await ambiguousAs("loose")).toEqual({ total: 0, truncated: false, rows: [] });
    expect((await client.request("GET", `/ambiguous-rows?store_id=${store2}`, { as: "manager" })).status).toBe(403);
  });

  it("?count=1 answers just how many, with the same visibility (the dashboard badge)", async () => {
    await importAs("user", [row("2026-09-01")], { ambiguous: [set(1, "negative"), set(2, "both")] });
    await importAs("manager2", [row("2026-09-03")], { ambiguous: [set(3, "neither")] });
    const count = async (as, q = "") => (await client.request("GET", `/ambiguous-rows?count=1${q}`, { as })).body;
    expect(await count("admin")).toEqual({ total: 3 });
    expect(await count("admin", `&store_id=${store2}`)).toEqual({ total: 1 });
    expect(await count("manager")).toEqual({ total: 2 });
    expect(await count("user")).toEqual({ total: 2 });
    expect(await count("user2")).toEqual({ total: 0 });
    expect(await count("loose")).toEqual({ total: 0 });
  });

  it("nothing is kept when the import is refused", async () => {
    await client.request("POST", "/closed-days", { as: "manager", body: { date: "2026-09-15" } });
    expect((await importAs("user", [row("2026-09-15")], { ambiguous: [set(1, "negative")] })).status).toBe(423);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ambiguous_rows").get().n).toBe(0);
  });
});

describe("actions on an ambiguous row (user's request, 2026-09-29): discard, or correct and add", () => {
  const set = (line, reason, over = {}) => ({ line_no: line, date: "2026-09-05", reference_number: `tr:c${line}`, service: "W2W", description: `NAME - 96171588017`, debit: "-5.00", credit: "0.00", balance: "10.00", reason, ...over });
  const oneAmbiguous = async (as, reason = "negative", over = {}, importOver = {}) => {
    await importAs(as, [row("2026-09-05")], { ambiguous: [set(1, reason, over)], ...importOver });
    return db.prepare("SELECT id FROM ambiguous_rows ORDER BY id DESC LIMIT 1").get().id;
  };
  const discard = (id, as) => client.request("DELETE", `/ambiguous-rows/${id}`, { as });
  const convert = (id, as, body) => client.request("POST", `/ambiguous-rows/${id}/convert`, { as, body });
  const validBody = (over = {}) => ({ type: "cash_in", amount: 25, transaction_date: "2026-09-05", ...over });

  beforeEach(() => {
    db.prepare("DELETE FROM ambiguous_rows").run();
    db.prepare("DELETE FROM commission_rates WHERE store_id != ?").run(store1);
    db.prepare("INSERT OR IGNORE INTO commission_rates (store_id, rate, effective_from, created_by, created_date) VALUES (?, 1, '2000-01-01', 'system', 'x')").run(store2);
  });

  describe("discard", () => {
    it("removes it for good", async () => {
      const id = await oneAmbiguous("user");
      const res = await discard(id, "user");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, id });
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id)).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n).toBe(1); // only the clean row from the import
    });

    it("404s on a missing row, and on one out of scope, without changing anything", async () => {
      expect((await discard(999999, "admin")).status).toBe(404);
      const id = await oneAmbiguous("manager2"); // store2, not store1
      expect((await discard(id, "user")).status).toBe(404);
      expect((await discard(id, "manager")).status).toBe(404); // manager of store1, wrong store
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id)).toBeDefined();
      const own = await oneAmbiguous("user2");
      expect((await discard(own, "user")).status).toBe(404); // a User can't touch another User's row
      expect((await discard(own, "manager")).status).toBe(200); // their Manager can
    });

    it("needs transactions:import", async () => {
      db.prepare(
        "INSERT INTO roles (name, label, permissions, created_date, updated_date) VALUES ('no_import', 'No Import', ?, 'x', 'x')"
      ).run(JSON.stringify(withoutPermission(PERMISSIONS.TRANSACTIONS_IMPORT)));
      const limited = createUser({ email: "noimport@test.local", full_name: "No Import", password: PASSWORD, role: "no_import" });
      assignToStore(limited, store1);
      await client.login("noimport", "noimport@test.local");
      const id = await oneAmbiguous("user");
      const res = await discard(id, "noimport");
      expect(res.status).toBe(403);
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id)).toBeDefined();
    });
  });

  describe("correct and add", () => {
    it("creates the transaction with the corrected fields, computes commission the CSV way, and discards the row", async () => {
      const id = await oneAmbiguous("user", "negative");
      const res = await convert(id, "user", validBody({
        sender_name: "Jane Doe", receiver_name: "John Doe", phone: "96171588017", customer_number: "71588017",
        service: "W2W", note: "corrected", reference_number: "tr:corrected",
      }));
      expect(res.status).toBe(201);
      expect(res.body.discarded_id).toBe(id);
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id)).toBeUndefined();
      const tx = res.body.transaction;
      expect(tx).toMatchObject({
        type: "cash_in", amount: 25, commission: 0.25, // 1% of 25
        sender_name: "Jane Doe", receiver_name: "John Doe", reference_number: "tr:corrected",
        transaction_date: "2026-09-05", created_by: "user@test.local", store_id: store1,
      });
      expect(db.prepare("SELECT * FROM transactions WHERE id = ?").get(tx.id)).toMatchObject({ commission: 0.25 });
    });

    it("cash_out never gets a commission, whatever the row printed", async () => {
      const id = await oneAmbiguous("user");
      const res = await convert(id, "user", validBody({ type: "cash_out" }));
      expect(res.status).toBe(201);
      expect(res.body.transaction.commission).toBe(0);
    });

    it("uses the store's rate on the transaction's date, not the import date", async () => {
      await client.request("PUT", "/commission-rates", { as: "manager", body: { rate: 5, effective_from: "2026-09-01" } });
      const id = await oneAmbiguous("user");
      const res = await convert(id, "user", validBody({ amount: 100 }));
      expect(res.body.transaction.commission).toBe(5);
    });

    it("rejects a bad type, a non-positive amount, or a bad date, changing nothing", async () => {
      const id = await oneAmbiguous("user");
      expect((await convert(id, "user", validBody({ type: "refund" }))).status).toBe(400);
      expect((await convert(id, "user", validBody({ amount: 0 }))).status).toBe(400);
      expect((await convert(id, "user", validBody({ amount: -5 }))).status).toBe(400);
      expect((await convert(id, "user", validBody({ transaction_date: "09/05/2026" }))).status).toBe(400);
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id)).toBeDefined();
      expect(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE reference_number LIKE 'tr:c%'").get().n).toBe(0);
    });

    it("refuses a closed day (423), a reference already used in another store (409), and a row whose store was deleted (409)", async () => {
      const closedId = await oneAmbiguous("user"); // imported while 2026-09-05 is still open
      await client.request("POST", "/closed-days", { as: "manager", body: { date: "2026-09-05" } });
      expect((await convert(closedId, "user", validBody())).status).toBe(423);
      await client.request("DELETE", "/closed-days/2026-09-05", { as: "manager" });

      await importAs("admin", [row("2026-09-06", { reference_number: "tr:elsewhere" })], { store_id: store2 });
      const refId = await oneAmbiguous("user");
      expect((await convert(refId, "user", validBody({ reference_number: "tr:elsewhere" }))).status).toBe(409);

      const store3 = (await client.request("POST", "/stores", { as: "admin", body: { name: "Pop-up store" } })).body.id;
      const orphanId = await oneAmbiguous("admin", "negative", {}, { store_id: store3 });
      db.prepare("DELETE FROM transactions WHERE store_id = ?").run(store3);
      await client.request("DELETE", `/stores/${store3}`, { as: "admin" });
      expect((await convert(orphanId, "admin", validBody())).status).toBe(409);
      // discarding a row with no store still works: it doesn't need one.
      expect((await discard(orphanId, "admin")).status).toBe(200);
    });

    it("404s on a row out of scope, same as discard", async () => {
      const id = await oneAmbiguous("manager2");
      expect((await convert(id, "user", validBody())).status).toBe(404);
      expect((await convert(id, "manager", validBody())).status).toBe(404);
    });

    it("needs both transactions:import (route) and transactions:create (checked in the handler)", async () => {
      db.prepare(
        "INSERT INTO roles (name, label, permissions, created_date, updated_date) VALUES ('no_import2', 'No Import', ?, 'x', 'x'), ('no_create', 'No Create', ?, 'x', 'x')"
      ).run(JSON.stringify(withoutPermission(PERMISSIONS.TRANSACTIONS_IMPORT)), JSON.stringify(withoutPermission(PERMISSIONS.TRANSACTIONS_CREATE)));
      assignToStore(createUser({ email: "noimport2@test.local", full_name: "x", password: PASSWORD, role: "no_import2" }), store1);
      assignToStore(createUser({ email: "nocreate@test.local", full_name: "x", password: PASSWORD, role: "no_create" }), store1);
      await client.login("noimport2", "noimport2@test.local");
      await client.login("nocreate", "nocreate@test.local");

      const id1 = await oneAmbiguous("user");
      const res1 = await convert(id1, "noimport2", validBody());
      expect(res1.status).toBe(403);
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id1)).toBeDefined();

      const id2 = await oneAmbiguous("user");
      const res2 = await convert(id2, "nocreate", validBody());
      expect(res2.status).toBe(403);
      expect(res2.body.missing).toEqual([PERMISSIONS.TRANSACTIONS_CREATE]);
      expect(db.prepare("SELECT * FROM ambiguous_rows WHERE id = ?").get(id2)).toBeDefined();
    });
  });
});
