// Functional API tests (signed in as Admin, who may do everything). Login/session security is in
// auth.test.js, per-role rules in permissions.test.js, user management in users.test.js.
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;
let users;

beforeAll(async () => {
  srv = await startServer();
  users = createTestUsers();
  client = await loginAll(makeClient(srv.baseUrl), users);
});

afterAll(() => srv.close());

const request = (method, route, options = {}) => client.request(method, route, { as: "admin", ...options });

const tx = (overrides = {}) => ({
  type: "cash_in",
  amount: 100,
  commission: 1,
  sender_name: "ALI",
  receiver_name: "Vicario",
  reference_number: "tr:1",
  transaction_date: "2026-09-23",
  ...overrides,
});

const listByIds = async (ids) =>
  (await request("POST", "/transactions/filter", { body: { filter: {}, limit: 10000 } })).body.filter((r) => ids.includes(r.id));

describe("transactions CRUD", () => {
  it("creates, filters, updates and deletes a transaction", async () => {
    const created = await request("POST", "/transactions/create", { body: tx({ reference_number: "tr:crud" }) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: "cash_in", amount: 100, created_by: users.admin.email });

    const listed = await request("POST", "/transactions/filter", { body: { filter: { reference_number: "tr:crud" } } });
    expect(listed.body.map((t) => t.id)).toEqual([created.body.id]);

    const updated = await request("PUT", `/transactions/${created.body.id}`, { body: { amount: 250 } });
    expect(updated.body.amount).toBe(250);

    const deleted = await request("DELETE", `/transactions/${created.body.id}`);
    expect(deleted.body).toEqual({ ok: true, id: created.body.id });
    expect((await request("DELETE", `/transactions/${created.body.id}`)).status).toBe(404);
    expect((await request("PUT", `/transactions/${created.body.id}`, { body: { amount: 1 } })).status).toBe(404);
  });

  it("everyone in the office sees every transaction", async () => {
    const byManager = await client.request("POST", "/transactions/create", { as: "manager", body: tx({ reference_number: "tr:shared" }) });
    const seenByUser = await client.request("POST", "/transactions/filter", { as: "user", body: { filter: { reference_number: "tr:shared" } } });
    expect(seenByUser.body.map((t) => t.id)).toEqual([byManager.body.id]);
    expect(seenByUser.body[0].created_by).toBe(users.manager.email);
  });

  it("sets created_by from the signed-in user — clients can't spoof it", async () => {
    const created = await request("POST", "/transactions/create", {
      as: "user",
      body: tx({ reference_number: "tr:spoof", created_by: "admin@test.local" }),
    });
    expect(created.body.created_by).toBe(users.user.email);

    const bulk = await request("POST", "/transactions/bulk-create", {
      body: { records: [tx({ reference_number: "tr:spoof2", created_by: "someone@else" })] },
    });
    expect(bulk.body[0].created_by).toBe(users.admin.email);
  });

  it("bulk-creates records in order", async () => {
    const records = [tx({ reference_number: "tr:b1" }), tx({ reference_number: "tr:b2", type: "cash_out" })];
    const { status, body } = await request("POST", "/transactions/bulk-create", { body: { records } });
    expect(status).toBe(201);
    expect(body.map((t) => t.reference_number)).toEqual(["tr:b1", "tr:b2"]);
  });

  it("returns 404 for an unknown entity", async () => {
    expect((await request("POST", "/unknown/filter", { body: {} })).status).toBe(404);
  });

  it("rejects filters on unknown columns (no SQL injection through filter keys)", async () => {
    const injected = await request("POST", "/transactions/filter", { body: { filter: { "1=1 OR created_by": "x" } } });
    expect(injected.status).toBe(400);
    expect(injected.body.error).toMatch(/Unknown filter field/);
  });

  it("only accepts JSON for writes", async () => {
    const form = await request("POST", "/transactions/create", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      rawBody: "type=cash_in&amount=5",
    });
    expect(form.status).toBe(415);
  });
});

