/** @vitest-environment jsdom */
// The dashboard's "Ambiguous rows" window (user's request, 2026-09-29): statement rows past imports
// set aside because they couldn't be read as one Cash In or Cash Out.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AmbiguousRowsModal from "@/components/transactions/AmbiguousRowsModal";
import AmbiguousRowsTable from "@/components/transactions/AmbiguousRowsTable";
import TransactionsList from "@/components/dashboard/TransactionsList";
import AppToaster from "@/components/layout/AppToaster";
import { LanguageProvider } from "@/lib/i18n";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import { clearToasts, findToast } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({
  api: {
    importHistory: { ambiguous: vi.fn(), ambiguousCount: vi.fn(), discardAmbiguous: vi.fn(), convert: vi.fn() },
    entities: { Transaction: { delete: vi.fn() } },
  },
}));

const at = (h, m) => new Date(2026, 8, 24, h, m).toISOString();
const ROWS = [
  { id: 2, import_id: 7, line_no: 4, date: "2026-09-23", reference_number: "tr:4", service: "W2W", description: "SPLIT", debit: "3.00", credit: "2.00", balance: "159.00", reason: "both",
    file_name: "AccountStatementCSV_20260923.csv", imported_at: at(9, 5), imported_by: "rami@office.test", imported_by_name: "Rami Haddad", store_id: 1, store_name: "Vicario" },
  { id: 1, import_id: 7, line_no: 3, date: "2026-09-23", reference_number: "", service: "", description: "", debit: "", credit: "", balance: "", reason: "neither",
    file_name: "", imported_at: at(9, 5), imported_by: "old@office.test", imported_by_name: null, store_id: null, store_name: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  setAuthRole("admin");
  api.importHistory.ambiguous.mockResolvedValue({ total: 2, truncated: false, rows: ROWS });
  api.importHistory.ambiguousCount.mockResolvedValue({ total: 0 });
});
afterEach(cleanup);
afterEach(clearToasts);

const open = (props = {}, lang) => {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(<LanguageProvider initialLang={lang}><AppToaster /><AmbiguousRowsModal onClose={onClose} onChanged={onChanged} {...props} /></LanguageProvider>);
  return { onClose, onChanged };
};
const rows = () => screen.getAllByTestId("ambiguous-row");

describe("AmbiguousRowsModal", () => {
  it("lists each row as printed, with why, and the import it came from", async () => {
    open({ storeId: 2 });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.importHistory.ambiguous).toHaveBeenCalledWith(2);
    expect(screen.getByRole("dialog", { name: "صفوف غير واضحة في الكشوفات" })).toBeInTheDocument();
    expect(screen.getByTestId("ambiguous-count")).toHaveTextContent("2 صفاً وُضع جانباً");
    const [split, empty] = rows();
    expect(split).toHaveTextContent("SPLIT");
    expect(split).toHaveTextContent("tr:4");
    expect(split).toHaveTextContent("3.00");
    expect(split).toHaveTextContent("2.00");
    expect(within(split).getByTestId("ambiguous-reason")).toHaveTextContent("مدين ودائن معاً");
    expect(split).toHaveTextContent("AccountStatementCSV_20260923.csv");
    expect(split).toHaveTextContent("2026/09/24 09:05 AM");
    expect(split).toHaveTextContent("Rami Haddad");
    expect(within(empty).getByTestId("ambiguous-reason")).toHaveTextContent("بلا مدين ولا دائن");
    expect(empty).toHaveTextContent("(بدون اسم ملف)");
    expect(empty).toHaveTextContent("old@office.test");
    // It explains they weren't saved and how to add a real one.
    expect(screen.getByRole("dialog")).toHaveTextContent("لم تُحفظ: إذا كانت إحداها عملية حقيقية، أضفها بـ Cash In أو Cash Out");
  });

  it("shows the store column only for All stores", async () => {
    open({ withStore: true });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("columnheader", { name: "المتجر" })).toBeInTheDocument();
    expect(rows()[1]).toHaveTextContent("(متجر محذوف)");
    cleanup();
    open();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByRole("columnheader", { name: "المتجر" })).not.toBeInTheDocument();
  });

  it("with none: says every imported row was clear", async () => {
    api.importHistory.ambiguous.mockResolvedValue({ total: 0, truncated: false, rows: [] });
    open();
    expect(await screen.findByTestId("ambiguous-empty")).toHaveTextContent("لا توجد صفوف غير واضحة");
  });

  it("a failed load shows an error", async () => {
    api.importHistory.ambiguous.mockRejectedValue(new Error(""));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل الصفوف غير الواضحة.");
  });

  it("closes with its labelled ✕ button, or Escape", async () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("in English", async () => {
    open({}, "en");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("dialog", { name: "Ambiguous statement rows" })).toBeInTheDocument();
    expect(within(rows()[0]).getByTestId("ambiguous-reason")).toHaveTextContent("Both debit and credit");
    expect(screen.getByTestId("ambiguous-count")).toHaveTextContent("2 rows set aside");
  });
});

