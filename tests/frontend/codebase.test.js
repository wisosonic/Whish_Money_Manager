// Guards for removed code: the unused modals stay deleted, and the API client keeps its new name.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const filesUnder = (dir, pattern) => {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (pattern.test(entry.name)) out.push(full);
  });
  walk(path.join(root, dir));
  return out;
};
const sources = [...filesUnder("src", /\.jsx?$/), ...filesUnder("tests", /\.jsx?$/), ...filesUnder("server", /\.js$/)];

describe("removed and renamed code", () => {
  it.each(["ReviewPDFModal", "InsertTransactionModal"])("%s is deleted and nothing refers to it", (name) => {
    expect(fs.existsSync(path.join(root, "src/components/transactions", `${name}.jsx`))).toBe(false);
    const users = sources.filter((f) => f !== __filename && fs.readFileSync(f, "utf8").includes(name));
    expect(users).toEqual([]);
  });

  it("the API client is src/api/apiClient.js, exported as `api`", async () => {
    expect(fs.existsSync(path.join(root, "src/api/base44Client.js"))).toBe(false);
    const client = await import("@/api/apiClient");
    expect(Object.keys(client.api)).toEqual(expect.arrayContaining(["auth", "entities", "integrations", "users", "roles", "admin"]));
  });

  it("no code uses the old base44 names any more", () => {
    // "base44.com" is allowed (also written base44\.com inside a regex): a branding test checks the
    // old Base44 logo URL is gone.
    const leftovers = sources
      .filter((f) => f !== __filename)
      .filter((f) => /\bbase44(?:Client)?\b(?!\\?\.com)/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(leftovers).toEqual([]);
  });
});
