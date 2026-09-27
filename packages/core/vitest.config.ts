import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      reporter: ["text-summary", "json-summary", "json"],
      // AGENTS.md: core is floored at 95%, and the scoring maths at 100%.
      // Floors only go up.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
        "src/scoring/**/*.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
