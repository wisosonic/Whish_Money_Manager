/** @vitest-environment jsdom */
// Stores in the UI: the Stores page (Admin / Manager / User / no store), the dashboard's store
// picker and "All stores" view, importing into a chosen store, the Users page's Store column, the
// commission rate per store, the admin panel's store filter and the header link.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import StoresPage from "@/pages/StoresPage";
import Dashboard from "@/pages/Dashboard";
import UsersPage from "@/pages/UsersPage";
import AdminPage from "@/pages/AdminPage";
import Header from "@/components/layout/Header";
import ImportPDFModal from "@/components/transactions/ImportPDFModal";
import CommissionRates from "@/components/settings/CommissionRates";
import AppToaster from "@/components/layout/AppToaster";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { walletFigures, walletFiguresByStore } from "@/lib/walletMath";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import { clearToasts, findToast } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { me: vi.fn(), updatePreferences: vi.fn() },
    stores: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), setManager: vi.fn(), assignable: vi.fn(), addMember: vi.fn(), removeMember: vi.fn() },
    users: { list: vi.fn(), update: vi.fn(), create: vi.fn() },
    roles: { list: vi.fn() },
    entities: {
      Transaction: { filter: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findDuplicates: vi.fn(), importRecords: vi.fn() },
      DailyBalance: { filter: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
    integrations: { Core: { ExtractCsv: vi.fn(), ExtractPdf: vi.fn() } },
    closedDays: { list: vi.fn(), close: vi.fn(), reopen: vi.fn() },
    commissionRates: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    admin: { range: vi.fn(), summary: vi.fn(), exportCsv: vi.fn(), purge: vi.fn(), restorePreview: vi.fn(), restore: vi.fn(),
      reports: { income: vi.fn(), parties: vi.fn(), stores: vi.fn() } },
  },
}));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const { cloneElement } = await import("react");
  return { ...actual, ResponsiveContainer: ({ children, height }) => cloneElement(children, { width: 800, height: typeof height === "number" ? height : 400 }) };
});
// The admin panel's income chart and the dashboard's chart window load on demand.
beforeAll(async () => { await import("@/components/reports/IncomeChart"); }, 60000);

const BEIRUT = { id: 1, name: "Beirut Main", location: "Hamra", phone: "+961 1 111 111", email: "beirut@office.test",
  manager: { id: 2, full_name: "Maya Manager", email: "manager@test.local" }, member_count: 2, transaction_count: 3 };
const TRIPOLI = { id: 2, name: "Tripoli Branch", location: "Tripoli", phone: "", email: "", manager: null, member_count: 0, transaction_count: 1 };
const tx = (id, storeId, over = {}) => ({ id, store_id: storeId, type: "cash_in", amount: 10, commission: 0.1, sender_name: `Sender ${id}`, receiver_name: "", reference_number: `tr:${id}`,
  transaction_date: "2026-09-23", sort_order: id, created_date: "2026-09-23T10:00:00Z", created_by: "admin@test.local", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("selectedDate", "2026-09-23");
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
  setAuthRole("admin");
  api.stores.list.mockResolvedValue([BEIRUT, TRIPOLI]);
  api.stores.get.mockImplementation(async (id) => ({ ...(id === 1 ? BEIRUT : TRIPOLI), members: id === 1
    ? [{ id: 2, full_name: "Maya Manager", email: "manager@test.local", role: "manager" }, { id: 3, full_name: "Rami", email: "user@test.local", role: "user" }]
    : [] }));
  api.stores.assignable.mockResolvedValue([{ id: 7, full_name: "New Cashier", email: "new@test.local" }]);
  api.stores.addMember.mockResolvedValue({});
  api.stores.removeMember.mockResolvedValue({});
  api.stores.setManager.mockResolvedValue({});
  api.users.list.mockResolvedValue([
    { id: 1, email: "admin@test.local", full_name: "Admin", role: "admin", is_active: true, store_id: null },
    { id: 2, email: "manager@test.local", full_name: "Maya Manager", role: "manager", is_active: true, store_id: 1, store_name: "Beirut Main" },
    { id: 4, email: "manager2@test.local", full_name: "Omar Manager", role: "manager", is_active: true, store_id: null },
    { id: 3, email: "user@test.local", full_name: "Rami", role: "user", is_active: true, store_id: 1, store_name: "Beirut Main" },
  ]);
  api.roles.list.mockResolvedValue(DEFAULT_ROLES.map((r, i) => ({ id: i + 1, ...r })));
  api.entities.Transaction.filter.mockImplementation(async (filter) => [tx(1, 1), tx(2, 2, { sender_name: "Tripoli sender" })].filter((row) => !filter?.store_id || row.store_id === filter.store_id));
  api.entities.DailyBalance.filter.mockResolvedValue([]);
  api.closedDays.list.mockResolvedValue([]);
  api.commissionRates.get.mockResolvedValue({ rate: 1, current: 1, history: [{ rate: 1, effective_from: "2000-01-01", created_by: "system" }] });
  api.admin.summary.mockResolvedValue({ transactions: 0, opening_balances: 0, days: 0, total_in: 0, total_out: 0, total_commission: 0 });
  api.admin.reports.income.mockImplementation(async (year) => ({ year, years: [year], months: [] }));
  api.admin.reports.stores.mockResolvedValue({ totals: { count: 4, cash_in: 100, cash_out: 0, volume: 100, commission: 1 }, stores: [
    { id: 2, name: "Tripoli Branch", location: "Tripoli", count: 3, cash_in: 75, cash_out: 0, volume: 75, commission: 0.75, share: 0.75 },
    { id: 1, name: "Beirut Main", location: "Hamra", count: 1, cash_in: 25, cash_out: 0, volume: 25, commission: 0.25, share: 0.25 },
  ] });
});
afterEach(() => {
  cleanup();
  clearToasts();
});

