import { z } from "zod";
import { insertTelegramLinkCode } from "@baumy/db/telegram-link-codes";
import { generateTelegramLinkCode } from "@/lib/codes";
import { defineAction } from "./define";

// /settings: a one-time code the member sends to baumy-brain as
// `/link <code>` (SPEC §6.6; the redeem is issue #27). 10 random characters,
// 10 minutes, single use. Only its hash is stored, and the ledger keeps the
// result WITHOUT the code: the member sees it once, and a replay of the same
// request says to create a new one.

export interface TelegramLinkCodeData {
  /** Null on a replay: the code is shown once and never stored. */
  code: string | null;
  expiresAt: string;
}

export const createTelegramLinkCode = defineAction({
  name: "create_telegram_link_code",
  title: "Create a Telegram link code",
  description:
    "Creates a one-time code, valid for 10 minutes, that links the signed-in member's Telegram account to Baumy when sent to the Baumy bot.",
  consent: "Create a code to link your Telegram account",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  rateLimit: { perMember: 5, perIp: 20, windowMs: 10 * 60_000 },
  input: z.strictObject({}),
  async execute(ctx) {
    const memberId = ctx.actor.memberId!;
    const code = generateTelegramLinkCode();
    const { expiresAt } = await insertTelegramLinkCode(ctx.db, {
      code,
      memberId,
      now: ctx.now,
    });
    const data: TelegramLinkCodeData = {
      code,
      expiresAt: expiresAt.toISOString(),
    };
    return {
      ok: true,
      data,
      storedData: { code: null, expiresAt: data.expiresAt },
      audit: {
        entity: "telegram_link_code",
        entityId: memberId,
        payload: { expiresAt: data.expiresAt },
      },
    };
  },
});
