import cookieParser from "cookie-parser";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerAdminRoutes } from "./admin.js";
import { authenticate, registerAuthRoutes, requirePermission } from "./auth.js";
import { db, dbPath, ensureDefaultRoles, initializeDb, nowIso } from "./db.js";
import { PERMISSIONS as P, canUpdateTransaction, hasPermission } from "./permissions.js";
import { ensureInitialAdmin } from "./seed.js";

const __filename = fileURLToPath(import.meta.url);

initializeDb();
ensureDefaultRoles();

const app = express();
const PORT = Number(process.env.API_PORT || 3001);

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// Writes must be JSON. Together with the SameSite=Strict session cookie this blocks cross-site
// form posts (CSRF). CORS is not enabled: the web app reaches the API same-origin via the Vite proxy.
app.use("/local-api", (req, res, next) => {
  const hasBody = Number(req.headers["content-length"] || 0) > 0 || Boolean(req.headers["transfer-encoding"]);
  if (["POST", "PUT", "PATCH"].includes(req.method) && hasBody && !req.is("application/json")) {
    res.status(415).json({ error: "Content-Type must be application/json" });
    return;
  }
  next();
});

const ROW_Y_TOLERANCE = 3;
const CELL_GAP_THRESHOLD = 14;
const ORPHAN_MERGE_MAX_DISTANCE = 10;
let pdfjsLibPromise;

const ensurePromiseWithResolvers = () => {
  if (typeof Promise.withResolvers === "function") {
    return;
  }

  Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
};

const getPdfJs = async () => {
  if (!pdfjsLibPromise) {
    ensurePromiseWithResolvers();
    pdfjsLibPromise = import("pdfjs-dist/build/pdf.mjs");
  }
  return pdfjsLibPromise;
};

// Per-entity rules. Everyone in the office sees all rows (no per-user filtering on reads).
// created_by is always set by the server from the signed-in user; clients cannot set or change it.
const ENTITY_CONFIG = {
  transactions: {
    table: "transactions",
    mutableFields: [
      "type",
      "amount",
      "commission",
      "sender_name",
      "receiver_name",
      "phone",
      "customer_number",
      "note",
      "reference_number",
      "service",
      "currency",
      "status",
      "transaction_date",
      "sort_order"
    ],
    readPermission: P.TRANSACTIONS_READ,
    createPermission: P.TRANSACTIONS_CREATE,
    bulkCreatePermission: P.TRANSACTIONS_IMPORT,
    deletePermission: P.TRANSACTIONS_DELETE,
  },
  "daily-balances": {
    table: "daily_balances",
    mutableFields: ["date", "opening_balance"],
    readPermission: P.BALANCES_READ,
    createPermission: P.BALANCES_WRITE,
    bulkCreatePermission: P.BALANCES_WRITE,
    updatePermission: P.BALANCES_WRITE,
    deletePermission: P.BALANCES_WRITE,
  }
};

const entityOr404 = (req, res) => {
  const config = ENTITY_CONFIG[req.params.entity];
  if (!config) {
    res.status(404).json({ error: "Entity not found" });
    return null;
  }
  return config;
};

// Responds 403 and returns false when the signed-in user lacks the permission.
const allow = (req, res, permission) => {
  if (hasPermission(req.user, permission)) return true;
  res.status(403).json({ error: "You don't have permission to do this", missing: [permission] });
  return false;
};

const insertEntityRecord = (config, item, userEmail) => {
  const now = nowIso();
  const columns = [];
  const values = [];
  const placeholders = [];

  config.mutableFields.forEach((field) => {
    if (item[field] !== undefined) {
      columns.push(field);
      values.push(item[field]);
      placeholders.push("?");
    }
  });

  columns.push("created_by", "created_date", "updated_date");
  values.push(userEmail, now, now);
  placeholders.push("?", "?", "?");

  const stmt = db.prepare(
    `INSERT INTO ${config.table} (${columns.join(",")}) VALUES (${placeholders.join(",")})`
  );

  return stmt.run(...values).lastInsertRowid;
};

