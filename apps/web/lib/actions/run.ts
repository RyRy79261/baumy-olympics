import "server-only";

import { and, eq, lt, or } from "drizzle-orm";
import type { z } from "zod";
import {
  createHttpDb,
  withTransaction,
  type Queryable,
  type Tx,
} from "@baumy/db";
import { actionRequests, auditEvents } from "@baumy/db/schema";
import type { Actor } from "@/lib/auth";
import { runGate } from "@/lib/auth/gates";
import { verifyKioskPin, type PinVerifier } from "@/lib/auth/pin";
import { rateLimiter, type RateLimiter } from "@/lib/rate-limit";
import type {
  AnyActionDef,
  ExecuteResult,
  RateLimitSpec,
  RequestCtx,
} from "./define";
import { inputHash } from "./input-hash";
import { fail, type ActionFailure, type ActionResult } from "./result";

// runAction (SPEC §6.3, ADR 0002): the ONLY entry point to an action, and the
// only writer of `action_requests` and `audit_events`. In order it:
//
//   1. checks the surface;
//   2. parses the input with Zod;
//   3. resolves `requires(ctx, input)` and runs that gate;
//   4. rate-limits, per actor and per IP;
//   5. (writes) claims (actor, source, requestId) in `action_requests` with
//      INSERT … ON CONFLICT DO NOTHING RETURNING, storing an input hash;
//   6. (writes) calls `execute` in the same transaction as the claim, then
//      writes the audit row and the stored result.
//
// A replay with the same input hash returns the stored result without
// executing; a different hash is IDEMPOTENCY_CONFLICT. Two concurrent
// requests with one key meet at the INSERT: the second waits for the first
// transaction, then finds its row.
//
// `transactional: false` actions (Google, brain) commit the claim as
// `pending`, run `execute` with NO transaction open, then write the audit row
// and the result in a short second transaction.
//
// Reads skip steps 5 and 6: they are neither claimed nor audited.

/** Default budgets per action. An action may set its own (`rateLimit`). */
export const DEFAULT_RATE_LIMITS: Record<"read" | "write", RateLimitSpec> = {
  read: { perMember: 120, perIp: 300, windowMs: 60_000 },
  write: { perMember: 30, perIp: 120, windowMs: 60_000 },
};

/**
 * A `pending` claim older than this is taken to belong to a request that
 * died (only `transactional: false` actions commit a pending claim), so a
 * retry may take it over.
 */
export const STALE_PENDING_MS = 5 * 60_000;

/** Request ids are client-made (a UUID, usually): bounded and plain. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const GENERIC_ERROR = "Something went wrong. Please try again.";

export interface RunnerDeps {
  /** Opens one transaction (the pooled driver). */
  withTransaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** The stateless driver, for reads and non-transactional actions. */
  readDb: () => Queryable;
  rateLimiter: RateLimiter;
  verifyPin: PinVerifier;
  /** Server log for the errors the caller only sees as INTERNAL. */
  logError: (message: string, err: unknown) => void;
}

export const defaultDeps: RunnerDeps = {
  withTransaction,
  readDb: () => createHttpDb() as unknown as Queryable,
  rateLimiter,
  verifyPin: verifyKioskPin,
  logError: (message, err) => console.error(message, err),
};

export type Runner = (
  name: string,
  rawInput: unknown,
  ctx: RequestCtx,
) => Promise<ActionResult<unknown>>;

/** Rolls the transaction back and carries the action's own failure out. */
class ActionAbort extends Error {
  constructor(readonly result: ActionFailure) {
    super(result.code);
  }
}

/** The key rate limits and logs use for an actor. */
export function actorKey(actor: Actor): string {
  if (actor.memberId) return `member:${actor.memberId}`;
  switch (actor.kind) {
    case "kiosk":
      return `kiosk:${actor.deviceId}`;
    case "service":
      return `service:${actor.tokenName}`;
    default:
      return `user:${actor.kind === "member" ? actor.userId : "unknown"}`;
  }
}

/**
 * What the caller gets back is exactly what a replay gets back: the result
 * as it round-trips through jsonb (a Date becomes its ISO string).
 */
function asStored<O>(result: ActionResult<O>): ActionResult<O> {
  return JSON.parse(JSON.stringify(result)) as ActionResult<O>;
}

function stripExecuteExtras<O>(out: ExecuteResult<O>): ActionResult<O> {
  return out.ok ? { ok: true, data: out.data } : out;
}

