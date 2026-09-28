import { forwardRef } from "react";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// The date picker's button: the day shown, with a calendar icon. The same button is shown before the
// calendar's code has loaded (JournalDatePicker) and as the popup's trigger (JournalCalendar).
const JournalDayButton = forwardRef(function JournalDayButton({ value, ...props }, ref) {
  const { t, num } = useI18n();
  return (
    <button
      ref={ref}
      type="button"
      data-testid="journal-date"
      aria-label={t("calendar.open", { date: value })}
      className="flex items-center gap-1.5 border rounded-lg px-2 py-1 text-sm font-bold text-[hsl(var(--foreground))] hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
      {...props}>
      <CalendarDays className="w-4 h-4 text-gray-500" aria-hidden="true" />
      <span dir="ltr">{num(value)}</span>
    </button>
  );
});

export default JournalDayButton;