// Filter keys become column names in SQL, so only known columns are accepted (prevents SQL injection).
const buildFilterWhere = (config, filter = {}) => {
  const allowedColumns = new Set([...config.mutableFields, "id", "created_by", "created_date", "updated_date"]);
  const clauses = [];
  const params = [];

  for (const [key, value] of Object.entries(filter || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (!allowedColumns.has(key)) {
      return { error: `Unknown filter field: ${key}` };
    }
    clauses.push(`${key} = ?`);
    params.push(value);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
};

app.get("/local-api/health", (_req, res) => {
  res.json({ ok: true });
});

// Login / logout / me, and Admin-only user & role management.
registerAuthRoutes(app);

// Every other API route requires a signed-in user.
app.use("/local-api", authenticate);

// Admin panel: CSV backup and delete-by-date-range (Admin + Manager).
registerAdminRoutes(app);

const parseAmount = (value) => Number(String(value || "").replace(/,/g, "")) || 0;

const toIsoDate = (value) => {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
};

const normalizeCell = (value) => {
    return value.trim();
    // return String(value || "").replace(/\s+/g, " ").trim();
};

const MONEY_CELL_PATTERN = /^\d[\d,]*\.\d{2}$/;

const groupTextItemsIntoRows = (items) => {
  const positioned = items
    .filter((item) => normalizeCell(item.str))
    .map((item) => ({
      text: normalizeCell(item.str),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
    }))
    .sort((left, right) => {
      if (Math.abs(right.y - left.y) > ROW_Y_TOLERANCE) {
        return right.y - left.y;
      }
      return left.x - right.x;
    });

  // The DEBIT/CREDIT header cells give us each column's X position on this page. A blank
  // DEBIT or CREDIT cell produces no text at all, so once cells are joined there's no way
  // to tell which column a lone amount came from - this has to be resolved positionally,
  // before that information is lost, rather than guessed from the SERVICE/DESCRIPTION text.
  const debitHeader = positioned.find((item) => item.text.toUpperCase() === "DEBIT");
  const creditHeader = positioned.find((item) => item.text.toUpperCase() === "CREDIT");
  const debitCreditBoundaryX = debitHeader && creditHeader ? (debitHeader.x + creditHeader.x) / 2 : null;

  const rows = [];
  for (const item of positioned) {
    const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= ROW_Y_TOLERANCE);
    if (existingRow) {
      existingRow.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  const groupedRows = rows
    .sort((left, right) => right.y - left.y)
    .map((row) => {
      const sortedItems = row.items.sort((left, right) => left.x - right.x);

      // Among a row's money-looking values, the rightmost one is always BALANCE (every
      // transaction row has one); an earlier one, if present, is the DEBIT/CREDIT amount.
      let isDebitByPosition = null;
      if (debitCreditBoundaryX != null) {
        const moneyItems = sortedItems.filter((item) => MONEY_CELL_PATTERN.test(item.text));
        if (moneyItems.length >= 2) {
          const amountItem = moneyItems[moneyItems.length - 2];
          isDebitByPosition = amountItem.x < debitCreditBoundaryX;
        }
      }

      const cells = [];
      let currentCell = "";
      let lastRightEdge = null;

      for (const item of sortedItems) {
        const gap = lastRightEdge == null ? 0 : item.x - lastRightEdge;
        if (currentCell && gap > CELL_GAP_THRESHOLD) {
          cells.push(currentCell.trim());
          currentCell = item.text;
        } else {
          currentCell = currentCell ? `${currentCell} ${item.text}` : item.text;
        }
        lastRightEdge = item.x + item.width;
      }

      if (currentCell) {
        cells.push(currentCell.trim());
      }

      return { y: row.y, cells: cells.filter(Boolean), isDebitByPosition };
    })
    .filter((row) => row.cells.length > 0);

  mergeWrappedContinuationLines(groupedRows);

  return groupedRows.map((row) => {
    Object.defineProperty(row.cells, "__isDebitByPosition", {
      value: row.isDebitByPosition,
      enumerable: false,
    });
    return row.cells;
  });
};

const isDateCell = (cell) => /^\d{2}\/\d{2}\/\d{4}$/.test(String(cell || "").trim());

// Long SERVICE/DESCRIPTION values sometimes wrap onto an extra line that pdfjs reports
// as its own row, positioned just a few points above/below the transaction row's
// baseline (table rows themselves sit ~30-35pt apart, so there's no ambiguity). Those
// wrapped lines don't start with a date, so on their own they'd be silently dropped as
// noise. This reattaches each one to the nearest date-anchored row instead of losing it.
const mergeWrappedContinuationLines = (rows) => {
  const anchorRows = rows.filter((row) => isDateCell(row.cells[0]));
  if (!anchorRows.length) {
    return;
  }

  rows.forEach((row) => {
    if (isDateCell(row.cells[0])) {
      return;
    }

    let nearestAnchor = null;
    let nearestDistance = Infinity;
    anchorRows.forEach((anchor) => {
      const distance = Math.abs(anchor.y - row.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestAnchor = anchor;
      }
    });

    if (!nearestAnchor || nearestDistance > ORPHAN_MERGE_MAX_DISTANCE) {
      return;
    }

    nearestAnchor.continuationParts = nearestAnchor.continuationParts || [];
    nearestAnchor.continuationParts.push({ y: row.y, text: row.cells.join(" ") });
  });

  anchorRows.forEach((anchor) => {
    if (!anchor.continuationParts || !anchor.continuationParts.length) {
      return;
    }

    const mergedText = anchor.continuationParts
      .sort((left, right) => right.y - left.y)
      .map((part) => part.text)
      .join(" ");

    const insertAt = Math.min(3, anchor.cells.length);
    anchor.cells.splice(insertAt, 0, mergedText);
  });
};

const normalizeTransactionRow = (row) => {
  if (!Array.isArray(row) || row.length === 0) {
    return row;
  }

  const firstCell = normalizeCell(row[0] || "");
  const match = firstCell.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
  if (!match) {
    return row;
  }

  const [, dateCell, referenceCell, serviceCell, remainingCell] = match;
  const normalized = [dateCell, referenceCell, serviceCell];
  if (remainingCell && normalizeCell(remainingCell)) {
    normalized.push(normalizeCell(remainingCell));
  }

  return [...normalized, ...row.slice(1)];
};

// Transfer descriptions like "MOUNIR TOSKA - 96171588017" carry the counterparty's name and
// phone in one cell. Split them so the name stays in sender/receiver and the number is
// stored as phone (as printed) and customer_number (without the 961 country code), matching
// how the import modal already handles a bare phone number in receiver_name.
const NAME_PHONE_PATTERN = /^(.*\S)\s+-\s+(\+?\d{7,})$/;

const splitNamePhone = (description) => {
  const match = String(description || "").trim().match(NAME_PHONE_PATTERN);
  if (!match) {
    return null;
  }

  const [, name, phone] = match;
  return {
    name: name.trim(),
    phone,
    customer_number: phone.replace(/^(\+?961)/, ""),
  };
};

const inferIsDebit = (row, service, normalizedDescription) => {
  const directionCell = row.find((cell) => /^(CR|DR)$/i.test(cell));
  if (directionCell) {
    return directionCell.toUpperCase() === "DR";
  }

  const normalizedService = normalizeCell(String(service || "")).toLowerCase();
  if (normalizedService.includes("collection") || 
      (normalizedService.includes("w2w") && ! normalizedDescription.includes("-"))  || 
      normalizedService.includes("cash") || 
      normalizedService.includes("payment") ||
      normalizedService.includes("touch") ||
      normalizedService.includes("alfa")
    ){
    return true;
  }

  return false;
};

const extractTransactionsFromRows = (tableRows) => {

  const joinedText = tableRows.map((row) => row.join(" ")).join("\n");
  const dateMatch = joinedText.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  const statementDate = dateMatch ? toIsoDate(dateMatch[1]) : "";
  const openingMatch = joinedText.match(/OPENING BALANCE[\s\S]{0,120}?([0-9,]+(?:\.[0-9]{2})?)/i);
  const closingMatch = joinedText.match(/CLOSING BALANCE[\s\S]{0,120}?([0-9,]+(?:\.[0-9]{2})?)/i);

  const transactions = [];

  for (const originalRow of tableRows) {
    const row = normalizeTransactionRow(originalRow);
    const firstCell = row[0] || "";
    const isoDate = toIsoDate(firstCell);
    if (!isoDate) {
      continue;
    }

    const isBalanceLabelRow = row.some((cell) => /opening balance|closing balance/i.test(String(cell || "")));
    if (isBalanceLabelRow) {
      continue;
    }

    const amountIndex = row.findIndex((cell, index) => index > 0 && /^\d[\d,]*\.\d{2}$/.test(cell));
    const amount = amountIndex >= 0 ? parseAmount(row[amountIndex]) : 0;
    const service = row[2] || "";
    const noteStartIndex = row.length >= 3 ? 3 : 1;
    const noteParts = row.slice(noteStartIndex).filter((cell) => !/^\d[\d,]*\.\d{2}$/.test(cell) && !/^(CR|DR)$/i.test(cell));
    const description = noteParts.join(" ").trim();
    const nomralizedDescription = normalizeCell(description).toLowerCase();
    const isDebitByPosition = originalRow.__isDebitByPosition;
    const isDebit = isDebitByPosition != null ? isDebitByPosition : inferIsDebit(row, service, nomralizedDescription);
    const isNoFees = nomralizedDescription.includes("cashin") ||
                      nomralizedDescription.includes("qr topup") ||
                      service.toLowerCase().includes("reversed")
                    ;
    const type = isDebit ? "cash_out" : "cash_in";
    const commissionRate = (isDebit || isNoFees) ? 0 : 1;
    const commission = (amount * commissionRate / 100).toFixed(3);
    const namePhone = splitNamePhone(description);
    const counterparty = namePhone ? namePhone.name : description;

    var obj = {
      type,
      amount,
      commission,
      sender_name: isDebit ? "Vicario" : counterparty,
      receiver_name: isDebit ? counterparty : "Vicario",
      phone: namePhone ? namePhone.phone : "",
      customer_number: namePhone ? namePhone.customer_number : "",
      service,
      note: "",
      reference_number: row[1] || "",
      date: isoDate,
      row,
      commissionRate: commissionRate,
      isNoFees,
    };

    transactions.push(obj);
  }

  // Cross-check each transaction's inferred direction/amount against the statement's own
  // running BALANCE column (present on every row). Service-keyword guessing can be fooled
  // when SERVICE/DESCRIPTION text gets garbled by PDF line-wrapping, but the balance delta
  // is ground truth: opening_balance plus every delta in order always reconstructs the
  // stated closing_balance exactly, so it's used here to correct any mismatches.
  //
  // All of this is done in whole cents. The provider rounds the running balance, so it can move by
  // ±0.01 more or less than the row's debit/credit — that one cent is rounding, not an error, and
  // must not change the printed amount. Comparing floats against 0.01 got that wrong
  // (|999.99 − 1000| is 0.0100000000000477), overwriting amounts by a cent on ~10 rows a statement.
  const toCents = (value) => Math.round(Number(value) * 100);
  let runningCents = toCents(openingMatch ? parseAmount(openingMatch[1]) : 0);
  transactions.forEach((transaction) => {
    const lastCell = transaction.row[transaction.row.length - 1];
    if (!/^\d[\d,]*\.\d{2}$/.test(String(lastCell || ""))) {
      return;
    }

    const statedCents = toCents(parseAmount(lastCell));
    const deltaCents = statedCents - runningCents;
    const trueType = deltaCents >= 0 ? "cash_in" : "cash_out";
    const trueAmount = Math.abs(deltaCents) / 100;
    const offByCents = Math.abs(Math.abs(deltaCents) - toCents(transaction.amount));

    if (trueType !== transaction.type || offByCents > 1) {
      transaction.type = trueType;
      transaction.amount = trueAmount;
      const commissionRate = trueType === "cash_out" || transaction.isNoFees ? 0 : 1;
      transaction.commission = ((trueAmount * commissionRate) / 100).toFixed(3);
      transaction.commissionRate = commissionRate;

      const swap = transaction.sender_name;
      transaction.sender_name = transaction.receiver_name;
      transaction.receiver_name = swap;
    }

    runningCents = statedCents;
  });

  const totalCashIn = transactions.filter((t) => t.type === "cash_in").reduce((sum, t) => sum + t.amount, 0);
  const totalCashOut = transactions.filter((t) => t.type === "cash_out").reduce((sum, t) => sum + t.amount, 0);
  const totalCommission = transactions.reduce((sum, t) => sum + (t.commission || 0), 0);

  return {
    statement_date: statementDate,
    opening_balance: openingMatch ? parseAmount(openingMatch[1]) : 0,
    closing_balance: closingMatch ? parseAmount(closingMatch[1]) : 0,
    total_transactions_count: transactions.length,
    total_cash_in: totalCashIn,
    total_cash_out: totalCashOut,
    total_commission: totalCommission,
    table_rows: tableRows,
    transactions,
  };
};

const extractPdfTable = async (pdfBuffer) => {
  const pdfjsLib = await getPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const tableRows = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageRows = groupTextItemsIntoRows(textContent.items);
    tableRows.push(...pageRows);
  }

  return {
    pageCount: pdf.numPages,
    tableRows,
  };
};

app.post("/local-api/pdf/extract", requirePermission(P.TRANSACTIONS_IMPORT), async (req, res) => {
  try {
    const base64 = String(req.body?.base64 || "");
    if (!base64) {
      res.status(400).json({ error: "Missing PDF data" });
      return;
    }

    const pdfBuffer = Buffer.from(base64, "base64");
    const { pageCount, tableRows } = await extractPdfTable(pdfBuffer);
    const result = extractTransactionsFromRows(tableRows);

    res.json({
      ...result,
      raw_text: tableRows.map((row) => row.join(" | ")).join("\n"),
      page_count: pageCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to parse PDF" });
  }
});

// ═══ CSV engine ═══
// The CSV statement export has two sections in one file: a one-row statement summary
// (opening/closing balance, totals, period) and, after blank lines, the transaction table
// (line_no, date, reference, service, description, debit, credit, balance). Sections and
// columns are located by header name, not position, so re-saved or reordered files work.
// Unlike the PDF engine, nothing has to be inferred here: DEBIT/CREDIT are explicit columns.

const parseCsvText = (text, delimiter) => {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
};

// Excel-safe exports wrap values as ="23/09/2026" so Excel won't reformat them.
const cleanCsvCell = (value) => String(value || "").replace(/^="(.*)"$/, "$1").trim();

const csvDateToIso = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toIsoDate(value));

const roundCents = (value) => Math.round(value * 100) / 100;

const extractTransactionsFromCsv = (text) => {
  const content = String(text || "").replace(/^﻿/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = parseCsvText(content, delimiter).map((row) => row.map(cleanCsvCell));

  const findHeaderIndex = (requiredColumns) =>
    rows.findIndex((row) => {
      const names = row.map((cell) => cell.toLowerCase());
      return requiredColumns.every((column) => names.includes(column));
    });
  const toRecord = (header, row) =>
    Object.fromEntries(header.map((name, index) => [name.toLowerCase(), row[index] ?? ""]));

  const transactionHeaderIndex = findHeaderIndex(["date", "debit", "credit", "balance"]);
  if (transactionHeaderIndex < 0) {
    throw new Error("CSV file is missing the transactions header (date, debit, credit, balance)");
  }

  const summaryHeaderIndex = findHeaderIndex(["opening_balance", "closing_balance"]);
  const summaryRow = summaryHeaderIndex >= 0 ? rows[summaryHeaderIndex + 1] : null;
  const summary = summaryRow && summaryHeaderIndex + 1 < transactionHeaderIndex
    ? toRecord(rows[summaryHeaderIndex], summaryRow)
    : {};

  const transactionHeader = rows[transactionHeaderIndex];
  const records = rows
    .slice(transactionHeaderIndex + 1)
    .map((row) => toRecord(transactionHeader, row))
    .filter((record) => csvDateToIso(record.date));

  const accountName = summary.full_name || "Vicario";

  const transactions = records.map((record, index) => {
    const debit = parseAmount(record.debit);
    const credit = parseAmount(record.credit);
    const isDebit = debit > 0;
    const amount = isDebit ? debit : credit;
    // Fee rule: every credit carries a 1% commission, debits carry none.
    const commissionRate = isDebit ? 0 : 1;
    const description = String(record.description || "").replace(/\s+/g, " ").trim();
    const namePhone = splitNamePhone(description);
    const counterparty = namePhone ? namePhone.name : description;

    return {
      type: isDebit ? "cash_out" : "cash_in",
      amount,
      commission: Number(((amount * commissionRate) / 100).toFixed(3)),
      sender_name: isDebit ? accountName : counterparty,
      receiver_name: isDebit ? counterparty : accountName,
      phone: namePhone ? namePhone.phone : "",
      customer_number: namePhone ? namePhone.customer_number : "",
      service: record.service || "",
      note: "",
      reference_number: record.reference || "",
      date: csvDateToIso(record.date),
      line_no: Number(record.line_no) || index + 1,
      debit,
      credit,
      balance: record.balance ? parseAmount(record.balance) : null,
      commissionRate,
    };
  });

  // Without a summary section, derive the balances from the first/last rows' BALANCE column.
  const first = transactions[0];
  const last = transactions[transactions.length - 1];
  const openingBalance = summary.opening_balance
    ? parseAmount(summary.opening_balance)
    : first && first.balance != null ? roundCents(first.balance - first.credit + first.debit) : 0;
  const closingBalance = summary.closing_balance
    ? parseAmount(summary.closing_balance)
    : last && last.balance != null ? last.balance : 0;

  const totalDebit = roundCents(transactions.reduce((sum, t) => sum + t.debit, 0));
  const totalCredit = roundCents(transactions.reduce((sum, t) => sum + t.credit, 0));
  const totalCommission = Number(transactions.reduce((sum, t) => sum + t.commission, 0).toFixed(3));

  // The provider rounds the displayed BALANCE from more precise internal values, so a row's
  // balance can move by ±0.01 more or less than its debit/credit. Each row is therefore checked
  // against the previous stated balance with a one-cent tolerance, never used to rewrite amounts.
  const balanceMismatchLines = [];
  let previousBalance = openingBalance;
  transactions.forEach((transaction) => {
    if (transaction.balance == null) {
      return;
    }
    const expected = previousBalance + transaction.credit - transaction.debit;
    if (Math.abs(transaction.balance - expected) > 0.015) {
      balanceMismatchLines.push(transaction.line_no);
    }
    previousBalance = transaction.balance;
  });

  const totalDebitMatches = !summary.total_debit || Math.abs(parseAmount(summary.total_debit) - totalDebit) < 0.005;
  const totalCreditMatches = !summary.total_credit || Math.abs(parseAmount(summary.total_credit) - totalCredit) < 0.005;
  const closingBalanceMatches = Math.abs(openingBalance + totalCredit - totalDebit - closingBalance) < 0.005;

  return {
    source: "csv",
    statement_date: csvDateToIso(summary.period_from || "") || (first ? first.date : ""),
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    total_transactions_count: transactions.reduce((max, t) => Math.max(max, t.line_no), 0) || transactions.length,
    total_cash_in: totalCredit,
    total_cash_out: totalDebit,
    total_commission: totalCommission,
    account: {
      full_name: summary.full_name || "",
      account_no: summary.account_no || "",
      currency: summary.currency || "",
    },
    validation: {
      is_valid: totalDebitMatches && totalCreditMatches && closingBalanceMatches && balanceMismatchLines.length === 0,
      total_debit_matches: totalDebitMatches,
      total_credit_matches: totalCreditMatches,
      closing_balance_matches: closingBalanceMatches,
      balance_mismatch_lines: balanceMismatchLines,
    },
    transactions,
  };
};

app.post("/local-api/csv/extract", requirePermission(P.TRANSACTIONS_IMPORT), (req, res) => {
  try {
    const text = String(req.body?.text || "");
    if (!text.trim()) {
      res.status(400).json({ error: "Missing CSV data" });
      return;
    }

    res.json(extractTransactionsFromCsv(text));
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to parse CSV" });
  }
});

// ═══ Duplicate-aware import (used by both PDF and CSV engines) ═══
// Statement reference numbers (e.g. "tr:626186571") are unique per transaction, so an entry
// already stored with the same reference is a re-upload of the same statement line. The office
// shares one set of transactions, so duplicates are detected across all users.

const uniqueReferences = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];

const findTransactionsByReference = (references) => {
  if (!references.length) {
    return [];
  }
  const placeholders = references.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM transactions WHERE reference_number IN (${placeholders})`)
    .all(...references);
};

app.post("/local-api/transactions/find-duplicates", requirePermission(P.TRANSACTIONS_IMPORT), (req, res) => {
  res.json(findTransactionsByReference(uniqueReferences(req.body?.references)));
});

app.post("/local-api/transactions/import", requirePermission(P.TRANSACTIONS_IMPORT), (req, res) => {
  const config = ENTITY_CONFIG.transactions;
  const items = Array.isArray(req.body?.records) ? req.body.records : [];
  const overwrite = req.body?.overwrite === true;

  // Replacing an imported statement deletes the existing entries, so it needs delete rights.
  if (overwrite && !allow(req, res, P.TRANSACTIONS_DELETE)) return;

  const runImport = db.transaction(() => {
    let replaced = 0;
    if (overwrite) {
      const references = uniqueReferences(items.map((item) => item.reference_number));
      if (references.length) {
        const placeholders = references.map(() => "?").join(",");
        replaced = db
          .prepare(`DELETE FROM transactions WHERE reference_number IN (${placeholders})`)
          .run(...references).changes;
      }
    }
    const ids = items.map((item) => insertEntityRecord(config, item, req.user.email));
    return { replaced, ids };
  });

  const { replaced, ids } = runImport();
  const rows = ids.map((id) => db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id));
  res.status(201).json({ replaced, records: rows });
});

// ═══ Bulk actions on selected transactions ═══

const BULK_EDITABLE_FIELDS = ["type", "sender_name", "receiver_name", "service", "note", "transaction_date"];

const uniqueIds = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];

app.post("/local-api/transactions/bulk-update", (req, res) => {
  const ids = uniqueIds(req.body?.ids);
  const changes = req.body?.changes || {};

  if (!hasPermission(req.user, P.TRANSACTIONS_UPDATE_ANY) && !hasPermission(req.user, P.TRANSACTIONS_UPDATE_OWN)) {
    res.status(403).json({ error: "You don't have permission to do this", missing: [P.TRANSACTIONS_UPDATE_OWN] });
    return;
  }
  if (!ids.length) {
    res.status(400).json({ error: "No transactions selected" });
    return;
  }
  if (changes.type !== undefined && !["cash_in", "cash_out"].includes(changes.type)) {
    res.status(400).json({ error: "type must be cash_in or cash_out" });
    return;
  }
  if (changes.transaction_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(changes.transaction_date))) {
    res.status(400).json({ error: "transaction_date must be YYYY-MM-DD" });
    return;
  }

  const placeholders = ids.map(() => "?").join(",");

  // Users who may only edit their own entries: every selected row must be theirs, or nothing changes.
  if (!hasPermission(req.user, P.TRANSACTIONS_UPDATE_ANY)) {
    const rows = db.prepare(`SELECT id, created_by FROM transactions WHERE id IN (${placeholders})`).all(...ids);
    const notOwn = rows.filter((row) => !canUpdateTransaction(req.user, row)).map((row) => row.id);
    if (notOwn.length) {
      res.status(403).json({ error: "You can only edit transactions you entered", not_own: notOwn });
      return;
    }
  }

  const sets = [];
  const values = [];
  BULK_EDITABLE_FIELDS.forEach((field) => {
    if (changes[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(changes[field] === null ? "" : String(changes[field]));
    }
  });

  // A commission rate is applied per row, from that row's own amount (1% of $250 → $2.500).
  if (changes.commission_rate !== undefined) {
    const rate = Number(changes.commission_rate);
    if (changes.commission_rate === "" || !Number.isFinite(rate) || rate < 0) {
      res.status(400).json({ error: "commission_rate must be a number ≥ 0" });
      return;
    }
    sets.push("commission = ROUND(amount * ? / 100, 3)");
    values.push(rate);
  }

  if (!sets.length) {
    res.status(400).json({ error: "No changes to apply" });
    return;
  }

  sets.push("updated_date = ?");
  values.push(nowIso());

  const result = db
    .prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id IN (${placeholders})`)
    .run(...values, ...ids);
  const records = db.prepare(`SELECT * FROM transactions WHERE id IN (${placeholders})`).all(...ids);

  res.json({ updated: result.changes, records });
});

app.post("/local-api/transactions/bulk-delete", requirePermission(P.TRANSACTIONS_DELETE), (req, res) => {
  const ids = uniqueIds(req.body?.ids);
  if (!ids.length) {
    res.status(400).json({ error: "No transactions selected" });
    return;
  }

  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);

  res.json({ deleted: result.changes });
});

