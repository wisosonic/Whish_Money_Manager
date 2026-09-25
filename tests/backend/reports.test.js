// Admin panel → Reports API: income by month and top senders / recipients — who may see them,
// validation, and the grouping / ranking rules (server/reports.js, server/parties.js).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../server/db.js";
import { normalizePhone, receiverDisplay, senderDisplay } from "../../server/parties.js";
import { rankParties } from "../../server/reports.js";
import { buildMonthlyChartData } from "@/lib/monthlyChartData";
import { createTestUsers, loginAll, makeClient, startServer } from "./helpers.js";

let srv;
let client;

beforeAll(async () => {
  srv = await startServer();
  client = await loginAll(makeClient(srv.baseUrl), createTestUsers());
});
afterAll(() => srv.close());
beforeEach(() => db.prepare("DELETE FROM transactions").run());

const OFFICE = "Office Account"; // the importers' own account: sender of every debit, receiver of every credit
const insert = (rows) => {
  const statement = db.prepare(
    `INSERT INTO transactions (type, amount, commission, sender_name, receiver_name, phone, customer_number, transaction_date, created_by, created_date, updated_date)
     VALUES (@type, @amount, @commission, @sender_name, @receiver_name, @phone, @customer_number, @transaction_date, 'admin@test.local', @created_date, @created_date)`
  );
  rows.forEach((row) => statement.run({
    commission: 0, sender_name: "", receiver_name: "", phone: "", customer_number: "", transaction_date: "", created_date: "2026-01-01T00:00:00.000Z", ...row,
  }));
};
// A deposit from someone (sender) to the office, and a payout from the office to someone (receiver).
const cashIn = (sender, amount, date, extra = {}) => ({ type: "cash_in", amount, commission: amount / 100, sender_name: sender, receiver_name: OFFICE, transaction_date: date, ...extra });
const cashOut = (receiver, amount, date, extra = {}) => ({ type: "cash_out", amount, sender_name: OFFICE, receiver_name: receiver, transaction_date: date, ...extra });
const get = (route, as = "admin") => client.request("GET", route, { as });
const parties = (query, as) => get(`/admin/reports/parties?${new URLSearchParams(query)}`, as);
const YEAR = { from: "2026-01-01", to: "2026-12-31" };

describe("who can see reports", () => {
  it("Admins and Managers (data:export); Users get 403, no session 401", async () => {
    for (const as of ["admin", "manager"]) {
      expect((await get("/admin/reports/income?year=2026", as)).status).toBe(200);
      expect((await parties({ party: "sender", ...YEAR }, as)).status).toBe(200);
    }
    expect((await get("/admin/reports/income?year=2026", "user")).status).toBe(403);
    expect((await parties({ party: "receiver", ...YEAR }, "user")).status).toBe(403);
    expect((await client.request("GET", "/admin/reports/income?year=2026")).status).toBe(401);
  });
});

describe("GET /admin/reports/income", () => {
  it("refuses a missing or malformed year", async () => {
    for (const year of ["", "26", "2026-01", "abcd"]) {
      const response = await get(`/admin/reports/income?year=${year}`);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("A valid year is required (YYYY)");
    }
  });

  it("sums commissions, cash in and cash out per month of the year, by the transaction's day", async () => {
    insert([
      cashIn("Rami", 1000, "2026-01-15"),
      cashIn("Rami", 500, "2026-01-20"),
      cashOut("Nour", 300, "2026-01-21"),
      cashOut("Nour", 200, "", { created_date: "2026-03-02T10:00:00.000Z" }), // no transaction_date: created_date's day
      cashIn("Old", 999, "2025-12-31"),
    ]);
    const { status, body } = await get("/admin/reports/income?year=2026");
    expect(status).toBe(200);
    expect(body.year).toBe("2026");
    expect(body.years).toEqual(["2026", "2025"]);
    expect(body.months).toHaveLength(12);
    expect(body.months[0]).toEqual({ month: 1, count: 3, profit: 15, cashIn: 1500, cashOut: 300 });
    expect(body.months[1]).toEqual({ month: 2, count: 0, profit: 0, cashIn: 0, cashOut: 0 });
    expect(body.months[2]).toMatchObject({ month: 3, count: 1, cashOut: 200 });
  });

  it("gives the same figures as the dashboard chart for the same transactions", async () => {
    const rows = [cashIn("A", 120.5, "2026-04-01"), cashIn("B", 80.25, "2026-04-30"), cashOut("C", 55.55, "2026-05-05"), cashIn("D", 10, "2026-12-01")];
    insert(rows);
    const { body } = await get("/admin/reports/income?year=2026");
    const dashboard = buildMonthlyChartData(rows.map((r) => ({ ...r, created_date: "2026-01-01T00:00:00.000Z" })), "2026", new Date("2027-01-01"));
    body.months.forEach((month, i) => {
      expect(month.count).toBe(dashboard[i].count);
      expect(Math.round(month.profit * 100) / 100).toBe(dashboard[i].profit);
      expect(month.cashIn).toBeCloseTo(dashboard[i].cashIn, 2);
      expect(month.cashOut).toBeCloseTo(dashboard[i].cashOut, 2);
    });
  });
});

