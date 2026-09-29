import "server-only";

import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  findActiveMember,
  findActiveMemberByTelegramUserId,
} from "@baumy/db/members";
import {
  findLiveServiceToken,
  touchServiceToken,
} from "@baumy/db/service-tokens";
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
    verifyToken: async (token) => {
      const found = await findLiveServiceToken(db(), token);
      if (!found) return null;
      // "Last used" on /admin/connections (issue #104). A failed write must
      // not turn a good token away.
      try {
        await touchServiceToken(db(), found, now());
      } catch (err) {
        console.error("[brain] could not record last_used_at", err);
      }
      return { name: found.name, scopes: found.scopes };
    },
    findMember: (telegramUserId) =>
      findActiveMemberByTelegramUserId(db(), HOUSEHOLD_ID, telegramUserId),
    findHousemate: (memberId) => findActiveMember(db(), HOUSEHOLD_ID, memberId),
    specs: () => (specs ??= toolSpecs("brain")),
    isAction: (name) => actionKind(name) !== undefined,
    runAction: (name, input, ctx) => runAction(name, input, ctx),
    rateLimiter,
    householdId: HOUSEHOLD_ID,
    now,
    logError: (message, err) => console.error(message, err),
  };
}
