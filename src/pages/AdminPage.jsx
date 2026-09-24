import { useEffect, useState } from "react";
import { format, startOfMonth, startOfYear, subMonths, endOfMonth } from "date-fns";
import { CalendarRange, Download, Trash2, Loader2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import Header from "@/components/layout/Header";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { PERMISSIONS } from "@/lib/permissions";
import { saveBlob } from "@/lib/download";

// Admin panel (Admin + Manager): pick a date range, see what it holds, download it as CSV, or
// delete it. Deleting needs a typed confirmation of the exact number of transactions shown, and the
// server refuses if the data changed in between (see server/admin.js).
const ymd = (date) => format(date, "yyyy-MM-dd");
const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Card({ id, icon: Icon, title, description, tone = "blue", children }) {
  const tones = { blue: "bg-blue-50 text-blue-700", red: "bg-red-50 text-red-600" };
  return (
    <section className="bg-white rounded-xl shadow p-4 md:p-6 min-w-0" aria-labelledby={id} data-testid={id}>
      <div className="flex items-start gap-3 mb-4">
        <div className={`${tones[tone]} rounded-lg p-2 shrink-0`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-gray-800 text-lg" id={id}>{title}</h2>
          {description && <p className="text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function AdminPage() {
  const { t, dir, errorText } = useI18n();
  const { can } = useAuth();
  const canPurge = can(PERMISSIONS.DATA_PURGE);

  const today = new Date();
  const [from, setFrom] = useState(ymd(startOfMonth(today)));
  const [to, setTo] = useState(ymd(today));
  const rangeValid = Boolean(from && to && from <= to);

  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [downloading, setDownloading] = useState(null); // "transactions" | "balances" | null
  const [notice, setNotice] = useState(null); // { tone: "ok" | "error", text }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // The preview follows the range. A stale answer (the range changed meanwhile) is ignored.
  useEffect(() => {
    if (!rangeValid) {
      setSummary(null);
      return undefined;
    }
    let current = true;
    setLoadingSummary(true);
    setSummaryError("");
    base44.admin.summary(from, to)
      .then((result) => { if (current) setSummary(result); })
      .catch((err) => { if (current) { setSummary(null); setSummaryError(errorText(err?.message || "")); } })
      .finally(() => { if (current) setLoadingSummary(false); });
    return () => { current = false; };
    // errorText only changes with the language; re-fetching for that isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, rangeValid, refreshKey]);

  const setRange = (start, end) => {
    setFrom(start);
    setTo(end);
    setNotice(null);
  };

  const quickRanges = [
    { key: "thisMonth", apply: () => setRange(ymd(startOfMonth(today)), ymd(today)) },
    { key: "lastMonth", apply: () => { const last = subMonths(today, 1); setRange(ymd(startOfMonth(last)), ymd(endOfMonth(last))); } },
    { key: "thisYear", apply: () => setRange(ymd(startOfYear(today)), ymd(today)) },
    {
      key: "allData",
      apply: async () => {
        const { first_date: first, last_date: last } = await base44.admin.range();
        if (first && last) setRange(first, last);
      },
    },
  ];

  const download = async (kind) => {
    setDownloading(kind);
    setNotice(null);
    try {
      const { blob, filename } = await base44.admin.exportCsv(kind, from, to);
      saveBlob(blob, filename);
      setNotice({ tone: "ok", text: t("admin.downloaded", { file: filename }) });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err?.message || "") || t("admin.downloadFailed") });
    } finally {
      setDownloading(null);
    }
  };

  const txCount = summary?.transactions ?? 0;
  const balanceCount = summary?.opening_balances ?? 0;
  const nothingToDelete = !summary || txCount + balanceCount === 0;

  const openConfirm = () => {
    setTyped("");
    setDeleteError("");
    setConfirmOpen(true);
  };

  const purge = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await base44.admin.purge(from, to, txCount);
      setConfirmOpen(false);
      setNotice({
        tone: "ok",
        text: t("admin.deleted", { transactions: result.deleted_transactions, balances: result.deleted_opening_balances, from, to }),
      });
    } catch (err) {
      // 409: the data changed since the preview — show the fresh counts before anything is deleted.
      setDeleteError(errorText(err?.message || "") || t("admin.deleteFailed"));
    } finally {
      setDeleting(false);
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <main className="p-3 md:p-6 max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("admin.title")}</h1>
          <p className="text-sm text-gray-500">{t("admin.subtitle")}</p>
        </div>

        {notice &&
          <div
            role="status"
            data-testid="admin-notice"
            className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${notice.tone === "ok" ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"}`}>
            {notice.tone === "ok" ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
            <span className="flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label={t("common.close")} className="text-current opacity-70 hover:opacity-100">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        }

        <Card id="admin-range" icon={CalendarRange} title={t("admin.range.title")} description={t("admin.range.description")}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              {t("admin.range.from")}
              <input type="date" value={from} max={to || undefined} onChange={(e) => setRange(e.target.value, to)}
                className="border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-300" data-testid="range-from" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              {t("admin.range.to")}
              <input type="date" value={to} min={from || undefined} onChange={(e) => setRange(from, e.target.value)}
                className="border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-300" data-testid="range-to" />
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("admin.range.quick")}>
              {quickRanges.map(({ key, apply }) =>
                <button key={key} type="button" onClick={apply} data-testid={`range-${key}`}
                  className="px-3 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  {t(`admin.range.${key}`)}
                </button>
              )}
            </div>
          </div>

          {/* What the range holds — the preview for both the backup and the delete. */}
          <div className="mt-4 rounded-lg bg-gray-50 border px-4 py-3 text-sm" aria-live="polite" data-testid="range-summary">
            {!rangeValid ?
              <span className="text-red-600">{t("admin.range.invalid")}</span> :
            summaryError ?
              <span className="text-red-600">{summaryError}</span> :
            loadingSummary && !summary ?
              <span className="text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("common.loading")}</span> :
            summary &&
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span className="font-bold text-gray-800">{t("admin.summary.transactions", { count: txCount, days: summary.days })}</span>
                <span className="text-gray-700">{t("admin.summary.balances", { count: balanceCount })}</span>
                <span className="text-green-700" dir="ltr">{t("admin.summary.in")} {money(summary.total_in)}</span>
                <span className="text-red-700" dir="ltr">{t("admin.summary.out")} {money(summary.total_out)}</span>
                <span className="text-orange-600" dir="ltr">{t("admin.summary.commission")} {money(summary.total_commission)}</span>
              </div>
            }
          </div>
        </Card>

        <Card id="admin-backup" icon={Download} title={t("admin.backup.title")} description={t("admin.backup.description")}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download("transactions")} disabled={!rangeValid || !txCount || downloading !== null}
              data-testid="download-transactions"
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
              {downloading === "transactions" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
              {t("admin.backup.transactions", { count: txCount })}
            </button>
            <button type="button" onClick={() => download("balances")} disabled={!rangeValid || !balanceCount || downloading !== null}
              data-testid="download-balances"
              className="flex items-center gap-2 border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
              {downloading === "balances" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
              {t("admin.backup.balances", { count: balanceCount })}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-3">{t("admin.backup.format")}</p>
        </Card>

        {canPurge &&
          <Card id="admin-delete" icon={Trash2} tone="red" title={t("admin.delete.title")} description={t("admin.delete.description")}>
            <button type="button" onClick={openConfirm} disabled={!rangeValid || nothingToDelete || loadingSummary}
              data-testid="delete-range"
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              {t("admin.delete.button", { count: txCount })}
            </button>
          </Card>
        }
      </main>

      {confirmOpen &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
          <form
            role="alertdialog"
            aria-labelledby="purge-title"
            aria-describedby="purge-details"
            onSubmit={(e) => { e.preventDefault(); if (typed.trim() === String(txCount) && !deleting) purge(); }}
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2"><AlertTriangle className="w-5 h-5 text-red-600" aria-hidden="true" /></div>
              <h3 id="purge-title" className="font-bold text-gray-800 text-lg">{t("admin.confirm.title")}</h3>
            </div>
            <div id="purge-details" className="space-y-2 text-sm text-gray-700">
              <p>{t("admin.confirm.body", { transactions: txCount, balances: balanceCount })}</p>
              <p className="font-bold" dir="ltr">{from} → {to}</p>
              <p className="text-red-600">⚠️ {t("common.cannotUndo")}</p>
            </div>
            <button type="button" onClick={() => download("transactions")} disabled={!txCount || downloading !== null}
              className="mt-3 flex items-center gap-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1 transition disabled:opacity-50">
              <Download className="w-4 h-4" aria-hidden="true" />
              {t("admin.confirm.backupFirst")}
            </button>
            <label className="block mt-4 text-sm font-medium text-gray-700">
              {t("admin.confirm.typeToConfirm", { count: txCount })}
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                inputMode="numeric"
                autoFocus
                data-testid="purge-confirm-input"
                className="mt-1 w-full border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-red-300"
                dir="ltr" />
            </label>
            {deleteError && <p className="mt-2 text-sm text-red-600" role="alert">{deleteError}</p>}
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={typed.trim() !== String(txCount) || deleting} data-testid="purge-confirm"
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">
                {deleting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {t("admin.confirm.delete")}
              </button>
            </div>
          </form>
        </div>
      }
    </div>
  );
}
