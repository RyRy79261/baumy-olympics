import "server-only";

import { sql } from "drizzle-orm";
import { isEmailProviderConfigured } from "@baumy/auth/env";
import { createHttpDb } from "@baumy/db";
import { feedbackTracker } from "@/lib/feedback/config";
import { brainClient, brainConfig } from "@/lib/integrations/brain";
import { calendarClient } from "@/lib/integrations/calendar";
import { calendarConfig } from "@/lib/integrations/google-calendar";
import { now } from "@/lib/clock";
import { isTestMode } from "@/lib/test-mode";
import {
  deriveSystemStatus,
  type Probes,
  type Reach,
  type SystemStatus,
} from "./status";

// The server half of lib/system/status.ts (issue #133, after camp-404
// `apps/web/lib/system-probe.ts`): read the real env, run each cheap live
// check side by side, hand the answers to the pure deriver.
//
// It probes, not infers: "the key is set" and "the service answers" are
// different claims. Each live check is a read that costs nothing and changes
// nothing (a `select 1`, brain's shopping list through its 30s cache, one
// hour of the calendar, the models list of Claude and Groq, the tracker
// repo's metadata). Resend and Blob are not called (status.ts says why).
// Under E2E_TEST_MODE=1 no outside service is called at all. Nothing here
// throws, and a failure keeps an HTTP status and a reason word only: a
// provider's error text can quote the request.

export const PROBE_TIMEOUT_MS = 5000;

type EnvBag = Readonly<Record<string, string | undefined>>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ProbeDeps {
  env: EnvBag;
  fetch: FetchLike;
  /** `select 1` against the database. */
  queryDb: () => Promise<unknown>;
  /** A monotonic clock in ms, for latencies. */
  clock: () => number;
  timeoutMs: number;
}

const defaultDeps = (): ProbeDeps => ({
  env: process.env,
  fetch,
  queryDb: () => createHttpDb().execute(sql`select 1`),
  clock: () => performance.now(),
  timeoutMs: PROBE_TIMEOUT_MS,
});

class TimedOut extends Error {}

/** Run `work`, timing it; a throw or a timeout is a failure. */
async function timed(
  deps: ProbeDeps,
  work: (signal: AbortSignal) => Promise<Reach | null>,
): Promise<Reach> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = deps.clock();
  try {
    const answer = await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TimedOut());
        }, deps.timeoutMs);
      }),
    ]);
    return (
      answer ?? { kind: "ok", latencyMs: Math.round(deps.clock() - started) }
    );
  } catch (err) {
    return {
      kind: "failed",
      reason: err instanceof TimedOut ? "timeout" : "no answer",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A GET that counts any 2xx as answering. */
async function httpOk(
  deps: ProbeDeps,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Reach | null> {
  const res = await deps.fetch(url, { method: "GET", headers, signal });
  if (res.ok) return null;
  return {
    kind: "failed",
    status: res.status,
    reason: res.status === 401 || res.status === 403 ? "key refused" : "error",
  };
}

export async function probeAll(
  deps: ProbeDeps = defaultDeps(),
): Promise<Probes> {
  const { env } = deps;
  const test = isTestMode(env);
  const set = (name: string) => Boolean(env[name]?.trim());

  const tracker = feedbackTracker(env);
  const brainSet = brainConfig(env) !== null;
  const calendarSet = calendarConfig(env) !== null;

  const skip: Reach = { kind: "not_checked" };
  const fake: Reach = { kind: "fake" };

  const [database, brain, calendar, claude, groq, bugReports] =
    await Promise.all([
      set("DATABASE_URL")
        ? timed(deps, async () => {
            await deps.queryDb();
            return null;
          })
        : skip,
      test
        ? fake
        : brainSet
          ? timed(deps, async () => {
              const r = await brainClient(env).listShopping();
              return r.ok ? null : { kind: "failed", reason: r.reason };
            })
          : skip,
      test
        ? fake
        : calendarSet
          ? timed(deps, async () => {
              const from = now();
              const r = await calendarClient(env).list({
                timeMin: from,
                timeMax: new Date(from.getTime() + 60 * 60_000),
              });
              return r.ok ? null : { kind: "failed", reason: r.reason };
            })
          : skip,
      test
        ? fake
        : set("ANTHROPIC_API_KEY")
          ? timed(deps, (signal) =>
              httpOk(
                deps,
                "https://api.anthropic.com/v1/models?limit=1",
                {
                  "x-api-key": env.ANTHROPIC_API_KEY!.trim(),
                  "anthropic-version": "2023-06-01",
                },
                signal,
              ),
            )
          : skip,
      test
        ? fake
        : set("GROQ_API_KEY")
          ? timed(deps, (signal) =>
              httpOk(
                deps,
                "https://api.groq.com/openai/v1/models",
                { authorization: `Bearer ${env.GROQ_API_KEY!.trim()}` },
                signal,
              ),
            )
          : skip,
      test
        ? fake
        : tracker.ok
          ? timed(deps, (signal) =>
              httpOk(
                deps,
                `https://api.github.com/repos/${tracker.owner}/${tracker.name}`,
                {
                  authorization: `Bearer ${tracker.token}`,
                  accept: "application/vnd.github+json",
                  "user-agent": "baumy-olympics-status",
                },
                signal,
              ),
            )
          : skip,
    ]);

  return {
    database: { configured: set("DATABASE_URL"), reach: database },
    email: {
      configured: isEmailProviderConfigured(env),
      reach: skip,
    },
    brain: { configured: test || brainSet, reach: brain },
    calendar: { configured: test || calendarSet, reach: calendar },
    claude: { configured: test || set("ANTHROPIC_API_KEY"), reach: claude },
    groq: { configured: test || set("GROQ_API_KEY"), reach: groq },
    blob: {
      configured: test || set("BLOB_READ_WRITE_TOKEN"),
      reach: test ? fake : skip,
    },
    bugReports: {
      configured: test || tracker.ok,
      problem: test || tracker.ok ? null : tracker.reason,
      repo: tracker.ok ? `${tracker.owner}/${tracker.name}` : null,
      reach: bugReports,
    },
  };
}

/** The whole report: the real env, the live checks, the pure deriver. */
export async function getSystemStatus(
  deps: ProbeDeps = defaultDeps(),
): Promise<SystemStatus> {
  return deriveSystemStatus(await probeAll(deps));
}
