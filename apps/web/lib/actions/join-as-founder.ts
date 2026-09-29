import { z } from "zod";
import { isFounderEmail } from "@baumy/auth/env";
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
import { fail } from "./result";

// How the first admin exists (SPEC §6.2): an account whose email is on
// FOUNDER_EMAILS, and verified, joins as an admin without an invite code.
// Verified matters: sign-up is open, so anyone could sign up with a founder's
// address and a password; only the owner of the inbox can confirm it (or
// Google, which only signs in verified addresses).

const input = z.strictObject({
  displayName: DisplayName.describe("The name housemates will see."),
  color: MemberColor.optional().describe("Your colour, as #rrggbb."),
  avatarSprite: AvatarSprite.optional().describe("Your avatar."),
  avatarImageId: JoinAvatarId.describe(
    "A character from the household's gallery, if you picked one.",
  ),
});

export interface JoinAsFounderData {
  memberId: string;
  role: "admin";
}

export const joinAsFounder = defineAction({
  name: "join_as_founder",
  title: "Join as a founder",
  description:
    "Makes the signed-in account a household admin when its verified email is on the founders list (FOUNDER_EMAILS).",
  consent: "Join the household as a founding admin",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "account",
  input,
  async execute(ctx, { displayName, color, avatarSprite, avatarImageId }) {
    const actor = await joiningAccount(ctx);
    if (isFailure(actor)) return actor;
    if (avatarImageId) {
      const refused = await pickableAvatar(ctx, avatarImageId);
      if (refused) return refused;
    }

    if (!isFounderEmail(process.env, actor.email)) {
      return fail(
        "NOT_A_FOUNDER",
        "Your email is not on the founders list. Ask a housemate for an invite code.",
      );
    }
    if (!actor.emailVerified) {
      return fail(
        "EMAIL_NOT_VERIFIED",
        "Confirm your email first: open the link we sent you, then try again.",
      );
    }

    const member = await insertMember(ctx.db, {
      householdId: ctx.householdId,
      authUserId: actor.userId,
      displayName,
      avatarSprite: avatarSprite ?? DEFAULT_AVATAR,
      avatarImageId: avatarImageId ?? null,
      color: color ?? defaultColorFor(actor.userId),
      role: "admin",
      createdAt: ctx.now,
    });
    if (!member) return ALREADY_JOINED;

    const data: JoinAsFounderData = { memberId: member.id, role: "admin" };
    return {
      ok: true,
      data,
      joinedAs: member.id,
      audit: {
        entity: "member",
        entityId: member.id,
        payload: { founder: true, role: "admin", displayName },
      },
    };
  },
});
