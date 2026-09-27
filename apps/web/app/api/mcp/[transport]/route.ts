import { createMcpEndpoint } from "@/lib/mcp/endpoint";
import { corsPreflight } from "@/lib/mcp/http";
import { mcpEndpointDeps } from "@/lib/mcp/wiring";

// The MCP endpoint (SPEC §6.3, issue #24): Streamable HTTP at /api/mcp/mcp,
// bearer-checked with verifyToken on every request, tools from the registry.
// lib/mcp/endpoint.ts and lib/mcp/tools.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handle = createMcpEndpoint(mcpEndpointDeps());

export const OPTIONS = corsPreflight;
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
