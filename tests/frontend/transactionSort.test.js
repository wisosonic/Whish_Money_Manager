import { describe, expect, it } from "vitest";
import { NO_SORT, SORT_VALUES, nextSort, sortTransactions } from "@/lib/transactionSort";

const rows = [
  { id: 1, sender_name: "b", amount: 10, reference_number: "tr:10" },
  { id: 2, sender_name: "", amount: null, reference_number: "-" },
  { id: 3, sender_name: "A", amount: 10, reference_number: "tr:2" },
  { id: 4, sender_name: "c", amount: 5, reference_number: "null" },
];
const ids = (list) => list.map((t) => t.id);

describe("transactionSort", () => {
  it("cycles none → asc → desc → none per column, and restarts on a new column", () => {
    let s = NO_SORT;
    s = nextSort(s, "amount");
    expect(s).toEqual({ key: "amount", dir: "asc" });
    s = nextSort(s, "amount");
    expect(s).toEqual({ key: "amount", dir: "desc" });
    expect(nextSort(s, "sender")).toEqual({ key: "sender", dir: "asc" });
    s = nextSort(s, "amount");
    expect(s).toBe(NO_SORT);
  });

  it("returns the same array when not sorted, and never mutates the input", () => {
    expect(sortTransactions(rows, NO_SORT)).toBe(rows);
    sortTransactions(rows, { key: "amount", dir: "desc" });
    expect(ids(rows)).toEqual([1, 2, 3, 4]);
  });

  it("is stable for equal values and keeps empty values last in both directions", () => {
    expect(ids(sortTransactions(rows, { key: "amount", dir: "asc" }))).toEqual([4, 1, 3, 2]);
    expect(ids(sortTransactions(rows, { key: "amount", dir: "desc" }))).toEqual([1, 3, 4, 2]);
    expect(ids(sortTransactions(rows, { key: "sender", dir: "asc" }))).toEqual([3, 1, 4, 2]);
    expect(ids(sortTransactions(rows, { key: "sender", dir: "desc" }))).toEqual([4, 1, 3, 2]);
  });

  it("treats '-', 'null' and blanks as empty, and compares embedded numbers naturally", () => {
    expect(ids(sortTransactions(rows, { key: "reference", dir: "asc" }))).toEqual([3, 1, 2, 4]);
  });

  it("uses the provided journal index for '#', and ignores unknown columns", () => {
    const order = new Map([[1, 2], [2, 0], [3, 3], [4, 1]]);
    expect(ids(sortTransactions(rows, { key: "index", dir: "asc" }, { indexOf: (t) => order.get(t.id) }))).toEqual([2, 4, 1, 3]);
    expect(sortTransactions(rows, { key: "nope", dir: "asc" })).toBe(rows);
  });

  it("sorts Arabic names alphabetically with the Arabic locale", () => {
    const names = [{ id: 1, sender_name: "سامي" }, { id: 2, sender_name: "أحمد" }, { id: 3, sender_name: "باسم" }];
    expect(ids(sortTransactions(names, { key: "sender", dir: "asc" }, { locale: "ar" }))).toEqual([2, 3, 1]);
  });

  it("commission rate is commission ÷ amount, empty when the amount is 0", () => {
    expect(SORT_VALUES.commissionRate({ amount: 200, commission: 2 })).toBe(0.01);
    expect(SORT_VALUES.commissionRate({ amount: 0, commission: 0 })).toBeNull();
  });
});
