/** @vitest-environment jsdom */
// `node:` prefix: in the jsdom environment a bare "fs" would be resolved as a browser package.
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_LOGO, APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from "@/lib/branding";
import Header, { formatLastLogin, scrollToTop } from "@/components/layout/Header";
import LoginPage from "@/components/auth/LoginPage";
import { LOGO_CROP_STYLE } from "@/components/layout/AppLogo";
import { authMocks, setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin", { full_name: "Local User" }));
const renderHeader = (path = "/") => render(<MemoryRouter initialEntries={[path]}><Header /></MemoryRouter>);

const root = path.resolve(__dirname, "../..");
const readProjectFile = (file) => fs.readFileSync(path.join(root, file), "utf8");

afterEach(cleanup);

describe("branding constants", () => {
  it("names the app Whish Money Manager and uses the logo from src/assets/images", () => {
    expect(APP_NAME).toBe("Whish Money Manager");
    expect(APP_SHORT_NAME).toBe("Whish Manager");
    expect(APP_TAGLINE).toBe("إدارة الحوالات والمعاملات المالية");
    expect(APP_LOGO).toMatch(/assets\/images\/logo\.png/);
    expect(fs.existsSync(path.join(root, "src/assets/images/logo.png"))).toBe(true);
  });
});

describe("Header (navigation bar)", () => {
  it("shows the logo, app name and tagline", () => {
    renderHeader();
    const logo = screen.getByRole("img", { name: APP_NAME });
    expect(logo).toHaveAttribute("src", APP_LOGO);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Whish Money Manager");
    expect(screen.getByText(APP_TAGLINE)).toBeInTheDocument();
  });

  it("no longer shows the old name", () => {
    renderHeader();
    expect(screen.queryByText("مدير مكتب الحوالات")).not.toBeInTheDocument();
  });

  it("crops the logo to its red square so the PNG's white border never shows", () => {
    renderHeader();
    const frame = screen.getByTestId("app-logo");
    expect(frame).toHaveClass("overflow-hidden", "rounded-[18%]");
    // Red square is x 8–441, y 5–438 of 450×444; cropped 2px further in (430px square from 10,7).
    expect(screen.getByRole("img", { name: APP_NAME })).toHaveStyle({
      width: "104.65%", height: "103.26%", left: "-2.33%", top: "-1.63%",
    });
    expect(LOGO_CROP_STYLE).toEqual({ width: "104.65%", height: "103.26%", left: "-2.33%", top: "-1.63%" });
  });

  it("still shows the user and logs out", () => {
    renderHeader();
    expect(screen.getByText("Local User")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("تسجيل الخروج"));
    expect(authMocks().logout).toHaveBeenCalledTimes(1);
  });
});

describe("Header — sticky while scrolling", () => {
  // jsdom has no layout; tests fake offsetHeight and must put jsdom's own getter back afterwards.
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const restoreOffsetHeight = () => Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);

  it("is a page header landmark that sticks to the top", () => {
    renderHeader();
    const header = screen.getByRole("banner");
    expect(header).toBe(screen.getByTestId("app-header"));
    expect(header.tagName).toBe("HEADER");
    expect(header).toHaveClass("sticky", "top-0");
  });

  it("sits above page content but below modals (z-40 < z-50), with an opaque background", () => {
    renderHeader();
    const header = screen.getByTestId("app-header");
    expect(header).toHaveClass("z-40", "bg-gradient-to-l", "from-gray-900", "to-slate-800");
    // Every modal in the app is a fixed overlay at z-50.
    const modalSources = ["transactions/ImportPDFModal.jsx", "transactions/BulkEditModal.jsx", "dashboard/MonthlyChartModal.jsx"]
      .map((file) => readProjectFile(`src/components/${file}`));
    modalSources.forEach((source) => expect(source).toMatch(/fixed inset-0[^"]*z-50/));
  });

  it("publishes its height so focused/anchored elements stop below it", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.dataset.testid === "app-header" ? 92 : 0; } });
    try {
      const { unmount } = renderHeader();
      expect(document.documentElement.style.getPropertyValue("--app-header-height")).toBe("92px");
      unmount();
      expect(document.documentElement.style.getPropertyValue("--app-header-height")).toBe("");
    } finally {
      restoreOffsetHeight();
    }
  });

  it("updates the published height when the header wraps (e.g. on a phone)", () => {
    let resize;
    const OriginalObserver = window.ResizeObserver;
    window.ResizeObserver = class { constructor(cb) { resize = cb; } observe() {} disconnect() {} };
    let height = 92;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.dataset.testid === "app-header" ? height : 0; } });
    try {
      renderHeader();
      expect(document.documentElement.style.getPropertyValue("--app-header-height")).toBe("92px");
      height = 144;
      resize();
      expect(document.documentElement.style.getPropertyValue("--app-header-height")).toBe("144px");
    } finally {
      window.ResizeObserver = OriginalObserver;
      restoreOffsetHeight();
    }
  });

  it("the stylesheet reserves that height when scrolling things into view", () => {
    const css = readProjectFile("src/assets/css/index.css");
    expect(css).toMatch(/scroll-padding-top:\s*calc\(var\(--app-header-height, 0px\) \+ 0\.5rem\)/);
  });
});

