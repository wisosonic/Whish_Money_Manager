// Own profile: PUT /auth/profile (name, email) and PUT /auth/password, for every role.
// Each test uses its own fresh account, so changes never leak between tests.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetLoginRateLimit } from "../../server/auth.js";
import { db } from "../../server/db.js";
import { PASSWORD, createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;

beforeAll(async () => {
  srv = await startServer();
  client = await loginAll(makeClient(srv.baseUrl), createTestUsers());
});
afterAll(() => srv.close());
beforeEach(() => resetLoginRateLimit());

let counter = 0;
// A new account, signed in under `name`; returns helpers bound to it.
const fresh = async (role = "user") => {
  counter += 1;
  const name = `p${counter}`;
  const email = `profile${counter}@test.local`;
  createUser({ email, full_name: `Person ${counter}`, password: PASSWORD, role });
  await client.login(name, email);
  return {
    name,
    email,
    put: (route, body) => client.request("PUT", route, { as: name, body }),
    post: (route, body) => client.request("POST", route, { as: name, body }),
    get: (route) => client.request("GET", route, { as: name }),
  };
};
const storedUser = (id) => db.prepare("SELECT email, full_name, password_hash FROM users WHERE id = ?").get(id);

describe("PUT /auth/profile — name", () => {
  it("any role changes their own name (trimmed); /auth/me shows it", async () => {
    for (const role of ["user", "manager", "admin"]) {
      const me = await fresh(role);
      const { status, body } = await me.put("/auth/profile", { full_name: "  New Name  " });
      expect(status).toBe(200);
      expect(body.full_name).toBe("New Name");
      expect(body).not.toHaveProperty("password_hash");
      expect((await me.get("/auth/me")).body.full_name).toBe("New Name");
    }
  });

  it("needs no password; an empty name is allowed (the header falls back to the email)", async () => {
    const me = await fresh();
    expect((await me.put("/auth/profile", { full_name: "" })).body.full_name).toBe("");
  });

  it("refuses a name over 100 characters, and a request with nothing to change", async () => {
    const me = await fresh();
    const long = await me.put("/auth/profile", { full_name: "x".repeat(101) });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe("The name must be 100 characters or fewer");
    const same = await me.put("/auth/profile", { email: me.email });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("No changes to apply");
    expect((await me.get("/auth/me")).body.full_name).toMatch(/^Person /);
  });

  it("requires a session, and only ever changes the caller (no id in the route)", async () => {
    expect((await client.request("PUT", "/auth/profile", { body: { full_name: "x" } })).status).toBe(401);
    const me = await fresh();
    const other = await fresh();
    await me.put("/auth/profile", { full_name: "Mine", id: 1, email: undefined });
    expect((await other.get("/auth/me")).body.full_name).toMatch(/^Person /);
    expect(storedUser(1).full_name).toBe("Test Admin");
  });
});

describe("PUT /auth/profile — email", () => {
  it("needs the current password, and a wrong one changes nothing", async () => {
    const me = await fresh();
    const none = await me.put("/auth/profile", { email: "new@test.local" });
    expect(none.status).toBe(400);
    expect(none.body.error).toBe("Enter your current password to change your email");
    const wrong = await me.put("/auth/profile", { email: "new@test.local", current_password: "nope-nope" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("Current password is incorrect");
    expect((await me.get("/auth/me")).body.email).toBe(me.email);
  });

  it("validates and normalises the address; an address in use is refused (409)", async () => {
    const me = await fresh();
    expect((await me.put("/auth/profile", { email: "not-an-email", current_password: PASSWORD })).status).toBe(400);
    const taken = await me.put("/auth/profile", { email: "admin@test.local", current_password: PASSWORD });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("A user with this email already exists");
    const ok = await me.put("/auth/profile", { email: "  Mixed.Case@Test.Local ", current_password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe("mixed.case@test.local");
  });

  it("the new email signs in, the old one doesn't; the current session keeps working", async () => {
    const me = await fresh();
    await me.put("/auth/profile", { email: "renamed@test.local", current_password: PASSWORD });
    expect((await me.get("/auth/me")).status).toBe(200);
    expect((await client.login("old", me.email)).status).toBe(401);
    expect((await client.login("renamed", "renamed@test.local")).status).toBe(200);
  });

  it("the user keeps their own transactions (entered by moves to the new email) and can still edit them", async () => {
    const me = await fresh("user");
    const created = await me.post("/transactions/create", { type: "cash_in", amount: 10, transaction_date: "2026-08-01" });
    expect(created.status).toBe(201);
    const moved = await me.put("/auth/profile", { email: "moved@test.local", current_password: PASSWORD });
    expect(moved.status).toBe(200);
    const row = db.prepare("SELECT created_by FROM transactions WHERE id = ?").get(created.body.id);
    expect(row.created_by).toBe("moved@test.local");
    expect((await me.put(`/transactions/${created.body.id}`, { note: "still mine" })).status).toBe(200);
  });

  it("who closed a day and who set a rate follow the email change too", async () => {
    const me = await fresh("manager");
    expect((await me.post("/closed-days", { date: "2026-07-15" })).status).toBe(201);
    expect((await me.put("/commission-rates", { rate: 1.5, effective_from: "2099-03-01" })).status).toBe(200);
    await me.put("/auth/profile", { email: "boss@test.local", current_password: PASSWORD });
    const closed = (await me.get("/closed-days")).body.find((d) => d.date === "2026-07-15");
    expect(closed.closed_by).toBe("boss@test.local");
    const rate = (await me.get("/commission-rates")).body.history.find((r) => r.effective_from === "2099-03-01");
    expect(rate.created_by).toBe("boss@test.local");
  });

  it("refuses an address that still owns rows (e.g. the pre-accounts owner), so nobody takes over those rows", async () => {
    db.prepare("INSERT INTO transactions (type, amount, created_by, created_date, updated_date) VALUES ('cash_in', 1, 'orphan@test.local', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    const me = await fresh();
    const response = await me.put("/auth/profile", { email: "orphan@test.local", current_password: PASSWORD });
    expect(response.status).toBe(409);
    expect((await me.get("/auth/me")).body.email).toBe(me.email);
  });
});

describe("PUT /auth/password", () => {
  it("validates before checking anything: both fields, then the length", async () => {
    const me = await fresh();
    expect((await me.put("/auth/password", { new_password: "long-enough-1" })).body.error).toBe("Current and new passwords are required");
    expect((await me.put("/auth/password", { current_password: PASSWORD, new_password: "short" })).body.error)
      .toBe("Password must be at least 8 characters");
  });

  it("a wrong current password, or the same password again, is refused and nothing changes", async () => {
    const me = await fresh();
    const hashBefore = db.prepare("SELECT password_hash FROM users WHERE email = ?").get(me.email).password_hash;
    const wrong = await me.put("/auth/password", { current_password: "wrong-password", new_password: "brand-new-pass" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("Current password is incorrect");
    const same = await me.put("/auth/password", { current_password: PASSWORD, new_password: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("The new password must be different from the current one");
    expect(db.prepare("SELECT password_hash FROM users WHERE email = ?").get(me.email).password_hash).toBe(hashBefore);
  });

  it("changes it: signs out the other devices, keeps this one; only the new password signs in", async () => {
    const me = await fresh();
    await client.login(`${me.name}-phone`, me.email); // a second device
    const { status, body } = await me.put("/auth/password", { current_password: PASSWORD, new_password: "brand-new-pass" });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, sessions_revoked: 1 });
    expect((await me.get("/auth/me")).status).toBe(200);
    expect((await client.request("GET", "/auth/me", { as: `${me.name}-phone` })).status).toBe(401);
    expect((await client.login("again", me.email, PASSWORD)).status).toBe(401);
    expect((await client.login("again", me.email, "brand-new-pass")).status).toBe(200);
  });

  it("stores a bcrypt hash, never the password", async () => {
    const me = await fresh();
    await me.put("/auth/password", { current_password: PASSWORD, new_password: "brand-new-pass" });
    const { password_hash } = db.prepare("SELECT password_hash FROM users WHERE email = ?").get(me.email);
    expect(password_hash).toMatch(/^\$2[aby]\$/);
    expect(password_hash).not.toContain("brand-new-pass");
  });

  it("wrong current passwords are rate limited (10 per 15 minutes), even for an open session", async () => {
    const me = await fresh();
    for (let i = 0; i < 10; i += 1) {
      expect((await me.put("/auth/password", { current_password: `guess-${i}-xx`, new_password: "brand-new-pass" })).status).toBe(400);
    }
    const locked = await me.put("/auth/password", { current_password: PASSWORD, new_password: "brand-new-pass" });
    expect(locked.status).toBe(429);
    // The email change shares the same counter.
    expect((await me.put("/auth/profile", { email: "x@test.local", current_password: PASSWORD })).status).toBe(429);
    expect((await client.login("check", me.email, PASSWORD)).status).toBe(200); // password unchanged
  });
});
