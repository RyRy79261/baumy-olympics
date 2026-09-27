import { defineConfig } from "vitest/config";

// Ported from camp-404 `packages/db/vitest.config.ts`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // Docker Postgres only: `pnpm db:local:test` (vitest.local.config.ts).
    exclude: ["src/**/__tests__/**/*.local.test.ts"],
    // Each file boots its own PGlite and injects it through __setDbOverride.
    // Vitest gives each file its own module registry, so that module-global
    // override never leaks between files. Booting PGlite and replaying the
    // migrations is the cold cost, and under a loaded CI runner it can pass
    // vitest's 10s hook default, so the hooks get headroom.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/schema.ts"],
      // json-summary for the totals, json for the per-file table in the CI
      // coverage comment.
      reporter: ["text-summary", "json-summary", "json"],
      // SPEC §10 and AGENTS.md: packages/db is floored at 75%. Floors only go
      // up.
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    },
  },
});
