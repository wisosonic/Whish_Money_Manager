import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_ROLES } from "./permissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// HAWALAFLOW_DB_PATH lets tests point the API at a throwaway database (e.g. ":memory:").
export const dbPath = process.env.HAWALAFLOW_DB_PATH || path.join(__dirname, "hawalaflow.db");
export const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

export const nowIso = () => new Date().toISOString();

// Owner of every row created before accounts existed (the old single "admin/admin" login).
// The seed script reassigns these rows to the initial admin account.
export const LEGACY_OWNER_EMAIL = "local@hawalaflow.app";

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
  `);

  // Columns added after a table was first created: add them to existing databases.
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("previous_login")) {
    db.exec("ALTER TABLE users ADD COLUMN previous_login TEXT");
  }
  if (!userColumns.includes("preferences")) {
    db.exec("ALTER TABLE users ADD COLUMN preferences TEXT");
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
};

export const findRoleByName = (name) => db.prepare("SELECT * FROM roles WHERE name = ?").get(String(name || ""));
