import { corsPreflight } from "@/lib/mcp/http";
import { handleToken } from "@/lib/mcp/routes";
import { mcpRouteDeps } from "@/lib/mcp/wiring";

// The OAuth token endpoint (SPEC §6.3): authorization_code with PKCE S256,
// and refresh_token rotated in a transaction. Never cached. lib/mcp/routes.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

export function POST(req: Request): Promise<Response> {
  return handleToken(req, mcpRouteDeps());
}
