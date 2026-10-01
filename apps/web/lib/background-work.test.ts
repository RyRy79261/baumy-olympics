// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHOTO_RETENTION_DAYS,
  RULESET_V1,
  berlinWallTimeToUtc,
  isBerlinMonday,
} from "@baumy/core";
import { withTransaction, type Queryable } from "@baumy/db";
import { logCompletion } from "@baumy/db/completions";
import { SEED_CHORES, seedChore, seedPlayer } from "@baumy/db/game-fixtures";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  LOGIN_REQUEST_RETENTION_MS,
  insertLoginRequest,
} from "@baumy/db/login-requests";
import {
  KIOSK_PAIRING_RETENTION_MS,
  insertKioskPairingRequest,
} from "@baumy/db/kiosk-pairing";
import {
  completions,
  kioskPairingRequests,
  loginRequests,
  seasons,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import type * as NextServerModule from "next/server";
import type { BlobStore } from "./photos/blob-store";

type NextServer = typeof NextServerModule;

const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (original) => ({
  ...(await original<NextServer>()),
  after: afterMock,
}));

const {
  redactSecrets,
  resetLocalCheckForTests,
  runSweep,
  runSweepAfterResponse,
  runSweepIfDue,
} = await import("./background-work");

// The daily job's sweep on PGlite (SPEC §6.7): every step, a second run that
// does nothing, the Berlin weekday deciding the weights step, the photo
// deletes through the Blob adapter, a failing step that does not stop the
// others, and the page-load trigger's guard.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Mon 28 Sep 2026, 02:30 UTC (04:30 in Berlin). */
const MONDAY_0230_UTC = new Date("2026-09-28T02:30:00Z");
/** Sun 27 Sep 2026, 02:30 UTC. */
const SUNDAY_0230_UTC = new Date("2026-09-27T02:30:00Z");
/** Sun 27 Sep 2026, 23:30 UTC: already Monday 01:30 in Berlin. */
const SUNDAY_2330_UTC = new Date("2026-09-27T23:30:00Z");

function memoryStore(
  answer: (pathname: string) => Awaited<ReturnType<BlobStore["del"]>>,
): BlobStore & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    put: async () => ({ ok: true }),
    get: async () => ({ ok: true, data: null }),
    del: async (pathname) => {
      const r = answer(pathname);
      if (r.ok) deleted.push(pathname);
      return r;
    },
  };
}

const okStore = () => memoryStore(() => ({ ok: true }));

let reqSeq = 0;
async function claim(
  choreId: string,
  doneBy: string,
  when: Date,
  photo?: string,
) {
  reqSeq += 1;
  const r = await withTransaction((tx) =>
    logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy,
      loggedBy: doneBy,
      occurredAt: when,
      now: when,
      source: "ui",
      clientRequestId: `bg-${reqSeq}`,
      photoPathname: photo ?? null,
    }),
  );
  if (!r.ok) throw new Error(`log failed: ${r.code}`);
  return r.completion;
}

function detail(report: Awaited<ReturnType<typeof runSweep>>, step: string) {
  const s = report.steps.find((x) => x.step === step);
  if (!s?.ok) throw new Error(`step ${step} failed: ${JSON.stringify(s)}`);
  return s.detail;
}

