/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import AppToaster from "@/components/layout/AppToaster";
import { clearToasts, findToast } from "./toastHelpers";
import { installFakeDashboard } from "./fakeDashboardApi";
import { dayButton, openCalendar, pickDay, shownDay } from "./datePickerHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin"));

vi.mock("@/components/layout/Header", () => ({ default: () => null }));
// A stand-in for the real import screen: a button that fires onSaved with args the test controls,
// so the race between the import flow and the opening-balance save can be driven directly (see
// "an import to a different day" below) without going through the real upload / preview steps.
vi.mock("@/components/transactions/ImportPDFModal", () => ({
  default: ({ onSaved }) => (
    <button data-testid="fake-import-saved" onClick={() => onSaved("2026-01-01")}>fake import saved</button>
  ),
}));
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { me: vi.fn() },
    entities: {
      Transaction: { filter: vi.fn(), update: vi.fn(), delete: vi.fn() },
      DailyBalance: { filter: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
    closedDays: { list: vi.fn(), close: vi.fn(), reopen: vi.fn() },
    commissionRates: { get: vi.fn() },
    dashboard: { day: vi.fn(), days: vi.fn(), summary: vi.fn(), search: vi.fn(), party: vi.fn(), cleanupBalances: vi.fn() },
  },
}));

const stored = [
  {
    id: 1, type: "cash_out", amount: 1500, commission: 0, sender_name: "Vicario", receiver_name: "",
    phone: "+96171389296", customer_number: "71389296", service: "W2W", reference_number: "tr:1",
    transaction_date: "2026-09-23", sort_order: 0, created_date: "2026-09-23T10:00:00Z",
  },
  {
    id: 2, type: "cash_in", amount: 50, commission: 0.5, sender_name: "MOUNIR TOSKA", receiver_name: "Vicario",
    phone: "96171588017", customer_number: "71588017", service: "", reference_number: "tr:2",
    transaction_date: "2026-09-23", sort_order: 1, created_date: "2026-09-23T11:00:00Z",
  },
  {
    id: 3, type: "cash_in", amount: 20, commission: 0.2, sender_name: "OTHER DAY", receiver_name: "Vicario",
    reference_number: "tr:3", transaction_date: "2026-09-22", sort_order: 0, created_date: "2026-09-22T11:00:00Z",
  },
  {
    id: 4, type: "cash_in", amount: 300, commission: 3, sender_name: "EARLIER MONTH", receiver_name: "Vicario",
    reference_number: "tr:4", transaction_date: "2026-06-06", sort_order: 0, created_date: "2026-06-06T11:00:00Z",
  },
  {
    id: 5, type: "cash_out", amount: 999, commission: 0, sender_name: "Vicario", receiver_name: "LAST YEAR",
    reference_number: "tr:5", transaction_date: "2025-12-31", sort_order: 0, created_date: "2025-12-31T11:00:00Z",
  },
];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("selectedDate", "2026-09-23");
  api.auth.me.mockResolvedValue({ email: "local@hawalaflow.app" });
  api.entities.Transaction.filter.mockResolvedValue(stored);
  api.entities.DailyBalance.filter.mockResolvedValue([]);
  api.closedDays.list.mockResolvedValue([]);
  api.commissionRates.get.mockResolvedValue({ rate: 1 });
  installFakeDashboard(api, () => stored);
});

// The server's answer for 2026-09-23 (what api.dashboard.day returns), for held-open refreshes.
const dayAnswer = (rows) => {
  const transactions = rows.filter((t) => t.transaction_date === "2026-09-23").map((t, i) => ({ ...t, day_position: i + 1 }));
  return { date: "2026-09-23", total: transactions.length, truncated: false, transactions };
};

afterEach(cleanup);

const rowCount = (container) => container.querySelectorAll("tbody tr").length;
const search = (value) => fireEvent.change(screen.getByPlaceholderText(/ابحث عن اسم/), { target: { value } });

const thisDayOnly = () => fireEvent.click(screen.getByTestId("search-scope-day"));
const allDays = () => fireEvent.click(screen.getByTestId("search-scope-all"));
const thisMonth = () => fireEvent.click(screen.getByTestId("search-scope-month"));
const senders = (container) => [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[3].textContent);

