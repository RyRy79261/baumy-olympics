import { corsPreflight } from "@/lib/mcp/http";
import { handleRegister } from "@/lib/mcp/routes";
import { mcpRouteDeps } from "@/lib/mcp/wiring";

// RFC 7591 Dynamic Client Registration (SPEC §6.3). lib/mcp/routes.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

export function POST(req: Request): Promise<Response> {
  return handleRegister(req, mcpRouteDeps());
}
