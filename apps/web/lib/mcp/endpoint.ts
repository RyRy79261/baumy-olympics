import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { CORS_HEADERS, oauthError } from "./http";
import { MCP_BASE_PATH, MCP_NOT_CONFIGURED, mcpPublicOrigin } from "./origin";
import {
  registerMcpTools,
  toAuthInfo,
  type McpCaller,
  type McpToolDeps,
} from "./tools";

// The MCP endpoint (SPEC §6.3, issue #24), after intake-tracker
// `apps/web/src/app/api/mcp/[transport]/route.ts`. mcp-handler serves the
// Streamable HTTP transport at `<basePath>/mcp`, so the connector URL is
// `<MCP_PUBLIC_URL>/api/mcp/mcp` (intake-tracker gotcha #7); SSE is off, so
// no Redis is needed.
//
// Every request:
//   1. answers 503 while the issuer is unknown (MCP_PUBLIC_URL unset on
//      Vercel), like the OAuth endpoints;
//   2. checks the bearer with `verifyToken` (no cache: a revoked or expired
//      token, or a deactivated member's, is a 401 at once), and the 401
//      carries `WWW-Authenticate: Bearer resource_metadata=…` so the client
//      can find our authorization server;
//   3. serves tools/list and tools/call from the registry (tools.ts);
//   4. adds the CORS headers claude.ai needs (it calls from another origin;
//      the token is a header, never a cookie, so `*` is safe).

export interface McpEndpointDeps {
  env: Readonly<Record<string, string | undefined>>;
  verifyToken: (token: string | undefined) => Promise<McpCaller | null>;
  tools: McpToolDeps;
}

export const MCP_SERVER_INFO = { name: "baumy", version: "1.0.0" } as const;

/** Where the protected resource metadata lives (next.config.ts rewrite). */
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export function createMcpEndpoint(
  deps: McpEndpointDeps,
): (req: Request) => Promise<Response> {
  const base = createMcpHandler(
    (server) => registerMcpTools(server, deps.tools),
    { serverInfo: MCP_SERVER_INFO },
    {
      basePath: MCP_BASE_PATH,
      disableSse: true,
      maxDuration: 60,
      verboseLogs: false,
    },
  );

  const verify = async (_req: Request, bearer?: string) => {
    const caller = await deps.verifyToken(bearer);
    return caller && bearer ? toAuthInfo(bearer, caller) : undefined;
  };

  return async (req) => {
    const origin = mcpPublicOrigin(req, deps.env);
    if (!origin) {
      return oauthError("temporarily_unavailable", MCP_NOT_CONFIGURED, 503);
    }
    const authed = withMcpAuth(base, verify, {
      required: true,
      resourceUrl: origin,
      resourceMetadataPath: RESOURCE_METADATA_PATH,
    });
    return withCors(await authed(req));
  };
}