describe("Dashboard search — this day", () => {
  it("shows only the selected day's transactions", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.queryByText("OTHER DAY")).not.toBeInTheDocument();
  });

  it.each([
    ["the customer number shown in the receiver column", "71389296", 1],
    ["a phone typed with spaces and country code", "+961 71 389 296", 1],
    ["the service", "w2w", 1],
    ["an amount with $ and comma", "$1,500", 1],
    ["a name with stray spaces", "  mounir ", 1],
    ["the account holder on every row", "vicario", 2],
  ])("finds %s", async (_label, term, expected) => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    thisDayOnly();
    search(term);
    await waitFor(() => expect(rowCount(container)).toBe(expected));
  });

  it("shows the empty state when nothing matches", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    thisDayOnly();
    search("no-such-thing");
    expect(await screen.findByText("لا توجد معاملات")).toBeInTheDocument();
  });
});

describe("Dashboard search — all days", () => {
  it("the scope switch comes first in the search row, before the search box", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const scope = screen.getByTestId("search-scope");
    const row = scope.parentElement;
    expect(row.firstElementChild).toBe(scope);
    const searchBox = screen.getByPlaceholderText(/بحث/);
    expect(scope.compareDocumentPosition(searchBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("searches every day by default; the switch shows which scope is active", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.getByTestId("search-scope-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("search-scope-day")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: "البحث في" })).toBeInTheDocument();

    search("vicario");
    // The account holder is on all 5 rows, over 4 days, in journal order (oldest day first).
    await waitFor(() => expect(rowCount(container)).toBe(5));
    expect(screen.getByTestId("all-days-results")).toHaveTextContent("5 نتيجة في 4 يوم");
    expect(senders(container)).toEqual(["Vicario", "EARLIER MONTH", "OTHER DAY", "Vicario", "MOUNIR TOSKA"]);
  });

  it("finds a transaction that isn't on the selected day", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("EARLIER");
    await waitFor(() => expect(rowCount(container)).toBe(1));
    expect(screen.getByText("EARLIER MONTH")).toBeInTheDocument();
    expect(screen.getByTestId("all-days-results")).toHaveTextContent("1 نتيجة في 1 يوم");
  });

  it("without a search, the table still shows just the selected day", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.queryByTestId("all-days-results")).not.toBeInTheDocument();
    expect(screen.queryByText("OTHER DAY")).not.toBeInTheDocument();
  });

  it("switching to 'this day' narrows the results, and back again widens them", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("vicario");
    await waitFor(() => expect(rowCount(container)).toBe(5));
    thisDayOnly();
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.queryByTestId("all-days-results")).not.toBeInTheDocument();
    allDays();
    await waitFor(() => expect(rowCount(container)).toBe(5));
  });

  it("'#' shows each row's number within its own day, and rows from other days name their day", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("vicario");
    await waitFor(() => expect(rowCount(container)).toBe(5));
    const numbers = [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[1].textContent);
    expect(numbers).toEqual(["1", "1", "1", "1", "2"]);
    expect(screen.getByLabelText("تحديد العملية 1 بتاريخ 2026-09-22")).toBeInTheDocument();
    expect(screen.getByLabelText("تحديد العملية 2")).toBeInTheDocument();
  });

  it("clicking a result's date opens that day and clears the search", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("OTHER DAY");
    await waitFor(() => expect(rowCount(container)).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "2026-09-22" }));
    await waitFor(() => expect(shownDay()).toHaveTextContent("2026-09-22"));
    expect(screen.getByPlaceholderText(/ابحث عن اسم/)).toHaveValue("");
    expect(screen.queryByTestId("all-days-results")).not.toBeInTheDocument();
    expect(senders(container)).toEqual(["OTHER DAY"]);
  });

  it("the day's totals never include other days' results", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const card = () => screen.getByText("إيداعات اليوم").parentElement.textContent;
    const before = card();
    search("EARLIER"); // matches a $300 deposit in June, none on the selected day
    await waitFor(() => expect(rowCount(container)).toBe(1));
    // With a search, the day card shows the selected day's matches (none), never June's $300.
    expect(card()).not.toContain("300");
    expect(before).toContain("50");
    thisDayOnly();
    await waitFor(() => expect(rowCount(container)).toBe(0));
    // Same figure in both scopes: the scope only changes the table.
    const dayScope = card();
    allDays();
    await waitFor(() => expect(rowCount(container)).toBe(1));
    expect(card()).toBe(dayScope);
  });

  it("'delete all for this day' is hidden while showing results from all days", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.getByRole("button", { name: /مسح الكل/ })).toBeInTheDocument();
    search("vicario");
    await waitFor(() => expect(rowCount(container)).toBe(5));
    expect(screen.queryByRole("button", { name: /مسح الكل/ })).not.toBeInTheDocument();
  });

  it("shows an all-days empty state when nothing matches anywhere", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("no-such-thing");
    expect(await screen.findByText("لا توجد معاملات مطابقة في أي يوم")).toBeInTheDocument();
    expect(screen.getByTestId("all-days-results")).toHaveTextContent("0 نتيجة في 0 يوم");
  });
});

