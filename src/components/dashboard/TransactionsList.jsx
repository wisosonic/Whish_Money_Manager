import { useState, useRef, useEffect } from "react";
import { Search, FileText, Trash2, Pencil, X, Loader2, UserSearch, UserCheck, Percent, BarChart3, ArrowDown, ArrowUp, ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react";
import BulkEditModal from "@/components/transactions/BulkEditModal";
import SenderReportModal from "@/components/transactions/SenderReportModal";
import MonthlyChartModal from "@/components/dashboard/MonthlyChartModal";
import ReceiverReportModal from "@/components/transactions/ReceiverReportModal";
import { format } from "date-fns";
import { api } from "@/api/apiClient";
import EditTransactionModal from "@/components/transactions/EditTransactionModal";
import DailyCommissionReport from "@/components/transactions/DailyCommissionReport";
import { useAuth } from "@/lib/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import { NO_SORT, nextSort, sortTransactions } from "@/lib/transactionSort";
import { usePreferences } from "@/lib/PreferencesContext";
import { TABLE_COLUMNS } from "@/lib/preferences";

// ═══ Type column: icon + sorting ═══
// Cash In = green down-arrow, Cash Out = red up-arrow (same arrows as the Cash In / Cash Out buttons).
// The name stays available to screen readers (role="img" + aria-label) and on hover (title).
export function TypeIcon({ type }) {
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
  transactions,
  allTransactions,
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
  onResetOpeningBalance,
  onDeleteDailyBalanceForDate,
  // Search scope (Dashboard): "all" days or the selected "day"; searchingAllDays = results span days.
  searchScope = "day",
  setSearchScope,
  searchingAllDays = false,
  onOpenDay
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteElapsed, setDeleteElapsed] = useState(0);
  const deleteTimerRef = useRef(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showSenderReport, setShowSenderReport] = useState(false);
  const [showReceiverReport, setShowReceiverReport] = useState(false);
  const [showCommissionReport, setShowCommissionReport] = useState(false);
  const [showChart, setShowChart] = useState(false);

  // Permissions (the API enforces the same rules; this only hides what the user can't do).
  const { can, canEditTransaction } = useAuth();
  // Translation function is `tr` here: `t` is used throughout this file for a transaction.
  const { t: tr, dir, locale } = useI18n();

  // ═══ Display preferences (Settings page): visible columns and row density ═══
  const { preferences } = usePreferences();
  const hiddenColumns = new Set(preferences.hiddenColumns);
  const show = Object.fromEntries(TABLE_COLUMNS.map((key) => [key, !hiddenColumns.has(key)]));
  const compact = preferences.density === "compact";

  // ═══ Sorting (display only: selection, bulk actions and "#" keep working from `transactions`) ═══
  const [sort, setSort] = useState(NO_SORT);
  // Each row's place in its own day's journal (shown in "#"), and in the whole journal (date, then
  // import order — used to sort by "#", so results from several days sort by day first).
  const journal = new Map();
  const perDay = new Map();
  allTransactions.forEach((tx, position) => {
    const day = tx.transaction_date || new Date(tx.created_date).toISOString().split("T")[0];
    const n = perDay.get(day) ?? 0;
    perDay.set(day, n + 1);
    journal.set(tx.id, { n, position });
  });
  const activeSort = sort.key && !show[sort.key] ? NO_SORT : sort;
  const rows = sortTransactions(transactions, activeSort, {
    locale,
    indexOf: (t) => journal.get(t.id)?.position ?? transactions.indexOf(t),
  });
  const resultDays = searchingAllDays ? new Set(transactions.map(txDateOfRow)).size : 0;
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
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const selectAllRef = useRef(null);

  // التحديد يشمل فقط العمليات الظاهرة: عند تغيير اليوم أو البحث تُزال المحددة غير الظاهرة،
  // حتى لا يُطبَّق إجراء على عمليات لا يراها المستخدم.
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(transactions.map((t) => t.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [transactions]);

  const selectedTransactions = transactions.filter((t) => selectedIds.has(t.id));
  const allVisibleSelected = transactions.length > 0 && selectedTransactions.length === transactions.length;
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
    setSelectedIds(allVisibleSelected ? new Set() : new Set(transactions.map((t) => t.id)));
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
      clearSelection();
      onRefresh();
    } catch (err) {
      setBulkError(err?.message || tr("list.bulkDeleteFailed"));
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkEditSaved = async (changes) => {
    setShowBulkEdit(false);
    if (changes.transaction_date) {
      await cleanUpEmptyDays(selectedTransactions.map(txDateOf).filter((d) => d !== changes.transaction_date));
    }
    clearSelection();
    onRefresh();
  };

  // الحذف فوري بعد التأكيد (زر التراجع أُزيل، فلا داعي لتأجيل الحذف)
  const handleDeleteOne = async (transaction) => {
    setConfirmDeleteId(null);
    await api.entities.Transaction.delete(transaction.id);
    const txDate = transaction.transaction_date || new Date(transaction.created_date).toISOString().split("T")[0];
    if (onDeleteDailyBalanceForDate) {
      await onDeleteDailyBalanceForDate(txDate);
    }
    onRefresh();
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    setDeleteElapsed(0);
    setShowConfirm(false);
    deleteTimerRef.current = setInterval(() => setDeleteElapsed((prev) => prev + 1), 1000);
    try {
      const dateToDelete = selectedDate;
      const toDelete = allTransactions.filter((t) => {
        const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
        return tDate === dateToDelete;
      });
      for (const t of toDelete) {
        try {await api.entities.Transaction.delete(t.id);} catch (_) {}
      }
      if (onDeleteDailyBalanceForDate) {
        await onDeleteDailyBalanceForDate(dateToDelete);
      } else if (onResetOpeningBalance) {
        await onResetOpeningBalance();
      }
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
        <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-gray-50 border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={tr("list.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent outline-none w-full text-start text-base font-normal" />
          
        </div>

        {setSearchScope &&
        <div className="flex items-center rounded-lg border bg-gray-50 p-0.5 text-sm" role="group" aria-label={tr("list.scope.label")} data-testid="search-scope">
            {["all", "day"].map((scope) =>
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

        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-[hsl(var(--foreground))]">{tr("list.journal")}:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-bold text-[hsl(var(--foreground))]" />
          
          <button
            onClick={onToday}
            className="bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg text-sm font-medium transition text-[hsl(var(--popover-foreground))]">
            
            {tr("list.today")}
          </button>
        </div>
      </div>

      {/* Confirm Delete Dialog */}
      {showConfirm &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir={dir}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="font-bold text-gray-800 text-lg">{tr("list.deleteAllTitle")}</h3>
            </div>
            <p className="text-gray-600 mb-1">
              {tr("list.deleteAllBefore")}<span className="font-bold text-red-600">{tr("list.count", { count: transactions.length })}</span>{tr("list.deleteAllAfter")}
            </p>
            <p className="text-gray-500 text-sm mb-5 bg-gray-50 rounded-lg px-3 py-2">
              {selectedDate}
            </p>
            <p className="text-xs text-red-500 mb-5">⚠️ {tr("common.cannotUndo")}</p>
            <div className="flex gap-3">
              <button
              onClick={() => setShowConfirm(false)}
              className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
              
                {tr("common.cancel")}
              </button>
              <button
              onClick={handleDeleteAll}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold transition">
              
                {tr("list.deleteAll")}
              </button>
            </div>
          </div>
        </div>
      }

      {searchingAllDays &&
      <div className="px-4 py-2 border-b bg-blue-50 text-sm text-blue-800 flex flex-wrap items-center gap-x-2" role="status" data-testid="all-days-results">
          <span className="font-bold">{tr("list.allDaysResults", { count: transactions.length, days: resultDays })}</span>
          {transactions.length > 0 && <span className="text-blue-700">{tr("list.allDaysHint")}</span>}
        </div>
      }

      {/* Actions row */}
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
        <span className="text-[hsl(var(--foreground))] font-bold text-base text-start">{tr("list.count", { count: transactions.length })}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowChart(true)}
            className="flex items-center gap-1 border border-indigo-200 rounded-lg px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 transition">

            <BarChart3 className="w-4 h-4" />
            {tr("list.chart")}
          </button>
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
          {canDelete && transactions.length > 0 && !searchingAllDays &&
          <button
            onClick={() => setShowConfirm(true)}
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
          <button
            onClick={onCashOut}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition">
            
            Cash Out
            <span className="bg-red-700 rounded-full p-0.5">↑</span>
          </button>
          <button
            onClick={onCashIn}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition">
            
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
              (${selectedTransactions.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {canBulkEdit &&
            <button
            onClick={() => setShowBulkEdit(true)}
            disabled={bulkWorking}
            className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 transition disabled:opacity-50">
              <Pencil className="w-4 h-4" />
              {tr("list.bulkEdit")}
            </button>
            }
            {canDelete &&
            <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            disabled={bulkWorking}
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

      {/* Bulk delete confirmation */}
      {showBulkDeleteConfirm &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir={dir}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" role="alertdialog" aria-label={tr("list.bulkDeleteDialog")}>
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="font-bold text-gray-800 text-lg">{tr("list.bulkDeleteTitle")}</h3>
            </div>
            <p className="text-gray-600 mb-1">
              {tr("list.bulkDeleteBefore")}<span className="font-bold text-red-600">{tr("list.count", { count: selectedTransactions.length })}</span>{tr("list.bulkDeleteAfter")}
            </p>
            <p className="text-xs text-red-500 mb-5">⚠️ {tr("common.cannotUndo")}</p>
            <div className="flex gap-3">
              <button
              onClick={() => setShowBulkDeleteConfirm(false)}
              className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">
                {tr("common.cancel")}
              </button>
              <button
              onClick={handleBulkDelete}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold transition">
                {tr("list.bulkDeleteConfirm", { count: selectedTransactions.length })}
              </button>
            </div>
          </div>
        </div>
      }

      {/* Table / Empty */}
      {loading ?
      <div className="p-12 text-center text-gray-400">{tr("common.loading")}</div> :
      transactions.length === 0 ?
      <div className="p-12 text-center">
          <p className="text-gray-500 text-lg font-medium">{searchingAllDays ? tr("list.emptyAllDays") : tr("list.empty")}</p>
          <p className="text-gray-400 text-sm mt-1">{searchingAllDays ? tr("list.emptyAllDaysHint") : tr("list.emptyHint")}</p>
        </div> :

      <>
        <div className="overflow-x-auto">
          <table
            className={`w-full text-sm text-start ${compact ? "[&_td]:!py-1.5 [&_th]:!py-1.5" : ""}`}
            data-density={preferences.density}>
            <thead className="bg-gray-50 text-gray-600">
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
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((t, i) => {
                // الرقم الحقيقي للعملية في اليوم (ترتيب allTransactions نفسه، مهما كان ترتيب العرض)
                const realIndex = journal.get(t.id)?.n ?? -1;
                const displayIndex = realIndex >= 0 ? realIndex + 1 : i + 1;
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
                    <td className="px-4 py-3 text-gray-400">{displayIndex}</td>
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
                    <td className="px-4 py-3 font-bold text-gray-800">${(t.amount || 0).toFixed(2)}</td>
                  }
                  {show.commissionRate &&
                    <td className="px-4 py-3 font-bold text-blue-600">
                      {t.amount > 0 ? (t.commission / t.amount * 100).toFixed(2) + "%" : "-"}
                    </td>
                  }
                  {show.commission &&
                    <td className={`px-4 py-3 font-bold ${t.type === "cash_out" ? "text-red-700" : "text-green-700"}`}>${(t.commission || 0).toFixed(3)}</td>
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
                      {searchingAllDays && onOpenDay ?
                          <button
                            type="button"
                            onClick={() => onOpenDay(txDateOfRow(t))}
                            title={tr("list.openDay")}
                            className="text-blue-700 underline underline-offset-2 hover:text-blue-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                            {t.transaction_date || format(new Date(t.created_date), "yyyy/MM/dd HH:mm")}
                          </button> :
                        t.transaction_date ?
                          t.transaction_date :
                          format(new Date(t.created_date), "yyyy/MM/dd HH:mm")}
                    </td>
                  }
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {canEditTransaction(t) &&
                      <button
                            onClick={() => setEditingTransaction(t)}
                            className="text-gray-400 hover:text-blue-500 transition"
                            title={tr("common.edit")}>
                            
                        <Pencil className="w-4 h-4 text-[hsl(var(--sidebar-ring))]" />
                      </button>
                      }
                      {!canDelete ? null : confirmDeleteId === t.id ?
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
      {showSenderReport &&
      <SenderReportModal
        allTransactions={allTransactions}
        onClose={() => setShowSenderReport(false)} />

      }
      {showBulkEdit &&
      <BulkEditModal
        transactions={selectedTransactions}
        onClose={() => setShowBulkEdit(false)}
        onSaved={handleBulkEditSaved} />

      }
      {showChart &&
      <MonthlyChartModal
        allTransactions={allTransactions}
        selectedDate={selectedDate}
        onClose={() => setShowChart(false)} />

      }
      {showReceiverReport &&
      <ReceiverReportModal
        allTransactions={allTransactions}
        onClose={() => setShowReceiverReport(false)} />

      }
      {showCommissionReport &&
      <DailyCommissionReport
        transactions={allTransactions}
        selectedDate={selectedDate}
        onClose={() => setShowCommissionReport(false)} />

      }
    </div>);

}