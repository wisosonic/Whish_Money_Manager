/** @vitest-environment jsdom */
// Settings → Office (commission rate with history) and Admin panel → Restore from a backup.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { format } from "date-fns";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import AdminPage from "@/pages/AdminPage";
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
    auth: { updatePreferences: vi.fn() },
    commissionRates: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    admin: { restorePreview: vi.fn(), restore: vi.fn(), summary: vi.fn(), range: vi.fn(), exportCsv: vi.fn(), purge: vi.fn() },
  },
}));

const today = format(new Date(), "yyyy-MM-dd");
const history = (extra = []) => [...extra, { rate: 1, effective_from: "2000-01-01", created_by: "system", created_date: "2026-01-01T00:00:00Z" }];

beforeEach(() => {
  vi.clearAllMocks();
  setAuthRole("admin");
  api.commissionRates.get.mockResolvedValue({ current: 1, history: history() });
  api.admin.summary.mockResolvedValue({ transactions: 10, opening_balances: 2, days: 3, total_in: 1, total_out: 1, total_commission: 0 });
});
afterEach(() => {
  cleanup();
  clearToasts();
});

const openSettings = (hash) => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={[`/settings#${hash}`]}>
      <PreferencesProvider><SettingsPage /><AppToaster /></PreferencesProvider>
    </MemoryRouter>
  </LanguageProvider>
);