const wrap = (ui, { path = "/", lang } = {}) => render(
  <LanguageProvider initialLang={lang}>
    <MemoryRouter initialEntries={[path]}><PreferencesProvider>{ui}<AppToaster /></PreferencesProvider></MemoryRouter>
  </LanguageProvider>
);

describe("Stores page — Admin", () => {
  it("lists every store with its location, contact, Manager and counts", async () => {
    wrap(<StoresPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "المتاجر" })).toBeInTheDocument();
    const beirut = await screen.findByTestId("store-1");
    expect(beirut).toHaveTextContent("Beirut Main");
    expect(beirut).toHaveTextContent("Hamra");
    expect(beirut).toHaveTextContent("+961 1 111 111");
    expect(within(beirut).getByTestId("manager-1")).toHaveValue("2");
    expect(within(screen.getByTestId("store-2")).getByTestId("manager-2")).toHaveValue("");
  });

  it("adds a store (name required) and edits one", async () => {
    api.stores.create.mockResolvedValue({ ...TRIPOLI, id: 3, name: "Online Shop" });
    wrap(<StoresPage />);
    fireEvent.click(await screen.findByTestId("add-store"));
    expect(screen.getByTestId("save-store")).toBeDisabled();
    fireEvent.change(screen.getByTestId("store-name"), { target: { value: "Online Shop" } });
    fireEvent.change(screen.getByTestId("store-location"), { target: { value: "Online" } });
    fireEvent.click(screen.getByTestId("save-store"));
    await waitFor(() => expect(api.stores.create).toHaveBeenCalledWith({ name: "Online Shop", location: "Online", phone: "", email: "" }));
    expect(await findToast("تمت إضافة Online Shop")).toHaveAttribute("data-type", "success");

    api.stores.update.mockResolvedValue({ ...BEIRUT, phone: "01 222" });
    fireEvent.click(screen.getByRole("button", { name: "تعديل Beirut Main" }));
    expect(screen.getByTestId("store-name")).toHaveValue("Beirut Main");
    fireEvent.change(screen.getByTestId("store-phone"), { target: { value: "01 222" } });
    fireEvent.click(screen.getByTestId("save-store"));
    await waitFor(() => expect(api.stores.update).toHaveBeenCalledWith(1, expect.objectContaining({ phone: "01 222" })));
  });

  it("assigns a Manager, and clears one", async () => {
    wrap(<StoresPage />);
    fireEvent.change(await screen.findByTestId("manager-2"), { target: { value: "4" } });
    await waitFor(() => expect(api.stores.setManager).toHaveBeenCalledWith(2, 4));
    expect(await findToast("أصبح Omar Manager مدير Tripoli Branch")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("manager-1"), { target: { value: "" } });
    await waitFor(() => expect(api.stores.setManager).toHaveBeenCalledWith(1, null));
  });

  it("deleting asks first; a store that isn't empty is refused with the reason", async () => {
    api.stores.remove.mockRejectedValue(new Error("This store still has transactions or opening balances. Move or delete them first."));
    wrap(<StoresPage />);
    fireEvent.click(await screen.findByRole("button", { name: "حذف Tripoli Branch" }));
    const dialog = screen.getByRole("alertdialog", { name: "حذف Tripoli Branch؟" });
    expect(api.stores.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId("confirm-delete-store"));
    await waitFor(() => expect(api.stores.remove).toHaveBeenCalledWith(2));
    expect(await findToast("ما زالت لهذا المتجر عمليات أو أرصدة بداية. انقلها أو احذفها أولاً.")).toHaveAttribute("data-type", "error");
  });
});