describe("Dashboard search — this month", () => {
  it("offers three scopes, widest first: all days, this month, this day", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const buttons = within(screen.getByTestId("search-scope")).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["كل الأيام", "هذا الشهر", "هذا اليوم"]);
    thisMonth();
    expect(screen.getByTestId("search-scope-month")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("search-scope-all")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("search-scope-day")).toHaveAttribute("aria-pressed", "false");
  });

  it("finds matches on every day of the selected date's month, and nowhere else", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    thisMonth();
    search("vicario");
    // September 2026: ids 3 (the 22nd), 1 and 2 (the 23rd); not June's or last December's.
    await waitFor(() => expect(rowCount(container)).toBe(3));
    expect(senders(container)).toEqual(["OTHER DAY", "Vicario", "MOUNIR TOSKA"]);
    expect(screen.getByTestId("all-days-results")).toHaveTextContent("3 نتيجة في 2 يوم");
    expect(api.dashboard.search).toHaveBeenLastCalledWith("vicario", "2026-09");
    // Like all days: per-day "#", and a date that opens its day.
    const numbers = [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[1].textContent);
    expect(numbers).toEqual(["1", "1", "2"]);
    expect(screen.getByRole("button", { name: "2026-09-22" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /مسح الكل/ })).not.toBeInTheDocument();
  });

  it("follows the date picker to another month", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    thisMonth();
    search("vicario");
    await waitFor(() => expect(rowCount(container)).toBe(3));
    await pickDay("2026-06-01");
    await waitFor(() => expect(senders(container)).toEqual(["EARLIER MONTH"]));
    expect(api.dashboard.search).toHaveBeenLastCalledWith("vicario", "2026-06");
  });

  it("a match outside the month isn't shown; the empty state says 'this month'", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    thisMonth();
    search("EARLIER"); // June only
    expect(await screen.findByText("لا توجد معاملات مطابقة في هذا الشهر")).toBeInTheDocument();
    expect(rowCount(container)).toBe(0);
    allDays();
    await waitFor(() => expect(rowCount(container)).toBe(1)); // all days finds it
  });

  it("the day's totals still count the selected day only", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const card = () => screen.getByText("إيداعات اليوم").parentElement.textContent;
    thisDayOnly();
    search("vicario");
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const dayScope = card();
    thisMonth();
    await waitFor(() => expect(rowCount(container)).toBe(3));
    expect(card()).toBe(dayScope); // the 22nd's $20 isn't added
    expect(card()).not.toContain("70");
  });

  it("in English", async () => {
    const { LanguageProvider } = await import("@/lib/i18n");
    const { container } = render(<LanguageProvider initialLang="en"><Dashboard /></LanguageProvider>);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.getByTestId("search-scope-month")).toHaveTextContent("This month");
    thisMonth();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "EARLIER" } });
    expect(await screen.findByText("No matching transactions this month")).toBeInTheDocument();
  });
});

