/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportPDFModal from "@/components/transactions/ImportPDFModal";
import { base44 } from "@/api/base44Client";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin"));

vi.mock("@/api/base44Client", () => ({
  base44: {
    integrations: { Core: { ExtractPdf: vi.fn(), ExtractCsv: vi.fn() } },
    entities: { Transaction: { findDuplicates: vi.fn(), importRecords: vi.fn() } },
  },
}));

const extraction = (overrides = {}) => ({
  statement_date: "2026-09-23",
  opening_balance: 100,
  closing_balance: 165,
  total_transactions_count: 2,
  validation: { is_valid: true, total_debit_matches: true, total_credit_matches: true, closing_balance_matches: true, balance_mismatch_lines: [] },
  transactions: [
    {
      type: "cash_in", amount: 75, commission: 0.75, sender_name: "MOUNIR TOSKA", receiver_name: "Vicario",
      phone: "96171588017", customer_number: "71588017", service: "", reference_number: "tr:1", date: "2026-09-23",
    },
    {
      type: "cash_out", amount: 10, commission: 0, sender_name: "Vicario", receiver_name: "+9613915112",
      phone: "", customer_number: "", service: "", reference_number: "tr:2", date: "2026-09-23",
    },
  ],
  ...overrides,
});

const csvFile = () => new File(["line_no,date,debit,credit,balance\n"], "statement.csv", { type: "application/vnd.ms-excel" });
const pdfFile = () => new File(["%PDF-1.7 fake"], "statement.pdf", { type: "application/pdf" });

const upload = (container, file) => {
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
};

const renderModal = () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(<ImportPDFModal onClose={onClose} onSaved={onSaved} />);
  return { ...utils, onClose, onSaved };
};

beforeEach(() => {
  vi.clearAllMocks();
  base44.integrations.Core.ExtractCsv.mockResolvedValue(extraction());
  base44.integrations.Core.ExtractPdf.mockResolvedValue(extraction({ validation: undefined }));
  base44.entities.Transaction.findDuplicates.mockResolvedValue([]);
  base44.entities.Transaction.importRecords.mockResolvedValue({ replaced: 0, records: [] });
});

afterEach(cleanup);

