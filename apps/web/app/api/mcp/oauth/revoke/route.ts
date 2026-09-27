import { corsPreflight } from "@/lib/mcp/http";
import { handleRevoke } from "@/lib/mcp/routes";
import { mcpRouteDeps } from "@/lib/mcp/wiring";

// RFC 7009 token revocation (SPEC §6.3). lib/mcp/routes.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

export function POST(req: Request): Promise<Response> {
  return handleRevoke(req, mcpRouteDeps());
}
