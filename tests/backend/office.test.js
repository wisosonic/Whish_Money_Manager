// Closed days (enforced on every route that changes data), the office commission rate with its
// history (used by the statement engines), and restoring a backup CSV.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, grantLaterPermissions } from "../../server/db.js";
import { BALANCE_CSV_COLUMNS, TRANSACTION_CSV_COLUMNS, toCsv } from "../../server/admin.js";
import { commissionRateOn } from "../../server/office.js";
import { extractTransactionsFromCsv, extractTransactionsFromRows } from "../../server/index.js";
import { DEFAULT_ROLES, PERMISSIONS } from "../../server/permissions.js";
import { createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;

beforeAll(async () => {
  srv = await startServer();
  client = await loginAll(makeClient(srv.baseUrl), createTestUsers());
});
afterAll(() => srv.close());

const req = (method, route, as, body) => client.request(method, route, { as, body });
const now = "2026-09-24T10:00:00.000Z";
const addTx = (over = {}) =>
  db.prepare(
    `INSERT INTO transactions (type, amount, commission, sender_name, reference_number, transaction_date, created_by, created_date, updated_date, store_id)
     VALUES (@type, @amount, @commission, @sender_name, @reference_number, @transaction_date, @created_by, @created_date, @created_date, @store_id)`
  ).run({ type: "cash_in", amount: 10, commission: 0.1, sender_name: "A", reference_number: "", transaction_date: "2026-09-10", created_by: "user@test.local", created_date: now, store_id: 1, ...over }).lastInsertRowid;
const addBalance = (date, value = 100) =>
  db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date, store_id) VALUES (?, ?, 'admin@test.local', ?, ?, 1)").run(date, value, now, now).lastInsertRowid;
const count = (table, where = "1=1", ...params) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;

beforeEach(() => {
  db.exec("DELETE FROM transactions; DELETE FROM daily_balances; DELETE FROM closed_days; DELETE FROM commission_rates WHERE effective_from > '2000-01-01';");
});

describe("permissions for the new features", () => {
  it("Admin and Manager can close days, restore and set the rate; a User can't", () => {
    const perms = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, r.permissions]));
    for (const p of [PERMISSIONS.DAYS_CLOSE, PERMISSIONS.DATA_RESTORE, PERMISSIONS.OFFICE_SETTINGS]) {
      expect(perms.admin).toContain(p);
      expect(perms.manager).toContain(p);
      expect(perms.user).not.toContain(p);
    }
  });

  it("existing databases get them once on startup", () => {
    const permsOf = (name) => JSON.parse(db.prepare("SELECT permissions FROM roles WHERE name = ?").get(name).permissions);
    const drop = (name) => db.prepare("UPDATE roles SET permissions = ? WHERE name = ?")
      .run(JSON.stringify(permsOf(name).filter((p) => ![PERMISSIONS.DAYS_CLOSE, PERMISSIONS.DATA_RESTORE, PERMISSIONS.OFFICE_SETTINGS].includes(p))), name);
    drop("admin");
    drop("manager");
    db.exec("DELETE FROM app_meta WHERE key IN ('granted:days:close', 'granted:data:restore', 'granted:settings:office')");
    grantLaterPermissions();
    expect(permsOf("manager")).toEqual(expect.arrayContaining([PERMISSIONS.DAYS_CLOSE, PERMISSIONS.DATA_RESTORE, PERMISSIONS.OFFICE_SETTINGS]));
    expect(permsOf("user")).not.toContain(PERMISSIONS.DAYS_CLOSE);
  });
});

describe("closing and reopening days", () => {
  it("Admin/Manager close and reopen; everyone can see which days are closed", async () => {
    const closed = await req("POST", "/closed-days", "manager", { date: "2026-09-10" });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ date: "2026-09-10", closed_by: "manager@test.local" });
    const list = await req("GET", "/closed-days", "user");
    expect(list.status).toBe(200);
    expect(list.body.map((d) => d.date)).toEqual(["2026-09-10"]);
    expect((await req("DELETE", "/closed-days/2026-09-10", "admin")).status).toBe(200);
    expect((await req("GET", "/closed-days", "user")).body).toEqual([]);
  });

  it("a User can't close or reopen a day", async () => {
    expect((await req("POST", "/closed-days", "user", { date: "2026-09-10" })).status).toBe(403);
    db.prepare("INSERT INTO closed_days (store_id, date, closed_by, closed_at) VALUES (1, '2026-09-10', 'admin@test.local', ?)").run(now);
    expect((await req("DELETE", "/closed-days/2026-09-10", "user")).status).toBe(403);
    expect(count("closed_days")).toBe(1);
  });

  it("validates the date, and refuses closing twice or reopening an open day", async () => {
    expect((await req("POST", "/closed-days", "admin", { date: "10/09/2026" })).status).toBe(400);
    await req("POST", "/closed-days", "admin", { date: "2026-09-10" });
    expect((await req("POST", "/closed-days", "admin", { date: "2026-09-10" })).body).toEqual({ error: "This day is already closed" });
    expect((await req("DELETE", "/closed-days/2026-09-11", "admin")).status).toBe(404);
  });
});

