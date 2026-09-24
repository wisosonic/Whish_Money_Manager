// Authentication & session security: login, the session cookie, JWT validation, logout/revocation,
// sessions that never expire, sliding cookie renewal, and brute-force protection.
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDb } from "../../server/db.js";
import { SESSION_COOKIE, createUser, resetLoginRateLimit } from "../../server/auth.js";
import { PASSWORD, createTestUsers, makeClient, startServer } from "./helpers.js";

const SECRET = process.env.JWT_SECRET;
let srv;
let client;
let users;

beforeAll(async () => {
  srv = await startServer();
  users = createTestUsers();
  client = makeClient(srv.baseUrl);
});

afterAll(() => srv.close());
beforeEach(() => resetLoginRateLimit());

const tokenFrom = (cookie) => cookie.split("=").slice(1).join("=");
const cookieFor = (token) => `${SESSION_COOKIE}=${token}`;

describe("login", () => {
  it("signs in with email + password and returns the user with role and permissions", async () => {
    const { status, body } = await client.login("admin", users.admin.email);
    expect(status).toBe(200);
    expect(body).toMatchObject({ email: "admin@test.local", role: "admin", role_label: "Admin", is_active: true });
    expect(body.permissions).toContain("users:manage");
    expect(body).not.toHaveProperty("password_hash");
  });

  it("sets a secure session cookie: HttpOnly, SameSite=Strict, whole site, ~400 days", async () => {
    const { headers } = await client.login("admin", users.admin.email);
    const setCookie = headers.get("set-cookie");
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
    const maxAge = Number(setCookie.match(/Max-Age=(\d+)/)[1]);
    expect(maxAge).toBe(400 * 24 * 60 * 60);
  });

  it("issues a JWT with no expiry, carrying only the session id and user id", async () => {
    await client.login("admin", users.admin.email);
    const payload = jwt.verify(tokenFrom(client.jar.admin), SECRET);
    expect(payload).not.toHaveProperty("exp");
    expect(Object.keys(payload).sort()).toEqual(["iat", "sid", "sub"]);
    expect(payload.sub).toBe(String(users.admin.id));
  });

  it("accepts the email in any letter case", async () => {
    expect((await client.login("x", "ADMIN@Test.Local")).status).toBe(200);
  });

  it("rejects a wrong password or unknown email with the same generic message", async () => {
    const wrong = await client.login("x", users.admin.email, "wrong-password");
    const unknown = await client.login("x", "nobody@test.local");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe("Invalid email or password");
    expect(unknown.body.error).toBe(wrong.body.error);
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("requires both fields", async () => {
    expect((await client.request("POST", "/auth/login", { body: { email: users.admin.email } })).status).toBe(400);
    expect((await client.request("POST", "/auth/login", { body: {} })).status).toBe(400);
  });

  it("no longer accepts the old built-in admin / admin login", async () => {
    expect((await client.login("x", "admin", "admin")).status).toBe(401);
  });

  it("locks out an email+IP after 10 failed attempts, even with the right password", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await client.login("x", users.user.email, "nope")).status).toBe(401);
    }
    const locked = await client.login("x", users.user.email, PASSWORD);
    expect(locked.status).toBe(429);
    // Other accounts are not affected.
    expect((await client.login("x", users.manager.email)).status).toBe(200);
  });
});

describe("protected API", () => {
  const protectedRoutes = [
    ["GET", "/auth/me"],
    ["POST", "/transactions/filter", { filter: {} }],
    ["POST", "/transactions/create", { type: "cash_in", amount: 1 }],
    ["POST", "/transactions/import", { records: [] }],
    ["POST", "/transactions/find-duplicates", { references: ["tr:1"] }],
    ["POST", "/transactions/bulk-update", { ids: [1], changes: { note: "x" } }],
    ["POST", "/transactions/bulk-delete", { ids: [1] }],
    ["PUT", "/transactions/1", { amount: 1 }],
    ["DELETE", "/transactions/1"],
    ["POST", "/daily-balances/filter", { filter: {} }],
    ["POST", "/daily-balances/create", { date: "2026-01-01", opening_balance: 1 }],
    ["POST", "/csv/extract", { text: "a" }],
    ["POST", "/pdf/extract", { base64: "a" }],
    ["GET", "/users"],
    ["GET", "/roles"],
  ];

  it.each(protectedRoutes)("%s %s requires a session (401)", async (method, route, body) => {
    const response = await client.request(method, route, { body });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  it("ignores the old x-user-email header (identity comes only from the session)", async () => {
    const response = await client.request("POST", "/transactions/filter", {
      body: { filter: {} },
      headers: { "x-user-email": users.admin.email },
    });
    expect(response.status).toBe(401);
  });

  it("keeps the health check public", async () => {
    const response = await client.request("GET", "/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("/auth/me returns the signed-in user", async () => {
    await client.login("manager", users.manager.email);
    const { status, body } = await client.request("GET", "/auth/me", { as: "manager" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ email: "manager@test.local", role: "manager" });
  });
});

describe("token validation", () => {
  let validToken;
  beforeAll(async () => {
    await client.login("tv", users.user.email);
    validToken = tokenFrom(client.jar.tv);
  });

  it("rejects a token whose payload was tampered with (e.g. switching to the admin's id)", async () => {
    const [header, , signature] = validToken.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...jwt.decode(validToken), sub: String(users.admin.id) })).toString("base64url");
    const response = await client.request("GET", "/auth/me", { cookie: cookieFor(`${header}.${forgedPayload}.${signature}`) });
    expect(response.status).toBe(401);
    // A bad cookie is cleared.
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = jwt.sign(jwt.decode(validToken), "some-other-secret");
    expect((await client.request("GET", "/auth/me", { cookie: cookieFor(forged) })).status).toBe(401);
  });

  it("rejects an unsigned token (alg: none)", async () => {
    const unsigned = jwt.sign(jwt.decode(validToken), null, { algorithm: "none" });
    expect((await client.request("GET", "/auth/me", { cookie: cookieFor(unsigned) })).status).toBe(401);
  });

  it("rejects a correctly signed token whose session doesn't exist", async () => {
    const forged = jwt.sign({ sid: "00000000-0000-0000-0000-000000000000", sub: String(users.admin.id) }, SECRET);
    expect((await client.request("GET", "/auth/me", { cookie: cookieFor(forged) })).status).toBe(401);
  });

  it("rejects a real session id paired with another user's id", async () => {
    const forged = jwt.sign({ sid: jwt.decode(validToken).sid, sub: String(users.admin.id) }, SECRET);
    expect((await client.request("GET", "/auth/me", { cookie: cookieFor(forged) })).status).toBe(401);
  });

  it("rejects garbage", async () => {
    expect((await client.request("GET", "/auth/me", { cookie: cookieFor("not-a-jwt") })).status).toBe(401);
  });
});

