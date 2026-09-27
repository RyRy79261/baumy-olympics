import { and, count, eq, gte, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { lockMember } from "./members";
import { aiUsage } from "./schema";

// What the AI features cost (SPEC §5 `ai_usage`, §6.3). A Baumy command is
// one `anthropic` row: `claimAiCommand` inserts it before the first Claude
// call, which is also where the per-member daily limit is enforced, and
// `addAiTokens` adds each call's tokens to it as the tool loop goes.

export type ClaimAiCommand =
  { ok: true; usageId: string; used: number } | { ok: false; used: number };

/**
 * Claim one of the member's commands for the day that started at `dayStart`
 * (Berlin midnight, from the caller). Runs in the caller's transaction: the
 * member row is locked first, so two commands at once are counted one after
 * the other and the limit holds. `used` counts this one when it was claimed.
 * A `limit` of 0 claims nothing.
 */
export async function claimAiCommand(
  tx: Queryable,
  input: {
    householdId: string;
    memberId: string;
    model: string;
    dayStart: Date;
    limit: number;
    now: Date;
  },
): Promise<ClaimAiCommand> {
  const member = await lockMember(tx, input.householdId, input.memberId);
  if (!member) throw new Error("claimAiCommand: no such member");
  const [row] = await tx
    .select({ n: count() })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.memberId, input.memberId),
        eq(aiUsage.provider, "anthropic"),
        gte(aiUsage.at, input.dayStart),
      ),
    );
  const used = row?.n ?? 0;
  if (used >= input.limit) return { ok: false, used };
  const [inserted] = await tx
    .insert(aiUsage)
    .values({
      householdId: input.householdId,
      memberId: input.memberId,
      provider: "anthropic",
      model: input.model,
      at: input.now,
    })
    .returning({ id: aiUsage.id });
  return { ok: true, usageId: inserted!.id, used: used + 1 };
}

/** Add one Claude call's tokens to a command's row. */
export async function addAiTokens(
  db: Queryable,
  usageId: string,
  tokens: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await db
    .update(aiUsage)
    .set({
      inputTokens: sql`${aiUsage.inputTokens} + ${Math.max(0, Math.round(tokens.inputTokens))}`,
      outputTokens: sql`${aiUsage.outputTokens} + ${Math.max(0, Math.round(tokens.outputTokens))}`,
    })
    .where(eq(aiUsage.id, usageId));
}
