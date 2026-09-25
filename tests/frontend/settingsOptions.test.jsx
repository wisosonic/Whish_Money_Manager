/** @vitest-environment jsdom */
// Settings page layout (tabs) and the newer options — and what each one changes: start-on, clock,
// number style, default sort, rows per page, search scope, notification duration / confirmations.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import Header from "@/components/layout/Header";
import AppToaster from "@/components/layout/AppToaster";
import { LanguageProvider, toArabicDigits } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { applyPreferenceChanges, resolvePreferences } from "@/lib/preferences";
import { TOAST_DURATION, configureNotify, notify } from "@/lib/notify";
import { api } from "@/api/apiClient";
import { setAuthRole } from "./authMock";
import { clearToasts, findToast, toastTexts } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({
  api: {
    auth: { updatePreferences: vi.fn() },
    commissionRates: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    admin: { restorePreview: vi.fn(), restore: vi.fn() },
  },
}));

let serverPreferences;
beforeEach(() => {
  setAuthRole("user");
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
  serverPreferences = resolvePreferences(null);
  api.auth.updatePreferences.mockReset();
  api.auth.updatePreferences.mockImplementation(async (changes) => {
    serverPreferences = applyPreferenceChanges(serverPreferences, changes).preferences;
    return { preferences: serverPreferences };
  });
  api.commissionRates.get.mockResolvedValue({ current: 1, history: [{ rate: 1, effective_from: "2000-01-01", created_by: "system" }] });
});
afterEach(() => {
  cleanup();
  clearToasts();
  configureNotify();
});

const HashProbe = () => <span data-testid="hash">{useLocation().hash}</span>;
const withApp = (ui, { path = "/settings", lang } = {}) => (
  <LanguageProvider initialLang={lang}>
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider>{ui}<HashProbe /><AppToaster /></PreferencesProvider>
    </MemoryRouter>
  </LanguageProvider>
);
const tab = (name) => screen.getByRole("tab", { name });
const saved = (changes) => waitFor(() => expect(api.auth.updatePreferences).toHaveBeenLastCalledWith(changes));

describe("layout: options grouped in tabs", () => {
  it("Admins and Managers also get the Office tab; restoring a backup isn't in Settings (it's in the admin panel)", () => {
    setAuthRole("manager");
    render(withApp(<SettingsPage />, { path: "/settings#backup" }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["عام", "المظهر", "جدول العمليات", "الإشعارات", "المكتب"]);
    // An old link to #backup opens General.
    expect(tab("عام")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("restore-file")).not.toBeInTheDocument();
  });

  it("a User can't open the office tabs, even by link (falls back to General)", () => {
    render(withApp(<SettingsPage />, { path: "/settings#office" }));
    expect(screen.queryByRole("tab", { name: "المكتب" })).not.toBeInTheDocument();
    expect(tab("عام")).toHaveAttribute("aria-selected", "true");
  });

  it("the open tab is in the address (#table), so it can be linked to", () => {
    render(withApp(<SettingsPage />, { path: "/settings#notifications" }));
    expect(tab("الإشعارات")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tab("جدول العمليات"));
    expect(screen.getByTestId("hash")).toHaveTextContent("#table");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "panel-table");
  });

  it("keyboard: arrows move between tabs (wrapping), Home / End jump; only the open tab is in the Tab order", () => {
    render(withApp(<SettingsPage />));
    const general = tab("عام");
    expect(general).toHaveAttribute("tabindex", "0");
    expect(tab("المظهر")).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(general, { key: "ArrowDown" });
    expect(tab("المظهر")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("المظهر"));
    fireEvent.keyDown(tab("المظهر"), { key: "End" });
    expect(tab("الإشعارات")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("الإشعارات"), { key: "ArrowDown" });
    expect(tab("عام")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("عام"), { key: "ArrowUp" });
    expect(tab("الإشعارات")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("الإشعارات"), { key: "Home" });
    expect(tab("عام")).toHaveAttribute("aria-selected", "true");
  });
});

