/** @vitest-environment jsdom */
// The import history page: what each role is told it's seeing, the table, the Admin's store filter,
// the empty, capped and error states, and English.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportHistoryPage from "@/pages/ImportHistoryPage";
import AppToaster from "@/components/layout/AppToaster";
import { LanguageProvider } from "@/lib/i18n";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import { clearToasts, findToast } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/components/layout/Header", async (importOriginal) => ({ ...(await importOriginal()), default: () => null }));
vi.mock("@/api/apiClient", () => ({
  api: { importHistory: { list: vi.fn(), ambiguousCount: vi.fn(), clear: vi.fn() }, stores: { list: vi.fn() } },
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
  api.importHistory.ambiguousCount.mockResolvedValue({ total: 0 });
});
afterEach(cleanup);
afterEach(clearToasts);

const renderPage = (lang) => render(<LanguageProvider initialLang={lang}><MemoryRouter><AppToaster /><ImportHistoryPage /></MemoryRouter></LanguageProvider>);
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

describe("clearing the history (user's request, 2026-09-30; data:purge)", () => {
  it("a User doesn't see the button (not data:purge)", async () => {
    setAuthRole("user");
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByTestId("clear-history")).not.toBeInTheDocument();
    expect(api.importHistory.ambiguousCount).not.toHaveBeenCalled();
  });

  it.each(["admin", "manager"])("a %s sees it, and it's disabled until the list has loaded and isn't empty", async (role) => {
    setAuthRole(role);
    api.importHistory.list.mockResolvedValue({ total: 0, truncated: false, imports: [] });
    renderPage();
    expect(await screen.findByTestId("clear-history")).toBeDisabled();
  });

  it("opens a typed-count confirmation naming the count, disabled until it matches", async () => {
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("clear-history"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("مسح سجل الاستيراد نهائياً؟")).toBeInTheDocument();
    expect(within(dialog).getByText("سيؤدي هذا إلى حذف 2 عملية استيراد من السجل نهائياً، للجميع ضمن هذا النطاق. لن تتأثر العمليات المالية نفسها.")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("clear-history-ambiguous-warning")).not.toBeInTheDocument();
    const confirm = within(dialog).getByTestId("clear-history-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("clear-history-confirm-input"), { target: { value: "2" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.importHistory.clear).not.toHaveBeenCalled();
  });

  it("warns about pending ambiguous rows that will be discarded with the cleared imports", async () => {
    api.importHistory.ambiguousCount.mockResolvedValue({ total: 5 });
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("clear-history"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("clear-history-ambiguous-warning")).toHaveTextContent("5 صف غير واضح");
  });

  it("confirming clears it, shows a lasting toast (with the ambiguous count discarded), and refreshes the list", async () => {
    api.importHistory.clear.mockResolvedValue({ cleared: 2, discarded_ambiguous: 3 });
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("clear-history"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByTestId("clear-history-confirm-input"), { target: { value: "2" } });
    api.importHistory.list.mockResolvedValue({ total: 0, truncated: false, imports: [] });
    fireEvent.click(within(dialog).getByTestId("clear-history-confirm"));
    expect(api.importHistory.clear).toHaveBeenCalledWith(undefined, 2);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByTestId("imports-empty")).toBeInTheDocument();
    const toast = await findToast(/تم مسح 2 عملية استيراد من السجل\./);
    expect(toast).toHaveTextContent(/تم تجاهل 3 صف غير واضح/);
    expect(toast).toHaveAttribute("data-type", "success");
  });

  it("a stale count (409) shows the fresh count instead of clearing anything", async () => {
    const err = new Error("The import history changed since you last saw it. Check the count and try again.");
    err.status = 409;
    api.importHistory.clear.mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("clear-history"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByTestId("clear-history-confirm-input"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByTestId("clear-history-confirm"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("تغيّر سجل الاستيراد منذ آخر مرة شاهدته");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("in English", async () => {
    renderPage("en");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("clear-history"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Clear the import history permanently?")).toBeInTheDocument();
    expect(within(dialog).getByText("Type 2 to confirm")).toBeInTheDocument();
  });
});
