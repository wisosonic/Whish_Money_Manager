import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { db, findRoleByName, nowIso } from "./db.js";
import { PERMISSIONS } from "./permissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══ Configuration ═══

export const SESSION_COOKIE = "wmm_session";
// Browsers cap cookie lifetime at ~400 days. The token itself never expires; the cookie is re-issued
// as the app is used (at most once a day), so an active user stays signed in until they log out.
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
export const MIN_PASSWORD_LENGTH = 8;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Signing secret: JWT_SECRET env var, or a random secret generated once and kept in
// server/.jwt-secret (git-ignored). Changing it signs everyone out.
const resolveJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(__dirname, ".jwt-secret");
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  console.log("[auth] Generated a new JWT signing secret in server/.jwt-secret");
  return secret;
};
const JWT_SECRET = resolveJwtSecret();

const cookieOptions = () => ({
  httpOnly: true, // not readable from page JavaScript
  sameSite: "strict", // never sent on requests started by other sites (CSRF protection)
  secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge: COOKIE_MAX_AGE_MS,
});

// ═══ Helpers ═══

export const hashPassword = (password) => bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
// Compared against when the email doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const USER_WITH_ROLE_SQL = `
  SELECT u.id, u.email, u.full_name, u.password_hash, u.is_active, u.last_login, u.previous_login, u.created_date,
         r.name AS role, r.label AS role_label, r.permissions AS role_permissions
  FROM users u JOIN roles r ON r.id = u.role_id`;

// What the API returns about a user (never the password hash).
export const publicUser = (row) =>
  row && {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    role_label: row.role_label,
    permissions: JSON.parse(row.role_permissions || "[]"),
    is_active: Boolean(row.is_active),
    last_login: row.last_login,
    previous_login: row.previous_login,
    created_date: row.created_date,
  };

const getUserRow = (id) => db.prepare(`${USER_WITH_ROLE_SQL} WHERE u.id = ?`).get(id);

const countActiveAdmins = (excludeUserId = null) =>
  db
    .prepare("SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active = 1 AND u.id != ?")
    .get(excludeUserId ?? -1).n;

const revokeUserSessions = (userId) => db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;

const createSession = (userId, userAgent) => {
  const sid = crypto.randomUUID();
  const now = nowIso();
  db.prepare("INSERT INTO sessions (id, user_id, user_agent, created_date, last_seen) VALUES (?, ?, ?, ?, ?)")
    .run(sid, userId, String(userAgent || "").slice(0, 300), now, now);
  // No `exp` claim: the token is valid until its session row is deleted.
  return jwt.sign({ sid, sub: String(userId) }, JWT_SECRET, { algorithm: "HS256", noTimestamp: false });
};

const readSessionToken = (req) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    return payload?.sid ? payload : null;
  } catch {
    return null;
  }
};

// ═══ Validation shared by user creation (API and seed script) ═══

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const createUser = ({ email, full_name = "", password, role }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw new AuthError(400, "A valid email is required");
  if (String(password || "").length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const roleRow = findRoleByName(role);
  if (!roleRow) throw new AuthError(400, "Unknown role");
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalizedEmail)) {
    throw new AuthError(409, "A user with this email already exists");
  }
  const now = nowIso();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (email, full_name, password_hash, role_id, is_active, created_date, updated_date) VALUES (?, ?, ?, ?, 1, ?, ?)")
    .run(normalizedEmail, String(full_name || "").trim(), hashPassword(password), roleRow.id, now, now);
  return publicUser(getUserRow(lastInsertRowid));
};

// ═══ Brute-force protection (per IP + email, in memory) ═══

const loginFailures = new Map();
export const resetLoginRateLimit = () => loginFailures.clear();

const failureKey = (req, email) => `${req.ip}|${email}`;
const isRateLimited = (key) => {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
};
const recordFailure = (key) => {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
};

// ═══ Middleware ═══

// Requires a valid, non-revoked session for an active user; attaches req.user (with permissions
// read fresh from the database, so role changes apply immediately).
export const authenticate = (req, res, next) => {
  const payload = readSessionToken(req);
  const session = payload && db.prepare("SELECT * FROM sessions WHERE id = ?").get(payload.sid);
  const row = session && String(session.user_id) === payload.sub && getUserRow(session.user_id);

  if (!row || !row.is_active) {
    if (req.cookies?.[SESSION_COOKIE]) res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Sliding renewal: keep the browser cookie alive for active users (at most once a day).
  if (Date.now() - Date.parse(session.last_seen) > SESSION_TOUCH_INTERVAL_MS) {
    db.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?").run(nowIso(), session.id);
    res.cookie(SESSION_COOKIE, req.cookies[SESSION_COOKIE], cookieOptions());
  }

  req.user = publicUser(row);
  req.sessionId = session.id;
  next();
};

export const requirePermission = (...permissions) => (req, res, next) => {
  const missing = permissions.filter((p) => !req.user?.permissions?.includes(p));
  if (missing.length) {
    res.status(403).json({ error: "You don't have permission to do this", missing });
    return;
  }
  next();
};

// ═══ Routes ═══

export const registerAuthRoutes = (app) => {
  app.post("/local-api/auth/login", (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const key = failureKey(req, email);
    if (isRateLimited(key)) {
      res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
      return;
    }

    const row = db.prepare(`${USER_WITH_ROLE_SQL} WHERE u.email = ?`).get(email);
    const passwordOk = bcrypt.compareSync(password, row?.password_hash || DUMMY_HASH);
    if (!row || !passwordOk || !row.is_active) {
      recordFailure(key);
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    loginFailures.delete(key);
    const token = createSession(row.id, req.get("user-agent"));
    // Keep the sign-in before this one: it's what the header shows as "last login".
    db.prepare("UPDATE users SET previous_login = last_login, last_login = ? WHERE id = ?").run(nowIso(), row.id);
    res.cookie(SESSION_COOKIE, token, cookieOptions());
    res.json(publicUser(getUserRow(row.id)));
  });

  // Always clears the cookie; deletes the session so the token can never be reused.
  app.post("/local-api/auth/logout", (req, res) => {
    const payload = readSessionToken(req);
    if (payload) db.prepare("DELETE FROM sessions WHERE id = ?").run(payload.sid);
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });

  app.get("/local-api/auth/me", authenticate, (req, res) => {
    res.json(req.user);
  });

  // ─── User & role management (Admin only) ───
  const adminOnly = [authenticate, requirePermission(PERMISSIONS.USERS_MANAGE)];

  app.get("/local-api/roles", ...adminOnly, (_req, res) => {
    const roles = db.prepare("SELECT id, name, label, description, permissions FROM roles ORDER BY id").all();
    res.json(roles.map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })));
  });

  app.get("/local-api/users", ...adminOnly, (_req, res) => {
    res.json(db.prepare(`${USER_WITH_ROLE_SQL} ORDER BY u.created_date`).all().map(publicUser));
  });

  app.post("/local-api/users", ...adminOnly, (req, res) => {
    try {
      res.status(201).json(createUser(req.body || {}));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.put("/local-api/users/:id", ...adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const existing = getUserRow(id);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { full_name, role, is_active, password } = req.body || {};
    const sets = [];
    const values = [];
    let revoke = false;

    const becomingNonAdmin = role !== undefined && role !== "admin" && existing.role === "admin";
    const deactivating = is_active === false && existing.is_active;
    if ((becomingNonAdmin || deactivating) && existing.role === "admin" && countActiveAdmins(id) === 0) {
      res.status(400).json({ error: "At least one active Admin is required" });
      return;
    }
    if (deactivating && id === req.user.id) {
      res.status(400).json({ error: "You can't deactivate your own account" });
      return;
    }

    if (full_name !== undefined) {
      sets.push("full_name = ?");
      values.push(String(full_name).trim());
    }
    if (role !== undefined) {
      const roleRow = findRoleByName(role);
      if (!roleRow) {
        res.status(400).json({ error: "Unknown role" });
        return;
      }
      sets.push("role_id = ?");
      values.push(roleRow.id);
    }
    if (is_active !== undefined) {
      sets.push("is_active = ?");
      values.push(is_active ? 1 : 0);
      if (!is_active) revoke = true;
    }
    if (password !== undefined) {
      if (String(password).length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        return;
      }
      sets.push("password_hash = ?");
      values.push(hashPassword(password));
      revoke = true; // a reset password signs the user out everywhere
    }
    if (!sets.length) {
      res.status(400).json({ error: "No changes to apply" });
      return;
    }

    sets.push("updated_date = ?");
    values.push(nowIso(), id);
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    const sessionsRevoked = revoke ? revokeUserSessions(id) : 0;
    res.json({ ...publicUser(getUserRow(id)), sessions_revoked: sessionsRevoked });
  });
};