describe("new options are saved", () => {
  it("General: start on, clock, number style", async () => {
    render(withApp(<SettingsPage />));
    fireEvent.click(screen.getByTestId("startOn-today"));
    await saved({ startOn: "today" });
    fireEvent.click(screen.getByTestId("clock-24h"));
    await saved({ clock: "24h" });
    fireEvent.click(screen.getByTestId("clock-hidden"));
    await saved({ clock: "hidden" });
    fireEvent.click(screen.getByTestId("numerals-arabic"));
    await saved({ numerals: "arabic" });
    expect(screen.getByTestId("numerals-arabic")).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "شكل الأرقام" })).toHaveAccessibleDescription(/أرقام الهاتف والعمليات تبقى كما هي/);
  });

  it("Transactions table: default sort (column, then direction), rows per page, search scope", async () => {
    render(withApp(<SettingsPage />, { path: "/settings#table" }));
    // No column → the direction doesn't apply yet.
    expect(screen.getByTestId("defaultSort-asc")).toBeDisabled();
    fireEvent.change(screen.getByTestId("defaultSort-column"), { target: { value: "amount" } });
    await saved({ defaultSort: { key: "amount" } });
    expect(screen.getByTestId("defaultSort-desc")).toBeEnabled();
    fireEvent.click(screen.getByTestId("defaultSort-desc"));
    await saved({ defaultSort: { dir: "desc" } });
    expect(serverPreferences.defaultSort).toEqual({ key: "amount", dir: "desc" });
    fireEvent.change(screen.getByTestId("defaultSort-column"), { target: { value: "" } });
    await saved({ defaultSort: { key: null } });

    fireEvent.click(screen.getByTestId("rowsPerPage-50"));
    await saved({ rowsPerPage: 50 });
    expect(screen.getByTestId("rowsPerPage-0")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("searchScope-day"));
    await saved({ searchScope: "day" });
  });

  it("Notifications: duration and confirmations", async () => {
    render(withApp(<SettingsPage />, { path: "/settings#notifications" }));
    fireEvent.click(screen.getByTestId("toastDuration-long"));
    await saved({ toastDuration: "long" });
    fireEvent.click(screen.getByTestId("toastSuccess"));
    await saved({ toastSuccess: false });
    expect(screen.getByTestId("toastSuccess")).not.toBeChecked();
  });
});

describe("what the options change", () => {
  it("clock: 12-hour by default, 24-hour, or hidden; last login follows it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24, 20, 5, 9));
    const previous = new Date(2026, 8, 23, 21, 30).toISOString();

    setAuthRole("user", { previous_login: previous });
    const { unmount } = render(withApp(<Header />, { path: "/", lang: "en" }));
    expect(screen.getByTestId("header-clock")).toHaveTextContent("08:05:09 PM");
    expect(screen.getByTestId("last-login")).toHaveTextContent("2026/09/23 09:30 PM");
    unmount();

    setAuthRole("user", { previous_login: previous, preferences: { clock: "24h" } });
    const second = render(withApp(<Header />, { path: "/", lang: "en" }));
    expect(screen.getByTestId("header-clock")).toHaveTextContent("20:05:09");
    expect(screen.getByTestId("header-clock")).not.toHaveTextContent("PM");
    expect(screen.getByTestId("last-login")).toHaveTextContent("2026/09/23 21:30");
    second.unmount();

    setAuthRole("user", { preferences: { clock: "hidden" } });
    render(withApp(<Header />, { path: "/", lang: "en" }));
    expect(screen.queryByTestId("header-clock")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("number style: Arabic-Indic digits in Arabic (clock, counts in messages); English keeps Western digits", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24, 20, 5, 9));
    setAuthRole("user", { preferences: { numerals: "arabic" } });
    const { unmount } = render(withApp(<Header />, { path: "/" }));
    expect(screen.getByTestId("header-clock")).toHaveTextContent("PM ٠٨ : ٠٥ : ٠٩");
    expect(screen.getByTestId("header-clock")).toHaveTextContent("٢٠٢٦/٠٩/٢٤");
    unmount();
    render(withApp(<Header />, { path: "/", lang: "en" }));
    expect(screen.getByTestId("header-clock")).toHaveTextContent("08:05:09 PM");
    vi.useRealTimers();
  });

  it("toArabicDigits converts digits and the separators between them", () => {
    expect(toArabicDigits("$1,234.50")).toBe("$١٬٢٣٤٫٥٠");
    expect(toArabicDigits("2026-09-24")).toBe("٢٠٢٦-٠٩-٢٤");
    expect(toArabicDigits("a.b, c")).toBe("a.b, c");
  });

  it("notifications: confirmations can be turned off — warnings and errors still show", async () => {
    setAuthRole("user", { preferences: { toastSuccess: false } });
    render(withApp(null, { path: "/" }));
    act(() => { notify.success("تم الحفظ"); notify.warning("انتبه"); notify.error("خطأ"); });
    await findToast("خطأ");
    await findToast("انتبه");
    expect(toastTexts()).not.toContain("تم الحفظ");
  });

  it("notifications: short / long scale every duration", () => {
    const spy = vi.spyOn(toast, "error");
    configureNotify({ duration: "long" });
    notify.error("x");
    expect(spy).toHaveBeenLastCalledWith("x", { duration: TOAST_DURATION.error * 2 });
    configureNotify({ duration: "short" });
    notify.error("y", { duration: 10000 });
    expect(spy).toHaveBeenLastCalledWith("y", { duration: 5000 });
    spy.mockRestore();
  });

  it("the provider applies the saved notification settings", async () => {
    const spy = vi.spyOn(toast, "warning");
    setAuthRole("user", { preferences: { toastDuration: "long" } });
    render(withApp(null, { path: "/" }));
    act(() => { notify.warning("w"); });
    expect(spy).toHaveBeenLastCalledWith("w", { duration: TOAST_DURATION.warning * 2 });
    spy.mockRestore();
  });
});
