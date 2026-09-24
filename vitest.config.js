import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Kept separate from vite.config.js so test-only settings (environment, setup, env vars) stay here.
// Backend tests run in Node; frontend tests opt into jsdom with a `@vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
  test: {
    include: ["tests/**/*.test.{js,jsx}"],
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup.js"],
    // The API module opens its SQLite database on import; tests always get a fresh in-memory one.
    // A fixed signing secret (so no server/.jwt-secret file is written) and cheap bcrypt hashing
    // (cost 4 instead of 12) keep auth tests fast.
    env: { HAWALAFLOW_DB_PATH: ":memory:", JWT_SECRET: "test-secret-do-not-use-in-production", BCRYPT_ROUNDS: "4" },
  },
});