describe("a closed day can't be changed — by anyone, through any route", () => {
  const CLOSED = "2026-09-10";
  let txId;
  let balanceId;
  beforeEach(() => {
    txId = addTx({ transaction_date: CLOSED, reference_number: "tr:1" });
    balanceId = addBalance(CLOSED);
    addTx({ transaction_date: "2026-09-11", reference_number: "tr:open" });
    db.prepare("INSERT INTO closed_days (store_id, date, closed_by, closed_at) VALUES (1, ?, 'admin@test.local', ?)").run(CLOSED, now);
  });
  const locked = (res) => {
    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({ error: "This day is closed. Reopen it to make changes.", closed_days: [CLOSED] });
  };

  it("create, edit, delete a transaction", async () => {
    locked(await req("POST", "/transactions/create", "admin", { type: "cash_in", amount: 5, transaction_date: CLOSED }));
    locked(await req("PUT", `/transactions/${txId}`, "admin", { amount: 99 }));
    locked(await req("DELETE", `/transactions/${txId}`, "admin"));
    expect(db.prepare("SELECT amount FROM transactions WHERE id = ?").get(txId).amount).toBe(10);
  });

  it("moving a transaction onto a closed day, or off it", async () => {
    const openId = db.prepare("SELECT id FROM transactions WHERE reference_number = 'tr:open'").get().id;
    locked(await req("PUT", `/transactions/${openId}`, "admin", { transaction_date: CLOSED }));
    locked(await req("PUT", `/transactions/${txId}`, "admin", { transaction_date: "2026-09-12" }));
    locked(await req("POST", "/transactions/bulk-update", "admin", { ids: [openId], changes: { transaction_date: CLOSED } }));
  });

  it("bulk edit / bulk delete including a closed-day row change nothing", async () => {
    const openId = db.prepare("SELECT id FROM transactions WHERE reference_number = 'tr:open'").get().id;
    locked(await req("POST", "/transactions/bulk-update", "admin", { ids: [txId, openId], changes: { note: "x" } }));
    locked(await req("POST", "/transactions/bulk-delete", "admin", { ids: [txId, openId] }));
    expect(count("transactions")).toBe(2);
  });

  it("imports: new rows on a closed day, or replacing rows that are on one", async () => {
    locked(await req("POST", "/transactions/import", "admin", { records: [{ type: "cash_in", amount: 1, transaction_date: CLOSED, reference_number: "tr:new" }] }));
    locked(await req("POST", "/transactions/import", "admin", { overwrite: true, records: [{ type: "cash_in", amount: 1, transaction_date: "2026-09-12", reference_number: "tr:1" }] }));
    expect(count("transactions")).toBe(2);
  });

  it("the opening balance of a closed day", async () => {
    locked(await req("POST", "/daily-balances/create", "admin", { date: CLOSED, opening_balance: 5 }));
    locked(await req("PUT", `/daily-balances/${balanceId}`, "admin", { opening_balance: 5 }));
    locked(await req("DELETE", `/daily-balances/${balanceId}`, "admin"));
    expect(db.prepare("SELECT opening_balance FROM daily_balances WHERE id = ?").get(balanceId).opening_balance).toBe(100);
  });

  it("the admin panel can't delete a range that includes a closed day", async () => {
    const res = await req("POST", "/admin/purge", "admin", { from: "2026-09-01", to: "2026-09-30", expected_count: 2 });
    expect(res.status).toBe(423);
    expect(res.body).toEqual({ error: "The range includes closed days. Reopen them first.", closed_days: [CLOSED] });
    expect(count("transactions")).toBe(2);
  });

  it("other days are unaffected, and reopening lifts the lock", async () => {
    expect((await req("POST", "/transactions/create", "user", { type: "cash_in", amount: 5, transaction_date: "2026-09-11" })).status).toBe(201);
    await req("DELETE", `/closed-days/${CLOSED}`, "admin");
    expect((await req("PUT", `/transactions/${txId}`, "admin", { amount: 99 })).status).toBe(200);
  });
});