// ═══ Generic entity routes (transactions, daily-balances) ═══

app.post("/local-api/:entity/filter", (req, res) => {
  const config = entityOr404(req, res);
  if (!config || !allow(req, res, config.readPermission)) return;

  const { filter = {}, sortField = "created_date", limit = 1000 } = req.body || {};
  const built = buildFilterWhere(config, filter);
  if (built.error) {
    res.status(400).json({ error: built.error });
    return;
  }
  const safeSort = config.mutableFields.includes(sortField) || sortField === "created_date" ? sortField : "created_date";
  const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 10000) : 1000;

  const stmt = db.prepare(
    `SELECT * FROM ${config.table} ${built.where} ORDER BY ${safeSort} DESC LIMIT ?`
  );
  res.json(stmt.all(...built.params, safeLimit));
});

app.post("/local-api/:entity/create", (req, res) => {
  const config = entityOr404(req, res);
  if (!config || !allow(req, res, config.createPermission)) return;

  const payload = req.body || {};

  // The office has one opening balance per day: creating one for a date that already has one updates it.
  if (config.table === "daily_balances" && payload.date) {
    const existing = db.prepare("SELECT * FROM daily_balances WHERE date = ? ORDER BY id LIMIT 1").get(payload.date);
    if (existing) {
      db.prepare("UPDATE daily_balances SET opening_balance = ?, updated_date = ? WHERE id = ?")
        .run(Number(payload.opening_balance) || 0, nowIso(), existing.id);
      res.json(db.prepare("SELECT * FROM daily_balances WHERE id = ?").get(existing.id));
      return;
    }
  }

  const id = insertEntityRecord(config, payload, req.user.email);
  res.status(201).json(db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id));
});

