import { createHash } from "node:crypto";
import { findMemberByAuthUserId } from "@baumy/db/members";
import {
  AvatarHairColor,
  AvatarHairStyle,
  AvatarShirtColor,
  AvatarSkinTone,
  MEMBER_COLORS,
  MemberAvatar,
  type AvatarSprite,
} from "@baumy/types";
import type { MemberActor } from "@/lib/auth";
import type { ActionCtx } from "./define";
import { fail, type ActionFailure } from "./result";

// What the two ways into the household (`redeem_invite`, `join_as_founder`)
// share: who may still join, and the look a new member starts with.

export const DEFAULT_AVATAR: AvatarSprite = "cat";

/**
 * The 16-bit character a newcomer may pick on the join form (issue #106),
 * as the flat fields a form posts. All four or none: none leaves
 * `members.avatar` null, so the member gets their default.
 */
export const JOIN_CHARACTER = {
  hairStyle: AvatarHairStyle.optional().describe("Your hair style."),
  hairColor: AvatarHairColor.optional().describe("Your hair colour."),
  skinTone: AvatarSkinTone.optional().describe("Your skin tone."),
  shirtColor: AvatarShirtColor.optional().describe("Your shirt colour."),
};

type JoinCharacter = Partial<MemberAvatar>;

/** The whole character, or null when none was given; a part is refused. */
export function joinCharacter(input: JoinCharacter): MemberAvatar | null {
  const parsed = MemberAvatar.safeParse({
    hairStyle: input.hairStyle,
    hairColor: input.hairColor,
    skinTone: input.skinTone,
    shirtColor: input.shirtColor,
  });
  return parsed.success ? parsed.data : null;
}

/** For the join inputs' refine: all four character fields, or none. */
export function wholeCharacterOrNone(input: JoinCharacter): boolean {
  const given = [
    input.hairStyle,
    input.hairColor,
    input.skinTone,
    input.shirtColor,
  ].filter((v) => v !== undefined).length;
  return given === 0 || given === 4;
}

export const PART_CHARACTER = {
  message:
    "Pick your whole character: hair style, hair colour, skin and shirt.",
  path: ["hairStyle"],
};

/**
 * A starting colour for an account, the same every time for the same user,
 * so a retried join does not reshuffle it. The member changes it later.
 */
export function defaultColorFor(userId: string): string {
  const byte = createHash("sha256").update(userId).digest()[0]!;
  return MEMBER_COLORS[byte % MEMBER_COLORS.length]!;
}

/**
 * The account that may join now, or the refusal. An active member is already
 * in; a deactivated one is out until an admin brings them back, and no code
 * overrides that.
 */
export async function joiningAccount(
  ctx: ActionCtx,
): Promise<MemberActor | ActionFailure> {
  const { actor } = ctx;
  if (actor.kind !== "member") {
    return fail("FORBIDDEN", "Join from your own phone or computer.");
  }
  if (actor.memberId) {
    return fail("ALREADY_MEMBER", "You're already in the household.");
  }
  const existing = await findMemberByAuthUserId(ctx.db, actor.userId);
  if (existing?.deactivatedAt) {
    return fail(
      "MEMBERSHIP_ENDED",
      "Your membership was switched off. Ask a household admin to turn it back on.",
    );
  }
  if (existing) {
    return fail("ALREADY_MEMBER", "You're already in the household.");
  }
  return actor;
}

export function isFailure(v: MemberActor | ActionFailure): v is ActionFailure {
  return "ok" in v;
}

/** When the member row could not be created because one appeared meanwhile. */
export const ALREADY_JOINED = fail(
  "ALREADY_MEMBER",
  "You're already in the household.",
);
