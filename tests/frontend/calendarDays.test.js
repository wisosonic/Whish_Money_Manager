import { describe, expect, it } from "vitest";
import { daysWithData, fromIsoDay, isoDay, isoMonth, shiftDay } from "@/lib/calendarDays";

describe("daysWithData", () => {
  it("every day with at least one transaction, however many (one colour for all)", () => {
    expect(daysWithData([
      { date: "2026-09-01", count: 1000 }, { date: "2026-09-02", count: 1 }, { date: "2026-09-03", count: 0 }, { date: "2026-09-04", count: "7" },
    ])).toEqual(["2026-09-01", "2026-09-02", "2026-09-04"]);
  });

  it("no days, or only zero counts: nothing is highlighted", () => {
    expect(daysWithData([])).toEqual([]);
    expect(daysWithData(undefined)).toEqual([]);
    expect(daysWithData([{ date: "a", count: 0 }, { date: "b" }])).toEqual([]);
  });
});

describe("shiftDay (the dashboard's previous / next day arrows)", () => {
  it("moves by whole calendar days, across months, years and leap days", () => {
    expect(shiftDay("2026-09-23", -1)).toBe("2026-09-22");
    expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("isn't thrown off by daylight-saving changes (local dates, no hour arithmetic)", () => {
    // Lebanon and Europe change clocks on the last Sunday of March and October.
    expect(shiftDay("2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDay("2026-10-25", -1)).toBe("2026-10-24");
  });
});

describe("date helpers", () => {
  it("convert between local dates and YYYY-MM-DD without time-zone shifts", () => {
    const date = fromIsoDay("2026-01-05");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 0, 5]);
    expect(isoDay(date)).toBe("2026-01-05");
    expect(isoMonth(new Date(2026, 11, 31, 23, 59))).toBe("2026-12");
  });
});
