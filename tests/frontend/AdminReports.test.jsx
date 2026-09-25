/** @vitest-environment jsdom */
// Admin panel → Reports: where the section sits, its tabs, the income chart (server sums) and the
// top senders / recipients tables with their date, ranking and size filters.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { format, startOfYear } from "date-fns";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/pages/AdminPage";
import ReportsSection from "@/components/reports/ReportsSection";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { updatePreferences: vi.fn() },
    admin: { range: vi.fn(), summary: vi.fn(), exportCsv: vi.fn(), purge: vi.fn(), reports: { income: vi.fn(), parties: vi.fn() } },
  },
}));
// jsdom has no layout: give the chart a fixed size (as in MonthlyChartModal.test.jsx).
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }) => cloneElement(children, { width: 800, height: typeof height === "number" ? height : 400 }),
  };
});

const ymd = (d) => format(d, "yyyy-MM-dd");
const month = (m, values = {}) => ({ month: m, count: 0, profit: 0, cashIn: 0, cashOut: 0, ...values });
const incomeOf = (year) => ({
  year,
  years: ["2026", "2025"],
  months: year === "2025"
    ? [month(12, { count: 1, profit: 9.99, cashIn: 999 })]
    : [month(6, { count: 2, profit: 10, cashIn: 1000, cashOut: 400 }), month(9, { count: 2, profit: 5, cashIn: 500, cashOut: 1500 })],
});
const partiesOf = ({ party, from, to, by, limit }, overrides = {}) => ({
  party, from, to, by,
  totals: { rows: 5, volume: 1750, commission: 17.5, parties: 2, unnamed_rows: 0, unnamed_volume: 0 },
  rows: [
    { rank: 1, name: "Rami Haddad", number: "71588017", label: "Rami Haddad", count: 3, volume: 1500, average: 500, commission: 15, share: 0.8571, first_date: "2026-02-01", last_date: "2026-09-20" },
    { rank: 2, name: null, number: "03123456", label: "03123456", count: 2, volume: 250, average: 125, commission: 2.5, share: 0.1429, first_date: "2026-03-01", last_date: "2026-04-02" },
  ].slice(0, limit),
  ...overrides,
});

// The chart is loaded on demand (lazy); loading its code once here keeps the tests fast.
beforeAll(async () => { await import("@/components/reports/IncomeChart"); }, 60000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 23, 12)); // 23 Sep 2026
  vi.clearAllMocks();
  setAuthRole("admin");
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
  api.admin.summary.mockResolvedValue({ transactions: 0, opening_balances: 0, days: 0, total_in: 0, total_out: 0, total_commission: 0 });
  api.admin.range.mockResolvedValue({ first_date: "2025-12-31", last_date: "2026-09-23" });
  api.admin.reports.income.mockImplementation(async (year) => incomeOf(year));
  api.admin.reports.parties.mockImplementation(async (query) => partiesOf(query));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrap = (ui, lang) => (
  <LanguageProvider initialLang={lang}>
    <MemoryRouter initialEntries={["/admin"]}><PreferencesProvider>{ui}</PreferencesProvider></MemoryRouter>
  </LanguageProvider>
);
const renderReports = (lang) => render(wrap(<ReportsSection />, lang));
const tab = (name) => screen.getByRole("tab", { name });
const lastPartiesCall = () => api.admin.reports.parties.mock.calls.at(-1)[0];

