import { randomUUID } from "node:crypto";
import type { VerificationEvent } from "@baumy/core";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { logCompletion } from "../completions";
import {
  applyCompletionEvent,
  type CompletionEventResult,
} from "../confirmations";
import { HOUSEHOLD_ID } from "../household";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import * as schema from "../schema";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";

// Two people answering one claim at once, on Docker Postgres (PGlite is one
// connection and cannot race). Each event locks the chore, reads the claim
// under the lock and compare-and-sets its status, so of a confirm and a
// dispute sent together exactly one lands, and the other is told the claim
// has moved on. Each transaction holds on a moment, as a slow request would.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const NOW = new Date("2026-09-27T10:00:00Z");
const LATER = new Date(NOW.getTime() + 60 * 60 * 1000);
const db = () => createHttpDb() as unknown as Queryable;
const memberIds: string[] = [];
const choreIds: string[] = [];

afterAll(async () => {
  if (choreIds.length > 0) {
    const ids = db()
      .select({ id: schema.completions.id })
      .from(schema.completions)
      .where(inArray(schema.completions.choreId, choreIds));
    await db()
      .delete(schema.disputes)
      .where(inArray(schema.disputes.completionId, ids));
    await db()
      .delete(schema.completionScores)
      .where(inArray(schema.completionScores.completionId, ids));
    await db()
      .delete(schema.completions)
      .where(inArray(schema.completions.choreId, choreIds));
    await db()
      .delete(schema.choreRuleVersions)
      .where(inArray(schema.choreRuleVersions.choreId, choreIds));
    await db().delete(schema.chores).where(inArray(schema.chores.id, choreIds));
  }
  if (memberIds.length > 0) {
    await db()
      .delete(schema.members)
      .where(inArray(schema.members.id, memberIds));
  }
});

async function player(): Promise<string> {
  const id = await seedPlayer(db());
  memberIds.push(id);
  return id;
}

async function claimBy(member: string): Promise<string> {
  const { choreId } = await seedChore(db(), {
    ...SEED_CHORES.trash,
    name: `Trash ${randomUUID()}`,
  });
  choreIds.push(choreId);
  const r = await withTransaction((tx) =>
    logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy: member,
      loggedBy: member,
      occurredAt: NOW,
      now: NOW,
      source: "ui",
      clientRequestId: randomUUID(),
    }),
  );
  if (!r.ok) throw new Error(`seed claim failed: ${r.code}`);
  return r.completion.id;
}

function send(
  completionId: string,
  event: VerificationEvent,
): Promise<CompletionEventResult> {
  return withTransaction(async (tx) => {
    const r = await applyCompletionEvent(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      completionId,
      event,
      now: LATER,
    });
    await tx.execute(sql`select pg_sleep(0.3)`);
    return r;
  });
}

describe("applyCompletionEvent under concurrent requests", () => {
  it("lets one of a racing withdraw and concede land; the other finds it moved on", async () => {
    const [ryan, sam] = [await player(), await player()];
    for (let round = 0; round < 3; round += 1) {
      const id = await claimBy(ryan);
      const disputed = await send(id, {
        type: "dispute",
        actor: sam,
        reason: "not done",
      });
      expect(disputed.ok).toBe(true);
      const results = await Promise.all([
        send(id, { type: "withdraw", actor: sam }),
        send(id, { type: "concede", actor: ryan }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, code: "INVALID_STATE" },
      ]);
      const [row] = await db()
        .select({ status: schema.completions.status })
        .from(schema.completions)
        .where(eq(schema.completions.id, id));
      const [dispute] = await db()
        .select()
        .from(schema.disputes)
        .where(eq(schema.disputes.completionId, id));
      // The dispute closed the way the winner closed it.
      expect(dispute!.resolution).toBe(
        row!.status === "pending" ? "withdrawn" : "conceded",
      );
    }
  });

  it("opens one dispute when two people dispute at once", async () => {
    const [ryan, sam, alex] = [await player(), await player(), await player()];
    const id = await claimBy(ryan);
    const results = await Promise.all([
      send(id, { type: "dispute", actor: sam, reason: "a" }),
      send(id, { type: "dispute", actor: alex, reason: "b" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const open = await db()
      .select()
      .from(schema.disputes)
      .where(eq(schema.disputes.completionId, id));
    expect(open).toHaveLength(1);
  });
});
