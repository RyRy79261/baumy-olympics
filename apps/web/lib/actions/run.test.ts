// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Queryable, Tx } from "@baumy/db";
import { actionRequests, auditEvents, members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  accountActor,
  allowAll,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { defineAction, type AnyActionDef, type Gate } from "./define";
import {
  DEFAULT_RATE_LIMITS,
  STALE_PENDING_MS,
  actorKey,
  createRunner,
  defaultDeps,
  type RunnerDeps,
} from "./run";

// runAction's pipeline against real Postgres (PGlite with the committed
// migrations): surface, input, gate, rate limit, idempotency claim, execute,
// audit. The actions here are test doubles built with defineAction, so each
// step can be observed; the real actions have their own tests.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const executed = vi.fn();
const gateSeen = vi.fn();

/** A write that bumps a counter row's display name, so effects are visible. */
const rename = defineAction({
  name: "test_rename",
  title: "Rename",
  description: "Test write.",
  consent: "Test consent",
  kind: "write",
  risk: "safe",
  surfaces: ["ui", "kiosk", "mcp"],
  requires: "member",
  input: z.strictObject({ name: z.string().min(1) }),
  async execute(ctx, input) {
    executed(input);
    await ctx.db
      .update(members)
      .set({ displayName: input.name })
      .where(eq(members.id, ctx.actor.memberId!));
    return {
      ok: true,
      data: { renamed: input.name, at: ctx.now },
      audit: { entity: "member", entityId: ctx.actor.memberId! },
    };
  },
});

/** Writes, then throws: must leave neither the write nor an audit row. */
const explode = defineAction({
  name: "test_explode",
  title: "Explode",
  description: "Test write that throws.",
  consent: "Test consent",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "member",
  input: z.strictObject({}),
  async execute(ctx) {
    executed();
    await ctx.db
      .update(members)
      .set({ displayName: "half-done" })
      .where(eq(members.id, ctx.actor.memberId!));
    throw new Error("boom: relation secret_table does not exist");
  },
});

/** Writes, then refuses: rolled back like a throw, but its own message. */
const refuse = defineAction({
  name: "test_refuse",
  title: "Refuse",
  description: "Test write that fails.",
  consent: "Test consent",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "member",
  input: z.strictObject({}),
  async execute(ctx) {
    executed();
    await ctx.db
      .update(members)
      .set({ displayName: "half-done" })
      .where(eq(members.id, ctx.actor.memberId!));
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "That chore is gone.",
    } as const;
  },
});

/** Input-aware gate: acting for someone else needs attestation. */
const forWhom = defineAction({
  name: "test_for_whom",
  title: "For whom",
  description: "Test write with an input-dependent gate.",
  consent: "Test consent",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk"],
  requires: (ctx, input): Gate => {
    gateSeen(input);
    return input.doneBy && input.doneBy !== ctx.actor.memberId
      ? "attested"
      : "member";
  },
  input: z.strictObject({ doneBy: z.string().optional() }),
  async execute() {
    executed();
    return { ok: true, data: null };
  },
});

const sessionOnly = defineAction({
  name: "test_session_only",
  title: "Session only",
  description: "Test write behind requireSession.",
  consent: "Test consent",
  kind: "write",
  risk: "safe",
  surfaces: ["ui", "kiosk"],
  requires: "session",
  input: z.strictObject({}),
  async execute() {
    executed();
    return { ok: true, data: null };
  },
});

const read = defineAction({
  name: "test_read",
  title: "Read",
  description: "Test read.",
  consent: "Test consent",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "member",
  input: z.strictObject({}),
  async execute(ctx) {
    executed();
    const [row] = await ctx.db
      .select({ c: count() })
      .from(members)
      .where(eq(members.id, ctx.actor.memberId!));
    return { ok: true, data: { rows: row!.c }, audit: { entity: "ignored" } };
  },
});

let txDepth = 0;
let depthDuringExecute: number[] = [];
const undo = vi.fn();
let detachedMode: "ok" | "throw" | "refuse" = "ok";

