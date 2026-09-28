// The dashboard's date picker (JournalDatePicker) in tests: open it, go to a month with the month
// and year lists, and click the day (each day's accessible name starts with its ISO date).
// The calendar's code loads on demand (lazy); importing it here keeps the first open quick in tests.
import { fireEvent, screen, within } from "@testing-library/react";
import "@/components/dashboard/JournalCalendar";

export const shownDay = () => screen.getByTestId("journal-date");

export const openCalendar = async () => {
  fireEvent.click(shownDay());
  const calendar = await screen.findByTestId("journal-calendar");
  await within(calendar).findByRole("grid", {}, { timeout: 5000 }); // the lazy calendar has loaded
  return calendar;
};

export const showMonth = (calendar, iso) => {
  const [year, month] = iso.split("-").map(Number);
  fireEvent.change(calendar.querySelector('select[name="years"]'), { target: { value: String(year) } });
  fireEvent.change(calendar.querySelector('select[name="months"]'), { target: { value: String(month - 1) } });
};

export const dayButton = (calendar, iso) => within(calendar).getByRole("gridcell", { name: new RegExp(`^${iso}(?!\\d)`) });

export const pickDay = async (iso) => {
  const calendar = await openCalendar();
  showMonth(calendar, iso);
  fireEvent.click(dayButton(calendar, iso));
};
