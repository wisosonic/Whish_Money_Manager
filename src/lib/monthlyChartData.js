import ar from "@/locales/ar";

// Month names come from the translations (keys months.1 … months.12); Arabic is the default.
export const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => ar[`months.${i + 1}`]);

const transactionDate = (t) => t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
const roundCents = (value) => Math.round(value * 100) / 100;

// One row per month (always 12, so the x-axis is stable) for the given year.
// Profit is the office's income: the commissions earned in that month.
export const buildMonthlyChartData = (transactions, year, today = new Date(), monthLabels = MONTH_LABELS) => {
  const sums = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, profit: 0, cashIn: 0, cashOut: 0, count: 0 }));
  (transactions || []).forEach((t) => {
    const date = transactionDate(t);
    if (!date.startsWith(`${year}-`)) return;
    const row = sums[Number(date.slice(5, 7)) - 1];
    if (!row) return;
    row.count += 1;
    row.profit += Number(t.commission) || 0;
    if (t.type === "cash_in") row.cashIn += Number(t.amount) || 0;
    if (t.type === "cash_out") row.cashOut += Number(t.amount) || 0;
  });
  return finalizeMonthlyRows(sums, year, today, monthLabels);
};

// Month sums (from the transactions above, or from the server's income report) → chart rows:
// labelled, rounded to cents, and with null values for months that haven't happened yet (after
// `today`), so the chart leaves a gap instead of drawing a misleading drop to $0.
export const finalizeMonthlyRows = (sums, year, today = new Date(), monthLabels = MONTH_LABELS) => {
  const currentYear = today.getFullYear();
  const isFutureMonth = (month) =>
    Number(year) > currentYear || (Number(year) === currentYear && month > today.getMonth() + 1);
  const byMonth = new Map((sums || []).map((row) => [Number(row.month), row]));
  return monthLabels.map((label, index) => {
    const month = index + 1;
    const row = byMonth.get(month) || {};
    const count = Number(row.count) || 0;
    return isFutureMonth(month) && count === 0
      ? { month, label, profit: null, cashIn: null, cashOut: null, count: null }
      : { month, label, profit: roundCents(Number(row.profit) || 0), cashIn: roundCents(Number(row.cashIn) || 0), cashOut: roundCents(Number(row.cashOut) || 0), count };
  });
};

// Year totals over the chart rows (future months are null and contribute nothing).
export const sumChartData = (rows) =>
  rows.reduce(
    (sum, row) => ({
      profit: roundCents(sum.profit + (row.profit || 0)),
      cashIn: roundCents(sum.cashIn + (row.cashIn || 0)),
      cashOut: roundCents(sum.cashOut + (row.cashOut || 0)),
      count: sum.count + (row.count || 0),
    }),
    { profit: 0, cashIn: 0, cashOut: 0, count: 0 }
  );

// Compact axis labels: 950 → $950, 12,500 → $12.5k, 1,200,000 → $1.2M
export const formatCompactMoney = (value) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${+(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${+(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${+abs.toFixed(2)}`;
};

export const formatMoney = (value) =>
  value == null
    ? "—"
    : `$${(Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
