// Permissions and the three default roles. Roles are stored in the `roles` table (seeded from here);
// the API always reads a user's permissions from the database, so role changes apply on the next request.
//
// Rules agreed with the office owner:
//   • Everyone sees all office transactions and balances.
//   • User: add, import and edit THEIR OWN transactions; no deleting, no replacing imports,
//     no changing opening balances.
//   • Manager: everything with transactions, imports, balances and reports; no user/role management.
//   • Admin: everything.

export const PERMISSIONS = {
  TRANSACTIONS_READ: "transactions:read",
  TRANSACTIONS_CREATE: "transactions:create",
  TRANSACTIONS_IMPORT: "transactions:import",
  TRANSACTIONS_UPDATE_OWN: "transactions:update:own",
  TRANSACTIONS_UPDATE_ANY: "transactions:update:any",
  TRANSACTIONS_DELETE: "transactions:delete", // single, bulk, "delete all for this day", import overwrite
  BALANCES_READ: "balances:read",
  BALANCES_WRITE: "balances:write",
  USERS_MANAGE: "users:manage",
};

const P = PERMISSIONS;
const ALL = Object.values(P);

export const DEFAULT_ROLES = [
  {
    name: "admin",
    label: "Admin",
    description: "Full access to all features and settings, including users and roles.",
    permissions: ALL,
  },
  {
    name: "manager",
    label: "Manager",
    description: "All transaction, import, balance and report features. No user or role management.",
    permissions: ALL.filter((p) => p !== P.USERS_MANAGE),
  },
  {
    name: "user",
    label: "User",
    description: "View everything; add, import and edit own transactions. No deleting, no opening balances.",
    permissions: [
      P.TRANSACTIONS_READ,
      P.TRANSACTIONS_CREATE,
      P.TRANSACTIONS_IMPORT,
      P.TRANSACTIONS_UPDATE_OWN,
      P.BALANCES_READ,
    ],
  },
];

export const hasPermission = (user, permission) => Boolean(user?.permissions?.includes(permission));

// Can this user edit this particular transaction?
export const canUpdateTransaction = (user, transaction) =>
  hasPermission(user, P.TRANSACTIONS_UPDATE_ANY) ||
  (hasPermission(user, P.TRANSACTIONS_UPDATE_OWN) && transaction?.created_by === user?.email);
