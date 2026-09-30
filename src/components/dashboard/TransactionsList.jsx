import { useState, useRef, useEffect } from "react";
import { Search, FileText, Trash2, Pencil, X, Loader2, UserSearch, UserCheck, Percent, ArrowDown, ArrowUp, ArrowUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Lock, LockOpen, AlertTriangle } from "lucide-react";
import BulkEditModal from "@/components/transactions/BulkEditModal";
import SenderReportModal from "@/components/transactions/SenderReportModal";
import AmbiguousRowsModal from "@/components/transactions/AmbiguousRowsModal";
import ReceiverReportModal from "@/components/transactions/ReceiverReportModal";
import { format } from "date-fns";
import { api } from "@/api/apiClient";
import EditTransactionModal from "@/components/transactions/EditTransactionModal";
import DailyCommissionReport from "@/components/transactions/DailyCommissionReport";
import { useAuth } from "@/lib/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { NO_SORT, nextSort, sortTransactions } from "@/lib/transactionSort";
import { usePreferences } from "@/lib/PreferencesContext";
import JournalDatePicker from "./JournalDatePicker";
import { shiftDay } from "@/lib/calendarDays";
import { SEARCH_SCOPES, TABLE_COLUMNS } from "@/lib/preferences";

// ═══ Type column: icon + sorting ═══
// Cash In = green down-arrow, Cash Out = red up-arrow (same arrows as the Cash In / Cash Out buttons).
// The name stays available to screen readers (role="img" + aria-label) and on hover (title).
function TypeIcon({ type }) {
  const isIn = type === "cash_in";
  const label = isIn ? "Cash In" : "Cash Out";
  const Icon = isIn ? ArrowDown : ArrowUp;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-type={isIn ? "cash_in" : "cash_out"}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${isIn ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
      <Icon className="w-4 h-4" strokeWidth={2.75} aria-hidden="true" />
    </span>
  );
}

const txDateOfRow = (t) => t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];

