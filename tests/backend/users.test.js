// Admin user management: create, change role, deactivate, reset password, and the safety rules
// (at least one active Admin; can't deactivate yourself; deactivation/reset revoke sessions).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetLoginRateLimit } from "../../server/auth.js";
import { PASSWORD, createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;
let users;

beforeAll(async () => {
  srv = await startServer();
  users = createTestUsers();
  client = await loginAll(makeClient(srv.baseUrl), users);
});

afterAll(() => srv.close());
beforeEach(() => resetLoginRateLimit());

const admin = {
  get: (route) => client.request("GET", route, { as: "admin" }),
  post: (route, body) => client.request("POST", route, { as: "admin", body }),
  put: (route, body) => client.request("PUT", route, { as: "admin", body }),
};

describe("listing", () => {
  it("lists users with their roles and never exposes password hashes", async () => {
    const { status, body } = await admin.get("/users");
    expect(status).toBe(200);
    expect(body.map((u) => u.email)).toEqual(expect.arrayContaining(["admin@test.local", "manager@test.local", "user@test.local"]));
    body.forEach((u) => {
      expect(u).not.toHaveProperty("password_hash");
      expect(u).toHaveProperty("role");
      expect(Array.isArray(u.permissions)).toBe(true);
    });
  });

  it("lists the three default roles with their permissions", async () => {
    const { body } = await admin.get("/roles");
    expect(body.map((r) => r.name)).toEqual(["admin", "manager", "user"]);
    expect(body.map((r) => r.label)).toEqual(["Admin", "Manager", "User"]);
    expect(body[0].permissions).toContain("users:manage");
  });
});

describe("creating users", () => {
  it("creates a user who can then sign in with their role", async () => {
    const created = await admin.post("/users", { email: "  New.Cashier@Test.Local ", full_name: "New Cashier", password: "cashier-pass-1", role: "user" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: "new.cashier@test.local", full_name: "New Cashier", role: "user", is_active: true });

    const login = await client.login("cashier", "new.cashier@test.local", "cashier-pass-1");
    expect(login.status).toBe(200);
    expect(login.body.role).toBe("user");
  });

  it("rejects duplicates (case-insensitive), bad emails, short passwords and unknown roles", async () => {
    expect((await admin.post("/users", { email: "MANAGER@test.local", password: "long-enough", role: "user" })).status).toBe(409);
    expect((await admin.post("/users", { email: "not-an-email", password: "long-enough", role: "user" })).status).toBe(400);
    const short = await admin.post("/users", { email: "short@test.local", password: "1234567", role: "user" });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/at least 8/);
    expect((await admin.post("/users", { email: "role@test.local", password: "long-enough", role: "superuser" })).status).toBe(400);
  });
});

describe("updating users", () => {
  const fresh = async (email, role = "user") =>
    (await admin.post("/users", { email, full_name: "Temp", password: PASSWORD, role })).body;

  it("changes name and role", async () => {
    const u = await fresh("rename@test.local");
    const { body } = await admin.put(`/users/${u.id}`, { full_name: "Renamed", role: "manager" });
    expect(body).toMatchObject({ full_name: "Renamed", role: "manager", role_label: "Manager" });
  });

  it("deactivating signs the user out everywhere and blocks sign-in; reactivating restores access", async () => {
    const u = await fresh("leaver@test.local");
    await client.login("leaverA", u.email);
    await client.login("leaverB", u.email);

    const off = await admin.put(`/users/${u.id}`, { is_active: false });
    expect(off.body).toMatchObject({ is_active: false, sessions_revoked: 2 });
    expect((await client.request("GET", "/auth/me", { as: "leaverA" })).status).toBe(401);
    expect((await client.request("GET", "/auth/me", { as: "leaverB" })).status).toBe(401);
    expect((await client.login("x", u.email)).status).toBe(401);

    await admin.put(`/users/${u.id}`, { is_active: true });
    expect((await client.login("x", u.email)).status).toBe(200);
  });

  it("resetting a password signs the user out everywhere; only the new password works", async () => {
    const u = await fresh("forgetful@test.local");
    await client.login("forgetful", u.email);

    const reset = await admin.put(`/users/${u.id}`, { password: "brand-new-password" });
    expect(reset.body.sessions_revoked).toBe(1);
    expect((await client.request("GET", "/auth/me", { as: "forgetful" })).status).toBe(401);
    expect((await client.login("x", u.email, PASSWORD)).status).toBe(401);
    expect((await client.login("x", u.email, "brand-new-password")).status).toBe(200);
  });

  it("rejects a short new password, an unknown role, an empty change and unknown users", async () => {
    const u = await fresh("rules@test.local");
    expect((await admin.put(`/users/${u.id}`, { password: "short" })).status).toBe(400);
    expect((await admin.put(`/users/${u.id}`, { role: "owner" })).status).toBe(400);
    expect((await admin.put(`/users/${u.id}`, {})).status).toBe(400);
    expect((await admin.put("/users/99999", { full_name: "x" })).status).toBe(404);
  });
});

describe("safety rules", () => {
  it("an Admin can't deactivate their own account", async () => {
    // Needs a second active admin so the "last admin" rule isn't what blocks it.
    await admin.post("/users", { email: "admin2@test.local", password: PASSWORD, role: "admin" });
    const response = await admin.put(`/users/${users.admin.id}`, { is_active: false });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/your own account/);
  });

  it("the last active Admin can't be demoted or deactivated", async () => {
    const others = (await admin.get("/users")).body.filter((u) => u.role === "admin" && u.id !== users.admin.id);
    for (const other of others) {
      await admin.put(`/users/${other.id}`, { role: "manager" }); // leave users.admin as the only Admin
    }
    const demote = await admin.put(`/users/${users.admin.id}`, { role: "manager" });
    expect(demote.status).toBe(400);
    expect(demote.body.error).toMatch(/At least one active Admin/);
    expect((await client.request("GET", "/auth/me", { as: "admin" })).body.role).toBe("admin");
  });

  it("with two Admins, one can be demoted", async () => {
    const second = (await admin.post("/users", { email: "admin3@test.local", password: PASSWORD, role: "admin" })).body;
    expect((await admin.put(`/users/${second.id}`, { role: "user" })).status).toBe(200);
  });
});
