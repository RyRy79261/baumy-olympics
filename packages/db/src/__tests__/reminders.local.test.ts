import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import { acknowledgeReminder, insertReminder } from "../reminders";
import * as schema from "../schema";

// The last two members tapping Seen at once, on Docker Postgres (PGlite is
// one connection and cannot race). Each ack locks the reminder row before it
// counts who is still waiting, so the second waits for the first to commit,
// sees its ack, and completes the reminder. Without the lock each would see
// only its own ack and neither would complete it. The first transaction holds
// on a moment after its ack, as a slow request would.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const NOW = new Date("2026-09-28T10:00:00Z");
const db = () => createHttpDb() as unknown as Queryable;

// A household of its own, so members other tests leave behind do not count.
let householdId: string;
let ryan: string;
let jo: string;
const reminderIds: string[] = [];

beforeAll(async () => {
  const [h] = await db()
    .insert(schema.households)
    .values({ name: "Reminder race" })
    .returning({ id: schema.households.id });
  householdId = h!.id;
  const people = await db()
    .insert(schema.members)
    .values(
      ["Ryan", "Jo"].map((displayName) => ({
        householdId,
        displayName,
        avatarSprite: "cat",
        color: "#112233",
        // Joined before the reminder is posted, so it waits for both.
        createdAt: new Date(NOW.getTime() - 60_000),
      })),
    )
    .returning({ id: schema.members.id });
  [ryan, jo] = people.map((p) => p.id) as [string, string];
});

afterAll(async () => {
  if (reminderIds.length > 0) {
    await db()
      .delete(schema.reminderAcks)
      .where(inArray(schema.reminderAcks.reminderId, reminderIds));
    await db()
      .delete(schema.reminders)
      .where(inArray(schema.reminders.id, reminderIds));
  }
  await db()
    .delete(schema.members)
    .where(eq(schema.members.householdId, householdId));
  await db()
    .delete(schema.households)
    .where(eq(schema.households.id, householdId));
});

function ackSlowly(reminderId: string, memberId: string, holdS: number) {
  return withTransaction(async (tx) => {
    const r = await acknowledgeReminder(tx as unknown as Queryable, {
      householdId,
      reminderId,
      memberId,
      now: NOW,
    });
    await tx.execute(sql`select pg_sleep(${holdS})`);
    return r;
  });
}

describe("acknowledgeReminder under concurrency", () => {
  it("completes the reminder when the last two members ack at once", async () => {
    const id = await insertReminder(db(), {
      householdId,
      createdBy: ryan,
      title: "Boiler",
      body: "",
      now: NOW,
    });
    reminderIds.push(id);
    const results = await Promise.all([
      ackSlowly(id, ryan, 0.4),
      new Promise((r) => setTimeout(r, 100)).then(() => ackSlowly(id, jo, 0)),
    ]);
    expect(results).toEqual([
      { seenByEveryone: false },
      { seenByEveryone: true },
    ]);
    const [row] = await db()
      .select({ completedAt: schema.reminders.completedAt })
      .from(schema.reminders)
      .where(eq(schema.reminders.id, id));
    expect(row!.completedAt).toEqual(NOW);
  });
});