describe("Dashboard summaries", () => {
  const renderLoaded = async () => {
    const utils = render(<Dashboard />);
    await waitFor(() => expect(rowCount(utils.container)).toBe(2));
    return utils;
  };

  it("monthly summary covers the selected date's month and is expanded", async () => {
    await renderLoaded();
    const monthly = screen.getByTestId("monthly-summary");
    // September 2026: ids 1, 2, 3 — deposits 50 + 20, withdrawals 1500, commission 0.7
    expect(within(monthly).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true");
    expect(within(monthly).getByText("عمليات الشهر").nextSibling).toHaveTextContent("3");
    expect(within(monthly).getByText("عمولات الشهر").nextSibling).toHaveTextContent("$0.70");
    expect(within(monthly).getByText("مجموع الإيداعات").nextSibling).toHaveTextContent("$70.00");
    expect(within(monthly).getByText("مجموع السحوبات").nextSibling).toHaveTextContent("$1,500.00");
  });

  it("yearly summary covers the selected date's year and is collapsed until opened", async () => {
    await renderLoaded();
    const yearly = screen.getByTestId("yearly-summary");
    // 2026: ids 1–4 (not the 2025 row) — deposits 370, withdrawals 1500, commission 3.7
    expect(within(yearly).getByText("4 عملية · عمولات $3.70")).toBeInTheDocument();

    fireEvent.click(within(yearly).getAllByRole("button")[0]);
    expect(within(yearly).getByText("عمليات السنة").nextSibling).toHaveTextContent("4");
    expect(within(yearly).getByText("مجموع الإيداعات").nextSibling).toHaveTextContent("$370.00");
    expect(within(yearly).getByText("مجموع السحوبات").nextSibling).toHaveTextContent("$1,500.00");
  });

  it("summaries follow the date picker", async () => {
    await renderLoaded();
    await pickDay("2025-12-31");
    const yearly = screen.getByTestId("yearly-summary");
    await waitFor(() => expect(within(yearly).getByText("2025")).toBeInTheDocument());
    expect(within(yearly).getByText("1 عملية · عمولات $0.00")).toBeInTheDocument();
    const monthly = screen.getByTestId("monthly-summary");
    expect(within(monthly).getByText("عمليات الشهر").nextSibling).toHaveTextContent("1");
    expect(within(monthly).getByText("ديسمبر 2025")).toBeInTheDocument();
  });
});

describe("Dashboard — roles", () => {
  it("asks the server for the selected day and its figures (no per-user filter)", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(api.dashboard.day).toHaveBeenCalledWith("2026-09-23");
    expect(api.dashboard.summary).toHaveBeenCalledWith("2026-09-23");
    // The browser no longer downloads every transaction.
    expect(api.entities.Transaction.filter).not.toHaveBeenCalled();
  });

  it("Admin/Manager can edit the opening balance; a User can't", async () => {
    const { container, unmount } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.getByLabelText("تعديل رصيد البداية")).toBeInTheDocument();
    unmount();

    setAuthRole("user");
    const second = render(<Dashboard />);
    await waitFor(() => expect(rowCount(second.container)).toBe(2));
    expect(screen.queryByLabelText("تعديل رصيد البداية")).not.toBeInTheDocument();
  });

  it("saving the opening balance is confirmed; a failure is reported", async () => {
    const { container } = render(<><Dashboard /><AppToaster /></>);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const setBalance = (value) => {
      fireEvent.click(screen.getByLabelText("تعديل رصيد البداية"));
      const input = container.querySelector('input[type="number"]');
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    };

    api.entities.DailyBalance.create.mockRejectedValueOnce(new Error(""));
    setBalance("250");
    expect(await findToast("تعذّر حفظ رصيد البداية.")).toHaveAttribute("data-type", "error");

    api.entities.DailyBalance.create.mockResolvedValueOnce({ id: 1 });
    setBalance("300");
    expect(await findToast("تم حفظ رصيد البداية لتاريخ 2026-09-23.")).toHaveAttribute("data-type", "success");
    expect(api.entities.DailyBalance.create).toHaveBeenLastCalledWith({ date: "2026-09-23", opening_balance: 300 });
    clearToasts();
  });
});

