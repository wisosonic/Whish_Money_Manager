import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, FileSpreadsheet, FileText, History, Loader2, Trash2 } from "lucide-react";
import { api } from "@/api/apiClient";
import Header, { formatLastLogin } from "@/components/layout/Header";
import StorePicker from "@/components/stores/StorePicker";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { PERMISSIONS } from "@/lib/permissions";
import { usePreferences } from "@/lib/PreferencesContext";
import { useStoreList } from "@/lib/useStores";

// Import history (user's request, 2026-09-28): every saved statement import, newest first — when,
// the file, the days it covered, the store, how many rows were added (and replaced), and who.
// The server decides what each user sees: the Admin every store (or the one picked here), a Manager
// their store, a User their own imports.
//
// Clearing it (user's request, 2026-09-30; data:purge, like the admin panel's other destructive
// actions — a User never sees the button): a typed-count confirmation, the same pattern as the admin
// panel's delete-by-range. It only ever removes the *log*, but `ambiguous_rows` cascades from
// `import_history`, so any row still waiting for review under a cleared import is discarded with it —
// the confirmation dialog says so and shows how many, fetched alongside the list.
export default function ImportHistoryPage() {
  const { t, dir, num, errorText } = useI18n();
  const { can } = useAuth();
  const hour24 = usePreferences().preferences.clock === "24h";
  const { stores, multiStore } = useStoreList();
  const [storeId, setStoreId] = useState("all");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const canClear = can(PERMISSIONS.DATA_PURGE);
  const [ambiguousCount, setAmbiguousCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");

  const seesAll = can(PERMISSIONS.STORES_ALL);
  const seesOthers = can(PERMISSIONS.IMPORTS_READ_ANY);
  const showStore = multiStore && storeId === "all";
  const scope = seesAll ? "all" : seesOthers ? "store" : "own";
  const scopedStoreId = multiStore && storeId !== "all" ? storeId : undefined;

  useEffect(() => {
    let current = true;
    setError("");
    Promise.resolve()
      .then(() => api.importHistory.list(scopedStoreId))
      .then((answer) => { if (current) setResult(answer); })
      .catch((err) => { if (current) setError(err?.message ? errorText(err.message) : t("imports.loadFailed")); });
    return () => { current = false; };
  }, [storeId, multiStore, refreshKey]);

  // Only fetched for someone who could actually clear the log — a plain User never sends this request.
  useEffect(() => {
    if (!canClear) return undefined;
    let current = true;
    api.importHistory.ambiguousCount(scopedStoreId)
      .then((answer) => { if (current) setAmbiguousCount(answer.total); })
      .catch(() => { if (current) setAmbiguousCount(0); });
    return () => { current = false; };
  }, [storeId, multiStore, canClear, refreshKey]);

  const imports = result?.imports ?? [];
  const period = (row) => {
    if (!row.period_from) return "-";
    return row.period_from === row.period_to ? num(row.period_from) : `${num(row.period_from)} → ${num(row.period_to)}`;
  };

  const openConfirm = () => {
    setTyped("");
    setClearError("");
    setConfirmOpen(true);
  };

  const handleClear = async () => {
    setClearing(true);
    setClearError("");
    try {
      const cleared = await api.importHistory.clear(scopedStoreId, result.total);
      setConfirmOpen(false);
      notify.success(
        t("imports.cleared", { count: cleared.cleared }) +
          (cleared.discarded_ambiguous > 0 ? t("imports.clearedAmbiguousNote", { count: cleared.discarded_ambiguous }) : ""),
        { duration: 10000 }
      );
    } catch (err) {
      // 409: the log changed since it was last shown — show the fresh count before anything is cleared.
      const message = err?.message ? errorText(err.message) : t("imports.clearFailed");
      setClearError(message);
      if (err?.status === 409) notify.warning(message); else notify.error(message);
    } finally {
      setClearing(false);
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <div className="p-2 md:p-4 max-w-6xl mx-auto">
        <div className="bg-white rounded-xl shadow">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
            <div>
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" aria-hidden="true" />
                {t("imports.title")}
              </h2>
              <p className="text-sm text-gray-500" data-testid="imports-scope">{t(`imports.scope.${scope}`)}</p>
            </div>
            <div className="flex items-center gap-2">
              {multiStore &&
                <StorePicker stores={stores} value={storeId} onChange={setStoreId} allowAll testId="imports-store" />
              }
              {canClear &&
                <button type="button" onClick={openConfirm} disabled={!result || imports.length === 0}
                  data-testid="clear-history"
                  className="flex items-center gap-2 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  {t("imports.clear.button")}
                </button>
              }
            </div>
          </div>

          {error && <p role="alert" className="m-4 flex items-center gap-2 text-sm text-red-700"><AlertCircle className="w-4 h-4" aria-hidden="true" />{error}</p>}

          {!result && !error &&
            <p role="status" className="p-8 flex items-center justify-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("common.loading")}</p>
          }

          {result && imports.length === 0 &&
            <div className="p-10 text-center" data-testid="imports-empty">
              <p className="text-gray-600 font-medium">{t("imports.empty")}</p>
              <p className="text-gray-400 text-sm mt-1">{t("imports.emptyHint")}</p>
            </div>
          }

          {result && imports.length > 0 && <>
            <p className="px-4 pt-3 text-sm text-gray-500" data-testid="imports-count">{t("imports.count", { count: result.total })}</p>
            {result.truncated &&
              <p role="status" className="mx-4 mt-2 rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2" data-testid="imports-truncated">
                {t("imports.truncated", { shown: imports.length, total: result.total })}
              </p>
            }
            <div className="overflow-x-auto">
              {/* A minimum width: on a phone the table scrolls sideways instead of squeezing the file name
                  into one letter per line (seen in Edge). */}
              <table className="w-full min-w-[48rem] text-sm text-start" data-testid="imports-table">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">{t("imports.col.when")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("imports.col.file")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("imports.col.period")}</th>
                    {showStore && <th className="px-4 py-3 text-start font-semibold">{t("stores.column")}</th>}
                    <th className="px-4 py-3 text-start font-semibold">{t("imports.col.rows")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("imports.col.by")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {imports.map((row) => {
                    const Icon = row.source === "pdf" ? FileText : FileSpreadsheet;
                    return (
                      <tr key={row.id} data-testid={`import-row-${row.id}`}>
                        <td className="px-4 py-3 whitespace-nowrap"><span dir="ltr">{num(formatLastLogin(row.imported_at, { hour24 }))}</span></td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 min-w-0">
                            <Icon className="w-4 h-4 shrink-0 text-gray-500" aria-hidden="true" />
                            <span className="break-words min-w-0" dir="ltr">{row.file_name || t("imports.noFileName")}</span>
                            {row.source && <span className="text-[10px] font-bold uppercase rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{row.source}</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><span dir="ltr">{period(row)}</span></td>
                        {showStore && <td className="px-4 py-3" data-testid="import-store">{row.store_name ?? t("imports.deletedStore")}</td>}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {t("imports.rows", { count: row.row_count })}
                          {row.replaced_count > 0 && <span className="block text-xs text-amber-700">{t("imports.replaced", { count: row.replaced_count })}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="block font-medium">{row.imported_by_name || row.imported_by}</span>
                          {row.imported_by_name && <span className="block text-xs text-gray-500" dir="ltr">{row.imported_by}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>}
        </div>
      </div>

      {confirmOpen &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
          <form
            role="alertdialog"
            aria-labelledby="clear-history-title"
            aria-describedby="clear-history-details"
            onSubmit={(e) => { e.preventDefault(); if (typed.trim() === String(result.total) && !clearing) handleClear(); }}
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2"><AlertTriangle className="w-5 h-5 text-red-600" aria-hidden="true" /></div>
              <h3 id="clear-history-title" className="font-bold text-gray-800 text-lg">{t("imports.clear.title")}</h3>
            </div>
            <div id="clear-history-details" className="space-y-2 text-sm text-gray-700">
              <p>{t("imports.clear.body", { count: result.total })}</p>
              {ambiguousCount > 0 &&
                <p className="text-amber-700" data-testid="clear-history-ambiguous-warning">{t("imports.clear.ambiguousWarning", { count: ambiguousCount })}</p>
              }
              <p className="text-red-600">⚠️ {t("common.cannotUndo")}</p>
            </div>
            <label className="block mt-4 text-sm font-medium text-gray-700">
              {t("imports.clear.typeToConfirm", { count: result.total })}
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                inputMode="numeric"
                autoFocus
                data-testid="clear-history-confirm-input"
                className="mt-1 w-full border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-red-300"
                dir="ltr" />
            </label>
            {clearError && <p className="mt-2 text-sm text-red-600" role="alert">{clearError}</p>}
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={typed.trim() !== String(result.total) || clearing} data-testid="clear-history-confirm"
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">
                {clearing && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {t("imports.clear.confirmButton")}
              </button>
            </div>
          </form>
        </div>
      }
    </div>
  );
}
