/** @vitest-environment jsdom */
// Dark mode (Settings → Display → Theme): applying it, following the device, the pre-paint script,
// the stylesheet's dark mappings, and the chart's dark palette.
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import { CHART_INK, CHART_SERIES } from "@/components/reports/IncomeChart";
import ChartHarness from "./chartHarness";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider, usePreferences } from "@/lib/PreferencesContext";
import { applyPreferenceChanges, resolvePreferences } from "@/lib/preferences";
import { api } from "@/api/apiClient";
import { setAuthLoading, setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({ api: { auth: { updatePreferences: vi.fn() } } }));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }) => <div>{cloneElement(children, { width: 800, height: typeof height === "number" ? height : 400 })}</div>,
  };
});

const root = document.documentElement;
const originalMatchMedia = window.matchMedia;

// A controllable prefers-color-scheme query.
const deviceTheme = (dark) => {
  const listeners = new Set();
  const query = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  window.matchMedia = (q) => (q.includes("prefers-color-scheme") ? query : { matches: q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} });
  return {
    set: (value) => { query.matches = value; listeners.forEach((fn) => fn()); },
    listenerCount: () => listeners.size,
  };
};

let serverPreferences;
beforeEach(() => {
  root.classList.remove("dark");
  root.style.colorScheme = "";
  document.cookie = "wmm_theme=; Max-Age=0; Path=/";
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
  setAuthRole("user");
  serverPreferences = resolvePreferences(null);
  api.auth.updatePreferences.mockReset();
  api.auth.updatePreferences.mockImplementation(async (changes) => {
    serverPreferences = applyPreferenceChanges(serverPreferences, changes).preferences;
    return { preferences: serverPreferences };
  });
});
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

const withProviders = (ui) => (
  <LanguageProvider><MemoryRouter><PreferencesProvider>{ui}</PreferencesProvider></MemoryRouter></LanguageProvider>
);
const Probe = () => <span data-testid="probe">{String(usePreferences().isDark)}</span>;

describe("theme preference", () => {
  it("the default is light: no dark class", () => {
    render(withProviders(<Probe />));
    expect(root).not.toHaveClass("dark");
    expect(root.style.colorScheme).toBe("light");
    expect(screen.getByTestId("probe")).toHaveTextContent("false");
  });

  it("a user whose saved theme is dark gets it at sign-in, with dark form controls and the cookie mirror", () => {
    setAuthRole("user", { preferences: { theme: "dark" } });
    render(withProviders(<Probe />));
    expect(root).toHaveClass("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(document.cookie).toContain("wmm_theme=dark");
    expect(screen.getByTestId("probe")).toHaveTextContent("true");
  });

  it("choosing Dark / Light / Match system on the Settings page applies at once and saves", async () => {
    const device = deviceTheme(true);
    render(withProviders(<SettingsPage />));
    fireEvent.click(screen.getByRole("tab", { name: "المظهر" })); // the Appearance tab
    expect(screen.getByRole("radiogroup", { name: "السمة" })).toBeInTheDocument();
    expect(screen.getByTestId("theme-light")).toBeChecked();

    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(root).toHaveClass("dark");
    await waitFor(() => expect(api.auth.updatePreferences).toHaveBeenCalledWith({ theme: "dark" }));

    fireEvent.click(screen.getByTestId("theme-light"));
    expect(root).not.toHaveClass("dark");

    fireEvent.click(screen.getByTestId("theme-system"));
    expect(root).toHaveClass("dark"); // the device is in dark mode
    await waitFor(() => expect(serverPreferences.theme).toBe("system"));
    expect(document.cookie).toContain("wmm_theme=system");
    expect(device.listenerCount()).toBe(1);
  });

  it("'Match system' follows the device when it switches, and stops listening when changed", () => {
    const device = deviceTheme(false);
    setAuthRole("user", { preferences: { theme: "system" } });
    const { unmount } = render(withProviders(<Probe />));
    expect(root).not.toHaveClass("dark");
    act(() => device.set(true));
    expect(root).toHaveClass("dark");
    expect(screen.getByTestId("probe")).toHaveTextContent("true");
    act(() => device.set(false));
    expect(root).not.toHaveClass("dark");
    unmount();
    expect(device.listenerCount()).toBe(0);
  });

  it("while the session is still being checked, the theme set before the first paint is left alone", () => {
    root.classList.add("dark");
    setAuthRole(null);
    setAuthLoading(true);
    render(withProviders(<Probe />));
    expect(root).toHaveClass("dark");
  });

  it("signed out, nothing is written to the theme cookie", () => {
    setAuthRole(null);
    render(withProviders(<Probe />));
    expect(document.cookie).not.toContain("wmm_theme=");
  });
});

describe("index.html applies the theme before the first paint", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const run = () => new Function(inlineScript)();

  it.each([
    ["dark", false, true],
    ["system", true, true],
    ["system", false, false],
    ["light", true, false],
  ])("wmm_theme=%s with the device dark=%s → dark class %s", (theme, deviceDark, expected) => {
    deviceTheme(deviceDark);
    document.cookie = `wmm_theme=${theme}; Path=/`;
    run();
    expect(root.classList.contains("dark")).toBe(expected);
    if (expected) expect(root.style.colorScheme).toBe("dark");
  });

  it("no cookie: stays light", () => {
    run();
    expect(root).not.toHaveClass("dark");
  });
});

