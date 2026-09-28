import { Suspense, lazy, useState } from "react";
import JournalDayButton from "@/components/dashboard/JournalDayButton";

// The dashboard's day picker (user's request, 2026-09-28): a calendar in a popup instead of the
// browser's date field, so days can be marked (busy shades, closed-day locks; see JournalCalendar).
//
// The popup and the calendar (Radix Popover, react-day-picker, date-fns locales: ~140 kB) are a
// separate download. Until they're needed, this shows the same button; pointing at it or focusing
// it starts the download, and the first click opens the calendar as soon as it has loaded.
const loadCalendar = () => import("@/components/dashboard/JournalCalendar");
const JournalCalendar = lazy(loadCalendar);

// closedDates: the shown store's closed days (empty in "All stores", where days close per store).
export default function JournalDatePicker({ value, onChange, storeId, closedDates }) {
  const [wanted, setWanted] = useState(false);
  const prefetch = () => { loadCalendar().catch(() => {}); };

  if (!wanted) {
    return <JournalDayButton value={value} onPointerEnter={prefetch} onFocus={prefetch} onClick={() => setWanted(true)} />;
  }
  return (
    <Suspense fallback={<JournalDayButton value={value} aria-busy="true" />}>
      <JournalCalendar value={value} onChange={onChange} storeId={storeId} closedDates={closedDates} initialOpen />
    </Suspense>
  );
}
