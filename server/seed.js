// Seeds the default roles and the initial Admin account.
//
//   npm run seed                                   → admin@whish.local with a generated password (printed once)
//   npm run seed -- --email you@shop.com --password "long secret" --name "Owner"
//   (or SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME environment variables)
//
// Safe to run again: roles are reset to their default permissions, an existing Admin is left
// untouched (its password is never changed), and rows owned by the old built-in login are
// reassigned to the Admin.
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { MIN_PASSWORD_LENGTH, createUser } from "./auth.js";
import { LEGACY_OWNER_EMAIL, db, ensureDefaultRoles, initializeDb } from "./db.js";

export const DEFAULT_ADMIN_EMAIL = "admin@whish.local";

const generatePassword = () => crypto.randomBytes(12).toString("base64url"); // 16 chars

export const seedDatabase = ({ adminEmail = DEFAULT_ADMIN_EMAIL, adminPassword, adminName = "Administrator" } = {}) => {
  initializeDb();
  ensureDefaultRoles({ reset: true });

  const email = String(adminEmail).trim().toLowerCase();
  let admin = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  let generatedPassword = null;
  let created = false;

  if (!admin) {
    const password = adminPassword || (generatedPassword = generatePassword());
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Admin password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    admin = createUser({ email, full_name: adminName, password, role: "admin" });
    created = true;
  }

  // Rows created before accounts existed belong to the Admin from now on.
  const migrated = db.transaction(() => ({
    transactions: db.prepare("UPDATE transactions SET created_by = ? WHERE created_by = ?").run(email, LEGACY_OWNER_EMAIL).changes,
    daily_balances: db.prepare("UPDATE OR IGNORE daily_balances SET created_by = ? WHERE created_by = ?").run(email, LEGACY_OWNER_EMAIL).changes,
  }))();

  return {
    roles: db.prepare("SELECT name FROM roles ORDER BY id").all().map((r) => r.name),
    admin: { email, created },
    generatedPassword,
    migrated,
  };
};

// Called on every server start: if there are no user accounts at all, seed the roles and an Admin
// so the app is never left with nobody able to sign in. Uses SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD /
// SEED_ADMIN_NAME when set; otherwise admin@whish.local with a generated password.
// Returns the seed result when it seeded, or null when accounts already exist.
export const ensureInitialAdmin = (env = process.env) => {
  initializeDb();
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  if (n > 0) return null;
  return seedDatabase({
    adminEmail: env.SEED_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
    adminPassword: env.SEED_ADMIN_PASSWORD,
    adminName: env.SEED_ADMIN_NAME || "Administrator",
  });
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = argv[i].match(/^--(email|password|name)$/);
    if (match) args[match[1]] = argv[++i];
  }
  return args;
};

const isMainModule = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMainModule) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = seedDatabase({
      adminEmail: args.email || process.env.SEED_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
      adminPassword: args.password || process.env.SEED_ADMIN_PASSWORD,
      adminName: args.name || process.env.SEED_ADMIN_NAME || "Administrator",
    });
    console.log(`Roles: ${result.roles.join(", ")} (default permissions applied)`);
    if (result.admin.created) {
      console.log(`Admin account created: ${result.admin.email}`);
      if (result.generatedPassword) {
        console.log(`Generated password: ${result.generatedPassword}`);
        console.log("  → Shown only once. Sign in and store it safely (an Admin can reset passwords later).");
      }
    } else {
      console.log(`Admin account already exists: ${result.admin.email} (password unchanged)`);
    }
    if (result.migrated.transactions || result.migrated.daily_balances) {
      console.log(`Reassigned ${result.migrated.transactions} transactions and ${result.migrated.daily_balances} opening balances from the old built-in login to ${result.admin.email}`);
    }
  } catch (error) {
    console.error(`Seeding failed: ${error.message}`);
    process.exitCode = 1;
  }
}
