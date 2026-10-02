import "server-only";

import { after } from "next/server";
import { isBerlinMonday } from "@baumy/core";
import { createHttpDb, withTransaction, type Queryable } from "@baumy/db";
import { consumeRateLimit } from "@baumy/db/rate-limit";
import {
  clearPrunedPhoto,
  closeDueSeasons,
  listPhotosToPrune,
  settleDueCompletions,
} from "@baumy/db/sweep";
import { applyDueSuggestions, computeSuggestions } from "@baumy/db/weights";
import {
  LOGIN_REQUEST_RETENTION_MS,
  pruneLoginRequests,
} from "@baumy/db/login-requests";
import {
  KIOSK_PAIRING_RETENTION_MS,
  pruneKioskPairingRequests,
} from "@baumy/db/kiosk-pairing";
import { now as clockNow } from "./clock";
import { redactSecrets } from "./redact";
import { blobStore, type BlobStore } from "./photos/blob-store";
import { isTestMode } from "./test-mode";

// The daily job (SPEC §6.7), after camp-404 `apps/web/lib/background-work.ts`.
// It only persists what reads already derive from `now`, so no score, standing
// or decision depends on it having run. Two triggers run the same sweep:
//
//  - `GET /api/cron/daily`, which Vercel calls at 02:00 UTC (apps/web/vercel.json)
//    and sometime within that hour. Nothing here reads the schedule: the Berlin
//    weekday and the season come from `now` through packages/core/src/time.ts.
//  - A hub or kiosk page load (`runSweepAfterResponse`), in next/server
//    `after()`, so nobody waits on it. A row in `action_rate_limit` lets it run
//    at most once per SWEEP_EVERY_MS across every server.
//
// The steps, each in a transaction of its own, so one failing does not stop
// the others (the failure is logged, with secrets scrubbed):
//
//  1. settle: the ⏱ verification transitions (finalize, a
//     disputed claim's timeout);
//  2. seasons: `closing` at Dec 31 24:00 Berlin, `closed` with the winner once
//     every challenge window has passed;
//  3. weights, on Berlin Mondays only: `computeSuggestions`, then
//     `applyDueSuggestions`;
//  4. photos: delete proof photos 90 days after their claim settled. The file
//     goes first, outside any transaction (never hold one across a network
//     call), then the pathname is cleared. A run that dies in between leaves
//     the pathname, and the next run deletes the (already missing) file again.
//  5. logins: delete "Sign in with Baumy" requests older than a day
//     (issue #80); the audit rows stay.
//
// Every step is idempotent and claims rows with FOR UPDATE SKIP LOCKED
// (packages/db/src/sweep.ts, weights.ts), so the cron and a page load at the
// same moment do the work once. Under E2E test mode the page-load trigger is
// off, so a spec never sees work it did not ask for; specs call the cron route.

/** How often a page load may run the sweep, across all servers. */
export const SWEEP_EVERY_MS = 15 * 60 * 1000;
export const SWEEP_KEY = "background:daily-sweep";

/**
 * A server checks the database guard at most once a minute, so a busy page
 * costs no write per view. The database row is still the one that decides.
 */
const LOCAL_CHECK_EVERY_MS = 60 * 1000;
let lastLocalCheck = Number.NEGATIVE_INFINITY;

/** Tests only: forget this server's last check. */
export function resetLocalCheckForTests(): void {
  lastLocalCheck = Number.NEGATIVE_INFINITY;
}

export type StepName =
  "settle" | "seasons" | "weights" | "photos" | "logins" | "kiosk_pairings";

export type StepReport =
  | { step: StepName; ok: true; detail: Record<string, number | string> }
  | { step: StepName; ok: false; error: string };

export interface SweepReport {
  at: string;
  steps: StepReport[];
}

type Env = Record<string, string | undefined>;
type Detail = Record<string, number | string>;

export { redactSecrets };

