/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReceiverReportModal from "@/components/transactions/ReceiverReportModal";

const transactions = [
  {
    id: 1, type: "cash_out", amount: 1500, commission: 0, sender_name: "Vicario", receiver_name: "",
    phone: "+96171389296", customer_number: "71389296", service: "W2W", reference_number: "tr:1",
    transaction_date: "2026-09-20", created_date: "2026-09-20T10:00:00Z",
  },
  {
    id: 2, type: "cash_out", amount: 200, commission: 0, sender_name: "Vicario", receiver_name: "",
    phone: "+96171389296", customer_number: "71389296", service: "W2W", reference_number: "tr:2",
    transaction_date: "2026-09-23", created_date: "2026-09-23T10:00:00Z",
  },
  {
    id: 3, type: "cash_in", amount: 50, commission: 0.5, sender_name: "MOUNIR TOSKA", receiver_name: "Vicario",
    phone: "96171588017", customer_number: "71588017", service: "", reference_number: "tr:3",
    transaction_date: "2026-09-23", created_date: "2026-09-23T11:00:00Z",
  },
  {
    id: 4, type: "cash_out", amount: 25, commission: 0, sender_name: "Vicario", receiver_name: "SALAM ISSA",
    service: "", reference_number: "tr:4", transaction_date: "2026-09-23", created_date: "2026-09-23T12:00:00Z",
  },
];

const renderModal = () => {
  const onClose = vi.fn();
  const utils = render(<ReceiverReportModal allTransactions={transactions} onClose={onClose} />);
  return { ...utils, onClose };
};

const searchReceiver = (value) =>
  fireEvent.change(screen.getByPlaceholderText("اكتب اسم أو رقم المستلم..."), { target: { value } });
const resultRows = (container) => [...container.querySelectorAll("tbody tr")];

afterEach(cleanup);

describe("ReceiverReportModal", () => {
  it("opens with a prompt and no results", () => {
    const { container } = renderModal();
    expect(screen.getByText("تقرير المستلم")).toBeInTheDocument();
    expect(screen.getByText("اكتب اسم أو رقم المستلم للبحث")).toBeInTheDocument();
    expect(resultRows(container)).toHaveLength(0);
  });

  it("finds a receiver stored as a phone by the number shown in the table, with totals", () => {
    const { container } = renderModal();
    searchReceiver("71389296");
    expect(resultRows(container)).toHaveLength(2);
    expect(screen.getByTestId("receiver-count")).toHaveTextContent("2");
    expect(screen.getByTestId("receiver-withdrawals")).toHaveTextContent("$1,700.00");
    expect(screen.getByTestId("receiver-deposits")).toHaveTextContent("$0.00");
    // The receiver column shows the customer number, like the transactions table.
    expect(resultRows(container)[0]).toHaveTextContent("71389296");
  });

  it("finds a receiver by name and not by sender", () => {
    const { container } = renderModal();
    searchReceiver("salam");
    expect(resultRows(container)).toHaveLength(1);
    expect(resultRows(container)[0]).toHaveTextContent("SALAM ISSA");

    searchReceiver("mounir");
    expect(resultRows(container)).toHaveLength(0);
    expect(screen.getByText('لا توجد نتائج للبحث عن "mounir"')).toBeInTheDocument();
  });

  it("totals deposits and commissions for the account-holder receiver", () => {
    renderModal();
    searchReceiver("vicario");
    expect(screen.getByTestId("receiver-count")).toHaveTextContent("1");
    expect(screen.getByTestId("receiver-deposits")).toHaveTextContent("$50.00");
    expect(screen.getByTestId("receiver-commissions")).toHaveTextContent("$0.50");
  });

  it("filters by date range and clears the filter", () => {
    const { container } = renderModal();
    searchReceiver("+961 71 389 296");
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-09-21" } });
    expect(resultRows(container)).toHaveLength(1);
    expect(resultRows(container)[0]).toHaveTextContent("tr:2");

    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-09-22" } });
    expect(resultRows(container)).toHaveLength(0);

    fireEvent.click(screen.getByText("مسح الفلتر"));
    expect(resultRows(container)).toHaveLength(2);
  });

  it("closes", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