describe("commission rate", () => {
  it("starts at 1% for every day", async () => {
    const res = await req("GET", "/commission-rates?date=2026-09-10", "user");
    expect(res.body).toMatchObject({ date: "2026-09-10", rate: 1, current: 1 });
    expect(res.body.history).toEqual([expect.objectContaining({ rate: 1, effective_from: "2000-01-01", created_by: "system" })]);
  });

  it("a new rate applies from its date on; earlier days keep the old one", async () => {
    const res = await req("PUT", "/commission-rates", "manager", { rate: 1.5, effective_from: "2026-09-15" });
    expect(res.status).toBe(200);
    expect(commissionRateOn(1, "2026-09-14")).toBe(1);
    expect(commissionRateOn(1, "2026-09-15")).toBe(1.5);
    expect(commissionRateOn(1, "2027-01-01")).toBe(1.5);
    expect((await req("GET", "/commission-rates?date=2026-09-14", "user")).body.rate).toBe(1);
  });

  it("setting a rate for the same date corrects it (no duplicate step)", async () => {
    await req("PUT", "/commission-rates", "admin", { rate: 2, effective_from: "2026-09-15" });
    await req("PUT", "/commission-rates", "admin", { rate: 1.25, effective_from: "2026-09-15" });
    expect(count("commission_rates", "effective_from = '2026-09-15'")).toBe(1);
    expect(commissionRateOn(1, "2026-09-20")).toBe(1.25);
  });

  it("stored commissions never change when the rate changes", async () => {
    const id = addTx({ amount: 200, commission: 2, transaction_date: "2026-09-20" });
    await req("PUT", "/commission-rates", "admin", { rate: 3, effective_from: "2026-09-01" });
    expect(db.prepare("SELECT commission FROM transactions WHERE id = ?").get(id).commission).toBe(2);
  });

  it.each([
    [{ rate: -1, effective_from: "2026-09-15" }],
    [{ rate: 101, effective_from: "2026-09-15" }],
    [{ rate: 1.2345, effective_from: "2026-09-15" }],
    [{ rate: "1.5", effective_from: "2026-09-15" }],
    [{ rate: 1.5, effective_from: "15/09/2026" }],
    [{ rate: 1.5, effective_from: "2000-01-01" }],
  ])("rejects %j", async (body) => {
    expect((await req("PUT", "/commission-rates", "admin", body)).status).toBe(400);
  });

  it("a User can read the rate but not change it", async () => {
    expect((await req("GET", "/commission-rates", "user")).status).toBe(200);
    expect((await req("PUT", "/commission-rates", "user", { rate: 2, effective_from: "2026-09-15" })).status).toBe(403);
  });

  it("only a rate that hasn't started yet can be removed", async () => {
    await req("PUT", "/commission-rates", "admin", { rate: 2, effective_from: "2099-01-01" });
    await req("PUT", "/commission-rates", "admin", { rate: 1.5, effective_from: "2026-01-01" });
    expect((await req("DELETE", "/commission-rates/2026-01-01", "admin")).status).toBe(400);
    expect((await req("DELETE", "/commission-rates/2099-01-01", "admin")).status).toBe(200);
    expect((await req("DELETE", "/commission-rates/2099-02-02", "admin")).status).toBe(404); // future, but no rate starts then
  });

  it("the statement engines use the rate of each row's date", () => {
    const rateFor = (date) => (date >= "2026-09-02" ? 2 : 1);
    const csv = [
      "line_no,date,reference,description,debit,credit,balance",
      "1,2026-09-01,tr:1,SALE,0.00,100.00,200.00",
      "2,2026-09-02,tr:2,SALE,0.00,100.00,300.00",
      "3,2026-09-02,tr:3,SHOP,50.00,0.00,250.00",
    ].join("\n");
    const { transactions } = extractTransactionsFromCsv(csv, { rateFor });
    expect(transactions.map((t) => [t.commissionRate, t.commission])).toEqual([[1, 1], [2, 2], [0, 0]]);
    // Without a rate history (tests, old callers) it's the long-standing 1%.
    expect(extractTransactionsFromCsv(csv).transactions[1].commission).toBe(1);
    const pdfRows = [["OPENING BALANCE", "100.00"], ["02/09/2026", "tr:9", "W2W", "SAMI - 96171000000", "", "80.00", "180.00"]];
    expect(extractTransactionsFromRows(pdfRows, { rateFor }).transactions[0].commission).toBe("1.600");
  });

  it("the extract endpoints apply the office rate", async () => {
    await req("PUT", "/commission-rates", "admin", { rate: 2.5, effective_from: "2026-09-01" });
    const csv = "line_no,date,reference,description,debit,credit,balance\n1,2026-09-05,tr:1,SALE,0.00,200.00,200.00";
    const res = await req("POST", "/csv/extract", "user", { text: csv });
    expect(res.body.transactions[0]).toMatchObject({ commissionRate: 2.5, commission: 5 });
  });
});

