// The dashboard date picker's highlights: how busy each day of the shown month is.
//
// busyLevels([{ date, count }]) → Map(date → 1..BUSY_LEVELS), relative to the month's busiest day:
// the busiest day is always the darkest shade, and any day with transactions gets at least 1.
export const BUSY_LEVELS = 4;

export const busyLevels = (days = []) => {
  const max = days.reduce((m, d) => Math.max(m, Number(d.count) || 0), 0);
  const levels = new Map();
  if (!max) return levels;
  for (const { date, count } of days) {
    const n = Number(count) || 0;
    if (n > 0) levels.set(date, Math.max(1, Math.ceil((n / max) * BUSY_LEVELS)));
  }
  return levels;
};

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
