import { useMemo, useState } from "react";
import { X, BarChart3, Table2 } from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import ar from "@/locales/ar";
import {
  availableYears, buildMonthlyChartData, formatCompactMoney, formatMoney, sumChartData,
} from "@/lib/monthlyChartData";

// Colors validated for color-vision deficiency (all pairs ΔE ≥ 17) and ≥ 3:1 contrast on white,
// kept on the app's blue / green / red meaning. Cash out is also dashed, so it never relies on color alone.
export const CHART_SERIES = {
  // `name` is the Arabic default (for non-React code and tests); the UI shows t(nameKey).
  profit: { nameKey: "chart.series.profit", name: ar["chart.series.profit"], color: "#1d4ed8" },
  cashIn: { nameKey: "chart.series.cashIn", name: ar["chart.series.cashIn"], color: "#16a34a" },
  cashOut: { nameKey: "chart.series.cashOut", name: ar["chart.series.cashOut"], color: "#991b1b", dashed: true },
};

const SeriesKey = ({ dataKey, color }) =>
  dataKey === "profit" ? (
    <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
  ) : (
    <span
      className="inline-block w-5 flex-shrink-0"
      style={{ borderTop: `2px ${CHART_SERIES[dataKey]?.dashed ? "dashed" : "solid"} ${color}` }}
    />
  );

