/** @vitest-environment jsdom */
// The 404 and 500 pages (user's request, 2026-09-29): unknown addresses show the 404 page; any
// server error (a 5xx answer, or no answer) sends the app to the 500 page, which can go back to
// the page that failed; a screen that crashes shows the 500 page instead of a blank page.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedApp, ServerErrorRedirect } from "@/App";
import { SERVER_ERROR_EVENT, SERVER_UNREACHABLE, api } from "@/api/apiClient";
import AppErrorBoundary from "@/components/layout/AppErrorBoundary";
import { LanguageProvider } from "@/lib/i18n";
import NotFoundPage from "@/pages/NotFoundPage";
import ServerErrorPage from "@/pages/ServerErrorPage";
import { authMocks, setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
// The dashboard isn't under test here: a stand-in keeps AuthenticatedApp light.
vi.mock("@/pages/Dashboard", () => ({ default: () => <p>dashboard</p> }));

beforeEach(() => setAuthRole("admin"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const Where = () => {
  const { pathname, state } = useLocation();
  return <span data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname}</span>;
};
const renderAt = (path, ui, lang) => render(
  <LanguageProvider initialLang={lang}>
    <MemoryRouter initialEntries={[path]}>{ui}<Where /></MemoryRouter>
  </LanguageProvider>
);
const serverError = (status) => act(() => { window.dispatchEvent(new CustomEvent(SERVER_ERROR_EVENT, { detail: { status } })); });

describe("the API client reports server errors", () => {
  const response = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

  it("a 5xx answer fires the event (with the status) and still throws the server's message", async () => {
    const heard = vi.fn();
    window.addEventListener(SERVER_ERROR_EVENT, heard);
    vi.stubGlobal("fetch", vi.fn(async () => response(500, { error: "Something went wrong on the server" })));
    await expect(api.stores.list()).rejects.toMatchObject({ status: 500, message: "Something went wrong on the server" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].detail).toEqual({ status: 500, path: "/stores" });
    window.removeEventListener(SERVER_ERROR_EVENT, heard);
  });

  it("no answer at all fires it with status 0 and throws 'The server can't be reached'", async () => {
    const heard = vi.fn();
    window.addEventListener(SERVER_ERROR_EVENT, heard);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api.stores.list()).rejects.toMatchObject({ status: 0, message: SERVER_UNREACHABLE });
    expect(heard.mock.calls[0][0].detail.status).toBe(0);
    window.removeEventListener(SERVER_ERROR_EVENT, heard);
  });

  it("4xx answers (a refused save, a 404 record, a 401) don't", async () => {
    const heard = vi.fn();
    window.addEventListener(SERVER_ERROR_EVENT, heard);
    for (const status of [400, 403, 404, 409, 423]) {
      vi.stubGlobal("fetch", vi.fn(async () => response(status, { error: "nope" })));
      await expect(api.stores.list()).rejects.toMatchObject({ status });
    }
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(SERVER_ERROR_EVENT, heard);
  });
});

describe("going to the 500 page", () => {
  it("any server error opens /500, remembering the page it came from", async () => {
    renderAt("/admin?x=1", <><ServerErrorRedirect /><AuthenticatedApp /></>);
    serverError(503);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/500"));
    expect(JSON.parse(screen.getByTestId("where").dataset.state)).toEqual({ from: "/admin?x=1", reason: "server" });
    expect(screen.getByTestId("server-error-page")).toHaveTextContent("500");
    expect(screen.getByRole("heading", { name: "حدث خطأ ما" })).toBeInTheDocument();
    expect(screen.getByTestId("server-error-page")).toHaveTextContent("لم يتمكن الخادم من إتمام الطلب الأخير");
  });

  it("no answer says the server can't be reached", async () => {
    renderAt("/", <><ServerErrorRedirect /><AuthenticatedApp /></>);
    serverError(0);
    expect(await screen.findByText(/تعذّر الوصول إلى الخادم/)).toBeInTheDocument();
  });

  it("another error while on the 500 page stays there (no loop, the page it came from is kept)", async () => {
    renderAt("/stores", <><ServerErrorRedirect /><AuthenticatedApp /></>);
    serverError(500);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/500"));
    window.history.replaceState(null, "", "/500"); // what the browser's address shows on the real page
    serverError(500);
    expect(JSON.parse(screen.getByTestId("where").dataset.state).from).toBe("/stores");
    window.history.replaceState(null, "", "/");
  });

  it("the 500 page shows signed out too (the session check itself may be what failed)", () => {
    setAuthRole(null);
    renderAt("/500", <AuthenticatedApp />);
    expect(screen.getByTestId("server-error-page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "تسجيل الدخول" })).not.toBeInTheDocument();
  });
});

describe("the 500 page's buttons", () => {
  const at500 = (state) => render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[{ pathname: "/500", state }]}>
        <Routes><Route path="/500" element={<ServerErrorPage />} /><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </LanguageProvider>
  );

  it("'Try again' goes back to the page that failed; 'Back to the dashboard' to /", async () => {
    at500({ from: "/imports", reason: "server" });
    fireEvent.click(screen.getByTestId("server-error-retry"));
    expect(await screen.findByTestId("where")).toHaveTextContent("/imports");
    cleanup();
    at500({ from: "/imports", reason: "server" });
    fireEvent.click(screen.getByTestId("server-error-home"));
    expect(await screen.findByTestId("where")).toHaveTextContent("/");
  });

  it("signed out, 'Try again' asks the server again who is signed in", () => {
    setAuthRole(null);
    at500({ from: "/", reason: "server" });
    fireEvent.click(screen.getByTestId("server-error-retry"));
    expect(authMocks().checkUserAuth).toHaveBeenCalledTimes(1);
  });

  it("signed in, it doesn't need to", () => {
    at500({ from: "/", reason: "server" });
    fireEvent.click(screen.getByTestId("server-error-retry"));
    expect(authMocks().checkUserAuth).not.toHaveBeenCalled();
  });

  it("opened directly (no page to go back to), 'Try again' goes to the dashboard", async () => {
    at500(undefined);
    fireEvent.click(screen.getByTestId("server-error-retry"));
    expect(await screen.findByTestId("where")).toHaveTextContent("/");
  });

  it("in English", () => {
    render(<LanguageProvider initialLang="en"><MemoryRouter><ServerErrorPage reason="unreachable" /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText(/The server can't be reached/)).toBeInTheDocument();
    expect(screen.getByTestId("server-error-retry")).toHaveTextContent("Try again");
    expect(screen.getByTestId("server-error-home")).toHaveTextContent("Back to the dashboard");
  });
});

describe("a screen that crashes", () => {
  const Broken = () => { throw new Error("boom"); };

  it("shows the 500 page ('crash') instead of a blank page; 'Try again' renders it again", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    const Maybe = () => (broken ? <Broken /> : <p>fixed</p>);
    try {
      render(<LanguageProvider><MemoryRouter><AppErrorBoundary resetKey="/"><Maybe /></AppErrorBoundary></MemoryRouter></LanguageProvider>);
      expect(screen.getByTestId("server-error-page")).toHaveTextContent("واجهت هذه الصفحة مشكلة غير متوقعة");
      broken = false;
      fireEvent.click(screen.getByTestId("server-error-retry"));
      expect(screen.getByText("fixed")).toBeInTheDocument();
    } finally {
      log.mockRestore();
    }
  });

  it("moving to another page clears the error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = render(<LanguageProvider><MemoryRouter><AppErrorBoundary resetKey="/a"><Broken /></AppErrorBoundary></MemoryRouter></LanguageProvider>);
      expect(screen.getByTestId("server-error-page")).toBeInTheDocument();
      rerender(<LanguageProvider><MemoryRouter><AppErrorBoundary resetKey="/b"><p>other page</p></AppErrorBoundary></MemoryRouter></LanguageProvider>);
      expect(screen.getByText("other page")).toBeInTheDocument();
    } finally {
      log.mockRestore();
    }
  });
});

describe("the 404 page", () => {
  it("an unknown address shows it, with the address and a link home", () => {
    renderAt("/no-such-page", <AuthenticatedApp />);
    expect(screen.getByTestId("not-found-page")).toHaveTextContent("404");
    expect(screen.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeInTheDocument();
    expect(screen.getByTestId("not-found-page")).toHaveTextContent("no-such-page");
    expect(screen.getByRole("link", { name: /الصفحة الرئيسية/ })).toHaveAttribute("href", "/");
  });

  it("in English", () => {
    render(<LanguageProvider initialLang="en"><MemoryRouter initialEntries={["/nope"]}><NotFoundPage /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go home/ })).toBeInTheDocument();
  });
});
