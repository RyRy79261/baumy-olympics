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
// `apps/web/src/app/api/mcp/[transport]/route.ts`. The connector URL is
// `<MCP_PUBLIC_URL>/api/mcp/mcp` (intake-tracker gotcha #7). mcp-handler 1.x
// chose that path from its `basePath`; 2.x serves whatever it is given, so
// this file answers 404 to every other `/api/mcp/*` path itself, after the
// token check (an unauthenticated caller gets the 401 first). 2.x serves
// Streamable HTTP only (stateless, no SSE, no Redis): the 2026-07-28
// protocol (with `server/discover`) and the 2025 one as a fallback.
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

/** The one path the endpoint serves: the connector URL's path. */
export const MCP_ENDPOINT_PATH = `${MCP_BASE_PATH}/mcp`;

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
  const mcp = createMcpHandler(
    (server) => registerMcpTools(server, deps.tools),
    { serverInfo: MCP_SERVER_INFO, verboseLogs: false },
  );
  // Behind withMcpAuth: a verified caller on any other path gets a 404.
  const base = (req: Request) =>
    new URL(req.url).pathname === MCP_ENDPOINT_PATH
      ? mcp(req)
      : Promise.resolve(new Response("Not found", { status: 404 }));

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
