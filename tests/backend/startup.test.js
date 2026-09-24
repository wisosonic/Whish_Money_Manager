// Automatic seeding on server start: when there are no user accounts, the server creates the
// default roles and an Admin; once any account exists it never seeds again.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { db, initializeDb } from "../../server/db.js";
import { ensureInitialAdmin } from "../../server/seed.js";

describe("ensureInitialAdmin", () => {
  it("seeds when there are no users, using the SEED_ADMIN_* settings", () => {
    initializeDb(); // this file doesn't load the server, which normally creates the tables
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
    const result = ensureInitialAdmin({ SEED_ADMIN_EMAIL: "Boss@Shop.test", SEED_ADMIN_PASSWORD: "boss-password-1", SEED_ADMIN_NAME: "Boss" });
    expect(result.admin).toEqual({ email: "boss@shop.test", created: true });
    expect(result.generatedPassword).toBeNull(); // a password was provided
    expect(result.roles).toEqual(["admin", "manager", "user"]);
    expect(db.prepare("SELECT full_name FROM users").get().full_name).toBe("Boss");
  });

  it("does nothing once any account exists", () => {
    expect(ensureInitialAdmin({ SEED_ADMIN_EMAIL: "someone-else@shop.test" })).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(1);
  });
});

// Runs the real `node server/index.js` against a temporary database file.
describe("server start-up", () => {
  const root = path.resolve(__dirname, "../..");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wmm-startup-"));
  const dbFile = path.join(tmpDir, "startup.db");
  const port = 40000 + Math.floor(Math.random() * 20000);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const startServer = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["server/index.js"], {
        cwd: root,
        env: { ...process.env, HAWALAFLOW_DB_PATH: dbFile, API_PORT: String(port), JWT_SECRET: "startup-test-secret", BCRYPT_ROUNDS: "4", SEED_ADMIN_EMAIL: "", SEED_ADMIN_PASSWORD: "", SEED_ADMIN_NAME: "" },
      });
      let output = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`server did not start:\n${output}`));
      }, 15000);
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes("Listening on")) {
          clearTimeout(timer);
          resolve({ output, stop: () => new Promise((done) => { child.once("exit", done); child.kill(); }) });
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
    });

  const login = (email, password) =>
    fetch(`http://127.0.0.1:${port}/local-api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

  it("first start on an empty database creates the Admin and prints a one-time password that works", async () => {
    const server = await startServer();
    try {
      expect(server.output).toMatch(/No user accounts found/);
      expect(server.output).toMatch(/Email: {4}admin@whish\.local/);
      const password = server.output.match(/Password: (\S+)/)[1];
      expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);

      const response = await login("admin@whish.local", password);
      expect(response.status).toBe(200);
      expect((await response.json()).role).toBe("admin");
    } finally {
      await server.stop();
    }
  }, 30000);

  it("later starts don't seed again (and don't print any password)", async () => {
    const server = await startServer();
    try {
      expect(server.output).not.toMatch(/No user accounts found/);
      expect(server.output).not.toMatch(/Password:/);
    } finally {
      await server.stop();
    }
  }, 30000);
});