interface ClaimKey {
  actorMemberId: string;
  source: RequestCtx["source"];
  requestId: string;
}

type Claim =
  | { kind: "claimed" }
  | { kind: "replay"; result: ActionResult<unknown> }
  | { kind: "conflict" }
  | { kind: "busy" };

function keyWhere(key: ClaimKey) {
  return and(
    eq(actionRequests.actorMemberId, key.actorMemberId),
    eq(actionRequests.source, key.source),
    eq(actionRequests.requestId, key.requestId),
  );
}

async function claim(
  tx: Queryable,
  key: ClaimKey,
  action: string,
  hash: string,
  now: Date,
): Promise<Claim> {
  const inserted = await tx
    .insert(actionRequests)
    .values({
      ...key,
      action,
      inputHash: hash,
      status: "pending",
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ requestId: actionRequests.requestId });
  if (inserted.length > 0) return { kind: "claimed" };

  // Someone holds the key. A concurrent first request has committed by now:
  // our INSERT waited for its transaction before doing nothing.
  const [row] = await tx
    .select({
      inputHash: actionRequests.inputHash,
      status: actionRequests.status,
      result: actionRequests.result,
    })
    .from(actionRequests)
    .where(keyWhere(key));
  if (!row) return { kind: "busy" };
  if (row.inputHash !== hash) return { kind: "conflict" };
  if (row.status === "done") {
    return { kind: "replay", result: row.result as ActionResult<unknown> };
  }

  // A failed attempt, or a pending one whose process died, may be retried.
  // Compare-and-set, so only one retry takes it.
  const retaken = await tx
    .update(actionRequests)
    .set({ status: "pending", result: null, createdAt: now })
    .where(
      and(
        keyWhere(key),
        eq(actionRequests.inputHash, hash),
        or(
          eq(actionRequests.status, "failed"),
          and(
            eq(actionRequests.status, "pending"),
            lt(
              actionRequests.createdAt,
              new Date(now.getTime() - STALE_PENDING_MS),
            ),
          ),
        ),
      ),
    )
    .returning({ requestId: actionRequests.requestId });
  return retaken.length > 0 ? { kind: "claimed" } : { kind: "busy" };
}

function claimOutcome(c: Exclude<Claim, { kind: "claimed" }>) {
  switch (c.kind) {
    case "replay":
      return c.result;
    case "conflict":
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "This request id was already used for something else. Start again.",
      );
    case "busy":
      return fail(
        "IN_PROGRESS",
        "This is still being done. Check again in a moment.",
      );
  }
}

async function finish(
  tx: Queryable,
  key: ClaimKey,
  action: string,
  input: unknown,
  out: Extract<ExecuteResult<unknown>, { ok: true }>,
  now: Date,
): Promise<ActionResult<unknown>> {
  const result = asStored<unknown>({ ok: true, data: out.data });
  await tx.insert(auditEvents).values({
    actorMemberId: key.actorMemberId,
    source: key.source,
    action,
    entity: out.audit?.entity ?? action,
    entityId: out.audit?.entityId ?? null,
    payload: out.audit?.payload ?? input ?? null,
    at: now,
  });
  await tx
    .update(actionRequests)
    .set({ status: "done", result })
    .where(keyWhere(key));
  return result;
}

