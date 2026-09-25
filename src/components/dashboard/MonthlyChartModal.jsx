import { useMemo, useState } from "react";
import { X, BarChart3 } from "lucide-react";
import IncomeChart from "@/components/reports/IncomeChart";
import { useI18n } from "@/lib/i18n";
import { availableYears, buildMonthlyChartData } from "@/lib/monthlyChartData";

// The dashboard's "الرسم البياني" window: the monthly income chart over the loaded transactions.
// The chart itself (colours, axes, table view) is shared with Admin panel → Reports → Income.
export { CHART_SERIES, CHART_INK, ChartTooltip, ChartLegend } from "@/components/reports/IncomeChart";

export default function MonthlyChartModal({ allTransactions, selectedDate, onClose }) {
  const { t, dir } = useI18n();
  const defaultYear = String(selectedDate || new Date().toISOString()).slice(0, 4);
  const [year, setYear] = useState(defaultYear);

  const years = useMemo(() => availableYears(allTransactions, defaultYear), [allTransactions, defaultYear]);
  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, i) => t(`months.${i + 1}`)), [t]);
  const data = useMemo(() => buildMonthlyChartData(allTransactions, year, new Date(), monthLabels), [allTransactions, year, monthLabels]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 md:p-4" dir={dir}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col">
        <IncomeChart
          data={data}
          years={years}
          year={year}
          onYearChange={setYear}
          title={
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-bold text-gray-800">{t("chart.title")}</h2>
            </div>
          }
          actions={
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition" aria-label={t("common.close")}>
              <X className="w-5 h-5" />
            </button>
          } />
      </div>
    </div>
  );
}
