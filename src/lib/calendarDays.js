// The dashboard date picker's highlight: the days of the shown month that have transactions.
// daysWithData([{ date, count }]) → the dates with a count above 0 (one colour for all of them).
export const daysWithData = (days = []) => days.filter((d) => (Number(d.count) || 0) > 0).map((d) => d.date);

// Local-time helpers (the calendar works with Date objects; the app with "YYYY-MM-DD").
const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const isoMonth = (date) => isoDay(date).slice(0, 7);
// The day n days after (or before, n < 0) "YYYY-MM-DD", in the calendar (no time-zone or DST drift).
export const shiftDay = (value, n) => {
  const date = fromIsoDay(value);
  date.setDate(date.getDate() + n);
  return isoDay(date);
};
export const fromIsoDay = (value) => {
  const [y, m, d] = String(value).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
};
