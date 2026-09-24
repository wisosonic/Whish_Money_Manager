/** @vitest-environment jsdom */
// Settings page and per-user preferences: language, visible table columns, row density, which
// summaries start open — saving, errors, and the dashboard following the saved choices.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import Header from "@/components/layout/Header";
import LanguageToggle from "@/components/layout/LanguageToggle";
import TransactionsList from "@/components/dashboard/TransactionsList";
import StatsCards from "@/components/dashboard/StatsCards";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider, usePreferences } from "@/lib/PreferencesContext";
import { TABLE_COLUMNS, applyPreferenceChanges, resolvePreferences } from "@/lib/preferences";
import { base44 } from "@/api/base44Client";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { updatePreferences: vi.fn() },
    entities: { Transaction: { delete: vi.fn(), bulkDelete: vi.fn(), bulkUpdate: vi.fn() } },
  },
}));

// The mocked server merges changes the same way the real one does.
let serverPreferences;
beforeEach(() => {
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
  setAuthRole("user");
  serverPreferences = resolvePreferences(null);
  base44.auth.updatePreferences.mockReset();
  base44.auth.updatePreferences.mockImplementation(async (changes) => {
    const { preferences, error } = applyPreferenceChanges(serverPreferences, changes);
    if (error) throw Object.assign(new Error(error), { status: 400 });
    serverPreferences = preferences;
    return { email: "user@test.local", preferences };
  });
});
afterEach(cleanup);

const withProviders = (ui, path = "/settings") => (
  <LanguageProvider>
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider>{ui}</PreferencesProvider>
    </MemoryRouter>
  </LanguageProvider>
);
const renderSettings = () => render(withProviders(<SettingsPage />));
const box = (testId) => screen.getByTestId(testId);
const status = () => screen.getByTestId("settings-status");

