// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  KIOSK_PIN_DAY_LIMIT,
  KIOSK_PIN_SHORT_LIMIT,
  KIOSK_PIN_SHORT_WINDOW_MS,
} from "@baumy/db/kiosk-pin";
import { consumeRateLimit } from "@baumy/db/rate-limit";
import { actionRateLimit, auditEvents, members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { FIXED_NOW, seedMember } from "@/test-utils/actions";
import {
  createKioskPinVerifier,
  defaultPinVerifierDeps,
  type PinCheck,
  type PinVerifierDeps,
} from "./pin";

// Kiosk PIN attestation against real Postgres (PGlite): the scrypt check,
// both attempt limits in action_rate_limit, the lock after the 10th failure
// with its audit row, and failing closed when an attempt cannot be counted.
// The counters run on the test's clock, so windows can be stepped through.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

const deps: PinVerifierDeps = {
  ...defaultPinVerifierDeps,
  // The test's clock, not the database's, so a window can be stepped past.
  consume: (input) => consumeRateLimit(input),
};
const verify = createKioskPinVerifier(deps);

const at = (ms: number) => new Date(FIXED_NOW.getTime() + ms);

async function member(overrides: Partial<typeof members.$inferInsert> = {}) {
  return seedMember(db(), { kioskPinHash: pinHash, ...overrides });
}

function check(
  memberId: string,
  pin: string,
  now = FIXED_NOW,
  deviceId = "dev-a",
): PinCheck {
  return { householdId: HOUSEHOLD_ID, deviceId, memberId, pin, now };
}

async function counters() {
  const rows = await t.db().select().from(actionRateLimit);
  return Object.fromEntries(rows.map((r) => [r.key, r.count]));
}

async function lockedAt(id: string) {
  const [r] = await t
    .db()
    .select({ at: members.kioskPinLockedAt })
    .from(members)
    .where(eq(members.id, id));
  return r?.at ?? null;
}

describe("the PIN itself", () => {
  it("accepts the member's PIN and refuses another", async () => {
    const me = await member();
    await expect(verify(check(me, PIN))).resolves.toEqual({ ok: true });
    await expect(verify(check(me, "1234"))).resolves.toEqual({
      ok: false,
      reason: "wrong",
    });
  });

  it("refuses when the member has no PIN, is deactivated or is elsewhere", async () => {
    const none = await seedMember(db());
    await expect(verify(check(none, PIN))).resolves.toEqual({
      ok: false,
      reason: "no_pin",
    });
    const gone = await member({ deactivatedAt: FIXED_NOW });
    await expect(verify(check(gone, PIN))).resolves.toMatchObject({
      reason: "no_pin",
    });
    const me = await member();
    await expect(
      verify({
        ...check(me, PIN),
        householdId: "00000000-0000-4000-8000-000000000099",
      }),
    ).resolves.toMatchObject({ reason: "no_pin" });
    // None of these counted an attempt.
    expect(await counters()).toEqual({});
  });

  it("counts only failures: a correct PIN gives its attempt back", async () => {
    const me = await member();
    await verify(check(me, "0000"));
    await verify(check(me, PIN));
    await verify(check(me, PIN));
    expect(await counters()).toEqual({
      [`pin:dev-a:${me}`]: 1,
      [`pin24:${me}`]: 1,
    });
  });
});

describe("5 per 15 minutes per device and member", () => {
  it("refuses the 6th wrong PIN in the window without checking it", async () => {
    const me = await member();
    for (let i = 0; i < KIOSK_PIN_SHORT_LIMIT; i++) {
      await expect(verify(check(me, "0000"))).resolves.toMatchObject({
        reason: "wrong",
      });
    }
    // The 6th is refused even when it is the right PIN.
    const sixth = await verify(check(me, PIN, at(60_000)));
    expect(sixth).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(sixth.ok ? 0 : sixth.retryAfterSeconds).toBe(14 * 60);

    // Another device, or the next window, may try again.
    await expect(verify(check(me, PIN, at(60_000), "dev-b"))).resolves.toEqual({
      ok: true,
    });
    await expect(
      verify(check(me, PIN, at(KIOSK_PIN_SHORT_WINDOW_MS))),
    ).resolves.toEqual({ ok: true });
  });

  it("does not use up the limit with correct PINs", async () => {
    const me = await member();
    for (let i = 0; i < KIOSK_PIN_SHORT_LIMIT + 3; i++) {
      await expect(verify(check(me, PIN))).resolves.toEqual({ ok: true });
    }
  });
});

describe("10 failures per 24h lock the PIN", () => {
  async function fail(me: string, times: number, start: number) {
    for (let i = 0; i < times; i++) {
      await verify(check(me, "0000", at(start + i)));
    }
  }

  it("locks on the 10th failure, writes one audit row, and then refuses even the right PIN", async () => {
    const me = await member();
    await fail(me, 5, 0);
    // Next 15-minute window, same day: 4 more wrong ones are just wrong.
    await fail(me, 4, KIOSK_PIN_SHORT_WINDOW_MS);
    expect(await lockedAt(me)).toBeNull();
    expect(await t.db().select().from(auditEvents)).toHaveLength(0);

    const tenthAt = at(KIOSK_PIN_SHORT_WINDOW_MS + 10);
    await expect(verify(check(me, "0000", tenthAt))).resolves.toEqual({
      ok: false,
      reason: "locked",
      justLocked: true,
    });
    expect(await lockedAt(me)).toEqual(tenthAt);
    const audits = await t.db().select().from(auditEvents);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorMemberId: me,
      source: "kiosk",
      action: "kiosk_pin_locked",
      entity: "member",
      entityId: me,
      payload: { deviceId: "dev-a", failures: KIOSK_PIN_DAY_LIMIT },
      at: tenthAt,
    });

    // Locked: the right PIN on another device next week is still refused,
    // and nothing more is counted.
    const before = await counters();
    await expect(
      verify(check(me, PIN, at(7 * 24 * 60 * 60_000), "dev-b")),
    ).resolves.toEqual({ ok: false, reason: "locked" });
    expect(await counters()).toEqual(before);
    expect(await t.db().select().from(auditEvents)).toHaveLength(1);
  });

  it("lets a right 10th attempt through: only failures lock", async () => {
    const me = await member();
    await fail(me, 5, 0);
    await fail(me, 4, KIOSK_PIN_SHORT_WINDOW_MS);
    await expect(
      verify(check(me, PIN, at(KIOSK_PIN_SHORT_WINDOW_MS + 10))),
    ).resolves.toEqual({ ok: true });
    expect(await lockedAt(me)).toBeNull();
  });

  it("counts failures on every device toward one member's lock", async () => {
    const me = await member();
    for (let i = 0; i < 9; i++) {
      await verify(check(me, "0000", FIXED_NOW, `dev-${i % 3}`));
    }
    await expect(
      verify(check(me, "0000", FIXED_NOW, "dev-9")),
    ).resolves.toMatchObject({ reason: "locked", justLocked: true });
  });

  it("forgets failures after 24h", async () => {
    const me = await member();
    await fail(me, 5, 0);
    await fail(me, 4, KIOSK_PIN_SHORT_WINDOW_MS);
    const nextDay = 24 * 60 * 60_000;
    await expect(verify(check(me, "0000", at(nextDay)))).resolves.toMatchObject(
      { reason: "wrong" },
    );
    expect(await lockedAt(me)).toBeNull();
  });
});

