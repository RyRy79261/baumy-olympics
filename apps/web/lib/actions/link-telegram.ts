import { z } from "zod";
import {
  findMemberIdByTelegramUserId,
  lockMember,
  updateMember,
} from "@baumy/db/members";
import {
  claimTelegramLinkCode,
  hashTelegramLinkCode,
} from "@baumy/db/telegram-link-codes";
import { TelegramLinkCode } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// `/link <code>` in Telegram (SPEC §6.6, ADR 0003, issue #27). A member makes
// a one-time code in /settings (`create_telegram_link_code`) and sends it to
// the Baumy bot, by hand or through the deep link's `/start link_<code>`
// (issue #108, lib/telegram/deep-link.ts); brain calls this action with the code and the sender's
// Telegram id in `X-Baumy-Actor`. It is the ONE action an unlinked Telegram
// user may call (lib/brain/endpoint.ts), and the member comes from the code,
// never from the header.
//
// - The code is claimed with one `UPDATE … RETURNING` (unused, unexpired), so
//   it works once, even against a concurrent redeem.
// - A Telegram id already linked to another member is refused; the whole
//   transaction rolls back, so the code stays unused.
// - Linking a member who was linked to another Telegram id moves the link.
// - Rate limited per Telegram id here (runAction keys a service actor on its
//   Telegram user), and per service token by the endpoint.

export interface LinkTelegramData {
  memberId: string;
  displayName: string;
}

const INVALID = fail(
  "LINK_CODE_INVALID",
  "That code is wrong, used or expired. Create a new one in Baumy's Settings and send /link with it.",
);

export const linkTelegram = defineAction({
  name: "link_telegram",
  title: "Link a Telegram account",
  description:
    "Links the calling Telegram user to the household member who created the one-time link code in Baumy's Settings. Call it when someone sends /link <code>, or /start link_<code> from the Settings deep link.",
  consent: "Link a Telegram account to a household member",
  kind: "write",
  risk: "safe",
  surfaces: ["brain"],
  requires: "service",
  // Per Telegram id (the actor key) and per address; the endpoint adds a
  // bucket per token. Counted per attempt, so wrong codes run out fast.
  rateLimit: { perMember: 5, perIp: 30, windowMs: 10 * 60_000 },
  input: z.strictObject({ code: TelegramLinkCode }),
  // The code is a secret until used: the ledger and the audit row see only
  // its hash.
  fingerprint: ({ code }) => ({ codeHash: hashTelegramLinkCode(code) }),
  async execute(ctx, { code }) {
    const { actor } = ctx;
    if (actor.kind !== "service" || actor.telegramUserId === undefined) {
      return fail("FORBIDDEN", "Only the Baumy bot can link Telegram.");
    }
    const telegramUserId = actor.telegramUserId;

    const claimed = await claimTelegramLinkCode(ctx.db, {
      code,
      telegramUserId,
      now: ctx.now,
    });
    if (!claimed) return INVALID;

    const member = await lockMember(ctx.db, ctx.householdId, claimed.memberId);
    if (!member || member.deactivatedAt) return INVALID;

    const holder = await findMemberIdByTelegramUserId(ctx.db, telegramUserId);
    if (holder && holder !== member.id) {
      return fail(
        "TELEGRAM_ALREADY_LINKED",
        "This Telegram account is already linked to another member. Ask an admin to unlink it first.",
      );
    }

    await updateMember(ctx.db, member.id, { telegramUserId });
    const data: LinkTelegramData = {
      memberId: member.id,
      displayName: member.displayName,
    };
    return {
      ok: true,
      data,
      joinedAs: member.id,
      audit: {
        entity: "member",
        entityId: member.id,
        payload: {
          telegramUserId,
          previousTelegramUserId: member.telegramUserId,
        },
      },
    };
  },
});
