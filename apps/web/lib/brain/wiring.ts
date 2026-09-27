import "server-only";

import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findActiveMemberByTelegramUserId } from "@baumy/db/members";
import { findLiveServiceToken } from "@baumy/db/service-tokens";
import { actionKind, runAction } from "@/lib/actions/registry";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { now } from "@/lib/clock";
import { rateLimiter } from "@/lib/rate-limit";
import type { BrainEndpointDeps } from "./endpoint";

// The real dependencies of the brain endpoint (issue #27); tests pass their
// own. The token and the Telegram mapping are read on every request, so a
// revoked token or an unlinked member stops working at once.

/** The registry's brain tools, generated once per server instance. */
let specs: ReturnType<typeof toolSpecs> | undefined;

const db = () => createHttpDb() as unknown as Queryable;

export function brainEndpointDeps(): BrainEndpointDeps {
  return {
    verifyToken: (token) => findLiveServiceToken(db(), token),
    findMember: (telegramUserId) =>
      findActiveMemberByTelegramUserId(db(), HOUSEHOLD_ID, telegramUserId),
    specs: () => (specs ??= toolSpecs("brain")),
    isAction: (name) => actionKind(name) !== undefined,
    runAction: (name, input, ctx) => runAction(name, input, ctx),
    rateLimiter,
    householdId: HOUSEHOLD_ID,
    now,
    logError: (message, err) => console.error(message, err),
  };
}
