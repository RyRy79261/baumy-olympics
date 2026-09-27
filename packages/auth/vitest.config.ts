import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // The first test to build a Better Auth instance pays for its import.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      reporter: ["text-summary", "json-summary", "json"],
      // Issue #6: the env resolvers and `authMayServe` are floored at 95%.
      // Floors only go up (AGENTS.md).
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