app.post("/local-api/:entity/bulk-create", (req, res) => {
  const config = entityOr404(req, res);
  if (!config || !allow(req, res, config.bulkCreatePermission)) return;

  const items = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!items.length) {
    res.json([]);
    return;
  }

  const insertOne = db.transaction((item) => insertEntityRecord(config, item, req.user.email));

  const ids = items.map((item) => insertOne(item));
  const rows = ids.map((id) => db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id));

  res.status(201).json(rows);
});

app.put("/local-api/:entity/:id", (req, res) => {
  const config = entityOr404(req, res);
  if (!config) return;

  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  // Transactions: Admin/Manager may edit any; a User only the ones they entered.
  if (config.table === "transactions") {
    if (!canUpdateTransaction(req.user, existing)) {
      res.status(403).json({ error: "You can only edit transactions you entered" });
      return;
    }
  } else if (!allow(req, res, config.updatePermission)) {
    return;
  }

  const payload = req.body || {};
  const sets = [];
  const values = [];
  config.mutableFields.forEach((field) => {
    if (payload[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(payload[field]);
    }
  });

  sets.push("updated_date = ?");
  values.push(nowIso());
  values.push(id);

  db.prepare(`UPDATE ${config.table} SET ${sets.join(",")} WHERE id = ?`).run(...values);
  res.json(db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id));
});