describe("session lifetime", () => {
  it("never expires: a token issued years ago still works while its session exists", async () => {
    await client.login("old", users.user.email);
    const { sid, sub } = jwt.decode(tokenFrom(client.jar.old));
    const fiveYearsAgo = Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 3600;
    const oldToken = jwt.sign({ sid, sub, iat: fiveYearsAgo }, SECRET);
    const response = await client.request("GET", "/auth/me", { cookie: cookieFor(oldToken) });
    expect(response.status).toBe(200);
    expect(response.body.email).toBe(users.user.email);
  });

  it("renews the browser cookie (at most once a day) so an active user stays signed in", async () => {
    await client.login("slide", users.user.email);
    const { sid } = jwt.decode(tokenFrom(client.jar.slide));

    const fresh = await client.request("GET", "/auth/me", { as: "slide" });
    expect(fresh.headers.get("set-cookie")).toBeNull(); // used today already

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    db.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?").run(twoDaysAgo, sid);
    const renewed = await client.request("GET", "/auth/me", { as: "slide" });
    expect(renewed.headers.get("set-cookie")).toMatch(/Max-Age=34560000/);
    expect(Date.parse(db.prepare("SELECT last_seen FROM sessions WHERE id = ?").get(sid).last_seen)).toBeGreaterThan(Date.parse(twoDaysAgo));
  });
});

describe("logout", () => {
  it("deletes the session so the same token can never be used again, and clears the cookie", async () => {
    await client.login("out", users.manager.email);
    const cookie = client.jar.out;
    expect((await client.request("GET", "/auth/me", { cookie })).status).toBe(200);

    const logout = await client.request("POST", "/auth/logout", { cookie });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));

    expect((await client.request("GET", "/auth/me", { cookie })).status).toBe(401);
    expect((await client.request("POST", "/transactions/filter", { cookie, body: { filter: {} } })).status).toBe(401);
  });

  it("only ends that one session — the same user stays signed in on other devices", async () => {
    await client.login("deviceA", users.manager.email);
    await client.login("deviceB", users.manager.email);
    await client.request("POST", "/auth/logout", { as: "deviceA" });
    expect((await client.request("GET", "/auth/me", { as: "deviceA" })).status).toBe(401);
    expect((await client.request("GET", "/auth/me", { as: "deviceB" })).status).toBe(200);
  });

  it("works without a session (just clears the cookie)", async () => {
    expect((await client.request("POST", "/auth/logout")).status).toBe(200);
  });
});

describe("last login tracking (shown in the header)", () => {
  it("the first sign-in has no previous login", async () => {
    const fresh = createUser({ email: "first-timer@test.local", password: PASSWORD, role: "user" });
    const first = await client.login("ft", fresh.email);
    expect(first.body.previous_login).toBeNull();
    expect(Date.parse(first.body.last_login)).not.toBeNaN();
  });

  it("each sign-in reports the one before it, and /auth/me returns it too", async () => {
    const first = await client.login("ft1", "first-timer@test.local");
    const second = await client.login("ft2", "first-timer@test.local");
    expect(second.body.previous_login).toBe(first.body.last_login);
    expect(second.body.last_login >= first.body.last_login).toBe(true);

    const me = await client.request("GET", "/auth/me", { as: "ft2" });
    expect(me.body.previous_login).toBe(first.body.last_login);
  });

  it("a failed sign-in doesn't change it", async () => {
    const before = db.prepare("SELECT last_login, previous_login FROM users WHERE email = ?").get("first-timer@test.local");
    await client.login("x", "first-timer@test.local", "wrong-password");
    const after = db.prepare("SELECT last_login, previous_login FROM users WHERE email = ?").get("first-timer@test.local");
    expect(after).toEqual(before);
  });

  it("databases created before this column existed get it added on startup, keeping their data", () => {
    db.exec("ALTER TABLE users DROP COLUMN previous_login");
    expect(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name)).not.toContain("previous_login");
    const usersBefore = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

    initializeDb();

    expect(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name)).toContain("previous_login");
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(usersBefore);
  });
});