describe("Dashboard — keeps the user's place after saving", () => {
  // The bug: every refresh swapped the table for a short "loading" line, the page shrank below the
  // window, and the browser jumped to the top. jsdom has no layout, so these tests pin the cause:
  // during a refresh the table stays mounted (same row elements), and "loading" never replaces it.
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };
  const rowFor = (container, text) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(text));

  beforeEach(() => {
    api.entities.Transaction.update.mockResolvedValue({});
    api.entities.Transaction.delete.mockResolvedValue({ ok: true });
  });

  it("shows the loading line only on the very first load", async () => {
    const first = deferred();
    api.dashboard.day.mockReturnValueOnce(first.promise);
    const { container } = render(<Dashboard />);
    expect(await screen.findByText("جاري التحميل...")).toBeInTheDocument();
    first.resolve(dayAnswer(stored));
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
  });

  it("after editing and saving, the table stays on screen while it refreshes, then updates in place", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const rowBefore = rowFor(container, "MOUNIR TOSKA");

    // The refresh after saving is slow: hold it open to inspect the in-between state.
    const refresh = deferred();
    api.dashboard.day.mockReturnValueOnce(refresh.promise);

    fireEvent.click(within(rowBefore).getByTitle("تعديل"));
    fireEvent.change(screen.getByDisplayValue("50"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));
    await waitFor(() => expect(api.entities.Transaction.update).toHaveBeenCalledWith(2, expect.objectContaining({ amount: 75 })));
    await waitFor(() => expect(screen.queryByText("تعديل العملية")).not.toBeInTheDocument());

    // Mid-refresh: no loading line, the same rows (same DOM elements) are still there.
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
    expect(rowCount(container)).toBe(2);
    expect(rowFor(container, "MOUNIR TOSKA")).toBe(rowBefore);

    refresh.resolve(dayAnswer(stored.map((t) => (t.id === 2 ? { ...t, amount: 75 } : t))));
    await waitFor(() => expect(within(rowBefore).getByText("$75.00")).toBeInTheDocument());
    // Updated in place — React reused the same row element rather than rebuilding the table.
    expect(rowFor(container, "MOUNIR TOSKA")).toBe(rowBefore);
  });

  it("deleting a row also refreshes without blanking the table", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const survivor = rowFor(container, "Vicario");

    // Hold every day query open (the refresh after the delete).
    const refresh = deferred();
    api.dashboard.day.mockImplementation(() => refresh.promise);
    const target = rowFor(container, "MOUNIR TOSKA");
    fireEvent.click(within(target).getByTitle("مسح"));
    fireEvent.click(within(target).getByText("تأكيد"));
    await waitFor(() => expect(api.entities.Transaction.delete).toHaveBeenCalledWith(2));

    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
    expect(rowCount(container)).toBe(2);

    refresh.resolve(dayAnswer(stored.filter((t) => t.id !== 2)));
    await waitFor(() => expect(rowCount(container)).toBe(1));
    expect(rowFor(container, "Vicario")).toBe(survivor);
  });

  it("never scrolls the page itself during a refresh", async () => {
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      const { container } = render(<Dashboard />);
      await waitFor(() => expect(rowCount(container)).toBe(2));
      const callsBefore = api.dashboard.day.mock.calls.length;
      fireEvent.click(within(rowFor(container, "MOUNIR TOSKA")).getByTitle("تعديل"));
      fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));
      await waitFor(() => expect(api.dashboard.day.mock.calls.length).toBe(callsBefore + 1));
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      scrollSpy.mockRestore();
    }
  });
});

describe("Dashboard — an import to a different day (user-reported, 2026-09-30)", () => {
  // The original bug: after clearing every transaction and importing a fresh statement (for a
  // different day than the one shown), the table flickered and then went blank until the page was
  // reloaded. Cause: onSaved both moved the selected day to the statement's own day (a good fetch)
  // *and* called handleSetOpeningBalance, whose own trailing refresh closed over the *old*
  // selectedDate; once that balance write's round trip finished, the stale refresh could fire after
  // the good one and win the race — showing the old (now empty) day again.
  //
  // Fixed two ways: the guard below (still exercised by the opening-balance pencil, the only
  // remaining caller of handleSetOpeningBalance), and — since this specific report — the import flow
  // no longer writes any opening balance client-side at all: every day the statement covers is now
  // saved atomically on the server, in the same transaction as the import itself (user's request,
  // 2026-09-30). So the race this section is named for can no longer happen *through an import*.
  it("importing never touches DailyBalance itself — every day's balance is saved server-side, with the transactions", async () => {
    const reimported = [{
      id: 10, type: "cash_in", amount: 77, commission: 0, sender_name: "REIMPORTED", receiver_name: "Office",
      reference_number: "tr:10", transaction_date: "2026-01-01", sort_order: 0, created_date: "2026-01-01T09:00:00Z",
    }];
    installFakeDashboard(api, () => [...stored, ...reimported]);

    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    // Mock call counts aren't reset between tests in this file; count from here, since something
    // else (the opening-balance pencil, exercised by an earlier test) may already have called these.
    const before = {
      filter: api.entities.DailyBalance.filter.mock.calls.length,
      create: api.entities.DailyBalance.create.mock.calls.length,
      update: api.entities.DailyBalance.update.mock.calls.length,
    };
    fireEvent.click(screen.getByText("استيراد PDF / CSV"));
    fireEvent.click(screen.getByTestId("fake-import-saved"));
    await screen.findByText("REIMPORTED");
    expect(api.entities.DailyBalance.filter.mock.calls.length).toBe(before.filter);
    expect(api.entities.DailyBalance.create.mock.calls.length).toBe(before.create);
    expect(api.entities.DailyBalance.update.mock.calls.length).toBe(before.update);
  });

  // The guard itself (selectedDateRef / fetchDayRef in Dashboard.jsx) is still real and still needed:
  // the opening-balance pencil calls the very same handleSetOpeningBalance, and its own round trip
  // can just as easily outlast a day change that happens to land while it's in flight.
  it("the opening-balance pencil's own slow save doesn't blank a day navigated to while it was pending", async () => {
    let resolveFilter;
    api.entities.DailyBalance.filter.mockReturnValue(new Promise((resolve) => { resolveFilter = resolve; }));
    api.entities.DailyBalance.create.mockResolvedValue({ id: 99 });

    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2)); // 2026-09-23

    fireEvent.click(screen.getByLabelText("تعديل رصيد البداية"));
    const input = container.querySelector('input[type="number"]');
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.keyDown(input, { key: "Enter" }); // starts the (held-open) save for 2026-09-23

    // Meanwhile, before that save's own round trip finishes, the day is changed.
    fireEvent.click(screen.getByTestId("previous-day")); // 2026-09-22 (row 3, "OTHER DAY")
    await screen.findByText("OTHER DAY");

    resolveFilter([]);
    await waitFor(() => expect(api.entities.DailyBalance.create).toHaveBeenCalled());

    // The stale save (for a day no longer shown) must not refresh the table back to it.
    expect(screen.getByText("OTHER DAY")).toBeInTheDocument();
    expect(screen.queryByText("MOUNIR TOSKA")).not.toBeInTheDocument();
  });
});

