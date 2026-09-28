import { describe, expect, it } from "vitest";
import { BUSY_LEVELS, busyLevels, fromIsoDay, isoDay, isoMonth } from "@/lib/calendarDays";

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

describe("date helpers", () => {
  it("convert between local dates and YYYY-MM-DD without time-zone shifts", () => {
    const date = fromIsoDay("2026-01-05");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 0, 5]);
    expect(isoDay(date)).toBe("2026-01-05");
    expect(isoMonth(new Date(2026, 11, 31, 23, 59))).toBe("2026-12");
  });
});
