/** @vitest-environment jsdom */
// Everything remembered in the browser is in cookies: the helper (src/lib/cookies.js), the settings
// cookie mirrored from the account (wmm_prefs), and moving old localStorage values into cookies.
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIES, ONE_YEAR_SECONDS, cookieAttributes, readCookie, readRemembered, removeCookie, writeCookie } from "@/lib/cookies";
import { useAuth } from "@/lib/AuthContext";
import { LanguageProvider, readLangCookie, writeLangCookie } from "@/lib/i18n";
import { PreferencesProvider, readPreferencesCookie, usePreferences, writePreferencesCookie } from "@/lib/PreferencesContext";
import { TABLE_COLUMNS, applyPreferenceChanges, resolvePreferences } from "@/lib/preferences";
import { api } from "@/api/apiClient";
import { setAuthLoading, setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({ api: { auth: { updatePreferences: vi.fn() } } }));

beforeEach(() => {
  window.localStorage.clear();
  api.auth.updatePreferences.mockImplementation(async (changes) => ({ preferences: applyPreferenceChanges(resolvePreferences(null), changes).preferences }));
});
afterEach(cleanup);

describe("the cookie helper", () => {
  it("writes and reads values (any characters), and removes them", () => {
    writeCookie("wmm_test", 'a;b=c "é" ✓');
    expect(readCookie("wmm_test")).toBe('a;b=c "é" ✓');
    removeCookie("wmm_test");
    expect(readCookie("wmm_test")).toBeNull();
  });

  it("every app cookie lasts a year, for the whole site, SameSite=Lax (Secure over HTTPS)", () => {
    expect(ONE_YEAR_SECONDS).toBe(31536000);
    expect(cookieAttributes()).toBe("; Path=/; Max-Age=31536000; SameSite=Lax"); // jsdom serves http
    expect(cookieAttributes(0)).toContain("Max-Age=0");
  });

  it("a value older versions kept in localStorage is moved into its cookie once, then removed", () => {
    window.localStorage.setItem("selectedDate", "2026-09-20");
    expect(readRemembered(COOKIES.selectedDate, "selectedDate")).toBe("2026-09-20");
    expect(readCookie(COOKIES.selectedDate)).toBe("2026-09-20");
    expect(window.localStorage.getItem("selectedDate")).toBeNull();
    // From now on the cookie is the source.
    writeCookie(COOKIES.selectedDate, "2026-09-21");
    expect(readRemembered(COOKIES.selectedDate, "selectedDate")).toBe("2026-09-21");
  });

  it("the language cookie goes through the same helper and still only accepts ar / en", () => {
    writeLangCookie("en");
    expect(readCookie(COOKIES.lang)).toBe("en");
    expect(readLangCookie()).toBe("en");
    writeCookie(COOKIES.lang, "fr");
    expect(readLangCookie()).toBeNull();
  });
});

describe("the settings cookie (wmm_prefs)", () => {
  function SignedIn({ children }) {
    const { user, isLoadingAuth } = useAuth();
    return isLoadingAuth || !user ? null : children;
  }
  let seen = [];
  function FirstRender() {
    const { preferences } = usePreferences();
    useState(() => seen.push(preferences));
    return null;
  }
  let save;
  function Saver() {
    save = usePreferences().savePreferences;
    return null;
  }
  const app = (children) => <LanguageProvider><PreferencesProvider>{children}</PreferencesProvider></LanguageProvider>;
  beforeEach(() => { seen = []; });

  it("mirrors the signed-in account's settings, and every change, into the cookie", async () => {
    const stored = { rowsPerPage: 25, summaries: { year: true } };
    // The server merges each change into the account's saved settings.
    api.auth.updatePreferences.mockImplementation(async (changes) => ({ preferences: applyPreferenceChanges(resolvePreferences(stored), changes).preferences }));
    setAuthRole("user", { id: 3, preferences: stored });
    render(app(<Saver />));
    expect(readPreferencesCookie()).toMatchObject({ userId: 3, preferences: { rowsPerPage: 25, summaries: { month: true, year: true } } });
    await act(async () => { await save({ clock: "24h" }); });
    expect(readPreferencesCookie().preferences).toMatchObject({ clock: "24h", rowsPerPage: 25 });
  });

  it("applies the cookie's settings as soon as the page loads, before the server answers", () => {
    writePreferencesCookie(3, resolvePreferences({ theme: "dark", rowsPerPage: 100, startOn: "today" }));
    setAuthRole(null);
    setAuthLoading(true);
    render(app(<FirstRender />)); // rendered even while signed out: what the page starts from
    expect(seen[0]).toMatchObject({ theme: "dark", rowsPerPage: 100, startOn: "today" });
  });

  it("the account's copy wins over the cookie when they differ, and replaces it", () => {
    writePreferencesCookie(3, resolvePreferences({ rowsPerPage: 100, summaries: { year: false } }));
    setAuthRole(null);
    setAuthLoading(true);
    const view = render(app(<SignedIn><FirstRender /></SignedIn>));
    setAuthRole("user", { id: 3, preferences: { rowsPerPage: 50, summaries: { year: true } } });
    view.rerender(app(<SignedIn><FirstRender /></SignedIn>));
    expect(seen[0]).toMatchObject({ rowsPerPage: 50, summaries: { year: true } });
    expect(readPreferencesCookie()).toMatchObject({ userId: 3, preferences: { rowsPerPage: 50 } });
  });

  it("another account signing in on this browser gets its own settings, not the cookie's", () => {
    writePreferencesCookie(3, resolvePreferences({ clock: "hidden" }));
    setAuthRole("manager", { id: 9, preferences: null });
    render(app(<FirstRender />));
    expect(seen[0].clock).toBe("12h");
    expect(readPreferencesCookie()).toMatchObject({ userId: 9, preferences: { clock: "12h" } });
  });

  it("a damaged cookie is ignored (defaults)", () => {
    writeCookie(COOKIES.preferences, "{not json");
    expect(readPreferencesCookie()).toBeNull();
    setAuthRole(null);
    render(app(<FirstRender />));
    expect(seen[0]).toEqual(resolvePreferences(null));
  });

  it("stays far below the 4 KB cookie limit, even with every setting changed", () => {
    const busiest = resolvePreferences({
      language: "en", hiddenColumns: TABLE_COLUMNS.slice(1), theme: "system", density: "compact", summaries: { month: false, year: true },
      startOn: "today", searchScope: "day", defaultSort: { key: "commissionRate", dir: "desc" }, clock: "24h", numerals: "arabic",
      toastDuration: "long", toastSuccess: false, rowsPerPage: 100,
    });
    writePreferencesCookie(123456, busiest);
    expect(document.cookie.length).toBeLessThan(2000);
    expect(readPreferencesCookie().preferences).toEqual(busiest);
  });
});