describe("Dashboard — one server query per day (user's report)", () => {
  // Day 1 has 100 transactions, day 2 has 1,000 newer ones. The page used to download the newest
  // 10,000 rows and pick the day out of them, so an older day could come up empty.
  const bulk = (day, count, from) => Array.from({ length: count }, (_, i) => ({
    id: from + i, type: "cash_in", amount: 1, commission: 0.01, sender_name: `S${day}-${i}`, receiver_name: "",
    reference_number: `tr:${from + i}`, transaction_date: day, sort_order: i, created_date: `${day}T10:00:00Z`,
  }));
  const days = [...bulk("2026-09-01", 100, 1), ...bulk("2026-09-02", 1000, 1000)];

  it("choosing a day asks the server for that day, and shows all of its rows", async () => {
    installFakeDashboard(api, () => days);
    window.localStorage.setItem("selectedDate", "2026-09-02");
    render(<Dashboard />);
    // Rendering 1,000 rows is slow in jsdom when the whole suite runs at once.
    await waitFor(() => expect(screen.getByText("S2026-09-02-999")).toBeInTheDocument(), { timeout: 15000 });
    expect(api.dashboard.day).toHaveBeenLastCalledWith("2026-09-02");

    await pickDay("2026-09-01");
    await waitFor(() => expect(api.dashboard.day).toHaveBeenLastCalledWith("2026-09-01"));
    await waitFor(() => expect(screen.getByText("S2026-09-01-99")).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.queryByText("S2026-09-02-0")).not.toBeInTheDocument();
    expect(api.dashboard.summary).toHaveBeenLastCalledWith("2026-09-01");
  }, 40000);

  it("an answer for a day no longer shown is ignored", async () => {
    const slow = { promise: null, resolve: null };
    slow.promise = new Promise((r) => { slow.resolve = r; });
    installFakeDashboard(api, () => stored);
    const answer = api.dashboard.day.getMockImplementation();
    api.dashboard.day.mockImplementationOnce(() => slow.promise); // 2026-09-23, still loading
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(api.dashboard.day).toHaveBeenCalledWith("2026-09-23"));
    await pickDay("2026-09-22");
    await waitFor(() => expect(screen.getByText("OTHER DAY")).toBeInTheDocument());
    slow.resolve(await answer("2026-09-23"));
    await new Promise((r) => setTimeout(r, 20));
    expect(rowCount(container)).toBe(1);
    expect(screen.queryByText("MOUNIR TOSKA")).not.toBeInTheDocument();
  });

  it("the date picker highlights the days that have transactions, from the server's counts", async () => {
    installFakeDashboard(api, () => days);
    window.localStorage.setItem("selectedDate", "2026-09-01");
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("S2026-09-01-99")).toBeInTheDocument(), { timeout: 15000 });
    const calendar = await openCalendar();
    await waitFor(() => expect(api.dashboard.days).toHaveBeenLastCalledWith("2026-09", undefined));
    // 1,000 rows and 100 rows: the same one colour.
    await waitFor(() => expect(dayButton(calendar, "2026-09-02")).toHaveClass("day-has-data"));
    expect(dayButton(calendar, "2026-09-01")).toHaveClass("day-has-data");
    expect(dayButton(calendar, "2026-09-01")).toHaveAccessibleName("2026-09-01 · 100 عملية");
    expect(dayButton(calendar, "2026-09-03")).not.toHaveClass("day-has-data");
    // Choosing a highlighted day opens it.
    fireEvent.click(dayButton(calendar, "2026-09-02"));
    await waitFor(() => expect(api.dashboard.day).toHaveBeenLastCalledWith("2026-09-02"));
    expect(shownDay()).toHaveTextContent("2026-09-02");
  }, 40000);

  it("says so when a day has more rows than the page shows (the 10,000 rule)", async () => {
    installFakeDashboard(api, () => stored, () => [], { maxRows: 1 });
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(1));
    expect(screen.getByTestId("list-truncated")).toHaveTextContent("عرض أول 1 من أصل 2 عملية");
  });

  it("the day's and month's figures come from the server, over every row", async () => {
    installFakeDashboard(api, () => stored, () => [], { maxRows: 1 });
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(1));
    // Only one row is listed, but the day card counts both deposits and withdrawals.
    expect(screen.getByText("سحوبات اليوم").parentElement).toHaveTextContent("1,500");
    expect(screen.getByText("إيداعات اليوم").parentElement).toHaveTextContent("50");
    expect(within(screen.getByTestId("monthly-summary")).getByText("عمليات الشهر").nextSibling).toHaveTextContent("3");
  });

  it("all-days search results are capped too, with the same notice", async () => {
    installFakeDashboard(api, () => stored, () => [], { maxRows: 2 });
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("vicario");
    await waitFor(() => expect(screen.getByTestId("list-truncated")).toHaveTextContent("عرض أول 2 من أصل 5 عملية"));
    expect(api.dashboard.search).toHaveBeenLastCalledWith("vicario", undefined);
  });
});