describe("failing closed", () => {
  it("accepts no PIN when an attempt cannot be counted", async () => {
    const me = await member();
    const refund = vi.fn(async () => {});
    const down = createKioskPinVerifier({
      ...deps,
      consume: async () => null,
    });
    await expect(down(check(me, PIN))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    // The first counter stored, the second did not: its attempt is given
    // back, and still nothing is accepted.
    let calls = 0;
    const halfDown = createKioskPinVerifier({
      ...deps,
      refund,
      consume: async (input) =>
        ++calls === 1 ? consumeRateLimit(input) : null,
    });
    await expect(halfDown(check(me, PIN))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(refund).toHaveBeenCalledWith(`pin:dev-a:${me}`);
  });
});

describe("the counters' clock", () => {
  async function windowStart(key: string) {
    const [row] = await t
      .db()
      .select()
      .from(actionRateLimit)
      .where(eq(actionRateLimit.key, key));
    return row!.windowStart;
  }

  it("is the database's, except in E2E test mode, where it is the movable test clock", async () => {
    const input = { limit: 5, windowMs: 60_000, now: FIXED_NOW };
    await defaultPinVerifierDeps.consume({ ...input, key: "pin:db" });
    expect(Math.abs((await windowStart("pin:db")) - Date.now())).toBeLessThan(
      60_000,
    );
    vi.stubEnv("E2E_TEST_MODE", "1");
    try {
      await defaultPinVerifierDeps.consume({ ...input, key: "pin:test" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await windowStart("pin:test")).toBe(FIXED_NOW.getTime());
  });
});
