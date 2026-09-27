// The issuer of the MCP OAuth server (SPEC §6.3). Ported from intake-tracker
// `apps/web/src/lib/mcp/origin.ts`, tightened by its gotcha #2: `VERCEL_URL`
// is the deployment-hash host behind Vercel SSO, so a client that follows it
// gets a 403. It is never used here.
//
//   MCP_PUBLIC_URL set          → its origin (production: the custom domain);
//                                 https, or http on loopback only
//   unset, on Vercel            → null: every OAuth endpoint answers 503 and
//                                 says so (fail closed)
//   unset, off Vercel (dev, e2e)→ the request's own origin

type Env = Readonly<Record<string, string | undefined>>;

export const MCP_NOT_CONFIGURED =
  "MCP is not configured on this deployment: MCP_PUBLIC_URL is not set.";

export function mcpPublicOrigin(
  req: Request,
  env: Env = process.env,
): string | null {
  const configured = env.MCP_PUBLIC_URL?.trim();
  if (configured) {
    try {
      const u = new URL(configured);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      return u.protocol === "https:" || (loopback && u.protocol === "http:")
        ? u.origin
        : null;
    } catch {
      return null;
    }
  }
  if (env.VERCEL_ENV?.trim()) return null;
  return new URL(req.url).origin;
}

export const MCP_BASE_PATH = "/api/mcp";

export function oauthUrls(origin: string) {
  return {
    issuer: origin,
    authorizationEndpoint: `${origin}${MCP_BASE_PATH}/oauth/authorize`,
    tokenEndpoint: `${origin}${MCP_BASE_PATH}/oauth/token`,
    registrationEndpoint: `${origin}${MCP_BASE_PATH}/oauth/register`,
    revocationEndpoint: `${origin}${MCP_BASE_PATH}/oauth/revoke`,
    /** The protected resource: the MCP endpoint lands here in issue #24. */
    resource: `${origin}${MCP_BASE_PATH}`,
  };
}
