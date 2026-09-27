import type { NextConfig } from "next";
import { assertTestModeAllowed } from "./lib/test-mode";

// Refuse E2E_TEST_MODE=1 on Vercel before anything else: next build, next start
// and next dev all load this file first, so the misconfiguration fails at boot.
assertTestModeAllowed();

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The OAuth discovery documents live at dot paths the app router cannot
  // route (intake-tracker's briefing, B.3). The `/api/mcp` suffixed forms
  // are what RFC 9728 and RFC 8414 clients try for a resource with a path.
  async rewrites() {
    return [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/mcp",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ].map((source) => ({
      source,
      destination: source.includes("authorization-server")
        ? "/api/mcp/well-known/oauth-authorization-server"
        : "/api/mcp/well-known/oauth-protected-resource",
    }));
  },
};

export default config;
