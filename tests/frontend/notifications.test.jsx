/** @vitest-environment jsdom */
// Toast notifications (sonner, via src/lib/notify.js and <AppToaster />): where they appear, their
// kinds, and the feedback each action gives — imports, transactions, settings.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppToaster from "@/components/layout/AppToaster";
import ImportPDFModal from "@/components/transactions/ImportPDFModal";
import CashInModal from "@/components/transactions/CashInModal";
import CashOutModal from "@/components/transactions/CashOutModal";
import EditTransactionModal from "@/components/transactions/EditTransactionModal";
import TransactionsList from "@/components/dashboard/TransactionsList";
import SettingsPage from "@/pages/SettingsPage";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { applyPreferenceChanges, resolvePreferences } from "@/lib/preferences";
import { TOAST_DURATION, notify } from "@/lib/notify";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import { clearToasts, findToast, toastTexts } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { updatePreferences: vi.fn() },
    integrations: { Core: { ExtractPdf: vi.fn(), ExtractCsv: vi.fn() } },
    entities: {
      Transaction: {
        findDuplicates: vi.fn(), importRecords: vi.fn(), create: vi.fn(), update: vi.fn(),
        delete: vi.fn(), bulkDelete: vi.fn(), bulkUpdate: vi.fn(),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  setAuthRole("admin");
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
});
afterEach(() => {
  cleanup();
  clearToasts();
  document.documentElement.classList.remove("dark");
});

const withApp = (ui, { lang } = {}) => (
  <LanguageProvider initialLang={lang}>
    <MemoryRouter>
      <PreferencesProvider>{ui}<AppToaster /></PreferencesProvider>
    </MemoryRouter>
  </LanguageProvider>
);

describe("toaster", () => {
  const toaster = () => document.querySelector("[data-sonner-toaster]");

  it("Arabic: right-to-left, bottom-left (away from the sticky header), labelled for screen readers", async () => {
    render(withApp(null));
    act(() => { notify.success("تم"); });
    await findToast("تم");
    expect(toaster()).toHaveAttribute("dir", "rtl");
    expect(toaster()).toHaveAttribute("data-y-position", "bottom");
    expect(toaster()).toHaveAttribute("data-x-position", "left");
    expect(toaster()).toHaveAttribute("data-sonner-theme", "light");
    expect(toaster().closest("section").getAttribute("aria-label")).toMatch(/^الإشعارات/);
  });

  it("English: left-to-right, bottom-right", async () => {
    render(withApp(null, { lang: "en" }));
    act(() => { notify.info("Done"); });
    await findToast("Done");
    expect(toaster()).toHaveAttribute("dir", "ltr");
    expect(toaster()).toHaveAttribute("data-x-position", "right");
    expect(toaster().closest("section").getAttribute("aria-label")).toMatch(/^Notifications/);
  });

  it("follows the dark theme", async () => {
    setAuthRole("admin", { preferences: { theme: "dark" } });
    render(withApp(null));
    act(() => { notify.warning("انتبه"); });
    await findToast("انتبه");
    expect(toaster()).toHaveAttribute("data-sonner-theme", "dark");
  });

  it("each kind has its own style, and a close button named in the interface language", async () => {
    render(withApp(null));
    act(() => {
      notify.success("نجاح");
      notify.info("معلومة");
      notify.warning("تحذير");
      notify.error("خطأ");
    });
    expect(await findToast("نجاح")).toHaveAttribute("data-type", "success");
    expect(await findToast("معلومة")).toHaveAttribute("data-type", "info");
    expect(await findToast("تحذير")).toHaveAttribute("data-type", "warning");
    const error = await findToast("خطأ");
    expect(error).toHaveAttribute("data-type", "error");
    expect(within(error).getByRole("button", { name: "إغلاق" })).toBeInTheDocument();
  });

  it("errors and warnings stay longer; passing an id replaces the earlier toast", async () => {
    const spy = vi.spyOn(toast, "error");
    notify.error("x");
    expect(spy).toHaveBeenCalledWith("x", { duration: TOAST_DURATION.error });
    spy.mockRestore();
    expect(TOAST_DURATION.error).toBeGreaterThan(TOAST_DURATION.success);
    expect(TOAST_DURATION.warning).toBeGreaterThan(TOAST_DURATION.success);

    render(withApp(null));
    act(() => { notify.success("الأول", { id: "same" }); });
    await findToast("الأول");
    act(() => { notify.success("الثاني", { id: "same" }); });
    await findToast("الثاني");
    await waitFor(() => expect(toastTexts()).toEqual(["الثاني"]));
  });
});