describe("Stores page — Manager and User", () => {
  it("a Manager sees their store (read-only details) and manages its Users", async () => {
    setAuthRole("manager", { id: 2 });
    api.stores.list.mockResolvedValue([BEIRUT]);
    wrap(<StoresPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "متجري" })).toBeInTheDocument();
    const card = await screen.findByTestId("store-1");
    expect(within(card).queryByRole("button", { name: /تعديل|حذف/ })).not.toBeInTheDocument();
    expect(within(card).queryByTestId("manager-1")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("Maya Manager");
    const members = await screen.findByTestId("members-1");
    await waitFor(() => expect(members).toHaveTextContent("Rami"));
    fireEvent.change(within(members).getByTestId("add-member-1"), { target: { value: "7" } });
    fireEvent.click(within(members).getByTestId("add-member-button-1"));
    await waitFor(() => expect(api.stores.addMember).toHaveBeenCalledWith(1, 7));
    expect(await findToast("تمت إضافة New Cashier إلى Beirut Main")).toBeInTheDocument();
    fireEvent.click(within(members).getByRole("button", { name: "إزالة Rami من هذا المتجر" }));
    await waitFor(() => expect(api.stores.removeMember).toHaveBeenCalledWith(1, 3));
  });

  it("a User sees their store's details, without its members", async () => {
    setAuthRole("user");
    api.stores.list.mockResolvedValue([BEIRUT]);
    wrap(<StoresPage />);
    const card = await screen.findByTestId("store-1");
    expect(card).toHaveTextContent("Hamra");
    expect(screen.queryByTestId("members-1")).not.toBeInTheDocument();
    expect(api.stores.get).not.toHaveBeenCalled();
  });

  it("someone not in a store is told so", async () => {
    setAuthRole("user", { store_id: null, store_name: null });
    api.stores.list.mockResolvedValue([]);
    wrap(<StoresPage />);
    expect(await screen.findByTestId("no-store")).toHaveTextContent("لست في متجر بعد");
  });
});

