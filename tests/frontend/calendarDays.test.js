import { describe, expect, it } from "vitest";
import { BUSY_LEVELS, busyLevels, fromIsoDay, isoDay, isoMonth, shiftDay } from "@/lib/calendarDays";

describe("busyLevels", () => {
  it("shades relative to the month's busiest day: the busiest is the darkest, any activity at least 1", () => {
    const levels = busyLevels([
      { date: "2026-09-01", count: 100 }, { date: "2026-09-02", count: 76 }, { date: "2026-09-03", count: 50 },
      { date: "2026-09-04", count: 26 }, { date: "2026-09-05", count: 25 }, { date: "2026-09-06", count: 1 },
    ]);
    expect(BUSY_LEVELS).toBe(4);
    expect(Object.fromEntries(levels)).toEqual({
      "2026-09-01": 4, "2026-09-02": 4, "2026-09-03": 2, "2026-09-04": 2, "2026-09-05": 1, "2026-09-06": 1,
    });
  });

  it("a month where every day has the same count shades them all darkest", () => {
    expect([...busyLevels([{ date: "a", count: 3 }, { date: "b", count: 3 }]).values()]).toEqual([4, 4]);
  });

  it("no days, or only zero counts: nothing is shaded", () => {
    expect(busyLevels([]).size).toBe(0);
    expect(busyLevels(undefined).size).toBe(0);
    expect(busyLevels([{ date: "a", count: 0 }]).size).toBe(0);
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