describe("reports section", () => {
  it("is the first section of the admin panel, for Admins and Managers", async () => {
    for (const role of ["admin", "manager"]) {
      setAuthRole(role);
      const { unmount } = render(wrap(<AdminPage />));
      const sections = [...document.querySelectorAll("main section[data-testid]")].map((el) => el.dataset.testid);
      expect(sections[0]).toBe("admin-reports");
      expect(screen.getByRole("region", { name: "التقارير" })).toBeInTheDocument();
      await screen.findByTestId("chart-total-profit");
      unmount();
    }
  });

  it("two columns on wide screens: reports in one, the office's data (range, backup, restore, delete) in the other", async () => {
    render(wrap(<AdminPage />));
    const reports = screen.getByTestId("admin-reports-column");
    const data = screen.getByTestId("admin-data-column");
    expect(reports.parentElement).toBe(data.parentElement);
    expect(reports.parentElement).toHaveClass("grid", "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]");
    expect(reports.nextElementSibling).toBe(data); // reports first (also when stacked on small screens)
    expect([...reports.querySelectorAll("section[data-testid]")].map((el) => el.dataset.testid)).toEqual(["admin-reports"]);
    expect([...data.querySelectorAll("section[data-testid]")].map((el) => el.dataset.testid))
      .toEqual(["admin-range", "admin-backup", "admin-restore", "admin-delete"]);
    [reports, data].forEach((column) => expect(column).toHaveClass("min-w-0")); // wide tables scroll inside
    await screen.findByTestId("chart-total-profit");
  });

  it("three tabs, Income open; only the open report is loaded", async () => {
    renderReports();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["الدخل", "أكبر المرسلين", "أكبر المستلمين"]);
    expect(tab("الدخل")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "report-tab-income");
    await screen.findByTestId("chart-total-profit");
    expect(api.admin.reports.parties).not.toHaveBeenCalled();
    fireEvent.click(tab("أكبر المرسلين"));
    expect(tab("أكبر المرسلين")).toHaveAttribute("aria-selected", "true");
    await screen.findByTestId("sender-report-table");
  });

  it("keyboard: arrows move between tabs (mirrored in Arabic), Home / End jump, one tab in the Tab order", () => {
    renderReports();
    expect(tab("الدخل")).toHaveAttribute("tabindex", "0");
    expect(tab("أكبر المرسلين")).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(tab("الدخل"), { key: "ArrowLeft" }); // RTL: left is forward
    expect(tab("أكبر المرسلين")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("أكبر المرسلين"));
    fireEvent.keyDown(tab("أكبر المرسلين"), { key: "End" });
    expect(tab("أكبر المستلمين")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("أكبر المستلمين"), { key: "ArrowLeft" }); // wraps
    expect(tab("الدخل")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("الدخل"), { key: "ArrowRight" });
    expect(tab("أكبر المستلمين")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("أكبر المستلمين"), { key: "Home" });
    expect(tab("الدخل")).toHaveAttribute("aria-selected", "true");
  });
});

describe("chart loading placeholder (the chart code downloads on first use)", () => {
  it("inline in the report, and as a window-sized overlay on the dashboard (above the header)", async () => {
    const { default: ChartFallback } = await import("@/components/reports/ChartFallback");
    const { unmount } = render(wrap(<ChartFallback />));
    expect(screen.getByRole("status")).toHaveTextContent("جاري التحميل");
    expect(screen.getByTestId("chart-code-loading").closest(".fixed")).toBeNull();
    unmount();
    render(wrap(<ChartFallback overlay />));
    expect(screen.getByTestId("chart-code-loading").closest(".fixed")).toHaveClass("inset-0", "z-50");
  });
});

