// The seed script: default roles, the initial Admin, idempotency, and migrating rows owned by the
// old built-in login. Runs against its own in-memory database (each test file gets a fresh one).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEGACY_OWNER_EMAIL, db } from "../../server/db.js";
import { DEFAULT_ROLES } from "../../server/permissions.js";
import { DEFAULT_ADMIN_EMAIL, seedDatabase } from "../../server/seed.js";
import { makeClient, startServer } from "./helpers.js";

let srv;
let client;

beforeAll(async () => {
  srv = await startServer();
  client = makeClient(srv.baseUrl);
  // Data created before accounts existed.
  const now = new Date().toISOString();
  db.prepare("INSERT INTO transactions (type, amount, created_by, created_date, updated_date) VALUES ('cash_in', 5, ?, ?, ?)").run(LEGACY_OWNER_EMAIL, now, now);
  db.prepare("INSERT INTO transactions (type, amount, created_by, created_date, updated_date) VALUES ('cash_out', 7, ?, ?, ?)").run(LEGACY_OWNER_EMAIL, now, now);
  db.prepare("INSERT INTO daily_balances (date, opening_balance, created_by, created_date, updated_date) VALUES ('2026-09-23', 10648.51, ?, ?, ?)").run(LEGACY_OWNER_EMAIL, now, now);
});

afterAll(() => srv.close());

describe("seedDatabase", () => {
  let first;

  it("creates the three default roles with their permissions", () => {
    first = seedDatabase({ adminEmail: "Owner@Shop.test", adminPassword: "owner-password-1", adminName: "Owner" });
    expect(first.roles).toEqual(["admin", "manager", "user"]);
    const stored = db.prepare("SELECT name, permissions FROM roles").all();
    DEFAULT_ROLES.forEach((role) => {
      expect(JSON.parse(stored.find((r) => r.name === role.name).permissions)).toEqual(role.permissions);
    });
  });

  it("creates the initial Admin, who can sign in", async () => {
    expect(first.admin).toEqual({ email: "owner@shop.test", created: true });
    expect(first.generatedPassword).toBeNull();
    const login = await client.login("owner", "owner@shop.test", "owner-password-1");
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ role: "admin", full_name: "Owner" });
  });

  it("reassigns rows owned by the old built-in login to the Admin", () => {
    expect(first.migrated).toEqual({ transactions: 2, daily_balances: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE created_by = ?").get(LEGACY_OWNER_EMAIL).n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE created_by = 'owner@shop.test'").get().n).toBe(2);
  });

  it("is safe to run again: keeps the Admin's password and restores default role permissions", async () => {
    db.prepare("UPDATE roles SET permissions = '[]' WHERE name = 'manager'").run();
    const again = seedDatabase({ adminEmail: "owner@shop.test", adminPassword: "a-different-password" });
    expect(again.admin.created).toBe(false);
    expect(again.migrated).toEqual({ transactions: 0, daily_balances: 0 });
    expect(JSON.parse(db.prepare("SELECT permissions FROM roles WHERE name = 'manager'").get().permissions))
      .toEqual(DEFAULT_ROLES.find((r) => r.name === "manager").permissions);
    expect((await client.login("x", "owner@shop.test", "owner-password-1")).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(1);
  });

  it("generates a strong password (shown once) when none is given", async () => {
    const result = seedDatabase({ adminEmail: "second-admin@shop.test" });
    expect(result.generatedPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect((await client.login("gen", "second-admin@shop.test", result.generatedPassword)).status).toBe(200);
  });

  it("defaults the Admin email and refuses a short password", () => {
    expect(DEFAULT_ADMIN_EMAIL).toBe("admin@whish.local");
    expect(() => seedDatabase({ adminEmail: "weak@shop.test", adminPassword: "short" })).toThrow(/at least 8/);
  });
});
