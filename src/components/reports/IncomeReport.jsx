import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/apiClient";
import IncomeChart from "@/components/reports/IncomeChart";
import { useI18n } from "@/lib/i18n";
import { finalizeMonthlyRows } from "@/lib/monthlyChartData";

// Reports → Income: the dashboard's monthly chart, from the server's monthly sums (so it covers
// every transaction without loading them all in the browser).
export default function IncomeReport() {
  const { t, errorText } = useI18n();
  const currentYear = String(new Date().getFullYear());
  const [year, setYear] = useState(currentYear);
  const [result, setResult] = useState(null); // { year, years, months }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A stale answer (the year changed meanwhile) is ignored.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api.admin.reports.income(year)
      .then((answer) => { if (current) setResult(answer); })
      .catch((err) => { if (current) setError(errorText(err?.message || "")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
    // errorText only changes with the language; re-fetching for that isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, i) => t(`months.${i + 1}`)), [t]);
  const months = result?.year === year ? result.months : [];
  const data = useMemo(() => finalizeMonthlyRows(months, year, new Date(), monthLabels), [months, year, monthLabels]);
  const years = useMemo(
    () => [...new Set([...(result?.years || []), currentYear, year])].sort((a, b) => b.localeCompare(a)),
    [result, currentYear, year]
  );

  return (
    <div className="border rounded-xl overflow-hidden" data-testid="income-report">
      <IncomeChart
        data={data}
        years={years}
        year={year}
        onYearChange={setYear}
        loading={loading}
        title={
          <div className="min-w-0">
            <h3 className="font-bold text-gray-800">{t("adminReports.income.title")}</h3>
            <p className="text-xs text-gray-500">{t("adminReports.income.description")}</p>
          </div>
        } />
      {error && <p role="alert" className="px-4 pb-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}
