// Role-based access control, end to end against the API:
//   Admin — everything.  Manager — everything except user/role management.
//   User  — sees everything; adds, imports and edits OWN transactions; no deleting, no replacing
//           imports, no opening balances, no user management.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS as P, canUpdateTransaction } from "../../server/permissions.js";
import { createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;
let users;
let ids; // transactions created by user, user2 and manager

beforeAll(async () => {
  srv = await startServer();
  users = createTestUsers();
  client = await loginAll(makeClient(srv.baseUrl), users);
  const create = async (as, ref) =>
    (await client.request("POST", "/transactions/create", { as, body: { type: "cash_in", amount: 100, reference_number: ref, transaction_date: "2026-09-23" } })).body.id;
  ids = { user: await create("user", "tr:p-user"), user2: await create("user2", "tr:p-user2"), manager: await create("manager", "tr:p-manager") };
});

afterAll(() => srv.close());

const as = (role) => ({
  get: (route) => client.request("GET", route, { as: role }),
  post: (route, body) => client.request("POST", route, { as: role, body }),
  put: (route, body) => client.request("PUT", route, { as: role, body }),
  del: (route) => client.request("DELETE", route, { as: role }),
});

const existing = async (id) =>
  (await as("admin").post("/transactions/filter", { filter: { id } })).body[0];

describe("default role definitions", () => {
  const perms = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, r.permissions]));

  it("Admin has every permission", () => {
    expect(perms.admin.sort()).toEqual(Object.values(P).sort());
  });

  it("Manager has everything except user management", () => {
    expect(perms.manager.sort()).toEqual(Object.values(P).filter((p) => p !== P.USERS_MANAGE).sort());
  });

  it("User can read, create, import and edit own — nothing else", () => {
    expect(perms.user.sort()).toEqual(
      [P.TRANSACTIONS_READ, P.TRANSACTIONS_CREATE, P.TRANSACTIONS_IMPORT, P.TRANSACTIONS_UPDATE_OWN, P.BALANCES_READ].sort()
    );
  });

  it("canUpdateTransaction: any for update:any, own only for update:own", () => {
    const user = { email: "u@x", permissions: [P.TRANSACTIONS_UPDATE_OWN] };
    const manager = { email: "m@x", permissions: [P.TRANSACTIONS_UPDATE_ANY] };
    expect(canUpdateTransaction(user, { created_by: "u@x" })).toBe(true);
    expect(canUpdateTransaction(user, { created_by: "other@x" })).toBe(false);
    expect(canUpdateTransaction(manager, { created_by: "other@x" })).toBe(true);
    expect(canUpdateTransaction(null, { created_by: "u@x" })).toBe(false);
  });
});

describe.each(["admin", "manager", "user"])("%s — shared features", (role) => {
  it("sees all office transactions and opening balances", async () => {
    const txs = (await as(role).post("/transactions/filter", { filter: {} })).body;
    expect(txs.map((t) => t.id)).toEqual(expect.arrayContaining([ids.user, ids.user2, ids.manager]));
    expect((await as(role).post("/daily-balances/filter", { filter: {} })).status).toBe(200);
  });

  it("can add transactions", async () => {
    expect((await as(role).post("/transactions/create", { type: "cash_out", amount: 5 })).status).toBe(201);
  });

  it("can import statements and check for duplicates", async () => {
    expect((await as(role).post("/csv/extract", { text: "line_no,date,debit,credit,balance\n1,2026-01-01,1.00,0.00,9.00" })).status).toBe(200);
    expect((await as(role).post("/transactions/find-duplicates", { references: ["tr:p-user"] })).status).toBe(200);
    expect((await as(role).post("/transactions/import", { records: [{ type: "cash_in", amount: 1, reference_number: `tr:imp-${role}` }] })).status).toBe(201);
  });

  it("can edit transactions they entered", async () => {
    const own = (await as(role).post("/transactions/create", { type: "cash_in", amount: 7 })).body.id;
    const response = await as(role).put(`/transactions/${own}`, { note: `edited by ${role}` });
    expect(response.status).toBe(200);
    expect(response.body.note).toBe(`edited by ${role}`);
  });
});

