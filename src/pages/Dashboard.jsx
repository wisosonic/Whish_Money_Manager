import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import Header from "@/components/layout/Header";
import StatsCards from "@/components/dashboard/StatsCards";
import WalletSummary from "@/components/dashboard/WalletSummary";
import TransactionsList from "@/components/dashboard/TransactionsList";
import CashInModal from "@/components/transactions/CashInModal";
import CashOutModal from "@/components/transactions/CashOutModal";
import ImportPDFModal from "@/components/transactions/ImportPDFModal";
import { matchesSearch } from "@/lib/transactionSearch";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { PERMISSIONS } from "@/lib/permissions";

export default function Dashboard() {
  const { can } = useAuth();
  const { dir } = useI18n();
  // Everyone sees all office data; only Admin/Manager may set or clear opening balances.
  const canWriteBalances = can(PERMISSIONS.BALANCES_WRITE);
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
  const [selectedDate, setSelectedDate] = useState(() => {
    return localStorage.getItem("selectedDate") || getToday();
  });

  const handleSetSelectedDate = (date) => {
    localStorage.setItem("selectedDate", date);
    setSelectedDate(date);
  };
  const [search, setSearch] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [dailyBalances, setDailyBalances] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const fetchDailyBalances = async (userEmail) => {
    const records = await base44.entities.DailyBalance.filter({});
    setDailyBalances(records);
  };

  const handleSetOpeningBalance = async (val, date = null) => {
    if (!date || !canWriteBalances) return;
    const existing = dailyBalances.find((d) => d.date === date);
    if (existing) {
      await base44.entities.DailyBalance.update(existing.id, { opening_balance: val });
    } else {
      await base44.entities.DailyBalance.create({ date, opening_balance: val });
    }
    await fetchDailyBalances(currentUser?.email);
  };

  const fetchTransactions = async (userEmail) => {
    setLoading(true);
    const data = await base44.entities.Transaction.filter({}, "created_date", 10000);
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

  useEffect(() => {
    base44.auth.me().then((user) => {
      setCurrentUser(user);
      fetchTransactions(user.email);
      fetchDailyBalances(user.email);
    });
  }, []);



  const filtered = transactions.filter((t) => {
    const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
    const matchDate = tDate === selectedDate;
    return matchDate && matchesSearch(t, search);
  });

  const totalDeposits = filtered.
  filter((t) => t.type === "cash_in").
  reduce((s, t) => s + (t.amount || 0), 0);

  const totalWithdrawals = filtered.
  filter((t) => t.type === "cash_out").
  reduce((s, t) => s + (t.amount || 0), 0);

  const totalCommissions = filtered.reduce((s, t) => s + (t.commission || 0), 0);

  // تطبيع التاريخ (تحويل DD-MM-YYYY إلى YYYY-MM-DD)
  const normalizeDate = (dateStr) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3 && parts[0].length === 2) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
  };

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

  // حساب رصيد البداية: إما محدد يدويًا أو صافي اليوم السابق
  const calculateDayNetChange = (date) => {
    const dayTx = transactions.filter((t) => {
      const d = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
      return normalizeDate(d) === normalizeDate(date);
    });
    const deps = dayTx.filter((t) => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
    const wdls = dayTx.filter((t) => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);
    return deps - wdls;
  };

  const dailyRecord = dailyBalances.find((d) => d.date === selectedDate) || null;
  let effectiveOpeningBalance = 0;

  if (dailyRecord && dailyRecord.opening_balance && dailyRecord.opening_balance !== 0) {
    effectiveOpeningBalance = dailyRecord.opening_balance;
  } else {
    const prevDate = new Date(selectedDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split("T")[0];

    const prevRecord = dailyBalances.find((d) => d.date === prevDateStr);
    if (prevRecord) {
      const prevOpeningBalance = prevRecord.opening_balance || 0;
      const prevNetChange = calculateDayNetChange(prevDateStr);
      effectiveOpeningBalance = prevOpeningBalance + prevNetChange;
    }
  }
  // الصافي = رصيد البداية + الإيداعات - السحوبات (لليوم المختار)
  const dailyNetBalance = effectiveOpeningBalance + totalDeposits - totalWithdrawals;

  let globalNetBalance = 0;
  if (dailyBalances.length > 0) {
    const sortedByDate = [...dailyBalances].sort((a, b) =>
    normalizeDate(b.date).localeCompare(normalizeDate(a.date))
    );
    const lastDailyRecord = sortedByDate[0];

    if (lastDailyRecord) {
      const lastDate = lastDailyRecord.date;
      const lastOpeningBalance = lastDailyRecord.opening_balance || 0;

      // عمليات آخر يوم
      const lastDayTx = transactions.filter((t) => {
        const d = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
        return normalizeDate(d) === normalizeDate(lastDate);
      });
      const lastDeposits = lastDayTx.filter((t) => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
      const lastWithdrawals = lastDayTx.filter((t) => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);

      globalNetBalance = lastOpeningBalance + lastDeposits - lastWithdrawals;
    }
  }

  const handleToday = () => handleSetSelectedDate(getToday());

  const handleResetOpeningBalance = async () => {
    if (dailyRecord) {
      await base44.entities.DailyBalance.update(dailyRecord.id, { opening_balance: 0 });
      await fetchDailyBalances(currentUser?.email);
    }
  };

  const handleDeleteDailyBalanceForDate = async (dateToCheck) => {
    if (!dateToCheck || !currentUser?.email || !canWriteBalances) return;

    const normalizedTargetDate = normalizeDate(dateToCheck);
    const remainingTransactions = await base44.entities.Transaction.filter({}, "created_date", 10000);

    const hasRemainingForDate = remainingTransactions.some((t) => {
      const tDate = t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];
      return normalizeDate(tDate) === normalizedTargetDate;
    });

    if (hasRemainingForDate) return;

    const dailyBalanceRow = dailyBalances.find((d) => normalizeDate(d.date) === normalizedTargetDate);
    if (!dailyBalanceRow) return;

    await base44.entities.DailyBalance.delete(dailyBalanceRow.id);
    await fetchDailyBalances(currentUser.email);
  };

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <div className="p-2 md:p-4 space-y-2 md:space-y-4 w-full bg-[hsl(var(--sidebar-border))]">
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
          onSaveOpeningBalance={canWriteBalances ? (val) => handleSetOpeningBalance(val, selectedDate) : undefined} />
        
        <TransactionsList
          transactions={filtered}
          allTransactions={transactions}
          loading={loading}
          search={search}
          setSearch={setSearch}
          selectedDate={selectedDate}
          setSelectedDate={handleSetSelectedDate}
          onToday={handleToday}
          onCashIn={() => setShowCashIn(true)}
          onCashOut={() => setShowCashOut(true)}
          onImportPDF={() => setShowImportPDF(true)}
          onRefresh={() => fetchTransactions(currentUser?.email)}
          onResetOpeningBalance={handleResetOpeningBalance}
          onDeleteDailyBalanceForDate={handleDeleteDailyBalanceForDate} />
        
      </div>

      {showCashIn &&
      <CashInModal
        onClose={() => setShowCashIn(false)}
        onSaved={() => {setShowCashIn(false);fetchTransactions(currentUser?.email);}} />

      }
      {showImportPDF &&
      <ImportPDFModal
        onClose={() => setShowImportPDF(false)}
        onSaved={(ob, obDate) => {
          setShowImportPDF(false);
          setSearch(""); // مسح البحث
          const targetDate = obDate || selectedDate;
          if (ob !== null && ob !== undefined && targetDate) {
            handleSetOpeningBalance(ob, targetDate);
          }
          if (obDate) handleSetSelectedDate(obDate);
          fetchTransactions(currentUser?.email);
          fetchDailyBalances(currentUser?.email);
        }} />

      }
      {showCashOut &&
      <CashOutModal
        onClose={() => setShowCashOut(false)}
        onSaved={() => {setShowCashOut(false);fetchTransactions(currentUser?.email);}} />

      }
    </div>);

}