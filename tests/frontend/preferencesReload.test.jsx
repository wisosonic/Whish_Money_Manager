/** @vitest-environment jsdom */
// A page reload: the app starts before the server says who is signed in, then the account arrives
// with its saved settings. Anything that reads a setting once, when it first appears (which summary
// starts open, the start-up day, the default sort, rows per page), must already see the saved value,
// never the defaults. (User-reported: "expand the yearly summary" was lost on reload.)
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatsCards from "@/components/dashboard/StatsCards";
import { useAuth } from "@/lib/AuthContext";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider, usePreferences } from "@/lib/PreferencesContext";
import { setAuthLoading, setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({ api: { auth: { updatePreferences: vi.fn() } } }));

beforeEach(() => {
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
});
afterEach(cleanup);

// Like the app: nothing but a spinner until the session is known, then the page appears at once.
function SignedIn({ children }) {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth || !user) return <p>loading</p>;
  return children;
}

// Records the settings a component sees on its very first render.
const firstSeen = [];
function FirstRender() {
  const { preferences } = usePreferences();
  useState(() => firstSeen.push(preferences));
  return null;
}

const app = (children) => (
  <LanguageProvider>
    <PreferencesProvider><SignedIn>{children}</SignedIn></PreferencesProvider>
  </LanguageProvider>
);
const reload = (children, preferences) => {
  setAuthRole(null);
  setAuthLoading(true); // the session is being checked
  const view = render(app(children));
  setAuthRole("user", { preferences }); // the account arrives
  view.rerender(app(children));
  return view;
};
// The section header button that opens / closes a summary.
const toggle = (id) => screen.getByTestId(id).querySelector("button[aria-expanded]");

describe("saved settings survive a page reload", () => {
  it("the summaries open as saved: yearly expanded, monthly collapsed", () => {
    reload(<StatsCards selectedDate="2026-09-23" />, { summaries: { month: false, year: true } });
    expect(toggle("yearly-summary")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("monthly-summary")).toHaveAttribute("aria-expanded", "false");
  });

  it("the defaults still apply to someone who saved nothing (month open, year closed)", () => {
    reload(<StatsCards selectedDate="2026-09-23" />, null);
    expect(toggle("monthly-summary")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("yearly-summary")).toHaveAttribute("aria-expanded", "false");
  });

  it("every setting read on first display is the saved one, never the default", () => {
    firstSeen.length = 0;
    reload(<FirstRender />, { startOn: "today", searchScope: "day", rowsPerPage: 50, defaultSort: { key: "amount", dir: "desc" }, summaries: { year: true } });
    expect(firstSeen).toHaveLength(1);
    expect(firstSeen[0]).toMatchObject({ startOn: "today", searchScope: "day", rowsPerPage: 50, defaultSort: { key: "amount", dir: "desc" }, summaries: { month: true, year: true } });
  });
});
