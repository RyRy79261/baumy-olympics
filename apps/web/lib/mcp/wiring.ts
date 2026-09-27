import "server-only";

import { randomUUID } from "node:crypto";
import { createHttpDb, withTransaction, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { runAction } from "@/lib/actions/registry";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { uiRequestCtx } from "@/lib/actions/ui";
import { now } from "@/lib/clock";
import { rateLimiter } from "@/lib/rate-limit";
import type { McpEndpointDeps } from "./endpoint";
import type { McpRouteDeps } from "./routes";
import { verifyToken } from "./verify";

// The real dependencies of the MCP OAuth routes; tests pass their own.
export function mcpRouteDeps(): McpRouteDeps {
  return {
    env: process.env,
    db: () => createHttpDb() as unknown as Queryable,
    withTransaction,
    rateLimiter,
    requestCtx: uiRequestCtx,
    runAction: (name, input, ctx) => runAction(name, input, ctx),
  };
}

/** The registry's MCP tools, generated once per server instance. */
let specs: ReturnType<typeof toolSpecs> | undefined;

// The real dependencies of the MCP endpoint (issue #24); tests pass their own.
export function mcpEndpointDeps(): McpEndpointDeps {
  return {
    env: process.env,
    verifyToken: (token) => verifyToken(token),
    tools: {
      specs: () => (specs ??= toolSpecs("mcp")),
      runAction: (name, input, ctx) => runAction(name, input, ctx),
      householdId: HOUSEHOLD_ID,
      now,
      newRequestId: randomUUID,
      logError: (message, err) => console.error(message, err),
    },
  };
}
