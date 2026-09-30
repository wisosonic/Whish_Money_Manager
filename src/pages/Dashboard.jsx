import { useState, useEffect, useRef } from "react";
import { api } from "@/api/apiClient";
import Header from "@/components/layout/Header";
import StatsCards from "@/components/dashboard/StatsCards";
import WalletSummary from "@/components/dashboard/WalletSummary";
import TransactionsList from "@/components/dashboard/TransactionsList";
import CashInModal from "@/components/transactions/CashInModal";
import CashOutModal from "@/components/transactions/CashOutModal";
import ImportPDFModal from "@/components/transactions/ImportPDFModal";
import { Store } from "lucide-react";
import { matchesSearch } from "@/lib/transactionSearch";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { usePreferences } from "@/lib/PreferencesContext";
import { PERMISSIONS } from "@/lib/permissions";
import { COOKIES, readRemembered, writeCookie } from "@/lib/cookies";

export default function Dashboard() {
  const { can, user } = useAuth();
  const { dir, t, errorText } = useI18n();
  const { preferences } = usePreferences();
  const canCloseDays = can(PERMISSIONS.DAYS_CLOSE);
  // Only Admin/Manager may set or clear opening balances.
  const canWriteBalances = can(PERMISSIONS.BALANCES_WRITE);

  // ═══ Store ═══
  // Managers and Users see their own store (the server applies it). The Admin sees every store:
  // with several, they pick one — or "All stores" (every row, with a Store column; day actions
  // then need a store). The choice is remembered in this browser (a cookie).
  const seesAll = can(PERMISSIONS.STORES_ALL);
  const [stores, setStores] = useState([]);
  const [storesLoaded, setStoresLoaded] = useState(!seesAll);
  const [storeChoice, setStoreChoice] = useState(() => readRemembered(COOKIES.selectedStore, "selectedStore") || "all");
  useEffect(() => {
    if (!seesAll) return undefined;
    let current = true;
    Promise.resolve()
      .then(() => api.stores.list())
      .then((list) => { if (current) setStores(Array.isArray(list) ? list : []); })
      .catch(() => {}) // without the list: one store assumed, the server still applies the rules
      .finally(() => { if (current) setStoresLoaded(true); });
    return () => { current = false; };
  }, [seesAll]);
  const multiStore = seesAll && stores.length > 1;
  const chosenStore = multiStore && stores.some((store) => String(store.id) === storeChoice) ? Number(storeChoice) : null;
  const allStoresView = multiStore && chosenStore === null;
  const noStore = !seesAll && Boolean(user) && user.store_id == null;
  const storeNames = allStoresView ? new Map(stores.map((store) => [store.id, store.name])) : null;
  // What the store field lists: the Admin's stores, or the one store a Manager / User works in.
  const pickerStores = seesAll ? stores : user?.store_id != null ? [{ id: user.store_id, name: user.store_name }] : [];
  // The store is sent only when the Admin picked one of several; otherwise the server knows it.
  const withStore = (...args) => (chosenStore ? [...args, chosenStore] : args);
  const storeKey = storesLoaded ? String(chosenStore ?? (allStoresView ? "all" : "own")) : null;
  const handleStoreChoice = (value) => {
    writeCookie(COOKIES.selectedStore, value);
    setStoreChoice(value);
  };
  const [loading, setLoading] = useState(true);
  const [showCashIn, setShowCashIn] = useState(false);
  const [showCashOut, setShowCashOut] = useState(false);
  const [showImportPDF, setShowImportPDF] = useState(false);
  const getToday = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  // Settings → General → Start on: the last day viewed (remembered in this browser, a cookie) or today.
  const [selectedDate, setSelectedDate] = useState(() => {
    if (preferences.startOn === "today") return getToday();
    return readRemembered(COOKIES.selectedDate, "selectedDate") || getToday();
  });

  const handleSetSelectedDate = (date) => {
    writeCookie(COOKIES.selectedDate, date);
    setSelectedDate(date);
  };
  // Kept current on every render, so an async callback that started earlier (e.g. handleSetOpeningBalance,
  // below) can tell whether the day or store it started with is still the one on screen by the time it
  // finishes, instead of trusting its own stale closure over selectedDate / chosenStore.
  const selectedDateRef = useRef(selectedDate);
  const chosenStoreRef = useRef(chosenStore);
  useEffect(() => { selectedDateRef.current = selectedDate; chosenStoreRef.current = chosenStore; });
  const [search, setSearch] = useState("");
  // Where a search looks: "all" days or only the selected "day" — starts from Settings → Transactions table.
  const [searchScope, setSearchScope] = useState(preferences.searchScope);

  // ═══ Closed days (no changes allowed) and today's commission rate (for Cash In) ═══
  const [closedDays, setClosedDays] = useState([]);
  const [commissionRate, setCommissionRate] = useState(1);
  const loadClosedDays = async () => {
    try {
      setClosedDays(await api.closedDays.list(...withStore()));
    } catch {
      // Not critical for viewing; the server still refuses changes to closed days.
    }
  };
  // In "All stores", each row is checked against its own store's closed days.
  const closedInfo = allStoresView ? null : closedDays.find((d) => d.date === selectedDate) || null;
  const closedDates = new Set(allStoresView ? [] : closedDays.map((d) => d.date));
  const closedKeys = new Set(closedDays.map((d) => `${d.store_id}|${d.date}`));
  const dayOf = (row) => row.transaction_date || String(row.created_date || "").slice(0, 10);
  const isRowClosed = allStoresView ? (row) => closedKeys.has(`${row.store_id}|${dayOf(row)}`) : undefined;

  const handleCloseDay = async (date) => {
    try {
      await api.closedDays.close(...withStore(date));
      notify.success(t("toast.day.closed", { date }));
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.day.failed"));
    }
    await loadClosedDays();
  };
  const handleReopenDay = async (date) => {
    try {
      await api.closedDays.reopen(...withStore(date));
      notify.success(t("toast.day.reopened", { date }));
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.day.failed"));
    }
    await loadClosedDays();
  };
  // ═══ The selected day, its totals and the wallet: each asked of the server (user's request) ═══
  // The browser no longer loads every transaction: choosing a day asks for that day's rows (at most
  // 10,000, the 10,000 rule) and its totals, which the server counts over every row, as it does the
  // month, the year and the wallet figures.
  const ZERO = { count: 0, deposits: 0, withdrawals: 0, commissions: 0 };
  const [dayRows, setDayRows] = useState([]);
  const [dayInfo, setDayInfo] = useState({ total: 0, truncated: false });
  const [summary, setSummary] = useState(null);
  const latestDay = useRef("");

  // `loading` starts true and is only cleared here — it is NOT set back to true on later refreshes
  // (after an edit, delete, bulk action, cash in/out or import). Swapping the table for the short
  // "loading" line made the page shrink below the viewport, so the browser jumped to the top and
  // the user lost their place. Refreshes keep the current rows on screen until the new data
  // arrives and replaces them in place, so the scroll position is preserved.
  const fetchDay = async () => {
    const key = `${storeKey}|${selectedDate}`;
    latestDay.current = key;
    try {
      const [day, totals] = await Promise.all([
        api.dashboard.day(...withStore(selectedDate)),
        api.dashboard.summary(...withStore(selectedDate)),
      ]);
      if (latestDay.current !== key) return; // another day (or store) was chosen meanwhile
      setDayRows(day.transactions);
      setDayInfo({ total: day.total, truncated: day.truncated });
      setSummary(totals);
    } catch (err) {
      if (latestDay.current === key) notify.error(errorText(err?.message || ""));
    } finally {
      if (latestDay.current === key) setLoading(false);
    }
  };
  // `fetchDay` itself closes over this render's `selectedDate` / `storeKey`, same as everything else
  // in the component — fine for the effect below (a fresh closure every render), but wrong for a
  // *longer-running* async caller such as `handleSetOpeningBalance`: by the time such a caller reaches
  // its own trailing refresh, newer renders (and newer `fetchDay` closures) may already exist. Calling
  // through this ref (kept current every render) always runs the latest one, so it always reads the
  // day/store actually on screen — never whatever they were when the caller started.
  const fetchDayRef = useRef(fetchDay);
  useEffect(() => { fetchDayRef.current = fetchDay; });

  // storeId: the store the balance is for (after an import into a store the Admin picked there).
  const handleSetOpeningBalance = async (val, date = null, storeId = chosenStore) => {
    if (!date || !canWriteBalances) return;
    try {
      const [existing] = await api.entities.DailyBalance.filter({ date, ...(storeId ? { store_id: storeId } : {}) });
      if (existing) {
        await api.entities.DailyBalance.update(existing.id, { opening_balance: val });
      } else {
        await api.entities.DailyBalance.create({ date, opening_balance: val, ...(storeId ? { store_id: storeId } : {}) });
      }
      notify.success(t("toast.balance.saved", { date }));
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.balance.failed"));
    }
    // Skipped once the day (or store) this was for is no longer the one on screen — the import flow
    // changes the selection itself right after calling this, which already fetches the new day; doing
    // it here too would just be redundant. When it *is* still current (the opening-balance pencil
    // always edits the day already shown, so this is the only refresh that day gets), go through
    // `fetchDayRef` rather than calling `fetchDay` directly: this function's own closure over
    // `selectedDate` / `chosenStore` can itself be the stale one by the time the write above finishes
    // (a slow network round trip), and calling it directly re-fetched *that* stale day — which, after
    // the import already moved the page on, was a day whose data no longer belonged there (often now
    // empty), blanking the table until a reload started over cleanly. (user-reported, 2026-09-30: after
    // clearing all transactions and importing a new file, the table went blank until reloaded.)
    if (date === selectedDateRef.current && storeId === chosenStoreRef.current) await fetchDayRef.current();
  };

  // Load (again) whenever the store shown changes. Someone with no store has nothing to load.
  useEffect(() => {
    if (noStore) {
      setLoading(false);
      return;
    }
    if (storeKey === null) return;
    loadClosedDays();
    if (!allStoresView) api.commissionRates.get(...withStore(getToday())).then((r) => setCommissionRate(r?.rate ?? 1)).catch(() => {});
     
  }, [storeKey, noStore]);

  // A new query for every day (and store) shown.
  useEffect(() => {
    if (noStore || storeKey === null) return;
    fetchDay();
     
  }, [storeKey, selectedDate, noStore]);

  // ═══ Search ═══
  // "This day": the day's rows, here. "All days" and "This month" (the selected date's month): asked
  // of the server (at most 10,000 results), after a short pause in typing; an answer to an older
  // search (or another month) is ignored.
  const searchingDays = (searchScope === "all" || searchScope === "month") && search.trim() !== "";
  const searchMonth = searchScope === "month" ? selectedDate.slice(0, 7) : undefined;
  const [daysResult, setDaysResult] = useState({ transactions: [], total: 0, truncated: false });
  const latestSearch = useRef("");
  const fetchSearch = async () => {
    const key = `${storeKey}|${searchMonth}|${search}`;
    latestSearch.current = key;
    try {
      const result = await api.dashboard.search(...withStore(search.trim(), searchMonth));
      if (latestSearch.current === key) setDaysResult(result);
    } catch (err) {
      if (latestSearch.current === key) notify.error(errorText(err?.message || ""));
    }
  };
  useEffect(() => {
    if (!searchingDays || noStore || storeKey === null) return undefined;
    const timer = setTimeout(fetchSearch, 250);
    return () => clearTimeout(timer);
     
  }, [search, searchingDays, searchMonth, storeKey, noStore]);

  // After a change (edit, delete, bulk, cash in / out, import): the day, its totals, and the results.
  const refresh = () => {
    fetchDay();
    if (searchingDays) fetchSearch();
  };

  // The selected day's rows matching the search. The day's totals come from these while searching
  // (so an all-days search never mixes other days into them), and from the server otherwise.
  const searching = search.trim() !== "";
  const filtered = searching ? dayRows.filter((row) => matchesSearch(row, search)) : dayRows;
  const sum = (rows, type) => rows.filter((row) => !type || row.type === type).reduce((s, row) => s + (Number(type ? row.amount : row.commission) || 0), 0);
  const dayTotals = searching
    ? { deposits: sum(filtered, "cash_in"), withdrawals: sum(filtered, "cash_out"), commissions: sum(filtered) }
    : summary?.day ?? ZERO;
  const totalDeposits = dayTotals.deposits;
  const totalWithdrawals = dayTotals.withdrawals;
  const totalCommissions = dayTotals.commissions;

  // What the table shows: with a search in "all days" or "this month" scope, the server's results (journal order);
  // otherwise the selected day. When rows were left out (the 10,000 rule), the table says so.
  const tableRows = searchingDays ? daysResult.transactions : filtered;
  const truncatedTotal = searchingDays
    ? (daysResult.truncated ? daysResult.total : null)
    : (dayInfo.truncated ? dayInfo.total : null);

  // The month and year of the selected date, counted by the server over every row.
  const month = summary?.month ?? ZERO;
  const year = summary?.year ?? ZERO;

  // The wallet (per store, added up in "All stores"): the day's opening balance and the wallet's
  // net balance, from the server; the day's net = opening + deposits − withdrawals.
  const effectiveOpeningBalance = summary?.wallet?.opening_balance ?? 0;
  const globalNetBalance = summary?.wallet?.net_balance ?? 0;
  const dailyNetBalance = effectiveOpeningBalance + totalDeposits - totalWithdrawals;

  const handleToday = () => handleSetSelectedDate(getToday());

  // After deletes: a store's opening balance for the day goes when that store has no transactions
  // left on it. The server checks (it counts every row, the page only has one day).
  const handleDeleteDailyBalanceForDate = async (dateToCheck) => {
    if (!dateToCheck || !user || !canWriteBalances) return;
    try {
      const { deleted } = await api.dashboard.cleanupBalances(...withStore(dateToCheck));
      if (deleted) await fetchDay();
    } catch (err) {
      notify.error(errorText(err?.message || ""));
    }
  };

  if (noStore) {
    return (
      <div className="min-h-screen bg-gray-100" dir={dir}>
        <Header />
        <div className="p-6 flex justify-center">
          <div className="bg-white rounded-2xl shadow p-8 text-center max-w-md" data-testid="no-store">
            <Store className="w-10 h-10 text-blue-600 mx-auto mb-3" aria-hidden="true" />
            <h2 className="text-lg font-bold text-gray-800 mb-2">{t("stores.noStoreTitle")}</h2>
            <p className="text-sm text-gray-500">{t("stores.noStoreMessage")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <div className="p-2 md:p-4 space-y-2 md:space-y-4 w-full bg-[hsl(var(--sidebar-border))]">
        {/* The store shown is always visible (user's request). Only the Admin with several stores can
            change it; otherwise the field shows the one store, greyed out. */}
        {pickerStores.length > 0 &&
          <div className="bg-white rounded-xl shadow px-4 py-3 flex flex-wrap items-center gap-3" data-testid="store-picker">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Store className="w-4 h-4 text-blue-600" aria-hidden="true" />
              {t("stores.showing")}
              <select value={multiStore ? chosenStore ?? "all" : pickerStores[0].id} onChange={(e) => handleStoreChoice(e.target.value)} data-testid="dashboard-store"
                disabled={!multiStore}
                className="border rounded-lg px-3 py-1.5 font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-70 disabled:cursor-not-allowed">
                {multiStore && <option value="all">{t("stores.all")}</option>}
                {pickerStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            {allStoresView && <span className="text-xs text-gray-500">{t("stores.allHint")}</span>}
            {!multiStore && <span className="text-xs text-gray-500" data-testid="store-picker-hint">{seesAll ? t("stores.onlyOneHint") : t("stores.ownStoreHint")}</span>}
          </div>
        }
        <StatsCards
          totalDeposits={totalDeposits}
          totalWithdrawals={totalWithdrawals}
          totalCommissions={totalCommissions}
          netBalance={globalNetBalance}
          openingBalance={effectiveOpeningBalance}
          monthlyCommissions={month.commissions}
          monthlyCount={month.count}
          monthlyDeposits={month.deposits}
          monthlyWithdrawals={month.withdrawals}
          yearlyCommissions={year.commissions}
          yearlyCount={year.count}
          yearlyDeposits={year.deposits}
          yearlyWithdrawals={year.withdrawals}
          selectedDate={selectedDate} />
        
        <WalletSummary
          openingBalance={effectiveOpeningBalance}
          totalDeposits={totalDeposits}
          totalWithdrawals={totalWithdrawals}
          totalCommissions={totalCommissions}
          netBalance={dailyNetBalance}
          onSaveOpeningBalance={canWriteBalances && !closedInfo && !allStoresView ? (val) => handleSetOpeningBalance(val, selectedDate) : undefined} />
        
        <TransactionsList
          transactions={tableRows}
          dayTransactions={dayRows}
          truncatedTotal={truncatedTotal}
          storeId={chosenStore ?? undefined}
          loading={loading}
          search={search}
          setSearch={setSearch}
          searchScope={searchScope}
          setSearchScope={setSearchScope}
          searchingDays={searchingDays}
          onOpenDay={(date) => {setSearch("");handleSetSelectedDate(date);}}
          closedDay={closedInfo}
          closedDates={closedDates}
          canCloseDays={canCloseDays}
          onCloseDay={handleCloseDay}
          onReopenDay={handleReopenDay}
          selectedDate={selectedDate}
          setSelectedDate={handleSetSelectedDate}
          onToday={handleToday}
          onCashIn={() => setShowCashIn(true)}
          onCashOut={() => setShowCashOut(true)}
          onImportPDF={() => setShowImportPDF(true)}
          onRefresh={refresh}
          onDeleteDailyBalanceForDate={handleDeleteDailyBalanceForDate}
          storeNames={storeNames}
          isRowClosed={isRowClosed} />
        
      </div>

      {showCashIn &&
      <CashInModal
        commissionRate={commissionRate}
        storeId={chosenStore ?? undefined}
        onClose={() => setShowCashIn(false)}
        onSaved={() => {setShowCashIn(false);refresh();}} />

      }
      {showImportPDF &&
      <ImportPDFModal
        stores={pickerStores}
        defaultStoreId={chosenStore}
        onClose={() => setShowImportPDF(false)}
        onSaved={(obDate) => {
          setShowImportPDF(false);
          setSearch(""); // clear the search
          // The opening balance(s) are written server-side, in the same transaction as the import
          // (user's request, 2026-09-30 — every day the statement covers, not just this one); this
          // only needs to show the statement's day, or refresh the one already shown.
          if (obDate && obDate !== selectedDate) handleSetSelectedDate(obDate);
          else refresh();
        }} />

      }
      {showCashOut &&
      <CashOutModal
        storeId={chosenStore ?? undefined}
        onClose={() => setShowCashOut(false)}
        onSaved={() => {setShowCashOut(false);refresh();}} />

      }
    </div>);

}