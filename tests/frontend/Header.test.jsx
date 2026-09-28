/** @vitest-environment jsdom */
// The header bar (user's request, 2026-09-28): logo + clock at the start, every page in the middle
// with the current one marked, Settings and the account menu (details, profile, Log out) at the end.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "@/components/layout/Header";
import { LanguageProvider } from "@/lib/i18n";
import { authMocks, setAuthRole } from "./authMock";
import { openUserMenu } from "./headerHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
beforeEach(() => setAuthRole("admin", { full_name: "Maya Admin", previous_login: null }));
afterEach(cleanup);

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const renderHeader = (path = "/", lang) => render(
  <LanguageProvider initialLang={lang}>
    <MemoryRouter initialEntries={[path]}>
      <Header />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  </LanguageProvider>
);
const nav = () => screen.getByTestId("header-nav");
const menuButton = () => screen.getByTestId("user-menu-button");
const items = () => within(screen.getByTestId("user-menu")).getAllByRole("menuitem");

describe("layout", () => {
  it("start: the logo then the clock; middle: the pages; end: Settings then the account menu", () => {
    renderHeader();
    const start = screen.getByTestId("header-start");
    expect([...start.children].map((el) => el.tagName === "H1" ? "logo" : el.dataset.testid)).toEqual(["logo", "header-clock"]);
    const bar = screen.getByTestId("app-header");
    expect([...bar.children].map((el) => el.dataset.testid)).toEqual(["header-start", "header-nav", "header-end"]);
    const end = screen.getByTestId("header-end");
    expect(within(end).getByTestId("settings-link")).toBeInTheDocument();
    expect(within(end).getByTestId("user-menu-button")).toBeInTheDocument();
    expect(end).toHaveClass("ms-auto"); // pushed to the end of the line
    expect(nav()).toHaveAttribute("aria-label", "القائمة الرئيسية");
  });

  it("there is no separate Log out button any more; it's in the account menu", () => {
    renderHeader();
    expect(screen.queryByTestId("logout-button")).not.toBeInTheDocument();
    expect(screen.queryByText("خروج")).not.toBeInTheDocument();
    openUserMenu();
    expect(within(screen.getByTestId("user-menu")).getByTestId("logout-button")).toHaveTextContent("خروج");
  });

  it("the pages row takes its own line on narrow screens and sits between the ends from lg", () => {
    renderHeader();
    expect(nav()).toHaveClass("order-last", "w-full", "flex-wrap", "lg:order-none", "lg:flex-1");
  });
});

describe("every page is always listed, the current one marked", () => {
  const pages = ["dashboard-link", "users-link", "stores-link", "admin-link"];

  it.each([
    ["/", "dashboard-link"],
    ["/users", "users-link"],
    ["/stores", "stores-link"],
    ["/stores/2", "stores-link"],
    ["/admin", "admin-link"],
    ["/settings", null],
    ["/profile", null],
  ])("on %s", (path, current) => {
    renderHeader(path);
    // The Admin sees all four pages, whatever page is open.
    expect(within(nav()).getAllByRole("link").map((a) => a.dataset.testid)).toEqual(pages);
    const marked = within(nav()).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(marked.map((a) => a.dataset.testid)).toEqual(current ? [current] : []);
    if (current) {
      // Not colour alone: outlined and bold as well as tinted.
      expect(screen.getByTestId(current)).toHaveClass("ring-1", "font-semibold");
      pages.filter((p) => p !== current).forEach((p) => expect(screen.getByTestId(p)).not.toHaveClass("ring-1"));
    }
    expect(screen.getByTestId("settings-link").getAttribute("aria-current")).toBe(path === "/settings" ? "page" : null);
  });

  it("a User sees only the pages they may open", () => {
    setAuthRole("user");
    renderHeader("/");
    expect(within(nav()).getAllByRole("link").map((a) => a.dataset.testid)).toEqual(["dashboard-link", "stores-link"]);
    expect(screen.getByTestId("stores-link")).toHaveTextContent("متجري");
  });

  it("a Manager: dashboard, their store and the admin panel (no Users)", () => {
    setAuthRole("manager");
    renderHeader("/admin");
    expect(within(nav()).getAllByRole("link").map((a) => a.dataset.testid)).toEqual(["dashboard-link", "stores-link", "admin-link"]);
    expect(screen.getByTestId("admin-link")).toHaveAttribute("aria-current", "page");
  });
});

