// Permissions and the three default roles. Roles are stored in the `roles` table (seeded from here);
// the API always reads a user's permissions from the database, so role changes apply on the next request.
//
// Rules agreed with the office owner:
//   • Stores (2026-09-25): every transaction, opening balance, closed day and commission rate belongs
//     to a store. The Admin sees and works in every store; a Manager only in the store they manage
//     (one Manager per store); a User only in the store they're assigned to. Someone with no store
//     sees no transactions. (Before stores, everyone saw all office data.)
//   • User: add, import and edit THEIR OWN transactions; no deleting, no replacing imports,
//     no changing opening balances.
//   • Manager: everything with transactions, imports, balances and reports; no user/role management.
//   • Admin: everything.
//   • Admin panel (Admin + Manager): download a CSV backup and delete all data for a date range.
//   • Admin + Manager: restore a backup, close / reopen a day, set the commission rate (of their store).
//   • Admin: create, edit and delete stores and assign their Manager. Manager: add / remove Users
//     in their own store.

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
  DATA_EXPORT: "data:export", // admin panel: CSV backup of transactions / opening balances by date range
  DATA_PURGE: "data:purge", // admin panel: delete every transaction and opening balance in a date range
  DATA_RESTORE: "data:restore", // settings → backup & restore: add back rows from a backup CSV
  DAYS_CLOSE: "days:close", // close / reopen a day (a closed day can't be changed by anyone)
  OFFICE_SETTINGS: "settings:office", // the commission rate (per store)
  STORES_MANAGE: "stores:manage", // create / edit / delete stores, assign a store's Manager, move any User
  STORES_ALL: "stores:all", // see and work in every store (without it: only your own store)
  STORES_MEMBERS: "stores:members", // add / remove Users in the store you manage
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
    description: "All transaction, import, balance and report features for the store they manage, and its Users. No user or role management.",
    // Their own store only: no user management, no store management, no other stores.
    permissions: ALL.filter((p) => ![P.USERS_MANAGE, P.STORES_MANAGE, P.STORES_ALL].includes(p)),
  },
  {
    name: "user",
    label: "User",
    description: "View their store; add, import and edit own transactions. No deleting, no opening balances.",
    permissions: [
      P.TRANSACTIONS_READ,
      P.TRANSACTIONS_CREATE,
      P.TRANSACTIONS_IMPORT,
      P.TRANSACTIONS_UPDATE_OWN,
      P.BALANCES_READ,
    ],
  },
];

// Permissions introduced after databases already existed. Default roles in an existing database were
// stored with the old list, so on startup each permission here is granted once to these roles
// (see grantLaterPermissions in db.js). New databases get them from DEFAULT_ROLES directly.
export const PERMISSIONS_ADDED_LATER = {
  [P.DATA_EXPORT]: ["admin", "manager"],
  [P.DATA_PURGE]: ["admin", "manager"],
  [P.DATA_RESTORE]: ["admin", "manager"],
  [P.DAYS_CLOSE]: ["admin", "manager"],
  [P.OFFICE_SETTINGS]: ["admin", "manager"],
  [P.STORES_MANAGE]: ["admin"],
  [P.STORES_ALL]: ["admin"],
  [P.STORES_MEMBERS]: ["admin", "manager"],
};

export const hasPermission = (user, permission) => Boolean(user?.permissions?.includes(permission));

// Can this user edit this particular transaction?
export const canUpdateTransaction = (user, transaction) =>
  hasPermission(user, P.TRANSACTIONS_UPDATE_ANY) ||
  (hasPermission(user, P.TRANSACTIONS_UPDATE_OWN) && transaction?.created_by === user?.email);
