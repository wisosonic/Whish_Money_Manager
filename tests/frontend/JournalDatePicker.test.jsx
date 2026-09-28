/** @vitest-environment jsdom */
// The dashboard's date picker: a calendar in a popup, days with transactions shaded by how busy
// they are, closed days with a 🔒, one /dashboard/days query per month shown.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JournalDatePicker from "@/components/dashboard/JournalDatePicker";
import { LanguageProvider } from "@/lib/i18n";
import { api } from "@/api/apiClient";
import { dayButton, openCalendar, showMonth, shownDay } from "./datePickerHelpers";

vi.mock("@/api/apiClient", () => ({ api: { dashboard: { days: vi.fn() } } }));

const SEPTEMBER = [
  { date: "2026-09-01", count: 1 }, { date: "2026-09-10", count: 20 }, { date: "2026-09-23", count: 40 },
];
beforeEach(() => {
  vi.clearAllMocks();
  api.dashboard.days.mockImplementation(async (month) => ({ month, days: month === "2026-09" ? SEPTEMBER : [] }));
});
afterEach(cleanup);

const renderPicker = (props = {}, lang) => {
  const onChange = vi.fn();
  const ui = <JournalDatePicker value="2026-09-23" onChange={onChange} {...props} />;
  render(lang ? <LanguageProvider initialLang={lang}>{ui}</LanguageProvider> : ui);
  return { onChange };
};
const shade = (button) => [...button.classList].find((c) => c.startsWith("day-busy-")) ?? null;

