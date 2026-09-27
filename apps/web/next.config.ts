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
  // The consent screen hands out a code with one click, so no other site may
  // frame it (clickjacking; intake-tracker sets frame-ancestors 'none').
  async headers() {
    const noFraming = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      ...["/oauth/consent", "/api/mcp/oauth/authorize"].map((source) => ({
        source,
        headers: noFraming,
      })),
      // The offline page's service worker (issue #29): always checked
      // afresh, so a new version reaches the kiosk on its next load.
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ];
  },
};

export default config;
