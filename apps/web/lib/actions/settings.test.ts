// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  actionRequests,
  auditEvents,
  members,
  session,
  telegramLinkCodes,
  user,
} from "@baumy/db/schema";
import { grantStepUp } from "@baumy/db/step-ups";
import {
  TELEGRAM_LINK_CODE_TTL_MS,
  hashTelegramLinkCode,
} from "@baumy/db/telegram-link-codes";
import { useTestDb } from "@baumy/db/test-harness";
import { verifyKioskPin } from "@baumy/auth/kiosk-pin";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { Actor } from "@/lib/auth";

// The /settings actions, through the real runAction on PGlite:
// set_kiosk_pin and create_telegram_link_code. Both need the member's own
// session: never the kiosk, MCP or brain.

const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const MIN = 60_000;

beforeEach(() => {
  __resetMemoryRateLimits();
});

let sessions = 0;
/**
 * A member's session with a real `session` row (signed in an hour ago), so
 * it can hold a sudo window.
 */
async function sessionWithRow(memberId: string) {
  sessions += 1;
  const userId = `settings-user-${sessions}`;
  const sessionId = `settings-sess-${sessions}`;
  await t
    .db()
    .insert(user)
    .values({ id: userId, name: userId, email: `${userId}@example.com` });
  await t
    .db()
    .insert(session)
    .values({
      id: sessionId,
      token: `tok-${sessionId}`,
      userId,
      createdAt: new Date(FIXED_NOW.getTime() - 60 * MIN),
      expiresAt: new Date(FIXED_NOW.getTime() + 24 * 60 * MIN),
    });
  return sessionActor(memberId, "member", { userId, sessionId });
}

async function row(id: string) {
  const [r] = await t.db().select().from(members).where(eq(members.id, id));
  return r!;
}

/** A session that signed in `minutesAgo` before FIXED_NOW. */
function signedIn(memberId: string, minutesAgo: number) {
  return sessionActor(memberId, "member", {
    sessionCreatedAt: new Date(
      FIXED_NOW.getTime() - minutesAgo * MIN,
    ).toISOString(),
  });
}

async function otherActors(memberId: string): Promise<[Actor, string][]> {
  return [
    [kioskActor(memberId), "kiosk"],
    [{ kind: "mcp", memberId, scopes: ["baumy:read", "baumy:write"] }, "mcp"],
    [{ kind: "service", tokenName: "baumy-brain", memberId }, "brain"],
    [sessionActor(undefined), "no member"],
  ];
}