describe("User role restrictions", () => {
  it("can't edit another person's transaction (single edit)", async () => {
    const response = await as("user").put(`/transactions/${ids.user2}`, { note: "not mine" });
    expect(response.status).toBe(403);
    expect((await existing(ids.user2)).note).not.toBe("not mine");
    expect((await as("user").put(`/transactions/${ids.manager}`, { amount: 1 })).status).toBe(403);
  });

  it("can bulk-edit only when every selected row is their own", async () => {
    expect((await as("user").post("/transactions/bulk-update", { ids: [ids.user], changes: { service: "QR" } })).status).toBe(200);

    const mixed = await as("user").post("/transactions/bulk-update", { ids: [ids.user, ids.user2], changes: { service: "HACK" } });
    expect(mixed.status).toBe(403);
    expect(mixed.body.not_own).toEqual([ids.user2]);
    // All-or-nothing: the own row wasn't changed either.
    expect((await existing(ids.user)).service).toBe("QR");
    expect((await existing(ids.user2)).service).not.toBe("HACK");
  });

  it("can't delete — single, bulk, or by replacing an import", async () => {
    const single = await as("user").del(`/transactions/${ids.user}`);
    expect(single.status).toBe(403);
    expect(single.body.missing).toEqual([P.TRANSACTIONS_DELETE]);
    expect((await as("user").post("/transactions/bulk-delete", { ids: [ids.user] })).status).toBe(403);
    expect(await existing(ids.user)).toBeDefined();

    const overwrite = await as("user").post("/transactions/import", {
      records: [{ type: "cash_in", amount: 1, reference_number: "tr:p-user" }],
      overwrite: true,
    });
    expect(overwrite.status).toBe(403);
    expect((await as("admin").post("/transactions/filter", { filter: { reference_number: "tr:p-user" } })).body).toHaveLength(1);
  });

  it("can't set, change or remove opening balances", async () => {
    expect((await as("user").post("/daily-balances/create", { date: "2026-09-10", opening_balance: 1 })).status).toBe(403);
    const balance = (await as("manager").post("/daily-balances/create", { date: "2026-09-11", opening_balance: 100 })).body;
    expect((await as("user").put(`/daily-balances/${balance.id}`, { opening_balance: 0 })).status).toBe(403);
    expect((await as("user").del(`/daily-balances/${balance.id}`)).status).toBe(403);
    expect((await as("user").post("/daily-balances/bulk-create", { records: [{ date: "2026-09-12" }] })).status).toBe(403);
  });
});

describe("Manager role", () => {
  it("can edit and delete anyone's transactions", async () => {
    expect((await as("manager").put(`/transactions/${ids.user2}`, { note: "reviewed" })).status).toBe(200);
    const doomed = (await as("user").post("/transactions/create", { type: "cash_in", amount: 3 })).body.id;
    expect((await as("manager").del(`/transactions/${doomed}`)).status).toBe(200);
    const bulkDoomed = (await as("user").post("/transactions/create", { type: "cash_in", amount: 4 })).body.id;
    expect((await as("manager").post("/transactions/bulk-delete", { ids: [bulkDoomed] })).body.deleted).toBe(1);
  });

  it("can replace an imported statement and manage opening balances", async () => {
    expect((await as("manager").post("/transactions/import", { records: [{ type: "cash_in", amount: 2, reference_number: "tr:imp-user" }], overwrite: true })).status).toBe(201);
    const balance = await as("manager").post("/daily-balances/create", { date: "2026-09-13", opening_balance: 50 });
    expect(balance.status).toBe(201);
    expect((await as("manager").put(`/daily-balances/${balance.body.id}`, { opening_balance: 60 })).status).toBe(200);
    expect((await as("manager").del(`/daily-balances/${balance.body.id}`)).status).toBe(200);
  });
});

describe("user & role management is Admin-only", () => {
  it.each(["manager", "user"])("%s gets 403 on every user/role endpoint", async (role) => {
    expect((await as(role).get("/users")).status).toBe(403);
    expect((await as(role).get("/roles")).status).toBe(403);
    expect((await as(role).post("/users", { email: "x@test.local", password: "long-enough", role: "admin" })).status).toBe(403);
    expect((await as(role).put(`/users/${users[role].id}`, { role: "admin" })).status).toBe(403);
  });

  it("a User can't promote themselves", async () => {
    await as("user").put(`/users/${users.user.id}`, { role: "admin" });
    expect((await as("user").get("/auth/me")).body.role).toBe("user");
  });

  it("Admin can use them", async () => {
    expect((await as("admin").get("/users")).status).toBe(200);
    expect((await as("admin").get("/roles")).status).toBe(200);
  });
});

describe("permissions are read live from the database", () => {
  it("a role change applies on the very next request — no re-login needed", async () => {
    const victim = (await as("user2").post("/transactions/create", { type: "cash_in", amount: 9 })).body.id;
    expect((await as("user2").del(`/transactions/${victim}`)).status).toBe(403);

    await as("admin").put(`/users/${users.user2.id}`, { role: "manager" });
    expect((await as("user2").get("/auth/me")).body.role).toBe("manager");
    expect((await as("user2").del(`/transactions/${victim}`)).status).toBe(200);

    await as("admin").put(`/users/${users.user2.id}`, { role: "user" });
    const another = (await as("user2").post("/transactions/create", { type: "cash_in", amount: 9 })).body.id;
    expect((await as("user2").del(`/transactions/${another}`)).status).toBe(403);
  });
});
