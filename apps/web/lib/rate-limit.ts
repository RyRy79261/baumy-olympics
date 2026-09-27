import { consumeRateLimit } from "@baumy/db/rate-limit";
import { isTestMode } from "./test-mode";

// Rate limits (SPEC §6.2), ported from camp-404 `apps/web/lib/rate-limit.ts`.
// `rateLimiter` counts in Postgres (@baumy/db/rate-limit), so every server
// instance shares one count and a cold start does not reset it. The in-memory
// token bucket below counts per process: it is the fallback when the database
// cannot store the count (so an outage still limits each instance), and the
// limiter in E2E test mode, where every spec comes from one address.

interface Bucket {
  tokens: number;
  updatedAt: number;
}

// On globalThis, not a module binding: Next gives route handlers and server
// actions separate module graphs in one process (the same reason as
// lib/clock.ts).
const BUCKETS_KEY = Symbol.for("baumy.rateLimit.buckets");
type BucketGlobal = typeof globalThis & {
  [BUCKETS_KEY]?: Map<string, Bucket>;
};
const buckets: Map<string, Bucket> = ((globalThis as BucketGlobal)[
  BUCKETS_KEY
] ??= new Map<string, Bucket>());

// Sweep expired buckets every N calls, so high-cardinality keys (IPs) cannot
// grow the map without bound.
const SWEEP_EVERY = 200;
let sweepCounter = 0;

function maybeSweep(windowMs: number, nowMs: number): void {
  if (++sweepCounter % SWEEP_EVERY !== 0) return;
  const expiresBefore = nowMs - windowMs;
  for (const [key, bucket] of buckets) {
    if (bucket.updatedAt < expiresBefore) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Requests allowed per `windowMs`. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until one more request is allowed. 0 when allowed. */
  retryAfterSeconds: number;
}

/** The per-process token bucket. `nowMs` is for tests. */
export function memoryRateLimit(
  key: string,
  opts: RateLimitOptions,
  nowMs: number = Date.now(),
): RateLimitResult {
  const { limit, windowMs } = opts;
  maybeSweep(windowMs, nowMs);
  const refillPerMs = limit / windowMs;
  const existing = buckets.get(key);
  const tokens = existing
    ? Math.min(
        limit,
        existing.tokens + (nowMs - existing.updatedAt) * refillPerMs,
      )
    : limit;
  if (tokens < 1) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((1 - tokens) / refillPerMs / 1000),
      ),
    };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: nowMs });
  return { ok: true, retryAfterSeconds: 0 };
}

/** Tests only: forget every in-memory bucket. */
export function __resetMemoryRateLimits(): void {
  buckets.clear();
  sweepCounter = 0;
}

/** The limiter seam: call sites depend on this, and always `await` it. */
export interface RateLimiter {
  limit(key: string, opts: RateLimitOptions): Promise<RateLimitResult>;
}

/**
 * The shared limiter: a fixed window counted in Postgres, falling back to the
 * in-memory bucket when the count cannot be stored. In-memory only in E2E
 * test mode.
 */
export const rateLimiter: RateLimiter = {
  async limit(key, opts) {
    if (isTestMode()) return memoryRateLimit(key, opts);
    const verdict = await consumeRateLimit({
      key,
      limit: opts.limit,
      windowMs: opts.windowMs,
    });
    return verdict ?? memoryRateLimit(key, opts);
  },
};

/**
 * Best-effort client address. Takes anything with `get`, so a server action
 * can pass `await headers()`. On Vercel the first `x-forwarded-for` entry is
 * the client, set by the platform.
 */
export function getClientIp(headers: Pick<Headers, "get">): string {
  const fwd = headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
