// Sorting for the transactions table. Every column header cycles:
//   original order → ascending → descending → original order.
// Rules:
//   - Stable: rows with equal values keep their journal order.
//   - Empty values ("", null, "-", "null") always go last, in both directions.
//   - Text compares with the interface locale, ignoring case, with numbers in natural order
//     (so "tr:9" comes before "tr:10").
//   - "Ascending" means A→Z, smallest first, oldest first, and for Type: Cash In first.
import { receiverDisplay } from "@/lib/transactionSearch";

export const SORT_CYCLE = { none: "asc", asc: "desc", desc: "none" };
export const NO_SORT = { key: null, dir: "none" };

const numberOrNull = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// How each column's value is read. `index` is the row's real place in the day's journal.
export const SORT_VALUES = {
  index: (t, ctx) => ctx.indexOf(t),
  type: (t) => (t.type === "cash_in" ? 0 : 1),
  sender: (t) => t.sender_name,
  receiver: (t) => receiverDisplay(t),
  amount: (t) => numberOrNull(t.amount),
  commissionRate: (t) => (t.amount > 0 ? (Number(t.commission) || 0) / t.amount : null),
  commission: (t) => numberOrNull(t.commission),
  reference: (t) => t.reference_number,
  service: (t) => t.service,
  note: (t) => t.note,
  // The date column shows transaction_date (or created_date); created_date breaks ties within a day.
  date: (t) => `${t.transaction_date || String(t.created_date || "").slice(0, 10)} ${t.created_date || ""}`.trim(),
};

const isEmpty = (v) => v === null || v === undefined || (typeof v === "string" && ["", "-", "null"].includes(v.trim()));

// Returns the next sort state after clicking a column header.
export const nextSort = (sort, key) => {
  if (sort.key !== key) return { key, dir: "asc" };
  const dir = SORT_CYCLE[sort.dir];
  return dir === "none" ? NO_SORT : { key, dir };
};

export const sortTransactions = (rows, sort, { locale = "ar", indexOf = (t) => rows.indexOf(t) } = {}) => {
  const read = sort && sort.dir !== "none" && SORT_VALUES[sort.key];
  if (!read) return rows;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sign = sort.dir === "desc" ? -1 : 1;
  const ctx = { indexOf };
  return rows
    .map((t, i) => ({ t, i, v: read(t, ctx) }))
    .sort((a, b) => {
      const aEmpty = isEmpty(a.v);
      const bEmpty = isEmpty(b.v);
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? a.i - b.i : aEmpty ? 1 : -1;
      const diff = typeof a.v === "number" && typeof b.v === "number"
        ? a.v - b.v
        : collator.compare(String(a.v).trim(), String(b.v).trim());
      return sign * diff || a.i - b.i;
    })
    .map(({ t }) => t);
};