describe("the account menu", () => {
  it("is an icon button that opens a menu with who is signed in, the profile and Log out", () => {
    setAuthRole("manager", { full_name: "Omar Manager", previous_login: new Date(2026, 8, 23, 20, 5).toISOString() });
    renderHeader();
    const button = menuButton();
    expect(button).toHaveAccessibleName("قائمة الحساب: Omar Manager");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.textContent).toBe(""); // an icon only
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);
    const menu = screen.getByRole("menu", { name: "قائمة الحساب: Omar Manager" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", menu.id);
    const identity = screen.getByTestId("user-menu-identity");
    expect(identity).toHaveTextContent("Omar Manager");
    expect(identity).toHaveTextContent("manager@test.local");
    expect(screen.getByTestId("role-badge")).toHaveTextContent("مدير");
    expect(screen.getByTestId("store-badge")).toHaveTextContent("Main store");
    expect(screen.getByTestId("last-login")).toHaveTextContent("آخر دخول: 2026/09/23 08:05 PM");
    expect(items().map((item) => item.textContent)).toEqual(["ملفي الشخصي", "خروج"]);
  });

  it("opening puts focus on the first item; ↑ ↓ Home End move and wrap", () => {
    renderHeader();
    fireEvent.click(menuButton());
    const [profile, logout] = items();
    expect(profile).toHaveFocus();
    fireEvent.keyDown(profile, { key: "ArrowDown" });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(logout, { key: "ArrowDown" });
    expect(profile).toHaveFocus(); // wraps
    fireEvent.keyDown(profile, { key: "ArrowUp" });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(logout, { key: "Home" });
    expect(profile).toHaveFocus();
    fireEvent.keyDown(profile, { key: "End" });
    expect(logout).toHaveFocus();
  });

  it("↓ on the button opens it on the first item, ↑ on the last", () => {
    renderHeader();
    fireEvent.keyDown(menuButton(), { key: "ArrowDown" });
    expect(items()[0]).toHaveFocus();
    fireEvent.keyDown(items()[0], { key: "Escape" });
    fireEvent.keyDown(menuButton(), { key: "ArrowUp" });
    expect(items()[1]).toHaveFocus();
  });

  it("Escape closes it and gives focus back to the button; Tab closes it", () => {
    renderHeader();
    fireEvent.click(menuButton());
    fireEvent.keyDown(items()[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menuButton());
    fireEvent.keyDown(items()[0], { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a click elsewhere, or on the button again, closes it", () => {
    renderHeader();
    fireEvent.click(menuButton());
    fireEvent.mouseDown(screen.getByTestId("header-nav"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(menuButton());
    fireEvent.mouseDown(screen.getByTestId("user-menu-identity")); // inside: stays open
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(menuButton());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("My profile opens the profile page and closes the menu", () => {
    renderHeader("/");
    openUserMenu();
    fireEvent.click(screen.getByTestId("profile-link"));
    expect(screen.getByTestId("where")).toHaveTextContent("/profile");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Log out signs out and closes the menu", () => {
    renderHeader();
    openUserMenu();
    fireEvent.click(screen.getByTestId("logout-button"));
    expect(authMocks().logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("with no name, the email names the button and heads the menu (shown once)", () => {
    setAuthRole("user", { full_name: "" });
    renderHeader();
    expect(menuButton()).toHaveAccessibleName("قائمة الحساب: user@test.local");
    openUserMenu();
    expect(screen.getByTestId("user-menu-identity").textContent.match(/user@test\.local/g)).toHaveLength(1);
  });

  it("the menu opens toward the inside of the page, in both directions (logical end-0)", () => {
    renderHeader();
    openUserMenu();
    expect(screen.getByTestId("user-menu")).toHaveClass("end-0", "top-full");
    cleanup();
    renderHeader("/", "en");
    openUserMenu();
    expect(screen.getByTestId("user-menu")).toHaveClass("end-0");
  });

  it("in English", () => {
    renderHeader("/profile", "en");
    expect(menuButton()).toHaveAccessibleName("Account menu: Maya Admin");
    openUserMenu();
    expect(items().map((item) => item.textContent)).toEqual(["My profile", "Log out"]);
    expect(screen.getByTestId("profile-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("last-login")).toHaveTextContent("First sign-in");
    expect(screen.getByRole("navigation", { name: "Main menu" })).toBeInTheDocument();
  });
});
