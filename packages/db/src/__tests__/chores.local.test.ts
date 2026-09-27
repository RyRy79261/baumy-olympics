import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { STARTER_CHORES, seedStarterChores } from "../chores";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import { choreRuleVersions, chores, households } from "../schema";

// The starter-chore seed under real concurrency (Docker Postgres, the db-local
// lane): two deploys seeding at once must add ONE set. The household row lock
// makes the second wait, then see the first one's chores. Runs against a
// household of its own, so the real one is left alone.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const db = () => createHttpDb() as unknown as Queryable;
const householdIds: string[] = [];

afterAll(async () => {
  if (householdIds.length === 0) return;
  const ids = db()
    .select({ id: chores.id })
    .from(chores)
    .where(inArray(chores.householdId, householdIds));
  await db()
    .delete(choreRuleVersions)
    .where(inArray(choreRuleVersions.choreId, ids));
  await db().delete(chores).where(inArray(chores.householdId, householdIds));
  await db().delete(households).where(inArray(households.id, householdIds));
});

describe("seedStarterChores under concurrent deploys", () => {
  it("two seeds at once add exactly one set of starter chores", async () => {
    const [house] = await db()
      .insert(households)
      .values({ name: "Seed race" })
      .returning({ id: households.id });
    householdIds.push(house!.id);
    const now = new Date("2026-09-27T10:00:00Z");
    const results = await Promise.all(
      [0, 1].map(() =>
        withTransaction((tx) =>
          seedStarterChores(tx as unknown as Queryable, {
            householdId: house!.id,
            now,
          }),
        ),
      ),
    );
    expect(results.sort()).toEqual([0, STARTER_CHORES.length]);
    const rows = await db()
      .select({ id: chores.id })
      .from(chores)
      .where(eq(chores.householdId, house!.id));
    expect(rows).toHaveLength(STARTER_CHORES.length);
  });
});
