import { z } from "zod";
import { insertInviteCode } from "@baumy/db/invite-codes";
import { MemberRole } from "@baumy/types";
import { generateInviteCode } from "@/lib/codes";
import { defineAction } from "./define";

// An admin mints an invite code on /admin/members (SPEC §6.2). Admin actions
// are UI only (SPEC §12 decision 10).

export const INVITE_MAX_USES_LIMIT = 20;
export const INVITE_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

/** Codes are random; a collision is astronomically rare, but never fatal. */
const MINT_ATTEMPTS = 5;

const input = z.strictObject({
  role: MemberRole.default("member").describe(
    "The role whoever redeems it gets.",
  ),
  maxUses: z.coerce
    .number({ error: "Enter a number of uses." })
    .int("Use a whole number.")
    .min(1, "At least 1 use.")
    .max(INVITE_MAX_USES_LIMIT, `At most ${INVITE_MAX_USES_LIMIT} uses.`)
    .default(1)
    .describe("How many people can join with it."),
  expiresInDays: z.coerce
    .number({ error: "Enter a number of days." })
    .int("Use a whole number.")
    .min(1, "At least 1 day.")
    .max(INVITE_MAX_DAYS, `At most ${INVITE_MAX_DAYS} days.`)
    .default(7)
    .describe("Days until it stops working."),
});

export interface MintInviteData {
  code: string;
  role: "admin" | "member";
  maxUses: number;
  expiresAt: string;
}

export const mintInvite = defineAction({
  name: "mint_invite",
  title: "Create an invite code",
  description:
    "Creates a household invite code with a role, a number of uses and an expiry.",
  consent: "Create household invite codes",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  input,
  async execute(ctx, { role, maxUses, expiresInDays }) {
    const expiresAt = new Date(ctx.now.getTime() + expiresInDays * DAY_MS);
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const row = await insertInviteCode(ctx.db, {
        code: generateInviteCode(),
        householdId: ctx.householdId,
        role,
        maxUses,
        expiresAt,
        createdBy: ctx.actor.memberId!,
        createdAt: ctx.now,
      });
      if (!row) continue;
      const data: MintInviteData = {
        code: row.code,
        role: row.role,
        maxUses: row.maxUses,
        expiresAt: row.expiresAt.toISOString(),
      };
      return {
        ok: true,
        data,
        audit: {
          entity: "invite_code",
          entityId: row.code,
          payload: { role, maxUses, expiresAt: data.expiresAt },
        },
      };
    }
    throw new Error("mint_invite: no free code after several attempts");
  },
});
