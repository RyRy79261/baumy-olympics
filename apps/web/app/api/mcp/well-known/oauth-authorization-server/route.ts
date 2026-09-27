import { corsPreflight } from "@/lib/mcp/http";
import { handleAuthServerMetadata } from "@/lib/mcp/routes";

// RFC 8414 metadata, served at /.well-known/oauth-authorization-server by the
// rewrite in next.config.ts (the app router does not route dot folders).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

export function GET(req: Request): Response {
  return handleAuthServerMetadata(req, { env: process.env });
}
