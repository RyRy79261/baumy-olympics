import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Queryable } from "../index";
import { session, stepUps, twoFactor, user } from "../schema";
import {
  STEP_UP_WINDOW_MS,
  findStepUp,
  grantStepUp,
  hasVerifiedTotp,
} from "../step-ups";
import { useTestDb } from "./_harness";

// "Confirm it's you" (issue #135): one sudo window per session, for 10
// minutes, never another session's.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-10-02T10:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

let seq = 0;
async function account(opts: { twoFactorEnabled?: boolean } = {}) {
  seq += 1;
  const userId = `u-${seq}`;
  await t
    .db()
    .insert(user)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@x.io`,
      twoFactorEnabled: opts.twoFactorEnabled ?? false,
    });
  return userId;
}

async function sessionOf(userId: string) {
  seq += 1;
  const id = `s-${seq}`;
  await t
    .db()
    .insert(session)
    .values({ id, token: `tok-${id}`, userId, expiresAt: at(86_400_000) });
  return id;
}

describe("grantStepUp and findStepUp", () => {
  it("opens a 10-minute window for that session only", async () => {
    const userId = await account();
    const mine = await sessionOf(userId);
    const other = await sessionOf(userId);
    expect(await findStepUp(db(), { sessionId: mine, userId, now: NOW })).toBe(
      null,
    );
    const { expiresAt } = await grantStepUp(db(), {
      sessionId: mine,
      userId,
      method: "passkey",
      now: NOW,
    });
    expect(expiresAt).toEqual(at(STEP_UP_WINDOW_MS));
    expect(
      await findStepUp(db(), { sessionId: mine, userId, now: at(1000) }),
    ).toEqual({ method: "passkey", expiresAt });
    // The last instant before it closes, then closed.
    expect(
      await findStepUp(db(), {
        sessionId: mine,
        userId,
        now: at(STEP_UP_WINDOW_MS - 1),
      }),
    ).not.toBeNull();
    expect(
      await findStepUp(db(), {
        sessionId: mine,
        userId,
        now: at(STEP_UP_WINDOW_MS),
      }),
    ).toBeNull();
    // Another session of the same account has none.
    expect(await findStepUp(db(), { sessionId: other, userId, now: NOW })).toBe(
      null,
    );
    // Nor does another account naming this session.
    const stranger = await account();
    expect(
      await findStepUp(db(), { sessionId: mine, userId: stranger, now: NOW }),
    ).toBeNull();
  });

  it("a second confirmation replaces the first", async () => {
    const userId = await account();
    const mine = await sessionOf(userId);
    await grantStepUp(db(), {
      sessionId: mine,
      userId,
      method: "password",
      now: NOW,
    });
    await grantStepUp(db(), {
      sessionId: mine,
      userId,
      method: "totp",
      now: at(5 * 60_000),
    });
    expect(await t.db().select().from(stepUps)).toHaveLength(1);
    expect(
      await findStepUp(db(), {
        sessionId: mine,
        userId,
        now: at(STEP_UP_WINDOW_MS + 1000),
      }),
    ).toEqual({
      method: "totp",
      expiresAt: at(5 * 60_000 + STEP_UP_WINDOW_MS),
    });
  });

  it("goes when the session is signed out", async () => {
    const userId = await account();
    const mine = await sessionOf(userId);
    await grantStepUp(db(), {
      sessionId: mine,
      userId,
      method: "baumy",
      now: NOW,
    });
    await t.db().delete(session).where(eq(session.id, mine));
    expect(await t.db().select().from(stepUps)).toEqual([]);
  });

  it("refuses a method it does not know", async () => {
    const userId = await account();
    const mine = await sessionOf(userId);
    await expect(
      t.db().insert(stepUps).values({
        sessionId: mine,
        userId,
        method: "sms",
        confirmedAt: NOW,
        expiresAt: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("hasVerifiedTotp", () => {
  it("is true only with two-factor on and a verified secret", async () => {
    const none = await account();
    expect(await hasVerifiedTotp(db(), none)).toBe(false);

    // Mid-enrolment: a secret, not verified, two-factor off.
    const half = await account();
    await t.db().insert(twoFactor).values({
      id: `tf-${half}`,
      userId: half,
      secret: "enc",
      backupCodes: "enc",
      verified: false,
    });
    expect(await hasVerifiedTotp(db(), half)).toBe(false);

    const on = await account({ twoFactorEnabled: true });
    await t.db().insert(twoFactor).values({
      id: `tf-${on}`,
      userId: on,
      secret: "enc",
      backupCodes: "enc",
      verified: true,
    });
    expect(await hasVerifiedTotp(db(), on)).toBe(true);
  });
});
