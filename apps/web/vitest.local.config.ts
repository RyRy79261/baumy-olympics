import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests that need the real Docker Postgres (docker-compose.local.yml), run
// with `pnpm db:local:test` after `pnpm db:local:up && pnpm db:local:migrate`.
// PGlite is one connection, so it serialises everything; only a real server
// shows that concurrent requests with one idempotency key execute once.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.local.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "server-only": path.resolve(
        import.meta.dirname,
        "node_modules/server-only/empty.js",
      ),
    },
  },
});
