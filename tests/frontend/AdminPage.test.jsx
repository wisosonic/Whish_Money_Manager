/** @vitest-environment jsdom */
// Admin panel page: range picking, the preview, CSV downloads, and the guarded delete flow.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { format, startOfMonth, subMonths, endOfMonth } from "date-fns";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/pages/AdminPage";
import AppToaster from "@/components/layout/AppToaster";
import { clearToasts, findToast, toastTexts } from "./toastHelpers";
import Header from "@/components/layout/Header";
import { RequirePermission } from "@/App";
import { LanguageProvider } from "@/lib/i18n";
import { PERMISSIONS } from "@/lib/permissions";
import { saveBlob } from "@/lib/download";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/lib/download", () => ({ saveBlob: vi.fn() }));
vi.mock("@/api/apiClient", () => ({
  api: {
    admin: { range: vi.fn(), summary: vi.fn(), exportCsv: vi.fn(), purge: vi.fn(), reports: { income: vi.fn(async (year) => ({ year, years: [year], months: [] })), parties: vi.fn(async ({ party, from, to, by }) => ({ party, from, to, by, totals: { rows: 0, volume: 0, commission: 0, parties: 0, unnamed_rows: 0, unnamed_volume: 0 }, rows: [] })) } },
    auth: { updatePreferences: vi.fn() },
  },
}));

const ymd = (d) => format(d, "yyyy-MM-dd");
const today = new Date();
const monthStart = ymd(startOfMonth(today));
const summaryOf = (overrides = {}) => ({
  transactions: 128, opening_balances: 30, days: 30, total_in: 40447.67, total_out: 41091.65, total_commission: 404.477, ...overrides,
});

// The admin panel's income report loads the chart on demand (lazy); loading its code once here
// keeps the tests fast and steady.
beforeAll(async () => { await import("@/components/reports/IncomeChart"); }, 60000);

beforeEach(() => {
  setAuthRole("admin");
  vi.clearAllMocks();
  api.admin.summary.mockImplementation(async (from, to) => ({ from, to, ...summaryOf() }));
  api.admin.range.mockResolvedValue({ first_date: "2025-12-31", last_date: "2026-09-23" });
  api.admin.exportCsv.mockImplementation(async (kind, from, to) => ({ blob: new Blob(["id\r\n"]), filename: `${kind}_${from}_${to}.csv` }));
  api.admin.purge.mockImplementation(async (from, to) => ({ from, to, deleted_transactions: 128, deleted_opening_balances: 30 }));
});
afterEach(() => {
  cleanup();
  clearToasts();
});

const renderPage = (path = "/admin") => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={[path]}><AdminPage /><AppToaster /></MemoryRouter>
  </LanguageProvider>
);
const summaryBox = () => screen.getByTestId("range-summary");
const loaded = () => waitFor(() => expect(summaryBox()).toHaveTextContent("128 عملية في 30 يوم"));

