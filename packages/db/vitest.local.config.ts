import { defineConfig } from "vitest/config";

// Tests that need the real Docker Postgres (docker-compose.local.yml), run with
// `pnpm db:local:test` after `pnpm db:local:up && pnpm db:local:migrate`.
// PGlite is one connection, so it serialises everything; only a real server
// can show that concurrent statements still count correctly.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.local.test.ts"],
    testTimeout: 30_000,
  },
});
