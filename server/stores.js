// Stores (branches) and who works in which. Every transaction, opening balance, closed day and
// commission rate belongs to a store.
//
//   GET    /local-api/stores                         the stores you can see (Admin: all; others: yours)
//   GET    /local-api/stores/:id                     one store, with its Manager (and members, for
//                                                    its Manager and the Admin)
//   POST   /local-api/stores                         create                          (stores:manage)
//   PUT    /local-api/stores/:id                     edit name / location / contact   (stores:manage)
//   DELETE /local-api/stores/:id                     delete an empty store            (stores:manage)
//   PUT    /local-api/stores/:id/manager { user_id } assign / clear its Manager      (stores:manage)
//   GET    /local-api/stores/:id/assignable          Users who can be added (not in a store yet)
//   POST   /local-api/stores/:id/members { user_id } add a User      (its Manager with stores:members, or the Admin)
//   DELETE /local-api/stores/:id/members/:userId     remove a User   (same)
//
// Scope: with stores:all (the Admin) you see and work in every store; without it only in your own
// store (users.store_id), and with no store you see nothing. The helpers below apply that rule to
// every route that reads or changes store data.
import { requirePermission } from "./auth.js";
import { BASE_RATE_DATE, db, nowIso } from "./db.js";
import { PERMISSIONS as P, hasPermission } from "./permissions.js";

// ═══ Scope helpers (used by every route with store data) ═══

export const seesAllStores = (user) => hasPermission(user, P.STORES_ALL);

// SQL condition limiting rows to what the user may see. `column` is the store_id column to test.
export const scopeSql = (user, column = "store_id") =>
  seesAllStores(user) ? { sql: "1 = 1", params: [] } : { sql: `${column} = ?`, params: [user?.store_id ?? 0] };

export const inScope = (user, row) => Boolean(row) && (seesAllStores(user) || (user?.store_id != null && row.store_id === user.store_id));

export const storeById = (id) => db.prepare("SELECT * FROM stores WHERE id = ?").get(Number(id));
const onlyStoreId = () => {
  const rows = db.prepare("SELECT id FROM stores LIMIT 2").all();
  return rows.length === 1 ? rows[0].id : null;
};

// The store a write (or a single-store read) is for. Returns the store id, or sends the error and
// returns null. Without stores:all it's always your own store (asking for another one → 403). With
// stores:all it's the store asked for, or — when the office has just one store — that one.
export const targetStore = (req, res, requested) => {
  const result = resolveStore(req.user, requested);
  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.id;
};

// The same rule without a response: { id } or { status, error }.
export const resolveStore = (user, requested) => {
  const asked = requested === undefined || requested === null || requested === "" ? null : Number(requested);
  if (!seesAllStores(user)) {
    if (user?.store_id == null) return { status: 403, error: "You aren't assigned to a store yet" };
    if (asked !== null && asked !== user.store_id) return { status: 403, error: "You can only work in your own store" };
    return { id: user.store_id };
  }
  if (asked === null) {
    const only = onlyStoreId();
    return only === null ? { status: 400, error: "Choose a store" } : { id: only };
  }
  if (!Number.isInteger(asked) || !storeById(asked)) return { status: 404, error: "Store not found" };
  return { id: asked };
};

// For lists: the one store asked for (checked as above), or null = every store you can see.
export const readStore = (req, res, requested) => {
  const asked = requested === undefined || requested === null || requested === "" || requested === "all" ? null : requested;
  if (asked === null) return seesAllStores(req.user) ? { all: true } : targetStoreOrNull(req, res, null);
  return targetStoreOrNull(req, res, asked);
};
const targetStoreOrNull = (req, res, asked) => {
  const id = targetStore(req, res, asked);
  return id === null ? null : { id };
};

// ═══ Store records ═══

const STORE_FIELDS = ["name", "location", "phone", "email"];
const MAX_LENGTH = { name: 100, location: 200, phone: 40, email: 120 };

const publicStore = (row) => row && {
  id: row.id,
  name: row.name,
  location: row.location,
  phone: row.phone,
  email: row.email,
  manager: row.manager_id ? { id: row.manager_id, full_name: row.manager_name, email: row.manager_email } : null,
  member_count: row.member_count ?? 0,
  transaction_count: row.transaction_count ?? 0,
  created_date: row.created_date,
  updated_date: row.updated_date,
};

const STORE_SQL = `
  SELECT s.*, m.full_name AS manager_name, m.email AS manager_email,
         (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id) AS member_count,
         (SELECT COUNT(*) FROM transactions t WHERE t.store_id = s.id) AS transaction_count
  FROM stores s LEFT JOIN users m ON m.id = s.manager_id`;

const loadStore = (id) => publicStore(db.prepare(`${STORE_SQL} WHERE s.id = ?`).get(Number(id)));