describe("Admin panel — layout and preview", () => {
  it("shows the range, backup and delete sections, previewing this month by default", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "لوحة الإدارة" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "الفترة الزمنية" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "نسخة احتياطية" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "حذف البيانات" })).toBeInTheDocument();
    expect(screen.getByTestId("range-from")).toHaveValue(monthStart);
    expect(screen.getByTestId("range-to")).toHaveValue(ymd(today));
    await loaded();
    expect(api.admin.summary).toHaveBeenCalledWith(monthStart, ymd(today));
    expect(summaryBox()).toHaveTextContent("30 رصيد بداية");
    expect(summaryBox()).toHaveTextContent("$40,447.67");
    expect(summaryBox()).toHaveTextContent("$41,091.65");
    expect(summaryBox()).toHaveAttribute("aria-live", "polite");
  });

  it("a Manager has the full panel too", async () => {
    setAuthRole("manager");
    renderPage();
    await loaded();
    expect(screen.getByTestId("delete-range")).toBeInTheDocument();
  });

  it("without the delete permission the delete section isn't shown", async () => {
    setAuthRole("manager", { permissions: [PERMISSIONS.DATA_EXPORT, PERMISSIONS.TRANSACTIONS_READ] });
    renderPage();
    await loaded();
    expect(screen.queryByRole("region", { name: "حذف البيانات" })).not.toBeInTheDocument();
    expect(screen.getByTestId("download-transactions")).toBeEnabled();
  });

  it("a User who opens /admin gets the no-permission page", () => {
    setAuthRole("user");
    render(<LanguageProvider><MemoryRouter><RequirePermission permission={PERMISSIONS.DATA_EXPORT}><AdminPage /></RequirePermission></MemoryRouter></LanguageProvider>);
    expect(screen.queryByRole("heading", { name: "لوحة الإدارة" })).not.toBeInTheDocument();
    expect(api.admin.summary).not.toHaveBeenCalled();
  });

  it("quick ranges set the dates and refresh the preview", async () => {
    renderPage();
    await loaded();
    fireEvent.click(screen.getByTestId("range-lastMonth"));
    const last = subMonths(today, 1);
    await waitFor(() => expect(api.admin.summary).toHaveBeenLastCalledWith(ymd(startOfMonth(last)), ymd(endOfMonth(last))));
    fireEvent.click(screen.getByTestId("range-allData"));
    await waitFor(() => expect(api.admin.summary).toHaveBeenLastCalledWith("2025-12-31", "2026-09-23"));
    expect(screen.getByTestId("range-from")).toHaveValue("2025-12-31");
  });

  it("a start date after the end date is refused before asking the server", async () => {
    renderPage();
    await loaded();
    const calls = api.admin.summary.mock.calls.length;
    fireEvent.change(screen.getByTestId("range-from"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByTestId("range-to"), { target: { value: "2026-11-01" } });
    expect(summaryBox()).toHaveTextContent("يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له.");
    expect(api.admin.summary.mock.calls.length).toBe(calls);
    expect(screen.getByTestId("download-transactions")).toBeDisabled();
    expect(screen.getByTestId("delete-range")).toBeDisabled();
  });

  it("shows a server error (translated) instead of the preview", async () => {
    api.admin.summary.mockRejectedValueOnce(new Error("A valid date range is required (from and to, YYYY-MM-DD)"));
    renderPage();
    await waitFor(() => expect(summaryBox()).toHaveTextContent("يلزم تحديد فترة صحيحة"));
  });
});

describe("Admin panel — backup", () => {
  it("downloads the transactions CSV for the range and confirms it", async () => {
    renderPage();
    await loaded();
    fireEvent.click(screen.getByTestId("download-transactions"));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(api.admin.exportCsv).toHaveBeenCalledWith("transactions", monthStart, ymd(today));
    expect(saveBlob.mock.calls[0][1]).toBe(`transactions_${monthStart}_${ymd(today)}.csv`);
    expect(await findToast(`تم تنزيل transactions_${monthStart}_${ymd(today)}.csv.`)).toHaveAttribute("data-type", "success");
    expect(screen.getByTestId("download-transactions")).toHaveTextContent("تنزيل 128 عملية (CSV)");
  });

  it("downloads the opening balances CSV", async () => {
    renderPage();
    await loaded();
    fireEvent.click(screen.getByTestId("download-balances"));
    await waitFor(() => expect(api.admin.exportCsv).toHaveBeenCalledWith("balances", monthStart, ymd(today)));
  });

  it("buttons are disabled when the range has nothing of that kind", async () => {
    api.admin.summary.mockImplementation(async () => summaryOf({ transactions: 0, opening_balances: 0, days: 0 }));
    renderPage();
    await waitFor(() => expect(summaryBox()).toHaveTextContent("0 عملية"));
    expect(screen.getByTestId("download-transactions")).toBeDisabled();
    expect(screen.getByTestId("download-balances")).toBeDisabled();
    expect(screen.getByTestId("delete-range")).toBeDisabled();
  });

  it("a failed download says so", async () => {
    api.admin.exportCsv.mockRejectedValueOnce(new Error(""));
    renderPage();
    await loaded();
    fireEvent.click(screen.getByTestId("download-transactions"));
    expect(await findToast("فشل التنزيل. حاول مرة أخرى.")).toHaveAttribute("data-type", "error");
    expect(saveBlob).not.toHaveBeenCalled();
  });
});