describe("row actions: accept as is, discard, or correct and add (user's request, 2026-09-29)", () => {
  const openRow = async (props = {}) => {
    const opened = open(props);
    await waitFor(() => expect(rows()).toHaveLength(2));
    return opened;
  };
  // The "SPLIT" row (id 2): a real debit and credit, so the guessed amount/type are usable as-is.
  const splitRow = () => rows()[0];

  it("accept as is: an inline confirmation, then it's saved as printed (the larger of debit/credit wins) and the row is gone", async () => {
    api.importHistory.convert.mockResolvedValue({ transaction: { id: 99 }, discarded_id: 2 });
    const { onChanged } = await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-accept"));
    expect(api.importHistory.convert).not.toHaveBeenCalled();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-accept-confirm"));
    expect(await findToast("أُضيف الصف كما هو مطبوع.")).toHaveAttribute("data-type", "success");
    // SPLIT: debit 3.00 >= credit 2.00 -> Cash Out of 3, same as the file's own larger figure.
    expect(api.importHistory.convert).toHaveBeenCalledWith(2, expect.objectContaining({ type: "cash_out", amount: 3, transaction_date: "2026-09-23" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(onChanged).toHaveBeenCalledWith({ createdTransaction: true });
  });

  it("accept as is: cancelling the confirmation calls nothing", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-accept"));
    fireEvent.click(within(splitRow()).getByRole("button", { name: "إلغاء" }));
    expect(api.importHistory.convert).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it("accept as is: a failure (e.g. a 'neither' row with nothing usable) shows an error toast and keeps the row", async () => {
    api.importHistory.convert.mockRejectedValue(new Error(""));
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-accept"));
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-accept-confirm"));
    expect(await findToast("تعذّرت إضافة الصف كما هو مطبوع.")).toHaveAttribute("data-type", "error");
    expect(rows()).toHaveLength(2);
  });

  it("discard: an inline confirmation, then it's gone (and the dashboard is told, without a refresh)", async () => {
    api.importHistory.discardAmbiguous.mockResolvedValue({ ok: true, id: 2 });
    const { onChanged } = await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-discard"));
    expect(api.importHistory.discardAmbiguous).not.toHaveBeenCalled();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-discard-confirm"));
    expect(await findToast("تم تجاهل الصف.")).toHaveAttribute("data-type", "success");
    expect(api.importHistory.discardAmbiguous).toHaveBeenCalledWith(2);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId("ambiguous-count")).toHaveTextContent("1 صفاً وُضع جانباً");
    expect(onChanged).toHaveBeenCalledWith({ createdTransaction: false });
  });

  it("discard: cancelling the confirmation calls nothing", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-discard"));
    fireEvent.click(within(splitRow()).getByRole("button", { name: "إلغاء" }));
    expect(api.importHistory.discardAmbiguous).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it("discard: a failure shows an error toast and keeps the row", async () => {
    api.importHistory.discardAmbiguous.mockRejectedValue(new Error(""));
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-discard"));
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-discard-confirm"));
    expect(await findToast("تعذّر تجاهل الصف.")).toHaveAttribute("data-type", "error");
    expect(rows()).toHaveLength(2);
  });

  it("correct and add: opens with the row's own debit and credit — both filled (its 'both' reason) blocks saving", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    expect(within(modal).getByTestId("convert-debit")).toHaveValue(3);
    expect(within(modal).getByTestId("convert-credit")).toHaveValue(2);
    expect(within(modal).getByTestId("convert-date")).toHaveValue("2026-09-23");
    expect(within(modal).getByTestId("convert-original")).toHaveTextContent("SPLIT");
    expect(within(modal).getByTestId("convert-debit-credit-error")).toHaveTextContent("أدخل مبلغاً مديناً أو دائناً");
    expect(within(modal).getByTestId("convert-save")).toBeDisabled();
  });

  it("correct and add: clearing one of debit/credit lets the other save (debit → Cash Out)", async () => {
    api.importHistory.convert.mockResolvedValue({ transaction: { id: 99 }, discarded_id: 2 });
    const { onChanged } = await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-credit"), { target: { value: "" } });
    expect(within(modal).queryByTestId("convert-debit-credit-error")).not.toBeInTheDocument();
    expect(within(modal).getByTestId("convert-save")).not.toBeDisabled();
    fireEvent.click(within(modal).getByTestId("convert-save"));
    expect(await findToast("أُضيف الصف كعملية.")).toHaveAttribute("data-type", "success");
    expect(api.importHistory.convert).toHaveBeenCalledWith(2, expect.objectContaining({ type: "cash_out", amount: 3, transaction_date: "2026-09-23" }));
    await waitFor(() => expect(screen.queryByTestId("convert-ambiguous-modal")).not.toBeInTheDocument());
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(onChanged).toHaveBeenCalledWith({ createdTransaction: true });
  });

  it("correct and add: a credit alone converts to Cash In", async () => {
    api.importHistory.convert.mockResolvedValue({ transaction: { id: 99 }, discarded_id: 2 });
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-debit"), { target: { value: "" } });
    fireEvent.click(within(modal).getByTestId("convert-save"));
    await waitFor(() => expect(api.importHistory.convert).toHaveBeenCalledWith(2, expect.objectContaining({ type: "cash_in", amount: 2 })));
  });

  it("correct and add: a negative value is accepted — its absolute value becomes the amount", async () => {
    api.importHistory.convert.mockResolvedValue({ transaction: { id: 99 }, discarded_id: 2 });
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-credit"), { target: { value: "" } });
    fireEvent.change(within(modal).getByTestId("convert-debit"), { target: { value: "-7.5" } });
    fireEvent.click(within(modal).getByTestId("convert-save"));
    await waitFor(() => expect(api.importHistory.convert).toHaveBeenCalledWith(2, expect.objectContaining({ type: "cash_out", amount: 7.5 })));
  });

  it("correct and add: clearing both leaves Save disabled, without the 'both filled' error", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-debit"), { target: { value: "" } });
    fireEvent.change(within(modal).getByTestId("convert-credit"), { target: { value: "" } });
    expect(within(modal).queryByTestId("convert-debit-credit-error")).not.toBeInTheDocument();
    expect(within(modal).getByTestId("convert-save")).toBeDisabled();
  });

  it("correct and add: a non-numeric value leaves Save disabled", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-credit"), { target: { value: "" } });
    fireEvent.change(within(modal).getByTestId("convert-debit"), { target: { value: "not-a-number" } });
    expect(within(modal).getByTestId("convert-save")).toBeDisabled();
  });

  it("correct and add: a zero value doesn't count as filled — Save stays disabled, no 'both filled' error", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-debit"), { target: { value: "0" } });
    fireEvent.change(within(modal).getByTestId("convert-credit"), { target: { value: "0.00" } });
    expect(within(modal).queryByTestId("convert-debit-credit-error")).not.toBeInTheDocument();
    expect(within(modal).getByTestId("convert-save")).toBeDisabled();
  });

  it("correct and add: a failure shows an error (inline and toast) and keeps the row and the form open", async () => {
    api.importHistory.convert.mockRejectedValue(new Error(""));
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.change(within(modal).getByTestId("convert-credit"), { target: { value: "" } });
    fireEvent.click(within(modal).getByTestId("convert-save"));
    expect(await findToast("تعذّرت إضافة الصف.")).toHaveAttribute("data-type", "error");
    expect(within(modal).getByRole("alert")).toHaveTextContent("تعذّرت إضافة الصف.");
    expect(screen.getByTestId("convert-ambiguous-modal")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it("correct and add: Cancel closes the form without saving", async () => {
    await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    const modal = await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.click(within(modal).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByTestId("convert-ambiguous-modal")).not.toBeInTheDocument();
    expect(api.importHistory.convert).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it("Escape does nothing while the correction form is open (it has its own Cancel/✕), not even closing the window behind it", async () => {
    const { onClose } = await openRow();
    fireEvent.click(within(splitRow()).getByTestId("ambiguous-convert"));
    await screen.findByTestId("convert-ambiguous-modal");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("convert-ambiguous-modal")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("ambiguous-modal")).toBeInTheDocument();
  });

  it("the dashboard's window shows an Actions column; a read-only table (no callbacks, as in the import preview) doesn't", async () => {
    await openRow();
    expect(screen.getByRole("columnheader", { name: "إجراءات" })).toBeInTheDocument();
    cleanup();
    render(<LanguageProvider><AmbiguousRowsTable rows={ROWS} /></LanguageProvider>);
    expect(screen.queryByRole("columnheader", { name: "إجراءات" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("ambiguous-accept")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ambiguous-convert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ambiguous-discard")).not.toBeInTheDocument();
  });
});

describe("the button beside Import", () => {
  const renderList = (props = {}) => render(
    <TransactionsList transactions={[]} loading={false} search="" setSearch={vi.fn()} selectedDate="2026-09-23" setSelectedDate={vi.fn()}
      onToday={vi.fn()} onCashIn={vi.fn()} onCashOut={vi.fn()} onImportPDF={vi.fn()} onRefresh={vi.fn()} onDeleteDailyBalanceForDate={vi.fn()} {...props} />
  );

  it("sits right after the Import button and opens the window for the dashboard's store", async () => {
    renderList({ storeId: 3 });
    const button = screen.getByTestId("ambiguous-button");
    expect(button).toHaveTextContent("عمليات غير واضحة");
    expect(button.previousElementSibling).toHaveTextContent("استيراد PDF / CSV");
    fireEvent.click(button);
    await waitFor(() => expect(api.importHistory.ambiguous).toHaveBeenCalledWith(3));
    expect(await screen.findByTestId("ambiguous-modal")).toBeInTheDocument();
  });

  it("a badge on its corner shows how many rows are set aside, also in the button's name", async () => {
    api.importHistory.ambiguousCount.mockResolvedValue({ total: 7 });
    renderList({ storeId: 3 });
    expect(await screen.findByTestId("ambiguous-badge")).toHaveTextContent("7");
    expect(api.importHistory.ambiguousCount).toHaveBeenCalledWith(3);
    expect(screen.getByTestId("ambiguous-button")).toHaveAccessibleName("عمليات غير واضحة: 7 صفاً جانباً");
    expect(screen.getByTestId("ambiguous-badge")).toHaveClass("absolute", "-top-2", "-end-2");
  });

  it("no badge when there are none, or when the count can't be loaded", async () => {
    renderList();
    await waitFor(() => expect(api.importHistory.ambiguousCount).toHaveBeenCalled());
    expect(screen.queryByTestId("ambiguous-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("ambiguous-button")).toHaveAccessibleName("عمليات غير واضحة");
    cleanup();
    api.importHistory.ambiguousCount.mockRejectedValue(new Error("offline"));
    renderList();
    await waitFor(() => expect(api.importHistory.ambiguousCount).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("ambiguous-badge")).not.toBeInTheDocument();
  });

  it("over 99 it reads 99+", async () => {
    api.importHistory.ambiguousCount.mockResolvedValue({ total: 250 });
    renderList();
    expect(await screen.findByTestId("ambiguous-badge")).toHaveTextContent("99+");
  });

  it("it's asked again when the store or the day's rows change (e.g. after an import)", async () => {
    api.importHistory.ambiguousCount.mockResolvedValueOnce({ total: 1 }).mockResolvedValueOnce({ total: 4 });
    const { rerender } = renderList({ storeId: 1 });
    expect(await screen.findByTestId("ambiguous-badge")).toHaveTextContent("1");
    const props = { transactions: [], dayTransactions: [], loading: false, search: "", setSearch: vi.fn(), selectedDate: "2026-09-23", setSelectedDate: vi.fn(), onToday: vi.fn(), onCashIn: vi.fn(), onCashOut: vi.fn(), onImportPDF: vi.fn(), onRefresh: vi.fn(), onDeleteDailyBalanceForDate: vi.fn() };
    rerender(<TransactionsList {...props} storeId={2} />);
    await waitFor(() => expect(screen.getByTestId("ambiguous-badge")).toHaveTextContent("4"));
    expect(api.importHistory.ambiguousCount).toHaveBeenLastCalledWith(2);
  });

  it("in English", async () => {
    api.importHistory.ambiguousCount.mockResolvedValue({ total: 1 });
    render(<LanguageProvider initialLang="en"><TransactionsList transactions={[]} loading={false} search="" setSearch={vi.fn()} selectedDate="2026-09-23" setSelectedDate={vi.fn()} onToday={vi.fn()} onCashIn={vi.fn()} onCashOut={vi.fn()} onImportPDF={vi.fn()} onRefresh={vi.fn()} onDeleteDailyBalanceForDate={vi.fn()} /></LanguageProvider>);
    await screen.findByTestId("ambiguous-badge");
    expect(screen.getByTestId("ambiguous-button")).toHaveAccessibleName("Ambiguous rows: 1 set aside");
  });

  it.each(["manager", "user"])("a %s has it too (everyone who imports)", (role) => {
    setAuthRole(role);
    renderList();
    expect(screen.getByTestId("ambiguous-button")).toBeInTheDocument();
  });
});