// Tooltip: every series for the hovered month, value first, keyed with its mark.
export function ChartTooltip({ active, payload, label }) {
  const { dir } = useI18n();
  const items = (payload || []).filter((item) => item.value != null);
  if (!active || items.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm" dir={dir}>
      <p className="font-bold text-gray-800 mb-1">{items[0]?.payload?.label ?? label}</p>
      {items.map((item) => (
        <div key={item.dataKey} className="flex items-center gap-2 py-0.5">
          <SeriesKey dataKey={item.dataKey} color={item.color} />
          <span className="font-bold text-gray-900">{formatMoney(item.value)}</span>
          <span className="text-gray-500">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

// Legend in text ink (not series color), with keys mirroring the marks: box for bars, line for lines.
export function ChartLegend({ payload }) {
  const { dir } = useI18n();
  return (
    <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs md:text-sm text-gray-700 pt-3" dir={dir}>
      {(payload || []).map((item) => (
        <li key={item.dataKey} className="flex items-center gap-2">
          <SeriesKey dataKey={item.dataKey} color={item.color} />
          <span>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

// Horizontal axis caption above an axis, anchored to its outer edge so it never runs off the chart
// (rotated Arabic axis titles are hard to read).
const axisCaption = (text, side, fontSize) => {
  const AxisCaption = ({ viewBox }) => {
    if (!viewBox) return null;
    const x = side === "left" ? viewBox.x : viewBox.x + viewBox.width;
    return (
      <text x={x} y={viewBox.y - 10} textAnchor={side === "left" ? "start" : "end"} fill="#374151" fontSize={fontSize}>
        {text}
      </text>
    );
  };
  return AxisCaption;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function MonthlyChartModal({ allTransactions, selectedDate, onClose }) {
  const { t, dir } = useI18n();
  const seriesName = (key) => t(CHART_SERIES[key].nameKey);
  const isMobile = useIsMobile();
  const animate = !prefersReducedMotion();
  const defaultYear = String(selectedDate || new Date().toISOString()).slice(0, 4);
  const [year, setYear] = useState(defaultYear);
  const [view, setView] = useState("chart"); // chart | table

  const years = useMemo(() => availableYears(allTransactions, defaultYear), [allTransactions, defaultYear]);
  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, i) => t(`months.${i + 1}`)), [t]);
  const data = useMemo(() => buildMonthlyChartData(allTransactions, year, new Date(), monthLabels), [allTransactions, year, monthLabels]);
  const totals = useMemo(() => sumChartData(data), [data]);
  const hasData = totals.count > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 md:p-4" dir={dir}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5 border-b">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-800">{t("chart.title")}</h2>
          </div>
          <div className="flex items-center gap-2 ms-auto">
            <label className="text-sm text-gray-600" htmlFor="chart-year">{t("chart.year")}</label>
            <select
              id="chart-year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="border rounded-lg px-2 py-1 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
              className="flex items-center gap-1 border rounded-lg px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              {view === "chart" ? <Table2 className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
              {view === "chart" ? t("chart.showTable") : t("chart.showChart")}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition" aria-label={t("common.close")}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Year totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 p-3 md:p-4 border-b bg-gray-50">
          {[
            { key: "profit", label: t("chart.profitYear", { year }), value: formatMoney(totals.profit) },
            { key: "cashIn", label: t("summary.deposits"), value: formatMoney(totals.cashIn) },
            { key: "cashOut", label: t("summary.withdrawals"), value: formatMoney(totals.cashOut) },
            { key: "count", label: t("chart.count"), value: totals.count },
          ].map((item) => (
            <div key={item.key} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="text-base md:text-lg font-bold text-gray-900" data-testid={`chart-total-${item.key}`}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-2 md:p-4">
          {!hasData ? (
            <div className="p-12 text-center text-gray-400">{t("chart.emptyYear", { year })}</div>
          ) : view === "table" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-start" data-testid="chart-table">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2">{t("chart.month")}</th>
                    <th className="px-3 py-2">{seriesName("profit")}</th>
                    <th className="px-3 py-2">{seriesName("cashIn")}</th>
                    <th className="px-3 py-2">{seriesName("cashOut")}</th>
                    <th className="px-3 py-2">{t("chart.count")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.map((row) => (
                    <tr key={row.month}>
                      <td className="px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2">{formatMoney(row.profit)}</td>
                      <td className="px-3 py-2">{formatMoney(row.cashIn)}</td>
                      <td className="px-3 py-2">{formatMoney(row.cashOut)}</td>
                      <td className="px-3 py-2">{row.count ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-bold">
                  <tr>
                    <td className="px-3 py-2">{t("chart.total")}</td>
                    <td className="px-3 py-2">{formatMoney(totals.profit)}</td>
                    <td className="px-3 py-2">{formatMoney(totals.cashIn)}</td>
                    <td className="px-3 py-2">{formatMoney(totals.cashOut)}</td>
                    <td className="px-3 py-2">{totals.count}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div
              role="img"
              aria-label={t("chart.ariaLabel", { year })}
              data-testid="monthly-chart"
              data-layout={isMobile ? "mobile" : "desktop"}
              dir="ltr"
            >
              <ResponsiveContainer width="100%" height={isMobile ? 300 : 400}>
                <ComposedChart
                  data={data}
                  margin={isMobile ? { top: 20, right: 0, bottom: 0, left: 0 } : { top: 24, right: 8, bottom: 8, left: 8 }}
                >
                  <CartesianGrid vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey={isMobile ? "month" : "label"}
                    tick={{ fontSize: isMobile ? 11 : 12, fill: "#4b5563" }}
                    tickLine={false}
                    axisLine={{ stroke: "#d1d5db" }}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="profit"
                    orientation="left"
                    tickFormatter={formatCompactMoney}
                    tick={{ fontSize: isMobile ? 10 : 12, fill: "#4b5563" }}
                    tickLine={false}
                    axisLine={false}
                    width={isMobile ? 48 : 64}
                    label={axisCaption(isMobile ? t("chart.axisProfitShort") : t("chart.axisProfit"), "left", isMobile ? 10 : 12)}
                  />
                  <YAxis
                    yAxisId="flow"
                    orientation="right"
                    tickFormatter={formatCompactMoney}
                    tick={{ fontSize: isMobile ? 10 : 12, fill: "#4b5563" }}
                    tickLine={false}
                    axisLine={false}
                    width={isMobile ? 52 : 72}
                    label={axisCaption(isMobile ? t("chart.axisFlowShort") : t("chart.axisFlow"), "right", isMobile ? 10 : 12)}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(29, 78, 216, 0.06)" }} />
                  <Legend verticalAlign="bottom" content={<ChartLegend />} />
                  <Bar
                    yAxisId="profit"
                    dataKey="profit"
                    name={seriesName("profit")}
                    fill={CHART_SERIES.profit.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                    isAnimationActive={animate}
                  />
                  <Line
                    yAxisId="flow"
                    type="linear"
                    dataKey="cashIn"
                    name={seriesName("cashIn")}
                    stroke={CHART_SERIES.cashIn.color}
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2, fill: "#ffffff" }}
                    activeDot={{ r: 6 }}
                    isAnimationActive={animate}
                  />
                  <Line
                    yAxisId="flow"
                    type="linear"
                    dataKey="cashOut"
                    name={seriesName("cashOut")}
                    stroke={CHART_SERIES.cashOut.color}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={{ r: 4, strokeWidth: 2, fill: "#ffffff" }}
                    activeDot={{ r: 6 }}
                    isAnimationActive={animate}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