app.delete("/local-api/:entity/:id", (req, res) => {
  const config = entityOr404(req, res);
  if (!config || !allow(req, res, config.deletePermission)) return;

  const id = Number(req.params.id);
  const result = db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(id);

  if (!result.changes) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  res.json({ ok: true, id });
});

// Only listen when run directly (`node server/index.js`); tests import the app instead.
const normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
const isMainModule = Boolean(process.argv[1]) && normalizePath(process.argv[1]) === normalizePath(__filename);

if (isMainModule) {
  // No accounts yet (fresh install or upgrade from the old admin/admin login): seed automatically.
  const seeded = ensureInitialAdmin();
  if (seeded) {
    console.log("[local-api] No user accounts found — created the default roles and an Admin account:");
    console.log(`[local-api]   Email:    ${seeded.admin.email}`);
    if (seeded.generatedPassword) {
      console.log(`[local-api]   Password: ${seeded.generatedPassword}`);
      console.log("[local-api]   ↑ Shown only once. Sign in and store it safely.");
      console.log("[local-api]     Lost it? Run: npm run seed -- --email another@email --password \"new password\"");
    } else {
      console.log("[local-api]   Password: the one set in SEED_ADMIN_PASSWORD");
    }
    const { transactions, daily_balances: balances } = seeded.migrated;
    if (transactions || balances) {
      console.log(`[local-api]   Existing data (${transactions} transactions, ${balances} opening balances) now belongs to this Admin.`);
    }
  }

  app.listen(PORT, () => {
    console.log(`[local-api] SQLite ready: ${dbPath}`);
    console.log(`[local-api] Listening on http://localhost:${PORT}`);
  });
}

export {
  app,
  db,
  extractPdfTable,
  extractTransactionsFromCsv,
  extractTransactionsFromRows,
  parseCsvText,
  splitNamePhone,
};
