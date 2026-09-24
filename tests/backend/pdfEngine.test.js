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
