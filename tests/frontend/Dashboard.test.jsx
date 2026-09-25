/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import AppToaster from "@/components/layout/AppToaster";
import { clearToasts, findToast } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin"));

vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { me: vi.fn() },
    entities: {
      Transaction: { filter: vi.fn(), update: vi.fn(), delete: vi.fn() },
      DailyBalance: { filter: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
    closedDays: { list: vi.fn(), close: vi.fn(), reopen: vi.fn() },
    commissionRates: { get: vi.fn() },
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
});

afterEach(cleanup);

const rowCount = (container) => container.querySelectorAll("tbody tr").length;
const search = (value) => fireEvent.change(screen.getByPlaceholderText(/ابحث عن اسم/), { target: { value } });

const thisDayOnly = () => fireEvent.click(screen.getByTestId("search-scope-day"));
const allDays = () => fireEvent.click(screen.getByTestId("search-scope-all"));
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
    await waitFor(() => expect(screen.getByDisplayValue("2026-09-22")).toBeInTheDocument());
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
    fireEvent.change(screen.getByDisplayValue("2026-09-23"), { target: { value: "2025-12-31" } });
    const yearly = screen.getByTestId("yearly-summary");
    await waitFor(() => expect(within(yearly).getByText("2025")).toBeInTheDocument());
    expect(within(yearly).getByText("1 عملية · عمولات $0.00")).toBeInTheDocument();
    const monthly = screen.getByTestId("monthly-summary");
    expect(within(monthly).getByText("عمليات الشهر").nextSibling).toHaveTextContent("1");
    expect(within(monthly).getByText("ديسمبر 2025")).toBeInTheDocument();
  });
});

describe("Dashboard — roles", () => {
  it("loads all office transactions and balances (no per-user filter)", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(api.entities.Transaction.filter).toHaveBeenCalledWith({}, "created_date", 10000);
    expect(api.entities.DailyBalance.filter).toHaveBeenCalledWith({});
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
    api.entities.Transaction.filter.mockReturnValueOnce(first.promise);
    const { container } = render(<Dashboard />);
    expect(await screen.findByText("جاري التحميل...")).toBeInTheDocument();
    first.resolve(stored);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
  });

  it("after editing and saving, the table stays on screen while it refreshes, then updates in place", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const rowBefore = rowFor(container, "MOUNIR TOSKA");

    // The refresh after saving is slow: hold it open to inspect the in-between state.
    const refresh = deferred();
    api.entities.Transaction.filter.mockReturnValueOnce(refresh.promise);

    fireEvent.click(within(rowBefore).getByTitle("تعديل"));
    fireEvent.change(screen.getByDisplayValue("50"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));
    await waitFor(() => expect(api.entities.Transaction.update).toHaveBeenCalledWith(2, expect.objectContaining({ amount: 75 })));
    await waitFor(() => expect(screen.queryByText("تعديل العملية")).not.toBeInTheDocument());

    // Mid-refresh: no loading line, the same rows (same DOM elements) are still there.
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
    expect(rowCount(container)).toBe(2);
    expect(rowFor(container, "MOUNIR TOSKA")).toBe(rowBefore);

    refresh.resolve(stored.map((t) => (t.id === 2 ? { ...t, amount: 75 } : t)));
    await waitFor(() => expect(within(rowBefore).getByText("$75.00")).toBeInTheDocument());
    // Updated in place — React reused the same row element rather than rebuilding the table.
    expect(rowFor(container, "MOUNIR TOSKA")).toBe(rowBefore);
  });

  it("deleting a row also refreshes without blanking the table", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    const survivor = rowFor(container, "Vicario");

    // Both the empty-day check after a delete and the refresh read transactions: hold them all open.
    const refresh = deferred();
    api.entities.Transaction.filter.mockImplementation(() => refresh.promise);
    const target = rowFor(container, "MOUNIR TOSKA");
    fireEvent.click(within(target).getByTitle("مسح"));
    fireEvent.click(within(target).getByText("تأكيد"));
    await waitFor(() => expect(api.entities.Transaction.delete).toHaveBeenCalledWith(2));

    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
    expect(rowCount(container)).toBe(2);

    refresh.resolve(stored.filter((t) => t.id !== 2));
    await waitFor(() => expect(rowCount(container)).toBe(1));
    expect(rowFor(container, "Vicario")).toBe(survivor);
    api.entities.Transaction.filter.mockReset();
  });

  it("never scrolls the page itself during a refresh", async () => {
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      const { container } = render(<Dashboard />);
      await waitFor(() => expect(rowCount(container)).toBe(2));
      const callsBefore = api.entities.Transaction.filter.mock.calls.length;
      fireEvent.click(within(rowFor(container, "MOUNIR TOSKA")).getByTitle("تعديل"));
      fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));
      await waitFor(() => expect(api.entities.Transaction.filter.mock.calls.length).toBe(callsBefore + 1));
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      scrollSpy.mockRestore();
    }
  });
});
