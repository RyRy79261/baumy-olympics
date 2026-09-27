import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Queryable } from "./index";
import { telegramLinkCodes } from "./schema";

// Telegram link codes (SPEC §5, §6.6). A member creates one in /settings and
// sends it to baumy-brain; only its sha256 is stored, so a database read does
// not yield a code that works. baumy-brain redeems it through `link_telegram`
// (issue #27), which claims it with claimTelegramLinkCode.

/** Link codes live this long. */
export const TELEGRAM_LINK_CODE_TTL_MS = 10 * 60_000;

/**
 * The stored form of a code: sha256 hex of the code as typed, uppercased and
 * trimmed, so "ab12cd34" and "AB12CD34 " are the same code. A code has at
 * least 8 random characters, so a plain hash is enough: nobody can
 * brute-force it within its 10 minutes.
 */
export function hashTelegramLinkCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/** Store a new code's hash for `memberId`, returning when it expires. */
export async function insertTelegramLinkCode(
  db: Queryable,
  input: { code: string; memberId: string; now: Date },
): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + TELEGRAM_LINK_CODE_TTL_MS);
  await db.insert(telegramLinkCodes).values({
    codeHash: hashTelegramLinkCode(input.code),
    memberId: input.memberId,
    expiresAt,
    createdAt: input.now,
  });
  return { expiresAt };
}

/**
 * Use a code, once: ONE `UPDATE … RETURNING` whose WHERE is the whole "still
 * usable" test (this code, not used, not expired). It records who used it.
 * A reused, expired or wrong code finds no row, and so does the second of two
 * concurrent redeems. Returns the member the code was made for, or null.
 */
export async function claimTelegramLinkCode(
  db: Queryable,
  input: { code: string; telegramUserId: number; now: Date },
): Promise<{ memberId: string } | null> {
  const [row] = await db
    .update(telegramLinkCodes)
    .set({ usedAt: input.now, usedByTg: input.telegramUserId })
    .where(
      and(
        eq(telegramLinkCodes.codeHash, hashTelegramLinkCode(input.code)),
        isNull(telegramLinkCodes.usedAt),
        gt(telegramLinkCodes.expiresAt, input.now),
      ),
    )
    .returning({ memberId: telegramLinkCodes.memberId });
  return row ?? null;
}
