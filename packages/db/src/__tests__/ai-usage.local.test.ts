import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { claimAiCommand } from "../ai-usage";
import { HOUSEHOLD_ID } from "../household";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";

// The daily AI limit holds when a member fires several commands at once:
// each claim is its own transaction on a real server, and the member-row
// lock makes them count one after the other.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const memberIds: string[] = [];

afterAll(async () => {
  const db = createHttpDb();
  if (memberIds.length > 0) {
    await db
      .delete(schema.aiUsage)
      .where(inArray(schema.aiUsage.memberId, memberIds));
    await db
      .delete(schema.members)
      .where(inArray(schema.members.id, memberIds));
  }
});

describe("claimAiCommand under concurrent commands", () => {
  it("lets exactly `limit` commands through", async () => {
    const [m] = await createHttpDb()
      .insert(schema.members)
      .values({
        householdId: HOUSEHOLD_ID,
        displayName: "Local AI",
        avatarSprite: "cat",
        color: "#112233",
      })
      .returning({ id: schema.members.id });
    memberIds.push(m!.id);
    const now = new Date();
    const dayStart = new Date(now.getTime() - 60 * 60_000);

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        withTransaction((tx) =>
          claimAiCommand(tx as unknown as Queryable, {
            householdId: HOUSEHOLD_ID,
            memberId: m!.id,
            model: "claude-sonnet-5",
            dayStart,
            limit: 5,
            now,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const rows = await createHttpDb()
      .select()
      .from(schema.aiUsage)
      .where(inArray(schema.aiUsage.memberId, [m!.id]));
    expect(rows).toHaveLength(5);
  });
});
