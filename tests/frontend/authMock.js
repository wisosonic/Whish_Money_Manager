// Simulated signed-in user for component tests. Use in a test file with:
//
//   vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
//   beforeEach(() => setAuthRole("admin"));     // or "manager" / "user"
//
// `can` and `canEditTransaction` use the real permission rules shared with the server.
import { vi } from "vitest";
import { DEFAULT_ROLES, canUpdateTransaction, hasPermission } from "@/lib/permissions";

const state = { user: null, logout: vi.fn(), login: vi.fn() };

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
    ...overrides,
  };
};

export const setAuthRole = (role, overrides) => {
  state.user = role ? userWithRole(role, overrides) : null;
  state.logout = vi.fn();
  state.login = vi.fn();
  return state.user;
};

export const authMocks = () => state;

export const authContextMock = {
  useAuth: () => ({
    user: state.user,
    isAuthenticated: Boolean(state.user),
    logout: state.logout,
    login: state.login,
    can: (permission) => hasPermission(state.user, permission),
    canEditTransaction: (transaction) => canUpdateTransaction(state.user, transaction),
  }),
  AuthProvider: ({ children }) => children,
};
