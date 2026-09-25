import { format, startOfMonth, startOfYear, subMonths, endOfMonth } from "date-fns";
import { api } from "@/api/apiClient";
import { useI18n } from "@/lib/i18n";

// From / To dates (both included) with quick ranges, used by the admin panel's range and by the
// reports. `testIdPrefix` names the parts: `${prefix}-from`, `${prefix}-to`, `${prefix}-thisMonth` …
export const ymd = (date) => format(date, "yyyy-MM-dd");

// storeId: "All data" covers that store (the Admin's choice); without it, every store you can see.
export default function DateRangeFields({ from, to, onChange, testIdPrefix = "range", storeId }) {
  const { t } = useI18n();
  const today = new Date();
  const quickRanges = [
    { key: "thisMonth", apply: () => onChange(ymd(startOfMonth(today)), ymd(today)) },
    { key: "lastMonth", apply: () => { const last = subMonths(today, 1); onChange(ymd(startOfMonth(last)), ymd(endOfMonth(last))); } },
    { key: "thisYear", apply: () => onChange(ymd(startOfYear(today)), ymd(today)) },
    {
      key: "allData",
      apply: async () => {
        const { first_date: first, last_date: last } = await api.admin.range(...(storeId ? [storeId] : []));
        if (first && last) onChange(first, last);
      },
    },
  ];

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        {t("admin.range.from")}
        <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)}
          className="border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-300" data-testid={`${testIdPrefix}-from`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        {t("admin.range.to")}
        <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)}
          className="border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-300" data-testid={`${testIdPrefix}-to`} />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("admin.range.quick")}>
        {quickRanges.map(({ key, apply }) =>
          <button key={key} type="button" onClick={apply} data-testid={`${testIdPrefix}-${key}`}
            className="px-3 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            {t(`admin.range.${key}`)}
          </button>
        )}
      </div>
    </div>
  );
}
