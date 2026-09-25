// The dashboard's wallet figures for one store: the opening balance of the selected day and the
// wallet's current net balance. Moved here unchanged from Dashboard.jsx so the Admin's "All stores"
// view can add them up store by store (each store has its own wallet and opening balances).

export const dayOf = (t) => t.transaction_date || new Date(t.created_date).toISOString().split("T")[0];

// DD-MM-YYYY → YYYY-MM-DD (older rows); YYYY-MM-DD is kept.
export const normalizeDate = (dateStr) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

const dayNetChange = (transactions, date) => {
  const dayTx = transactions.filter((t) => normalizeDate(dayOf(t)) === normalizeDate(date));
  const deposits = dayTx.filter((t) => t.type === "cash_in").reduce((s, t) => s + (t.amount || 0), 0);
  const withdrawals = dayTx.filter((t) => t.type === "cash_out").reduce((s, t) => s + (t.amount || 0), 0);
  return deposits - withdrawals;
};

// openingBalance: the day's own opening balance when set (non-zero); otherwise the previous day's
// opening balance plus that day's net change; otherwise 0.
// netBalance: the latest day with an opening balance, plus that day's deposits minus withdrawals.
export const walletFigures = (transactions, dailyBalances, selectedDate) => {
  const dailyRecord = dailyBalances.find((d) => d.date === selectedDate) || null;
  let openingBalance = 0;
  if (dailyRecord && dailyRecord.opening_balance && dailyRecord.opening_balance !== 0) {
    openingBalance = dailyRecord.opening_balance;
  } else {
    const prevDate = new Date(selectedDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split("T")[0];
    const prevRecord = dailyBalances.find((d) => d.date === prevDateStr);
    if (prevRecord) {
      openingBalance = (prevRecord.opening_balance || 0) + dayNetChange(transactions, prevDateStr);
    }
  }

  let netBalance = 0;
  if (dailyBalances.length > 0) {
    const last = [...dailyBalances].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))[0];
    if (last) netBalance = (last.opening_balance || 0) + dayNetChange(transactions, last.date);
  }
  return { openingBalance, netBalance, dailyRecord };
};

// The same, for several stores at once: each store's figures, added up.
export const walletFiguresByStore = (transactions, dailyBalances, selectedDate) => {
  const storeIds = new Set([...transactions.map((t) => t.store_id), ...dailyBalances.map((b) => b.store_id)]);
  return [...storeIds].reduce((sum, storeId) => {
    const figures = walletFigures(
      transactions.filter((t) => t.store_id === storeId),
      dailyBalances.filter((b) => b.store_id === storeId),
      selectedDate
    );
    return { openingBalance: sum.openingBalance + figures.openingBalance, netBalance: sum.netBalance + figures.netBalance, dailyRecord: null };
  }, { openingBalance: 0, netBalance: 0, dailyRecord: null });
};