describe("daily balances", () => {
  it("keeps one office-wide opening balance per date", async () => {
    const created = await request("POST", "/daily-balances/create", { body: { date: "2026-09-23", opening_balance: 10648.51 } });
    expect(created.status).toBe(201);
    // Another Admin/Manager setting the same day updates it rather than creating a second one.
    const again = await client.request("POST", "/daily-balances/create", { as: "manager", body: { date: "2026-09-23", opening_balance: 500 } });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);

    const listed = await client.request("POST", "/daily-balances/filter", { as: "user", body: { filter: { date: "2026-09-23" } } });
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ date: "2026-09-23", opening_balance: 500 });
  });
});

describe("statement import endpoints", () => {
  it("POST /csv/extract parses a CSV statement", async () => {
    const text = fs.readFileSync(path.join(__dirname, "../fixtures/statement.csv"), "utf8");
    const { status, body } = await request("POST", "/csv/extract", { body: { text } });
    expect(status).toBe(200);
    expect(body.transactions).toHaveLength(127);
    expect(body.validation.is_valid).toBe(true);
  });

  it("POST /csv/extract returns 400 for empty or malformed input", async () => {
    expect((await request("POST", "/csv/extract", { body: { text: "" } })).status).toBe(400);
    const malformed = await request("POST", "/csv/extract", { body: { text: "a,b\n1,2" } });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatch(/transactions header/);
  });

  it("POST /pdf/extract returns 400 without data", async () => {
    expect((await request("POST", "/pdf/extract", { body: {} })).status).toBe(400);
  });
});

describe("duplicate detection and overwrite", () => {
  const records = [
    tx({ reference_number: "tr:100", amount: 10 }),
    tx({ reference_number: "tr:101", amount: 20 }),
    tx({ reference_number: "tr:102", amount: 30 }),
  ];

  it("imports, detects re-uploads by reference (office-wide), and replaces them on overwrite", async () => {
    const first = await client.request("POST", "/transactions/import", { as: "user", body: { records } });
    expect(first.status).toBe(201);
    expect(first.body.replaced).toBe(0);
    expect(first.body.records).toHaveLength(3);

    // A manual entry without a reference must never be treated as a duplicate or deleted.
    const manual = await request("POST", "/transactions/create", { body: tx({ reference_number: "", amount: 999 }) });

    // A different user re-uploading the same statement is detected too.
    const duplicates = await request("POST", "/transactions/find-duplicates", {
      body: { references: ["tr:100", "tr:101", "tr:102", "tr:999", "", null] },
    });
    expect(duplicates.body.map((t) => t.reference_number).sort()).toEqual(["tr:100", "tr:101", "tr:102"]);

    const updated = records.map((r) => ({ ...r, amount: r.amount + 1 }));
    const overwrite = await request("POST", "/transactions/import", { body: { records: updated, overwrite: true } });
    expect(overwrite.body.replaced).toBe(3);

    const refs = (await request("POST", "/transactions/filter", { body: { filter: {}, limit: 10000 } })).body
      .filter((t) => ["tr:100", "tr:101", "tr:102"].includes(t.reference_number));
    expect(refs.map((t) => t.amount).sort((a, b) => a - b)).toEqual([11, 21, 31]);
    expect(refs.every((t) => t.created_by === users.admin.email)).toBe(true);
    expect((await listByIds([manual.body.id]))).toHaveLength(1);
  });

  it("returns no duplicates for an empty reference list", async () => {
    expect((await request("POST", "/transactions/find-duplicates", { body: { references: [] } })).body).toEqual([]);
  });
});

