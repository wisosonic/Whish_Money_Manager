import { jsPDF } from "jspdf";
import { describe, expect, it } from "vitest";
import { extractPdfTable, extractTransactionsFromRows } from "../../server/index.js";

// Column x-positions of a statement table: DATE, REFERENCE, SERVICE, DESCRIPTION, DEBIT, CREDIT, BALANCE
const COLUMNS = [30, 95, 165, 215, 390, 450, 510];

const buildStatementPdf = ({ opening, rows, closing }) => {
  const doc = new jsPDF({ unit: "pt" });
  doc.setFontSize(9);
  ["DATE", "REFERENCE", "SERVICE", "DESCRIPTION", "DEBIT", "CREDIT", "BALANCE"].forEach((header, i) =>
    doc.text(header, COLUMNS[i], 80)
  );
  doc.text("OPENING BALANCE", 30, 110);
  doc.text(opening, 510, 110);
  rows.forEach((row, rowIndex) =>
    row.forEach((cell, i) => cell && doc.text(cell, COLUMNS[i], 145 + rowIndex * 35))
  );
  const closingY = 145 + rows.length * 35 + 20;
  doc.text("CLOSING BALANCE", 30, closingY);
  doc.text(closing, 510, closingY);
  return Buffer.from(doc.output("arraybuffer"));
};

const parsePdf = async (spec) => {
  const { tableRows, pageCount } = await extractPdfTable(buildStatementPdf(spec));
  return { pageCount, ...extractTransactionsFromRows(tableRows) };
};

describe("PDF engine (pdfjs text extraction)", () => {
  it("extracts rows, balances and direction from the DEBIT/CREDIT column positions", async () => {
    const result = await parsePdf({
      opening: "100.00",
      rows: [
        ["23/09/2026", "tr:1", "W2W", "KHALIL FAKIH - 9613077461", "", "75.00", "175.00"],
        ["23/09/2026", "tr:2", "QR", "QR CASH IN", "50.00", "", "125.00"],
      ],
      closing: "125.00",
    });

    expect(result.pageCount).toBe(1);
    expect(result.statement_date).toBe("2026-09-23");
    expect(result.opening_balance).toBe(100);
    expect(result.closing_balance).toBe(125);
    expect(result.transactions).toHaveLength(2);

    const [credit, debit] = result.transactions;
    expect(credit).toMatchObject({ type: "cash_in", amount: 75, reference_number: "tr:1", service: "W2W", date: "2026-09-23" });
    expect(debit).toMatchObject({ type: "cash_out", amount: 50, reference_number: "tr:2", commission: "0.000" });
  });

  it("splits 'NAME - number' descriptions into name, phone and customer_number", async () => {
    const result = await parsePdf({
      opening: "100.00",
      rows: [["23/09/2026", "tr:1", "W2W", "KHALIL FAKIH - 9613077461", "", "75.00", "175.00"]],
      closing: "175.00",
    });
    expect(result.transactions[0]).toMatchObject({
      sender_name: "KHALIL FAKIH",
      receiver_name: "Vicario",
      phone: "9613077461",
      customer_number: "3077461",
      commission: "0.750",
    });
  });
});

describe("extractTransactionsFromRows (row-level rules)", () => {
  it("corrects a direction guessed wrongly from keywords using the BALANCE column", () => {
    // "PAYMENT" would be guessed as a debit, but the balance goes up, so it is a credit.
    const rows = [
      ["OPENING BALANCE", "100.00"],
      ["23/09/2026", "tr:9", "PAYMENT", "REFUND", "40.00", "140.00"],
    ];
    const [transaction] = extractTransactionsFromRows(rows).transactions;
    expect(transaction).toMatchObject({ type: "cash_in", amount: 40, commission: "0.400" });
  });

  it("skips opening/closing balance label rows", () => {
    const rows = [
      ["OPENING BALANCE", "100.00"],
      ["23/09/2026", "tr:1", "QR", "QR CASH IN", "10.00", "90.00"],
      ["CLOSING BALANCE", "90.00"],
    ];
    const result = extractTransactionsFromRows(rows);
    expect(result.transactions).toHaveLength(1);
    expect(result.closing_balance).toBe(90);
  });
});

describe("PDF engine — balance cross-check in whole cents", () => {
  // The provider rounds the running balance, so it can move by ±0.01 more or less than the row's
  // debit/credit. The check used to compare floats against 0.01, and |999.99 − 1000| is
  // 0.0100000000000477 in floating point — so the printed amount was overwritten by one cent.
  it("keeps the printed amount when the balance differs from it by exactly one cent", async () => {
    // Values chosen so the float subtraction lands just above 0.01 (e.g. 1100.36 − 100.37 − 1000).
    const result = await parsePdf({
      opening: "100.37",
      rows: [
        ["23/09/2026", "tr:1", "W2W", "KHALIL FAKIH - 9613077461", "", "1000.00", "1100.36"],
        ["23/09/2026", "tr:2", "W2W", "SAMI - 96171000000", "", "49.99", "1150.34"],
        ["23/09/2026", "tr:3", "QR", "QR CASH IN", "20.20", "", "1130.15"],
      ],
      closing: "1130.15",
    });
    const [big, small, debit] = result.transactions;
    expect(big).toMatchObject({ type: "cash_in", amount: 1000, commission: "10.000" });
    expect(small).toMatchObject({ type: "cash_in", amount: 49.99 });
    // 1150.34 − 20.20 = 1130.14 but the statement says 1130.15: a one-cent rounding step, not an error.
    expect(debit).toMatchObject({ type: "cash_out", amount: 20.2 });
  });

  it("still corrects the amount from the balance when it's off by more than a cent", async () => {
    const result = await parsePdf({
      opening: "100.00",
      rows: [["23/09/2026", "tr:1", "W2W", "KHALIL FAKIH - 9613077461", "", "75.00", "175.50"]],
      closing: "175.50",
    });
    expect(result.transactions[0]).toMatchObject({ type: "cash_in", amount: 75.5, commission: "0.755" });
  });

  it("still corrects the direction from the balance, with an exact cent amount (no float residue)", async () => {
    const result = await parsePdf({
      opening: "100.10",
      rows: [["23/09/2026", "tr:1", "QR", "QR CASH IN", "", "20.20", "79.90"]],
      closing: "79.90",
    });
    // Printed as a credit, but the balance went down by 20.20: it was a debit.
    expect(result.transactions[0].type).toBe("cash_out");
    expect(result.transactions[0].amount).toBe(20.2);
    expect(result.transactions[0].commission).toBe("0.000");
  });
});
