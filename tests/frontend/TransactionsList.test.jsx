/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionsList, { sortByType } from "@/components/dashboard/TransactionsList";
import { base44 } from "@/api/base44Client";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin"));

vi.mock("@/api/base44Client", () => ({
  base44: { entities: { Transaction: { delete: vi.fn(), bulkDelete: vi.fn(), bulkUpdate: vi.fn() } } },
}));

const transactions = [
  {
    id: 1, type: "cash_out", amount: 1500, commission: 0, sender_name: "Vicario", receiver_name: "",
    phone: "+96171389296", customer_number: "71389296", service: "W2W", note: "",
    reference_number: "tr:427834925", transaction_date: "2026-09-23", created_date: "2026-09-23T10:00:00Z",
  },
  {
    id: 2, type: "cash_in", amount: 50, commission: 0.5, sender_name: "MOUNIR TOSKA", receiver_name: "Vicario",
    phone: "96171588017", customer_number: "71588017", service: "", note: "",
    reference_number: "tr:626203096", transaction_date: "2026-09-23", created_date: "2026-09-23T11:00:00Z",
  },
];

const renderList = (props = {}) =>
  render(
    <TransactionsList
      transactions={transactions}
      allTransactions={transactions}
      loading={false}
      search=""
      setSearch={vi.fn()}
      selectedDate="2026-09-23"
      setSelectedDate={vi.fn()}
      onToday={vi.fn()}
      onCashIn={vi.fn()}
      onCashOut={vi.fn()}
      onImportPDF={vi.fn()}
      onRefresh={vi.fn()}
      onResetOpeningBalance={vi.fn()}
      onDeleteDailyBalanceForDate={vi.fn()}
      {...props}
    />
  );

afterEach(cleanup);

const bodyRows = (container) => [...container.querySelectorAll("tbody tr")];

describe("TransactionsList", () => {
  it("renders one table row per transaction", () => {
    const { container } = renderList();
    expect(bodyRows(container)).toHaveLength(2);
    expect(screen.getByText("2 عملية")).toBeInTheDocument();
  });

  it("does not offer manual insertion between rows", () => {
    const { container } = renderList();
    bodyRows(container).forEach((row) => fireEvent.mouseEnter(row));
    expect(screen.queryByText(/إدراج هنا/)).not.toBeInTheDocument();
  });

  it("shows the customer number in the receiver column when receiver_name is empty", () => {
    const { container } = renderList();
    const [firstRow] = bodyRows(container);
    expect(within(firstRow).getByText("71389296")).toBeInTheDocument();
    expect(within(firstRow).getByText("$1500.00")).toBeInTheDocument();
    expect(within(firstRow).getByText("W2W")).toBeInTheDocument();
  });

  it("does not show the undo or refresh buttons", () => {
    renderList();
    expect(screen.queryByText(/تراجع/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تحديث/ })).not.toBeInTheDocument();
  });

  it("opens and closes the monthly chart", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /الرسم البياني/ }));
    expect(screen.getByText("الرسم البياني الشهري")).toBeInTheDocument();
    expect(screen.getByLabelText("السنة")).toHaveValue("2026");
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByText("الرسم البياني الشهري")).not.toBeInTheDocument();
  });

  it("deletes a single transaction immediately after confirming, then refreshes", async () => {
    const onRefresh = vi.fn();
    const onDeleteDailyBalanceForDate = vi.fn();
    const { container } = renderList({ onRefresh, onDeleteDailyBalanceForDate });
    fireEvent.click(within(bodyRows(container)[0]).getByTitle("مسح"));
    fireEvent.click(within(bodyRows(container)[0]).getByText("تأكيد"));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(base44.entities.Transaction.delete).toHaveBeenCalledWith(1);
    expect(onDeleteDailyBalanceForDate).toHaveBeenCalledWith("2026-09-23");
  });

  it("does not show the statement review button", () => {
    renderList();
    expect(screen.queryByText("مراجعة الكشف")).not.toBeInTheDocument();
  });

  it("shows both sender and receiver report buttons", () => {
    renderList();
    expect(screen.getByRole("button", { name: /تقرير مرسل/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /تقرير مستلم/ })).toBeInTheDocument();
  });

  it("opens the receiver report over all transactions and closes it", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /تقرير مستلم/ }));
    expect(screen.getByText("تقرير المستلم")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("اكتب اسم أو رقم المستلم..."), { target: { value: "71389296" } });
    expect(screen.getByTestId("receiver-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByText("تقرير المستلم")).not.toBeInTheDocument();
  });

  it("opens the sender report", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /تقرير مرسل/ }));
    expect(screen.getByText("تقرير المرسل")).toBeInTheDocument();
  });

  it("wires the import and cash buttons", () => {
    const onImportPDF = vi.fn();
    const onCashIn = vi.fn();
    const onCashOut = vi.fn();
    renderList({ onImportPDF, onCashIn, onCashOut });
    fireEvent.click(screen.getByRole("button", { name: /استيراد PDF \/ CSV/ }));
    // "Cash In"/"Cash Out" also appear as type badges in the rows, so target the buttons.
    fireEvent.click(screen.getByRole("button", { name: /Cash In/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cash Out/ }));
    expect(onImportPDF).toHaveBeenCalledTimes(1);
    expect(onCashIn).toHaveBeenCalledTimes(1);
    expect(onCashOut).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no transactions", () => {
    renderList({ transactions: [], allTransactions: [] });
    expect(screen.getByText("لا توجد معاملات")).toBeInTheDocument();
  });

  it("forwards typing in the search box", () => {
    const setSearch = vi.fn();
    renderList({ setSearch });
    fireEvent.change(screen.getByPlaceholderText(/ابحث عن اسم/), { target: { value: "71389296" } });
    expect(setSearch).toHaveBeenCalledWith("71389296");
  });
});