beforeEach(() => {
  afterMock.mockReset();
  resetLocalCheckForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runSweep", () => {
  it("persists what is due, and a second run does nothing", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    const loggedAt = new Date(SUNDAY_0230_UTC.getTime() - 100 * DAY);
    const c = await claim(choreId, ryan, loggedAt, "completions/a/p.webp");
    const at = SUNDAY_0230_UTC;
    const store = okStore();

    const first = await runSweep(at, { blob: store });
    expect(first.at).toBe(at.toISOString());
    expect(detail(first, "settle")).toEqual({
      finalized: 1,
      expired: 0,
      timedOut: 0,
    });
    expect(detail(first, "photos")).toEqual({ pruned: 1, failed: 0, due: 1 });
    expect(store.deleted).toEqual(["completions/a/p.webp"]);
    const [row] = await t.db().select().from(completions);
    expect(row).toMatchObject({
      id: c.id,
      status: "finalized",
      photoPathname: null,
    });

    const second = await runSweep(at, { blob: store });
    expect(detail(second, "settle")).toEqual({
      finalized: 0,
      expired: 0,
      timedOut: 0,
    });
    expect(detail(second, "seasons")).toEqual({ closing: 0, closed: 0 });
    expect(detail(second, "photos")).toEqual({ pruned: 0, failed: 0, due: 0 });
    expect(store.deleted).toHaveLength(1);
  });

  it("closes the season and writes the winner after the last window", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    await claim(choreId, ryan, berlinWallTimeToUtc(2026, 12, 31, 20));
    const endsAt = berlinWallTimeToUtc(2027, 1, 1);
    const store = okStore();

    const closing = await runSweep(new Date(endsAt.getTime() + HOUR), {
      blob: store,
    });
    expect(detail(closing, "seasons")).toEqual({ closing: 1, closed: 0 });
    const closedAt = new Date(
      endsAt.getTime() + RULESET_V1.maxBackdateH * HOUR,
    );
    const closed = await runSweep(closedAt, { blob: store });
    expect(detail(closed, "seasons")).toEqual({ closing: 0, closed: 1 });
    const [season] = await t.db().select().from(seasons);
    expect(season).toMatchObject({ status: "closed", winnerMemberId: ryan });
    expect(
      detail(await runSweep(closedAt, { blob: store }), "seasons"),
    ).toEqual({ closing: 0, closed: 0 });
  });

  it("runs the weights step by the Berlin weekday, never by the UTC one", async () => {
    await seedChore(db(), SEED_CHORES.trash);
    const store = okStore();
    expect(isBerlinMonday(SUNDAY_2330_UTC)).toBe(true);
    for (const [at, monday] of [
      [MONDAY_0230_UTC, true],
      [SUNDAY_0230_UTC, false],
      [SUNDAY_2330_UTC, true],
    ] as const) {
      const w = detail(await runSweep(at, { blob: store }), "weights");
      if (monday) {
        expect(w).toMatchObject({ measured: 1, suggested: 0, applied: 0 });
      } else {
        expect(w).toEqual({ skipped: "not Monday in Berlin" });
      }
    }
  });

  it("leaves photos alone while Blob is not set up, and retries a failed delete", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    const old = new Date(
      SUNDAY_0230_UTC.getTime() - (PHOTO_RETENTION_DAYS + 5) * DAY,
    );
    await claim(choreId, ryan, old, "completions/a/p.webp");

    const none = memoryStore(() => ({ ok: false, reason: "not_configured" }));
    const r1 = await runSweep(SUNDAY_0230_UTC, { blob: none });
    expect(detail(r1, "photos")).toEqual({
      pruned: 0,
      due: 1,
      blob: "not_configured",
    });
    const down = memoryStore(() => ({ ok: false, reason: "unavailable" }));
    const r2 = await runSweep(SUNDAY_0230_UTC, { blob: down });
    expect(detail(r2, "photos")).toEqual({ pruned: 0, failed: 1, due: 1 });
    const [row] = await t.db().select().from(completions);
    expect(row!.photoPathname).toBe("completions/a/p.webp");
  });

  it("reports a failing step, scrubbed, and still runs the others", async () => {
    vi.stubEnv("CRON_SECRET", "super-secret-value");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    await claim(
      choreId,
      ryan,
      new Date(SUNDAY_0230_UTC.getTime() - 100 * DAY),
      "completions/a/p.webp",
    );
    const throwing: BlobStore = {
      ...okStore(),
      del: async () => {
        throw new Error("boom with super-secret-value inside");
      },
    };
    const report = await runSweep(SUNDAY_0230_UTC, { blob: throwing });
    expect(report.steps.map((s) => [s.step, s.ok])).toEqual([
      ["settle", true],
      ["seasons", true],
      ["weights", true],
      ["photos", false],
      ["logins", true],
      ["kiosk_pairings", true],
    ]);
    expect(errors).toHaveBeenCalledWith(
      "[sweep] photos failed: boom with [redacted] inside",
    );
  });
});

