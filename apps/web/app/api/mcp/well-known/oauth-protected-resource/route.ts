import { corsPreflight } from "@/lib/mcp/http";
import { handleProtectedResourceMetadata } from "@/lib/mcp/routes";

// RFC 9728 metadata, served at /.well-known/oauth-protected-resource by the
// rewrite in next.config.ts. It points MCP clients at our authorization
// server; the MCP endpoint itself is issue #24.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

export function GET(req: Request): Response {
  return handleProtectedResourceMetadata(req, { env: process.env });
}