describe("Settings page", () => {
  it("shows the three sections with the current (default) values", () => {
    renderSettings();
    expect(screen.getByRole("heading", { level: 1, name: "الإعدادات" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "اللغة" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "أعمدة الجدول" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "العرض" })).toBeInTheDocument();

    expect(box("language-ar")).toBeChecked();
    expect(box("language-en")).not.toBeChecked();
    TABLE_COLUMNS.forEach((key) => expect(box(`column-${key}`)).toBeChecked());
    expect(screen.getByTestId("columns-count")).toHaveTextContent("11 من 11 أعمدة ظاهرة.");
    expect(box("density-comfortable")).toBeChecked();
    expect(box("summary-month")).toBeChecked();
    expect(box("summary-year")).not.toBeChecked();
    expect(box("settings-reset")).toBeDisabled();
    expect(screen.getByRole("button", { name: "إظهار كل الأعمدة" })).toBeDisabled();
  });

  it("each column has a labelled checkbox (in the interface language)", () => {
    renderSettings();
    const group = screen.getByRole("group", { name: "أعمدة الجدول" });
    ["الرقم (#)", "النوع", "المرسل", "المبلغ", "التاريخ"].forEach((name) =>
      expect(within(group).getByRole("checkbox", { name })).toBeInTheDocument());
  });

  it("hiding a column saves only that change and reports Saving… then Saved", async () => {
    let finish;
    base44.auth.updatePreferences.mockImplementationOnce((changes) => new Promise((resolve) => {
      finish = () => resolve({ preferences: applyPreferenceChanges(serverPreferences, changes).preferences });
    }));
    renderSettings();
    fireEvent.click(box("column-note"));
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledWith({ hiddenColumns: ["note"] }));
    // Applied immediately, before the server answers.
    expect(box("column-note")).not.toBeChecked();
    expect(status()).toHaveTextContent("جاري الحفظ…");
    expect(status()).toHaveAttribute("aria-live", "polite");

    await act(async () => finish());
    expect(status()).toHaveTextContent("تم الحفظ");
    expect(screen.getByTestId("columns-count")).toHaveTextContent("10 من 11");
    expect(box("settings-reset")).toBeEnabled();
  });

  it("keeps hidden columns in table order and can show them all again", async () => {
    renderSettings();
    fireEvent.click(box("column-service"));
    await waitFor(() => expect(status()).toHaveTextContent("تم الحفظ"));
    fireEvent.click(box("column-type"));
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenLastCalledWith({ hiddenColumns: ["type", "service"] }));
    await waitFor(() => expect(status()).toHaveTextContent("تم الحفظ"));
    fireEvent.click(screen.getByRole("button", { name: "إظهار كل الأعمدة" }));
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenLastCalledWith({ hiddenColumns: [] }));
    await waitFor(() => expect(box("column-type")).toBeChecked());
  });

  it("the last visible column can't be turned off", () => {
    setAuthRole("user", { preferences: { hiddenColumns: TABLE_COLUMNS.filter((k) => k !== "amount") } });
    renderSettings();
    expect(box("column-amount")).toBeChecked();
    expect(box("column-amount")).toBeDisabled();
    expect(box("column-note")).toBeEnabled();
    expect(screen.getByTestId("columns-count")).toHaveTextContent("يجب أن يبقى عمود واحد على الأقل ظاهراً.");
  });

  it("saves row density and the summaries' opening state", async () => {
    renderSettings();
    fireEvent.click(box("density-compact"));
    fireEvent.click(box("summary-year"));
    fireEvent.click(box("summary-month"));
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledTimes(3));
    // Each save carries only its own change.
    expect(base44.auth.updatePreferences.mock.calls.map(([changes]) => changes)).toEqual([
      { density: "compact" }, { summaries: { year: true } }, { summaries: { month: false } },
    ]);
    await waitFor(() => expect(serverPreferences.summaries).toEqual({ month: false, year: true }));
    expect(box("density-compact")).toBeChecked();
    expect(box("summary-month")).not.toBeChecked();
    expect(box("summary-year")).toBeChecked();
  });

  it("restores the default display settings in one save (the language is left alone)", async () => {
    setAuthRole("user", { preferences: { language: "ar", hiddenColumns: ["note"], density: "compact", summaries: { month: false, year: true }, theme: "dark" } });
    renderSettings();
    fireEvent.click(box("settings-reset"));
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledTimes(1));
    expect(base44.auth.updatePreferences).toHaveBeenCalledWith({
      hiddenColumns: [], theme: "light", density: "comfortable", summaries: { month: true, year: false },
    });
    await waitFor(() => expect(box("settings-reset")).toBeDisabled());
  });

  it("choosing English switches the whole page right away and saves it to the account", async () => {
    renderSettings();
    fireEvent.click(box("language-en"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Table columns" })).toBeInTheDocument();
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledWith({ language: "en" }));
    await waitFor(() => expect(status()).toHaveTextContent("Saved"));
    expect(document.cookie).toContain("wmm_lang=en");
  });

  it("if saving fails, the previous value comes back and the error is shown in the interface language", async () => {
    base44.auth.updatePreferences.mockRejectedValueOnce(Object.assign(new Error("At least one column must stay visible"), { status: 400 }));
    renderSettings();
    fireEvent.click(box("column-date"));
    expect(box("column-date")).not.toBeChecked();
    await waitFor(() => expect(status()).toHaveTextContent("يجب أن يبقى عمود واحد على الأقل ظاهراً"));
    expect(box("column-date")).toBeChecked();
  });

  it("quick successive changes are saved one at a time, in order, and an older answer never undoes a newer change", async () => {
    setAuthRole("user", { preferences: { summaries: { month: false, year: false } } });
    serverPreferences = resolvePreferences({ summaries: { month: false, year: false } });
    const answers = [];
    base44.auth.updatePreferences.mockImplementation((changes) => new Promise((resolve) => {
      answers.push(() => {
        const { preferences } = applyPreferenceChanges(serverPreferences, changes);
        serverPreferences = preferences;
        resolve({ preferences });
      });
    }));
    renderSettings();
    fireEvent.click(box("density-compact"));
    fireEvent.click(box("summary-year"));
    // Both show at once; the other summary keeps its own value (no flash back to a default).
    expect(box("density-compact")).toBeChecked();
    expect(box("summary-year")).toBeChecked();
    expect(box("summary-month")).not.toBeChecked();
    // Only the first request is on the wire until it's answered.
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(base44.auth.updatePreferences).toHaveBeenCalledTimes(1);

    await act(async () => answers[0]());
    // The first answer (density only) doesn't undo the pending summary change on screen.
    expect(box("summary-year")).toBeChecked();
    expect(status()).toHaveTextContent("جاري الحفظ…");
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledTimes(2));

    await act(async () => answers[1]());
    expect(status()).toHaveTextContent("تم الحفظ");
    expect(serverPreferences).toMatchObject({ density: "compact", summaries: { month: false, year: true } });
    expect(box("density-compact")).toBeChecked();
    expect(box("summary-year")).toBeChecked();
  });

  it("if an earlier save fails while a later one is pending, the later answer settles the screen", async () => {
    const answers = [];
    base44.auth.updatePreferences.mockImplementation((changes) => new Promise((resolve, reject) => {
      answers.push({ ok: () => resolve({ preferences: (serverPreferences = applyPreferenceChanges(serverPreferences, changes).preferences) }), fail: () => reject(new Error("boom")) });
    }));
    renderSettings();
    fireEvent.click(box("column-note"));
    fireEvent.click(box("density-compact"));
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers[0].fail());
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1].ok());
    // The server never stored the hidden note column: the screen shows exactly what's saved.
    expect(box("column-note")).toBeChecked();
    expect(box("density-compact")).toBeChecked();
    expect(status()).toHaveTextContent("تم الحفظ");
  });
});