describe("JournalDatePicker", () => {
  it("replaces the date field: a button showing the day, which opens a calendar", async () => {
    renderPicker();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(shownDay()).toHaveTextContent("2026-09-23");
    expect(shownDay()).toHaveAccessibleName("اختيار اليوم (المعروض: 2026-09-23)");
    expect(screen.queryByTestId("journal-calendar")).not.toBeInTheDocument();
    const calendar = await openCalendar();
    expect(calendar.querySelector('select[name="months"]')).toHaveValue("8"); // September
    expect(calendar.querySelector('select[name="years"]')).toHaveValue("2026");
    expect(within(calendar).getByRole("combobox", { name: "الشهر" })).toBeInTheDocument();
    expect(dayButton(calendar, "2026-09-23")).toHaveAttribute("aria-selected", "true");
  });

  it("asks for the shown month's days once opened (not before), for the dashboard's store", async () => {
    renderPicker({ storeId: 2 });
    expect(api.dashboard.days).not.toHaveBeenCalled();
    await openCalendar();
    await waitFor(() => expect(api.dashboard.days).toHaveBeenCalledWith("2026-09", 2));
    expect(api.dashboard.days).toHaveBeenCalledTimes(1);
  });

  it("shades days with transactions, darker the busier, and says how many in each day's name", async () => {
    renderPicker();
    const calendar = await openCalendar();
    await waitFor(() => expect(shade(dayButton(calendar, "2026-09-10"))).toBe("day-busy-2"));
    expect(shade(dayButton(calendar, "2026-09-23"))).toBe("day-busy-4"); // the month's busiest
    expect(shade(dayButton(calendar, "2026-09-01"))).toBe("day-busy-1");
    expect(shade(dayButton(calendar, "2026-09-02"))).toBeNull(); // no transactions
    expect(dayButton(calendar, "2026-09-10")).toHaveAccessibleName("2026-09-10 · 20 عملية");
    expect(dayButton(calendar, "2026-09-02")).toHaveAccessibleName("2026-09-02 · لا عمليات");
  });

  it("closed days carry a lock, also in their name", async () => {
    renderPicker({ closedDates: new Set(["2026-09-10", "2026-09-15"]) });
    const calendar = await openCalendar();
    await waitFor(() => expect(dayButton(calendar, "2026-09-10")).toHaveAccessibleName("2026-09-10 · 20 عملية · مغلق"));
    expect(dayButton(calendar, "2026-09-15")).toHaveAccessibleName("2026-09-15 · لا عمليات · مغلق");
    expect(dayButton(calendar, "2026-09-15")).toHaveTextContent("🔒");
    expect(dayButton(calendar, "2026-09-16")).not.toHaveTextContent("🔒");
  });

  it("shows a legend for the shades and the lock", async () => {
    renderPicker();
    const legend = within(await openCalendar()).getByTestId("calendar-legend");
    expect(legend).toHaveTextContent("أقل");
    expect(legend).toHaveTextContent("أكثر");
    expect(legend).toHaveTextContent("🔒 يوم مغلق");
    expect(legend.querySelectorAll('[class*="day-busy-"]')).toHaveLength(4);
  });

  it("moving to another month asks for that month; an answer for a month left behind is ignored", async () => {
    let answerSeptember;
    api.dashboard.days.mockImplementationOnce((month) => new Promise((resolve) => { answerSeptember = () => resolve({ month, days: SEPTEMBER }); }));
    renderPicker();
    const calendar = await openCalendar();
    fireEvent.click(within(calendar).getByRole("button", { name: "الشهر التالي" }));
    await waitFor(() => expect(api.dashboard.days).toHaveBeenLastCalledWith("2026-10", undefined));
    answerSeptember();
    await new Promise((r) => setTimeout(r, 20));
    expect(calendar.querySelectorAll('[class*="day-busy-"]:not([aria-hidden])')).toHaveLength(0);

    showMonth(calendar, "2025-03");
    await waitFor(() => expect(api.dashboard.days).toHaveBeenLastCalledWith("2025-03", undefined));
  });

  it("choosing a day reports it and closes the calendar", async () => {
    const { onChange } = renderPicker();
    const calendar = await openCalendar();
    showMonth(calendar, "2025-12");
    fireEvent.click(dayButton(calendar, "2025-12-31"));
    expect(onChange).toHaveBeenCalledWith("2025-12-31");
    await waitFor(() => expect(screen.queryByTestId("journal-calendar")).not.toBeInTheDocument());
  });

  it("asks again every time it opens, so the marks are current after an import or a delete", async () => {
    renderPicker();
    await openCalendar();
    await waitFor(() => expect(api.dashboard.days).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByTestId("journal-calendar"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("journal-calendar")).not.toBeInTheDocument());
    await openCalendar();
    await waitFor(() => expect(api.dashboard.days).toHaveBeenCalledTimes(2));
  });

  it("without the counts (a failed request) the calendar still works, with no shades", async () => {
    api.dashboard.days.mockRejectedValue(new Error("offline"));
    const { onChange } = renderPicker();
    const calendar = await openCalendar();
    await waitFor(() => expect(api.dashboard.days).toHaveBeenCalled());
    expect(calendar.querySelectorAll('button[class*="day-busy-"]')).toHaveLength(0);
    fireEvent.click(dayButton(calendar, "2026-09-02"));
    expect(onChange).toHaveBeenCalledWith("2026-09-02");
  });

  it("in English: month names, labels and counts", async () => {
    renderPicker({}, "en");
    expect(shownDay()).toHaveAccessibleName("Choose the day (shown: 2026-09-23)");
    const calendar = await openCalendar();
    expect(within(calendar).getByRole("option", { name: "September" })).toBeInTheDocument();
    expect(within(calendar).getByRole("button", { name: "Next month" })).toBeInTheDocument();
    await waitFor(() => expect(dayButton(calendar, "2026-09-01")).toHaveAccessibleName("2026-09-01 · 1 transaction"));
    expect(dayButton(calendar, "2026-09-10")).toHaveAccessibleName("2026-09-10 · 20 transactions");
    expect(within(calendar).getByTestId("calendar-legend")).toHaveTextContent("Closed day");
  });

  it("Arabic weekday headers are one letter (the full name for screen readers); English two", async () => {
    renderPicker();
    let heads = [...(await openCalendar()).querySelectorAll("th")];
    expect(heads.map((th) => th.textContent)).toEqual(["س", "ح", "ن", "ث", "ر", "خ", "ج"]); // from Saturday
    expect(heads[0].getAttribute("aria-label")).toBe("السبت");
    cleanup();
    renderPicker({}, "en");
    heads = [...(await openCalendar()).querySelectorAll("th")];
    expect(heads.map((th) => th.textContent)).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
  });

  it("the first week starts under the right weekday: the empty cells before the 1st keep their width", async () => {
    // 1 September 2026 is a Tuesday. (User-reported: the empty cells collapsed, so the first week
    // slid under the wrong weekdays. jsdom has no layout, so this checks what causes it.)
    const firstWeek = (calendar) => [...calendar.querySelector("tbody tr").children];
    const cellsBeforeFirst = (calendar) => firstWeek(calendar).findIndex((td) => td.textContent.startsWith("1"));
    renderPicker();
    let calendar = await openCalendar();
    expect(cellsBeforeFirst(calendar)).toBe(3); // Saturday, Sunday, Monday
    // Every cell, empty or not, has the width of a day column (w-7, like the headers).
    const cells = [...calendar.querySelectorAll("tbody td")];
    expect(cells.length).toBeGreaterThan(30);
    cells.forEach((td) => expect(td).toHaveClass("w-7", "h-7", "shrink-0"));
    calendar.querySelectorAll("th").forEach((th) => expect(th).toHaveClass("w-7"));
    cleanup();
    renderPicker({}, "en");
    calendar = await openCalendar();
    expect(cellsBeforeFirst(calendar)).toBe(2); // Sunday, Monday
  });

  it("the calendar follows the page direction", async () => {
    renderPicker({}, "en");
    expect((await openCalendar()).querySelector(".rdp")).toHaveAttribute("dir", "ltr");
    cleanup();
    renderPicker();
    expect((await openCalendar()).querySelector(".rdp")).toHaveAttribute("dir", "rtl");
  });
});
