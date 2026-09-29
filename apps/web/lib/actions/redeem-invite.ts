import { z } from "zod";
import {
  claimInviteCode,
  findInviteCode,
  inviteCodeState,
} from "@baumy/db/invite-codes";
import { insertMember } from "@baumy/db/members";
import {
  AvatarSprite,
  DisplayName,
  JoinAvatarId,
  MemberColor,
} from "@baumy/types";
import { pickableAvatar } from "./avatars";
import { defineAction } from "./define";
import {
  ALREADY_JOINED,
  DEFAULT_AVATAR,
  defaultColorFor,
  isFailure,
  joiningAccount,
} from "./joining";
import { fail, type ActionFailure } from "./result";

// `/join` (SPEC §6.2): a signed-in account with no member row redeems an
// invite code and becomes a member with the code's role. The use is claimed
// and the member created in ONE transaction (runAction's `runJoining`), so a
// failure gives the use back, and two people racing for the last use of a
// code cannot both get in (the claim is one UPDATE … RETURNING).

const input = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your invite code.")
    .max(64, "That is too long for an invite code.")
    .describe("The invite code a housemate gave you."),
  displayName: DisplayName.describe("The name housemates will see."),
  color: MemberColor.optional().describe("Your colour, as #rrggbb."),
  avatarSprite: AvatarSprite.optional().describe("Your avatar."),
  avatarImageId: JoinAvatarId.describe(
    "A character from the household's gallery, if you picked one.",
  ),
});

const ASK_AGAIN = "Ask a housemate for a new one.";

const UNUSABLE: Record<
  "missing" | "revoked" | "expired" | "used_up",
  ActionFailure
> = {
  missing: fail(
    "INVITE_NOT_FOUND",
    "That invite code doesn't exist. Check the spelling, or ask a housemate for a new one.",
  ),
  revoked: fail(
    "INVITE_REVOKED",
    `That invite code was cancelled. ${ASK_AGAIN}`,
  ),
  expired: fail("INVITE_EXPIRED", `That invite code has expired. ${ASK_AGAIN}`),
  used_up: fail(
    "INVITE_USED_UP",
    `That invite code has already been used. ${ASK_AGAIN}`,
  ),
};

export interface RedeemInviteData {
  memberId: string;
  role: "admin" | "member";
}

export const redeemInvite = defineAction({
  name: "redeem_invite",
  title: "Join with an invite code",
  description:
    "Redeems a household invite code for the signed-in account, which becomes a household member with the code's role.",
  consent: "Join the household with an invite code",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "account",
  // Codes are guessable only by brute force; keep that slow.
  rateLimit: { perMember: 10, perIp: 30, windowMs: 15 * 60_000 },
  input,
  async execute(
    ctx,
    { code, displayName, color, avatarSprite, avatarImageId },
  ) {
    const account = await joiningAccount(ctx);
    if (isFailure(account)) return account;
    if (avatarImageId) {
      const refused = await pickableAvatar(ctx, avatarImageId);
      if (refused) return refused;
    }
    const { userId } = account;

    const claimed = await claimInviteCode(ctx.db, code, ctx.now);
    if (!claimed) {
      const row = await findInviteCode(ctx.db, code);
      if (!row) return UNUSABLE.missing;
      const state = inviteCodeState(row, ctx.now);
      // "active" here means another redeem took the last use between our
      // claim and this read.
      return UNUSABLE[state === "active" ? "used_up" : state];
    }

    const member = await insertMember(ctx.db, {
      // One household (SPEC §5): the code's, which is the request's.
      householdId: claimed.householdId,
      authUserId: userId,
      displayName,
      avatarSprite: avatarSprite ?? DEFAULT_AVATAR,
      avatarImageId: avatarImageId ?? null,
      color: color ?? defaultColorFor(userId),
      role: claimed.role,
      createdAt: ctx.now,
    });
    // The same account joined in a parallel request. Failing rolls this
    // transaction back, which returns the code's use.
    if (!member) return ALREADY_JOINED;

    const data: RedeemInviteData = { memberId: member.id, role: member.role };
    return {
      ok: true,
      data,
      joinedAs: member.id,
      audit: {
        entity: "member",
        entityId: member.id,
        payload: { code: claimed.code, role: member.role, displayName },
      },
    };
  },
});