async function runStep(
  step: StepName,
  fn: () => Promise<Record<string, number | string>>,
): Promise<StepReport> {
  try {
    return { step, ok: true, detail: await fn() };
  } catch (err) {
    const text = redactSecrets(
      err instanceof Error ? err.message : String(err),
    );
    console.error(`[sweep] ${step} failed: ${text}`);
    return { step, ok: false, error: "This step failed; see the server log." };
  }
}

const inTx = <T>(fn: (q: Queryable) => Promise<T>) =>
  withTransaction((tx) => fn(tx as unknown as Queryable));

/** Delete due photos: the file first, then the pathname. */
async function prunePhotos(
  at: Date,
  store: BlobStore,
): Promise<Record<string, number | string>> {
  const due = await listPhotosToPrune(
    createHttpDb() as unknown as Queryable,
    at,
  );
  let pruned = 0;
  let failed = 0;
  for (const photo of due) {
    const deleted = await store.del(photo.pathname);
    if (!deleted.ok) {
      // No Blob store here: leave every row as it is, for when there is one.
      if (deleted.reason === "not_configured") {
        return { pruned, due: due.length, blob: "not_configured" };
      }
      failed += 1;
      continue;
    }
    if (await inTx((q) => clearPrunedPhoto(q, photo))) pruned += 1;
  }
  return { pruned, failed, due: due.length };
}

/**
 * Run every step of the daily job at `at`. The cron route and the page-load
 * trigger both land here.
 */
export async function runSweep(
  at: Date,
  deps: { blob?: BlobStore } = {},
): Promise<SweepReport> {
  const steps: StepReport[] = [];
  steps.push(
    await runStep("settle", async () => ({
      ...(await inTx((q) => settleDueCompletions(q, at))),
    })),
  );
  steps.push(
    await runStep("seasons", async () => {
      const moved = await inTx((q) => closeDueSeasons(q, at));
      return {
        closing: moved.filter((s) => s.status === "closing").length,
        closed: moved.filter((s) => s.status === "closed").length,
      };
    }),
  );
  steps.push(
    await runStep("weights", async (): Promise<Detail> => {
      if (!isBerlinMonday(at)) return { skipped: "not Monday in Berlin" };
      const computed = await inTx((q) => computeSuggestions(q, at));
      const applied = await inTx((q) => applyDueSuggestions(q, at));
      return {
        measured: computed.measured,
        suggested: computed.suggested.length,
        applied: applied.length,
      };
    }),
  );
  steps.push(
    await runStep("photos", () => prunePhotos(at, deps.blob ?? blobStore())),
  );
  steps.push(
    await runStep("logins", async () => ({
      deleted: await pruneLoginRequests(
        createHttpDb() as unknown as Queryable,
        new Date(at.getTime() - LOGIN_REQUEST_RETENTION_MS),
      ),
    })),
  );
  steps.push(
    await runStep("kiosk_pairings", async () => ({
      deleted: await pruneKioskPairingRequests(
        createHttpDb() as unknown as Queryable,
        new Date(at.getTime() - KIOSK_PAIRING_RETENTION_MS),
      ),
    })),
  );
  return { at: at.toISOString(), steps };
}

export type SweepOutcome = "ran" | "not_due";

/** The sweep, at most once per SWEEP_EVERY_MS across every server. */
export async function runSweepIfDue(
  at: Date = clockNow(),
): Promise<SweepOutcome> {
  if (at.getTime() - lastLocalCheck < LOCAL_CHECK_EVERY_MS) return "not_due";
  lastLocalCheck = at.getTime();
  const verdict = await consumeRateLimit({
    key: SWEEP_KEY,
    limit: 1,
    windowMs: SWEEP_EVERY_MS,
  });
  // null: the database could not be reached, so do nothing this time.
  if (verdict?.ok !== true) return "not_due";
  await runSweep(at);
  return "ran";
}

/** After this response: run the sweep if it is due (see runSweepIfDue). */
export function runSweepAfterResponse(env: Env = process.env): void {
  if (isTestMode(env)) return;
  after(async () => {
    try {
      await runSweepIfDue();
    } catch (err) {
      const text = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      console.error(`[sweep] page-load sweep failed: ${text}`);
    }
  });
}