describe("ImportPDFModal", () => {
  it("accepts PDF or CSV files", () => {
    const { container } = renderModal();
    expect(container.querySelector('input[type="file"]').getAttribute("accept")).toBe(".pdf,.csv,application/pdf,text/csv");
    expect(screen.getByText("استيراد من PDF / CSV")).toBeInTheDocument();
  });

  it("rejects files that are neither PDF nor CSV", async () => {
    const { container } = renderModal();
    upload(container, new File(["\x89PNG"], "photo.png", { type: "image/png" }));
    expect(await screen.findByText("يرجى اختيار ملف PDF أو CSV فقط")).toBeInTheDocument();
    expect(base44.integrations.Core.ExtractCsv).not.toHaveBeenCalled();
    expect(base44.integrations.Core.ExtractPdf).not.toHaveBeenCalled();
  });

  it("routes a CSV to the CSV engine and shows the preview with the reconciliation banner", async () => {
    const { container } = renderModal();
    upload(container, csvFile());
    expect(await screen.findByText(/تم استخراج 2 حوالة/)).toBeInTheDocument();
    expect(base44.integrations.Core.ExtractCsv).toHaveBeenCalledTimes(1);
    expect(base44.integrations.Core.ExtractPdf).not.toHaveBeenCalled();
    expect(base44.entities.Transaction.findDuplicates).toHaveBeenCalledWith(["tr:1", "tr:2"]);
    expect(screen.getByText(/الكشف متطابق/)).toBeInTheDocument();
  });

  it("routes a PDF to the PDF engine", async () => {
    const { container } = renderModal();
    upload(container, pdfFile());
    expect(await screen.findByText(/تم استخراج 2 حوالة/)).toBeInTheDocument();
    expect(base44.integrations.Core.ExtractPdf).toHaveBeenCalledTimes(1);
    expect(base44.integrations.Core.ExtractCsv).not.toHaveBeenCalled();
  });

  it("shows a warning listing what doesn't reconcile", async () => {
    base44.integrations.Core.ExtractCsv.mockResolvedValue(extraction({
      validation: { is_valid: false, total_debit_matches: false, total_credit_matches: true, closing_balance_matches: false, balance_mismatch_lines: [2] },
    }));
    const { container } = renderModal();
    upload(container, csvFile());
    const warning = await screen.findByText(/تحذير: الكشف غير متطابق/);
    expect(warning.textContent).toMatch(/مجموع المدين مختلف/);
    expect(warning.textContent).toMatch(/الأسطر: 2/);
  });

  it("saves new records without overwrite and passes the opening balance and date back", async () => {
    const { container, onSaved } = renderModal();
    upload(container, csvFile());
    fireEvent.click(await screen.findByText("حفظ الكل (2)"));

    await waitFor(() => expect(base44.entities.Transaction.importRecords).toHaveBeenCalledTimes(1));
    const [records, options] = base44.entities.Transaction.importRecords.mock.calls[0];
    expect(options).toEqual({ overwrite: false });
    expect(records[0]).toMatchObject({
      type: "cash_in", amount: 75, commission: 0.75, sender_name: "MOUNIR TOSKA",
      phone: "96171588017", customer_number: "71588017", reference_number: "tr:1",
      transaction_date: "2026-09-23", sort_order: 0,
    });
    // A bare phone number in receiver_name is moved to phone / customer_number.
    expect(records[1]).toMatchObject({ receiver_name: "", phone: "+9613915112", customer_number: "3915112", sort_order: 1 });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(100, "2026-09-23"), { timeout: 3000 });
  });

  describe("when the statement was already imported", () => {
    beforeEach(() => {
      base44.entities.Transaction.findDuplicates.mockResolvedValue([
        { id: 1, reference_number: "tr:1", transaction_date: "2026-09-23" },
      ]);
    });

    it("asks whether to overwrite or cancel", async () => {
      const { container } = renderModal();
      upload(container, csvFile());
      expect(await screen.findByText("هذا الكشف مستورد مسبقاً")).toBeInTheDocument();
      expect(screen.getByText(/تم العثور على 1 عملية من أصل 2/).textContent).toMatch(/2026-09-23/);
      expect(screen.queryByText(/حفظ الكل/)).not.toBeInTheDocument();
    });

    it("cancel returns to the upload step without saving", async () => {
      const { container } = renderModal();
      upload(container, csvFile());
      fireEvent.click(await screen.findByText("إلغاء الرفع"));
      expect(await screen.findByText("اسحب ملف PDF أو CSV هنا أو اضغط للاختيار")).toBeInTheDocument();
      expect(base44.entities.Transaction.importRecords).not.toHaveBeenCalled();
    });

    it("overwrite continues to the preview and saves with overwrite: true", async () => {
      const { container } = renderModal();
      upload(container, csvFile());
      fireEvent.click(await screen.findByText("استبدال العمليات الموجودة"));
      expect(screen.getByText(/سيتم حذف 1 عملية موجودة/)).toBeInTheDocument();

      fireEvent.click(screen.getByText("حفظ الكل (2)"));
      await waitFor(() => expect(base44.entities.Transaction.importRecords).toHaveBeenCalledTimes(1));
      expect(base44.entities.Transaction.importRecords.mock.calls[0][1]).toEqual({ overwrite: true });
    });
  });

  it("shows the server error when extraction fails", async () => {
    base44.integrations.Core.ExtractCsv.mockRejectedValue(new Error("CSV file is missing the transactions header"));
    const { container } = renderModal();
    upload(container, csvFile());
    expect(await screen.findByText("CSV file is missing the transactions header")).toBeInTheDocument();
  });
});

describe("ImportPDFModal — re-import as a User", () => {
  beforeEach(() => {
    setAuthRole("user");
    base44.entities.Transaction.findDuplicates.mockResolvedValue([{ id: 1, reference_number: "tr:1", transaction_date: "2026-09-23" }]);
  });

  it("offers only cancel (replacing needs delete rights) and explains why", async () => {
    const { container } = renderModal();
    upload(container, csvFile());
    expect(await screen.findByText("هذا الكشف مستورد مسبقاً")).toBeInTheDocument();
    expect(screen.queryByText("استبدال العمليات الموجودة")).not.toBeInTheDocument();
    expect(screen.getByText(/يتطلب صلاحية الحذف/)).toBeInTheDocument();
    expect(screen.getByText("إلغاء الرفع")).toBeInTheDocument();
  });

  it("imports a new statement normally", async () => {
    base44.entities.Transaction.findDuplicates.mockResolvedValue([]);
    const { container } = renderModal();
    upload(container, csvFile());
    fireEvent.click(await screen.findByText("حفظ الكل (2)"));
    await waitFor(() => expect(base44.entities.Transaction.importRecords).toHaveBeenCalledWith(expect.any(Array), { overwrite: false }));
  });
});