/** transactional: false, like a Google Calendar write. */
const external = defineAction({
  name: "test_external",
  title: "External",
  description: "Test non-transactional write.",
  consent: "Test consent",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "member",
  transactional: false,
  input: z.strictObject({ title: z.string() }),
  async execute(_ctx, input) {
    executed(input);
    depthDuringExecute.push(txDepth);
    if (detachedMode === "throw") throw new Error("google timed out");
    if (detachedMode === "refuse") {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Calendar is not configured.",
      } as const;
    }
    return { ok: true, data: { eventId: "evt_1" }, undo };
  },
});

const registry: Record<string, AnyActionDef> = {
  test_rename: rename,
  test_explode: explode,
  test_refuse: refuse,
  test_for_whom: forWhom,
  test_session_only: sessionOnly,
  test_read: read,
  test_external: external,
};

const logError = vi.fn();
let deps: RunnerDeps;
let run: ReturnType<typeof createRunner>;

beforeEach(() => {
  executed.mockReset();
  gateSeen.mockReset();
  undo.mockReset();
  logError.mockReset();
  txDepth = 0;
  depthDuringExecute = [];
  detachedMode = "ok";
  deps = {
    ...defaultDeps,
    rateLimiter: allowAll,
    verifyPin: async ({ pin }) => pin === "1234",
    logError,
    // Counts open transactions, so a test can see none is open in execute.
    withTransaction: async <T>(fn: (tx: Tx) => Promise<T>) => {
      txDepth += 1;
      try {
        return await defaultDeps.withTransaction(fn);
      } finally {
        txDepth -= 1;
      }
    },
  };
  run = createRunner(registry, deps);
});

async function auditRows() {
  return t.db().select().from(auditEvents);
}

async function requestRows() {
  return t.db().select().from(actionRequests);
}

async function displayName(memberId: string) {
  const [row] = await t
    .db()
    .select({ n: members.displayName })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.n;
}

describe("step 1: surface", () => {
  it("returns SURFACE_FORBIDDEN from a surface the action is not on, before anything else", async () => {
    const me = await seedMember(db());
    const ok = await run(
      "test_rename",
      { name: "A" },
      ctxFor(sessionActor(me)),
    );
    expect(ok.ok).toBe(true);

    const res = await run(
      "test_rename",
      { bad: true },
      ctxFor(sessionActor(me), { source: "ai" }),
    );
    expect(res).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(executed).toHaveBeenCalledTimes(1);
  });

  it("returns UNKNOWN_ACTION for a name that is not registered", async () => {
    const me = await seedMember(db());
    for (const name of ["nope", "toString", "__proto__"]) {
      await expect(
        run(name, {}, ctxFor(sessionActor(me))),
      ).resolves.toMatchObject({
        ok: false,
        code: "UNKNOWN_ACTION",
      });
    }
  });
});

