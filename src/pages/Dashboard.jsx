import { useState, useEffect } from "react";
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
import { dayOf, normalizeDate, walletFigures, walletFiguresByStore } from "@/lib/walletMath";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { usePreferences } from "@/lib/PreferencesContext";
import { PERMISSIONS } from "@/lib/permissions";

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
  // then need a store). The choice is remembered in this browser.
  const seesAll = can(PERMISSIONS.STORES_ALL);
  const [stores, setStores] = useState([]);
  const [storesLoaded, setStoresLoaded] = useState(!seesAll);
  const [storeChoice, setStoreChoice] = useState(() => localStorage.getItem("selectedStore") || "all");
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
  const storeFilter = chosenStore ? { store_id: chosenStore } : {};
  const withStore = (...args) => (chosenStore ? [...args, chosenStore] : args);
  const storeKey = storesLoaded ? String(chosenStore ?? (allStoresView ? "all" : "own")) : null;
  const handleStoreChoice = (value) => {
    localStorage.setItem("selectedStore", value);
    setStoreChoice(value);
  };
  const [transactions, setTransactions] = useState([]);
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
  const today = getToday();
  // Settings → General → Start on: the last day viewed (remembered in this browser) or today.
  const [selectedDate, setSelectedDate] = useState(() => {
    if (preferences.startOn === "today") return getToday();
    return localStorage.getItem("selectedDate") || getToday();
  });

  const handleSetSelectedDate = (date) => {
    localStorage.setItem("selectedDate", date);
    setSelectedDate(date);
  };
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
  const [dailyBalances, setDailyBalances] = useState([]);

  const fetchDailyBalances = async () => {
    const records = await api.entities.DailyBalance.filter(storeFilter);
    setDailyBalances(records);
  };

  // storeId: the store the balance is for (after an import into a store the Admin picked there).
  const handleSetOpeningBalance = async (val, date = null, storeId = chosenStore) => {
    if (!date || !canWriteBalances) return;
    const existing = dailyBalances.find((d) => d.date === date && (storeId == null || d.store_id === storeId));
    try {
      if (existing) {
        await api.entities.DailyBalance.update(existing.id, { opening_balance: val });
      } else {
        await api.entities.DailyBalance.create({ date, opening_balance: val, ...(storeId ? { store_id: storeId } : {}) });
      }
      notify.success(t("toast.balance.saved", { date }));
    } catch (err) {
      notify.error(err?.message ? errorText(err.message) : t("toast.balance.failed"));
    }
    await fetchDailyBalances();
  };

  // `loading` starts true and is only cleared here — it is NOT set back to true on later refreshes
  // (after an edit, delete, bulk action, cash in/out or import). Swapping the table for the short
  // "loading" line made the page shrink below the viewport, so the browser jumped to the top and
  // the user lost their place. Refreshes now keep the current rows on screen until the new data
  // arrives and replaces them in place, so the scroll position is preserved.
  const fetchTransactions = async () => {
    const data = await api.entities.Transaction.filter(storeFilter, "created_date", 10000);
    // رتّب: أولاً بـ transaction_date ثم بـ sort_order (ترتيب الاستيراد) ثم بـ reference_number رقمياً
    const sorted = [...data].sort((a, b) => {
      const dateA = a.transaction_date || new Date(a.created_date).toISOString().split("T")[0];
      const dateB = b.transaction_date || new Date(b.created_date).toISOString().split("T")[0];
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      // sort_order = ترتيب الاستيراد من الكشف — الأولوية
      const soA = a.sort_order ?? 999999;
      const soB = b.sort_order ?? 999999;
      if (soA !== soB) return soA - soB;
      // بدون رقم عملية: رتّب حسب created_date
      return new Date(a.created_date) - new Date(b.created_date);
    });
    setTransactions(sorted);
    setLoading(false);
  };

  // Load (again) whenever the store shown changes. Someone with no store has nothing to load.
  useEffect(() => {
    if (noStore) {
      setLoading(false);
      return;
    }
    if (storeKey === null) return;
    fetchTransactions();
    fetchDailyBalances();
    loadClosedDays();
    if (!allStoresView) api.commissionRates.get(...withStore(getToday())).then((r) => setCommissionRate(r?.rate ?? 1)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey, noStore]);



  // The selected day's transactions matching the search. The day's totals below always come from
  // these, whatever the search scope, so an all-days search never mixes other days into them.
  const filtered = transactions.filter((t) => {
    const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
    const matchDate = tDate === selectedDate;
    return matchDate && matchesSearch(t, search);
  });

  // What the table shows: with a search in "all days" scope, every matching transaction on any day
  // (in journal order: date, then import order); otherwise the selected day.
  const searchingAllDays = searchScope === "all" && search.trim() !== "";
  const tableRows = searchingAllDays ? transactions.filter((t) => matchesSearch(t, search)) : filtered;

  const totalDeposits = filtered.
  filter((t) => t.type === "cash_in").
  reduce((s, t) => s + (t.amount || 0), 0);

  const totalWithdrawals = filtered.
  filter((t) => t.type === "cash_out").
  reduce((s, t) => s + (t.amount || 0), 0);

  const totalCommissions = filtered.reduce((s, t) => s + (t.commission || 0), 0);

  // عمولات وعمليات الشهر كاملاً
  const selectedMonth = selectedDate.slice(0, 7); // YYYY-MM
  const monthlyTransactions = transactions.filter((t) => {
    const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
    return tDate.startsWith(selectedMonth);
  });
  const monthlyCommissions = monthlyTransactions.reduce((s, t) => s + (t.commission || 0), 0);
  const monthlyCount = monthlyTransactions.length;
  const monthlyDeposits = monthlyTransactions.filter((t) => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
  const monthlyWithdrawals = monthlyTransactions.filter((t) => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);

  // عمولات وعمليات السنة كاملة (سنة التاريخ المختار)
  const selectedYear = selectedDate.slice(0, 4); // YYYY
  const yearlyTransactions = transactions.filter((t) => {
    const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
    return tDate.startsWith(selectedYear);
  });
  const yearlyCommissions = yearlyTransactions.reduce((s, t) => s + (t.commission || 0), 0);
  const yearlyCount = yearlyTransactions.length;
  const yearlyDeposits = yearlyTransactions.filter((t) => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
  const yearlyWithdrawals = yearlyTransactions.filter((t) => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);

  // Opening balance of the selected day and the wallet's net balance (src/lib/walletMath.js); in
  // "All stores", each store's figures added up.
  const { openingBalance: effectiveOpeningBalance, netBalance: globalNetBalance, dailyRecord } =
    (allStoresView ? walletFiguresByStore : walletFigures)(transactions, dailyBalances, selectedDate);
  // الصافي = رصيد البداية + الإيداعات - السحوبات (لليوم المختار)
  const dailyNetBalance = effectiveOpeningBalance + totalDeposits - totalWithdrawals;

  const handleToday = () => handleSetSelectedDate(getToday());

  const handleResetOpeningBalance = async () => {
    if (dailyRecord) {
      await api.entities.DailyBalance.update(dailyRecord.id, { opening_balance: 0 });
      await fetchDailyBalances();
    }
  };

  // After deletes: a store's opening balance goes when that store has no transactions left that day.
  const handleDeleteDailyBalanceForDate = async (dateToCheck) => {
    if (!dateToCheck || !user || !canWriteBalances) return;

    const normalizedTargetDate = normalizeDate(dateToCheck);
    const remainingTransactions = await api.entities.Transaction.filter(storeFilter, "created_date", 10000);
    const storesWithRows = new Set(
      remainingTransactions.filter((t) => normalizeDate(dayOf(t)) === normalizedTargetDate).map((t) => t.store_id)
    );
    const emptied = dailyBalances.filter((d) => normalizeDate(d.date) === normalizedTargetDate && !storesWithRows.has(d.store_id));
    if (!emptied.length) return;

    for (const row of emptied) await api.entities.DailyBalance.delete(row.id);
    await fetchDailyBalances();
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
          monthlyCommissions={monthlyCommissions}
          monthlyCount={monthlyCount}
          monthlyDeposits={monthlyDeposits}
          monthlyWithdrawals={monthlyWithdrawals}
          yearlyCommissions={yearlyCommissions}
          yearlyCount={yearlyCount}
          yearlyDeposits={yearlyDeposits}
          yearlyWithdrawals={yearlyWithdrawals}
          selectedDate={selectedDate} />
        
        <WalletSummary
          openingBalance={effectiveOpeningBalance}
          openingBalanceDate={selectedDate}
          totalDeposits={totalDeposits}
          totalWithdrawals={totalWithdrawals}
          totalCommissions={totalCommissions}
          netBalance={dailyNetBalance}
          onSaveOpeningBalance={canWriteBalances && !closedInfo && !allStoresView ? (val) => handleSetOpeningBalance(val, selectedDate) : undefined} />
        
        <TransactionsList
          transactions={tableRows}
          allTransactions={transactions}
          loading={loading}
          search={search}
          setSearch={setSearch}
          searchScope={searchScope}
          setSearchScope={setSearchScope}
          searchingAllDays={searchingAllDays}
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
          onRefresh={() => fetchTransactions()}
          onResetOpeningBalance={handleResetOpeningBalance}
          onDeleteDailyBalanceForDate={handleDeleteDailyBalanceForDate}
          storeNames={storeNames}
          isRowClosed={isRowClosed} />
        
      </div>

      {showCashIn &&
      <CashInModal
        commissionRate={commissionRate}
        storeId={chosenStore ?? undefined}
        onClose={() => setShowCashIn(false)}
        onSaved={() => {setShowCashIn(false);fetchTransactions();}} />

      }
      {showImportPDF &&
      <ImportPDFModal
        stores={pickerStores}
        defaultStoreId={chosenStore}
        onClose={() => setShowImportPDF(false)}
        onSaved={(ob, obDate, importStore) => {
          setShowImportPDF(false);
          setSearch(""); // مسح البحث
          const targetDate = obDate || selectedDate;
          if (ob !== null && ob !== undefined && targetDate) {
            handleSetOpeningBalance(ob, targetDate, importStore ?? chosenStore);
          }
          if (obDate) handleSetSelectedDate(obDate);
          fetchTransactions();
          fetchDailyBalances();
        }} />

      }
      {showCashOut &&
      <CashOutModal
        storeId={chosenStore ?? undefined}
        onClose={() => setShowCashOut(false)}
        onSaved={() => {setShowCashOut(false);fetchTransactions();}} />

      }
    </div>);

}