const members = (storeId) =>
  db.prepare(
    `SELECT u.id, u.full_name, u.email, u.is_active, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.store_id = ? ORDER BY r.name, u.full_name, u.email`
  ).all(storeId).map((u) => ({ ...u, is_active: Boolean(u.is_active) }));

// Validated store fields from a request body, or { error }. `partial` for edits.
const readStoreFields = (body, { partial = false } = {}) => {
  const values = {};
  for (const field of STORE_FIELDS) {
    if (body?.[field] === undefined) continue;
    const value = String(body[field] ?? "").trim();
    if (value.length > MAX_LENGTH[field]) return { error: `The ${field} is too long` };
    values[field] = value;
  }
  if ((!partial || values.name !== undefined) && !values.name) return { error: "A store name is required" };
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return { error: "A valid email is required" };
  return { values };
};

const nameTaken = (name, exceptId = 0) => Boolean(db.prepare("SELECT 1 FROM stores WHERE name = ? AND id != ?").get(name, exceptId));

const userWithRole = (id) =>
  db.prepare("SELECT u.id, u.email, u.full_name, u.is_active, u.store_id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(Number(id));

// Can the signed-in user manage this store's members? The Admin (stores:manage) for any store; a
// Manager (stores:members) for the store they manage.
const canManageMembers = (user, store) =>
  hasPermission(user, P.STORES_MANAGE) || (hasPermission(user, P.STORES_MEMBERS) && store.manager_id === user.id);

// Clears a user's store: their membership and, if they manage one, that store's Manager.
export const clearStoreAssignment = (userId) => {
  db.prepare("UPDATE stores SET manager_id = NULL, updated_date = ? WHERE manager_id = ?").run(nowIso(), userId);
  db.prepare("UPDATE users SET store_id = NULL, updated_date = ? WHERE id = ?").run(nowIso(), userId);
};

// ═══ Routes ═══

export const registerStoreRoutes = (app) => {
  const canManage = requirePermission(P.STORES_MANAGE);

  app.get("/local-api/stores", (req, res) => {
    const scope = scopeSql(req.user, "s.id");
    res.json(db.prepare(`${STORE_SQL} WHERE ${scope.sql} ORDER BY s.name`).all(...scope.params).map(publicStore));
  });

  app.get("/local-api/stores/:id", (req, res) => {
    const store = storeById(req.params.id);
    if (!store || !inScope(req.user, { store_id: store.id })) {
      res.status(404).json({ error: "Store not found" });
      return;
    }
    const result = loadStore(store.id);
    if (canManageMembers(req.user, store)) result.members = members(store.id);
    res.json(result);
  });

  app.post("/local-api/stores", canManage, (req, res) => {
    const { values, error } = readStoreFields(req.body);
    if (error) { res.status(400).json({ error }); return; }
    if (nameTaken(values.name)) { res.status(409).json({ error: "A store with this name already exists" }); return; }
    const now = nowIso();
    const id = db.transaction(() => {
      const { lastInsertRowid } = db.prepare("INSERT INTO stores (name, location, phone, email, created_date, updated_date) VALUES (?, ?, ?, ?, ?, ?)")
        .run(values.name, values.location ?? "", values.phone ?? "", values.email ?? "", now, now);
      // A new store's rate history starts from the long-standing 1%.
      db.prepare("INSERT INTO commission_rates (store_id, rate, effective_from, created_by, created_date) VALUES (?, 1, ?, 'system', ?)")
        .run(lastInsertRowid, BASE_RATE_DATE, now);
      return lastInsertRowid;
    })();
    console.log(`[stores] ${req.user.email} created store ${id} (${values.name})`);
    res.status(201).json(loadStore(id));
  });

  app.put("/local-api/stores/:id", canManage, (req, res) => {
    const store = storeById(req.params.id);
    if (!store) { res.status(404).json({ error: "Store not found" }); return; }
    const { values, error } = readStoreFields(req.body, { partial: true });
    if (error) { res.status(400).json({ error }); return; }
    if (!Object.keys(values).length) { res.status(400).json({ error: "No changes to apply" }); return; }
    if (values.name && nameTaken(values.name, store.id)) { res.status(409).json({ error: "A store with this name already exists" }); return; }
    const sets = Object.keys(values).map((field) => `${field} = ?`);
    db.prepare(`UPDATE stores SET ${sets.join(", ")}, updated_date = ? WHERE id = ?`).run(...Object.values(values), nowIso(), store.id);
    res.json(loadStore(store.id));
  });

  // Only an empty store can be deleted, and never the last one. Its members and Manager are left
  // without a store; its closed days and rate history go with it.
  app.delete("/local-api/stores/:id", canManage, (req, res) => {
    const store = storeById(req.params.id);
    if (!store) { res.status(404).json({ error: "Store not found" }); return; }
    if (db.prepare("SELECT COUNT(*) AS n FROM stores").get().n <= 1) {
      res.status(400).json({ error: "At least one store is required" });
      return;
    }
    const used = db.prepare("SELECT (SELECT COUNT(*) FROM transactions WHERE store_id = ?) + (SELECT COUNT(*) FROM daily_balances WHERE store_id = ?) AS n").get(store.id, store.id).n;
    if (used) {
      res.status(409).json({ error: "This store still has transactions or opening balances. Move or delete them first." });
      return;
    }
    db.transaction(() => {
      db.prepare("UPDATE users SET store_id = NULL WHERE store_id = ?").run(store.id);
      db.prepare("DELETE FROM stores WHERE id = ?").run(store.id);
    })();
    console.log(`[stores] ${req.user.email} deleted store ${store.id} (${store.name})`);
    res.json({ ok: true, id: store.id });
  });

  // One Manager per store, and a Manager manages one store: assigning someone who managed another
  // store moves them. The previous Manager of this store is left without a store.
  app.put("/local-api/stores/:id/manager", canManage, (req, res) => {
    const store = storeById(req.params.id);
    if (!store) { res.status(404).json({ error: "Store not found" }); return; }
    const userId = req.body?.user_id;
    if (userId === null) {
      if (store.manager_id) clearStoreAssignment(store.manager_id);
      res.json(loadStore(store.id));
      return;
    }
    const manager = userWithRole(userId);
    if (!manager) { res.status(404).json({ error: "User not found" }); return; }
    if (manager.role !== "manager") { res.status(400).json({ error: "Only a user with the Manager role can manage a store" }); return; }
    if (!manager.is_active) { res.status(400).json({ error: "This user is deactivated" }); return; }
    db.transaction(() => {
      if (store.manager_id && store.manager_id !== manager.id) clearStoreAssignment(store.manager_id);
      clearStoreAssignment(manager.id);
      const now = nowIso();
      db.prepare("UPDATE stores SET manager_id = ?, updated_date = ? WHERE id = ?").run(manager.id, now, store.id);
      db.prepare("UPDATE users SET store_id = ?, updated_date = ? WHERE id = ?").run(store.id, now, manager.id);
    })();
    console.log(`[stores] ${req.user.email} made ${manager.email} the Manager of store ${store.id}`);
    res.json(loadStore(store.id));
  });

  const memberStore = (req, res) => {
    const store = storeById(req.params.id);
    if (!store || !inScope(req.user, { store_id: store.id })) {
      res.status(404).json({ error: "Store not found" });
      return null;
    }
    if (!canManageMembers(req.user, store)) {
      res.status(403).json({ error: "You don't have permission to do this", missing: [P.STORES_MEMBERS] });
      return null;
    }
    return store;
  };

  app.get("/local-api/stores/:id/assignable", (req, res) => {
    if (!memberStore(req, res)) return;
    res.json(db.prepare(
      `SELECT u.id, u.full_name, u.email FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'user' AND u.is_active = 1 AND u.store_id IS NULL ORDER BY u.full_name, u.email`
    ).all());
  });

  // Members are Users (role "user"). A Manager can only add someone who isn't in a store yet; the
  // Admin can also move a User from another store.
  app.post("/local-api/stores/:id/members", (req, res) => {
    const store = memberStore(req, res);
    if (!store) return;
    const member = userWithRole(req.body?.user_id);
    if (!member) { res.status(404).json({ error: "User not found" }); return; }
    if (member.role !== "user") { res.status(400).json({ error: "Only users with the User role can be added to a store" }); return; }
    if (member.store_id === store.id) { res.json(loadStoreWithMembers(store.id)); return; }
    if (member.store_id != null && !hasPermission(req.user, P.STORES_MANAGE)) {
      res.status(409).json({ error: "This user already belongs to another store" });
      return;
    }
    db.prepare("UPDATE users SET store_id = ?, updated_date = ? WHERE id = ?").run(store.id, nowIso(), member.id);
    res.json(loadStoreWithMembers(store.id));
  });

  app.delete("/local-api/stores/:id/members/:userId", (req, res) => {
    const store = memberStore(req, res);
    if (!store) return;
    const member = userWithRole(req.params.userId);
    if (!member || member.store_id !== store.id || member.role !== "user") {
      res.status(404).json({ error: "This user isn't a member of this store" });
      return;
    }
    db.prepare("UPDATE users SET store_id = NULL, updated_date = ? WHERE id = ?").run(nowIso(), member.id);
    res.json(loadStoreWithMembers(store.id));
  });
};

const loadStoreWithMembers = (id) => ({ ...loadStore(id), members: members(id) });
