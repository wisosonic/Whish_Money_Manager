import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_ROLES, PERMISSIONS_ADDED_LATER } from "./permissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// HAWALAFLOW_DB_PATH lets tests point the API at a throwaway database (e.g. ":memory:").
export const dbPath = process.env.HAWALAFLOW_DB_PATH || path.join(__dirname, "hawalaflow.db");
export const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

export const nowIso = () => new Date().toISOString();

// Owner of every row created before accounts existed (the old single "admin/admin" login).
// The seed script reassigns these rows to the initial admin account.
export const LEGACY_OWNER_EMAIL = "local@hawalaflow.app";
// effective_from of the first commission rate (1%): before any real transaction.
export const BASE_RATE_DATE = "2000-01-01";

// Tables whose unique keys include the store. Kept as constants: the stores upgrade rebuilds older
// versions of these tables from the same definitions.
// One opening balance per store per day.
const DAILY_BALANCES_SQL = `CREATE TABLE IF NOT EXISTS daily_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      opening_balance REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '${LEGACY_OWNER_EMAIL}',
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      UNIQUE(store_id, date)
    );`;
// Days a store has closed for changes (Admin/Manager). No transaction or opening balance of that
// store on a closed date can be added, edited or deleted until the day is reopened.
const CLOSED_DAYS_SQL = `CREATE TABLE IF NOT EXISTS closed_days (
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      closed_by TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      PRIMARY KEY (store_id, date)
    );`;
// Each store's commission rate on credits (percent), with the date it applies from. The rate for a
// day is the store's latest entry on or before it. Stored commissions never change.
const COMMISSION_RATES_SQL = `CREATE TABLE IF NOT EXISTS commission_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      rate REAL NOT NULL,
      effective_from TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_date TEXT NOT NULL,
      UNIQUE(store_id, effective_from)
    );`;

