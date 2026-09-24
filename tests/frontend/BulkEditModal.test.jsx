/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BulkEditModal from "@/components/transactions/BulkEditModal";
import { base44 } from "@/api/base44Client";

vi.mock("@/api/base44Client", () => ({
  base44: { entities: { Transaction: { bulkUpdate: vi.fn() } } },
}));

const selected = [
  { id: 11, amount: 100, transaction_date: "2026-09-23" },
  { id: 12, amount: 250, transaction_date: "2026-09-23" },
  { id: 13, amount: 75, transaction_date: "2026-09-22" },
];

const renderModal = () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<BulkEditModal transactions={selected} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
};

const enable = (label) => fireEvent.click(screen.getByLabelText(`تغيير ${label}`));
const saveButton = () => screen.getByRole("button", { name: "حفظ التعديلات" });

beforeEach(() => {
  vi.clearAllMocks();
  base44.entities.Transaction.bulkUpdate.mockResolvedValue({ updated: 3, records: [] });
});

afterEach(cleanup);

describe("BulkEditModal", () => {
  it("states how many transactions will be edited", () => {
    renderModal();
    expect(screen.getByText("تعديل 3 عملية")).toBeInTheDocument();
  });

  it("starts with every field disabled and saving blocked", () => {
    renderModal();
    ["النوع", "نسبة العمولة (%)", "الخدمة", "اسم المرسل", "اسم المستلم", "التاريخ", "ملاحظة"].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeDisabled();
    });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("لم يتم اختيار أي حقل")).toBeInTheDocument();
  });

  it("enables a field only when its change box is ticked", () => {
    renderModal();
    enable("الخدمة");
    expect(screen.getByLabelText("الخدمة")).toBeEnabled();
    expect(screen.getByLabelText("ملاحظة")).toBeDisabled();
    expect(screen.getByText("سيتم تغيير 1 حقل في 3 عملية")).toBeInTheDocument();
  });

  it("sends only the enabled fields for all selected ids", async () => {
    const { onSaved } = renderModal();
    enable("الخدمة");
    fireEvent.change(screen.getByLabelText("الخدمة"), { target: { value: "W2W" } });
    enable("النوع");
    fireEvent.change(screen.getByLabelText("النوع"), { target: { value: "cash_out" } });
    // Fields left unticked (e.g. note) are not sent.
    fireEvent.click(saveButton());

    await waitFor(() => expect(base44.entities.Transaction.bulkUpdate).toHaveBeenCalledTimes(1));
    expect(base44.entities.Transaction.bulkUpdate).toHaveBeenCalledWith([11, 12, 13], { service: "W2W", type: "cash_out" });
    expect(onSaved).toHaveBeenCalledWith({ service: "W2W", type: "cash_out" });
  });

  it("sends the commission rate as a number", async () => {
    renderModal();
    enable("نسبة العمولة (%)");
    fireEvent.change(screen.getByLabelText("نسبة العمولة (%)"), { target: { value: "1.5" } });
    expect(screen.getByText("تُحسب العمولة لكل عملية من مبلغها")).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(base44.entities.Transaction.bulkUpdate).toHaveBeenCalledWith([11, 12, 13], { commission_rate: 1.5 }));
  });

  it("can deliberately clear a text field", async () => {
    renderModal();
    enable("ملاحظة");
    fireEvent.click(saveButton());
    await waitFor(() => expect(base44.entities.Transaction.bulkUpdate).toHaveBeenCalledWith([11, 12, 13], { note: "" }));
  });

  it("moves transactions to another date", async () => {
    const { onSaved } = renderModal();
    enable("التاريخ");
    expect(screen.getByText("اختر التاريخ الجديد")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("التاريخ"), { target: { value: "2026-09-25" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ transaction_date: "2026-09-25" }));
  });

  it("blocks an invalid commission rate", () => {
    renderModal();
    enable("نسبة العمولة (%)");
    fireEvent.change(screen.getByLabelText("نسبة العمولة (%)"), { target: { value: "-2" } });
    expect(screen.getByText("نسبة العمولة يجب أن تكون رقماً موجباً")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("shows the server error and stays open when saving fails", async () => {
    base44.entities.Transaction.bulkUpdate.mockRejectedValue(new Error("No transactions selected"));
    const { onSaved } = renderModal();
    enable("الخدمة");
    fireEvent.click(saveButton());
    expect(await screen.findByText("لم يتم تحديد أي عملية")).toBeInTheDocument(); // API message, translated
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("closes without saving", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(base44.entities.Transaction.bulkUpdate).not.toHaveBeenCalled();
  });
});