describe("step 2: input", () => {
  it("returns INVALID_INPUT with the Zod issues, before any gate runs", async () => {
    const res = await run(
      "test_for_whom",
      { doneBy: 42, extra: 1 },
      // No member at all: had the gate run, this would be FORBIDDEN.
      ctxFor(sessionActor(undefined)),
    );
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    if (res.ok) throw new Error("expected a failure");
    expect(res.issues?.map((i) => i.path[0] ?? "")).toEqual(
      expect.arrayContaining(["doneBy"]),
    );
    expect(res.issues?.length).toBeGreaterThanOrEqual(2);
    expect(gateSeen).not.toHaveBeenCalled();
    expect(executed).not.toHaveBeenCalled();
  });

  it("refuses a write without a usable request id", async () => {
    const me = await seedMember(db());
    for (const requestId of [
      undefined,
      "short",
      "has spaces in it",
      "x".repeat(129),
    ]) {
      const res = await run(
        "test_rename",
        { name: "A" },
        ctxFor(sessionActor(me), { requestId }),
      );
      expect(res).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        issues: [{ path: ["requestId"] }],
      });
    }
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("step 3: gates", () => {
  it("an input-dependent requires picks the stricter gate for the input that needs it", async () => {
    const me = await seedMember(db());
    const other = await seedMember(db());

    // For myself on the kiosk: the member gate, no PIN.
    const self = await run(
      "test_for_whom",
      { doneBy: me },
      ctxFor(kioskActor(me), { source: "kiosk" }),
    );
    expect(self).toEqual({ ok: true, data: null });

    // For someone else on the kiosk: attested, so a PIN is needed...
    const noPin = await run(
      "test_for_whom",
      { doneBy: other },
      ctxFor(kioskActor(me), { source: "kiosk" }),
    );
    expect(noPin).toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    const wrongPin = await run(
      "test_for_whom",
      { doneBy: other },
      ctxFor(kioskActor(me), { source: "kiosk", pin: "0000" }),
    );
    expect(wrongPin).toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    const rightPin = await run(
      "test_for_whom",
      { doneBy: other },
      ctxFor(kioskActor(me), { source: "kiosk", pin: "1234" }),
    );
    expect(rightPin).toEqual({ ok: true, data: null });

    // ...while a session is its own attestation.
    const session = await run(
      "test_for_whom",
      { doneBy: other },
      ctxFor(sessionActor(me)),
    );
    expect(session).toEqual({ ok: true, data: null });
    expect(gateSeen).toHaveBeenCalledWith({ doneBy: other });
    expect(executed).toHaveBeenCalledTimes(3);
  });

  it("a kiosk actor calling a requireSession action gets FORBIDDEN", async () => {
    const me = await seedMember(db());
    const asSession = await run(
      "test_session_only",
      {},
      ctxFor(sessionActor(me)),
    );
    expect(asSession.ok).toBe(true);
    const res = await run(
      "test_session_only",
      {},
      ctxFor(kioskActor(me), { source: "kiosk", pin: "1234" }),
    );
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(executed).toHaveBeenCalledTimes(1);
  });

  it("a signed-in user with no member row cannot run anything", async () => {
    const res = await run("test_read", {}, ctxFor(sessionActor(undefined)));
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(executed).not.toHaveBeenCalled();
  });

  it("a gate that throws is INTERNAL, logged, and nothing runs", async () => {
    const me = await seedMember(db());
    run = createRunner(registry, {
      ...deps,
      verifyPin: async () => {
        throw new Error("db down");
      },
    });
    const res = await run(
      "test_for_whom",
      { doneBy: "someone-else" },
      ctxFor(kioskActor(me), { source: "kiosk", pin: "1234" }),
    );
    expect(res).toEqual({
      ok: false,
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("step 4: rate limits", () => {
  it("checks one bucket per actor and one per IP, with the action's budget", async () => {
    const me = await seedMember(db());
    const limit = vi.fn(async () => ({ ok: true, retryAfterSeconds: 0 }));
    run = createRunner(registry, { ...deps, rateLimiter: { limit } });
    await run(
      "test_rename",
      { name: "A" },
      ctxFor(sessionActor(me), { ip: "1.2.3.4" }),
    );
    const { perMember, perIp, windowMs } = DEFAULT_RATE_LIMITS.write;
    expect(limit.mock.calls).toEqual([
      [`action:test_rename:member:${me}`, { limit: perMember, windowMs }],
      ["action:test_rename:ip:1.2.3.4", { limit: perIp, windowMs }],
    ]);
  });

  it("returns RATE_LIMITED without executing when a bucket is empty", async () => {
    const me = await seedMember(db());
    run = createRunner(registry, {
      ...deps,
      rateLimiter: {
        limit: async (key) =>
          key.includes(":ip:")
            ? { ok: false, retryAfterSeconds: 7 }
            : { ok: true, retryAfterSeconds: 0 },
      },
    });
    const withIp = await run(
      "test_rename",
      { name: "A" },
      ctxFor(sessionActor(me), { ip: "1.2.3.4" }),
    );
    expect(withIp).toMatchObject({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: 7,
    });
    expect(executed).not.toHaveBeenCalled();
    // No IP known: only the actor bucket, which has room.
    const noIp = await run(
      "test_rename",
      { name: "A" },
      ctxFor(sessionActor(me)),
    );
    expect(noIp.ok).toBe(true);
  });

  it("keys actors without a member by what they are", () => {
    expect(actorKey(kioskActor())).toBe("kiosk:dev_1");
    expect(actorKey({ kind: "service", tokenName: "baumy-brain" })).toBe(
      "service:baumy-brain",
    );
    expect(actorKey(sessionActor(undefined))).toBe("user:u_none");
    expect(actorKey({ kind: "mcp", memberId: "m1", scopes: [] })).toBe(
      "member:m1",
    );
  });
});

describe("steps 5 and 6: idempotency and audit", () => {
  it("each write produces exactly one audit row and stores its result", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me), { source: "ui" });
    const res = await run("test_rename", { name: "Ryan" }, ctx);
    // Returned as a replay would return it: the Date is its JSON string.
    expect(res).toEqual({
      ok: true,
      data: { renamed: "Ryan", at: FIXED_NOW.toISOString() },
    });
    expect(await displayName(me)).toBe("Ryan");

    const audits = await auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorMemberId: me,
      source: "ui",
      action: "test_rename",
      entity: "member",
      entityId: me,
      payload: { name: "Ryan" },
    });
    expect(audits[0]!.at.toISOString()).toBe(FIXED_NOW.toISOString());

    const requests = await requestRows();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      actorMemberId: me,
      source: "ui",
      requestId: ctx.requestId,
      action: "test_rename",
      status: "done",
      result: res,
    });
    expect(requests[0]!.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a replay with the same input returns the stored result without executing again", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const first = await run("test_rename", { name: "Once" }, ctx);
    const again = await run("test_rename", { name: "Once" }, ctx);
    expect(again).toEqual(first);
    expect(executed).toHaveBeenCalledTimes(1);
    expect(await auditRows()).toHaveLength(1);
  });

  it("the same request id with a different input is IDEMPOTENCY_CONFLICT", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    await run("test_rename", { name: "First" }, ctx);
    const res = await run("test_rename", { name: "Second" }, ctx);
    expect(res).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    expect(await displayName(me)).toBe("First");
    expect(executed).toHaveBeenCalledTimes(1);
    expect(await auditRows()).toHaveLength(1);

    // A different action under the same id is a different input too.
    const other = await run("test_session_only", {}, ctx);
    expect(other).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("the same request id from another actor or another source executes independently", async () => {
    const me = await seedMember(db());
    const partner = await seedMember(db());
    const requestId = "shared-request-id-1";
    const a = await run(
      "test_rename",
      { name: "X" },
      ctxFor(sessionActor(me), { requestId }),
    );
    const b = await run(
      "test_rename",
      { name: "X" },
      ctxFor(sessionActor(partner), { requestId }),
    );
    const c = await run(
      "test_rename",
      { name: "X" },
      ctxFor(kioskActor(me), { requestId, source: "kiosk" }),
    );
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(executed).toHaveBeenCalledTimes(3);
    expect(await auditRows()).toHaveLength(3);
    expect(await requestRows()).toHaveLength(3);
  });

  it("a throw rolls back the change, the claim and the audit row", async () => {
    const me = await seedMember(db(), { displayName: "Before" });
    const ctx = ctxFor(sessionActor(me));
    const res = await run("test_explode", {}, ctx);
    // Generic to the caller; the detail goes to the log only.
    expect(res).toEqual({
      ok: false,
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
    expect(logError).toHaveBeenCalledWith(
      "[action:test_explode] failed",
      expect.any(Error),
    );
    expect(await displayName(me)).toBe("Before");
    expect(await auditRows()).toHaveLength(0);
    expect(await requestRows()).toHaveLength(0);

    // Nothing was stored, so a retry of the same request runs again.
    await run("test_explode", {}, ctx);
    expect(executed).toHaveBeenCalledTimes(2);
  });

  it("an action's own failure rolls back too, and returns its message", async () => {
    const me = await seedMember(db(), { displayName: "Before" });
    const res = await run("test_refuse", {}, ctxFor(sessionActor(me)));
    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "That chore is gone.",
    });
    expect(await displayName(me)).toBe("Before");
    expect(await auditRows()).toHaveLength(0);
    expect(await requestRows()).toHaveLength(0);
    expect(logError).not.toHaveBeenCalled();
  });

  it("a write needs a member behind the actor, whatever its gate", async () => {
    const svc = defineAction({
      name: "test_service_write",
      title: "Service write",
      description: "Test.",
      consent: "Test consent",
      kind: "write",
      risk: "safe",
      surfaces: ["brain"],
      requires: "service",
      input: z.strictObject({}),
      async execute() {
        executed();
        return { ok: true, data: null };
      },
    });
    run = createRunner({ test_service_write: svc }, deps);
    const res = await run(
      "test_service_write",
      {},
      ctxFor(
        { kind: "service", tokenName: "baumy-brain" },
        { source: "brain" },
      ),
    );
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  it("run without a claim or an audit row, and drop any audit hint", async () => {
    const me = await seedMember(db());
    const res = await run("test_read", {}, ctxFor(sessionActor(me)));
    expect(res).toEqual({ ok: true, data: { rows: 1 } });
    expect(txDepth).toBe(0);
    expect(await auditRows()).toHaveLength(0);
    expect(await requestRows()).toHaveLength(0);
  });

  it("need no request id", async () => {
    const me = await seedMember(db());
    const res = await run(
      "test_read",
      {},
      ctxFor(sessionActor(me), { requestId: undefined }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("transactional: false", () => {
  it("runs execute with no transaction open, then audits and stores the result", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const res = await run("test_external", { title: "Dinner" }, ctx);
    expect(res).toEqual({ ok: true, data: { eventId: "evt_1" } });
    expect(depthDuringExecute).toEqual([0]);
    expect(await auditRows()).toHaveLength(1);
    const [row] = await requestRows();
    expect(row).toMatchObject({ status: "done", result: res });

    // Replayed like any write.
    const again = await run("test_external", { title: "Dinner" }, ctx);
    expect(again).toEqual(res);
    expect(executed).toHaveBeenCalledTimes(1);
    const conflict = await run("test_external", { title: "Lunch" }, ctx);
    expect(conflict).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("commits the claim as pending before execute, so a parallel retry is IN_PROGRESS", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    let inner: unknown;
    const slow = defineAction({
      ...external,
      name: "test_slow_external",
      async execute(_c, input) {
        // While this runs, the claim is visible and pending.
        const [row] = await t.db().select().from(actionRequests);
        inner = [row?.status, await run("test_slow_external", input, ctx)];
        return { ok: true, data: null };
      },
    });
    run = createRunner({ test_slow_external: slow }, deps);
    await run("test_slow_external", { title: "A" }, ctx);
    expect(inner).toEqual([
      "pending",
      expect.objectContaining({ code: "IN_PROGRESS" }),
    ]);
  });

  it("stores a throw as failed, and a retry with the same key runs again", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    detachedMode = "throw";
    const res = await run("test_external", { title: "Dinner" }, ctx);
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(await auditRows()).toHaveLength(0);
    expect((await requestRows())[0]).toMatchObject({ status: "failed" });

    detachedMode = "ok";
    const retry = await run("test_external", { title: "Dinner" }, ctx);
    expect(retry).toEqual({ ok: true, data: { eventId: "evt_1" } });
    expect(executed).toHaveBeenCalledTimes(2);
    expect(await auditRows()).toHaveLength(1);
    expect((await requestRows())[0]).toMatchObject({ status: "done" });
  });

  it("stores the action's own failure as failed and returns it", async () => {
    const me = await seedMember(db());
    detachedMode = "refuse";
    const res = await run(
      "test_external",
      { title: "Dinner" },
      ctxFor(sessionActor(me)),
    );
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await requestRows())[0]).toMatchObject({
      status: "failed",
      result: res,
    });
    expect(await auditRows()).toHaveLength(0);
  });

  it("undoes the external effect when the audit cannot be written", async () => {
    const me = await seedMember(db());
    let calls = 0;
    run = createRunner(registry, {
      ...deps,
      withTransaction: async (fn) => {
        calls += 1;
        // The claim commits; the audit transaction fails.
        if (calls === 2) throw new Error("connection reset");
        return defaultDeps.withTransaction(fn);
      },
    });
    const res = await run(
      "test_external",
      { title: "Dinner" },
      ctxFor(sessionActor(me)),
    );
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(await auditRows()).toHaveLength(0);
    expect((await requestRows())[0]).toMatchObject({ status: "failed" });
  });

  it("logs a failed undo and a failed failure mark without throwing", async () => {
    const me = await seedMember(db());
    undo.mockRejectedValue(new Error("google down"));
    let calls = 0;
    run = createRunner(registry, {
      ...deps,
      withTransaction: async (fn) => {
        calls += 1;
        if (calls === 2) throw new Error("connection reset");
        return defaultDeps.withTransaction(fn);
      },
      readDb: () => {
        // execute's db works; the failure mark's does not.
        if (calls >= 2) throw new Error("db gone");
        return defaultDeps.readDb();
      },
    });
    const res = await run(
      "test_external",
      { title: "Dinner" },
      ctxFor(sessionActor(me)),
    );
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(logError.mock.calls.map((c) => c[0])).toEqual([
      "[action:test_external] could not be audited",
      "[action:test_external] undo failed",
      "[action:test_external] could not mark the claim failed",
    ]);
    // Left pending; it goes stale and a retry takes it over.
    expect((await requestRows())[0]).toMatchObject({ status: "pending" });
  });

  it("a stale pending claim is taken over by a retry; a fresh one is not", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const { inputHash } = await import("./input-hash");
    await t
      .db()
      .insert(actionRequests)
      .values({
        actorMemberId: me,
        source: "ui",
        requestId: ctx.requestId!,
        action: "test_external",
        inputHash: inputHash("test_external", { title: "Dinner" }),
        status: "pending",
        createdAt: new Date(FIXED_NOW.getTime() - STALE_PENDING_MS + 1000),
      });
    const fresh = await run("test_external", { title: "Dinner" }, ctx);
    expect(fresh).toMatchObject({ code: "IN_PROGRESS" });

    await t
      .db()
      .update(actionRequests)
      .set({
        createdAt: new Date(FIXED_NOW.getTime() - STALE_PENDING_MS - 1000),
      });
    const stale = await run("test_external", { title: "Dinner" }, ctx);
    expect(stale).toEqual({ ok: true, data: { eventId: "evt_1" } });
  });
});

describe("account actions (joining the household)", () => {
  let joinMode: "ok" | "no_member" | "refuse" = "ok";

  const join = defineAction({
    name: "test_join",
    title: "Join",
    description: "Test join.",
    consent: "Test consent",
    kind: "write",
    risk: "safe",
    surfaces: ["ui"],
    requires: "account",
    input: z.strictObject({ name: z.string() }),
    async execute(ctx, input) {
      executed(input);
      if (ctx.actor.memberId) {
        return {
          ok: false,
          code: "ALREADY_MEMBER",
          message: "Joined.",
        } as const;
      }
      const [row] = await ctx.db
        .insert(members)
        .values({
          householdId: HOUSEHOLD_ID,
          authUserId: ctx.actor.kind === "member" ? ctx.actor.userId : null,
          displayName: input.name,
          avatarSprite: "cat",
          color: "#123456",
        })
        .returning({ id: members.id });
      if (joinMode === "refuse") {
        return {
          ok: false,
          code: "INVITE_USED_UP",
          message: "Used up.",
        } as const;
      }
      return {
        ok: true,
        data: { memberId: row!.id },
        audit: { entity: "member", entityId: row!.id },
        ...(joinMode === "ok" ? { joinedAs: row!.id } : {}),
      };
    },
  });

  const detachedJoin = defineAction({
    ...join,
    name: "test_detached_join",
    transactional: false,
  });

  beforeEach(() => {
    joinMode = "ok";
    run = createRunner(
      { test_join: join, test_detached_join: detachedJoin },
      deps,
    );
  });

  it("runs for an account with no member, keying the ledger and audit on the new member", async () => {
    const ctx = ctxFor(accountActor("u_new"));
    const res = await run("test_join", { name: "Newbie" }, ctx);
    expect(res).toMatchObject({ ok: true });
    const memberId = (res as { data: { memberId: string } }).data.memberId;
    expect(await requestRows()).toEqual([
      expect.objectContaining({
        actorMemberId: memberId,
        requestId: ctx.requestId,
        action: "test_join",
        status: "done",
        result: res,
      }),
    ]);
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        actorMemberId: memberId,
        action: "test_join",
        entity: "member",
        entityId: memberId,
        payload: { name: "Newbie" },
      }),
    ]);

    // The retry comes back as the member it made, and replays.
    const again = await run(
      "test_join",
      { name: "Newbie" },
      { ...ctx, actor: { ...accountActor("u_new"), memberId, role: "member" } },
    );
    expect(again).toEqual(res);
    expect(executed).toHaveBeenCalledTimes(1);
  });

  it("is INTERNAL, writing nothing, when the action creates no member", async () => {
    joinMode = "no_member";
    const res = await run(
      "test_join",
      { name: "Ghost" },
      ctxFor(accountActor("u_ghost")),
    );
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(await t.db().select().from(members)).toHaveLength(0);
    expect(await requestRows()).toHaveLength(0);
  });

  it("rolls the new member back when the action refuses", async () => {
    joinMode = "refuse";
    const res = await run(
      "test_join",
      { name: "Late" },
      ctxFor(accountActor("u_late")),
    );
    expect(res).toEqual({
      ok: false,
      code: "INVITE_USED_UP",
      message: "Used up.",
    });
    expect(await t.db().select().from(members)).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it("refuses the kiosk and non-transactional joins", async () => {
    await expect(
      run("test_join", { name: "K" }, ctxFor(kioskActor(), { source: "ui" })),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      run(
        "test_detached_join",
        { name: "D" },
        ctxFor(accountActor("u_detached")),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("secrets in the input or the result", () => {
  const secretive = defineAction({
    name: "test_secretive",
    title: "Secretive",
    description: "Test write with a secret in and out.",
    consent: "Test consent",
    kind: "write",
    risk: "safe",
    surfaces: ["ui"],
    requires: "member",
    input: z.strictObject({ pin: z.string(), label: z.string() }),
    fingerprint: (input) => ({ label: input.label }),
    async execute(_ctx, input) {
      executed(input);
      const data: { code: string | null; label: string } = {
        code: "SECRET-CODE",
        label: input.label,
      };
      return { ok: true, data, storedData: { ...data, code: null } };
    },
  });

  beforeEach(() => {
    run = createRunner({ test_secretive: secretive }, deps);
  });

  it("keeps the secret out of the ledger and the audit row, and hands it over once", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const res = await run("test_secretive", { pin: "4321", label: "x" }, ctx);
    expect(res).toEqual({
      ok: true,
      data: { code: "SECRET-CODE", label: "x" },
    });
    const [ledger] = await requestRows();
    expect(ledger?.result).toEqual({
      ok: true,
      data: { code: null, label: "x" },
    });
    const [audit] = await auditRows();
    expect(audit?.payload).toEqual({ label: "x" });
    const everything = JSON.stringify([ledger, audit]);
    expect(everything).not.toContain("4321");
    expect(everything).not.toContain("SECRET-CODE");

    // A replay gets the stored form, without the code.
    const replay = await run(
      "test_secretive",
      { pin: "9999", label: "x" },
      ctx,
    );
    expect(replay).toEqual({ ok: true, data: { code: null, label: "x" } });
    expect(executed).toHaveBeenCalledTimes(1);
  });
});