describe("Preferences follow the account", () => {
  const Probe = () => <span data-testid="probe">{usePreferences().preferences.density}</span>;

  it("the language saved on the account is applied when that user signs in", () => {
    setAuthRole("user", { preferences: { language: "en" } });
    render(withProviders(<Probe />, "/"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("with no saved language, the browser's choice (cookie) is kept", () => {
    document.cookie = "wmm_lang=en; Path=/";
    setAuthRole("user", { preferences: { language: null } });
    render(withProviders(<Probe />, "/"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("the header language switch also saves the choice while signed in", async () => {
    render(withProviders(<LanguageToggle />, "/"));
    fireEvent.click(screen.getByTestId("language-toggle"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
    await waitFor(() => expect(base44.auth.updatePreferences).toHaveBeenCalledWith({ language: "en" }));
  });

  it("signed out (login page), the switch only changes the language — nothing is sent", async () => {
    setAuthRole(null);
    render(withProviders(<LanguageToggle />, "/"));
    fireEvent.click(screen.getByTestId("language-toggle"));
    expect(document.documentElement).toHaveAttribute("lang", "en");
    await new Promise((r) => setTimeout(r, 20));
    expect(base44.auth.updatePreferences).not.toHaveBeenCalled();
  });

  it("components used without the provider get the defaults", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("comfortable");
  });
});

describe("Header link to Settings", () => {
  it("every role gets a Settings link; on the Settings page it is replaced by a way back", () => {
    setAuthRole("user");
    const { unmount } = render(withProviders(<Header />, "/"));
    const link = screen.getByTestId("settings-link");
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAccessibleName("الإعدادات");
    expect(screen.queryByRole("link", { name: /لوحة التحكم/ })).not.toBeInTheDocument();
    unmount();

    render(withProviders(<Header />, "/settings"));
    expect(screen.queryByTestId("settings-link")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).toHaveAttribute("href", "/");
  });

  it("Admins see both Users and Settings", () => {
    setAuthRole("admin");
    render(withProviders(<Header />, "/"));
    expect(screen.getByRole("link", { name: /المستخدمون/ })).toHaveAttribute("href", "/users");
    expect(screen.getByTestId("settings-link")).toBeInTheDocument();
    // With up to five items, the row must wrap on phones instead of widening the page.
    expect(screen.getByTestId("settings-link").parentElement).toHaveClass("flex-wrap");
    expect(screen.getByTestId("settings-link")).toHaveClass("whitespace-nowrap");
  });
});

describe("The dashboard follows the saved settings", () => {
  const rows = [
    { id: 1, type: "cash_out", amount: 1500, commission: 0, sender_name: "Vicario", receiver_name: "", customer_number: "71389296", service: "W2W", note: "memo", reference_number: "tr:1", transaction_date: "2026-09-23", created_date: "2026-09-23T10:00:00Z" },
    { id: 2, type: "cash_in", amount: 50, commission: 0.5, sender_name: "MOUNIR", receiver_name: "Vicario", customer_number: "", service: "", note: "", reference_number: "tr:2", transaction_date: "2026-09-23", created_date: "2026-09-23T11:00:00Z" },
  ];
  const noop = () => {};
  const renderTable = () => render(withProviders(
    <TransactionsList transactions={rows} allTransactions={rows} loading={false} search="" setSearch={noop}
      selectedDate="2026-09-23" setSelectedDate={noop} onToday={noop} onCashIn={noop} onCashOut={noop}
      onImportPDF={noop} onRefresh={noop} onResetOpeningBalance={noop} onDeleteDailyBalanceForDate={noop} />, "/"));

  it("hidden columns disappear from the table (header and cells); the rest keep their order", () => {
    setAuthRole("admin", { preferences: { hiddenColumns: ["note", "service", "commissionRate"] } });
    const { container } = renderTable();
    const sortable = [...container.querySelectorAll("thead th[aria-sort] button")].map((b) => b.dataset.testid.replace("sort-", ""));
    expect(sortable).toEqual(["index", "type", "sender", "receiver", "amount", "commission", "reference", "date"]);
    expect(screen.queryByText("memo")).not.toBeInTheDocument();
    expect(screen.queryByText("W2W")).not.toBeInTheDocument();
    // Every row still has one cell per header (checkbox + 8 data columns + actions).
    container.querySelectorAll("tbody tr").forEach((tr) => expect(tr.children).toHaveLength(10));
    expect(container.querySelectorAll("thead th")).toHaveLength(10);
  });

  it("compact density tightens the rows", () => {
    setAuthRole("admin", { preferences: { density: "compact" } });
    const { container } = renderTable();
    const table = container.querySelector("table");
    expect(table).toHaveAttribute("data-density", "compact");
    expect(table.className).toContain("[&_td]:!py-1.5");
  });

  it("comfortable (default) keeps the original spacing", () => {
    setAuthRole("admin");
    const { container } = renderTable();
    expect(container.querySelector("table")).toHaveAttribute("data-density", "comfortable");
    expect(container.querySelector("table").className).not.toContain("!py-1.5");
  });

  it("a sort on a column that gets hidden is dropped (back to the journal order)", async () => {
    setAuthRole("admin");
    const { container } = render(withProviders(<>
      <TransactionsList transactions={rows} allTransactions={rows} loading={false} search="" setSearch={noop}
        selectedDate="2026-09-23" setSelectedDate={noop} onToday={noop} onCashIn={noop} onCashOut={noop}
        onImportPDF={noop} onRefresh={noop} onResetOpeningBalance={noop} onDeleteDailyBalanceForDate={noop} />
      <SettingsPage />
    </>, "/"));
    const senders = () => [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[3].textContent);
    fireEvent.click(screen.getByTestId("sort-amount"));
    expect(senders()).toEqual(["MOUNIR", "Vicario"]);
    fireEvent.click(box("column-amount"));
    await waitFor(() => expect(screen.queryByTestId("sort-amount")).not.toBeInTheDocument());
    expect(senders()).toEqual(["Vicario", "MOUNIR"]);
  });

  it("summaries start open or closed as saved", () => {
    setAuthRole("user", { preferences: { summaries: { month: false, year: true } } });
    render(withProviders(<StatsCards netBalance={1} monthlyCount={2} yearlyCount={3} selectedDate="2026-09-23" />, "/"));
    const toggle = (id) => within(screen.getByTestId(id)).getAllByRole("button")[0];
    expect(toggle("monthly-summary")).toHaveAttribute("aria-expanded", "false");
    expect(toggle("yearly-summary")).toHaveAttribute("aria-expanded", "true");
  });
});
