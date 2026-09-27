import type { NextConfig } from "next";
import { assertTestModeAllowed } from "./lib/test-mode";

// Refuse E2E_TEST_MODE=1 on Vercel before anything else: next build, next start
// and next dev all load this file first, so the misconfiguration fails at boot.
assertTestModeAllowed();

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
};

export default config;
