import { sql } from "drizzle-orm";
import { createHttpDb } from "./index";

// A fixed-window rate limit kept in Postgres (the action_rate_limit table), so
// every server instance shares one counter per key and a cold start does not
// reset it. Ported from camp-404 `packages/db/src/rate-limit.ts`, which took it
// from the AfrikaBurn contributors app.
//
// Each key counts attempts from the start of its window. When the window has
// ended, the next attempt starts a new window at 1.

/**
 * A row untouched for this long is deleted by the next call. It is a week,
 * and the longest window a caller may ask for is the same week. The sweep
 * cannot know other callers' windows, so a shorter horizon could delete a
 * counter that is still live. Deleting a counter whose window has ended
 * changes no verdict.
 */
export const RATE_LIMIT_ROW_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export interface RateLimitVerdict {
  ok: boolean;
  /** Seconds until the window ends. 0 when allowed. */
  retryAfterSeconds: number;
}

const ALLOWED: RateLimitVerdict = { ok: true, retryAfterSeconds: 0 };

/**
 * Count one attempt for `key` and say whether it may go ahead.
 *
 * Every time in the statement comes from ONE clock: the database's `now()`,
 * read once for the whole statement. Instances' own clocks can drift, and an
 * instance running ahead would otherwise end a shared window early. `now` is a
 * fixed clock for tests only.
 *
 * Returns null when the database cannot be reached (the error is logged), so
 * the caller picks the fallback. It throws only for a limit or window that no
 * caller should pass.
 */
export async function consumeRateLimit(input: {
  key: string;
  /** Attempts allowed in one window. */
  limit: number;
  windowMs: number;
  /** Tests only: a fixed clock instead of the database's. */
  now?: Date;
}): Promise<RateLimitVerdict | null> {
  const { key, limit, windowMs } = input;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `consumeRateLimit: limit must be a positive integer, got ${limit}`,
    );
  }
  if (
    !Number.isInteger(windowMs) ||
    windowMs < 1 ||
    windowMs > RATE_LIMIT_ROW_HORIZON_MS
  ) {
    throw new RangeError(
      `consumeRateLimit: windowMs must be 1 to ${RATE_LIMIT_ROW_HORIZON_MS}, got ${windowMs}`,
    );
  }

  // Epoch milliseconds. `now()` is fixed for the whole statement, so every use
  // below reads the same instant.
  const nowMs = input.now
    ? sql`${input.now.getTime()}::bigint`
    : sql`(extract(epoch from now()) * 1000)::bigint`;

  try {
    // One statement, so two instances cannot both read "under the limit"
    // before either writes. The sweep is a CTE in the same statement. It skips
    // this call's own key: a CTE delete and the INSERT see one snapshot, and
    // touching the same row in both is an error.
    //
    // The sweep also skips rows another statement has locked (SKIP LOCKED).
    // Without that, two calls whose own keys are both week-old each lock their
    // own row in the upsert and then wait to delete the other's: a deadlock,
    // which Postgres breaks by failing one of them. A skipped row is swept by
    // a later call.
    const result = (await createHttpDb().execute(sql`
      WITH swept AS (
        DELETE FROM action_rate_limit
         WHERE key IN (
           SELECT key FROM action_rate_limit
            WHERE window_start < ${nowMs} - ${RATE_LIMIT_ROW_HORIZON_MS}::bigint
              AND key <> ${key}
            FOR UPDATE SKIP LOCKED
         )
      )
      INSERT INTO action_rate_limit (key, count, window_start)
      VALUES (${key}, 1, ${nowMs})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN action_rate_limit.window_start <= ${nowMs} - ${windowMs}::bigint
            THEN 1
          ELSE action_rate_limit.count + 1
        END,
        window_start = CASE
          WHEN action_rate_limit.window_start <= ${nowMs} - ${windowMs}::bigint
            THEN ${nowMs}
          ELSE action_rate_limit.window_start
        END
      RETURNING count, window_start, ${nowMs} AS now_ms
    `)) as unknown as { rows?: RateLimitRow[] } | RateLimitRow[];

    // The Neon HTTP driver, the pooled driver (NEON_LOCAL_PROXY reads) and
    // PGlite all return { rows }; other drivers return the array itself.
    const row = Array.isArray(result) ? result[0] : result.rows?.[0];
    if (!row) return ALLOWED;

    // bigint can arrive as a string.
    if (Number(row.count) <= limit) return ALLOWED;
    const windowEndsAt = Number(row.window_start) + windowMs;
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowEndsAt - Number(row.now_ms)) / 1000),
      ),
    };
  } catch (err) {
    console.error("[rate-limit] the counter could not be stored", err);
    return null;
  }
}

interface RateLimitRow {
  count: number | string;
  window_start: number | string;
  now_ms: number | string;
}