describe("dark stylesheet", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../src/assets/css/index.css"), "utf8");
  const darkLayer = css.slice(css.indexOf("/* ═══ Dark mode"));
  const escape = (cls) => cls.replace(/[:/]/g, (c) => `\\${c}`);

  // Every light surface / text / border / tint class the screens use must have a dark mapping,
  // otherwise that element would stay light (or unreadable) in dark mode.
  const LIGHT_CLASS = /(?<![\w-])(?:hover:|disabled:)?(?:bg-(?:white|gray-\d+|(?:blue|green|red|orange|yellow|amber|purple|indigo)-(?:50|100))|text-(?:gray-\d+|(?:blue|green|red|orange|yellow|amber|purple|indigo)-(?:500|600|700|800))|border-(?:gray-\d+|(?:blue|green|red|orange|yellow|amber|purple|indigo)-(?:200|300)))(?:\/\d+)?(?![\w-])/g;
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "ui") walk(full); } else if (/\.jsx$/.test(entry.name)) files.push(full);
  });
  walk(path.resolve(__dirname, "../../src"));
  // Always-dark screens (header, login page, language switch) don't need mappings.
  const alwaysDark = ["Header.jsx", "LoginPage.jsx", "LanguageToggle.jsx", "AppLogo.jsx"];

  it("maps every light colour class used by the screens", () => {
    const used = new Set();
    files.filter((f) => !alwaysDark.includes(path.basename(f)))
      .forEach((f) => (fs.readFileSync(f, "utf8").match(LIGHT_CLASS) || []).forEach((c) => used.add(c)));
    const missing = [...used].filter((cls) => !darkLayer.includes(`.${escape(cls)}`));
    expect(used.size).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  // Hard-coded colours (bg-[#F3F5FA] …) aren't caught above: each one needs its own dark mapping.
  // The edit window's grey panel stayed light in dark mode before this check existed.
  it("maps every hard-coded colour class (bg-[#…], text-[#…], border-[#…]) used by the screens", () => {
    const ARBITRARY = /(?<![\w-])(?:hover:)?(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\](?![\w-])/g;
    const used = new Set();
    files.filter((f) => !alwaysDark.includes(path.basename(f)))
      .forEach((f) => (fs.readFileSync(f, "utf8").match(ARBITRARY) || []).forEach((c) => used.add(c)));
    const escapeArbitrary = (cls) => cls.replace(/[:[\]#]/g, (c) => `\\${c}`);
    const missing = [...used].filter((cls) => !darkLayer.includes(`.dark .${escapeArbitrary(cls)}`));
    expect(used).toContain("bg-[#F3F5FA]");
    expect(missing).toEqual([]);
  });

  it("keeps the language switch knob white (theme-fixed)", () => {
    expect(darkLayer).toContain(".dark .bg-white:not(.theme-fixed)");
    const toggle = fs.readFileSync(path.resolve(__dirname, "../../src/components/layout/LanguageToggle.jsx"), "utf8");
    expect(toggle).toMatch(/theme-fixed[^"`]*bg-white/);
  });

  it("the theme variables have a dark (slate) palette", () => {
    expect(css).toMatch(/\.dark \{[\s\S]*--background: 222\.2 47\.4% 11\.2%;/);
  });
});

describe("chart in dark mode", () => {
  const transactions = [
    { id: 1, transaction_date: "2026-06-06", type: "cash_in", amount: 1000, commission: 10 },
    { id: 2, transaction_date: "2026-06-07", type: "cash_out", amount: 400, commission: 0 },
  ];
  const renderChart = () => render(withProviders(<ChartHarness allTransactions={transactions} selectedDate="2026-09-23" />));

  it("uses the dark palette (validated against the dark card) and light inks for axes", () => {
    deviceTheme(false);
    setAuthRole("user", { preferences: { theme: "dark" } });
    renderChart();
    const chart = screen.getByTestId("monthly-chart");
    chart.querySelectorAll(".recharts-bar-rectangle path").forEach((bar) => expect(bar).toHaveAttribute("fill", CHART_SERIES.profit.darkColor));
    const curves = [...chart.querySelectorAll(".recharts-line-curve")].map((c) => c.getAttribute("stroke"));
    expect(curves).toEqual([CHART_SERIES.cashIn.darkColor, CHART_SERIES.cashOut.darkColor]);
    expect(chart.querySelector(".recharts-cartesian-axis-tick-value")).toHaveAttribute("fill", CHART_INK.dark.tick);
  });

  it("keeps the original colours in light mode", () => {
    deviceTheme(false);
    renderChart();
    const curves = [...screen.getByTestId("monthly-chart").querySelectorAll(".recharts-line-curve")].map((c) => c.getAttribute("stroke"));
    expect(curves).toEqual([CHART_SERIES.cashIn.color, CHART_SERIES.cashOut.color]);
  });

  it("dark colours are the validated set", () => {
    expect([CHART_SERIES.profit.darkColor, CHART_SERIES.cashIn.darkColor, CHART_SERIES.cashOut.darkColor]).toEqual(["#3b82f6", "#16a34a", "#ec4899"]);
  });
});