describe("the logins step", () => {
  it("deletes sign-in requests older than a day, and keeps newer ones", async () => {
    const make = (secret: string, at: Date) =>
      insertLoginRequest(db(), {
        memberId: null,
        secret,
        code: 47,
        choices: [12, 47, 83],
        device: "a browser",
        now: at,
      });
    const old = new Date(
      SUNDAY_0230_UTC.getTime() - LOGIN_REQUEST_RETENTION_MS - 1,
    );
    await make("old-secret-0123456789abcdefghijklmnop", old);
    const fresh = await make(
      "new-secret-0123456789abcdefghijklmnop",
      SUNDAY_0230_UTC,
    );
    const report = await runSweep(SUNDAY_0230_UTC, { blob: okStore() });
    expect(detail(report, "logins")).toEqual({ deleted: 1 });
    const left = await t
      .db()
      .select({ id: loginRequests.id })
      .from(loginRequests);
    expect(left).toEqual([{ id: fresh.id }]);
  });
});

describe("the kiosk_pairings step", () => {
  it("deletes pairing requests older than a day, and keeps newer ones", async () => {
    const make = (code: string, at: Date) =>
      insertKioskPairingRequest(db(), {
        householdId: HOUSEHOLD_ID,
        secret: `secret-${code}`,
        code,
        device: "Safari on iPad",
        now: at,
      });
    const old = new Date(
      SUNDAY_0230_UTC.getTime() - KIOSK_PAIRING_RETENTION_MS - 1,
    );
    await make("OLD234", old);
    const fresh = await make("NEW234", SUNDAY_0230_UTC);
    const report = await runSweep(SUNDAY_0230_UTC, { blob: okStore() });
    expect(detail(report, "kiosk_pairings")).toEqual({ deleted: 1 });
    const left = await t
      .db()
      .select({ id: kioskPairingRequests.id })
      .from(kioskPairingRequests);
    expect(left).toEqual([{ id: fresh!.id }]);
  });
});

describe("redactSecrets", () => {
  it("replaces secret-looking env values, and nothing else", () => {
    const env = {
      CRON_SECRET: "abcdefgh12345",
      DATABASE_URL: "postgres://u:p@host/db",
      SHORT_TOKEN: "abc",
      PLAIN: "not-a-secret-at-all",
    };
    expect(
      redactSecrets(
        "abcdefgh12345 postgres://u:p@host/db abc not-a-secret-at-all",
        env,
      ),
    ).toBe("[redacted] [redacted] abc not-a-secret-at-all");
  });
});

describe("runSweepIfDue", () => {
  it("runs once per window across servers, and checks at most once a minute here", async () => {
    const at = SUNDAY_0230_UTC;
    expect(await runSweepIfDue(at)).toBe("ran");
    // The same server a moment later: not even asked.
    expect(await runSweepIfDue(new Date(at.getTime() + 1000))).toBe("not_due");
    // Another server (no local memory): the database row says no.
    resetLocalCheckForTests();
    expect(await runSweepIfDue(new Date(at.getTime() + 2000))).toBe("not_due");
  });
});

describe("runSweepAfterResponse", () => {
  it("schedules the sweep after the response", async () => {
    runSweepAfterResponse({});
    expect(afterMock).toHaveBeenCalledTimes(1);
    const task = afterMock.mock.calls[0]![0] as () => Promise<void>;
    await task();
  });

  it("logs a sweep that throws instead of failing the response", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await import("@baumy/db/rate-limit");
    vi.spyOn(db, "consumeRateLimit").mockRejectedValueOnce(new Error("down"));
    runSweepAfterResponse({});
    const task = afterMock.mock.calls[0]![0] as () => Promise<void>;
    await task();
    expect(errors).toHaveBeenCalledWith("[sweep] page-load sweep failed: down");
  });

  it("is off in E2E test mode", () => {
    runSweepAfterResponse({ E2E_TEST_MODE: "1" });
    expect(afterMock).not.toHaveBeenCalled();
  });
});
