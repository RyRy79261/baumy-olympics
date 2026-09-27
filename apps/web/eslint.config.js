import next from "@baumy/eslint-config/next";

export default [
  ...next,
  {
    // Playwright output (e2e reports and traces), never source.
    ignores: ["playwright-report/**", "test-results/**"],
  },
];
