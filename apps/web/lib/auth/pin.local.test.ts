import { randomUUID } from "node:crypto";
import { eq, inArray, like, or } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import { createHttpDb, isLocalProxy, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { actionRateLimit, auditEvents, members } from "@baumy/db/schema";
import { seedMember } from "@/test-utils/actions";
import { createKioskPinVerifier, defaultPinVerifierDeps } from "./pin";

// PIN guesses fired at once on real Postgres (Docker, through the Neon
// proxies), each its own statement on its own connection. Every attempt is
// counted before the PIN is checked, so a burst cannot get more than 5 PINs
// checked per device and member, and a burst across devices locks the PIN
// exactly once.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const db = () => createHttpDb() as unknown as Queryable;
const verify = createKioskPinVerifier(defaultPinVerifierDeps);
const seeded: string[] = [];

afterAll(async () => {
  if (seeded.length === 0) return;
  await db()
    .delete(auditEvents)
    .where(inArray(auditEvents.actorMemberId, seeded));
  for (const id of seeded) {
    await db()
      .delete(actionRateLimit)
      .where(
        or(
          eq(actionRateLimit.key, `pin24:${id}`),
          like(actionRateLimit.key, `pin:%:${id}`),
        ),
      );
  }
  await db().delete(members).where(inArray(members.id, seeded));
});

async function memberWithPin(): Promise<string> {
  const id = await seedMember(db(), {
    authUserId: `local_${randomUUID()}`,
    kioskPinHash: await hashKioskPin("4321"),
  });
  seeded.push(id);
  return id;
}

const attempt = (memberId: string, deviceId: string, pin = "0000") =>
  verify({
    householdId: HOUSEHOLD_ID,
    deviceId,
    memberId,
    pin,
    now: new Date(),
  });

describe("kiosk PIN attempts under concurrent guesses", () => {
  it("checks at most 5 PINs per device and member, however fast they come", async () => {
    const me = await memberWithPin();
    const verdicts = await Promise.all(
      Array.from({ length: 12 }, () => attempt(me, "dev-a")),
    );
    const reasons = verdicts.map((v) => (v.ok ? "ok" : v.reason));
    expect(reasons.filter((r) => r === "wrong")).toHaveLength(5);
    expect(reasons.filter((r) => r === "rate_limited")).toHaveLength(7);
  });

  it("locks exactly once when 10 failures land at the same moment", async () => {
    const me = await memberWithPin();
    const verdicts = await Promise.all(
      Array.from({ length: 10 }, (_, i) => attempt(me, `dev-${i % 5}`)),
    );
    const locked = verdicts.filter((v) => !v.ok && v.reason === "locked");
    expect(locked.length).toBeGreaterThanOrEqual(1);
    const [row] = await db()
      .select({ at: members.kioskPinLockedAt })
      .from(members)
      .where(eq(members.id, me));
    expect(row?.at).not.toBeNull();
    const audits = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorMemberId, me));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "kiosk_pin_locked" });
  });
});
