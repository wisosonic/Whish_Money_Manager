/** @vitest-environment jsdom */
// Closing / reopening a day from the dashboard (confirmation, notification, what gets locked), and
// the table options that apply there: start-on, default search scope, default sort, pages, digits,
// and Cash In using the office commission rate.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { format } from "date-fns";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import TransactionsList from "@/components/dashboard/TransactionsList";
import CashInModal from "@/components/transactions/CashInModal";
import AppToaster from "@/components/layout/AppToaster";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import { clearToasts, findToast } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { me: vi.fn(), updatePreferences: vi.fn() },
    entities: {
      Transaction: { filter: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn(), bulkUpdate: vi.fn() },
      DailyBalance: { filter: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
    closedDays: { list: vi.fn(), close: vi.fn(), reopen: vi.fn() },
    commissionRates: { get: vi.fn() },
  },
}));

const DAY = "2026-09-23";
const stored = [
  { id: 1, type: "cash_out", amount: 15, commission: 0, sender_name: "Vicario", reference_number: "tr:1", transaction_date: DAY, sort_order: 0, created_by: "user@test.local", created_date: `${DAY}T10:00:00Z` },
  { id: 2, type: "cash_in", amount: 50, commission: 0.5, sender_name: "MOUNIR", reference_number: "tr:2", transaction_date: DAY, sort_order: 1, created_by: "admin@test.local", created_date: `${DAY}T11:00:00Z` },
  { id: 3, type: "cash_in", amount: 20, commission: 0.2, sender_name: "Vicario", reference_number: "tr:3", transaction_date: "2026-09-22", sort_order: 0, created_by: "admin@test.local", created_date: "2026-09-22T11:00:00Z" },
];
let closed;

beforeEach(() => {
  vi.clearAllMocks();
  setAuthRole("admin");
  localStorage.clear();
  localStorage.setItem("selectedDate", DAY);
  closed = [];
  api.auth.me.mockResolvedValue({ email: "admin@test.local" });
  api.entities.Transaction.filter.mockResolvedValue(stored);
  api.entities.DailyBalance.filter.mockResolvedValue([]);
  api.closedDays.list.mockImplementation(async () => closed);
  api.closedDays.close.mockImplementation(async (date) => { closed = [{ date, closed_by: "admin@test.local", closed_at: "2026-09-24T18:00:00.000Z" }]; return closed[0]; });
  api.closedDays.reopen.mockImplementation(async (date) => { closed = closed.filter((d) => d.date !== date); return { ok: true }; });
  api.commissionRates.get.mockResolvedValue({ rate: 1 });
});
afterEach(() => {
  cleanup();
  clearToasts();
});

const withApp = (ui) => (
  <LanguageProvider><MemoryRouter><PreferencesProvider>{ui}<AppToaster /></PreferencesProvider></MemoryRouter></LanguageProvider>
);
const rowCount = (container) => container.querySelectorAll("tbody tr").length;
const renderDashboard = async () => {
  const utils = render(withApp(<Dashboard />));
  await waitFor(() => expect(rowCount(utils.container)).toBe(2));
  return utils;
};

