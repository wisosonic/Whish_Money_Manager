// Simulated signed-in user for component tests. Use in a test file with:
//
//   vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
//   beforeEach(() => setAuthRole("admin"));     // or "manager" / "user"
//
// `can` and `canEditTransaction` use the real permission rules shared with the server.
import { vi } from "vitest";
import { DEFAULT_ROLES, canUpdateTransaction, hasPermission } from "@/lib/permissions";

const state = { user: null, logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(), isLoadingAuth: false };

export const userWithRole = (role, overrides = {}) => {
  const definition = DEFAULT_ROLES.find((r) => r.name === role);
  return {
    id: { admin: 1, manager: 2, user: 3 }[role] ?? 9,
    email: `${role}@test.local`,
    full_name: `${definition.label} Person`,
    role,
    role_label: definition.label,
    permissions: definition.permissions,
    is_active: true,
    // Stores: Managers and Users work in the first store; the Admin in every store (no store of their own).
    store_id: role === "admin" ? null : 1,
    store_name: role === "admin" ? null : "Main store",
    manages_store: role === "manager",
    ...overrides,
  };
};

export const setAuthRole = (role, overrides) => {
  state.user = role ? userWithRole(role, overrides) : null;
  state.logout = vi.fn();
  state.login = vi.fn();
  // Like the real one, replaces the signed-in user (visible on the next render).
  state.updateUser = vi.fn((next) => { state.user = next; });
  state.isLoadingAuth = false;
  return state.user;
};

// Simulate the session check that runs when the app starts (before the user is known).
export const setAuthLoading = (loading) => {
  state.isLoadingAuth = loading;
};

export const authMocks = () => state;

export const authContextMock = {
  useAuth: () => ({
    user: state.user,
    isAuthenticated: Boolean(state.user),
    isLoadingAuth: state.isLoadingAuth,
    logout: state.logout,
    login: state.login,
    updateUser: state.updateUser,
    can: (permission) => hasPermission(state.user, permission),
    canEditTransaction: (transaction) => canUpdateTransaction(state.user, transaction),
  }),
  AuthProvider: ({ children }) => children,
};