describe("Dashboard — previous / next day arrows (user's request)", () => {
  it("sit on either side of the date button, and move one day back or forward (a new server query each)", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const stepper = screen.getByTestId("day-stepper");
    expect([...stepper.children].map((el) => el.dataset.testid)).toEqual(["previous-day", "journal-date", "next-day"]);
    expect(screen.getByTestId("previous-day")).toHaveAccessibleName("اليوم السابق");
    expect(screen.getByTestId("next-day")).toHaveAccessibleName("اليوم التالي");

    fireEvent.click(screen.getByTestId("previous-day"));
    await waitFor(() => expect(api.dashboard.day).toHaveBeenLastCalledWith("2026-09-22"));
    expect(shownDay()).toHaveTextContent("2026-09-22");
    await waitFor(() => expect(senders(container)).toEqual(["OTHER DAY"]));
    expect(api.dashboard.summary).toHaveBeenLastCalledWith("2026-09-22");

    fireEvent.click(screen.getByTestId("next-day"));
    fireEvent.click(screen.getByTestId("next-day"));
    await waitFor(() => expect(api.dashboard.day).toHaveBeenLastCalledWith("2026-09-24"));
    expect(shownDay()).toHaveTextContent("2026-09-24");
    expect(await screen.findByText("لا توجد معاملات")).toBeInTheDocument();
    // The day shown is remembered, as with the calendar.
    expect(document.cookie).toContain("wmm_selected_date=2026-09-24");
  });

  it("cross months and years", async () => {
    window.localStorage.setItem("selectedDate", "2026-01-01");
    render(<Dashboard />);
    await waitFor(() => expect(shownDay()).toHaveTextContent("2026-01-01"));
    fireEvent.click(screen.getByTestId("previous-day"));
    await waitFor(() => expect(shownDay()).toHaveTextContent("2025-12-31"));
    fireEvent.click(screen.getByTestId("next-day"));
    fireEvent.click(screen.getByTestId("next-day"));
    await waitFor(() => expect(shownDay()).toHaveTextContent("2026-01-02"));
  });

  it("point the way the page reads: flipped in Arabic (previous is at the start, on the right)", async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByTestId("previous-day")).toBeInTheDocument());
    ["previous-day", "next-day"].forEach((id) => expect(screen.getByTestId(id).querySelector("svg")).toHaveClass("rtl:rotate-180"));
  });

  it("in English", async () => {
    const { LanguageProvider } = await import("@/lib/i18n");
    render(<LanguageProvider initialLang="en"><Dashboard /></LanguageProvider>);
    await waitFor(() => expect(screen.getByTestId("previous-day")).toHaveAccessibleName("Previous day"));
    expect(screen.getByTestId("next-day")).toHaveAccessibleName("Next day");
  });
});