describe("income report", () => {
  it("shows this year's chart from the server's monthly sums, with the year's totals", async () => {
    renderReports();
    await waitFor(() => expect(screen.getByTestId("chart-total-cashIn")).toHaveTextContent("$1,500.00"));
    expect(api.admin.reports.income).toHaveBeenCalledWith("2026");
    expect(screen.getByTestId("chart-total-profit")).toHaveTextContent("$15.00");
    expect(screen.getByTestId("chart-total-cashOut")).toHaveTextContent("$1,900.00");
    expect(screen.getByTestId("chart-total-count")).toHaveTextContent("4");
    expect(screen.getByRole("img", { name: /2026/ })).toBeInTheDocument();
  });

  it("the year list comes from the server; changing the year loads it", async () => {
    renderReports();
    const select = await screen.findByLabelText("السنة");
    await waitFor(() => expect([...select.options].map((o) => o.value)).toEqual(["2026", "2025"]));
    fireEvent.change(select, { target: { value: "2025" } });
    await waitFor(() => expect(screen.getByTestId("chart-total-cashIn")).toHaveTextContent("$999.00"));
    expect(api.admin.reports.income).toHaveBeenLastCalledWith("2025");
  });

  it("table view: every month, blanks for months still to come", async () => {
    renderReports();
    await waitFor(() => expect(screen.getByTestId("chart-total-count")).toHaveTextContent("4"));
    fireEvent.click(screen.getByRole("button", { name: /عرض كجدول/ }));
    const rows = screen.getByTestId("chart-table").querySelectorAll("tbody tr");
    expect(rows).toHaveLength(12);
    expect(rows[5]).toHaveTextContent("$10.00$1,000.00$400.002");
    expect(rows[1]).toHaveTextContent("$0.00");
    expect(rows[11]).toHaveTextContent("—"); // December 2026 hasn't happened yet
  });

  it("a server error is shown", async () => {
    api.admin.reports.income.mockRejectedValue(new Error("A valid year is required (YYYY)"));
    renderReports();
    expect(await screen.findByRole("alert")).toHaveTextContent("يلزم إدخال سنة صحيحة (YYYY)");
  });
});

