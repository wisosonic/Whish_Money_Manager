import { describe, expect, it } from "vitest";
import {
  MONTH_LABELS, availableYears, buildMonthlyChartData, formatCompactMoney, formatMoney, sumChartData,
} from "@/lib/monthlyChartData";

const tx = (date, type, amount, commission = 0) => ({ transaction_date: date, type, amount, commission });

const transactions = [
  tx("2026-06-06", "cash_in", 100, 1),
  tx("2026-06-07", "cash_out", 40),
  tx("2026-06-30", "cash_in", 25.25, 0.253),
  tx("2026-09-23", "cash_out", 1500),
  tx("2026-09-23", "cash_in", 50, 0.5),
  tx("2025-12-31", "cash_in", 999, 9.99),
  { type: "cash_in", amount: 10, commission: 0.1, created_date: "2026-01-15T10:00:00Z" }, // no transaction_date
];
const TODAY = new Date(2026, 8, 23); // 23 Sep 2026

describe("buildMonthlyChartData", () => {
  it("always returns 12 months with Arabic labels", () => {
    const rows = buildMonthlyChartData(transactions, "2026", TODAY);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.label)).toEqual(MONTH_LABELS);
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("sums profit (commissions), cash in and cash out per month for the requested year only", () => {
    const rows = buildMonthlyChartData(transactions, "2026", TODAY);
    expect(rows[5]).toMatchObject({ label: "يونيو", profit: 1.25, cashIn: 125.25, cashOut: 40, count: 3 });
    expect(rows[8]).toMatchObject({ label: "سبتمبر", profit: 0.5, cashIn: 50, cashOut: 1500, count: 2 });
    expect(rows[6]).toMatchObject({ profit: 0, cashIn: 0, cashOut: 0, count: 0 });
  });

  it("falls back to created_date when transaction_date is missing", () => {
    const rows = buildMonthlyChartData(transactions, "2026", TODAY);
    expect(rows[0]).toMatchObject({ cashIn: 10, profit: 0.1, count: 1 });
  });

  it("leaves months after today empty (null) instead of $0", () => {
    const rows = buildMonthlyChartData(transactions, "2026", TODAY);
    rows.slice(9).forEach((row) => expect(row).toMatchObject({ profit: null, cashIn: null, cashOut: null, count: null }));
    // Past years are complete.
    expect(buildMonthlyChartData(transactions, "2025", TODAY)[11]).toMatchObject({ cashIn: 999, count: 1 });
    // Future years are entirely empty.
    expect(buildMonthlyChartData(transactions, "2027", TODAY).every((r) => r.count === null)).toBe(true);
  });

  it("ignores empty input", () => {
    expect(buildMonthlyChartData(undefined, "2026", TODAY)[0].count).toBe(0);
  });
});

describe("sumChartData", () => {
  it("totals the year, skipping future (null) months", () => {
    expect(sumChartData(buildMonthlyChartData(transactions, "2026", TODAY))).toEqual({
      profit: 1.85, cashIn: 185.25, cashOut: 1540, count: 6,
    });
  });
});

describe("availableYears", () => {
  it("lists years with data, newest first, always including the selected year", () => {
    expect(availableYears(transactions, "2026")).toEqual(["2026", "2025"]);
    expect(availableYears([], "2024")).toEqual(["2024"]);
    expect(availableYears(transactions, "2027")[0]).toBe("2027");
  });
});

describe("formatters", () => {
  it("formats compact axis money", () => {
    expect(formatCompactMoney(0)).toBe("$0");
    expect(formatCompactMoney(950)).toBe("$950");
    expect(formatCompactMoney(12500)).toBe("$12.5k");
    expect(formatCompactMoney(140000)).toBe("$140k");
    expect(formatCompactMoney(1200000)).toBe("$1.2M");
  });

  it("formats full money and shows a dash for empty months", () => {
    expect(formatMoney(193737.74)).toBe("$193,737.74");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(null)).toBe("—");
  });
});
