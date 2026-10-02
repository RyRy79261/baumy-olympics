import { z } from "zod";
import {
  TELEGRAM_LINK_CODE_TTL_MS,
  insertTelegramLinkCode,
} from "@baumy/db/telegram-link-codes";
import { generateTelegramLinkCode } from "@/lib/codes";
import { confirmedActor, isFailure } from "./account-security";
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
  /**
   * Seconds until it expires by the server's clock: Settings times its
   * polling on this, never on the device clock (issue #118).
   */
  expiresInSeconds: number;
}

export const createTelegramLinkCode = defineAction({
  name: "create_telegram_link_code",
  title: "Create a Telegram link code",
  description:
    "Creates a one-time code, valid for 10 minutes, that links the signed-in member's Telegram account to Baumy when sent to the Baumy bot. Needs a recent 'Confirm it's you'.",
  consent: "Create a code to link your Telegram account",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  rateLimit: { perMember: 5, perIp: 20, windowMs: 10 * 60_000 },
  input: z.strictObject({}),
  async execute(ctx) {
    // Linking adds a way in ("Sign in with Baumy") and a way to confirm it's
    // you, and `link_telegram` replaces the member's link: a stolen session
    // could link its thief's Telegram for good. So it needs "Confirm it's
    // you", always (issue #135, the critic's review of PR #148).
    const actor = await confirmedActor(ctx);
    if (isFailure(actor)) return actor;
    const memberId = actor.memberId!;
    const code = generateTelegramLinkCode();
    const { expiresAt } = await insertTelegramLinkCode(ctx.db, {
      code,
      memberId,
      now: ctx.now,
    });
    const data: TelegramLinkCodeData = {
      code,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: TELEGRAM_LINK_CODE_TTL_MS / 1000,
    };
    return {
      ok: true,
      data,
      storedData: { ...data, code: null },
      audit: {
        entity: "telegram_link_code",
        entityId: memberId,
        payload: { expiresAt: data.expiresAt },
      },
    };
  },
});
