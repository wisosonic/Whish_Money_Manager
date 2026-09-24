/** @vitest-environment jsdom */
// The real AuthProvider: session check on load, login/logout, permission helpers, and returning to
// the login screen when the server reports the session has ended.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { RequirePermission } from "@/App";
import { SESSION_ENDED_EVENT, api } from "@/api/apiClient";
import { PERMISSIONS } from "@/lib/permissions";
import { userWithRole } from "./authMock";

vi.mock("@/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: { auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() } },
  };
});

let latest;
const Probe = () => {
  latest = useAuth();
  if (latest.isLoadingAuth) return <p>loading</p>;
  return <p>{latest.isAuthenticated ? `signed in as ${latest.user.email}` : "signed out"}</p>;
};
const renderProvider = (children = <Probe />) => render(<AuthProvider>{children}</AuthProvider>);
const unauthorized = () => Object.assign(new Error("Authentication required"), { status: 401 });

beforeEach(() => {
  vi.clearAllMocks();
  api.auth.logout.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("AuthProvider", () => {
  it("restores the session on load by asking the server (no re-login while the cookie is valid)", async () => {
    api.auth.me.mockResolvedValue(userWithRole("manager"));
    renderProvider();
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("signed in as manager@test.local")).toBeInTheDocument();
    expect(api.auth.me).toHaveBeenCalledTimes(1);
  });

  it("shows signed out when the server has no session", async () => {
    api.auth.me.mockRejectedValue(unauthorized());
    renderProvider();
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("login signs in with the user returned by the server", async () => {
    api.auth.me.mockRejectedValue(unauthorized());
    api.auth.login.mockResolvedValue(userWithRole("user"));
    renderProvider();
    await screen.findByText("signed out");
    await act(() => latest.login("user@test.local", "pass-1234"));
    expect(api.auth.login).toHaveBeenCalledWith("user@test.local", "pass-1234");
    expect(screen.getByText("signed in as user@test.local")).toBeInTheDocument();
  });

  it("a failed login stays signed out and rethrows the error", async () => {
    api.auth.me.mockRejectedValue(unauthorized());
    api.auth.login.mockRejectedValue(new Error("Invalid email or password"));
    renderProvider();
    await screen.findByText("signed out");
    await expect(act(() => latest.login("x@y.zz", "bad"))).rejects.toThrow("Invalid email or password");
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });

  it("logout ends the server session, then signs out", async () => {
    api.auth.me.mockResolvedValue(userWithRole("admin"));
    renderProvider();
    await screen.findByText("signed in as admin@test.local");
    await act(() => latest.logout());
    expect(api.auth.logout).toHaveBeenCalledTimes(1);
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });

  it("returns to signed out when any API call reports the session ended (e.g. deactivated elsewhere)", async () => {
    api.auth.me.mockResolvedValue(userWithRole("user"));
    renderProvider();
    await screen.findByText("signed in as user@test.local");
    act(() => window.dispatchEvent(new Event(SESSION_ENDED_EVENT)));
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });

  it("exposes can() and canEditTransaction() from the user's permissions", async () => {
    api.auth.me.mockResolvedValue(userWithRole("user"));
    renderProvider();
    await screen.findByText("signed in as user@test.local");
    expect(latest.can(PERMISSIONS.TRANSACTIONS_CREATE)).toBe(true);
    expect(latest.can(PERMISSIONS.TRANSACTIONS_DELETE)).toBe(false);
    expect(latest.can(PERMISSIONS.USERS_MANAGE)).toBe(false);
    expect(latest.canEditTransaction({ created_by: "user@test.local" })).toBe(true);
    expect(latest.canEditTransaction({ created_by: "manager@test.local" })).toBe(false);
  });

  it("can() is false for everything when signed out", async () => {
    api.auth.me.mockRejectedValue(unauthorized());
    renderProvider();
    await screen.findByText("signed out");
    Object.values(PERMISSIONS).forEach((p) => expect(latest.can(p)).toBe(false));
  });
});

describe("RequirePermission route guard", () => {
  const renderGuarded = () =>
    renderProvider(
      <MemoryRouter>
        <RequirePermission permission={PERMISSIONS.USERS_MANAGE}><p>secret users page</p></RequirePermission>
      </MemoryRouter>
    );

  it("shows the page to an Admin", async () => {
    api.auth.me.mockResolvedValue(userWithRole("admin"));
    renderGuarded();
    expect(await screen.findByText("secret users page")).toBeInTheDocument();
  });

  it.each(["manager", "user"])("shows 'not allowed' to a %s", async (role) => {
    api.auth.me.mockResolvedValue(userWithRole(role));
    renderGuarded();
    await waitFor(() => expect(screen.getByText("غير مسموح")).toBeInTheDocument());
    expect(screen.queryByText("secret users page")).not.toBeInTheDocument();
  });
});
