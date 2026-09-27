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
      // Shared boundary schemas: every line is exercised by its test. Floors
      // only go up (AGENTS.md).
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
