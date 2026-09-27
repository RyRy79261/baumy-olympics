import "server-only";

import { CLAUDE_MODELS, COMMAND_TIER } from "@baumy/ai-prompts";
import { createHttpDb, type Queryable } from "@baumy/db";
import { listChoreNames } from "@baumy/db/chores";
import { listActiveMembers } from "@baumy/db/members";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { actionKind, proposeAction, runAction } from "@/lib/actions/registry";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { uiRequestCtx } from "@/lib/actions/ui";
import { now } from "@/lib/clock";
import { claudeClient } from "@/lib/integrations/claude";
import type {
  AiRouteDeps,
  CommandRouteDeps,
  ProposalRouteDeps,
  RunRouteDeps,
} from "./routes";
import { claimCommand, dailyCommandLimit, recordCommandTokens } from "./usage";

// The real dependencies of the AI routes (lib/ai/routes.ts), in one place so
// the route files stay one line each and the tests can pass their own.

const requestCtx: AiRouteDeps["requestCtx"] = (surface, requestId, pin) =>
  surface === "kiosk"
    ? kioskRequestCtx(requestId, pin)
    : uiRequestCtx(requestId);

const loadHousehold: AiRouteDeps["loadHousehold"] = async (ctx) => {
  const db = createHttpDb() as unknown as Queryable;
  const [members, chores] = await Promise.all([
    listActiveMembers(db, ctx.householdId),
    listChoreNames(db, ctx.householdId),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, displayName: m.displayName })),
    chores,
  };
};

const logError = (message: string, err: unknown) => console.error(message, err);

export function commandRouteDeps(): CommandRouteDeps {
  return {
    requestCtx,
    loadHousehold,
    logError,
    claude: () => claudeClient(),
    model: CLAUDE_MODELS[COMMAND_TIER],
    dailyLimit: () => dailyCommandLimit(),
    claim: claimCommand,
    recordTokens: recordCommandTokens,
    loop: {
      tools: toolSpecs("ai"),
      kindOf: actionKind,
      runAction: (name, input, ctx) => runAction(name, input, ctx),
      propose: proposeAction,
      nowMs: () => now().getTime(),
    },
  };
}

export function proposalRouteDeps(): ProposalRouteDeps {
  return { requestCtx, loadHousehold, logError, propose: proposeAction };
}

export function runRouteDeps(): RunRouteDeps {
  return {
    requestCtx,
    runAction: (name, input, ctx) => runAction(name, input, ctx),
  };
}
