import { useEffect, useState } from "react";
import { startOfYear } from "date-fns";
import { Loader2 } from "lucide-react";
import { api } from "@/api/apiClient";
import DateRangeFields, { ymd } from "@/components/admin/DateRangeFields";
import { useI18n } from "@/lib/i18n";
import { formatMoney } from "@/lib/monthlyChartData";

// Reports → Top senders (party "sender": who sent money in, Cash In) and Top recipients (party
// "receiver": who money was sent to, Cash Out), in a date range. Grouping and ranking are done by
// the server (server/reports.js): by phone number when there is one, otherwise by name.
export const LIMITS = [10, 25, 50, 100];
const selectCls = "border rounded-lg px-3 py-2 text-sm font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-300";

export default function PartyReport({ party }) {
  const { t, dir, num, errorText } = useI18n();
  const today = new Date();
  const [from, setFrom] = useState(ymd(startOfYear(today)));
  const [to, setTo] = useState(ymd(today));
  const [by, setBy] = useState("volume");
  const [limit, setLimit] = useState(LIMITS[0]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const rangeValid = Boolean(from && to && from <= to);
  const isSender = party === "sender";
  const prefix = `${party}-report`;

  // A stale answer (a filter changed meanwhile) is ignored.
  useEffect(() => {
    if (!rangeValid) {
      setResult(null);
      setLoading(false);
      return undefined;
    }
    let current = true;
    setLoading(true);
    setError("");
    api.admin.reports.parties({ party, from, to, by, limit })
      .then((answer) => { if (current) setResult(answer); })
      .catch((err) => { if (current) { setResult(null); setError(errorText(err?.message || "")); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
    // errorText only changes with the language; re-fetching for that isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party, from, to, by, limit, rangeValid]);

  const money = (value) => num(formatMoney(value));
  const percent = (share) => num(`${(share * 100).toFixed(1)}%`);
  const totals = result?.totals;
  const rows = result?.rows || [];

  return (
    <div className="space-y-4" data-testid={prefix}>
      <div>
        <h3 className="font-bold text-gray-800">{t(`adminReports.${party}.title`)}</h3>
        <p className="text-xs text-gray-500">{t(`adminReports.${party}.description`)} {t("adminReports.grouping")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <DateRangeFields from={from} to={to} onChange={(start, end) => { setFrom(start); setTo(end); }} testIdPrefix={`${prefix}-range`} />
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          {t("adminReports.rankBy")}
          <select value={by} onChange={(e) => setBy(e.target.value)} className={selectCls} data-testid={`${prefix}-by`}>
            <option value="volume">{t("adminReports.rankBy.volume")}</option>
            <option value="count">{t("adminReports.rankBy.count")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          {t("adminReports.limit")}
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={selectCls} data-testid={`${prefix}-limit`}>
            {LIMITS.map((n) => <option key={n} value={n}>{t("adminReports.limitOption", { count: n })}</option>)}
          </select>
        </label>
      </div>

      {/* What the range holds, then the ranking. */}
      <div className="rounded-lg bg-gray-50 border px-4 py-3 text-sm" aria-live="polite" data-testid={`${prefix}-summary`}>
        {!rangeValid ?
          <span className="text-red-600">{t("admin.range.invalid")}</span> :
        error ?
          <span className="text-red-600" role="alert">{error}</span> :
        loading && !result ?
          <span className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("common.loading")}</span> :
        totals &&
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="font-bold text-gray-800">{t(`adminReports.summary.${party}s`, { count: totals.parties })}</span>
            <span className="text-gray-700">{t("adminReports.summary.transactions", { count: totals.rows })}</span>
            <span className="text-gray-700">{t("adminReports.summary.total")} <span dir="ltr">{money(totals.volume)}</span></span>
            {totals.unnamed_rows > 0 &&
              <span className="text-gray-500 w-full">{t("adminReports.unnamed", { count: totals.unnamed_rows })} <span dir="ltr">{money(totals.unnamed_volume)}</span></span>
            }
          </div>
        }
      </div>

      {rangeValid && !error && result && (rows.length === 0 ?
        <p className="p-8 text-center text-gray-400" data-testid={`${prefix}-empty`}>{t(`adminReports.empty.${party}`)}</p> :
        <div className="overflow-x-auto" dir={dir}>
          <table className={`w-full text-sm text-start ${loading ? "opacity-60" : ""}`} data-testid={`${prefix}-table`}>
            <caption className="sr-only">{t(`adminReports.${party}.title`)}</caption>
            <thead className="bg-gray-50 text-gray-600 whitespace-nowrap">
              <tr>
                <th className="px-3 py-2 text-start">{t("adminReports.col.rank")}</th>
                <th className="px-3 py-2 text-start">{t(`adminReports.col.${party}`)}</th>
                <th className="px-3 py-2 text-start">{t("adminReports.col.number")}</th>
                <th className={`px-3 py-2 text-end ${by === "count" ? "text-gray-900" : ""}`} aria-sort={by === "count" ? "descending" : undefined}>{t("adminReports.col.count")}</th>
                <th className={`px-3 py-2 text-end ${by === "volume" ? "text-gray-900" : ""}`} aria-sort={by === "volume" ? "descending" : undefined}>{t("adminReports.col.volume")}</th>
                <th className="px-3 py-2 text-end">{t("adminReports.col.average")}</th>
                <th className="px-3 py-2 text-start">{t("adminReports.col.share")}</th>
                {isSender && <th className="px-3 py-2 text-end">{t("adminReports.col.commission")}</th>}
                <th className="px-3 py-2 text-start">{t("adminReports.col.last")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) =>
                <tr key={`${row.rank}-${row.label}`} data-testid={`${prefix}-row`}>
                  <td className="px-3 py-2 text-gray-500">{num(row.rank)}</td>
                  <td className="px-3 py-2 font-semibold text-gray-800 whitespace-nowrap">{row.name || <span dir="ltr">{row.number}</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{row.name && row.number ? <span dir="ltr">{row.number}</span> : "—"}</td>
                  <td className="px-3 py-2 text-end">{num(row.count)}</td>
                  <td className="px-3 py-2 text-end font-bold text-gray-900" dir="ltr">{money(row.volume)}</td>
                  <td className="px-3 py-2 text-end" dir="ltr">{money(row.average)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-10 text-xs text-gray-700" dir="ltr">{percent(row.share)}</span>
                      <span className="hidden sm:block h-1.5 w-20 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                        <span className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                      </span>
                    </span>
                  </td>
                  {isSender && <td className="px-3 py-2 text-end text-gray-700" dir="ltr">{money(row.commission)}</td>}
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" dir="ltr">{num(row.last_date || "")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
