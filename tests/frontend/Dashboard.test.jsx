/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import { base44 } from "@/api/base44Client";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin"));

vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: vi.fn() },
    entities: {
      Transaction: { filter: vi.fn() },
      DailyBalance: { filter: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
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
  base44.auth.me.mockResolvedValue({ email: "local@hawalaflow.app" });
  base44.entities.Transaction.filter.mockResolvedValue(stored);
  base44.entities.DailyBalance.filter.mockResolvedValue([]);
});

afterEach(cleanup);

const rowCount = (container) => container.querySelectorAll("tbody tr").length;
const search = (value) => fireEvent.change(screen.getByPlaceholderText(/ابحث عن اسم/), { target: { value } });

describe("Dashboard search", () => {
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
    search(term);
    await waitFor(() => expect(rowCount(container)).toBe(expected));
  });

  it("shows the empty state when nothing matches", async () => {
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(rowCount(container)).toBe(2));
    search("no-such-thing");
    expect(await screen.findByText("لا توجد معاملات")).toBeInTheDocument();
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
    expect(base44.entities.Transaction.filter).toHaveBeenCalledWith({}, "created_date", 10000);
    expect(base44.entities.DailyBalance.filter).toHaveBeenCalledWith({});
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
});
