export const MONTH_LABELS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const transactionDate = (t) => t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
const roundCents = (value) => Math.round(value * 100) / 100;

// One row per month (always 12, so the x-axis is stable) for the given year.
// Profit is the office's income: the commissions earned in that month.
// Months that haven't happened yet (after `today`) get null values, so the chart leaves a gap
// instead of drawing a misleading drop to $0.
export const buildMonthlyChartData = (transactions, year, today = new Date()) => {
  const currentYear = today.getFullYear();
  const isFutureMonth = (month) =>
    Number(year) > currentYear || (Number(year) === currentYear && month > today.getMonth() + 1);

  const rows = MONTH_LABELS.map((label, index) => ({
    month: index + 1,
    label,
    profit: 0,
    cashIn: 0,
    cashOut: 0,
    count: 0,
  }));

  (transactions || []).forEach((t) => {
    const date = transactionDate(t);
    if (!date.startsWith(`${year}-`)) return;
    const row = rows[Number(date.slice(5, 7)) - 1];
    if (!row) return;
    row.count += 1;
    row.profit += Number(t.commission) || 0;
    if (t.type === "cash_in") row.cashIn += Number(t.amount) || 0;
    if (t.type === "cash_out") row.cashOut += Number(t.amount) || 0;
  });

  return rows.map((row) =>
    isFutureMonth(row.month) && row.count === 0
      ? { ...row, profit: null, cashIn: null, cashOut: null, count: null }
      : { ...row, profit: roundCents(row.profit), cashIn: roundCents(row.cashIn), cashOut: roundCents(row.cashOut) }
  );
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

// Years that have data, newest first, always including the fallback (the selected date's year).
export const availableYears = (transactions, fallbackYear) => {
  const years = new Set([String(fallbackYear)]);
  (transactions || []).forEach((t) => {
    const year = transactionDate(t).slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  });
  return [...years].sort((a, b) => b.localeCompare(a));
};

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