describe("Header — logo and name scroll back to the top", () => {
  let scrollSpy;
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => {
    scrollSpy.mockRestore();
    window.matchMedia = originalMatchMedia;
  });

  const button = () => screen.getByTestId("scroll-to-top");

  it("the logo and the app name are one clickable button", () => {
    renderHeader();
    expect(button().tagName).toBe("BUTTON");
    expect(button()).toHaveAttribute("type", "button");
    expect(button()).toContainElement(screen.getByTestId("app-logo"));
    expect(button()).toHaveTextContent("Whish Money Manager");
    expect(button()).toHaveAttribute("title", "العودة إلى أعلى الصفحة");
    expect(button()).toHaveClass("cursor-pointer", "focus-visible:ring-2");
  });

  it("stays the page heading (the button sits inside the <h1>)", () => {
    renderHeader();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toContainElement(button());
    expect(heading).toHaveTextContent("Whish Money Manager");
  });

  it("clicking smoothly scrolls the page to the top", () => {
    renderHeader();
    fireEvent.click(button());
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("jumps instantly for users who prefer reduced motion", () => {
    window.matchMedia = (query) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} });
    renderHeader();
    fireEvent.click(button());
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("is keyboard-focusable (as a native <button>, Enter/Space activate it)", () => {
    renderHeader();
    button().focus();
    expect(button()).toHaveFocus();
    // A native <button> turns Enter/Space into a click.
    fireEvent.click(button());
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("scrolls without navigating away (also on the Users page)", () => {
    renderHeader("/users");
    fireEvent.click(button());
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).toBeInTheDocument(); // still on /users
  });

  it("scrollToTop can be called directly", () => {
    scrollToTop();
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});

describe("Header — last login", () => {
  // Built from local time parts so the expected text doesn't depend on the machine's time zone.
  const previous = new Date(2026, 8, 23, 20, 5).toISOString(); // 23 Sep 2026, 8:05 PM local

  it("shows the previous sign-in's date and time", () => {
    setAuthRole("manager", { previous_login: previous, last_login: new Date().toISOString() });
    renderHeader();
    expect(screen.getByTestId("last-login")).toHaveTextContent("آخر دخول: 2026/09/23 08:05 PM");
  });

  it("does not show the current time or today's date (the old behaviour)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24, 9, 30));
    try {
      setAuthRole("manager", { previous_login: previous });
      renderHeader();
      const label = screen.getByTestId("last-login").textContent;
      expect(label).not.toContain("2026/09/24");
      expect(label).not.toContain("09:30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the date left-to-right inside the Arabic label", () => {
    setAuthRole("user", { previous_login: previous });
    renderHeader();
    const date = screen.getByText("2026/09/23 08:05 PM");
    expect(date).toHaveAttribute("dir", "ltr");
  });

  it("says it's the first sign-in when there is no previous one", () => {
    setAuthRole("user", { previous_login: null });
    renderHeader();
    expect(screen.getByTestId("last-login")).toHaveTextContent("أول تسجيل دخول");
  });
});

describe("formatLastLogin", () => {
  it("formats local date and 12-hour time with AM/PM", () => {
    expect(formatLastLogin(new Date(2026, 0, 5, 0, 7).toISOString())).toBe("2026/01/05 12:07 AM");
    expect(formatLastLogin(new Date(2026, 0, 5, 12, 0).toISOString())).toBe("2026/01/05 12:00 PM");
    expect(formatLastLogin(new Date(2026, 11, 31, 23, 59).toISOString())).toBe("2026/12/31 11:59 PM");
    expect(formatLastLogin(new Date(2026, 5, 1, 9, 3).toISOString())).toBe("2026/06/01 09:03 AM");
  });

  it("returns an empty string for missing or invalid values", () => {
    expect(formatLastLogin(null)).toBe("");
    expect(formatLastLogin("not a date")).toBe("");
  });
});

describe("Header — role and navigation", () => {
  it("shows the signed-in user's role", () => {
    renderHeader();
    expect(screen.getByTestId("role-badge")).toHaveTextContent("Admin");
  });

  it("Admins get a link to the Users page, and back to the dashboard from there", () => {
    renderHeader("/");
    expect(screen.getByRole("link", { name: /المستخدمون/ })).toHaveAttribute("href", "/users");
    cleanup();
    renderHeader("/users");
    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).toHaveAttribute("href", "/");
  });

  it.each(["manager", "user"])("%s: no Users link", (role) => {
    setAuthRole(role);
    renderHeader();
    expect(screen.queryByRole("link", { name: /المستخدمون/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("role-badge")).toHaveTextContent(role === "manager" ? "Manager" : "User");
  });
});

describe("LoginPage", () => {
  it("shows the logo and app name above the login form", () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByRole("img", { name: APP_NAME })).toHaveAttribute("src", APP_LOGO);
    expect(screen.getByText("Whish Money Manager")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
  });

  it("has no pre-filled or hinted credentials and signs in with what the user typed", async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByLabelText("البريد الإلكتروني")).toHaveValue("");
    expect(screen.getByLabelText("كلمة المرور")).toHaveValue("");
    expect(screen.getByLabelText("كلمة المرور")).toHaveAttribute("type", "password");
    expect(screen.queryByText("admin / admin", { exact: false })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "owner@shop.test" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await waitFor(() => expect(authMocks().login).toHaveBeenCalledWith("owner@shop.test", "secret-pass"));
  });

  it("shows the server's error on a failed sign-in", async () => {
    authMocks().login.mockRejectedValue(new Error("Invalid email or password"));
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "a@b.cd" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });
});

describe("browser tab and web app manifest", () => {
  const html = readProjectFile("index.html");

  it("sets the tab title", () => {
    expect(html).toMatch(/<title>Whish Money Manager<\/title>/);
    expect(html).not.toMatch(/Base44 APP/);
  });

  it("uses the local logo as the tab and home-screen icon", () => {
    expect(html).toMatch(/<link rel="icon" type="image\/png" href="\/src\/assets\/images\/logo\.png"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/src\/assets\/images\/logo\.png"/);
    expect(html).not.toMatch(/base44\.com\/logo/);
  });

  it("names the installed app in the manifest", () => {
    const manifest = JSON.parse(readProjectFile("public/manifest.json"));
    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.short_name).toBe(APP_SHORT_NAME);
  });
});
