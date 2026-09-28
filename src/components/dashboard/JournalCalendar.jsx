import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { api } from "@/api/apiClient";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import JournalDayButton from "@/components/dashboard/JournalDayButton";
import { daysWithData, fromIsoDay, isoDay, isoMonth } from "@/lib/calendarDays";
import { useI18n } from "@/lib/i18n";

// The dashboard's date picker popup (loaded on demand by JournalDatePicker, so the dashboard's own
// bundle stays small): the day's button, and a calendar of the month.
//
// The month's counts come from GET /dashboard/days, asked each time the popup opens or shows another
// month, so they're always current after an import, a delete or any other change.
//
// Days with transactions have one colour, however many (user's request, 2026-09-28), and closed days
// carry a 🔒. Every mark is also in the day's accessible name ("2026-09-22 · 3 transactions ·
// Closed"), so none is colour-alone.

const FIRST_YEAR = 2000;

// What each day shows; a context keeps DayContent a stable component (no remount on every render).
const DayInfo = createContext({ counts: new Map(), t: (k) => k, num: String });

function DayContent({ date, activeModifiers }) {
  const { counts, t, num } = useContext(DayInfo);
  const iso = isoDay(date);
  const count = counts.get(iso) || 0;
  const label = [iso, count ? t("calendar.count", { count }) : t("calendar.none")];
  if (activeModifiers.closed) label.push(t("calendar.closed"));
  return (
    <>
      <span aria-hidden="true" title={label.slice(1).join(" · ")}>{num(date.getDate())}</span>
      {activeModifiers.closed && <span aria-hidden="true" className="absolute -top-0.5 end-0 text-[9px] leading-none">🔒</span>}
      <span className="sr-only">{label.join(" · ")}</span>
    </>
  );
}

const NO_DAYS = [];
const NO_CLOSED = new Set();

export default function JournalCalendarPopup({ value, onChange, storeId, closedDates = NO_CLOSED, initialOpen = false }) {
  const { dir } = useI18n();
  const [open, setOpen] = useState(initialOpen);
  const [month, setMonth] = useState(() => fromIsoDay(value));
  const [days, setDays] = useState({ month: "", list: NO_DAYS });
  const shownMonth = isoMonth(month);

  // Opening shows the selected day's month.
  useEffect(() => { if (open) setMonth(fromIsoDay(value)); }, [open, value]);

  // One query per month shown; an answer for a month no longer shown is ignored.
  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    Promise.resolve()
      .then(() => api.dashboard.days(shownMonth, storeId))
      .then((answer) => { if (current) setDays({ month: shownMonth, list: answer?.days || NO_DAYS }); })
      .catch(() => { if (current) setDays({ month: shownMonth, list: NO_DAYS }); }); // no marks, still usable
    return () => { current = false; };
  }, [open, shownMonth, storeId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <JournalDayButton value={value} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" dir={dir} data-testid="journal-calendar">
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          days={days.month === shownMonth ? days.list : NO_DAYS}
          closedDates={closedDates}
          value={value}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }} />
      </PopoverContent>
    </Popover>
  );
}

// month: the Date of the month shown; days: [{ date, count }] for it; value: the selected "YYYY-MM-DD".
function MonthCalendar({ month, onMonthChange, days, closedDates, value, onSelect }) {
  const { t, num, dir, lang } = useI18n();
  const counts = useMemo(() => new Map(days.map((d) => [d.date, Number(d.count) || 0])), [days]);
  const modifiers = useMemo(() => ({
    hasData: daysWithData(days).map(fromIsoDay),
    closed: [...closedDates].map(fromIsoDay),
  }), [days, closedDates]);
  const info = useMemo(() => ({ counts, t, num }), [counts, t, num]);
  const locale = lang === "ar" ? ar : enUS;

  return (
    <>
      <DayInfo.Provider value={info}>
        <Calendar
          mode="single"
          required
          initialFocus
          dir={dir}
          locale={locale}
          showOutsideDays={false}
          captionLayout="dropdown-buttons"
          fromYear={FIRST_YEAR}
          toYear={new Date().getFullYear() + 1}
          month={month}
          onMonthChange={onMonthChange}
          selected={fromIsoDay(value)}
          onSelect={(date) => { if (date) onSelect(isoDay(date)); }}
          modifiers={modifiers}
          modifiersClassNames={{ hasData: "day-has-data", closed: "day-closed" }}
          formatters={{
            formatMonthCaption: (date) => t(`months.${date.getMonth() + 1}`),
            formatYearCaption: (date) => num(date.getFullYear()),
            // Arabic's short names are whole words, too wide for the column: one letter (ح ن ث …).
            // Screen readers still hear the full name (the header cell's aria-label).
            formatWeekdayName: (date) => format(date, lang === "ar" ? "EEEEE" : "EEEEEE", { locale }),
          }}
          labels={{
            labelMonthDropdown: () => t("calendar.month"),
            labelYearDropdown: () => t("calendar.year"),
            labelPrevious: () => t("calendar.previous"),
            labelNext: () => t("calendar.next"),
          }}
          components={{ DayContent }}
          classNames={{
            // px-8 keeps the month and year lists clear of the arrows (the grid is only 220px wide).
            caption: "flex justify-center pt-1 relative items-center min-h-8 px-8",
            caption_dropdowns: "flex gap-1",
            caption_label: "hidden",
            vhidden: "sr-only",
            dropdown: "rounded-md border px-1 py-0.5 text-xs bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-300",
            nav_button_previous: "absolute start-1",
            nav_button_next: "absolute end-1",
            // A gap between the days (user's request): highlighted days next to each other stay apart.
            table: "w-full border-collapse",
            head_row: "flex gap-1",
            row: "flex w-full gap-1 mt-1",
            head_cell: "text-muted-foreground rounded-md w-7 font-normal text-[0.8rem]",
            // Every cell has the day's size, including the empty ones before the 1st (days of other
            // months are hidden): without it they collapsed and the first week slid under the wrong
            // weekdays (user-reported).
            cell: "relative h-7 w-7 shrink-0 p-0 text-center text-sm focus-within:relative focus-within:z-20",
            day: "relative inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-sm font-normal transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 aria-selected:opacity-100",
            day_today: "font-bold underline underline-offset-2",
          }} />
      </DayInfo.Provider>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-gray-600" data-testid="calendar-legend">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="day-has-data inline-block h-3 w-3 rounded-sm border" />
          {t("calendar.hasData")}
        </span>
        <span><span aria-hidden="true">🔒</span> {t("calendar.closedLegend")}</span>
      </div>
    </>
  );
}