describe("TransactionsList — bulk actions", () => {
  const third = {
    id: 3, type: "cash_in", amount: 20, commission: 0.2, sender_name: "OTHER", receiver_name: "Vicario",
    service: "", note: "", reference_number: "tr:3", transaction_date: "2026-09-22", created_date: "2026-09-22T11:00:00Z",
  };
  const rows3 = [...transactions, third];

  beforeEach(() => {
    vi.clearAllMocks();
    base44.entities.Transaction.bulkDelete.mockResolvedValue({ deleted: 2 });
    base44.entities.Transaction.bulkUpdate.mockResolvedValue({ updated: 2, records: [] });
  });

  const rowBox = (n) => screen.getByLabelText(`تحديد العملية ${n}`);
  const selectAll = () => screen.getByLabelText("تحديد كل العمليات الظاهرة");
  const bar = () => screen.queryByRole("region", { name: "إجراءات جماعية" });

  it("shows no bulk bar until something is selected", () => {
    renderList();
    expect(bar()).not.toBeInTheDocument();
    expect(selectAll()).not.toBeChecked();
  });

  it("selects individual rows and shows the count and total amount", () => {
    const { container } = renderList();
    fireEvent.click(rowBox(1));
    expect(bar()).toBeInTheDocument();
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("1 عملية محددة($1,500.00)");
    expect(bodyRows(container)[0]).toHaveAttribute("aria-selected", "true");
    expect(bodyRows(container)[0]).toHaveClass("bg-blue-50");

    fireEvent.click(rowBox(2));
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("2 عملية محددة($1,550.00)");

    fireEvent.click(rowBox(1));
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("1 عملية محددة($50.00)");
  });

  it("select-all toggles every visible row and shows a partial state", () => {
    renderList();
    fireEvent.click(rowBox(1));
    expect(selectAll()).not.toBeChecked();
    expect(selectAll().indeterminate).toBe(true);

    fireEvent.click(selectAll());
    expect(selectAll()).toBeChecked();
    expect(selectAll().indeterminate).toBe(false);
    expect(rowBox(1)).toBeChecked();
    expect(rowBox(2)).toBeChecked();

    fireEvent.click(selectAll());
    expect(rowBox(1)).not.toBeChecked();
    expect(bar()).not.toBeInTheDocument();
  });

  it("clears the selection", () => {
    renderList();
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole("button", { name: /إلغاء التحديد/ }));
    expect(bar()).not.toBeInTheDocument();
    expect(rowBox(1)).not.toBeChecked();
  });

  it("drops selected rows that are no longer visible (other day or search)", () => {
    const { rerender } = renderList({ transactions: rows3, allTransactions: rows3 });
    fireEvent.click(selectAll());
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("3 عملية محددة");

    rerender(
      <TransactionsList
        transactions={[transactions[1]]} allTransactions={rows3} loading={false} search="mounir" setSearch={vi.fn()}
        selectedDate="2026-09-23" setSelectedDate={vi.fn()} onToday={vi.fn()} onCashIn={vi.fn()} onCashOut={vi.fn()}
        onImportPDF={vi.fn()} onRefresh={vi.fn()} onResetOpeningBalance={vi.fn()} onDeleteDailyBalanceForDate={vi.fn()}
      />
    );
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("1 عملية محددة($50.00)");
  });

  it("asks for confirmation, then deletes all selected rows in one request", async () => {
    const onRefresh = vi.fn();
    const onDeleteDailyBalanceForDate = vi.fn();
    renderList({ transactions: rows3, allTransactions: rows3, onRefresh, onDeleteDailyBalanceForDate });
    fireEvent.click(rowBox(1));
    fireEvent.click(rowBox(3));
    fireEvent.click(screen.getByRole("button", { name: /حذف المحدد/ }));

    const dialog = screen.getByRole("alertdialog", { name: "تأكيد حذف المحدد" });
    expect(dialog).toHaveTextContent("هل أنت متأكد من حذف 2 عملية؟");
    expect(base44.entities.Transaction.bulkDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "حذف 2 عملية" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(base44.entities.Transaction.bulkDelete).toHaveBeenCalledWith([1, 3]);
    // Opening balances are cleaned up once for each affected day.
    expect(onDeleteDailyBalanceForDate.mock.calls.map((c) => c[0]).sort()).toEqual(["2026-09-22", "2026-09-23"]);
    expect(bar()).not.toBeInTheDocument();
  });

  it("cancelling the bulk delete keeps everything", () => {
    renderList();
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole("button", { name: /حذف المحدد/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(base44.entities.Transaction.bulkDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("2 عملية محددة");
  });

  it("shows an error if the bulk delete fails and keeps the selection", async () => {
    base44.entities.Transaction.bulkDelete.mockRejectedValue(new Error("boom"));
    const onRefresh = vi.fn();
    renderList({ onRefresh });
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole("button", { name: /حذف المحدد/ }));
    fireEvent.click(screen.getByRole("button", { name: "حذف 2 عملية" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("2 عملية محددة");
  });

  it("bulk edits the selected rows and refreshes", async () => {
    const onRefresh = vi.fn();
    renderList({ onRefresh });
    fireEvent.click(rowBox(2));
    fireEvent.click(screen.getByRole("button", { name: /تعديل المحدد/ }));
    expect(screen.getByText("تعديل 1 عملية")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("تغيير الخدمة"));
    fireEvent.change(screen.getByLabelText("الخدمة"), { target: { value: "QR" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(base44.entities.Transaction.bulkUpdate).toHaveBeenCalledWith([2], { service: "QR" });
    expect(screen.queryByText("تعديل 1 عملية")).not.toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
  });

  it("moving rows to another date cleans up only the days they left", async () => {
    const onDeleteDailyBalanceForDate = vi.fn();
    renderList({ transactions: rows3, allTransactions: rows3, onDeleteDailyBalanceForDate });
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole("button", { name: /تعديل المحدد/ }));
    fireEvent.click(screen.getByLabelText("تغيير التاريخ"));
    fireEvent.change(screen.getByLabelText("التاريخ"), { target: { value: "2026-09-22" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(base44.entities.Transaction.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { transaction_date: "2026-09-22" }));
    await waitFor(() => expect(onDeleteDailyBalanceForDate.mock.calls.map((c) => c[0])).toEqual(["2026-09-23"]));
  });
});

describe("TransactionsList — role-based controls", () => {
  // Row 1 entered by the User, row 2 by someone else.
  const mixed = [
    { ...transactions[0], created_by: "user@test.local" },
    { ...transactions[1], created_by: "manager@test.local" },
  ];
  const rowBox = (n) => screen.getByLabelText(`تحديد العملية ${n}`);

  it("User: no delete controls anywhere, edit only on their own rows", () => {
    setAuthRole("user");
    const { container } = renderList({ transactions: mixed, allTransactions: mixed });
    const [own, other] = bodyRows(container);
    expect(screen.queryByTitle("مسح")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /مسح الكل/ })).not.toBeInTheDocument();
    expect(within(own).getByTitle("تعديل")).toBeInTheDocument();
    expect(within(other).queryByTitle("تعديل")).not.toBeInTheDocument();
  });

  it("User: bulk edit only when every selected row is theirs, and never bulk delete", () => {
    setAuthRole("user");
    renderList({ transactions: mixed, allTransactions: mixed });
    fireEvent.click(rowBox(1));
    expect(screen.getByRole("button", { name: /تعديل المحدد/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف المحدد/ })).not.toBeInTheDocument();

    fireEvent.click(rowBox(2));
    expect(screen.queryByRole("button", { name: /تعديل المحدد/ })).not.toBeInTheDocument();
    expect(screen.getByText("يمكنك تعديل العمليات التي أدخلتها فقط")).toBeInTheDocument();
  });

  it("User: can still add, import, view reports and the chart", () => {
    setAuthRole("user");
    renderList({ transactions: mixed, allTransactions: mixed });
    ["Cash In", "Cash Out", "استيراد PDF / CSV", "تقرير مرسل", "تقرير مستلم", "تقرير العمولات", "الرسم البياني"].forEach((name) => {
      expect(screen.getByRole("button", { name: new RegExp(name.replace("/", "\/")) })).toBeInTheDocument();
    });
  });

  it.each(["manager", "admin"])("%s: edit and delete on every row, bulk edit and delete, delete all", (role) => {
    setAuthRole(role);
    const { container } = renderList({ transactions: mixed, allTransactions: mixed });
    bodyRows(container).forEach((row) => {
      expect(within(row).getByTitle("تعديل")).toBeInTheDocument();
      expect(within(row).getByTitle("مسح")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /مسح الكل/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("تحديد كل العمليات الظاهرة"));
    expect(screen.getByRole("button", { name: /تعديل المحدد/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /حذف المحدد/ })).toBeInTheDocument();
  });
});

describe("TransactionsList — type column (icons + sorting)", () => {
  const mixed = [
    { ...transactions[0], id: 11, sender_name: "OUT-A" },
    { ...transactions[1], id: 12, sender_name: "IN-A" },
    { ...transactions[0], id: 13, sender_name: "OUT-B" },
    { ...transactions[1], id: 14, sender_name: "IN-B" },
  ];
  const typeIcons = (container) => bodyRows(container).map((row) => row.querySelector("td:nth-child(3) [role='img']"));
  const senders = (container) => bodyRows(container).map((row) => row.querySelector("td:nth-child(4)").textContent);
  const numbers = (container) => bodyRows(container).map((row) => row.querySelector("td:nth-child(2)").textContent);

  it("shows a green icon for Cash In and a red one for Cash Out instead of text, still named for screen readers", () => {
    const { container } = renderList();
    const [outIcon, inIcon] = typeIcons(container);
    expect(outIcon).toHaveAccessibleName("Cash Out");
    expect(outIcon).toHaveAttribute("title", "Cash Out");
    expect(outIcon).toHaveClass("bg-red-100", "text-red-600");
    expect(outIcon.querySelector("svg")).toHaveClass("lucide-arrow-up");
    expect(inIcon).toHaveAccessibleName("Cash In");
    expect(inIcon).toHaveClass("bg-green-100", "text-green-700");
    expect(inIcon.querySelector("svg")).toHaveClass("lucide-arrow-down");
    // No visible "Cash In"/"Cash Out" text left in the rows.
    bodyRows(container).forEach((row) => expect(row.querySelector("td:nth-child(3)").textContent).toBe(""));
  });

  it("the Type header sorts: Cash In first → Cash Out first → original order", () => {
    const { container } = renderList({ transactions: mixed, allTransactions: mixed });
    const header = screen.getByTestId("sort-type");
    const th = header.closest("th");
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(header).toHaveAttribute("title", "ترتيب حسب النوع: Cash In أولاً");
    expect(senders(container)).toEqual(["OUT-A", "IN-A", "OUT-B", "IN-B"]);

    fireEvent.click(header);
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(senders(container)).toEqual(["IN-A", "IN-B", "OUT-A", "OUT-B"]);
    expect(typeIcons(container).map((i) => i.dataset.type)).toEqual(["cash_in", "cash_in", "cash_out", "cash_out"]);
    // "#" keeps each row's real place in the day's journal.
    expect(numbers(container)).toEqual(["2", "4", "1", "3"]);

    fireEvent.click(header);
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(senders(container)).toEqual(["OUT-A", "OUT-B", "IN-A", "IN-B"]);
    expect(header).toHaveAttribute("title", "العودة إلى الترتيب الأصلي");

    fireEvent.click(header);
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(senders(container)).toEqual(["OUT-A", "IN-A", "OUT-B", "IN-B"]);
  });

  it("sorting only reorders: selection and bulk actions still use the same rows", () => {
    const { container } = renderList({ transactions: mixed, allTransactions: mixed });
    fireEvent.click(screen.getByTestId("sort-type"));
    const firstRow = bodyRows(container)[0];
    fireEvent.click(within(firstRow).getByRole("checkbox"));
    expect(screen.getByTestId("bulk-selected-count")).toHaveTextContent("1");
    expect(within(bodyRows(container)[0]).getByRole("checkbox")).toBeChecked();
    expect(senders(container)[0]).toBe("IN-A");
  });

  it("sortByType is stable and doesn't change the input", () => {
    const input = [...mixed];
    expect(sortByType(input, "none")).toBe(input);
    expect(sortByType(input, "cash_out").map((t) => t.id)).toEqual([11, 13, 12, 14]);
    expect(input.map((t) => t.id)).toEqual([11, 12, 13, 14]);
  });
});
