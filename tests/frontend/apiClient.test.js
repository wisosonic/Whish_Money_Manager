/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, SESSION_ENDED_EVENT } from "@/api/apiClient";

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let fetchMock;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lastCall = () => {
  const [url, options] = fetchMock.mock.calls.at(-1);
  return { url, options, body: options.body ? JSON.parse(options.body) : undefined };
};

describe("auth (cookie session)", () => {
  it("login posts the credentials and returns the user from the server", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, email: "admin@test.local", role: "admin" }));
    const user = await api.auth.login("admin@test.local", "secret-pass");
    expect(lastCall()).toMatchObject({
      url: "/local-api/auth/login",
      options: { method: "POST", credentials: "same-origin" },
      body: { email: "admin@test.local", password: "secret-pass" },
    });
    expect(user).toMatchObject({ role: "admin" });
  });

  it("me() asks the server who is signed in", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, email: "admin@test.local" }));
    await expect(api.auth.me()).resolves.toMatchObject({ email: "admin@test.local" });
    expect(lastCall()).toMatchObject({ url: "/local-api/auth/me", options: { method: "GET" } });
  });

  it("me() rejects with status 401 when nobody is signed in", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Authentication required" }, { ok: false, status: 401 }));
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401, message: "Authentication required" });
  });

  it("updateProfile and changePassword send the signed-in user's own changes", async () => {
    await api.auth.updateProfile({ email: "new@test.local", current_password: "secret-pass" });
    expect(lastCall()).toMatchObject({
      url: "/local-api/auth/profile",
      options: { method: "PUT" },
      body: { email: "new@test.local", current_password: "secret-pass" },
    });
    await api.auth.changePassword("old-pass-1", "new-pass-1");
    expect(lastCall()).toMatchObject({
      url: "/local-api/auth/password",
      options: { method: "PUT" },
      body: { current_password: "old-pass-1", new_password: "new-pass-1" },
    });
  });

  it("logout tells the server to end the session", async () => {
    await api.auth.logout();
    expect(lastCall()).toMatchObject({ url: "/local-api/auth/logout", options: { method: "POST" } });
  });

  it("never sends an identity header or stores the user in localStorage — the cookie is the only credential", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, email: "admin@test.local" }));
    await api.auth.login("admin@test.local", "secret-pass");
    await api.entities.Transaction.filter({});
    const { options } = lastCall();
    expect(options.credentials).toBe("same-origin");
    expect(Object.keys(options.headers).map((h) => h.toLowerCase())).toEqual(["content-type"]);
    expect(window.localStorage.length).toBe(0);
  });

  it("removes the old saved-login entry left by previous versions", async () => {
    window.localStorage.setItem("hawalaflow_local_user", JSON.stringify({ email: "x@y" }));
    vi.resetModules();
    await import("@/api/apiClient");
    expect(window.localStorage.getItem("hawalaflow_local_user")).toBeNull();
  });
});

describe("session ended", () => {
  it("announces a 401 on a normal API call so the app can show the login screen", async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Authentication required" }, { ok: false, status: 401 }));
    await expect(api.entities.Transaction.filter({})).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_ENDED_EVENT, listener);
  });

  it("doesn't announce it for the auth calls themselves (e.g. a wrong password)", async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid email or password" }, { ok: false, status: 401 }));
    await expect(api.auth.login("a@b.c", "x")).rejects.toThrow("Invalid email or password");
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_ENDED_EVENT, listener);
  });
});

describe("API errors", () => {
  it("throws the server's error message and status when a request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, { ok: false, status: 500 }));
    await expect(api.entities.Transaction.create({})).rejects.toMatchObject({ message: "boom", status: 500 });
  });

  it("falls back to the raw text for non-JSON errors", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, text: async () => "Bad Gateway" });
    await expect(api.entities.Transaction.create({})).rejects.toThrow("Bad Gateway");
  });
});

describe("user management client (Admin)", () => {
  it("lists, creates and updates users, and lists roles", async () => {
    await api.users.list();
    expect(lastCall()).toMatchObject({ url: "/local-api/users", options: { method: "GET" } });
    await api.users.create({ email: "a@b.c", password: "long-pass", role: "user" });
    expect(lastCall()).toMatchObject({ url: "/local-api/users", options: { method: "POST" }, body: { email: "a@b.c", role: "user" } });
    await api.users.update(7, { role: "manager" });
    expect(lastCall()).toMatchObject({ url: "/local-api/users/7", options: { method: "PUT" }, body: { role: "manager" } });
    await api.roles.list();
    expect(lastCall()).toMatchObject({ url: "/local-api/roles", options: { method: "GET" } });
  });
});

describe("entity client", () => {
  it("sends CRUD requests to the entity routes", async () => {
    await api.entities.Transaction.create({ amount: 5 });
    expect(lastCall()).toMatchObject({ url: "/local-api/transactions/create", options: { method: "POST" }, body: { amount: 5 } });

    await api.entities.DailyBalance.update(7, { opening_balance: 10 });
    expect(lastCall()).toMatchObject({ url: "/local-api/daily-balances/7", options: { method: "PUT" } });

    await api.entities.Transaction.delete(3);
    expect(lastCall()).toMatchObject({ url: "/local-api/transactions/3", options: { method: "DELETE" } });
  });

  it("findDuplicates posts the reference numbers", async () => {
    await api.entities.Transaction.findDuplicates(["tr:1", "tr:2"]);
    expect(lastCall()).toMatchObject({ url: "/local-api/transactions/find-duplicates", body: { references: ["tr:1", "tr:2"] } });
  });

  it("bulkUpdate posts the selected ids and the changes", async () => {
    await api.entities.Transaction.bulkUpdate([1, 2], { service: "W2W", commission_rate: 1 });
    expect(lastCall()).toMatchObject({
      url: "/local-api/transactions/bulk-update",
      options: { method: "POST" },
      body: { ids: [1, 2], changes: { service: "W2W", commission_rate: 1 } },
    });
  });

  it("bulkDelete posts the selected ids", async () => {
    await api.entities.Transaction.bulkDelete([4, 5, 6]);
    expect(lastCall()).toMatchObject({ url: "/local-api/transactions/bulk-delete", body: { ids: [4, 5, 6] } });
  });

  it("importRecords posts records with the overwrite flag (default false)", async () => {
    await api.entities.Transaction.importRecords([{ amount: 1 }]);
    expect(lastCall().body).toEqual({ records: [{ amount: 1 }], overwrite: false });

    await api.entities.Transaction.importRecords([{ amount: 1 }], { overwrite: true });
    expect(lastCall()).toMatchObject({ url: "/local-api/transactions/import", body: { overwrite: true } });
  });
});

describe("statement extraction", () => {
  it("ExtractCsv sends the file as text", async () => {
    const file = new File(["line_no,date\n1,2026-09-23"], "s.csv", { type: "text/csv" });
    await api.integrations.Core.ExtractCsv(file);
    expect(lastCall()).toMatchObject({ url: "/local-api/csv/extract", body: { text: "line_no,date\n1,2026-09-23" } });
  });

  it("ExtractPdf sends the file as base64", async () => {
    const file = new File(["%PDF-1.7"], "s.pdf", { type: "application/pdf" });
    await api.integrations.Core.ExtractPdf(file);
    expect(lastCall()).toMatchObject({ url: "/local-api/pdf/extract", body: { base64: btoa("%PDF-1.7") } });
  });
});
