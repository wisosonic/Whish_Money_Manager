// Single source of truth shared with the API: the same permission names and rules the server enforces.
// The UI uses them only to hide actions a user can't perform — the server always re-checks.
export { PERMISSIONS, DEFAULT_ROLES, hasPermission, canUpdateTransaction } from "../../server/permissions.js";