describe("imports", () => {
  const extraction = (overrides = {}) => ({
    statement_date: "2026-09-23", opening_balance: 100, closing_balance: 165, total_transactions_count: 2,
    validation: { is_valid: true, total_debit_matches: true, total_credit_matches: true, closing_balance_matches: true, balance_mismatch_lines: [] },
    transactions: [
      { type: "cash_in", amount: 75, commission: 0.75, sender_name: "A", receiver_name: "B", reference_number: "tr:1", date: "2026-09-23" },
      { type: "cash_out", amount: 10, commission: 0, sender_name: "B", receiver_name: "C", reference_number: "tr:2", date: "2026-09-23" },
    ],
    ...overrides,
  });
  const csv = () => new File(["x"], "statement.csv", { type: "text/csv" });
  const renderImport = () => {
    const onSaved = vi.fn();
    const utils = render(withApp(<ImportPDFModal onClose={vi.fn()} onSaved={onSaved} />));
    fireEvent.change(utils.container.querySelector('input[type="file"]'), { target: { files: [csv()] } });
    return { ...utils, onSaved };
  };

  beforeEach(() => {
    api.integrations.Core.ExtractCsv.mockResolvedValue(extraction());
    api.entities.Transaction.findDuplicates.mockResolvedValue([]);
    api.entities.Transaction.importRecords.mockResolvedValue({ replaced: 0, records: [] });
  });

  it("a successful import says how many transactions were imported", async () => {
    renderImport();
    fireEvent.click(await screen.findByText("حفظ الكل (2)"));
    expect(await findToast("تم استيراد 2 عملية.")).toHaveAttribute("data-type", "success");
  });

  it("replacing an already-imported statement says how many were replaced", async () => {
    api.entities.Transaction.findDuplicates.mockResolvedValue([{ id: 9, reference_number: "tr:1", transaction_date: "2026-09-23" }]);
    renderImport();
    fireEvent.click(await screen.findByText("استبدال العمليات الموجودة"));
    fireEvent.click(screen.getByText("حفظ الكل (2)"));
    expect(await findToast("تم استيراد 2 عملية (استُبدلت 1).")).toHaveAttribute("data-type", "success");
  });

  it("a failed save is reported (it used to fail silently) and the preview stays open", async () => {
    api.entities.Transaction.importRecords.mockRejectedValue(new Error("You don't have permission to do this"));
    const { onSaved } = renderImport();
    fireEvent.click(await screen.findByText("حفظ الكل (2)"));
    const error = await findToast(/تعذّر حفظ العمليات، ولم يتم استيراد أي شيء\./);
    expect(error).toHaveAttribute("data-type", "error");
    expect(error.textContent).toMatch(/ليست لديك صلاحية/); // the server's reason, translated
    expect(await screen.findByText("حفظ الكل (2)")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a statement that doesn't reconcile raises a warning", async () => {
    api.integrations.Core.ExtractCsv.mockResolvedValue(extraction({
      validation: { is_valid: false, total_debit_matches: true, total_credit_matches: true, closing_balance_matches: false, balance_mismatch_lines: [] },
    }));
    renderImport();
    expect(await findToast("الكشف غير متطابق. راجع التحذير قبل الحفظ.")).toHaveAttribute("data-type", "warning");
  });

  it("a reconciled statement raises no warning", async () => {
    renderImport();
    await screen.findByText("حفظ الكل (2)");
    expect(toastTexts()).toEqual([]);
  });

  it("an unreadable file is an error; an empty one a warning", async () => {
    api.integrations.Core.ExtractCsv.mockRejectedValueOnce(new Error("CSV file is missing the transactions header"));
    renderImport();
    expect((await findToast(/.+/)).getAttribute("data-type")).toBe("error");
    cleanup();
    clearToasts();

    api.integrations.Core.ExtractCsv.mockResolvedValueOnce(extraction({ transactions: [], total_transactions_count: 0 }));
    renderImport();
    await waitFor(() => expect(document.querySelector('[data-sonner-toast][data-type="warning"]')).not.toBeNull());
  });
});

describe("transactions", () => {
  it.each([
    [CashInModal, "cash_in", "تم حفظ الإيداع (Cash In)."],
    [CashOutModal, "cash_out", "تم حفظ السحب (Cash Out)."],
  ])("%o: saving confirms it", async (Modal, type, message) => {
    api.entities.Transaction.create.mockResolvedValue({ id: 1 });
    const onSaved = vi.fn();
    render(withApp(<Modal onClose={vi.fn()} onSaved={onSaved} />));
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await findToast(message)).toHaveAttribute("data-type", "success");
    expect(api.entities.Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ type, amount: 50 }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("a failed Cash In is reported and the form is usable again (it used to stay stuck on 'saving')", async () => {
    api.entities.Transaction.create.mockRejectedValue(new Error("You don't have permission to do this"));
    const onSaved = vi.fn();
    render(withApp(<CashInModal onClose={vi.fn()} onSaved={onSaved} />));
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await findToast("ليست لديك صلاحية للقيام بهذا")).toHaveAttribute("data-type", "error");
    expect(screen.getByRole("button", { name: "حفظ" })).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("editing a transaction: success is confirmed, a failure is reported and nothing closes", async () => {
    const tx = { id: 7, type: "cash_in", amount: 50, commission: 0.5, sender_name: "A", transaction_date: "2026-09-23" };
    api.entities.Transaction.update.mockRejectedValueOnce(new Error(""));
    const onSaved = vi.fn();
    render(withApp(<EditTransactionModal transaction={tx} onClose={vi.fn()} onSaved={onSaved} />));
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));
    expect(await findToast("تعذّر حفظ العملية.")).toHaveAttribute("data-type", "error");
    expect(onSaved).not.toHaveBeenCalled();

    api.entities.Transaction.update.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));
    expect(await findToast("تم تعديل العملية.")).toHaveAttribute("data-type", "success");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  describe("in the table", () => {
    const rows = [
      { id: 1, type: "cash_out", amount: 15, commission: 0, sender_name: "One", transaction_date: "2026-09-23", created_date: "2026-09-23T10:00:00Z" },
      { id: 2, type: "cash_in", amount: 50, commission: 0.5, sender_name: "Two", transaction_date: "2026-09-23", created_date: "2026-09-23T11:00:00Z" },
    ];
    const renderTable = (props = {}) => render(withApp(
      <TransactionsList transactions={rows} allTransactions={rows} loading={false} search="" setSearch={vi.fn()}
        selectedDate="2026-09-23" setSelectedDate={vi.fn()} onToday={vi.fn()} onCashIn={vi.fn()} onCashOut={vi.fn()}
        onImportPDF={vi.fn()} onRefresh={vi.fn()} onResetOpeningBalance={vi.fn()} onDeleteDailyBalanceForDate={vi.fn()} {...props} />
    ));
    const firstRow = (container) => container.querySelector("tbody tr");

    it("deleting a row confirms it; a failed delete is reported and nothing refreshes", async () => {
      api.entities.Transaction.delete.mockRejectedValueOnce(new Error(""));
      const onRefresh = vi.fn();
      const { container } = renderTable({ onRefresh });
      fireEvent.click(within(firstRow(container)).getByTitle("مسح"));
      fireEvent.click(within(firstRow(container)).getByText("تأكيد"));
      expect(await findToast("تعذّر حذف العملية.")).toHaveAttribute("data-type", "error");
      expect(onRefresh).not.toHaveBeenCalled();

      api.entities.Transaction.delete.mockResolvedValueOnce({ ok: true });
      fireEvent.click(within(firstRow(container)).getByTitle("مسح"));
      fireEvent.click(within(firstRow(container)).getByText("تأكيد"));
      expect(await findToast("تم حذف العملية.")).toHaveAttribute("data-type", "success");
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it("bulk delete says how many were deleted", async () => {
      api.entities.Transaction.bulkDelete.mockResolvedValue({ deleted: 2 });
      renderTable();
      fireEvent.click(screen.getByLabelText("تحديد كل العمليات الظاهرة"));
      fireEvent.click(screen.getByRole("button", { name: /حذف المحدد/ }));
      fireEvent.click(screen.getByRole("button", { name: "حذف 2 عملية" }));
      expect(await findToast("تم حذف 2 عملية.")).toHaveAttribute("data-type", "success");
    });

    it("'delete all for this day' says how many were deleted and for which day", async () => {
      api.entities.Transaction.delete.mockResolvedValue({ ok: true });
      renderTable();
      fireEvent.click(screen.getByRole("button", { name: /مسح الكل/ }));
      const dialog = screen.getByRole("heading", { name: "تأكيد المسح" }).closest(".rounded-2xl");
      fireEvent.click(within(dialog).getByRole("button", { name: /مسح الكل/ }));
      expect(await findToast("تم حذف 2 عملية بتاريخ 2026-09-23.")).toHaveAttribute("data-type", "success");
    });
  });
});

describe("settings", () => {
  let serverPreferences;
  beforeEach(() => {
    serverPreferences = resolvePreferences(null);
    api.auth.updatePreferences.mockImplementation(async (changes) => {
      serverPreferences = applyPreferenceChanges(serverPreferences, changes).preferences;
      return { preferences: serverPreferences };
    });
  });

  it("changes are confirmed with a single 'Settings saved' toast, however many are made quickly", async () => {
    render(withApp(<SettingsPage />));
    fireEvent.click(screen.getByTestId("density-compact"));
    fireEvent.click(screen.getByTestId("column-note"));
    fireEvent.click(screen.getByTestId("summary-year"));
    await waitFor(() => expect(api.auth.updatePreferences).toHaveBeenCalledTimes(3));
    expect(await findToast("تم حفظ الإعدادات.")).toHaveAttribute("data-type", "success");
    await waitFor(() => expect(toastTexts()).toEqual(["تم حفظ الإعدادات."]));
  });

  it("a failed save is reported with the server's reason", async () => {
    api.auth.updatePreferences.mockRejectedValueOnce(new Error("At least one column must stay visible"));
    render(withApp(<SettingsPage />));
    fireEvent.click(screen.getByTestId("column-note"));
    expect(await findToast("يجب أن يبقى عمود واحد على الأقل ظاهراً")).toHaveAttribute("data-type", "error");
  });

  it("changing the language in Settings is confirmed like any other setting, in the new language", async () => {
    render(withApp(<SettingsPage />));
    fireEvent.click(screen.getByTestId("language-en"));
    await waitFor(() => expect(api.auth.updatePreferences).toHaveBeenCalledWith({ language: "en" }));
    expect(await findToast("Settings saved.")).toHaveAttribute("data-type", "success");
  });
});