describe("set_kiosk_pin", () => {
  it("sets a first PIN with nothing more, and lifts a lock", async () => {
    const me = await seedMember(db(), { kioskPinLockedAt: FIXED_NOW });
    const res = await runAction(
      "set_kiosk_pin",
      { pin: "4321" },
      ctxFor(signedIn(me, 120)),
    );
    expect(res).toEqual({ ok: true, data: { changed: false } });
    const stored = await row(me);
    expect(stored.kioskPinLockedAt).toBeNull();
    await expect(verifyKioskPin("4321", stored.kioskPinHash!)).resolves.toBe(
      true,
    );
  });

  it("keeps the PIN out of the ledger and the audit row", async () => {
    const me = await seedMember(db(), { kioskPinHash: "scrypt$old" });
    const actor = await sessionWithRow(me);
    await grantStepUp(db(), {
      sessionId: actor.sessionId!,
      userId: actor.userId,
      method: "password",
      now: FIXED_NOW,
    });
    await runAction("set_kiosk_pin", { pin: "987654" }, ctxFor(actor));
    const ledger = await t.db().select().from(actionRequests);
    const audits = await t.db().select().from(auditEvents);
    expect(audits).toEqual([
      expect.objectContaining({
        action: "set_kiosk_pin",
        entityId: me,
        payload: { changed: true },
      }),
    ]);
    const everything = JSON.stringify([ledger, audits]);
    expect(everything).not.toContain("987654");
  });

  it("changing a PIN needs 'Confirm it's you' when the session is 10 minutes old or more", async () => {
    const me = await seedMember(db(), { kioskPinHash: "scrypt$old" });
    await expect(
      runAction("set_kiosk_pin", { pin: "1111" }, ctxFor(signedIn(me, 10))),
    ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    expect((await row(me)).kioskPinHash).toBe("scrypt$old");

    const actor = await sessionWithRow(me);
    await expect(
      runAction("set_kiosk_pin", { pin: "1111" }, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    await grantStepUp(db(), {
      sessionId: actor.sessionId!,
      userId: actor.userId,
      method: "totp",
      now: FIXED_NOW,
    });
    await expect(
      runAction("set_kiosk_pin", { pin: "1111" }, ctxFor(actor)),
    ).resolves.toEqual({ ok: true, data: { changed: true } });
    await expect(
      verifyKioskPin("1111", (await row(me)).kioskPinHash!),
    ).resolves.toBe(true);
    // The old password field is gone.
    await expect(
      runAction(
        "set_kiosk_pin",
        { pin: "1111", currentPassword: "x" },
        ctxFor(actor),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("a session's age alone never lets the PIN change", async () => {
    // Signed in a minute ago, or "in the future": with no window, refused.
    const me = await seedMember(db(), { kioskPinHash: "scrypt$old" });
    for (const minutesAgo of [1, 9, -5]) {
      await expect(
        runAction(
          "set_kiosk_pin",
          { pin: "2222" },
          ctxFor(signedIn(me, minutesAgo)),
        ),
      ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    }
    expect((await row(me)).kioskPinHash).toBe("scrypt$old");
  });

  it("refuses a PIN that is not 4 to 6 digits", async () => {
    const me = await seedMember(db());
    for (const pin of ["123", "1234567", "12ab", ""]) {
      await expect(
        runAction("set_kiosk_pin", { pin }, ctxFor(signedIn(me, 1))),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect((await row(me)).kioskPinHash).toBeNull();
  });

  it("a kiosk, MCP or brain actor gets FORBIDDEN; other surfaces are refused first", async () => {
    const me = await seedMember(db());
    for (const [actor] of await otherActors(me)) {
      await expect(
        runAction(
          "set_kiosk_pin",
          { pin: "1234" },
          ctxFor(actor, { pin: "1234" }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(
      runAction(
        "set_kiosk_pin",
        { pin: "1234" },
        ctxFor(kioskActor(me), { source: "kiosk" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect((await row(me)).kioskPinHash).toBeNull();
  });
});

describe("create_telegram_link_code", () => {
  it("shows the code once and stores only its hash, for 10 minutes", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const res = await runAction("create_telegram_link_code", {}, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { code, expiresAt } = res.data;
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    expect(expiresAt).toBe(
      new Date(FIXED_NOW.getTime() + 10 * MIN).toISOString(),
    );

    const stored = await t.db().select().from(telegramLinkCodes);
    expect(stored).toEqual([
      expect.objectContaining({
        codeHash: hashTelegramLinkCode(code!),
        memberId: me,
        usedAt: null,
      }),
    ]);
    const everything = JSON.stringify([
      stored,
      await t.db().select().from(actionRequests),
      await t.db().select().from(auditEvents),
    ]);
    expect(everything).not.toContain(code!);

    // A replay of the same request cannot show it again.
    await expect(
      runAction("create_telegram_link_code", {}, ctx),
    ).resolves.toEqual({
      ok: true,
      data: {
        code: null,
        expiresAt,
        expiresInSeconds: TELEGRAM_LINK_CODE_TTL_MS / 1000,
      },
    });
    expect(await t.db().select().from(telegramLinkCodes)).toHaveLength(1);
  });

  it("a kiosk, MCP or brain actor gets FORBIDDEN", async () => {
    const me = await seedMember(db());
    for (const [actor] of await otherActors(me)) {
      await expect(
        runAction(
          "create_telegram_link_code",
          {},
          ctxFor(actor, { pin: "1234" }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(
      runAction(
        "create_telegram_link_code",
        {},
        ctxFor(kioskActor(me), { source: "kiosk" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(await t.db().select().from(telegramLinkCodes)).toHaveLength(0);
  });
});

describe("get_telegram_link_status", () => {
  const TG = 5_000_000_301;
  const TTL_S = TELEGRAM_LINK_CODE_TTL_MS / 1000;
  const status = (memberId: string, now = FIXED_NOW) =>
    runAction(
      "get_telegram_link_status",
      {},
      ctxFor(sessionActor(memberId), { now }),
    );
  const makeCode = async (memberId: string, now = FIXED_NOW) => {
    const res = await runAction(
      "create_telegram_link_code",
      {},
      ctxFor(sessionActor(memberId), { now }),
    );
    if (!res.ok || !res.data.code) throw new Error("no code");
    return res.data.code;
  };
  const redeem = (code: string, now: Date) =>
    runAction(
      "link_telegram",
      { code },
      ctxFor(
        { kind: "service", tokenName: "baumy-brain", telegramUserId: TG },
        { source: "brain", now },
      ),
    );
  const at = (ms: number) => new Date(FIXED_NOW.getTime() + ms);

  it("says not linked, and no code, before the member makes one", async () => {
    const me = await seedMember(db());
    await expect(status(me)).resolves.toEqual({
      ok: true,
      data: { linked: false, code: null },
    });
  });

  it("counts the new code down in the server's seconds, then expires it", async () => {
    const me = await seedMember(db());
    await makeCode(me);
    await expect(status(me, at(90_000 + 400))).resolves.toEqual({
      ok: true,
      data: {
        linked: false,
        code: { state: "waiting", secondsLeft: TTL_S - 90 },
      },
    });
    await expect(status(me, at(TELEGRAM_LINK_CODE_TTL_MS))).resolves.toEqual({
      ok: true,
      data: { linked: false, code: { state: "expired", secondsLeft: 0 } },
    });
  });

  it("says used when the member relinks the Telegram account they had", async () => {
    const me = await seedMember(db());
    const first = await makeCode(me);
    await expect(redeem(first, at(MIN))).resolves.toMatchObject({ ok: true });
    await expect(status(me, at(MIN))).resolves.toEqual({
      ok: true,
      data: { linked: true, code: { state: "used", secondsLeft: 0 } },
    });

    // Already linked to TG: a new code waits, then the same TG uses it. The
    // Telegram id never changes, and the code still reads as used.
    const second = await makeCode(me, at(2 * MIN));
    await expect(status(me, at(2 * MIN))).resolves.toMatchObject({
      data: { linked: true, code: { state: "waiting", secondsLeft: TTL_S } },
    });
    await expect(redeem(second, at(3 * MIN))).resolves.toMatchObject({
      ok: true,
    });
    expect((await row(me)).telegramUserId).toBe(TG);
    await expect(status(me, at(3 * MIN))).resolves.toEqual({
      ok: true,
      data: { linked: true, code: { state: "used", secondsLeft: 0 } },
    });
  });

  it("a kiosk, MCP or brain actor gets FORBIDDEN, and a missing member NOT_FOUND", async () => {
    const me = await seedMember(db());
    for (const [actor] of await otherActors(me)) {
      await expect(
        runAction("get_telegram_link_status", {}, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(
      runAction(
        "get_telegram_link_status",
        {},
        ctxFor(kioskActor(me), { source: "kiosk" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    await expect(
      status("00000000-0000-4000-8000-000000000000"),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
