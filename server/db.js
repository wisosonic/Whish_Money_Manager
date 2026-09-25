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
      updated_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      opening_balance REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '${LEGACY_OWNER_EMAIL}',
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      UNIQUE(date, created_by)
    );

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

    -- Days closed for changes (Admin/Manager). No transaction or opening balance on a closed date
    -- can be added, edited or deleted until the day is reopened.
    CREATE TABLE IF NOT EXISTS closed_days (
      date TEXT PRIMARY KEY,   -- YYYY-MM-DD
      closed_by TEXT NOT NULL,
      closed_at TEXT NOT NULL
    );

    -- Office commission rate on credits (percent), with the date it applies from. The rate for a
    -- day is the latest entry on or before it. Stored commissions never change; only new ones use it.
    CREATE TABLE IF NOT EXISTS commission_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rate REAL NOT NULL,
      effective_from TEXT NOT NULL UNIQUE,  -- YYYY-MM-DD
      created_by TEXT NOT NULL,
      created_date TEXT NOT NULL
    );

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

  // The rate the app always used (1% on credits) is the starting point of the history.
  if (!db.prepare("SELECT 1 FROM commission_rates LIMIT 1").get()) {
    db.prepare("INSERT INTO commission_rates (rate, effective_from, created_by, created_date) VALUES (1, ?, 'system', ?)")
      .run(BASE_RATE_DATE, nowIso());
  }
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
