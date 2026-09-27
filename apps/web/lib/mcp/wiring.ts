import "server-only";

import { createHttpDb, withTransaction, type Queryable } from "@baumy/db";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { rateLimiter } from "@/lib/rate-limit";
import type { McpRouteDeps } from "./routes";

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