describe("restoring a backup (replaces the file's days)", () => {
  // User's decision (2026-09-29): restoring deletes what's on the file's days (per store), then puts
  // every row of the file back, in one database transaction. It used to only add the missing ids.
  const exportCsv = async (kind, from = "2026-09-01", to = "2026-09-30") =>
    (await req("GET", `/admin/export?kind=${kind}&from=${from}&to=${to}`, "admin")).body;
  const preview = (csv, as = "admin") => req("POST", "/admin/restore/preview", as, { csv });
  const restore = (csv, expected_count, expected_delete, as = "admin") => req("POST", "/admin/restore", as, { csv, expected_count, expected_delete });
  const restoreAsPreviewed = async (csv, as = "admin") => {
    const { body } = await preview(csv, as);
    return restore(csv, body.to_add, body.to_delete, as);
  };
  const references = () => db.prepare("SELECT reference_number FROM transactions ORDER BY reference_number").all().map((r) => r.reference_number);

  it("a full round trip: back up, delete, preview, restore — rows come back exactly as they were", async () => {
    const a = addTx({ amount: 12.5, sender_name: "=SUM(A1)", reference_number: "tr:a", transaction_date: "2026-09-05" });
    const b = addTx({ amount: 30, sender_name: "خليل", reference_number: "tr:b", transaction_date: "2026-09-06", created_by: "manager@test.local" });
    const before = db.prepare("SELECT * FROM transactions ORDER BY id").all();
    const csv = await exportCsv("transactions");
    await req("POST", "/admin/purge", "admin", { from: "2026-09-01", to: "2026-09-30", expected_count: 2 });
    expect(count("transactions")).toBe(0);

    const p = await preview(csv);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ kind: "transactions", rows: 2, to_add: 2, to_delete: 0, days: 2, blocked: null, invalid_count: 0, first_date: "2026-09-05", last_date: "2026-09-06", total_in: 42.5 });
    expect(count("transactions")).toBe(0); // the preview changes nothing

    const r = await restore(csv, 2, 0);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ kind: "transactions", restored: 2, deleted: 0, days: 2 });
    const after = db.prepare("SELECT * FROM transactions ORDER BY id").all();
    // Same ids, formula-guarded text un-escaped, "entered by", dates… A CSV can't tell an empty text
    // from no value (NULL); the app treats both the same, so they compare as equal here.
    const emptyAsNull = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === "" ? null : v])));
    expect(emptyAsNull(after)).toEqual(emptyAsNull(before));
    expect(after.map((t) => t.id)).toEqual([a, b]);
  });

  it("what's on the file's days now is replaced by the backup (changed, added and deleted rows alike)", async () => {
    const keep = addTx({ reference_number: "tr:keep", amount: 10, transaction_date: "2026-09-05" });
    const gone = addTx({ reference_number: "tr:gone", transaction_date: "2026-09-06" });
    const csv = await exportCsv("transactions");
    db.prepare("DELETE FROM transactions WHERE id = ?").run(gone);
    db.prepare("UPDATE transactions SET amount = 999 WHERE id = ?").run(keep); // changed since
    addTx({ reference_number: "tr:new", transaction_date: "2026-09-05" }); // added since, on a file day
    const outside = addTx({ reference_number: "tr:outside", transaction_date: "2026-09-20" }); // not a file day
    const p = await preview(csv);
    expect(p.body).toMatchObject({ to_add: 2, to_delete: 2, deleted_elsewhere: 0, days: 2 });
    expect((await restore(csv, 2, 2)).body).toMatchObject({ restored: 2, deleted: 2 });
    expect(db.prepare("SELECT amount FROM transactions WHERE id = ?").get(keep).amount).toBe(10); // as in the backup
    expect(references()).toEqual(["tr:gone", "tr:keep", "tr:outside"]); // tr:new (only on a file day now) is gone
    expect(db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(outside)).toBeTruthy();
  });

  it("a statement re-imported with 'replace' since the backup (new ids) isn't doubled", async () => {
    // The reviewer's case: the old restore matched ids only, so the re-imported copies stayed and
    // the backup's originals came back too.
    const first = await req("POST", "/transactions/import", "admin", { records: [
      { type: "cash_in", amount: 50, reference_number: "tr:R1", transaction_date: "2026-09-07" },
      { type: "cash_in", amount: 60, reference_number: "tr:R2", transaction_date: "2026-09-07" },
    ] });
    expect(first.status).toBe(201);
    const csv = await exportCsv("transactions");
    await req("POST", "/transactions/import", "admin", { overwrite: true, records: [
      { type: "cash_in", amount: 50, reference_number: "tr:R1", transaction_date: "2026-09-07" },
      { type: "cash_in", amount: 60, reference_number: "tr:R2", transaction_date: "2026-09-07" },
    ] });
    expect((await preview(csv)).body).toMatchObject({ to_add: 2, to_delete: 2 });
    await restoreAsPreviewed(csv);
    expect(references()).toEqual(["tr:R1", "tr:R2"]);
  });

  it("the same transaction moved to another day, or re-imported onto another day, is removed there too", async () => {
    const moved = addTx({ reference_number: "tr:m", transaction_date: "2026-09-05" });
    addTx({ reference_number: "tr:r", transaction_date: "2026-09-05" });
    const csv = await exportCsv("transactions");
    db.prepare("UPDATE transactions SET transaction_date = '2026-09-25' WHERE id = ?").run(moved); // moved since
    db.prepare("DELETE FROM transactions WHERE reference_number = 'tr:r'").run();
    addTx({ reference_number: "tr:r", transaction_date: "2026-09-26" }); // re-imported on another day, new id
    const p = await preview(csv);
    expect(p.body).toMatchObject({ to_add: 2, to_delete: 2, deleted_elsewhere: 2 });
    await restoreAsPreviewed(csv);
    expect(db.prepare("SELECT reference_number, transaction_date FROM transactions ORDER BY reference_number").all()).toEqual([
      { reference_number: "tr:m", transaction_date: "2026-09-05" }, { reference_number: "tr:r", transaction_date: "2026-09-05" },
    ]);
  });

  it("a reference used by another store's transaction refuses the restore (409), like an import", async () => {
    addTx({ reference_number: "tr:x", transaction_date: "2026-09-05" });
    const csv = await exportCsv("transactions");
    db.exec("DELETE FROM transactions");
    const other = db.prepare("INSERT INTO stores (name, created_date, updated_date) VALUES ('Branch 9', 'x', 'x')").run().lastInsertRowid;
    try {
      addTx({ reference_number: "tr:x", transaction_date: "2026-09-05", store_id: other });
      const p = await preview(csv);
      expect(p.body).toMatchObject({ blocked: "other_stores", in_other_stores: 1 });
      const r = await restore(csv, p.body.to_add, p.body.to_delete);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("Some of these transactions are already recorded in another store");
      expect(count("transactions")).toBe(1);
    } finally {
      // Later tests expect a single store (old backups without store_id go to it).
      db.prepare("DELETE FROM transactions WHERE store_id = ?").run(other);
      db.prepare("DELETE FROM stores WHERE id = ?").run(other);
    }
  });

  it("a closed day among the days written or cleared refuses the whole restore (423)", async () => {
    addTx({ transaction_date: "2026-09-05" });
    const moved = addTx({ transaction_date: "2026-09-06" });
    const csv = await exportCsv("transactions");
    db.prepare("INSERT INTO closed_days (store_id, date, closed_by, closed_at) VALUES (1, '2026-09-06', 'admin@test.local', ?)").run(now);
    let p = await preview(csv);
    expect(p.body).toMatchObject({ blocked: "closed", closed_days: ["2026-09-06"] });
    const r = await restore(csv, p.body.to_add, p.body.to_delete);
    expect(r.status).toBe(423);
    expect(count("transactions")).toBe(2);
    // A day that would only be cleared (the same transaction, moved there since) counts too.
    db.exec("DELETE FROM closed_days");
    db.prepare("UPDATE transactions SET transaction_date = '2026-09-28' WHERE id = ?").run(moved);
    db.prepare("INSERT INTO closed_days (store_id, date, closed_by, closed_at) VALUES (1, '2026-09-28', 'admin@test.local', ?)").run(now);
    p = await preview(csv);
    expect(p.body).toMatchObject({ blocked: "closed", closed_days: ["2026-09-28"] });
  });

  it("opening balances: the store's balance on each of the file's dates is replaced", async () => {
    addBalance("2026-09-05", 500);
    addBalance("2026-09-06", 600);
    const csv = await exportCsv("balances");
    db.exec("DELETE FROM daily_balances WHERE date = '2026-09-06'");
    db.prepare("UPDATE daily_balances SET opening_balance = 1 WHERE date = '2026-09-05'").run();
    addBalance("2026-09-07", 700); // not in the file: kept
    expect((await preview(csv)).body).toMatchObject({ kind: "balances", to_add: 2, to_delete: 1, days: 2 });
    expect((await restore(csv, 2, 1)).body).toMatchObject({ restored: 2, deleted: 1 });
    expect(db.prepare("SELECT date, opening_balance FROM daily_balances ORDER BY date").all()).toEqual([
      { date: "2026-09-05", opening_balance: 500 }, { date: "2026-09-06", opening_balance: 600 }, { date: "2026-09-07", opening_balance: 700 },
    ]);
  });

  it("refuses (409) when either count changed since the preview, and changes nothing", async () => {
    addTx({ transaction_date: "2026-09-05" });
    const csv = await exportCsv("transactions");
    let r = await restore(csv, 1, 5);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "The data changed since the preview. Check the counts and try again.", to_add: 1, to_delete: 1 });
    r = await restore(csv, 3, 1);
    expect(r.status).toBe(409);
    expect(count("transactions")).toBe(1);
    expect((await req("POST", "/admin/restore", "admin", { csv, expected_count: 1 })).status).toBe(400); // expected_delete is required
  });

  it("a file with an invalid row can't be restored at all", async () => {
    const rows = [
      { id: 50, type: "cash_in", amount: 10, commission: 0.1, created_date: now, transaction_date: "2026-09-05" },
      { id: 51, type: "refund", amount: 10, commission: 0, created_date: now, transaction_date: "2026-09-05" },
      { id: 52, type: "cash_out", amount: "abc", commission: 0, created_date: now, transaction_date: "2026-09-05" },
    ];
    const csv = toCsv(TRANSACTION_CSV_COLUMNS, rows);
    const p = await preview(csv);
    expect(p.body).toMatchObject({ invalid_count: 2, invalid: [{ line: 3, field: "type" }, { line: 4, field: "amount" }] });
    const r = await restore(csv, 0, 0);
    expect(r.status).toBe(400);
    expect(count("transactions")).toBe(0);
  });

  it.each([
    ["an empty file", "", "The file is empty"],
    ["a statement CSV (not a backup)", "line_no,date,reference\n1,2026-09-01,tr:1", "This isn't a backup file from the admin panel"],
  ])("rejects %s", async (_label, csv, error) => {
    const p = await preview(csv);
    expect(p.status).toBe(400);
    expect(p.body).toEqual({ error });
  });

  it("detects the balances format by its header", async () => {
    const csv = toCsv(BALANCE_CSV_COLUMNS, [{ id: 1, date: "2026-09-07", opening_balance: 70, created_by: "a@x", created_date: now, updated_date: now }]);
    expect((await preview(csv)).body).toMatchObject({ kind: "balances", to_add: 1 });
  });

  it("needs the restore permission, and the delete permission to restore (it deletes the file's days)", async () => {
    const csv = toCsv(TRANSACTION_CSV_COLUMNS, []);
    expect((await preview(csv, "user")).status).toBe(403);
    expect((await restore(csv, 0, 0, "user")).status).toBe(403);
    const role = db.prepare("SELECT permissions FROM roles WHERE name = 'manager'").get().permissions;
    db.prepare("UPDATE roles SET permissions = ? WHERE name = 'manager'").run(JSON.stringify(JSON.parse(role).filter((p) => p !== "data:purge")));
    try {
      expect((await preview(csv, "manager")).status).toBe(200); // looking is fine
      expect((await restore(csv, 0, 0, "manager")).status).toBe(403);
    } finally {
      db.prepare("UPDATE roles SET permissions = ? WHERE name = 'manager'").run(role);
    }
  });
});