// ═══ Sortable column header ═══
// Clicking cycles: original order → ascending → descending → original (see src/lib/transactionSort.js).
// The tooltip says what the next click does; aria-sort tells screen readers the current state.
function SortHeader({ column, label, sortName, sort, onSort, tooltips, className = "" }) {
  const active = sort.key === column;
  const dir = active ? sort.dir : "none";
  const next = nextSort(sort, column).dir;
  const Icon = dir === "asc" ? ChevronUp : dir === "desc" ? ChevronDown : ArrowUpDown;
  return (
    <th className={`px-1 py-3 ${className}`} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => onSort(column)}
        title={tooltips(next, sortName || label)}
        data-testid={`sort-${column}`}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 whitespace-nowrap font-[inherit] hover:bg-gray-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${active ? "text-blue-700" : ""}`}>
        {label}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? "" : "opacity-40"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

export default function TransactionsList({
  // The rows to show (the day, or all-days search results), in journal order from the server, each
  // with its number in its day (day_position). dayTransactions: every loaded row of the selected
  // day (delete all, the commission report). truncatedTotal: when the server left rows out (the
  // 10,000 rule), how many there are in all.
  transactions,
  dayTransactions = transactions,
  truncatedTotal = null,
  storeId,
  loading,
  search,
  setSearch,
  selectedDate,
  setSelectedDate,
  onToday,
  onCashIn,
  onCashOut,
  onImportPDF,
  onRefresh,
  onDeleteDailyBalanceForDate,
  // Search scope (Dashboard): "all" days, the selected date's "month", or the selected "day";
  // searchingDays = the results come from the server and span days (all days or the month).
  searchScope = "day",
  setSearchScope,
  searchingDays = false,
  onOpenDay,
  // Closed days: closedDay = { date, closed_by, closed_at } when the selected day is closed;
  // closedDates = every closed date (rows from other days in all-days results).
  closedDay = null,
  closedDates = new Set(),
  canCloseDays = false,
  onCloseDay,
  onReopenDay,
  // The Admin's "All stores" view: storeNames maps store id → name (it adds a Store column), and
  // isRowClosed(t) checks each row's own store. Day actions (Cash In / Out, closing the day, delete
  // all) need one store, so they're off in that view; importing asks for the store.
  storeNames = null,
  isRowClosed
}) {
  const allStores = Boolean(storeNames);
  const [deleting, setDeleting] = useState(false);
  const [deleteElapsed, setDeleteElapsed] = useState(0);
  const deleteTimerRef = useRef(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [typedDeleteAll, setTypedDeleteAll] = useState("");
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showSenderReport, setShowSenderReport] = useState(false);
  const [showAmbiguous, setShowAmbiguous] = useState(false);
  const [showReceiverReport, setShowReceiverReport] = useState(false);
  const [showCommissionReport, setShowCommissionReport] = useState(false);

  // Permissions (the API enforces the same rules; this only hides what the user can't do).
  const { can, canEditTransaction } = useAuth();
  // Translation function is `tr` here: `t` is used throughout this file for a transaction.
  const { t: tr, dir, locale, errorText, num } = useI18n();
  // How many rows past imports set aside (the badge on the button). Asked again when the store or the
  // day's rows change (an import reloads them), or after the window's own discard / correct-and-add
  // (ambiguousRefreshKey, bumped from AmbiguousRowsModal's onChanged) — and a failure just shows no badge.
  const [ambiguousCount, setAmbiguousCount] = useState(0);
  const [ambiguousRefreshKey, setAmbiguousRefreshKey] = useState(0);
  const canImport = can(PERMISSIONS.TRANSACTIONS_IMPORT);
  useEffect(() => {
    if (!canImport) return undefined;
    let current = true;
    Promise.resolve()
      .then(() => api.importHistory.ambiguousCount(storeId))
      .then((answer) => { if (current) setAmbiguousCount(Number(answer?.total) || 0); })
      .catch(() => { if (current) setAmbiguousCount(0); });
    return () => { current = false; };
  }, [canImport, storeId, dayTransactions, ambiguousRefreshKey]);

  // ═══ Display preferences (Settings page): visible columns and row density ═══
  const { preferences } = usePreferences();
  const hiddenColumns = new Set(preferences.hiddenColumns);
  const show = Object.fromEntries(TABLE_COLUMNS.map((key) => [key, !hiddenColumns.has(key)]));
  const compact = preferences.density === "compact";

  // ═══ Sorting (display only: selection, bulk actions and "#" keep working from `transactions`) ═══
  // Starts from Settings → Transactions table → Default sort (journal order unless set).
  const [sort, setSort] = useState(() =>
    preferences.defaultSort.key ? { key: preferences.defaultSort.key, dir: preferences.defaultSort.dir } : NO_SORT);
  // Each row's place in its own day's journal (shown in "#": the server's day_position), and in the
  // list (journal order — used to sort by "#", so results from several days sort by day first).
  const journal = new Map();
  const perDay = new Map();
  transactions.forEach((tx, position) => {
    const day = txDateOfRow(tx);
    const counted = perDay.get(day) ?? 0;
    perDay.set(day, counted + 1);
    journal.set(tx.id, { n: tx.day_position ? tx.day_position - 1 : counted, position });
  });
  const activeSort = sort.key && !show[sort.key] ? NO_SORT : sort;
  const rows = sortTransactions(transactions, activeSort, {
    locale,
    indexOf: (t) => journal.get(t.id)?.position ?? transactions.indexOf(t),
  });
  const resultDays = searchingDays ? new Set(transactions.map(txDateOfRow)).size : 0;

  // ═══ Pages (Settings → Transactions table → Rows per page; 0 = all on one page) ═══
  // Back to the first page when the day, search, sort or page size changes — not after an edit or
  // delete, so the user keeps their place. A page past the end (after deletes) shows the last one.
  const pageSize = preferences.rowsPerPage;
  const [page, setPage] = useState(0);
  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = pageSize ? currentPage * pageSize : 0;
  const pageRows = pageSize ? rows.slice(pageStart, pageStart + pageSize) : rows;
  useEffect(() => { setPage(0); }, [selectedDate, search, searchingDays, sort.key, sort.dir, pageSize]);

  // ═══ Closed days ═══
  const isOnClosedDay = (t) => (isRowClosed ? isRowClosed(t) : closedDates.has(txDateOfRow(t)));
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const todayClosed = closedDates.has(todayIso); // Cash In / Cash Out are entered on today's date
  // Why Cash In / Cash Out are off, if they are.
  const cashDisabledHint = allStores ? tr("stores.chooseForDayActions") : todayClosed ? tr("day.todayClosedHint") : undefined;
  const [dayDialog, setDayDialog] = useState(null); // "close" | "reopen" | null
  const [dayWorking, setDayWorking] = useState(false);
  const confirmDayChange = async () => {
    setDayWorking(true);
    try {
      if (dayDialog === "close") await onCloseDay?.(selectedDate);
      else await onReopenDay?.(selectedDate);
    } finally {
      setDayWorking(false);
      setDayDialog(null);
    }
  };
  const onSort = (column) => setSort((prev) => nextSort(prev, column));
  const sortTooltip = (next, column) => (next === "none" ? tr("list.sort.none") : tr(`list.sort.${next}`, { column }));
  const typeTooltip = (next) => (next === "none" ? tr("list.sort.none") : tr(`list.sortType.${next}`));
  const headerProps = { sort: activeSort, onSort, tooltips: sortTooltip };
  const columnLabel = (key) => (key === "index" ? "#" : tr(`columns.${key}`));
  const canDelete = can(PERMISSIONS.TRANSACTIONS_DELETE);

  // ═══ التحديد المتعدد والإجراءات الجماعية ═══
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [typedBulkDelete, setTypedBulkDelete] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const selectAllRef = useRef(null);
  const searchRef = useRef(null);

  // التحديد يشمل فقط العمليات الظاهرة: عند تغيير اليوم أو البحث تُزال المحددة غير الظاهرة،
  // حتى لا يُطبَّق إجراء على عمليات لا يراها المستخدم.
  // With pages, "visible" means the current page.
  const visibleKey = pageRows.map((t) => t.id).join(",");
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(visibleKey ? visibleKey.split(",").map(Number) : []);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleKey]);

  const selectedTransactions = pageRows.filter((t) => selectedIds.has(t.id));
  const allVisibleSelected = pageRows.length > 0 && selectedTransactions.length === pageRows.length;
  const selectionHasClosedDay = selectedTransactions.some(isOnClosedDay);
  const someVisibleSelected = selectedTransactions.length > 0 && !allVisibleSelected;
  // A User may bulk-edit only when every selected row is one they entered.
  const canBulkEdit = selectedTransactions.length > 0 && selectedTransactions.every(canEditTransaction);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(pageRows.map((t) => t.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const txDateOf = (t) => t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];

  // بعد الحذف أو نقل العمليات لتاريخ آخر: احذف رصيد البداية للأيام التي أصبحت فارغة
  const cleanUpEmptyDays = async (dates) => {
    if (!onDeleteDailyBalanceForDate) return;
    for (const date of new Set(dates)) {
      await onDeleteDailyBalanceForDate(date);
    }
  };

  const handleBulkDelete = async () => {
    setShowBulkDeleteConfirm(false);
    setBulkWorking(true);
    setBulkError("");
    try {
      await api.entities.Transaction.bulkDelete(selectedTransactions.map((t) => t.id));
      await cleanUpEmptyDays(selectedTransactions.map(txDateOf));
      notify.success(tr("toast.tx.bulkDeleted", { count: selectedTransactions.length }));
      clearSelection();
      onRefresh();
    } catch (err) {
      setBulkError(err?.message || tr("list.bulkDeleteFailed"));
      notify.error(err?.message ? errorText(err.message) : tr("list.bulkDeleteFailed"));
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkEditSaved = async (changes) => {
    setShowBulkEdit(false);
    notify.success(tr("toast.tx.bulkUpdated", { count: selectedTransactions.length }));
    if (changes.transaction_date) {
      await cleanUpEmptyDays(selectedTransactions.map(txDateOf).filter((d) => d !== changes.transaction_date));
    }
    clearSelection();
    onRefresh();
  };

  // الحذف فوري بعد التأكيد (زر التراجع أُزيل، فلا داعي لتأجيل الحذف)
  const handleDeleteOne = async (transaction) => {
    setConfirmDeleteId(null);
    try {
      await api.entities.Transaction.delete(transaction.id);
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : tr("toast.tx.deleteFailed"));
      return;
    }
    notify.success(tr("toast.tx.deleted"));
    const txDate = transaction.transaction_date || new Date(transaction.created_date).toISOString().split("T")[0];
    if (onDeleteDailyBalanceForDate) {
      await onDeleteDailyBalanceForDate(txDate);
    }
    onRefresh();
  };

  // "Delete all for this day" deletes the whole day, search or not, so the dialog counts exactly
  // these rows (it used to count the rows the search showed; user-reported, 2026-09-29).
  const wholeDay = dayTransactions.filter((t) => txDateOfRow(t) === selectedDate);

  const handleDeleteAll = async () => {
    setDeleting(true);
    setDeleteElapsed(0);
    setShowConfirm(false);
    deleteTimerRef.current = setInterval(() => setDeleteElapsed((prev) => prev + 1), 1000);
    try {
      const dateToDelete = selectedDate;
      const toDelete = wholeDay;
      let failed = 0;
      for (const t of toDelete) {
        try {await api.entities.Transaction.delete(t.id);} catch {failed += 1;}
      }
      if (failed) notify.error(tr("toast.tx.dayDeletePartial", { failed, count: toDelete.length }));
      else notify.success(tr("toast.tx.dayDeleted", { count: toDelete.length, date: dateToDelete }));
      if (onDeleteDailyBalanceForDate) await onDeleteDailyBalanceForDate(dateToDelete);
      onRefresh();
    } finally {
      clearInterval(deleteTimerRef.current);
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow" dir={dir}>
      {/* Search & filters row */}
      <div className="p-4 border-b flex flex-wrap items-center gap-3">
        {/* Search scope first in the row (user's request), then the search box. */}
        {setSearchScope &&
        <div className="flex items-center rounded-lg border bg-gray-50 p-0.5 text-sm" role="group" aria-label={tr("list.scope.label")} data-testid="search-scope">
            {SEARCH_SCOPES.map((scope) =>
          <button
            key={scope}
            type="button"
            onClick={() => setSearchScope(scope)}
            aria-pressed={searchScope === scope}
            data-testid={`search-scope-${scope}`}
            className={`px-3 py-1 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${searchScope === scope ? "bg-white shadow text-blue-700" : "text-gray-600 hover:text-gray-800"}`}>
                {tr(`list.scope.${scope}`)}
              </button>
          )}
          </div>
        }

        <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-gray-50 border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder={tr("list.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && search) { e.preventDefault(); setSearch(""); } }}
            data-testid="search-input"
            className="bg-transparent outline-none w-full text-start text-base font-normal" />
          {/* Clears the search (user's request), and keeps the cursor in the box to type again. */}
          {search &&
          <button
            type="button"
            onClick={() => { setSearch(""); searchRef.current?.focus(); }}
            title={tr("list.clearSearch")}
            aria-label={tr("list.clearSearch")}
            data-testid="clear-search"
            className="shrink-0 rounded-full p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          }
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-[hsl(var(--foreground))]">{tr("list.journal")}:</span>
          {/* One day back / forward without opening the calendar (user's request). The arrows point
              the way the page reads: "previous" is at the start, so it points right in Arabic. */}
          <div className="flex items-center gap-1" role="group" aria-label={tr("list.journal")} data-testid="day-stepper">
            <button type="button" onClick={() => setSelectedDate(shiftDay(selectedDate, -1))}
              title={tr("day.previous")} aria-label={tr("day.previous")} data-testid="previous-day"
              className="flex items-center justify-center w-8 h-8 rounded-lg border hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 text-[hsl(var(--foreground))]">
              <ChevronLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
            </button>
            <JournalDatePicker value={selectedDate} onChange={setSelectedDate} storeId={storeId} closedDates={closedDates} />
            <button type="button" onClick={() => setSelectedDate(shiftDay(selectedDate, 1))}
              title={tr("day.next")} aria-label={tr("day.next")} data-testid="next-day"
              className="flex items-center justify-center w-8 h-8 rounded-lg border hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 text-[hsl(var(--foreground))]">
              <ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>

          <button
            onClick={onToday}
            className="bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg text-sm font-medium transition text-[hsl(var(--popover-foreground))]">
            
            {tr("list.today")}
          </button>
          {canCloseDays && !allStores && (closedDay ?
          <button
            type="button"
            onClick={() => setDayDialog("reopen")}
            data-testid="reopen-day"
            className="flex items-center gap-1 border border-amber-300 text-amber-800 hover:bg-amber-50 px-3 py-1 rounded-lg text-sm font-medium transition">
              <LockOpen className="w-4 h-4" aria-hidden="true" />
              {tr("day.reopen")}
            </button> :
          <button
            type="button"
            onClick={() => setDayDialog("close")}
            data-testid="close-day"
            className="flex items-center gap-1 border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1 rounded-lg text-sm font-medium transition">
              <Lock className="w-4 h-4" aria-hidden="true" />
              {tr("day.close")}
            </button>)
          }
        </div>
      </div>

      {/* The selected day is closed: say so, for everyone. */}
      {closedDay &&
      <div role="status" data-testid="closed-day-banner" className="px-4 py-2 border-b bg-amber-50 text-amber-800 text-sm flex flex-wrap items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="font-bold">{tr("day.closedBanner", { date: num(closedDay.date) })}</span>
          <span>{tr("day.closedBy", { by: closedDay.closed_by, at: num(format(new Date(closedDay.closed_at), "yyyy/MM/dd HH:mm")) })}</span>
        </div>
      }

      {/* Close / reopen confirmation */}
      {dayDialog &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
          <div role="alertdialog" aria-labelledby="day-dialog-title" aria-describedby="day-dialog-body" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className={`rounded-full p-2 ${dayDialog === "close" ? "bg-amber-50" : "bg-blue-50"}`}>
                {dayDialog === "close" ? <Lock className="w-5 h-5 text-amber-700" aria-hidden="true" /> : <LockOpen className="w-5 h-5 text-blue-700" aria-hidden="true" />}
              </div>
              <h3 id="day-dialog-title" className="font-bold text-gray-800 text-lg">
                {tr(dayDialog === "close" ? "day.confirmClose.title" : "day.confirmReopen.title", { date: num(selectedDate) })}
              </h3>
            </div>
            <p id="day-dialog-body" className="text-gray-600 text-sm mb-5">
              {tr(dayDialog === "close" ? "day.confirmClose.body" : "day.confirmReopen.body")}
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDayDialog(null)} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {tr("common.cancel")}
              </button>
              <button
                type="button"
                onClick={confirmDayChange}
                disabled={dayWorking}
                data-testid="confirm-day-change"
                className={`flex-1 flex items-center justify-center gap-2 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50 ${dayDialog === "close" ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"}`}>
                {dayWorking && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {tr(dayDialog === "close" ? "day.close" : "day.reopen")}
              </button>
            </div>
          </div>
        </div>
      }

      {/* Confirm Delete Dialog — typed-count confirmation (user's request, 2026-09-30), like the
          admin panel's delete-by-range and the import history's Clear history. */}
      {showConfirm &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir={dir}>
          <form
            role="alertdialog"
            aria-labelledby="delete-all-title"
            onSubmit={(e) => { e.preventDefault(); if (typedDeleteAll.trim() === String(wholeDay.length) && !deleting) handleDeleteAll(); }}
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 id="delete-all-title" className="font-bold text-gray-800 text-lg">{tr("list.deleteAllTitle")}</h3>
            </div>
            <p className="text-gray-600 mb-1">
              {tr("list.deleteAllBefore")}<span className="font-bold text-red-600" data-testid="delete-all-count">{tr("list.count", { count: wholeDay.length })}</span>{tr("list.deleteAllAfter")}
            </p>
            {/* With a search, say plainly that the rows it hides go too. */}
            {transactions.length !== wholeDay.length &&
              <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-2" data-testid="delete-all-search-note">
                {tr("list.deleteAllSearchNote", { shown: transactions.length, count: wholeDay.length })}
              </p>
            }
            <p className="text-gray-500 text-sm mb-5 bg-gray-50 rounded-lg px-3 py-2">
              {selectedDate}
            </p>
            <p className="text-xs text-red-500 mb-3">⚠️ {tr("common.cannotUndo")}</p>
            <label className="block mb-4 text-sm font-medium text-gray-700">
              {tr("list.typeToConfirm", { count: wholeDay.length })}
              <input
                value={typedDeleteAll}
                onChange={(e) => setTypedDeleteAll(e.target.value)}
                inputMode="numeric"
                autoFocus
                data-testid="delete-all-confirm-input"
                className="mt-1 w-full border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-red-300"
                dir="ltr" />
            </label>
            <div className="flex gap-3">
              <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">

                {tr("common.cancel")}
              </button>
              <button
              type="submit"
              disabled={typedDeleteAll.trim() !== String(wholeDay.length) || deleting}
              data-testid="delete-all-confirm"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">

                {tr("list.deleteAll")}
              </button>
            </div>
          </form>
        </div>
      }

      {searchingDays &&
      <div className="px-4 py-2 border-b bg-blue-50 text-sm text-blue-800 flex flex-wrap items-center gap-x-2" role="status" data-testid="all-days-results">
          <span className="font-bold">{tr("list.allDaysResults", { count: transactions.length, days: resultDays })}</span>
          {transactions.length > 0 && <span className="text-blue-700">{tr("list.allDaysHint")}</span>}
        </div>
      }

      {/* The 10,000 rule: the server sent the first 10,000 rows of more. */}
      {truncatedTotal != null &&
      <p role="status" data-testid="list-truncated" className="px-4 py-2 border-b bg-amber-50 text-amber-800 text-sm">
          {tr("list.truncated", { shown: num(transactions.length), total: num(truncatedTotal) })}
        </p>
      }

      {/* Actions row */}
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
        <span className="text-[hsl(var(--foreground))] font-bold text-base text-start">{tr("list.count", { count: transactions.length })}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSenderReport(true)}
            className="flex items-center gap-1 border border-blue-200 rounded-lg px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 transition">
            
            <UserSearch className="w-4 h-4" />
            {tr("list.senderReport")}
          </button>
          <button
            onClick={() => setShowReceiverReport(true)}
            className="flex items-center gap-1 border border-green-200 rounded-lg px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 transition">

            <UserCheck className="w-4 h-4" />
            {tr("list.receiverReport")}
          </button>
          <button
            onClick={() => setShowCommissionReport(true)}
            className="flex items-center gap-1 border border-orange-200 rounded-lg px-3 py-1.5 text-sm text-orange-600 hover:bg-orange-50 transition">
            
            <Percent className="w-4 h-4" />
            {tr("list.commissionReport")}
          </button>
          {canDelete && transactions.length > 0 && !searchingDays && !closedDay && !allStores &&
          <button
            onClick={() => { setTypedDeleteAll(""); setShowConfirm(true); }}
            disabled={deleting}
            className="flex items-center gap-1 border border-red-200 rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition disabled:opacity-50">
            
              <Trash2 className="w-4 h-4" />
              {tr("list.deleteAll")}
            </button>
          }
          <button
            onClick={onImportPDF}
            className="flex items-center gap-1 border rounded-lg px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 transition">
            
            <FileText className="w-4 h-4" />
            {tr("list.import")}
          </button>
          {/* Statement rows past imports set aside as ambiguous (user's request): review them here. */}
          {canImport &&
          <button
            type="button"
            onClick={() => setShowAmbiguous(true)}
            data-testid="ambiguous-button"
            aria-label={ambiguousCount ? tr("ambiguous.buttonWithCount", { count: ambiguousCount }) : undefined}
            className="relative flex items-center gap-1 border border-amber-300 rounded-lg px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 transition">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              {tr("ambiguous.button")}
              {/* The count (user's request), on the button's top corner; none when there are none. */}
              {ambiguousCount > 0 &&
              <span aria-hidden="true" data-testid="ambiguous-badge"
                className="absolute -top-2 -end-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center shadow">
                  {ambiguousCount > 99 ? "99+" : num(ambiguousCount)}
                </span>
              }
            </button>
          }
          <button
            onClick={onCashOut}
            disabled={todayClosed || allStores}
            title={cashDisabledHint}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed">
            
            Cash Out
            <span className="bg-red-700 rounded-full p-0.5">↑</span>
          </button>
          <button
            onClick={onCashIn}
            disabled={todayClosed || allStores}
            title={cashDisabledHint}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed">
            
            Cash In
            <span className="bg-green-700 rounded-full p-0.5">↓</span>
          </button>
        </div>
      </div>

      {/* Bulk actions bar — shown while transactions are selected */}
      {selectedTransactions.length > 0 &&
      <div
        role="region"
        aria-label={tr("list.bulkRegion")}
        className="px-4 py-2.5 border-b bg-blue-50 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-blue-800" data-testid="bulk-selected-count">
            {tr("list.selectedCount", { count: selectedTransactions.length })}
            <span className="font-normal text-blue-700 ms-2" dir="ltr">
              (${num(selectedTransactions.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))})
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {selectionHasClosedDay &&
            <span className="text-xs text-amber-800 flex items-center gap-1" data-testid="bulk-closed-hint"><Lock className="w-3.5 h-3.5" aria-hidden="true" />{tr("day.selectionClosed")}</span>
            }
            {canBulkEdit &&
            <button
            onClick={() => setShowBulkEdit(true)}
            disabled={bulkWorking || selectionHasClosedDay}
            className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 transition disabled:opacity-50">
              <Pencil className="w-4 h-4" />
              {tr("list.bulkEdit")}
            </button>
            }
            {canDelete &&
            <button
            onClick={() => { setTypedBulkDelete(""); setShowBulkDeleteConfirm(true); }}
            disabled={bulkWorking || selectionHasClosedDay}
            className="flex items-center gap-1 bg-white border border-red-200 rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition disabled:opacity-50">
              {bulkWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {tr("list.bulkDelete")}
            </button>
            }
            {!canBulkEdit && !canDelete &&
            <span className="text-xs text-blue-700">{tr("list.ownOnly")}</span>
            }
            <button
            onClick={clearSelection}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-white transition">
              <X className="w-4 h-4" />
              {tr("list.clearSelection")}
            </button>
          </div>
          {bulkError && <p className="w-full text-sm text-red-600">{bulkError}</p>}
        </div>
      }

      {/* Bulk delete confirmation — typed-count confirmation (user's request, 2026-09-30), like the
          admin panel's delete-by-range and the import history's Clear history. */}
      {showBulkDeleteConfirm &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir={dir}>
          <form
            role="alertdialog"
            aria-label={tr("list.bulkDeleteDialog")}
            onSubmit={(e) => { e.preventDefault(); if (typedBulkDelete.trim() === String(selectedTransactions.length) && !bulkWorking) handleBulkDelete(); }}
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="font-bold text-gray-800 text-lg">{tr("list.bulkDeleteTitle")}</h3>
            </div>
            <p className="text-gray-600 mb-1">
              {tr("list.bulkDeleteBefore")}<span className="font-bold text-red-600">{tr("list.count", { count: selectedTransactions.length })}</span>{tr("list.bulkDeleteAfter")}
            </p>
            <p className="text-xs text-red-500 mb-3">⚠️ {tr("common.cannotUndo")}</p>
            <label className="block mb-4 text-sm font-medium text-gray-700">
              {tr("list.typeToConfirm", { count: selectedTransactions.length })}
              <input
                value={typedBulkDelete}
                onChange={(e) => setTypedBulkDelete(e.target.value)}
                inputMode="numeric"
                autoFocus
                data-testid="bulk-delete-confirm-input"
                className="mt-1 w-full border rounded-lg px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-red-300"
                dir="ltr" />
            </label>
            <div className="flex gap-3">
              <button
              type="button"
              onClick={() => setShowBulkDeleteConfirm(false)}
              className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {tr("common.cancel")}
              </button>
              <button
              type="submit"
              disabled={typedBulkDelete.trim() !== String(selectedTransactions.length) || bulkWorking}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold transition disabled:opacity-50">
                {tr("list.bulkDeleteConfirm", { count: selectedTransactions.length })}
              </button>
            </div>
          </form>
        </div>
      }

      {/* Table / Empty */}
      {loading ?
      <div className="p-12 text-center text-gray-400">{tr("common.loading")}</div> :
      transactions.length === 0 ?
      <div className="p-12 text-center">
          <p className="text-gray-500 text-lg font-medium">{searchingDays ? tr(searchScope === "month" ? "list.emptyMonth" : "list.emptyAllDays") : tr("list.empty")}</p>
          <p className="text-gray-400 text-sm mt-1">{searchingDays ? tr("list.emptyAllDaysHint") : tr("list.emptyHint")}</p>
        </div> :

      <>
        {/* Sticky header (user's request): the table scrolls inside this box, at most one screen tall
            below the app header, and the column names stay at its top. The box has to be the scroller:
            it already scrolls sideways on phones, and a sticky element can't stick to the page from
            inside a scrolling box. */}
        <div className="overflow-auto max-h-[calc(100vh_-_var(--app-header-height,0px)_-_1rem)]" data-testid="table-scroll">
          <table
            className={`w-full text-sm text-start ${compact ? "[&_td]:!py-1.5 [&_th]:!py-1.5" : ""}`}
            data-density={preferences.density}>
            <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-sm" data-testid="table-head">
              <tr>
                <th className="ps-4 pe-1 py-3 w-8">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label={tr("list.selectAll")}
                    className="w-4 h-4 accent-blue-600 cursor-pointer align-middle" />
                </th>
                {TABLE_COLUMNS.filter((key) => show[key]).map((key) =>
                  <SortHeader
                    key={key}
                    column={key}
                    label={columnLabel(key)}
                    sortName={key === "index" ? tr("columns.number") : undefined}
                    {...headerProps}
                    tooltips={key === "type" ? typeTooltip : sortTooltip} />
                )}
                {allStores && <th className="px-3 py-3 text-start font-semibold whitespace-nowrap" data-testid="store-column">{tr("stores.column")}</th>}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((t, i) => {
                // The row's real number in its day's journal, whatever order the table is sorted in.
                const realIndex = journal.get(t.id)?.n ?? -1;
                const displayIndex = realIndex >= 0 ? realIndex + 1 : pageStart + i + 1;
                const rowClosed = isOnClosedDay(t);
                return (
                  <tr key={t.id} className={`transition ${selectedIds.has(t.id) ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-gray-50"}`} aria-selected={selectedIds.has(t.id)}>
                  <td className="ps-4 pe-1 py-3">
                    <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelected(t.id)}
                          // Rows from another day (all-days search) say which day, so labels stay unique.
                          aria-label={txDateOfRow(t) === selectedDate ?
                            tr("list.selectRow", { n: displayIndex }) :
                            tr("list.selectRowOnDay", { n: displayIndex, date: txDateOfRow(t) })}
                          className="w-4 h-4 accent-blue-600 cursor-pointer align-middle" />
                  </td>
                  {show.index &&
                    <td className="px-4 py-3 text-gray-400">{num(displayIndex)}</td>
                  }
                  {show.type &&
                    <td className="px-4 py-3">
                      <TypeIcon type={t.type} />
                    </td>
                  }
                  {show.sender &&
                    <td className="px-4 py-3 font-medium">{t.sender_name || "-"}</td>
                  }
                  {show.receiver &&
                    <td className="px-4 py-3 font-medium">
                      {(() => {
                            const isPhone = (v) => /^\+?\d{7,}$/.test((v || "").trim());
                            const normalize = (v) => (v || "").replace(/\D/g, "").slice(-8); // آخر 8 أرقام للمقارنة
                            const rName = t.receiver_name && t.receiver_name !== "null" ? t.receiver_name.trim() : "";
                            const cNum = t.customer_number && t.customer_number !== "null" ? t.customer_number.trim() : "";
                            const rIsPhone = isPhone(rName);
                            const cIsPhone = isPhone(cNum);
                            // إذا كلاهما رقم هاتف أو متطابقان جزئياً، اعرض واحداً فقط
                            const areSimilar = rIsPhone && cIsPhone && normalize(rName) === normalize(cNum);
                            if (rIsPhone && cNum) {
                              // receiver هو رقم، اعرض customer_number فقط
                              return <div className="text-gray-700">{cNum}</div>;
                            }
                            if (cIsPhone && rName && areSimilar) {
                              // نفس الرقم في كليهما، اعرض مرة واحدة
                              return <div className="text-gray-700">{cNum}</div>;
                            }
                            return (
                              <>
                            {rName && !rIsPhone && <div>{rName}</div>}
                            {cNum && !cIsPhone && <div className="text-gray-700">{cNum}</div>}
                            {cNum && cIsPhone && !rName && <div className="text-[hsl(var(--foreground))]">{cNum}</div>}
                          </>);
  
                          })()}
                    </td>
                  }
                  {show.amount &&
                    <td className="px-4 py-3 font-bold text-gray-800">${num((t.amount || 0).toFixed(2))}</td>
                  }
                  {show.commissionRate &&
                    <td className="px-4 py-3 font-bold text-blue-600">
                      {t.amount > 0 ? num((t.commission / t.amount * 100).toFixed(2)) + "%" : "-"}
                    </td>
                  }
                  {show.commission &&
                    <td className={`px-4 py-3 font-bold ${t.type === "cash_out" ? "text-red-700" : "text-green-700"}`}>${num((t.commission || 0).toFixed(3))}</td>
                  }
                  {show.reference &&
                    <td className="px-4 py-3 text-gray-700 text-xs font-bold">{t.reference_number || "-"}</td>
                  }
                  {show.service &&
                    <td className="px-4 py-3">
                      {t.service ?
                          <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-blue-200 whitespace-nowrap">
                          {t.service}
                        </span> :
                          "-"}
                    </td>
                  }
                  {show.note &&
                    <td className="text-black-500 py-3 px-1">{t.note || "-"}</td>
                  }
                  {show.date &&
                    <td className="px-4 py-3 text-xs opacity-100 text-black-400 whitespace-nowrap">
                      {searchingDays && onOpenDay ?
                          <button
                            type="button"
                            onClick={() => onOpenDay(txDateOfRow(t))}
                            title={tr("list.openDay")}
                            className="text-blue-700 underline underline-offset-2 hover:text-blue-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                            {num(t.transaction_date || format(new Date(t.created_date), "yyyy/MM/dd HH:mm"))}
                          </button> :
                        num(t.transaction_date ?
                          t.transaction_date :
                          format(new Date(t.created_date), "yyyy/MM/dd HH:mm"))}
                    </td>
                  }
                  {allStores && <td className="px-3 py-3 text-gray-700 whitespace-nowrap" data-testid="row-store">{storeNames.get(t.store_id) || "—"}</td>}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {rowClosed && (canEditTransaction(t) || canDelete) &&
                      <span title={tr("day.rowClosed")} aria-label={tr("day.rowClosed")} role="img" data-testid="row-closed">
                          <Lock className="w-4 h-4 text-amber-700" aria-hidden="true" />
                        </span>
                      }
                      {!rowClosed && canEditTransaction(t) &&
                      <button
                            onClick={() => setEditingTransaction(t)}
                            className="text-gray-400 hover:text-blue-500 transition"
                            title={tr("common.edit")}>
                            
                        <Pencil className="w-4 h-4 text-[hsl(var(--sidebar-ring))]" />
                      </button>
                      }
                      {!canDelete || rowClosed ? null : confirmDeleteId === t.id ?
                          <div className="flex items-center gap-1">
                          <button
                              onClick={() => handleDeleteOne(t)}
                              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded font-semibold transition">
                              
                            {tr("common.confirm")}
                          </button>
                          <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-gray-400 hover:text-gray-600">
                              
                            <X className="w-3 h-3" />
                          </button>
                        </div> :

                          <button
                            onClick={() => setConfirmDeleteId(t.id)}
                            className="text-gray-400 hover:text-red-500 transition"
                            title={tr("common.delete")}>
                            
                          <Trash2 className="w-4 h-4 text-[hsl(var(--destructive))]" />
                        </button>
                          }
                    </div>
                  </td>
                </tr>);

              })}
            </tbody>
          </table>
        </div>
        {pageSize > 0 && rows.length > pageSize &&
        <nav className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600" aria-label={tr("list.page.label")} data-testid="pager">
            <span data-testid="pager-range">{tr("list.page.range", { from: pageStart + 1, to: pageStart + pageRows.length, total: rows.length })}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage === 0}
                className="border rounded-lg px-3 py-1 hover:bg-gray-50 transition disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                {tr("list.page.prev")}
              </button>
              <span aria-live="polite">{tr("list.page.of", { page: currentPage + 1, pages: pageCount })}</span>
              <button
                type="button"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= pageCount - 1}
                className="border rounded-lg px-3 py-1 hover:bg-gray-50 transition disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                {tr("list.page.next")}
              </button>
            </div>
          </nav>
        }
        </>
      }


      {/* شريط تقدم المسح */}
      {deleting &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir={dir}>
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
            <Loader2 className="w-10 h-10 text-red-500 animate-spin mx-auto mb-4" />
            <p className="font-bold text-gray-800 text-lg mb-1">{tr("list.deleting")}</p>
            <p className="text-gray-500 text-sm mb-5">{tr("list.pleaseWait")}</p>
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{tr("common.elapsed", { seconds: deleteElapsed })}</span>
                <span>{tr("list.count", { count: transactions.length })}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                className="h-3 rounded-full bg-red-500 transition-all duration-1000"
                style={{ width: `${Math.min(deleteElapsed / Math.max(transactions.length * 0.3, 5) * 100, 90)}%` }} />
              
              </div>
            </div>
          </div>
        </div>
      }

      {editingTransaction &&
      <EditTransactionModal
        transaction={editingTransaction}
        onClose={() => setEditingTransaction(null)}
        onSaved={() => {setEditingTransaction(null);onRefresh();}} />

      }
      {showAmbiguous &&
      <AmbiguousRowsModal
        storeId={storeId}
        withStore={allStores}
        onClose={() => setShowAmbiguous(false)}
        // A discard changes only the badge; a correction adds a real transaction, which may belong
        // to the day currently shown, so the table is refreshed too (like every other change here).
        onChanged={({ createdTransaction } = {}) => {
          setAmbiguousRefreshKey((k) => k + 1);
          if (createdTransaction) onRefresh();
        }} />
      }
      {showSenderReport &&
      <SenderReportModal
        storeId={storeId}
        onClose={() => setShowSenderReport(false)} />

      }
      {showBulkEdit &&
      <BulkEditModal
        transactions={selectedTransactions}
        onClose={() => setShowBulkEdit(false)}
        onSaved={handleBulkEditSaved} />

      }
      {showReceiverReport &&
      <ReceiverReportModal
        storeId={storeId}
        onClose={() => setShowReceiverReport(false)} />

      }
      {showCommissionReport &&
      <DailyCommissionReport
        transactions={dayTransactions}
        selectedDate={selectedDate}
        onClose={() => setShowCommissionReport(false)} />

      }
    </div>);

}