describe("Office → commission rate", () => {
  it("shows the current rate and the history, starting from the original 1%", async () => {
    openSettings("office");
    expect(await screen.findByTestId("current-rate")).toHaveTextContent("النسبة الحالية: 1%");
    const table = screen.getByTestId("rate-history");
    expect(within(table).getByText("منذ البداية")).toBeInTheDocument();
    expect(within(table).getByText("—")).toBeInTheDocument(); // set by the system
  });

  it("validates the rate before it can be saved", async () => {
    openSettings("office");
    await screen.findByTestId("current-rate");
    expect(screen.getByTestId("rate-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("rate-input"), { target: { value: "150" } });
    expect(screen.getByTestId("rate-save")).toBeDisabled();
    expect(screen.getByText("أدخل نسبة من 0 إلى 100، بثلاث خانات عشرية على الأكثر.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("rate-input"), { target: { value: "1.2345" } });
    expect(screen.getByTestId("rate-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("rate-input"), { target: { value: "1.5" } });
    expect(screen.getByTestId("rate-save")).toBeEnabled();
    expect(screen.getByTestId("rate-from")).toHaveValue(today);
  });

  it("asks for confirmation, saves from the chosen date and confirms", async () => {
    api.commissionRates.set.mockResolvedValue({ current: 1, history: history([{ rate: 1.5, effective_from: "2099-01-01", created_by: "admin@test.local" }]) });
    openSettings("office");
    await screen.findByTestId("current-rate");
    fireEvent.change(screen.getByTestId("rate-input"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByTestId("rate-from"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByTestId("rate-save"));
    const dialog = screen.getByRole("alertdialog", { name: "تعيين نسبة العمولة إلى 1.5% ابتداءً من 2099-01-01؟" });
    expect(dialog).toHaveAccessibleDescription(/العمليات المحفوظة تحتفظ بعمولتها/);
    expect(api.commissionRates.set).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId("rate-confirm"));
    await waitFor(() => expect(api.commissionRates.set).toHaveBeenCalledWith(1.5, "2099-01-01"));
    expect(await findToast("تم تعيين نسبة العمولة 1.5% ابتداءً من 2099-01-01.")).toHaveAttribute("data-type", "success");
    // Scheduled (future) rates are marked, and can be removed.
    const row = within(screen.getByTestId("rate-history")).getByText("2099-01-01").closest("tr");
    expect(row).toHaveTextContent("مجدولة");
    expect(within(row).getByRole("button", { name: "حذف هذه النسبة المجدولة" })).toBeInTheDocument();
  });

  it("removing a scheduled rate; past rates can't be removed", async () => {
    api.commissionRates.get.mockResolvedValue({ current: 1.25, history: history([
      { rate: 2, effective_from: "2099-01-01", created_by: "admin@test.local" },
      { rate: 1.25, effective_from: "2026-01-01", created_by: "admin@test.local" },
    ]) });
    api.commissionRates.remove.mockResolvedValue({ current: 1.25, history: history([{ rate: 1.25, effective_from: "2026-01-01", created_by: "admin@test.local" }]) });
    openSettings("office");
    const table = await screen.findByTestId("rate-history");
    const past = within(table).getByText("2026-01-01").closest("tr");
    expect(within(past).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "حذف هذه النسبة المجدولة" }));
    await waitFor(() => expect(api.commissionRates.remove).toHaveBeenCalledWith("2099-01-01"));
    expect(await findToast("تم حذف النسبة المجدولة لتاريخ 2099-01-01.")).toBeInTheDocument();
  });

  it("a refusal from the server is shown", async () => {
    api.commissionRates.set.mockRejectedValue(new Error("The rate must be a number from 0 to 100, with up to 3 decimals"));
    openSettings("office");
    await screen.findByTestId("current-rate");
    fireEvent.change(screen.getByTestId("rate-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("rate-save"));
    fireEvent.click(screen.getByTestId("rate-confirm"));
    expect(await findToast("يجب أن تكون النسبة رقماً من 0 إلى 100، بثلاث خانات عشرية على الأكثر")).toHaveAttribute("data-type", "error");
  });
});

const openAdmin = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={["/admin"]}>
      <PreferencesProvider><AdminPage /><AppToaster /></PreferencesProvider>
    </MemoryRouter>
  </LanguageProvider>
);

describe("Admin panel → restore from a backup", () => {
  const file = (text = "id,transaction_date\n1,2026-09-05") => new File([text], "transactions_2026-09-01_2026-09-30.csv", { type: "text/csv" });
  const choose = (f = file()) => fireEvent.change(screen.getByTestId("restore-file"), { target: { files: [f] } });
  const previewOf = (over = {}) => ({
    kind: "transactions", rows: 128, to_add: 120, existing: 5, on_closed_days: 3, duplicates_in_file: 0, closed_days: ["2026-09-06"],
    first_date: "2026-09-01", last_date: "2026-09-30", total_in: 1000, total_out: 250.5, invalid_count: 0, invalid: [], ...over,
  });

  it("choosing a file shows what restoring would do, before anything is written", async () => {
    api.admin.restorePreview.mockResolvedValue(previewOf());
    openAdmin();
    choose();
    const preview = await screen.findByTestId("restore-preview");
    expect(api.admin.restorePreview).toHaveBeenCalledWith("id,transaction_date\n1,2026-09-05");
    expect(preview).toHaveTextContent("يحتوي الملف على 128 عملية.");
    expect(preview).toHaveTextContent("ستتم إضافة 120");
    expect(preview).toHaveTextContent("(من 2026-09-01 إلى 2026-09-30)");
    expect(preview).toHaveTextContent("5 موجودة في قاعدة البيانات (تبقى كما هي)");
    expect(preview).toHaveTextContent("3 في أيام مغلقة، تم تخطيها: 2026-09-06");
    expect(preview).toHaveTextContent("$1,000.00");
    expect(api.admin.restore).not.toHaveBeenCalled();
  });

  it("restoring asks for confirmation, sends the previewed count, and confirms", async () => {
    api.admin.restorePreview.mockResolvedValue(previewOf());
    api.admin.restore.mockResolvedValue({ kind: "transactions", restored: 120, skipped_existing: 5, skipped_closed: 3 });
    openAdmin();
    choose();
    fireEvent.click(await screen.findByRole("button", { name: "استعادة 120 عملية" }));
    const dialog = screen.getByRole("alertdialog", { name: "إعادة 120 عملية؟" });
    fireEvent.click(within(dialog).getByTestId("restore-confirm"));
    await waitFor(() => expect(api.admin.restore).toHaveBeenCalledWith("id,transaction_date\n1,2026-09-05", 120));
    expect(await findToast("تمت استعادة 120 عملية.")).toHaveAttribute("data-type", "success");
    expect(screen.queryByTestId("restore-preview")).not.toBeInTheDocument();
  });

  it("a file with invalid rows lists them and can't be restored", async () => {
    api.admin.restorePreview.mockResolvedValue(previewOf({ invalid_count: 2, invalid: [{ line: 3, field: "type" }, { line: 7, field: "amount" }], to_add: 0 }));
    openAdmin();
    choose();
    const invalid = await screen.findByTestId("restore-invalid");
    expect(invalid).toHaveTextContent("2 صفاً غير صالح، لذا لا يمكن استعادة هذا الملف:");
    expect(invalid).toHaveTextContent("السطر 3: type");
    expect(invalid).toHaveTextContent("السطر 7: amount");
    expect(screen.getByTestId("restore-start")).toBeDisabled();
  });

  it("nothing to add: says so, and the button is off", async () => {
    api.admin.restorePreview.mockResolvedValue(previewOf({ to_add: 0, existing: 128, on_closed_days: 0 }));
    openAdmin();
    choose();
    expect(await screen.findByText("لا شيء للاستعادة: كل ما في الملف موجود مسبقاً.")).toBeInTheDocument();
    expect(screen.getByTestId("restore-start")).toBeDisabled();
  });

  it("if the data changed meanwhile: a warning, and the preview is refreshed with the new counts", async () => {
    api.admin.restorePreview.mockResolvedValueOnce(previewOf()).mockResolvedValueOnce(previewOf({ to_add: 118 }));
    api.admin.restore.mockRejectedValue(Object.assign(new Error("The data changed since the preview. Check the counts and try again."), { status: 409 }));
    openAdmin();
    choose();
    fireEvent.click(await screen.findByTestId("restore-start"));
    fireEvent.click(screen.getByTestId("restore-confirm"));
    expect(await findToast("تغيّرت البيانات منذ المعاينة. راجع الأعداد وحاول مرة أخرى.")).toHaveAttribute("data-type", "warning");
    expect(await screen.findByRole("button", { name: "استعادة 118 عملية" })).toBeInTheDocument();
  });

  it("a file that isn't a backup is refused with the reason", async () => {
    api.admin.restorePreview.mockRejectedValue(new Error("This isn't a backup file from the admin panel"));
    openAdmin();
    choose(file("line_no,date\n1,2026-09-01"));
    expect(await screen.findByRole("alert")).toHaveTextContent("هذا ليس ملف نسخة احتياطية من لوحة الإدارة");
  });

  it("opening balances use their own wording", async () => {
    api.admin.restorePreview.mockResolvedValue(previewOf({ kind: "balances", rows: 30, to_add: 2, total_in: null, total_out: null }));
    openAdmin();
    choose();
    expect(await screen.findByText("يحتوي الملف على 30 رصيد بداية.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استعادة 2 رصيد بداية" })).toBeInTheDocument();
  });

  it("sits in the admin panel, after Backup and before Delete data, and points to the Backup section", async () => {
    openAdmin();
    const sections = [...document.querySelectorAll("main section[data-testid]")].map((el) => el.dataset.testid);
    expect(sections).toEqual(["admin-range", "admin-backup", "admin-restore", "admin-delete"]);
    expect(screen.getByRole("region", { name: "الاستعادة من نسخة احتياطية" })).toHaveTextContent("استخدم ملفاً تم تنزيله من قسم النسخة الاحتياطية أعلاه");
    expect(screen.queryByRole("link", { name: "تنزيل نسخة احتياطية" })).not.toBeInTheDocument();
    await screen.findByTestId("range-summary");
  });

  it("is only shown to people allowed to restore", async () => {
    setAuthRole("manager", { permissions: ["data:export", "data:purge", "transactions:read"] });
    openAdmin();
    await waitFor(() => expect(api.admin.summary).toHaveBeenCalled());
    expect(screen.queryByTestId("admin-restore")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-delete")).toBeInTheDocument();
  });

  it("after a restore, the panel's range summary is refreshed (the counts changed)", async () => {
    api.admin.restorePreview.mockResolvedValue(previewOf());
    api.admin.restore.mockResolvedValue({ kind: "transactions", restored: 120, skipped_existing: 5, skipped_closed: 3 });
    openAdmin();
    await waitFor(() => expect(api.admin.summary).toHaveBeenCalledTimes(1));
    choose();
    fireEvent.click(await screen.findByTestId("restore-start"));
    fireEvent.click(screen.getByTestId("restore-confirm"));
    await findToast("تمت استعادة 120 عملية.");
    await waitFor(() => expect(api.admin.summary).toHaveBeenCalledTimes(2));
  });
});