describe("Dashboard — sticky table header (user's request)", () => {
  // jsdom has no layout: these pin what makes it stick (checked in Edge).
  it("the column names stick to the top of the table's own scroll box, one screen tall below the app header", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const head = screen.getByTestId("table-head");
    expect(head.tagName).toBe("THEAD");
    expect(head).toHaveClass("sticky", "top-0", "z-10", "bg-gray-50"); // opaque, above the rows
    const box = screen.getByTestId("table-scroll");
    expect(box).toContainElement(head);
    expect(box).toHaveClass("overflow-auto"); // the box scrolls both ways (sideways on phones)
    expect(box.className).toMatch(/max-h-\[calc\(100vh_-_var\(--app-header-height,0px\)_-_1rem\)\]/);
  });

  it("the scroll box isn't rebuilt when the table reloads, so its scroll position is kept", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const box = screen.getByTestId("table-scroll");
    box.scrollTop = 300; // scrolled down inside the box
    // Between two days that both have rows (an empty day shows its message instead of the table).
    fireEvent.click(screen.getByTestId("previous-day"));
    await waitFor(() => expect(rowCount(container)).toBe(1));
    fireEvent.click(screen.getByTestId("next-day"));
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.getByTestId("table-scroll")).toBe(box); // the same element, never swapped for "loading"
    expect(box.scrollTop).toBe(300);
  });
});

describe("Dashboard — delete all for this day during a search (user-reported)", () => {
  it("the dialog counts the whole day, which is what gets deleted, and says the search hides some", async () => {
    api.entities.Transaction.delete.mockReset();
    api.entities.Transaction.delete.mockResolvedValue({ ok: true });
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    thisDayOnly();
    search("mounir");
    await waitFor(() => expect(rowCount(container)).toBe(1)); // the search shows 1 of the day's 2
    fireEvent.click(screen.getByRole("button", { name: /مسح الكل/ }));
    expect(screen.getByTestId("delete-all-count")).toHaveTextContent("2 عملية");
    expect(screen.getByTestId("delete-all-search-note")).toHaveTextContent("البحث يعرض 1 منها فقط: سيتم حذف كل عمليات اليوم (2)");
    const confirmButton = within(screen.getByTestId("delete-all-count").closest(".rounded-2xl")).getByRole("button", { name: /مسح الكل/ });
    expect(confirmButton).toBeDisabled(); // requires the shown count typed first
    fireEvent.change(screen.getByTestId("delete-all-confirm-input"), { target: { value: "2" } });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(api.entities.Transaction.delete).toHaveBeenCalledTimes(2));
    expect(api.entities.Transaction.delete.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
  });

  it("without a search there is no note, and the count is the day's", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: /مسح الكل/ }));
    expect(screen.getByTestId("delete-all-count")).toHaveTextContent("2 عملية");
    expect(screen.queryByTestId("delete-all-search-note")).not.toBeInTheDocument();
  });
});

describe("Dashboard — clearing the search (user's request)", () => {
  it("an ✕ appears once something is typed; it clears the search, shows the day again and keeps the cursor in the box", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.queryByTestId("clear-search")).not.toBeInTheDocument(); // nothing to clear yet
    thisDayOnly();
    search("mounir");
    await waitFor(() => expect(rowCount(container)).toBe(1));
    const clear = screen.getByRole("button", { name: "مسح البحث" });
    expect(clear).toHaveAttribute("title", "مسح البحث");
    fireEvent.click(clear);
    expect(screen.getByTestId("search-input")).toHaveValue("");
    expect(screen.getByTestId("search-input")).toHaveFocus();
    expect(screen.queryByTestId("clear-search")).not.toBeInTheDocument();
    await waitFor(() => expect(rowCount(container)).toBe(2));
  });

  it("clears an all-days search too (back to the selected day)", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("vicario");
    await waitFor(() => expect(screen.getByTestId("all-days-results")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("clear-search"));
    await waitFor(() => expect(screen.queryByTestId("all-days-results")).not.toBeInTheDocument());
    expect(rowCount(container)).toBe(2);
  });

  it("Escape in the box clears it as well", async () => {
    render(<Dashboard />);
    search("mounir");
    fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Escape" });
    expect(screen.getByTestId("search-input")).toHaveValue("");
  });

  it("in English", async () => {
    const { LanguageProvider } = await import("@/lib/i18n");
    render(<LanguageProvider initialLang="en"><Dashboard /></LanguageProvider>);
    fireEvent.change(await screen.findByTestId("search-input"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Clear the search" })).toBeInTheDocument();
  });
});
