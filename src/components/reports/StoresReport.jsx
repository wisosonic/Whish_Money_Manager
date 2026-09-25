import { useEffect, useState } from "react";
import { startOfYear } from "date-fns";
import { Loader2 } from "lucide-react";
import { api } from "@/api/apiClient";
import DateRangeFields, { ymd } from "@/components/admin/DateRangeFields";
import { useI18n } from "@/lib/i18n";
import { formatMoney } from "@/lib/monthlyChartData";

// Reports → Compare stores (the Admin): every store side by side between two dates — transactions,
// cash in, cash out, total, commission and each store's share of the total. Busiest first.
export default function StoresReport() {
  const { t, dir, num, errorText } = useI18n();
  const today = new Date();
  const [from, setFrom] = useState(ymd(startOfYear(today)));
  const [to, setTo] = useState(ymd(today));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const rangeValid = Boolean(from && to && from <= to);

  useEffect(() => {
    if (!rangeValid) {
      setResult(null);
      setLoading(false);
      return undefined;
    }
    let current = true;
    setLoading(true);
    setError("");
    api.admin.reports.stores(from, to)
      .then((answer) => { if (current) setResult(answer); })
      .catch((err) => { if (current) { setResult(null); setError(errorText(err?.message || "")); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
    // errorText only changes with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, rangeValid]);

  const money = (value) => num(formatMoney(value));
  const percent = (share) => num(`${(share * 100).toFixed(1)}%`);
  const rows = result?.stores || [];
  const totals = result?.totals;

  return (
    <div className="space-y-4" data-testid="stores-report">
      <div>
        <h3 className="font-bold text-gray-800">{t("adminReports.stores.title")}</h3>
        <p className="text-xs text-gray-500">{t("adminReports.stores.description")}</p>
      </div>
      <DateRangeFields from={from} to={to} onChange={(start, end) => { setFrom(start); setTo(end); }} testIdPrefix="stores-report-range" />

      {!rangeValid ?
        <p className="text-sm text-red-600">{t("admin.range.invalid")}</p> :
      error ?
        <p role="alert" className="text-sm text-red-600">{error}</p> :
      loading && !result ?
        <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("common.loading")}</p> :
        <div className="overflow-x-auto" dir={dir}>
          <table className={`w-full text-sm text-start ${loading ? "opacity-60" : ""}`} data-testid="stores-report-table">
            <caption className="sr-only">{t("adminReports.stores.title")}</caption>
            <thead className="bg-gray-50 text-gray-600 whitespace-nowrap">
              <tr>
                <th className="px-3 py-2 text-start">{t("stores.column")}</th>
                <th className="px-3 py-2 text-end">{t("adminReports.col.count")}</th>
                <th className="px-3 py-2 text-end">{t("summary.deposits")}</th>
                <th className="px-3 py-2 text-end">{t("summary.withdrawals")}</th>
                <th className="px-3 py-2 text-end" aria-sort="descending">{t("adminReports.col.volume")}</th>
                <th className="px-3 py-2 text-end">{t("adminReports.col.commission")}</th>
                <th className="px-3 py-2 text-start">{t("adminReports.col.share")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) =>
                <tr key={row.id} data-testid="stores-report-row">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-gray-800 whitespace-nowrap">{row.name}</span>
                    {row.location && <span className="block text-xs text-gray-500">{row.location}</span>}
                  </td>
                  <td className="px-3 py-2 text-end">{num(row.count)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(row.cash_in)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(row.cash_out)}</td>
                  <td className="px-3 py-2 text-end font-bold text-gray-900" dir="ltr">{money(row.volume)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(row.commission)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-10 text-xs text-gray-700" dir="ltr">{percent(row.share)}</span>
                      <span className="hidden sm:block h-1.5 w-20 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                        <span className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                      </span>
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
            {totals &&
              <tfoot className="bg-gray-50 font-bold" data-testid="stores-report-total">
                <tr>
                  <td className="px-3 py-2">{t("chart.total")}</td>
                  <td className="px-3 py-2 text-end">{num(totals.count)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(totals.cash_in)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(totals.cash_out)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(totals.volume)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(totals.commission)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            }
          </table>
        </div>
      }
    </div>
  );
}
