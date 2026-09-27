import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig keeps JSX as written for Next; components under test need it
  // compiled to the React 19 automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    // Docker Postgres only: `pnpm db:local:test` (vitest.local.config.ts).
    exclude: ["**/node_modules/**", "**/.next/**", "**/*.local.test.ts"],
    // PGlite boots and replays the migrations per file, which can pass the
    // 10s hook default on a loaded CI runner.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["{lib,app,components}/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      // json-summary for the totals, json for the per-file table the CI
      // coverage comment shows (file-coverage-mode: changes).
      reporter: ["text-summary", "json-summary", "json"],
      // SPEC §10, AGENTS.md: `lib/**` is floored at 90%. Floors only go up.
      thresholds: {
        "lib/**": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // `import "server-only"` throws outside a React Server Component, which
      // would make every module under lib/ that guards itself untestable.
      // Point it at the package's own empty build (the file Next resolves under
      // the `react-server` condition) so the guard is inert under vitest.
      "server-only": path.resolve(
        import.meta.dirname,
        "node_modules/server-only/empty.js",
      ),
    },
  },
});