describe("dashboard", () => {
  const rows = (container) => [...container.querySelectorAll("tbody tr")];

  it("the Admin with several stores starts on All stores: every row, a Store column, no day actions", async () => {
    const { container } = wrap(<Dashboard />);
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    expect(api.entities.Transaction.filter).toHaveBeenLastCalledWith({}, "created_date", 10000);
    expect(screen.getByTestId("dashboard-store")).toHaveValue("all");
    expect(screen.getByTestId("store-column")).toHaveTextContent("المتجر");
    expect(screen.getAllByTestId("row-store").map((c) => c.textContent).sort()).toEqual(["Beirut Main", "Tripoli Branch"]);
    expect(screen.getByRole("button", { name: /Cash In/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cash In/ })).toHaveAttribute("title", "اختر متجراً أولاً");
    expect(screen.queryByTestId("close-day")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("تعديل رصيد البداية")).not.toBeInTheDocument();
  });

  it("choosing a store shows only its rows, remembers it, and adds entries to it", async () => {
    api.entities.Transaction.create.mockResolvedValue({ id: 9 });
    const { container } = wrap(<Dashboard />);
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    fireEvent.change(screen.getByTestId("dashboard-store"), { target: { value: "2" } });
    await waitFor(() => expect(api.entities.Transaction.filter).toHaveBeenLastCalledWith({ store_id: 2 }, "created_date", 10000));
    await waitFor(() => expect(rows(container)).toHaveLength(1));
    expect(document.cookie).toContain("wmm_selected_store=2"); // remembered in a cookie
    expect(api.entities.DailyBalance.filter).toHaveBeenLastCalledWith({ store_id: 2 });
    expect(api.closedDays.list).toHaveBeenLastCalledWith(2);
    expect(screen.queryByTestId("store-column")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cash In/ }));
    fireEvent.change(await screen.findByPlaceholderText("0.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ/ }));
    await waitFor(() => expect(api.entities.Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 50, store_id: 2 })));
  });

  it("the chosen store and the last day viewed come back from their cookies on the next load", async () => {
    window.localStorage.clear();
    document.cookie = "wmm_selected_store=2; Path=/";
    document.cookie = "wmm_selected_date=2026-09-22; Path=/";
    const { container } = wrap(<Dashboard />);
    await waitFor(() => expect(api.entities.Transaction.filter).toHaveBeenLastCalledWith({ store_id: 2 }, "created_date", 10000));
    expect(screen.getByTestId("dashboard-store")).toHaveValue("2");
    expect(container.querySelector('input[type="date"]')).toHaveValue("2026-09-22");
    // Choosing another day remembers it.
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: "2026-09-23" } });
    expect(document.cookie).toContain("wmm_selected_date=2026-09-23");
  });

  it("in All stores, a row is locked by its own store's closed day", async () => {
    api.closedDays.list.mockResolvedValue([{ store_id: 2, date: "2026-09-23", closed_by: "x", closed_at: "2026-09-23T20:00:00Z" }]);
    const { container } = wrap(<Dashboard />);
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    const tripoli = rows(container).find((row) => row.textContent.includes("Tripoli sender"));
    const beirut = rows(container).find((row) => row.textContent.includes("Sender 1"));
    expect(within(tripoli).getByTestId("row-closed")).toBeInTheDocument();
    expect(within(beirut).queryByTestId("row-closed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("closed-day-banner")).not.toBeInTheDocument();
  });

  it("someone not in a store sees a message instead of the journal", async () => {
    setAuthRole("user", { store_id: null, store_name: null });
    wrap(<Dashboard />);
    expect(await screen.findByTestId("no-store")).toHaveTextContent("اطلب من المسؤول أو من مدير متجرك إضافتك إلى متجر.");
    expect(api.entities.Transaction.filter).not.toHaveBeenCalled();
  });

  it("with a single store the store field is still shown: that store, greyed out; nothing else changes", async () => {
    api.stores.list.mockResolvedValue([BEIRUT]);
    const { container } = wrap(<Dashboard />);
    await waitFor(() => expect(rows(container)).toHaveLength(2));
    const select = screen.getByTestId("dashboard-store");
    expect(select).toBeDisabled();
    expect(select).toHaveValue("1");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Beirut Main"]); // no "All stores" with one store
    expect(screen.getByTestId("store-picker-hint")).toHaveTextContent("أضف متاجر من صفحة المتاجر");
    // Same requests as before stores: the server knows the only store.
    expect(api.entities.Transaction.filter).toHaveBeenLastCalledWith({}, "created_date", 10000);
    expect(screen.getByRole("button", { name: /Cash In/ })).toBeEnabled();
    expect(screen.queryByTestId("store-column")).not.toBeInTheDocument();
  });

  it("a Manager or User sees the store they work in, greyed out (they can't switch)", async () => {
    for (const role of ["manager", "user"]) {
      setAuthRole(role);
      const { container, unmount } = wrap(<Dashboard />);
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      const select = screen.getByTestId("dashboard-store");
      expect(select).toBeDisabled();
      expect([...select.options].map((o) => o.textContent)).toEqual(["Main store"]);
      expect(screen.getByTestId("store-picker-hint")).toHaveTextContent("المتجر الذي تعمل فيه.");
      expect(api.stores.list).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe("wallet figures per store", () => {
  it("All stores adds up each store's opening balance and wallet balance", () => {
    const transactions = [tx(1, 1, { amount: 50 }), tx(2, 2, { amount: 20, type: "cash_out" })];
    const balances = [{ id: 1, store_id: 1, date: "2026-09-23", opening_balance: 100 }, { id: 2, store_id: 2, date: "2026-09-23", opening_balance: 200 }];
    expect(walletFiguresByStore(transactions, balances, "2026-09-23")).toMatchObject({ openingBalance: 300, netBalance: 150 + 180 });
    expect(walletFigures(transactions.slice(0, 1), balances.slice(0, 1), "2026-09-23")).toMatchObject({ openingBalance: 100, netBalance: 150 });
  });
});

describe("import into a store", () => {
  const csv = () => new File(["date,debit,credit,balance"], "statement.csv", { type: "text/csv" });
  const choose = (file) => fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

  it("with several stores, the store is picked by hand before the file is read, and used everywhere", async () => {
    api.integrations.Core.ExtractCsv.mockResolvedValue({ transactions: [{ type: "cash_in", amount: 5, commission: 0.1, reference_number: "tr:1", date: "2026-09-23" }], opening_balance: 10, statement_date: "2026-09-23" });
    api.entities.Transaction.findDuplicates.mockResolvedValue([]);
    api.entities.Transaction.importRecords.mockResolvedValue({ replaced: 0, records: [] });
    const onSaved = vi.fn();
    wrap(<ImportPDFModal stores={[BEIRUT, TRIPOLI]} onClose={vi.fn()} onSaved={onSaved} />);
    choose(csv());
    expect(await screen.findByText("اختر أولاً المتجر الذي يخصّه هذا الكشف.")).toBeInTheDocument();
    expect(api.integrations.Core.ExtractCsv).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("import-store"), { target: { value: "2" } });
    choose(csv());
    await waitFor(() => expect(api.integrations.Core.ExtractCsv).toHaveBeenCalledWith(expect.any(File), 2));
    expect(api.entities.Transaction.findDuplicates).toHaveBeenCalledWith(["tr:1"], 2);
    expect(await screen.findByTestId("import-store-name")).toHaveTextContent("الاستيراد إلى Tripoli Branch");
    fireEvent.click(await screen.findByRole("button", { name: /حفظ الكل/ }));
    await waitFor(() => expect(api.entities.Transaction.importRecords).toHaveBeenCalledWith(expect.any(Array), { overwrite: false, storeId: 2 }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(10, "2026-09-23", 2), { timeout: 3000 });
  });

  it("a Manager or User sees the store field with their own store, greyed out", async () => {
    setAuthRole("user");
    api.integrations.Core.ExtractCsv.mockResolvedValue({ transactions: [{ type: "cash_in", amount: 5, reference_number: "tr:1", date: "2026-09-23" }], statement_date: "2026-09-23" });
    api.entities.Transaction.findDuplicates.mockResolvedValue([]);
    wrap(<ImportPDFModal onClose={vi.fn()} onSaved={vi.fn()} />);
    const select = screen.getByTestId("import-store");
    expect(select).toBeDisabled();
    expect([...select.options].map((o) => o.textContent)).toEqual(["Main store"]);
    // Nothing to choose: the file can be read straight away, and no store is sent (the server uses theirs).
    choose(csv());
    await waitFor(() => expect(api.integrations.Core.ExtractCsv).toHaveBeenCalledWith(expect.any(File), undefined));
    expect(await screen.findByTestId("import-store-name")).toHaveTextContent("الاستيراد إلى Main store");
  });

  it("the Admin with one store sees it in the field, greyed out and already chosen", () => {
    wrap(<ImportPDFModal stores={[BEIRUT]} onClose={vi.fn()} onSaved={vi.fn()} />);
    const select = screen.getByTestId("import-store");
    expect(select).toBeDisabled();
    expect(select).toHaveValue("1");
    expect(screen.queryByText("اختر متجراً…")).not.toBeInTheDocument();
  });

  it("with several stores the field starts on the dashboard's store when one is shown there", () => {
    wrap(<ImportPDFModal stores={[BEIRUT, TRIPOLI]} defaultStoreId={2} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId("import-store")).toBeEnabled();
    expect(screen.getByTestId("import-store")).toHaveValue("2");
  });
});

describe("Users page — Store column", () => {
  it("a User's store is chosen here; a Manager's is shown; the Admin works in all stores", async () => {
    api.users.update.mockResolvedValue({});
    wrap(<UsersPage />, { path: "/users" });
    const user = await screen.findByTestId("user-store-user@test.local");
    await waitFor(() => expect(within(user).getAllByRole("option").map((o) => o.textContent)).toEqual(["بلا متجر", "Beirut Main", "Tripoli Branch"]));
    fireEvent.change(within(user).getByLabelText("متجر user@test.local"), { target: { value: "2" } });
    await waitFor(() => expect(api.users.update).toHaveBeenCalledWith(3, { store_id: 2 }));
    expect(await findToast("أصبح user@test.local يعمل في Tripoli Branch")).toBeInTheDocument();
    expect(screen.getByTestId("user-store-manager@test.local")).toHaveTextContent("مدير Beirut Main");
    expect(screen.getByTestId("user-store-admin@test.local")).toHaveTextContent("كل المتاجر");
  });
});

describe("commission rate per store", () => {
  it("the Admin picks the store whose rate is shown and changed", async () => {
    api.commissionRates.set.mockResolvedValue({ current: 1, history: [] });
    wrap(<CommissionRates />);
    await waitFor(() => expect(api.commissionRates.get).toHaveBeenCalledWith(undefined, 1));
    fireEvent.change(screen.getByTestId("rate-store-select"), { target: { value: "2" } });
    await waitFor(() => expect(api.commissionRates.get).toHaveBeenLastCalledWith(undefined, 2));
    fireEvent.change(await screen.findByTestId("rate-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("rate-save"));
    fireEvent.click(screen.getByTestId("rate-confirm"));
    await waitFor(() => expect(api.commissionRates.set).toHaveBeenCalledWith(2, expect.any(String), 2));
  });

  it("a Manager sees their store's rate (no picker, no store sent)", async () => {
    setAuthRole("manager");
    wrap(<CommissionRates />);
    await waitFor(() => expect(api.commissionRates.get).toHaveBeenCalledWith());
    expect(screen.queryByTestId("rate-store-select")).not.toBeInTheDocument();
  });
});

describe("admin panel", () => {
  it("the data column follows the chosen store (or all); reports filter by store; stores compared side by side", async () => {
    wrap(<AdminPage />, { path: "/admin" });
    await waitFor(() => expect(api.admin.summary).toHaveBeenCalledWith(expect.any(String), expect.any(String)));
    fireEvent.change(await screen.findByTestId("data-store-select"), { target: { value: "2" } });
    await waitFor(() => expect(api.admin.summary).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 2));

    fireEvent.change(screen.getByTestId("report-store-select"), { target: { value: "1" } });
    await waitFor(() => expect(api.admin.reports.income).toHaveBeenLastCalledWith(expect.any(String), 1));

    fireEvent.click(screen.getByRole("tab", { name: "مقارنة المتاجر" }));
    expect(screen.queryByTestId("report-store-select")).not.toBeInTheDocument();
    const table = await screen.findByTestId("stores-report-table");
    const [first, second] = within(table).getAllByTestId("stores-report-row");
    expect(first).toHaveTextContent("Tripoli Branch");
    expect(first).toHaveTextContent("75.0%");
    expect(second).toHaveTextContent("Beirut Main");
    expect(within(table).getByTestId("stores-report-total")).toHaveTextContent("$100.00");
  });

  it("a Manager's panel names their store, with no store picker and no stores comparison", async () => {
    setAuthRole("manager");
    wrap(<AdminPage />, { path: "/admin" });
    expect(await screen.findByTestId("data-store-name")).toHaveTextContent("بيانات Main store");
    expect(screen.queryByTestId("data-store-select")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "مقارنة المتاجر" })).not.toBeInTheDocument();
    expect(api.stores.list).not.toHaveBeenCalled();
  });
});

describe("header", () => {
  it("the Admin gets a Stores link; others a My store link and their store's name; nobody without a store gets a link", () => {
    const { unmount } = wrap(<Header />);
    expect(screen.getByTestId("stores-link")).toHaveTextContent("المتاجر");
    expect(screen.getByTestId("stores-link")).toHaveAttribute("href", "/stores");
    unmount();
    setAuthRole("user");
    const second = wrap(<Header />);
    expect(screen.getByTestId("stores-link")).toHaveTextContent("متجري");
    expect(screen.getByTestId("store-badge")).toHaveTextContent("Main store");
    second.unmount();
    setAuthRole("user", { store_id: null, store_name: null });
    wrap(<Header />);
    expect(screen.queryByTestId("stores-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("store-badge")).not.toBeInTheDocument();
  });
});
