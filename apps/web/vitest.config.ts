import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      include: ["{lib,app,components}/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      // json-summary for the totals, json for the per-file table the CI
      // coverage comment shows (file-coverage-mode: changes).
      reporter: ["text-summary", "json-summary", "json"],
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