export const initializeDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      sender_name TEXT,
      receiver_name TEXT,
      phone TEXT,
      customer_number TEXT,
      note TEXT,
      reference_number TEXT,
      service TEXT,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'completed',
      transaction_date TEXT,
      sort_order INTEGER DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '${LEGACY_OWNER_EMAIL}',
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      store_id INTEGER REFERENCES stores(id)
    );

    -- Physical or online stores (branches). Every transaction, opening balance, closed day and
    -- commission rate belongs to one. One Manager per store (manager_id); a User belongs to at most
    -- one store (users.store_id), and so does the store's Manager.
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      location TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      manager_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL
    );

    ${DAILY_BALANCES_SQL}

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      full_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login TEXT,        -- the most recent sign-in (the current one, once signed in)
      previous_login TEXT,    -- the sign-in before that, shown in the header as "last login"
      preferences TEXT,       -- JSON display preferences (server/preferences.js); NULL = defaults
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL
    );

    -- One row per login. The JWT carries the session id; deleting the row (logout, deactivation,
    -- password reset) invalidates that token immediately even though the token itself never expires.
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      created_date TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    ${CLOSED_DAYS_SQL}

    ${COMMISSION_RATES_SQL}

    -- One-time upgrade steps already applied (e.g. "granted:data:export").
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_date TEXT NOT NULL
    );
  `);

  // Columns added after a table was first created: add them to existing databases.
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("previous_login")) {
    db.exec("ALTER TABLE users ADD COLUMN previous_login TEXT");
  }
  if (!userColumns.includes("preferences")) {
    db.exec("ALTER TABLE users ADD COLUMN preferences TEXT");
  }

  upgradeToStores();
};

// ═══ Stores upgrade ═══
// Databases from before stores: add store_id where it's missing, rebuild the tables whose unique keys
// now include the store, create a first store and give it every existing row. Runs at every start;
// each step only does something once.

const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);

// Rebuild `table` from its new definition, copying `columns`. INSERT OR IGNORE in `orderBy` order
// keeps the first of any rows the new unique key merges: the same row the app read before.
const rebuildTable = (table, createSql, columns, orderBy) => {
  db.exec(createSql.replace(`CREATE TABLE IF NOT EXISTS ${table} `, `CREATE TABLE ${table}__new `));
  db.exec(`INSERT OR IGNORE INTO ${table}__new (${columns.join(", ")}) SELECT ${columns.join(", ")} FROM ${table} ORDER BY ${orderBy}`);
  db.exec(`DROP TABLE ${table}; ALTER TABLE ${table}__new RENAME TO ${table};`);
};

// Name of the store that receives the existing data: the office's account name as the importers
// wrote it (the sender of Cash Out rows), or a plain default. The Admin can rename it.
export const DEFAULT_STORE_NAME = "Main store";
const firstStoreName = () => {
  const account = db.prepare(
    `SELECT sender_name AS name, COUNT(*) AS n FROM transactions
     WHERE type = 'cash_out' AND trim(coalesce(sender_name, '')) <> '' GROUP BY sender_name ORDER BY n DESC LIMIT 1`
  ).get();
  return account?.name?.trim() || DEFAULT_STORE_NAME;
};

const upgradeToStores = () => {
  db.transaction(() => {
    if (!columnsOf("transactions").includes("store_id")) db.exec("ALTER TABLE transactions ADD COLUMN store_id INTEGER REFERENCES stores(id)");
    const usersBeforeStores = !columnsOf("users").includes("store_id");
    if (usersBeforeStores) db.exec("ALTER TABLE users ADD COLUMN store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL");

    // There is always at least one store.
    let first = db.prepare("SELECT id FROM stores ORDER BY id LIMIT 1").get();
    if (!first) {
      const now = nowIso();
      first = { id: db.prepare("INSERT INTO stores (name, created_date, updated_date) VALUES (?, ?, ?)").run(firstStoreName(), now, now).lastInsertRowid };
    }
    const storeId = Number(first.id);

    // The people who worked in the office before stores keep seeing its data: every User joins the
    // first store, and a single Manager becomes its Manager (with several, the Admin picks one —
    // a store has one Manager). Only once, when the store column is added.
    if (usersBeforeStores) {
      db.prepare("UPDATE users SET store_id = ? WHERE role_id IN (SELECT id FROM roles WHERE name = 'user')").run(storeId);
      const managers = db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'manager'").all();
      if (managers.length === 1) {
        db.prepare("UPDATE stores SET manager_id = ? WHERE id = ?").run(managers[0].id, storeId);
        db.prepare("UPDATE users SET store_id = ? WHERE id = ?").run(storeId, managers[0].id);
      }
    }

    if (!columnsOf("daily_balances").includes("store_id")) {
      db.exec(`ALTER TABLE daily_balances ADD COLUMN store_id INTEGER; UPDATE daily_balances SET store_id = ${storeId};`);
      rebuildTable("daily_balances", DAILY_BALANCES_SQL, ["id", "date", "opening_balance", "created_by", "created_date", "updated_date", "store_id"], "id");
    }
    if (!columnsOf("closed_days").includes("store_id")) {
      db.exec(`ALTER TABLE closed_days ADD COLUMN store_id INTEGER; UPDATE closed_days SET store_id = ${storeId};`);
      rebuildTable("closed_days", CLOSED_DAYS_SQL, ["store_id", "date", "closed_by", "closed_at"], "rowid");
    }
    if (!columnsOf("commission_rates").includes("store_id")) {
      db.exec(`ALTER TABLE commission_rates ADD COLUMN store_id INTEGER; UPDATE commission_rates SET store_id = ${storeId};`);
      rebuildTable("commission_rates", COMMISSION_RATES_SQL, ["id", "store_id", "rate", "effective_from", "created_by", "created_date"], "id");
    }
    db.prepare("UPDATE transactions SET store_id = ? WHERE store_id IS NULL").run(storeId);

    // Every store's rate history starts from the rate the app always used (1% on credits).
    db.prepare(
      `INSERT INTO commission_rates (store_id, rate, effective_from, created_by, created_date)
       SELECT id, 1, ?, 'system', ? FROM stores s
       WHERE NOT EXISTS (SELECT 1 FROM commission_rates r WHERE r.store_id = s.id AND r.effective_from = ?)`
    ).run(BASE_RATE_DATE, nowIso(), BASE_RATE_DATE);
  })();
  db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_store ON transactions(store_id); CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id);");
};

// Insert any missing default role. `reset: true` also restores the default label, description
// and permissions of existing default roles (used by the seed script).
export const ensureDefaultRoles = ({ reset = false } = {}) => {
  const now = nowIso();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO roles (name, label, description, permissions, created_date, updated_date) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const update = db.prepare(
    "UPDATE roles SET label = ?, description = ?, permissions = ?, updated_date = ? WHERE name = ?"
  );
  db.transaction(() => {
    DEFAULT_ROLES.forEach((role) => {
      const permissions = JSON.stringify(role.permissions);
      insert.run(role.name, role.label, role.description, permissions, now, now);
      if (reset) update.run(role.label, role.description, permissions, now, role.name);
    });
  })();
  grantLaterPermissions();
};

// Grant each permission in PERMISSIONS_ADDED_LATER to its roles — once per permission, recorded in
// app_meta, so it never runs again (and never re-adds a permission someone removed on purpose).
export const grantLaterPermissions = () => {
  const done = db.prepare("SELECT 1 FROM app_meta WHERE key = ?");
  const record = db.prepare("INSERT INTO app_meta (key, value, created_date) VALUES (?, ?, ?)");
  const readRole = db.prepare("SELECT permissions FROM roles WHERE name = ?");
  const writeRole = db.prepare("UPDATE roles SET permissions = ?, updated_date = ? WHERE name = ?");
  for (const [permission, roleNames] of Object.entries(PERMISSIONS_ADDED_LATER)) {
    const key = `granted:${permission}`;
    if (done.get(key)) continue;
    db.transaction(() => {
      const now = nowIso();
      const granted = [];
      for (const name of roleNames) {
        const row = readRole.get(name);
        if (!row) continue;
        const list = JSON.parse(row.permissions || "[]");
        if (!list.includes(permission)) {
          writeRole.run(JSON.stringify([...list, permission]), now, name);
          granted.push(name);
        }
      }
      record.run(key, JSON.stringify(granted), now);
    })();
  }
};

export const findRoleByName = (name) => db.prepare("SELECT * FROM roles WHERE name = ?").get(String(name || ""));