describe("top senders / recipients", () => {
  const openSenders = async () => {
    renderReports();
    fireEvent.click(tab("أكبر المرسلين"));
    return screen.findByTestId("sender-report-table");
  };

  it("loads this year's top 10 senders by total amount by default", async () => {
    await openSenders();
    expect(lastPartiesCall()).toEqual({ party: "sender", from: ymd(startOfYear(new Date())), to: "2026-09-23", by: "volume", limit: 10 });
    expect(screen.getByTestId("sender-report-range-from")).toHaveValue("2026-01-01");
    expect(screen.getByTestId("sender-report-range-to")).toHaveValue("2026-09-23");
    const summary = screen.getByTestId("sender-report-summary");
    expect(summary).toHaveTextContent("2 مرسل");
    expect(summary).toHaveTextContent("5 عملية");
    expect(summary).toHaveTextContent("$1,750.00");
  });

  it("one row per person: rank, name, number, count, total, average, share, commission, last date", async () => {
    const table = await openSenders();
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["#", "المرسل", "الرقم", "العمليات", "الإجمالي", "المتوسط", "النسبة", "العمولة", "آخر عملية"]);
    const [first, second] = within(table).getAllByTestId("sender-report-row");
    expect(first).toHaveTextContent("1Rami Haddad715880173$1,500.00$500.0085.7%");
    expect(first).toHaveTextContent("$15.002026-09-20");
    // Known only by number: the number is the name, and isn't repeated.
    expect(within(second).getAllByRole("cell")[1]).toHaveTextContent("03123456");
    expect(within(second).getAllByRole("cell")[2]).toHaveTextContent("—");
    expect(table.querySelector('th[aria-sort="descending"]')).toHaveTextContent("الإجمالي");
  });

  it("recipients: Cash Out, no commission column", async () => {
    renderReports();
    fireEvent.click(tab("أكبر المستلمين"));
    const table = await screen.findByTestId("receiver-report-table");
    expect(lastPartiesCall()).toMatchObject({ party: "receiver" });
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).not.toContain("العمولة");
    expect(screen.getByTestId("receiver-report-summary")).toHaveTextContent("2 مستلم");
  });

  it("the date filter, quick ranges, ranking and list size reload the report", async () => {
    await openSenders();
    fireEvent.change(screen.getByTestId("sender-report-range-from"), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(lastPartiesCall()).toMatchObject({ from: "2026-03-01", to: "2026-09-23" }));
    fireEvent.click(screen.getByTestId("sender-report-range-lastMonth"));
    await waitFor(() => expect(lastPartiesCall()).toMatchObject({ from: "2026-08-01", to: "2026-08-31" }));
    fireEvent.click(screen.getByTestId("sender-report-range-allData"));
    await waitFor(() => expect(lastPartiesCall()).toMatchObject({ from: "2025-12-31", to: "2026-09-23" }));
    fireEvent.change(screen.getByTestId("sender-report-by"), { target: { value: "count" } });
    await waitFor(() => expect(lastPartiesCall()).toMatchObject({ by: "count" }));
    await waitFor(() => expect(screen.getByTestId("sender-report-table").querySelector('th[aria-sort="descending"]')).toHaveTextContent("العمليات"));
    fireEvent.change(screen.getByTestId("sender-report-limit"), { target: { value: "50" } });
    await waitFor(() => expect(lastPartiesCall()).toMatchObject({ limit: 50 }));
    expect([...screen.getByTestId("sender-report-limit").options].map((o) => o.textContent)).toEqual(["أعلى 10", "أعلى 25", "أعلى 50", "أعلى 100"]);
  });

  it("a start date after the end date is refused before asking the server", async () => {
    await openSenders();
    const calls = api.admin.reports.parties.mock.calls.length;
    fireEvent.change(screen.getByTestId("sender-report-range-from"), { target: { value: "2026-10-01" } });
    expect(await screen.findByText("يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له.")).toBeInTheDocument();
    expect(api.admin.reports.parties.mock.calls.length).toBe(calls);
    expect(screen.queryByTestId("sender-report-table")).not.toBeInTheDocument();
  });

  it("nothing in the range: says so; rows without a name or number are mentioned", async () => {
    api.admin.reports.parties.mockImplementation(async (query) =>
      partiesOf(query, { rows: [], totals: { rows: 2, volume: 30, commission: 0, parties: 0, unnamed_rows: 2, unnamed_volume: 30 } }));
    renderReports();
    fireEvent.click(tab("أكبر المستلمين"));
    expect(await screen.findByTestId("receiver-report-empty")).toHaveTextContent("لا توجد عمليات سحب بين هذين التاريخين.");
    expect(screen.getByTestId("receiver-report-summary")).toHaveTextContent("2 عملية بلا اسم أو رقم غير مدرجة: $30.00");
  });

  it("amounts sit in their own left-to-right span, so the $ stays in front in Arabic", async () => {
    await openSenders();
    const total = within(screen.getByTestId("sender-report-summary")).getByText("$1,750.00");
    expect(total).toHaveAttribute("dir", "ltr");
    expect(total.parentElement).toHaveTextContent("الإجمالي $1,750.00");
    expect(total.parentElement).not.toHaveAttribute("dir");
  });

  it("in English, with singular / plural counts", async () => {
    api.admin.reports.parties.mockImplementation(async (query) =>
      partiesOf(query, { totals: { rows: 1, volume: 1500, commission: 15, parties: 1, unnamed_rows: 0, unnamed_volume: 0 } }));
    renderReports("en");
    fireEvent.click(tab("Top senders"));
    const table = await screen.findByTestId("sender-report-table");
    expect(screen.getByTestId("sender-report-summary")).toHaveTextContent("1 sender1 transactionTotal $1,500.00");
    expect(within(table).getByRole("columnheader", { name: "Last transaction" })).toBeInTheDocument();
    expect(screen.getByText(/Who sent the most money in \(Cash In\)/)).toBeInTheDocument();
  });

  it("a server error is shown instead of the table", async () => {
    api.admin.reports.parties.mockRejectedValue(new Error("Unknown report option"));
    renderReports();
    fireEvent.click(tab("أكبر المرسلين"));
    expect(await screen.findByRole("alert")).toHaveTextContent("خيار تقرير غير معروف");
    expect(screen.queryByTestId("sender-report-table")).not.toBeInTheDocument();
  });
});
