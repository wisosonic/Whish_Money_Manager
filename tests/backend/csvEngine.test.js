import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractTransactionsFromCsv, parseCsvText, splitNamePhone } from "../../server/index.js";

const statementCsv = fs.readFileSync(path.join(__dirname, "../fixtures/statement.csv"), "utf8");

describe("parseCsvText", () => {
  it("handles quoted delimiters, escaped quotes and CRLF line endings", () => {
    const rows = parseCsvText('a,"b,c","say ""hi"""\r\n1,2,3\r\n', ",");
    expect(rows).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("keeps newlines that are inside quotes", () => {
    expect(parseCsvText('"line1\nline2",x', ",")).toEqual([["line1\nline2", "x"]]);
  });
});

describe("splitNamePhone", () => {
  it("splits 'NAME - number' into name, phone and customer_number without 961", () => {
    expect(splitNamePhone("MOUNIR TOSKA - 96171588017")).toEqual({
      name: "MOUNIR TOSKA",
      phone: "96171588017",
      customer_number: "71588017",
    });
    expect(splitNamePhone("KHALIL FAKIH - +9613077461")).toEqual({
      name: "KHALIL FAKIH",
      phone: "+9613077461",
      customer_number: "3077461",
    });
  });

  it("ignores descriptions that are not 'NAME - number'", () => {
    expect(splitNamePhone("TOUCH $7.58-+96178840632")).toBeNull();
    expect(splitNamePhone("QR COLLECT-SALAM ISSA")).toBeNull();
    expect(splitNamePhone("+9613915112")).toBeNull();
    expect(splitNamePhone("")).toBeNull();
  });
});

describe("extractTransactionsFromCsv — real statement export", () => {
  const result = extractTransactionsFromCsv(statementCsv);

  it("reads the statement summary from the header section", () => {
    expect(result.source).toBe("csv");
    expect(result.statement_date).toBe("2026-09-23");
    expect(result.opening_balance).toBe(10648.51);
    expect(result.closing_balance).toBe(10004.53);
    expect(result.account).toEqual({ full_name: "Vicario", account_no: "20200813", currency: "USD" });
  });

  it("extracts every transaction row", () => {
    expect(result.transactions).toHaveLength(127);
    expect(result.total_transactions_count).toBe(127);
    expect(result.transactions.filter((t) => t.type === "cash_in")).toHaveLength(59);
    expect(result.transactions.filter((t) => t.type === "cash_out")).toHaveLength(68);
  });

  it("reconciles totals and balances with the file", () => {
    expect(result.total_cash_out).toBe(41091.65);
    expect(result.total_cash_in).toBe(40447.67);
    // Balance column is rounded by the provider (±0.01 on some rows) — must not be flagged.
    expect(result.validation).toEqual({
      is_valid: true,
      total_debit_matches: true,
      total_credit_matches: true,
      closing_balance_matches: true,
      balance_mismatch_lines: [],
    });
  });

  it("maps a debit row to cash_out with no commission", () => {
    const row = result.transactions[0];
    expect(row).toMatchObject({
      type: "cash_out",
      amount: 50,
      commission: 0,
      sender_name: "Vicario",
      receiver_name: "+9613915112",
      reference_number: "tr:626186571",
      date: "2026-09-23",
      line_no: 1,
    });
  });

  it("applies a 1% commission to every credit, with no exceptions", () => {
    const credits = result.transactions.filter((t) => t.type === "cash_in");
    // 1% rounded to 3 decimals, e.g. 25.25 → 0.253
    credits.forEach((t) => expect(t.commission).toBe(Number((t.amount / 100).toFixed(3))));
    const topup = result.transactions.find((t) => t.sender_name === "QR TOPUP");
    expect(topup.amount).toBe(1500);
    expect(topup.commission).toBe(15);
    expect(result.total_commission).toBe(404.477);
  });

  it("splits 'NAME - number' descriptions into name, phone and customer_number", () => {
    const row = result.transactions.find((t) => t.line_no === 79);
    expect(row).toMatchObject({
      type: "cash_in",
      sender_name: "MOUNIR TOSKA",
      receiver_name: "Vicario",
      phone: "96171588017",
      customer_number: "71588017",
    });
    expect(result.transactions.filter((t) => t.phone)).toHaveLength(4);
  });
});

describe("extractTransactionsFromCsv — format variations", () => {
  it("accepts a semicolon-delimited file with a UTF-8 BOM", () => {
    const semicolon = "﻿" + statementCsv.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ";");
    const result = extractTransactionsFromCsv(semicolon);
    expect(result.transactions).toHaveLength(127);
    expect(result.validation.is_valid).toBe(true);
  });

  it("finds columns by name, not position", () => {
    const csv = [
      "balance,credit,debit,description,reference,date,line_no",
      "90.00,0.00,10.00,SHOP,tr:1,2026-01-05,1",
      "110.00,20.00,0.00,ALI - 96170000000,tr:2,2026-01-05,2",
    ].join("\n");
    const result = extractTransactionsFromCsv(csv);
    expect(result.transactions.map((t) => [t.type, t.amount, t.reference_number])).toEqual([
      ["cash_out", 10, "tr:1"],
      ["cash_in", 20, "tr:2"],
    ]);
  });

  it("derives opening/closing balances from the rows when there is no summary section", () => {
    const csv = [
      "line_no,date,reference,description,debit,credit,balance",
      "1,2026-01-05,tr:1,SHOP,10.00,0.00,90.00",
      "2,2026-01-05,tr:2,SALE,0.00,20.00,110.00",
    ].join("\n");
    const result = extractTransactionsFromCsv(csv);
    expect(result.opening_balance).toBe(100);
    expect(result.closing_balance).toBe(110);
    expect(result.statement_date).toBe("2026-01-05");
    expect(result.validation.is_valid).toBe(true);
  });

  it("flags totals and the exact line when an amount doesn't match the balances", () => {
    const tampered = statementCsv.replace(
      "tr:626187634,,QR CASH IN,500.00",
      "tr:626187634,,QR CASH IN,501.00"
    );
    const { validation } = extractTransactionsFromCsv(tampered);
    expect(validation.is_valid).toBe(false);
    expect(validation.total_debit_matches).toBe(false);
    expect(validation.total_credit_matches).toBe(true);
    expect(validation.closing_balance_matches).toBe(false);
    expect(validation.balance_mismatch_lines).toEqual([2]);
  });

  it("rejects a file without the transactions header", () => {
    expect(() => extractTransactionsFromCsv("a,b\n1,2")).toThrow(/missing the transactions header/);
  });
});
