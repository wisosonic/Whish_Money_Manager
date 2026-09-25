// Per-user display preferences (Settings page): defaults, saving partial changes, validation,
// isolation between accounts, and the tolerant reading of stored JSON.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, initializeDb } from "../../server/db.js";
import {
  DEFAULT_PREFERENCES,
  TABLE_COLUMNS,
  applyPreferenceChanges,
  resolvePreferences,
} from "../../server/preferences.js";
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

// Every setting's default, as the API returns it (the app as it behaved before settings existed).
const DEFAULTS = {
  language: null,
  hiddenColumns: [],
  density: "comfortable",
  summaries: { month: true, year: false },
  theme: "light",
  startOn: "last",
  searchScope: "all",
  defaultSort: { key: null, dir: "asc" },
  clock: "12h",
  numerals: "western",
  toastDuration: "normal",
  toastSuccess: true,
  rowsPerPage: 0,
};

const save = (as, body) => client.request("PUT", "/auth/preferences", { as, body });
const stored = (email) => db.prepare("SELECT preferences FROM users WHERE email = ?").get(email).preferences;

describe("preferences API", () => {
  it("a new account gets the defaults (every column, comfortable, month open / year closed, no saved language)", async () => {
    const { status, body } = await client.request("GET", "/auth/me", { as: "manager" });
    expect(status).toBe(200);
    expect(body.preferences).toEqual(DEFAULTS);
  });

  it("any role can save their own preferences; a partial change is merged over what's stored", async () => {
    let res = await save("user", { hiddenColumns: ["note", "service"], density: "compact" });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("user@test.local");
    expect(res.body.preferences).toEqual({ ...DEFAULTS, hiddenColumns: ["note", "service"], density: "compact" });

    res = await save("user", { summaries: { year: true }, language: "en" });
    expect(res.status).toBe(200);
    expect(res.body.preferences).toMatchObject({
      language: "en",
      hiddenColumns: ["note", "service"],
      density: "compact",
      summaries: { month: true, year: true },
    });

    // Persisted, and returned by /auth/me and at the next login.
    expect(JSON.parse(stored("user@test.local")).density).toBe("compact");
    expect((await client.request("GET", "/auth/me", { as: "user" })).body.preferences.language).toBe("en");
    const again = await client.login("user-again", users.user.email);
    expect(again.body.preferences.hiddenColumns).toEqual(["note", "service"]);
  });

  it("preferences are per account: one user's settings never change another's", async () => {
    await save("user2", { density: "compact", hiddenColumns: ["amount"] });
    const admin = await client.request("GET", "/auth/me", { as: "admin" });
    expect(admin.body.preferences).toEqual(resolvePreferences(null));
    expect(stored("admin@test.local")).toBeNull();
  });

  it.each(["dark", "system", "light"])("saves the theme %s", async (theme) => {
    const res = await save("manager", { theme });
    expect(res.status).toBe(200);
    expect(res.body.preferences.theme).toBe(theme);
  });

  it.each([
    ["startOn", "today"],
    ["searchScope", "day"],
    ["defaultSort", { key: "amount", dir: "desc" }],
    ["clock", "24h"],
    ["clock", "hidden"],
    ["numerals", "arabic"],
    ["toastDuration", "long"],
    ["toastSuccess", false],
    ["rowsPerPage", 50],
    ["rowsPerPage", 0],
  ])("saves %s = %j", async (key, value) => {
    const res = await save("manager", { [key]: value });
    expect(res.status).toBe(200);
    expect(res.body.preferences[key]).toEqual(value);
  });

  it("a partial default sort keeps the other half; key null means journal order", async () => {
    await save("manager", { defaultSort: { key: "date", dir: "desc" } });
    let res = await save("manager", { defaultSort: { dir: "asc" } });
    expect(res.body.preferences.defaultSort).toEqual({ key: "date", dir: "asc" });
    res = await save("manager", { defaultSort: { key: null } });
    expect(res.body.preferences.defaultSort).toEqual({ key: null, dir: "asc" });
  });

  it.each([
    ["startOn", "yesterday"],
    ["searchScope", "week"],
    ["defaultSort", { key: "password", dir: "asc" }],
    ["defaultSort", { key: "amount", dir: "sideways" }],
    ["defaultSort", { key: "amount", extra: 1 }],
    ["clock", "36h"],
    ["numerals", "roman"],
    ["toastDuration", "forever"],
    ["toastSuccess", "no"],
    ["rowsPerPage", 33],
    ["rowsPerPage", "50"],
  ])("rejects %s = %j", async (key, value) => {
    const res = await save("user2", { [key]: value });
    expect(res.status).toBe(400);
  });

  it("can clear the saved language back to null", async () => {
    await save("manager", { language: "ar" });
    const res = await save("manager", { language: null });
    expect(res.body.preferences.language).toBeNull();
  });

  it.each([
    ["unknown setting", { fontSize: 20 }, "Invalid preferences"],
    ["bad theme", { theme: "blue" }, "Invalid preferences"],
    ["unknown column", { hiddenColumns: ["password_hash"] }, "Invalid preferences"],
    ["columns not a list", { hiddenColumns: "note" }, "Invalid preferences"],
    ["every column hidden", { hiddenColumns: TABLE_COLUMNS }, "At least one column must stay visible"],
    ["bad density", { density: "tiny" }, "Invalid preferences"],
    ["bad language", { language: "fr" }, "Invalid preferences"],
    ["non-boolean summary", { summaries: { month: "yes" } }, "Invalid preferences"],
    ["unknown summary", { summaries: { week: true } }, "Invalid preferences"],
    ["not an object", ["compact"], "Invalid preferences"],
  ])("rejects %s with 400 and changes nothing", async (_label, body, error) => {
    const before = stored("user2@test.local");
    const res = await save("user2", body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
    expect(stored("user2@test.local")).toBe(before);
  });

  it("requires a session, and JSON", async () => {
    expect((await client.request("PUT", "/auth/preferences", { body: { density: "compact" } })).status).toBe(401);
    const form = await client.request("PUT", "/auth/preferences", {
      as: "user2", rawBody: "density=compact", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(415);
  });
});

describe("preferences rules (shared with the UI)", () => {
  it("resolvePreferences reads stored JSON tolerantly, falling back to defaults for anything invalid", () => {
    expect(resolvePreferences(null)).toEqual(DEFAULTS);
    expect(Object.keys(DEFAULT_PREFERENCES).sort()).toEqual(Object.keys(DEFAULTS).sort());
    expect(resolvePreferences("not json")).toEqual(resolvePreferences(null));
    expect(resolvePreferences(JSON.stringify({
      language: "fr", hiddenColumns: ["note", "note", "bogus"], density: "tiny", summaries: { month: false, year: "x" }, theme: "neon",
    }))).toEqual({ ...DEFAULTS, hiddenColumns: ["note"], summaries: { month: false, year: false } });
    // A stored "hide everything" can never blank the table.
    expect(resolvePreferences({ hiddenColumns: TABLE_COLUMNS }).hiddenColumns).toEqual([]);
  });

  it("applyPreferenceChanges merges without touching the stored object", () => {
    const current = resolvePreferences({ density: "compact" });
    const { preferences } = applyPreferenceChanges(current, { summaries: { month: false } });
    expect(preferences).toMatchObject({ density: "compact", summaries: { month: false, year: false } });
    expect(current.summaries.month).toBe(true);
  });

  it("every table column the UI can hide is a sortable column", async () => {
    const { SORT_VALUES } = await import("../../src/lib/transactionSort.js");
    expect(Object.keys(SORT_VALUES)).toEqual(TABLE_COLUMNS);
  });
});

describe("database upgrade", () => {
  it("databases created before settings existed get the column on startup, keeping their users", () => {
    db.exec("ALTER TABLE users DROP COLUMN preferences");
    expect(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name)).not.toContain("preferences");
    const usersBefore = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

    initializeDb();

    expect(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name)).toContain("preferences");
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(usersBefore);
    expect(stored("admin@test.local")).toBeNull();
  });
});
