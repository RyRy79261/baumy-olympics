import { defineConfig } from "vitest/config";

export default defineConfig({
  // Components are compiled to the React 19 automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      reporter: ["text-summary", "json-summary", "json"],
      // A new package starts with a floor; floors only go up (AGENTS.md).
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
