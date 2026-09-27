import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHttpDb, isLocalProxy, type Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import {
  actionRequests,
  auditEvents,
  choreRuleVersions,
  chores,
  completionScores,
  completions,
  members,
} from "@baumy/db/schema";
import {
  allowAll,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { REGISTRY } from "./registry";
import { createRunner, defaultDeps } from "./run";

// log_completion on real Postgres (Docker, the db-local lane): two people
// tapping the same chore at the same moment, one on a phone and one on the
// kiosk. The chore lock serialises them, so exactly one completion is
// stored, audited and ledgered, and the other gets the cooldown.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const db = () => createHttpDb() as unknown as Queryable;
const run = createRunner(REGISTRY, { ...defaultDeps, rateLimiter: allowAll });
const memberIds: string[] = [];
const choreIds: string[] = [];

afterAll(async () => {
  if (choreIds.length > 0) {
    const ids = db()
      .select({ id: completions.id })
      .from(completions)
      .where(inArray(completions.choreId, choreIds));
    await db()
      .delete(completionScores)
      .where(inArray(completionScores.completionId, ids));
    await db()
      .delete(completions)
      .where(inArray(completions.choreId, choreIds));
    await db()
      .delete(choreRuleVersions)
      .where(inArray(choreRuleVersions.choreId, choreIds));
    await db().delete(chores).where(inArray(chores.id, choreIds));
  }
  if (memberIds.length > 0) {
    await db()
      .delete(auditEvents)
      .where(inArray(auditEvents.actorMemberId, memberIds));
    await db()
      .delete(actionRequests)
      .where(inArray(actionRequests.actorMemberId, memberIds));
    await db().delete(members).where(inArray(members.id, memberIds));
  }
});

describe("log_completion under concurrent taps", () => {
  it("two members logging one chore at once store exactly one completion", async () => {
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        seedMember(db(), { authUserId: `local_${randomUUID()}` }),
      ),
    );
    memberIds.push(a!, b!);
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.trash,
      name: `Race ${randomUUID().slice(0, 8)}`,
    });
    choreIds.push(choreId);

    const results = await Promise.all([
      run("log_completion", { choreId }, ctxFor(sessionActor(a))),
      run(
        "log_completion",
        { choreId },
        ctxFor(kioskActor(b), { source: "kiosk" }),
      ),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ code: "COOLDOWN" }),
    ]);
    const stored = await db()
      .select({ id: completions.id })
      .from(completions)
      .where(eq(completions.choreId, choreId));
    expect(stored).toHaveLength(1);
    const audits = await db()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, stored[0]!.id));
    expect(audits).toHaveLength(1);
    const ledger = await db()
      .select({ status: actionRequests.status })
      .from(actionRequests)
      .where(inArray(actionRequests.actorMemberId, [a!, b!]));
    expect(ledger).toEqual([{ status: "done" }]);
  });
});
