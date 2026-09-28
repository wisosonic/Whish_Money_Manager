/** @vitest-environment jsdom */
// The import history page: what each role is told it's seeing, the table, the Admin's store filter,
// the empty, capped and error states, and English.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportHistoryPage from "@/pages/ImportHistoryPage";
import { LanguageProvider } from "@/lib/i18n";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/components/layout/Header", async (importOriginal) => ({ ...(await importOriginal()), default: () => null }));
vi.mock("@/api/apiClient", () => ({
  api: { importHistory: { list: vi.fn() }, stores: { list: vi.fn() } },
}));

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).toISOString();
const ENTRIES = [
  { id: 2, store_id: 2, store_name: "Tripoli Branch", file_name: "AccountStatementCSV_20260923.csv", source: "csv", period_from: "2026-09-21", period_to: "2026-09-23",
    row_count: 127, replaced_count: 3, imported_by: "rami@office.test", imported_by_name: "Rami Haddad", imported_at: at(2026, 9, 24, 9, 5) },
  { id: 1, store_id: null, store_name: null, file_name: "statement.pdf", source: "pdf", period_from: "2026-09-20", period_to: "2026-09-20",
    row_count: 1, replaced_count: 0, imported_by: "old@office.test", imported_by_name: null, imported_at: at(2026, 9, 20, 18, 30) },
];

beforeEach(() => {
  vi.clearAllMocks();
  setAuthRole("admin");
  api.stores.list.mockResolvedValue([{ id: 1, name: "Beirut Main" }, { id: 2, name: "Tripoli Branch" }]);
  api.importHistory.list.mockResolvedValue({ total: 2, truncated: false, imports: ENTRIES });
});
afterEach(cleanup);

const renderPage = (lang) => render(<LanguageProvider initialLang={lang}><MemoryRouter><ImportHistoryPage /></MemoryRouter></LanguageProvider>);
const rows = () => [...screen.getByTestId("imports-table").querySelectorAll("tbody tr")];

describe("ImportHistoryPage", () => {
  it("lists each import: when, file and type, days, store, transactions (and replaced), who", async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("heading", { name: "سجل الاستيراد" })).toBeInTheDocument();
    expect(screen.getByTestId("imports-count")).toHaveTextContent("2 عملية استيراد");
    const [latest, older] = rows();
    expect(latest).toHaveTextContent("2026/09/24 09:05 AM");
    expect(latest).toHaveTextContent("AccountStatementCSV_20260923.csv");
    expect(latest).toHaveTextContent("csv");
    expect(latest).toHaveTextContent("2026-09-21 → 2026-09-23");
    expect(within(latest).getByTestId("import-store")).toHaveTextContent("Tripoli Branch");
    expect(latest).toHaveTextContent("127 عملية");
    expect(latest).toHaveTextContent("استُبدلت 3");
    expect(latest).toHaveTextContent("Rami Haddad");
    expect(latest).toHaveTextContent("rami@office.test");
    // A one-day import shows one date; a deleted store and a missing name have fallbacks.
    expect(older).toHaveTextContent("2026-09-20");
    expect(older).not.toHaveTextContent("→");
    expect(within(older).getByTestId("import-store")).toHaveTextContent("(متجر محذوف)");
    expect(older).toHaveTextContent("old@office.test");
    expect(older).not.toHaveTextContent("استُبدلت");
  });

  it("the Admin with several stores can pick one; the Store column only shows for All stores", async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.importHistory.list).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId("imports-scope")).toHaveTextContent("كل الكشوفات المستوردة، في كل المتاجر.");
    fireEvent.change(await screen.findByTestId("imports-store"), { target: { value: "2" } });
    await waitFor(() => expect(api.importHistory.list).toHaveBeenLastCalledWith(2));
    expect(screen.queryByTestId("import-store")).not.toBeInTheDocument();
  });

  it.each([
    ["manager", "كل الكشوفات المستوردة إلى متجرك."],
    ["user", "الكشوفات التي استوردتها."],
  ])("a %s is told whose imports these are, has no store filter, and asks for no store", async (role, text) => {
    setAuthRole(role);
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByTestId("imports-scope")).toHaveTextContent(text);
    expect(screen.queryByTestId("imports-store")).not.toBeInTheDocument();
    expect(screen.queryByTestId("import-store")).not.toBeInTheDocument();
    expect(api.importHistory.list).toHaveBeenCalledWith(undefined);
    expect(api.stores.list).not.toHaveBeenCalled();
  });

  it("with nothing imported yet, says so and where imports come from", async () => {
    api.importHistory.list.mockResolvedValue({ total: 0, truncated: false, imports: [] });
    renderPage();
    expect(await screen.findByTestId("imports-empty")).toHaveTextContent("لا توجد عمليات استيراد بعد");
    expect(screen.queryByTestId("imports-table")).not.toBeInTheDocument();
  });

  it("says when only the latest imports are shown (the 10,000 rule)", async () => {
    api.importHistory.list.mockResolvedValue({ total: 10002, truncated: true, imports: ENTRIES });
    renderPage();
    expect(await screen.findByTestId("imports-truncated")).toHaveTextContent("عرض آخر 2 من أصل 10002 عملية استيراد.");
  });

  it("a failed load shows an error", async () => {
    api.importHistory.list.mockRejectedValue(new Error(""));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل سجل الاستيراد.");
  });

  it("in English", async () => {
    renderPage("en");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("heading", { name: "Import history" })).toBeInTheDocument();
    expect(screen.getByTestId("imports-count")).toHaveTextContent("2 imports");
    expect(rows()[0]).toHaveTextContent("127 transactions");
    expect(rows()[0]).toHaveTextContent("3 replaced");
    expect(rows()[1]).toHaveTextContent("1 transaction");
    expect(rows()[1]).toHaveTextContent("(deleted store)");
    expect(screen.getByRole("columnheader", { name: "By" })).toBeInTheDocument();
  });
});
