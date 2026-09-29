import { eq } from "drizzle-orm";
import { z } from "zod";
import { members } from "@baumy/db/schema";
import {
  latestTelegramLinkCodeState,
  type TelegramLinkCodeState,
} from "@baumy/db/telegram-link-codes";
import { defineAction } from "./define";
import { fail } from "./result";

// /settings' Telegram card (issue #118): whether the member is linked, and
// where their newest link code stands, which the card polls while a code is
// on screen. "Linked" comes from the code being used, not from the Telegram
// id changing, so relinking the same account still says so; and the time
// left is the server's, so a device clock that is off can neither stop the
// polling early nor keep a dead code on screen.

export interface TelegramLinkStatus {
  /** The member has a Telegram id. */
  linked: boolean;
  /** The member's newest link code, or null when they never made one. */
  code: {
    state: TelegramLinkCodeState;
    /** Whole seconds until it expires by the server's clock; 0 unless waiting. */
    secondsLeft: number;
  } | null;
}

export const getTelegramLinkStatus = defineAction({
  name: "get_telegram_link_status",
  title: "See my Telegram link",
  description:
    "Shows whether the signed-in member's Telegram account is linked, and whether their newest link code is waiting, used or expired.",
  consent: "See whether your Telegram account is linked",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    const memberId = ctx.actor.memberId!;
    const [row] = await ctx.db
      .select({ telegramUserId: members.telegramUserId })
      .from(members)
      .where(eq(members.id, memberId));
    if (!row) return fail("NOT_FOUND", "Your member profile was not found.");
    const latest = await latestTelegramLinkCodeState(ctx.db, {
      memberId,
      now: ctx.now,
    });
    const data: TelegramLinkStatus = {
      linked: row.telegramUserId !== null,
      code: latest && {
        state: latest.state,
        secondsLeft: Math.ceil(latest.msLeft / 1000),
      },
    };
    return { ok: true, data };
  },
});
