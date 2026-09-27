import { z } from "zod";

/**
 * Where a request came from (SPEC §6.3, ADR 0002): the hub UI, the kiosk, the
 * in-app AI command, an MCP client or baumy-brain (Telegram).
 *
 * The same values, in the same order, are the `surface` pg enum in
 * packages/db/src/schema.ts, which every `source` column uses
 * (`action_requests`, `audit_events`, later `completions`). A test in the web
 * app compares the two.
 */
export const Surface = z.enum(["ui", "kiosk", "ai", "mcp", "brain"]);

export type Surface = z.infer<typeof Surface>;

export const SURFACES: readonly Surface[] = Surface.options;