describe("Admin panel — delete", () => {
  const openDialog = async () => {
    renderPage();
    await loaded();
    fireEvent.click(screen.getByTestId("delete-range"));
    return screen.getByRole("alertdialog", { name: "حذف هذه البيانات نهائياً؟" });
  };

  it("asks for the exact number of transactions before it can delete", async () => {
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("سيتم حذف 128 عملية و30 رصيد بداية بين:");
    expect(dialog).toHaveTextContent(`${monthStart} → ${ymd(today)}`);
    expect(dialog).toHaveTextContent("لا يمكن التراجع عن هذا الإجراء");
    const confirm = within(dialog).getByTestId("purge-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("اكتب 128 للتأكيد"), { target: { value: "12" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("اكتب 128 للتأكيد"), { target: { value: "128" } });
    expect(confirm).toBeEnabled();
    expect(api.admin.purge).not.toHaveBeenCalled();
  });

  it("deletes with the confirmed count, reports the result and refreshes the preview", async () => {
    const dialog = await openDialog();
    const calls = api.admin.summary.mock.calls.length;
    fireEvent.change(within(dialog).getByTestId("purge-confirm-input"), { target: { value: "128" } });
    fireEvent.click(within(dialog).getByTestId("purge-confirm"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(api.admin.purge).toHaveBeenCalledWith(monthStart, ymd(today), 128);
    expect(await findToast(`تم حذف 128 عملية و30 رصيد بداية من ${monthStart} إلى ${ymd(today)}.`)).toHaveAttribute("data-type", "success");
    await waitFor(() => expect(api.admin.summary.mock.calls.length).toBe(calls + 1));
  });

  it("if the data changed since the preview, nothing is deleted and the dialog explains why", async () => {
    api.admin.purge.mockRejectedValueOnce(Object.assign(new Error("The data changed since the preview. Check the counts and try again."), { status: 409 }));
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByTestId("purge-confirm-input"), { target: { value: "128" } });
    fireEvent.click(within(dialog).getByTestId("purge-confirm"));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("تغيّرت البيانات منذ المعاينة. راجع الأعداد وحاول مرة أخرى."));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // Also a warning notification (not an error: nothing went wrong, the data moved on).
    expect(await findToast("تغيّرت البيانات منذ المعاينة. راجع الأعداد وحاول مرة أخرى.")).toHaveAttribute("data-type", "warning");
    expect(toastTexts().some((text) => text.includes("تم حذف"))).toBe(false);
  });

  it("offers a backup from inside the dialog, and Cancel closes it without deleting", async () => {
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /تنزيل نسخة احتياطية أولاً/ }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.admin.purge).not.toHaveBeenCalled();
  });

  it("pressing Enter only deletes once the count matches", async () => {
    const dialog = await openDialog();
    const input = within(dialog).getByTestId("purge-confirm-input");
    fireEvent.submit(input.closest("form"));
    expect(api.admin.purge).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " 128 " } });
    await act(async () => { fireEvent.submit(input.closest("form")); });
    expect(api.admin.purge).toHaveBeenCalledTimes(1);
  });
});

describe("Admin panel — header link and English", () => {
  it.each([["admin", true], ["manager", true], ["user", false]])("%s: admin panel link shown = %s", (role, shown) => {
    setAuthRole(role);
    render(<LanguageProvider><MemoryRouter initialEntries={["/"]}><Header /></MemoryRouter></LanguageProvider>);
    if (shown) expect(screen.getByTestId("admin-link")).toHaveAttribute("href", "/admin");
    else expect(screen.queryByTestId("admin-link")).not.toBeInTheDocument();
  });

  it("the link is hidden on the admin panel itself (the dashboard link is there instead)", () => {
    render(<LanguageProvider><MemoryRouter initialEntries={["/admin"]}><Header /></MemoryRouter></LanguageProvider>);
    expect(screen.queryByTestId("admin-link")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).toHaveAttribute("href", "/");
  });

  it("reads in English with singular/plural counts", async () => {
    api.admin.summary.mockImplementation(async () => summaryOf({ transactions: 1, opening_balances: 1, days: 1 }));
    render(<LanguageProvider initialLang="en"><MemoryRouter><AdminPage /></MemoryRouter></LanguageProvider>);
    await waitFor(() => expect(summaryBox()).toHaveTextContent("1 transaction over 1 day"));
    expect(summaryBox()).toHaveTextContent("1 opening balance");
    expect(screen.getByTestId("download-transactions")).toHaveTextContent("Download 1 transaction (CSV)");
    expect(screen.getByTestId("delete-range")).toHaveTextContent("Delete 1 transaction…");
  });
});