describe("GET /admin/reports/parties — validation", () => {
  it("needs a known party, a valid range and valid options", async () => {
    expect((await parties({ party: "office", ...YEAR })).body.error).toBe("Unknown report");
    expect((await parties({ party: "sender", from: "2026-02-01", to: "2026-01-01" })).body.error).toBe("The start date must be on or before the end date");
    expect((await parties({ party: "sender", from: "bad", to: "2026-01-01" })).status).toBe(400);
    for (const option of [{ by: "name" }, { limit: "0" }, { limit: "501" }, { limit: "2.5" }]) {
      const response = await parties({ party: "sender", ...YEAR, ...option });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Unknown report option");
    }
  });
});

describe("GET /admin/reports/parties — senders and recipients", () => {
  it("senders come from Cash In and recipients from Cash Out, so the office's own account is on neither", async () => {
    insert([cashIn("Rami", 100, "2026-02-01"), cashIn("Rami", 50, "2026-02-02"), cashOut("Nour", 70, "2026-02-03")]);
    const senders = (await parties({ party: "sender", ...YEAR })).body;
    expect(senders.rows.map((r) => r.label)).toEqual(["Rami"]);
    expect(senders.rows[0]).toMatchObject({ rank: 1, count: 2, volume: 150, average: 75, commission: 1.5, share: 1, first_date: "2026-02-01", last_date: "2026-02-02" });
    const recipients = (await parties({ party: "receiver", ...YEAR })).body;
    expect(recipients.rows.map((r) => r.label)).toEqual(["Nour"]);
    expect(JSON.stringify([senders, recipients])).not.toContain(OFFICE);
  });

  it("only the chosen dates count (both included; created_date's day when there's no transaction date)", async () => {
    insert([
      cashIn("Early", 10, "2026-02-28"),
      cashIn("First", 20, "2026-03-01"),
      cashIn("Last", 30, "2026-03-31"),
      cashIn("NoDate", 40, "", { created_date: "2026-03-15T22:00:00.000Z" }),
      cashIn("Late", 50, "2026-04-01"),
    ]);
    const { body } = await parties({ party: "sender", from: "2026-03-01", to: "2026-03-31" });
    expect(body.rows.map((r) => r.label).sort()).toEqual(["First", "Last", "NoDate"]);
    expect(body.totals).toMatchObject({ rows: 3, volume: 90, parties: 3 });
    expect(body).toMatchObject({ from: "2026-03-01", to: "2026-03-31", party: "sender", by: "volume" });
  });

  it("ranks by total amount by default, or by number of transactions; limit caps the list", async () => {
    insert([
      cashIn("Big", 1000, "2026-05-01"),
      cashIn("Often", 10, "2026-05-01"), cashIn("Often", 10, "2026-05-02"), cashIn("Often", 10, "2026-05-03"),
      cashIn("Middle", 500, "2026-05-04"), cashIn("Middle", 1, "2026-05-05"),
    ]);
    const byVolume = (await parties({ party: "sender", ...YEAR })).body;
    expect(byVolume.rows.map((r) => r.label)).toEqual(["Big", "Middle", "Often"]);
    expect(byVolume.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    const byCount = (await parties({ party: "sender", ...YEAR, by: "count" })).body;
    expect(byCount.rows.map((r) => r.label)).toEqual(["Often", "Middle", "Big"]);
    const top2 = (await parties({ party: "sender", ...YEAR, limit: "2" })).body;
    expect(top2.rows).toHaveLength(2);
    expect(top2.totals.parties).toBe(3); // the totals still cover everyone
    expect(top2.rows[0].share).toBeCloseTo(1000 / 1531, 4);
  });

  it("recipients stored only as a number are grouped by that number, whatever its format", async () => {
    insert([
      cashOut("", 100, "2026-06-01", { customer_number: "71588017", phone: "96171588017" }),
      cashOut("96171588017", 50, "2026-06-02"),
      cashOut("", 25, "2026-06-03", { phone: "+961 71 588 017" }),
      cashOut("", 10, "2026-06-04", { customer_number: "03123456" }),
    ]);
    const { body } = await parties({ party: "receiver", ...YEAR });
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({ name: null, number: expect.stringMatching(/71588017$/), count: 3, volume: 175 });
    expect(body.rows[1]).toMatchObject({ name: null, count: 1, volume: 10 });
  });
});

describe("rankParties (grouping rules)", () => {
  const row = (name, amount, extra = {}) => ({ sender_name: name, amount, commission: 0, phone: "", customer_number: "", day: "2026-07-01", ...extra });

  it("names group case- and space-insensitively, shown with the most used spelling", () => {
    const result = rankParties([row("Rami Haddad", 10), row("rami  haddad", 10), row("RAMI HADDAD ", 10), row("Rami Haddad", 10)], "sender");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: "Rami Haddad", count: 4 });
  });

  it("the same number under different names is one person; a name used with exactly one number joins it", () => {
    const result = rankParties([
      row("Rami", 100, { customer_number: "71588017" }),
      row("Rami H.", 50, { phone: "96171588017" }),
      row("Rami", 20), // no number: the only number "Rami" is used with
    ], "sender");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: "Rami", count: 3, volume: 170 });
  });

  it("a name used with two different numbers stays separate from both (it could be either person)", () => {
    const result = rankParties([
      row("Ali", 100, { customer_number: "71000001" }),
      row("Ali", 100, { customer_number: "71000002" }),
      row("Ali", 5),
    ], "sender");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => !r.number)).toMatchObject({ name: "Ali", count: 1 });
  });

  it("rows with neither a name nor a number aren't listed, but are counted", () => {
    const result = rankParties([row("", 40), row("  ", 60), row("Known", 100)], "sender");
    expect(result.rows.map((r) => r.label)).toEqual(["Known"]);
    expect(result.totals).toMatchObject({ rows: 3, volume: 200, parties: 1, unnamed_rows: 2, unnamed_volume: 100 });
    expect(result.rows[0].share).toBe(0.5);
  });

  it("amounts are rounded to cents and commission to 3 decimals; ties keep a stable order", () => {
    const result = rankParties([row("B", 0.1, { commission: 0.0011 }), row("B", 0.2, { commission: 0.0011 }), row("A", 0.3)], "sender");
    expect(result.rows.map((r) => r.label)).toEqual(["B", "A"]); // same total: more transactions first
    expect(result.rows[0]).toMatchObject({ volume: 0.3, commission: 0.002, average: 0.15 });
  });
});

describe("shared party rules", () => {
  it("normalizePhone: one form for +961 / 00961 / 961 / local numbers", () => {
    expect(["+961 71 588 017", "0096171588017", "96171588017", "71588017", "071-588-017"].map(normalizePhone))
      .toEqual(Array(5).fill("71588017"));
  });

  it("sender and receiver display: the name, or the number when the name is a phone", () => {
    expect(senderDisplay({ sender_name: "Rami" })).toBe("Rami");
    expect(senderDisplay({ sender_name: "96171588017", customer_number: "71588017" })).toBe("71588017");
    expect(receiverDisplay({ receiver_name: "", customer_number: "71588017" })).toBe("71588017");
  });
});
