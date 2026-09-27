import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createHttpDb, isLocalProxy, type Queryable } from "@baumy/db";
import { actionRequests, auditEvents, members } from "@baumy/db/schema";
import {
  ctxFor,
  seedMember,
  sessionActor,
  allowAll,
} from "@/test-utils/actions";
import { defineAction } from "./define";
import { runAction } from "./registry";
import { createRunner, defaultDeps } from "./run";

// runAction's idempotency claim under real concurrency: Docker Postgres
// through the Neon WebSocket proxy, where every withTransaction is its own
// pool and connection. Requests sharing a key must meet at the INSERT … ON
// CONFLICT, so exactly one executes and the rest get its stored result.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const db = () => createHttpDb() as unknown as Queryable;
const seeded: string[] = [];

async function member(): Promise<string> {
  const id = await seedMember(db(), { authUserId: `local_${randomUUID()}` });
  seeded.push(id);
  return id;
}

afterAll(async () => {
  if (seeded.length === 0) return;
  await db()
    .delete(auditEvents)
    .where(inArray(auditEvents.actorMemberId, seeded));
  await db()
    .delete(actionRequests)
    .where(inArray(actionRequests.actorMemberId, seeded));
  await db().delete(members).where(inArray(members.id, seeded));
});

let executions = 0;

/** Slow on purpose, so the racing requests overlap inside the transaction. */
const slowWrite = defineAction({
  name: "test_slow_write",
  title: "Slow write",
  description: "Test write that sleeps.",
  consent: "Test consent",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "member",
  input: z.strictObject({ n: z.number() }),
  async execute(ctx, input) {
    executions += 1;
    await ctx.db.execute(sql`select pg_sleep(0.3)`);
    return { ok: true, data: { n: input.n, execution: executions } };
  },
});

const run = createRunner(
  { test_slow_write: slowWrite },
  { ...defaultDeps, rateLimiter: allowAll },
);

async function countFor(memberId: string, requestId: string) {
  const audits = await db()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.actorMemberId, memberId));
  const requests = await db()
    .select()
    .from(actionRequests)
    .where(
      and(
        eq(actionRequests.actorMemberId, memberId),
        eq(actionRequests.requestId, requestId),
      ),
    );
  return { audits: audits.length, requests: requests.length };
}

describe("runAction under concurrent requests", () => {
  it("executes once for concurrent requests with the same key", async () => {
    const me = await member();
    const ctx = ctxFor(sessionActor(me), { requestId: `race-${randomUUID()}` });
    executions = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => run("test_slow_write", { n: 1 }, ctx)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(executions).toBe(1);
    // Everyone got the one execution's result.
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    await expect(countFor(me, ctx.requestId!)).resolves.toEqual({
      audits: 1,
      requests: 1,
    });
  });

  it("refuses the racers that reuse the key for a different input", async () => {
    const me = await member();
    const ctx = ctxFor(sessionActor(me), { requestId: `race-${randomUUID()}` });
    executions = 0;
    const results = await Promise.all(
      [1, 2, 1, 2].map((n) => run("test_slow_write", { n }, ctx)),
    );
    expect(executions).toBe(1);
    const conflicts = results.filter(
      (r) => !r.ok && r.code === "IDEMPOTENCY_CONFLICT",
    );
    expect(conflicts).toHaveLength(2);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it("executes each of many concurrent requests with different keys", async () => {
    const me = await member();
    executions = 0;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        run("test_slow_write", { n: i }, ctxFor(sessionActor(me))),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(executions).toBe(6);
  });

  it("the real update_my_profile writes one audit row for a burst of retries", async () => {
    const me = await member();
    const ctx = ctxFor(sessionActor(me), { requestId: `race-${randomUUID()}` });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        runAction("update_my_profile", { displayName: "Raced" }, ctx),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    await expect(countFor(me, ctx.requestId!)).resolves.toEqual({
      audits: 1,
      requests: 1,
    });
  });
});