describe("bulk actions", () => {
  let counter = 0;
  const seed = async (as = "admin") => {
    counter += 1;
    const records = [
      tx({ reference_number: `tr:bulk-${counter}-1`, amount: 100, commission: 1, transaction_date: "2026-09-01", note: "a" }),
      tx({ reference_number: `tr:bulk-${counter}-2`, amount: 250, commission: 0, transaction_date: "2026-09-01", type: "cash_out" }),
      tx({ reference_number: `tr:bulk-${counter}-3`, amount: 75.5, commission: 0.755, transaction_date: "2026-09-02" }),
    ];
    const { body } = await client.request("POST", "/transactions/import", { as, body: { records } });
    return body.records.map((r) => r.id);
  };

  it("applies the same field changes to every selected transaction", async () => {
    const [id1, id2, id3] = await seed();
    const { status, body } = await request("POST", "/transactions/bulk-update", {
      body: { ids: [id1, id2], changes: { service: "W2W", note: "", transaction_date: "2026-09-05", sender_name: "ALI" } },
    });
    expect(status).toBe(200);
    expect(body.updated).toBe(2);
    body.records.forEach((r) => expect(r).toMatchObject({ service: "W2W", note: "", transaction_date: "2026-09-05", sender_name: "ALI" }));

    // The unselected row keeps its original values.
    const [untouched] = await listByIds([id3]);
    expect(untouched.transaction_date).toBe("2026-09-02");
    expect(untouched.service ?? "").toBe("");
    expect(untouched.amount).toBe(75.5);
    // Per-row values are never overwritten by a bulk edit.
    expect(body.records.map((r) => r.amount).sort((a, b) => a - b)).toEqual([100, 250]);
  });

  it("recalculates commission per row from a commission rate", async () => {
    const [id1, id2, id3] = await seed();
    const { body } = await request("POST", "/transactions/bulk-update", { body: { ids: [id1, id2, id3], changes: { commission_rate: 1.5 } } });
    const byId = Object.fromEntries(body.records.map((r) => [r.id, r.commission]));
    expect(byId[id1]).toBe(1.5); // 1.5% of 100
    expect(byId[id2]).toBe(3.75); // 1.5% of 250
    expect(byId[id3]).toBe(1.133); // 1.5% of 75.5 = 1.1325 → 3 decimals
  });

  it("changes the type of every selected transaction", async () => {
    const [id1, id2] = await seed();
    const { body } = await request("POST", "/transactions/bulk-update", { body: { ids: [id1, id2], changes: { type: "cash_out" } } });
    expect(body.records.every((r) => r.type === "cash_out")).toBe(true);
  });

  it("rejects invalid bulk updates", async () => {
    const [id1] = await seed();
    const expect400 = async (body) => expect((await request("POST", "/transactions/bulk-update", { body })).status).toBe(400);
    await expect400({ ids: [], changes: { note: "x" } });
    await expect400({ ids: [id1], changes: {} });
    await expect400({ ids: [id1], changes: { amount: 5 } }); // not a bulk-editable field
    await expect400({ ids: [id1], changes: { type: "refund" } });
    await expect400({ ids: [id1], changes: { transaction_date: "23/09/2026" } });
    await expect400({ ids: [id1], changes: { commission_rate: -1 } });
    await expect400({ ids: [id1], changes: { commission_rate: "" } });
  });

  it("an Admin can bulk-edit transactions entered by anyone", async () => {
    const [byUser] = await seed("user");
    const { body } = await request("POST", "/transactions/bulk-update", { body: { ids: [byUser], changes: { note: "checked" } } });
    expect(body.updated).toBe(1);
    expect(body.records[0].note).toBe("checked");
  });

  it("deletes exactly the selected transactions", async () => {
    const [id1, id2, id3] = await seed();
    const { status, body } = await request("POST", "/transactions/bulk-delete", { body: { ids: [id1, id3, id3, "x", -4] } });
    expect(status).toBe(200);
    expect(body.deleted).toBe(2);
    expect((await listByIds([id1, id2, id3])).map((r) => r.id)).toEqual([id2]);
  });

  it("requires a selection to delete", async () => {
    expect((await request("POST", "/transactions/bulk-delete", { body: { ids: [] } })).status).toBe(400);
  });
});
