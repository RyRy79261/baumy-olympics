import { z } from "zod";
import {
  findMemberIdByTelegramUserId,
  lockActiveAdmins,
  lockMember,
  updateMember,
  type MemberPatch,
} from "@baumy/db/members";
import {
  AvatarSprite,
  DisplayName,
  MemberColor,
  MemberRole,
  TelegramUserId,
} from "@baumy/types";
import { confirmedActor, isFailure } from "./account-security";
import { defineAction } from "./define";
import { fail } from "./result";

// The admin members page (/admin/members): change a member's role, switch
// them off or back on, edit how they look, or set or clear their Telegram
// user id by hand (issue #27; members normally link themselves with
// `/link <code>`). Admin only, UI only (SPEC §12 decision 10).
//
// The household never loses its last admin: demoting or deactivating locks
// every active admin row first (in id order, so two admins demoting each
// other cannot deadlock) and refuses when nobody else would be left.

const memberId = z.uuid("Pick a member.");

const input = z.discriminatedUnion(
  "op",
  [
    z.strictObject({
      op: z.literal("set_role"),
      memberId,
      role: MemberRole,
    }),
    z.strictObject({ op: z.literal("deactivate"), memberId }),
    z.strictObject({ op: z.literal("reactivate"), memberId }),
    // No id (an empty field) unlinks.
    z.strictObject({
      op: z.literal("set_telegram"),
      memberId,
      telegramUserId: TelegramUserId.nullish(),
    }),
    z
      .strictObject({
        op: z.literal("edit"),
        memberId,
        displayName: DisplayName.optional(),
        color: MemberColor.optional(),
        avatarSprite: AvatarSprite.optional(),
      })
      .refine(
        (v) =>
          v.displayName !== undefined ||
          v.color !== undefined ||
          v.avatarSprite !== undefined,
        { message: "Change the name, the colour or the avatar." },
      ),
  ],
  { error: "Pick what to change." },
);

export interface ManageMembersData {
  memberId: string;
  displayName: string;
  role: "admin" | "member";
  color: string;
  avatarSprite: string;
  active: boolean;
  telegramUserId: number | null;
}

const LAST_ADMIN = fail(
  "LAST_ADMIN",
  "The household needs at least one admin. Make someone else an admin first.",
);

export const manageMembers = defineAction({
  name: "manage_members",
  title: "Manage members",
  description:
    "Changes a household member's role, deactivates or reactivates them, edits their display name, colour and avatar, or sets or clears their Telegram user id.",
  consent: "Manage household members",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input,
  async execute(ctx, change) {
    // Setting a Telegram id lets that Telegram account sign in as the member
    // ("Sign in with Baumy") and confirm it's them, so it needs "Confirm it's
    // you" (issue #135, the critic's review of PR #148); clearing one takes a
    // way in away and does not. Whether admins should set it for others at
    // all is the owner's call [UNRESOLVED 2026-10-02, ADR 0007].
    if (change.op === "set_telegram" && change.telegramUserId != null) {
      const confirmed = await confirmedActor(ctx);
      if (isFailure(confirmed)) return confirmed;
    }
    // Anything that can remove an admin takes the admin locks first.
    const removesAdmin =
      change.op === "deactivate" ||
      (change.op === "set_role" && change.role === "member");
    const admins = removesAdmin
      ? await lockActiveAdmins(ctx.db, ctx.householdId)
      : [];

    const target = await lockMember(ctx.db, ctx.householdId, change.memberId);
    if (!target) return fail("NOT_FOUND", "That member was not found.");

    if (removesAdmin && admins.includes(target.id) && admins.length === 1) {
      return LAST_ADMIN;
    }

    let patch: MemberPatch;
    switch (change.op) {
      case "set_role":
        patch = { role: change.role };
        break;
      case "deactivate":
        patch = { deactivatedAt: target.deactivatedAt ?? ctx.now };
        break;
      case "reactivate":
        patch = { deactivatedAt: null };
        break;
      case "set_telegram": {
        const telegramUserId = change.telegramUserId ?? null;
        if (telegramUserId !== null) {
          const holder = await findMemberIdByTelegramUserId(
            ctx.db,
            telegramUserId,
          );
          if (holder && holder !== target.id) {
            return fail(
              "TELEGRAM_ALREADY_LINKED",
              "That Telegram account is linked to another member. Clear it there first.",
            );
          }
        }
        patch = { telegramUserId };
        break;
      }
      case "edit": {
        const { op: _op, memberId: _id, ...fields } = change;
        patch = fields;
        break;
      }
    }

    const row = (await updateMember(ctx.db, target.id, patch))!;
    const data: ManageMembersData = {
      memberId: row.id,
      displayName: row.displayName,
      role: row.role,
      color: row.color,
      avatarSprite: row.avatarSprite,
      active: row.deactivatedAt === null,
      telegramUserId: row.telegramUserId,
    };
    return {
      ok: true,
      data,
      audit: { entity: "member", entityId: row.id, payload: change },
    };
  },
});
