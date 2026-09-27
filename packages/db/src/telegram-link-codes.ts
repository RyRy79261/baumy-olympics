import { createHash } from "node:crypto";
import type { Queryable } from "./index";
import { telegramLinkCodes } from "./schema";

// Telegram link codes (SPEC §5, §6.6). A member creates one in /settings and
// sends it to baumy-brain; only its sha256 is stored, so a database read does
// not yield a code that works. The redeem (`link_telegram`) is issue #27.

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