/** Build a runner over a registry. `runAction` (registry.ts) is the real one. */
export function createRunner(
  registry: Readonly<Record<string, AnyActionDef>>,
  deps: RunnerDeps = defaultDeps,
): Runner {
  return async function run(name, rawInput, ctx) {
    const def = Object.hasOwn(registry, name) ? registry[name] : undefined;
    if (!def) return fail("UNKNOWN_ACTION", `There is no action "${name}".`);

    // 1. Surface.
    if (!def.surfaces.includes(ctx.source)) {
      return fail(
        "SURFACE_FORBIDDEN",
        `${def.title} is not available from here.`,
      );
    }

    // 2. Input, before any gate runs.
    const parsed = (def.input as z.ZodType).safeParse(rawInput);
    if (!parsed.success) {
      return fail(
        "INVALID_INPUT",
        "Some of that is not valid. Check it and try again.",
        {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
            message: i.message,
          })),
        },
      );
    }
    const input: unknown = parsed.data;
    if (
      def.kind === "write" &&
      !(ctx.requestId && REQUEST_ID_PATTERN.test(ctx.requestId))
    ) {
      return fail("INVALID_INPUT", "This request is missing its request id.", {
        issues: [{ path: ["requestId"], message: "A request id is required." }],
      });
    }

    try {
      // 3. The gate, which may depend on the input.
      const gate =
        typeof def.requires === "function"
          ? def.requires(ctx, input)
          : def.requires;
      const verdict = await runGate(gate, ctx, def, deps.verifyPin);
      if (!verdict.ok) return verdict;

      // 4. Rate limits: one bucket per actor, one per IP.
      const limits = def.rateLimit ?? DEFAULT_RATE_LIMITS[def.kind];
      const buckets: [string, number][] = [
        [`action:${def.name}:${actorKey(ctx.actor)}`, limits.perMember],
      ];
      if (ctx.ip)
        buckets.push([`action:${def.name}:ip:${ctx.ip}`, limits.perIp]);
      for (const [key, limit] of buckets) {
        const rl = await deps.rateLimiter.limit(key, {
          limit,
          windowMs: limits.windowMs,
        });
        if (!rl.ok) {
          return fail(
            "RATE_LIMITED",
            `Too many tries. Wait ${rl.retryAfterSeconds}s and try again.`,
            { retryAfterSeconds: rl.retryAfterSeconds },
          );
        }
      }

      if (def.kind === "read") {
        const out = await def.execute({ ...ctx, db: deps.readDb() }, input);
        return asStored(stripExecuteExtras(out));
      }

      // Writes: the ledger and the audit trail both key on a member.
      const actorMemberId = ctx.actor.memberId;
      if (!actorMemberId) {
        return fail("FORBIDDEN", "Only household members can do this.");
      }
      const key: ClaimKey = {
        actorMemberId,
        source: ctx.source,
        requestId: ctx.requestId!,
      };
      const hash = inputHash(def.name, input);

      if (def.transactional === false) {
        return await runDetached(def, ctx, input, key, hash, deps);
      }

      // 5 and 6 in one transaction: claim, execute, audit, store.
      return await deps.withTransaction(async (tx) => {
        const db = tx as unknown as Queryable;
        const c = await claim(db, key, def.name, hash, ctx.now);
        if (c.kind !== "claimed") return claimOutcome(c);
        const out = await def.execute({ ...ctx, db }, input);
        // The action said no: roll back everything, claim included, so a
        // retry is judged afresh.
        if (!out.ok) throw new ActionAbort(out);
        return finish(db, key, def.name, input, out, ctx.now);
      });
    } catch (err) {
      if (err instanceof ActionAbort) return err.result;
      deps.logError(`[action:${name}] failed`, err);
      return fail("INTERNAL", GENERIC_ERROR);
    }
  };
}

/**
 * `transactional: false`: commit the claim as pending, run `execute` with no
 * transaction open, then audit and store the result in a short transaction.
 * A failure is stored as `failed`, and a retry with the same key runs again.
 */
async function runDetached(
  def: AnyActionDef,
  ctx: RequestCtx,
  input: unknown,
  key: ClaimKey,
  hash: string,
  deps: RunnerDeps,
): Promise<ActionResult<unknown>> {
  const c = await deps.withTransaction((tx) =>
    claim(tx as unknown as Queryable, key, def.name, hash, ctx.now),
  );
  if (c.kind !== "claimed") return claimOutcome(c);

  const markFailed = async (result: ActionFailure) => {
    try {
      await deps
        .readDb()
        .update(actionRequests)
        .set({ status: "failed", result })
        .where(keyWhere(key));
    } catch (err) {
      // The claim stays pending and goes stale; a retry takes it over later.
      deps.logError(
        `[action:${def.name}] could not mark the claim failed`,
        err,
      );
    }
  };

  let out: ExecuteResult<unknown>;
  try {
    out = await def.execute({ ...ctx, db: deps.readDb() }, input);
  } catch (err) {
    deps.logError(`[action:${def.name}] failed`, err);
    const result = fail("INTERNAL", GENERIC_ERROR);
    await markFailed(result);
    return result;
  }
  if (!out.ok) {
    await markFailed(out);
    return out;
  }

  try {
    return await deps.withTransaction((tx) =>
      finish(tx as unknown as Queryable, key, def.name, input, out, ctx.now),
    );
  } catch (err) {
    deps.logError(`[action:${def.name}] could not be audited`, err);
    if (out.undo) {
      try {
        await out.undo();
      } catch (undoErr) {
        deps.logError(`[action:${def.name}] undo failed`, undoErr);
      }
    }
    const result = fail("INTERNAL", GENERIC_ERROR);
    await markFailed(result);
    return result;
  }
}
