import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";
import {
  claimTelegramLinkCode,
  hashTelegramLinkCode,
  insertTelegramLinkCode,
} from "../telegram-link-codes";

// A Telegram link code works once, even when several `/link` messages carry
// it at the same moment (issue #27): each claim is its own transaction on a
// real server, and exactly one UPDATE … RETURNING may win the row.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const memberIds: string[] = [];
const codeHashes: string[] = [];

afterAll(async () => {
  const db = createHttpDb();
  if (codeHashes.length > 0) {
    await db
      .delete(schema.telegramLinkCodes)
      .where(inArray(schema.telegramLinkCodes.codeHash, codeHashes));
  }
  if (memberIds.length > 0) {
    await db
      .delete(schema.members)
      .where(inArray(schema.members.id, memberIds));
  }
});

describe("claimTelegramLinkCode under concurrent claims", () => {
  it("lets exactly one Telegram user use a code", async () => {
    const [member] = await createHttpDb()
      .insert(schema.members)
      .values({
        householdId: HOUSEHOLD_ID,
        displayName: "Local linker",
        avatarSprite: "cat",
        color: "#112233",
      })
      .returning({ id: schema.members.id });
    memberIds.push(member!.id);

    const code = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    codeHashes.push(hashTelegramLinkCode(code));
    const now = new Date();
    await withTransaction((tx) =>
      insertTelegramLinkCode(tx as unknown as Queryable, {
        code,
        memberId: member!.id,
        now,
      }),
    );

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withTransaction((tx) =>
          claimTelegramLinkCode(tx as unknown as Queryable, {
            code,
            telegramUserId: 6_000_000_000 + i,
            now,
          }),
        ),
      ),
    );
    const winners = results.filter((r) => r !== null);
    expect(winners).toEqual([{ memberId: member!.id }]);
  });
});
