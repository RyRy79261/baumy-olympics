import { handleAuthorizeGet, handleAuthorizePost } from "@/lib/mcp/routes";
import { mcpRouteDeps } from "@/lib/mcp/wiring";

// The OAuth authorize endpoint (SPEC §6.3): GET checks the request and opens
// the consent page (/oauth/consent); POST is that page's form. The logic is
// lib/mcp/routes.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleAuthorizeGet(req, mcpRouteDeps());
}

export function POST(req: Request): Promise<Response> {
  return handleAuthorizePost(req, mcpRouteDeps());
}