describe("closing a day", () => {
  it("asks for confirmation, closes, confirms, and then shows the day as closed", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByTestId("close-day"));
    const dialog = screen.getByRole("alertdialog", { name: `إغلاق ${DAY}؟` });
    expect(dialog).toHaveAccessibleDescription(/لن يتمكن أحد من إضافة أو تعديل أو استيراد أو حذف/);
    expect(api.closedDays.close).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("confirm-day-change"));
    await waitFor(() => expect(api.closedDays.close).toHaveBeenCalledWith(DAY));
    expect(await findToast(`تم إغلاق ${DAY}. لا يمكن إجراء أي تغيير عليه.`)).toHaveAttribute("data-type", "success");
    expect(await screen.findByTestId("closed-day-banner")).toHaveTextContent(`${DAY} مغلق: لا يمكن إجراء أي تغيير.`);
    expect(screen.getByTestId("closed-day-banner")).toHaveTextContent("أغلقه admin@test.local");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancel closes nothing", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByTestId("close-day"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "إلغاء" }));
    expect(api.closedDays.close).not.toHaveBeenCalled();
    expect(screen.queryByTestId("closed-day-banner")).not.toBeInTheDocument();
  });

  it("on a closed day: no edit / delete on its rows, no 'delete all', no opening-balance edit", async () => {
    closed = [{ date: DAY, closed_by: "manager@test.local", closed_at: "2026-09-24T18:00:00.000Z" }];
    const { container } = await renderDashboard();
    await screen.findByTestId("closed-day-banner");
    container.querySelectorAll("tbody tr").forEach((row) => {
      expect(within(row).queryByTitle("تعديل")).not.toBeInTheDocument();
      expect(within(row).queryByTitle("مسح")).not.toBeInTheDocument();
      expect(within(row).getByRole("img", { name: "اليوم مغلق: لا يمكن تعديل هذه العملية" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /مسح الكل/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("تعديل رصيد البداية")).not.toBeInTheDocument();
    // Selecting rows: bulk edit / delete are off, with the reason.
    fireEvent.click(screen.getByLabelText("تحديد كل العمليات الظاهرة"));
    expect(screen.getByTestId("bulk-closed-hint")).toHaveTextContent("بعض العمليات المحددة في يوم مغلق.");
    expect(screen.getByRole("button", { name: /حذف المحدد/ })).toBeDisabled();
  });

  it("reopening asks first, then unlocks the day", async () => {
    closed = [{ date: DAY, closed_by: "admin@test.local", closed_at: "2026-09-24T18:00:00.000Z" }];
    const { container } = await renderDashboard();
    fireEvent.click(await screen.findByTestId("reopen-day"));
    const dialog = screen.getByRole("alertdialog", { name: `إعادة فتح ${DAY}؟` });
    fireEvent.click(within(dialog).getByTestId("confirm-day-change"));
    await waitFor(() => expect(api.closedDays.reopen).toHaveBeenCalledWith(DAY));
    expect(await findToast(`تمت إعادة فتح ${DAY} للتعديل.`)).toHaveAttribute("data-type", "success");
    await waitFor(() => expect(screen.queryByTestId("closed-day-banner")).not.toBeInTheDocument());
    expect(within(container.querySelector("tbody tr")).getByTitle("تعديل")).toBeInTheDocument();
  });

  it("a failure is reported and nothing changes on screen", async () => {
    api.closedDays.close.mockRejectedValueOnce(Object.assign(new Error("This day is already closed"), { status: 409 }));
    await renderDashboard();
    fireEvent.click(screen.getByTestId("close-day"));
    fireEvent.click(screen.getByTestId("confirm-day-change"));
    expect(await findToast("هذا اليوم مغلق مسبقاً")).toHaveAttribute("data-type", "error");
  });

  it("a User sees that the day is closed but can't close or reopen days", async () => {
    setAuthRole("user");
    await renderDashboard();
    expect(screen.queryByTestId("close-day")).not.toBeInTheDocument();
    cleanup();
    closed = [{ date: DAY, closed_by: "admin@test.local", closed_at: "2026-09-24T18:00:00.000Z" }];
    await renderDashboard();
    expect(await screen.findByTestId("closed-day-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("reopen-day")).not.toBeInTheDocument();
  });

  it("Cash In / Cash Out are off when today is closed (they're entered on today's date)", async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    closed = [{ date: today, closed_by: "admin@test.local", closed_at: "2026-09-24T18:00:00.000Z" }];
    await renderDashboard();
    await waitFor(() => expect(screen.getByRole("button", { name: /Cash In/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /Cash Out/ })).toHaveAttribute("title", "اليوم مغلق: أعد فتحه لإضافة عمليات.");
  });
});

describe("dashboard options", () => {
  it("start on: the last day viewed by default, or always today", async () => {
    const { unmount } = render(withApp(<Dashboard />));
    expect(await screen.findByDisplayValue(DAY)).toBeInTheDocument();
    unmount();
    setAuthRole("admin", { preferences: { startOn: "today" } });
    render(withApp(<Dashboard />));
    expect(await screen.findByDisplayValue(format(new Date(), "yyyy-MM-dd"))).toBeInTheDocument();
  });

  it("default search scope: 'this day' makes the switch start there", async () => {
    setAuthRole("admin", { preferences: { searchScope: "day" } });
    const { container } = await renderDashboard();
    expect(screen.getByTestId("search-scope-day")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByPlaceholderText(/ابحث عن اسم/), { target: { value: "vicario" } });
    await waitFor(() => expect(rowCount(container)).toBe(1)); // only the selected day's Vicario
  });
});

describe("table options", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: 100 + i, type: i % 2 ? "cash_out" : "cash_in", amount: 10 + i, commission: 0.1, sender_name: `S${String(i + 1).padStart(2, "0")}`,
    reference_number: `tr:${i + 1}`, transaction_date: DAY, created_date: `${DAY}T10:00:00Z`,
  }));
  const renderTable = (rows = many, props = {}) => render(withApp(
    <TransactionsList transactions={rows} allTransactions={rows} loading={false} search="" setSearch={vi.fn()}
      selectedDate={DAY} setSelectedDate={vi.fn()} onToday={vi.fn()} onCashIn={vi.fn()} onCashOut={vi.fn()}
      onImportPDF={vi.fn()} onRefresh={vi.fn()} onResetOpeningBalance={vi.fn()} onDeleteDailyBalanceForDate={vi.fn()} {...props} />
  ));
  const bodyRows = (container) => [...container.querySelectorAll("tbody tr")];

  it("default sort: the table opens sorted as saved", () => {
    setAuthRole("admin", { preferences: { defaultSort: { key: "amount", dir: "desc" } } });
    const { container } = renderTable(stored.slice(0, 2));
    expect(screen.getByTestId("sort-amount").closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(bodyRows(container)[0]).toHaveTextContent("MOUNIR");
  });

  it("rows per page: pages with Previous / Next; the range and page are announced", () => {
    setAuthRole("admin", { preferences: { rowsPerPage: 25 } });
    const { container } = renderTable();
    expect(bodyRows(container)).toHaveLength(25);
    expect(screen.getByTestId("pager-range")).toHaveTextContent("1–25 من 30");
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(bodyRows(container)).toHaveLength(5);
    expect(screen.getByTestId("pager-range")).toHaveTextContent("26–30 من 30");
    expect(screen.getByText("صفحة 2 من 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
    // "#" keeps the real journal number on later pages.
    expect(bodyRows(container)[0].children[1]).toHaveTextContent("26");
  });

  it("selection covers the rows on screen only, and is dropped when the page changes", () => {
    setAuthRole("admin", { preferences: { rowsPerPage: 25 } });
    renderTable();
    fireEvent.click(screen.getByLabelText("تحديد كل العمليات الظاهرة"));
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("25 عملية محددة");
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.queryByTestId("bulk-selected-count")).not.toBeInTheDocument();
  });

  it("a refresh (after an edit) keeps the page; a new sort goes back to page 1", () => {
    setAuthRole("admin", { preferences: { rowsPerPage: 25 } });
    const { rerender, container } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    const refreshed = many.map((t) => ({ ...t }));
    rerender(withApp(
      <TransactionsList transactions={refreshed} allTransactions={refreshed} loading={false} search="" setSearch={vi.fn()}
        selectedDate={DAY} setSelectedDate={vi.fn()} onToday={vi.fn()} onCashIn={vi.fn()} onCashOut={vi.fn()}
        onImportPDF={vi.fn()} onRefresh={vi.fn()} onResetOpeningBalance={vi.fn()} onDeleteDailyBalanceForDate={vi.fn()} />
    ));
    expect(screen.getByTestId("pager-range")).toHaveTextContent("26–30");
    fireEvent.click(screen.getByTestId("sort-amount"));
    expect(screen.getByTestId("pager-range")).toHaveTextContent("1–25");
    expect(bodyRows(container)).toHaveLength(25);
  });

  it("all on one page (default): no pager", () => {
    const { container } = renderTable();
    expect(bodyRows(container)).toHaveLength(30);
    expect(screen.queryByTestId("pager")).not.toBeInTheDocument();
  });

  it("Arabic-Indic digits: amounts, #, dates and counts; reference numbers stay as typed", () => {
    setAuthRole("admin", { preferences: { numerals: "arabic" } });
    const { container } = renderTable(stored.slice(0, 2));
    const row = bodyRows(container)[1];
    expect(row).toHaveTextContent("$٥٠٫٠٠");
    expect(row.children[1]).toHaveTextContent("٢");
    expect(row).toHaveTextContent("٢٠٢٦-٠٩-٢٣");
    expect(row).toHaveTextContent("tr:2");
    expect(screen.getByText("٢ عملية")).toBeInTheDocument();
  });
});

describe("Cash In uses the office commission rate", () => {
  it("shows and saves the commission at the rate passed in", async () => {
    api.entities.Transaction.create.mockResolvedValue({ id: 9 });
    render(withApp(<CashInModal commissionRate={2} onClose={vi.fn()} onSaved={vi.fn()} />));
    expect(screen.getByText("العمولة - 2% ($)")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    expect(screen.getByTestId("cash-in-commission")).toHaveTextContent("$1.000");
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(api.entities.Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 50, commission: 1 })));
  });

  it("the dashboard passes today's rate to Cash In", async () => {
    api.commissionRates.get.mockResolvedValue({ rate: 1.5 });
    await renderDashboard();
    await waitFor(() => expect(api.commissionRates.get).toHaveBeenCalledWith(format(new Date(), "yyyy-MM-dd")));
    fireEvent.click(screen.getByRole("button", { name: /Cash In/ }));
    expect(await screen.findByText("العمولة - 1.5% ($)")).toBeInTheDocument();
  });
});
