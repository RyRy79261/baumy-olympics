// Test-only: what `verifyToken` (lib/mcp/verify.ts) says about a bearer
// token, so the e2e OAuth round trip can prove a token works, is read-only,
// and stops working when revoked, before the MCP endpoint itself exists
// (issue #24). Answers 404, like a route that does not exist, unless
// E2E_TEST_MODE=1, which refuses to boot on Vercel (lib/test-mode.ts).
//
//   GET /api/test/mcp-token  (Authorization: Bearer <token>)
//     → 200 {memberId, scopes, clientId} | 401 {error: "invalid_token"}

import { isTestMode } from "@/lib/test-mode";
import { bearerToken, verifyToken } from "@/lib/mcp/verify";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isTestMode()) return new Response(null, { status: 404 });
  const info = await verifyToken(bearerToken(req.headers.get("authorization")));
  return info
    ? Response.json(info, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: "invalid_token" }, { status: 401 });
}
