import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractTransactionsFromCsv, parseCsvText, reconcileWithRounding, splitNamePhone } from "../../server/index.js";

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
      // 10 rows move by a cent more or less than their amount, but they cancel out exactly.
      rounding_difference: 0,
      rounded_rows: 10,
      first_unexplained_line: null,
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

// The provider prints every figure rounded to the cent from more precise internal values (sub-cent
// fees, currency conversions). The running-balance rounding can leave the closing balance a cent
// away from opening + credits − debits even though nothing is wrong. Instead of widening the
// tolerance, the engine checks that some set of exact values — each within half a cent of what's
// printed — makes every balance add up; it only accepts the difference when rounding explains it.
describe("extractTransactionsFromCsv — rounding-aware reconciliation", () => {
  const statement = ({ opening = "100.00", closing = "84.59", totalDebit = "25.52", totalCredit = "10.10", rows }) => [
    "statement_id,period_from,period_to,full_name,account_no,currency,opening_balance,total_debit,total_credit,closing_balance",
    `SOA-1,01/09/2026,12/09/2026,Test,1,USD,"${opening}","${totalDebit}","${totalCredit}","${closing}"`,
    "",
    "statement_id,line_no,date,reference,service,description,debit,credit,balance",
    ...rows.map((r, i) => `SOA-1,${i + 1},2026-09-01,tr:${i + 1},,${r[0]},${r[1]},${r[2]},${r[3]}`),
  ].join("\n");
  // 100.00 + 10.10 (a QR collect whose balance rounds up a cent) − 17.05 − 8.47 = 84.58, printed 84.59.
  const roundedRows = [
    ["QR COLLECT-A", "0.00", "10.10", "110.11"],
    ["TOUCH $15.15", "17.05", "0.00", "93.06"],
    ["DURUMCITY", "8.47", "0.00", "84.59"],
  ];

  it("a one-cent net difference that rounding explains is accepted — and reported, not hidden", () => {
    const { validation } = extractTransactionsFromCsv(statement({ rows: roundedRows }));
    expect(validation).toEqual({
      is_valid: true,
      total_debit_matches: true,
      total_credit_matches: true,
      closing_balance_matches: true,
      balance_mismatch_lines: [],
      rounding_difference: 0.01,
      rounded_rows: 1,
      first_unexplained_line: null,
    });
  });

  it("the closing balance must equal the last row's balance exactly (same number, printed twice)", () => {
    const { validation } = extractTransactionsFromCsv(statement({ rows: roundedRows, closing: "84.60" }));
    expect(validation.closing_balance_matches).toBe(false);
    expect(validation.is_valid).toBe(false);
  });

  it("a balance jump rounding can't explain is flagged at its line", () => {
    const rows = roundedRows.map((r) => [...r]);
    rows[1][3] = "93.08"; // 110.11 − 17.05 = 93.06: two cents off
    rows[2][3] = "84.61";
    const { validation } = extractTransactionsFromCsv(statement({ rows, closing: "84.61" }));
    expect(validation.is_valid).toBe(false);
    expect(validation.first_unexplained_line).toBe(2);
    expect(validation.balance_mismatch_lines).toEqual([2]);
    expect(validation.closing_balance_matches).toBe(false);
  });

  it("a missing row is caught, even a small one", () => {
    const rows = [roundedRows[0], roundedRows[2]]; // TOUCH 17.05 left out
    const { validation } = extractTransactionsFromCsv(statement({ rows, totalDebit: "8.47" }));
    expect(validation.is_valid).toBe(false);
    expect(validation.first_unexplained_line).toBe(2);
    expect(validation.closing_balance_matches).toBe(false);
  });

  it("a statement with no rounding at all still reconciles exactly", () => {
    const rows = [["SHOP", "10.00", "0.00", "90.00"], ["SALE", "0.00", "20.00", "110.00"]];
    const { validation } = extractTransactionsFromCsv(statement({ rows, closing: "110.00", totalDebit: "10.00", totalCredit: "20.00" }));
    expect(validation).toMatchObject({ is_valid: true, rounding_difference: 0, rounded_rows: 0, first_unexplained_line: null });
  });

  describe("reconcileWithRounding", () => {
    const row = (line_no, debit, credit, balance) => ({ line_no, debit, credit, balance });

    it("tracks the range of exact balances in half-cents and names the first row it can't explain", () => {
      expect(reconcileWithRounding({ opening: 100, closing: 84.59, rows: [row(1, 0, 10.1, 110.11), row(2, 17.05, 0, 93.06), row(3, 8.47, 0, 84.59)] }))
        .toEqual({ consistent: true, first_unexplained_line: null, rounding_difference: 0.01, rounded_rows: 1 });
      expect(reconcileWithRounding({ opening: 100, closing: 90, rows: [row(1, 10, 0, 90.02)] }).first_unexplained_line).toBe(1);
    });

    it("rounding can't keep drifting the same way: each row alone is within a cent, three in a row aren't", () => {
      // Every exact value may sit up to half a cent from what's printed, so two +1 cent drifts in a
      // row are possible (e.g. 100.005 + 10.005 …), but a third one is not.
      const twoRows = [row(1, 0, 10, 110.01), row(2, 0, 10, 120.02)];
      expect(reconcileWithRounding({ opening: 100, closing: 120.02, rows: twoRows }).consistent).toBe(true);
      const threeRows = [...twoRows, row(3, 0, 10, 130.03)];
      expect(reconcileWithRounding({ opening: 100, closing: 130.03, rows: threeRows }))
        .toMatchObject({ consistent: false, first_unexplained_line: 3 });
    });

    it("rows without a balance only widen the range", () => {
      const rows = [row(1, 10, 0, null), row(2, 0, 5, 95)];
      expect(reconcileWithRounding({ opening: 100, closing: 95, rows })).toMatchObject({ consistent: true, rounded_rows: 0 });
    });

    it("the closing balance must equal the last printed balance", () => {
      expect(reconcileWithRounding({ opening: 100, closing: 90.01, rows: [row(1, 10, 0, 90)] }))
        .toMatchObject({ consistent: false, first_unexplained_line: "closing" });
    });
  });
});
