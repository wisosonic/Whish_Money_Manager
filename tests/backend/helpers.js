// Shared helpers for API tests: a server on a random port (in-memory database, see vitest.config.js),
// test accounts for each role, and a small client that keeps one session cookie per account.
import { app } from "../../server/index.js";
import { createUser } from "../../server/auth.js";
import { db } from "../../server/db.js";

export const PASSWORD = "correct-horse-battery";

export const startServer = async () => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/local-api`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

// The store every database starts with (created by initializeDb).
export const firstStoreId = () => db.prepare("SELECT id FROM stores ORDER BY id LIMIT 1").get().id;

// Puts a user in a store: as its Manager (role manager) or as a member (role user).
export const assignToStore = (user, storeId) => {
  if (user.role === "manager") {
    db.prepare("UPDATE stores SET manager_id = NULL WHERE manager_id = ?").run(user.id);
    db.prepare("UPDATE stores SET manager_id = ? WHERE id = ?").run(user.id, storeId);
  }
  db.prepare("UPDATE users SET store_id = ? WHERE id = ?").run(storeId, user.id);
  return { ...user, store_id: storeId };
};

// One account per role (plus a second User to test "own entries only"). The Manager manages the
// first store and both Users belong to it, so the office works as it did before stores.
export const createTestUsers = () => {
  const storeId = firstStoreId();
  return {
    admin: createUser({ email: "admin@test.local", full_name: "Test Admin", password: PASSWORD, role: "admin" }),
    manager: assignToStore(createUser({ email: "manager@test.local", full_name: "Test Manager", password: PASSWORD, role: "manager" }), storeId),
    user: assignToStore(createUser({ email: "user@test.local", full_name: "Test User", password: PASSWORD, role: "user" }), storeId),
    user2: assignToStore(createUser({ email: "user2@test.local", full_name: "Other User", password: PASSWORD, role: "user" }), storeId),
  };
};

export const makeClient = (baseUrl) => {
  const jar = {};

  const request = async (method, route, { body, as, cookie, headers = {}, rawBody } = {}) => {
    const sessionCookie = cookie ?? (as ? jar[as] : undefined);
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        ...headers,
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, body: json, headers: response.headers };
  };

  // Signs in and stores the session cookie under `name` (e.g. "admin").
  const login = async (name, email, password = PASSWORD) => {
    const result = await request("POST", "/auth/login", { body: { email, password } });
    const setCookie = result.headers.get("set-cookie");
    if (result.status === 200 && setCookie) jar[name] = setCookie.split(";")[0];
    return result;
  };

  return { request, login, jar };
};

// Signs in every test account; returns the client.
export const loginAll = async (client, users) => {
  for (const [name, user] of Object.entries(users)) {
    await client.login(name, user.email);
  }
  return client;
};
