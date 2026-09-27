import "server-only";

import { startOfBerlinDay } from "@baumy/core";
import { createHttpDb, withTransaction, type Queryable } from "@baumy/db";
import {
  addAiTokens,
  claimAiCommand,
  type ClaimAiCommand,
} from "@baumy/db/ai-usage";
import type { RequestCtx } from "@/lib/actions/define";

// The per-member daily limit on Baumy commands (SPEC §6.8
// `AI_DAILY_COMMANDS_PER_MEMBER`) and the `ai_usage` row each command
// writes. A day is a Berlin calendar day.

/** Commands per member per Berlin day when the variable is unset. */
export const DEFAULT_DAILY_COMMANDS = 50;

type EnvBag = Readonly<Record<string, string | undefined>>;

/**
 * `AI_DAILY_COMMANDS_PER_MEMBER` as a whole number of commands; 0 turns the
 * command off. Unset or not a whole number falls back to the default.
 */
export function dailyCommandLimit(env: EnvBag = process.env): number {
  const raw = env.AI_DAILY_COMMANDS_PER_MEMBER?.trim();
  if (!raw || !/^\d{1,6}$/.test(raw)) return DEFAULT_DAILY_COMMANDS;
  return Number(raw);
}

/** Claim one of today's commands for the acting member, in a transaction. */
export function claimCommand(
  ctx: RequestCtx,
  model: string,
  limit: number,
): Promise<ClaimAiCommand> {
  return withTransaction((tx) =>
    claimAiCommand(tx as unknown as Queryable, {
      householdId: ctx.householdId,
      memberId: ctx.actor.memberId!,
      model,
      dayStart: startOfBerlinDay(ctx.now),
      limit,
      now: ctx.now,
    }),
  );
}

/** Add a finished command's tokens to its row. */
export function recordCommandTokens(
  usageId: string,
  tokens: { inputTokens: number; outputTokens: number },
): Promise<void> {
  return addAiTokens(createHttpDb() as unknown as Queryable, usageId, tokens);
}
