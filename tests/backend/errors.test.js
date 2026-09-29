// Every API failure is JSON (user's request, 2026-09-29): unknown addresses, malformed or oversized
// bodies and unexpected errors never return Express's HTML page, a stack trace or file paths.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SERVER_ERROR } from "../../server/index.js";
import { createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;

beforeAll(async () => {
  srv = await startServer();
  client = await loginAll(makeClient(srv.baseUrl), { admin: createTestUsers().admin });
});
afterAll(() => srv.close());

const raw = (route, init = {}) => fetch(`${srv.baseUrl}${route}`, {
  ...init,
  headers: { "Content-Type": "application/json", Cookie: client.jar.admin, ...(init.headers || {}) },
});
const expectJson = async (res, status, error) => {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error });
  expect(text).not.toMatch(/<html|<pre|node_modules|at .+\(/i);
};

describe("API errors are JSON", () => {
  it("an unknown API address: 404 { error: 'Not found' } (signed in; signed out it's still 401 first)", async () => {
    await expectJson(await raw("/no-such-route"), 404, "Not found");
    await expectJson(await raw("/transactions/filter/extra", { method: "POST", body: "{}" }), 404, "Not found");
    const signedOut = await fetch(`${srv.baseUrl}/no-such-route`);
    expect(signedOut.status).toBe(401);
  });

  it("a malformed JSON body: 400 { error: 'Invalid JSON' }, no stack trace", async () => {
    await expectJson(await raw("/auth/login", { method: "POST", body: "{bad" }), 400, "Invalid JSON");
  });

  it("a body over the size limit: 413", async () => {
    const huge = JSON.stringify({ text: "x".repeat(26 * 1024 * 1024) });
    await expectJson(await raw("/csv/extract", { method: "POST", body: huge }), 413, "The request is too large");
  });

  it("an unexpected error in a route: 500 with a generic message; the details go to the server's log only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // An object as a filter value can't be bound to SQL: the route throws.
      await expectJson(await raw("/transactions/filter", { method: "POST", body: JSON.stringify({ filter: { type: { a: 1 } } }) }), 500, SERVER_ERROR);
      expect(log).toHaveBeenCalled();
      expect(String(log.mock.calls[0][0])).toMatch(/POST \/local-api\/transactions\/filter failed/);
    } finally {
      log.mockRestore();
    }
  });
});
