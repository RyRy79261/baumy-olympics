// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Queryable } from "@baumy/db";
import { logCompletion } from "@baumy/db/completions";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import {
  actionRequests,
  auditEvents,
  completionScores,
  completions,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  allowAll,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { defineAction } from "./define";
import { fail } from "./result";
import { createRunner, defaultDeps } from "./run";

// Issue #13: the completion write path through runAction. The real
// `log_completion` action (surfaces, attestation, preview) arrives with issue
// #14; this stand-in is the thinnest action over `logCompletion`, so what is
// shown here is the split of duties: logCompletion writes the completion and
// its scores, runAction alone writes one `audit_events` row and one
// `action_requests` row, all in the one transaction.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const logCompletionAction = defineAction({
  name: "log_completion",
  title: "Log a chore",
  description:
    "Test stand-in over logCompletion (issue #14 adds the real one).",
  consent: "Log chores for you",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk"],
  requires: "member",
  input: z.strictObject({ choreId: z.uuid() }),
  async execute(ctx, input) {
    const memberId = ctx.actor.memberId!;
    const r = await logCompletion(ctx.db, {
      householdId: ctx.householdId,
      choreId: input.choreId,
      doneBy: memberId,
      loggedBy: memberId,
      occurredAt: ctx.now,
      now: ctx.now,
      source: ctx.source,
      clientRequestId: ctx.requestId!,
    });
    // The real action maps these codes to sentences (issue #14).
    if (!r.ok) return fail("INVALID_INPUT", r.code);
    return {
      ok: true,
      data: {
        completionId: r.completion.id,
        totalPts: r.score?.totalPts ?? null,
      },
      audit: { entity: "completion", entityId: r.completion.id },
    };
  },
});

const run = createRunner(
  { log_completion: logCompletionAction },
  { ...defaultDeps, rateLimiter: allowAll },
);

async function counts() {
  const [a] = await t.db().select({ n: count() }).from(auditEvents);
  const [r] = await t.db().select({ n: count() }).from(actionRequests);
  const [c] = await t.db().select({ n: count() }).from(completions);
  const [s] = await t.db().select({ n: count() }).from(completionScores);
  return {
    audits: a!.n,
    requests: r!.n,
    completions: c!.n,
    scores: s!.n,
  };
}

let choreId: string;
let me: string;

beforeEach(async () => {
  me = await seedMember(db());
  ({ choreId } = await seedChore(db(), SEED_CHORES.trash));
});

describe("log_completion through runAction", () => {
  it("writes one completion, one audit row and one action_requests row", async () => {
    const ctx = ctxFor(sessionActor(me));
    const r = await run("log_completion", { choreId }, ctx);
    expect(r).toMatchObject({
      ok: true,
      data: { totalPts: SEED_CHORES.trash.basePoints },
    });
    await expect(counts()).resolves.toEqual({
      audits: 1,
      requests: 1,
      completions: 1,
      scores: 1,
    });
    const [audit] = await t.db().select().from(auditEvents);
    const [completion] = await t.db().select().from(completions);
    expect(audit).toMatchObject({
      actorMemberId: me,
      source: "ui",
      action: "log_completion",
      entity: "completion",
      entityId: completion!.id,
    });
    expect(completion).toMatchObject({
      source: "ui",
      clientRequestId: ctx.requestId,
      loggedAt: FIXED_NOW,
    });
    const [req] = await t
      .db()
      .select()
      .from(actionRequests)
      .where(eq(actionRequests.requestId, ctx.requestId!));
    expect(req?.status).toBe("done");
  });

  it("a retry with the same request id writes nothing more", async () => {
    const ctx = ctxFor(sessionActor(me), { source: "kiosk" });
    const first = await run("log_completion", { choreId }, ctx);
    const again = await run("log_completion", { choreId }, ctx);
    expect(again).toEqual(first);
    await expect(counts()).resolves.toEqual({
      audits: 1,
      requests: 1,
      completions: 1,
      scores: 1,
    });
  });

  it("a refused completion rolls back and leaves no audit or ledger row", async () => {
    const ok = await run(
      "log_completion",
      { choreId },
      ctxFor(sessionActor(me)),
    );
    expect(ok.ok).toBe(true);
    const r = await run(
      "log_completion",
      { choreId },
      ctxFor(sessionActor(me)),
    );
    expect(r).toMatchObject({ ok: false, message: "COOLDOWN" });
    await expect(counts()).resolves.toEqual({
      audits: 1,
      requests: 1,
      completions: 1,
      scores: 1,
    });
  });
});
