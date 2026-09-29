// The dashboard's wallet figures for one store: the opening balance of a day and the wallet's
// current net balance. (Moved from the browser, unchanged, when the dashboard stopped loading every
// transaction: the server works them out over all rows.)
//
//   openingBalance: the day's own opening balance when set (non-zero); otherwise the previous day's
//                   opening balance plus that day's net change; otherwise 0.
//   netBalance:     the latest day with an opening balance, plus that day's cash in minus cash out.
//
// `balances`: the store's opening balances [{ date, opening_balance }]; `netOf(date)`: that store's
// cash in minus cash out on a day.

// DD-MM-YYYY → YYYY-MM-DD (older rows); YYYY-MM-DD is kept.
const normalizeDate = (dateStr) => {
  if (!dateStr) return "";
  const parts = String(dateStr).split("-");
  if (parts.length === 3 && parts[0].length === 2) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return String(dateStr);
};

const previousDay = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86400000).toISOString().slice(0, 10);
};

export const walletFigures = ({ balances, date, netOf }) => {
  const dailyRecord = balances.find((b) => b.date === date) || null;
  let openingBalance = 0;
  if (dailyRecord && dailyRecord.opening_balance && dailyRecord.opening_balance !== 0) {
    openingBalance = dailyRecord.opening_balance;
  } else {
    const prev = previousDay(date);
    const prevRecord = balances.find((b) => b.date === prev);
    if (prevRecord) openingBalance = (prevRecord.opening_balance || 0) + netOf(prev);
  }
  let netBalance = 0;
  if (balances.length) {
    const last = [...balances].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))[0];
    netBalance = (last.opening_balance || 0) + netOf(normalizeDate(last.date));
  }
  return { openingBalance, netBalance };
};
