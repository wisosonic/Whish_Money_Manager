// Test-only: the shared income chart fed with transactions, with a year picker — what the admin
// panel's Income report does with the server's monthly sums (and what the removed dashboard chart
// window did). Lets the chart's tests pass plain transactions.
import { useMemo, useState } from "react";
import IncomeChart from "@/components/reports/IncomeChart";
import { buildMonthlyChartData } from "@/lib/monthlyChartData";

const yearOf = (t) => String(t.transaction_date || t.created_date || "").slice(0, 4);

export default function ChartHarness({ allTransactions, selectedDate }) {
  const defaultYear = String(selectedDate).slice(0, 4);
  const [year, setYear] = useState(defaultYear);
  const years = useMemo(
    () => [...new Set([defaultYear, ...allTransactions.map(yearOf).filter((y) => /^\d{4}$/.test(y))])].sort((a, b) => b.localeCompare(a)),
    [allTransactions, defaultYear]
  );
  const data = useMemo(() => buildMonthlyChartData(allTransactions, year), [allTransactions, year]);
  return <IncomeChart data={data} years={years} year={year} onYearChange={setYear} title={<h2>Income</h2>} />;
}
