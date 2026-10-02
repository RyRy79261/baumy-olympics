// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import type * as AccountSecurity from "@baumy/db/account-security";
import {
  actionRequests,
  auditEvents,
  serviceTokens,
  session,
  user,
} from "@baumy/db/schema";
import {
  SERVICE_TOKEN_PREFIX,
  findLiveServiceToken,
  hashServiceToken,
  listServiceTokens,
} from "@baumy/db/service-tokens";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { STEP_UP_WINDOW_MS, grantStepUp } from "@baumy/db/step-ups";
import type * as StepUps from "@baumy/db/step-ups";
import type { Actor, MemberActor } from "@/lib/auth";
import { FRESH_SESSION_MS } from "@/lib/auth/recent-auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { ActionName } from "./define";
import {
  DEFAULT_SERVICE_TOKEN_NAME,
  SERVICE_TOKEN_SCOPES,
} from "./service-tokens";

// /admin/connections (issue #104), through the real runAction on PGlite:
// create, rotate and revoke brain's service token. Admin only, UI only, a
// live session, and a recent "Confirm it's you" (issue #135): a session
// signed in, or confirmed, in the last 10 minutes.

/**
 * What the re-auth path did, in order: the sudo window read and the session
 * lock (`isLiveSession`, `FOR SHARE`). PGlite has one connection, so the
 * hang the order prevents (PR #105) cannot happen here; the order is pinned
 * instead.
 */
const calls = vi.hoisted(() => [] as string[]);
vi.mock("@baumy/db/step-ups", async (importOriginal) => {
  const real = await importOriginal<typeof StepUps>();
  return {
    ...real,
    findStepUp: (...args: Parameters<typeof real.findStepUp>) => {
      calls.push("findStepUp");
      return real.findStepUp(...args);
    },
  };
});
vi.mock("@baumy/db/account-security", async (importOriginal) => {
  const real = await importOriginal<typeof AccountSecurity>();
  return {
    ...real,
    isLiveSession: (...args: Parameters<typeof real.isLiveSession>) => {
      calls.push("isLiveSession");
      return real.isLiveSession(...args);
    },
  };
});

const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const HOUR = 3_600_000;

beforeEach(() => {
  __resetMemoryRateLimits();
  calls.length = 0;
});

let seq = 0;

/**
 * An admin whose session row exists: signed in `ageMs` ago (an hour by
 * default, so not fresh).
 */
async function admin(ageMs = HOUR): Promise<MemberActor> {
  seq += 1;
  const userId = `admin_${seq}`;
  const sessionId = `sess_${seq}`;
  await t
    .db()
    .insert(user)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
    });
  const createdAt = new Date(FIXED_NOW.getTime() - ageMs);
  await t
    .db()
    .insert(session)
    .values({
      id: sessionId,
      token: `tok-${sessionId}`,
      userId,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(FIXED_NOW.getTime() + 24 * HOUR),
    });
  const memberId = await seedMember(db(), {
    role: "admin",
    authUserId: userId,
  });
  return sessionActor(memberId, "admin", {
    userId,
    sessionId,
    sessionCreatedAt: createdAt.toISOString(),
  });
}

const freshAdmin = () => admin(5 * 60_000);

/** Open the sudo window of `actor`'s session at `now`. */
function confirm(actor: MemberActor, now = FIXED_NOW) {
  return grantStepUp(db(), {
    sessionId: actor.sessionId!,
    userId: actor.userId,
    method: "passkey",
    now,
  });
}

async function tokenData(res: Awaited<ReturnType<typeof runAction>>) {
  expect(res.ok).toBe(true);
  return (res as { ok: true; data: { token: string } }).data.token;
}

describe("create_service_token", () => {
  it("shows a new brain token once, storing only its hash", async () => {
    const ctx = ctxFor(await freshAdmin());
    const res = await runAction("create_service_token", {}, ctx);
    expect(res).toMatchObject({
      ok: true,
      data: { name: DEFAULT_SERVICE_TOKEN_NAME, scopes: SERVICE_TOKEN_SCOPES },
    });
    const token = await tokenData(res);
    expect(token.startsWith(SERVICE_TOKEN_PREFIX)).toBe(true);
    await expect(findLiveServiceToken(db(), token)).resolves.toMatchObject({
      name: "baumy-brain",
      scopes: ["brain"],
    });

    const stored = await t.db().select().from(serviceTokens);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(hashServiceToken(token));
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      action: "create_service_token",
      entity: "service_token",
      entityId: "baumy-brain",
      payload: { name: "baumy-brain", scopes: ["brain"] },
    });
    const [ledger] = await t.db().select().from(actionRequests);
    expect(ledger!.result).toMatchObject({ ok: true, data: { token: null } });
    // Neither the ledger nor the audit trail ever holds the plaintext.
    for (const row of [...stored, audit, ledger]) {
      expect(JSON.stringify(row)).not.toContain(token);
    }

    // A replay of the same request gets no token.
    await expect(runAction("create_service_token", {}, ctx)).resolves.toEqual({
      ok: true,
      data: { name: "baumy-brain", scopes: ["brain"], token: null },
    });
  });

  it("takes another name, and refuses a bad one", async () => {
    const actor = await freshAdmin();
    await expect(
      runAction("create_service_token", { name: "robot" }, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: true, data: { name: "robot" } });
    await expect(
      runAction("create_service_token", { name: "Bad Name" }, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("refuses a second live token for the same name", async () => {
    const actor = await freshAdmin();
    await runAction("create_service_token", {}, ctxFor(actor));
    await expect(
      runAction("create_service_token", {}, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: false, code: "SERVICE_TOKEN_EXISTS" });
    expect(await listServiceTokens(db())).toHaveLength(1);
  });

  it("needs 'Confirm it's you' when the sign-in is over 10 minutes old", async () => {
    const actor = await admin(FRESH_SESSION_MS);
    const run = (now = FIXED_NOW) =>
      runAction("create_service_token", {}, ctxFor(actor, { now }));
    await expect(run()).resolves.toMatchObject({
      ok: false,
      code: "REAUTH_REQUIRED",
      message: expect.stringContaining("Confirm it's you"),
    });
    // The old password field is gone: the input refuses it.
    await expect(
      runAction(
        "create_service_token",
        { currentPassword: "x" },
        ctxFor(actor),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await listServiceTokens(db())).toHaveLength(0);

    await confirm(actor);
    await tokenData(await run());
    expect(await listServiceTokens(db())).toHaveLength(1);
  });

  it("takes only this session's window, and only while it is open", async () => {
    const actor = await admin();
    // Another session of the same admin confirmed: not this one.
    const otherSession = "sess_other_device";
    await t
      .db()
      .insert(session)
      .values({
        id: otherSession,
        token: `tok-${otherSession}`,
        userId: actor.userId,
        expiresAt: new Date(FIXED_NOW.getTime() + 24 * HOUR),
      });
    await confirm({ ...actor, sessionId: otherSession });
    const create = (name: string, now = FIXED_NOW) =>
      runAction("create_service_token", { name }, ctxFor(actor, { now }));
    await expect(create("robot-a")).resolves.toMatchObject({
      ok: false,
      code: "REAUTH_REQUIRED",
    });

    await confirm(actor);
    // The window skips the second prompt too.
    await tokenData(await create("robot-a"));
    await tokenData(
      await create(
        "robot-b",
        new Date(FIXED_NOW.getTime() + STEP_UP_WINDOW_MS - 1000),
      ),
    );
    // Then it closes.
    await expect(
      create("robot-c", new Date(FIXED_NOW.getTime() + STEP_UP_WINDOW_MS)),
    ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    expect((await listServiceTokens(db())).map((r) => r.name).sort()).toEqual([
      "robot-a",
      "robot-b",
    ]);
  });

  it("reads the window before it locks the session row", async () => {
    // A proof checked by Better Auth may UPDATE the session row on its own
    // connection; holding FOR SHARE on it first would hang the request.
    for (const name of [
      "create_service_token",
      "rotate_service_token",
      "revoke_service_token",
    ] as const) {
      if (name !== "create_service_token") {
        await runAction("create_service_token", {}, ctxFor(await freshAdmin()));
      }
      const actor = await admin();
      await confirm(actor);
      calls.length = 0;
      const res = await runAction(name, { name: "baumy-brain" }, ctxFor(actor));
      expect(res.ok).toBe(true);
      expect(calls).toEqual(["findStepUp", "isLiveSession"]);
      if (name === "rotate_service_token") {
        await runAction(
          "revoke_service_token",
          { name: "baumy-brain" },
          ctxFor(actor),
        );
      }
    }
  });

  it("refuses the 11th try in 15 minutes", async () => {
    const actor = await admin();
    for (let i = 0; i < 10; i += 1) {
      await expect(
        runAction("create_service_token", {}, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    }
    await confirm(actor);
    calls.length = 0;
    await expect(
      runAction("create_service_token", {}, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // Refused before anything is read, and nothing minted.
    expect(calls).toEqual([]);
    expect(await listServiceTokens(db())).toHaveLength(0);
  });

  it("refuses a device that was signed out elsewhere", async () => {
    const actor = await freshAdmin();
    await t.db().delete(session);
    await expect(
      runAction("create_service_token", {}, ctxFor(actor)),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
      message: expect.stringContaining("service tokens"),
    });
    expect(await listServiceTokens(db())).toHaveLength(0);
  });
});

describe("rotate_service_token", () => {
  it("kills the old token as it shows the new one", async () => {
    const actor = await freshAdmin();
    const old = await tokenData(
      await runAction("create_service_token", {}, ctxFor(actor)),
    );
    const res = await runAction(
      "rotate_service_token",
      { name: "baumy-brain" },
      ctxFor(actor),
    );
    const token = await tokenData(res);
    expect(token).not.toBe(old);
    await expect(findLiveServiceToken(db(), old)).resolves.toBeNull();
    await expect(findLiveServiceToken(db(), token)).resolves.not.toBeNull();
    const audits = await t.db().select().from(auditEvents);
    expect(audits.map((a) => a.action)).toEqual([
      "create_service_token",
      "rotate_service_token",
    ]);
    expect(JSON.stringify(audits)).not.toContain(token);
    const ledger = await t.db().select().from(actionRequests);
    expect(JSON.stringify(ledger)).not.toContain(token);
  });

  it("refuses a name with no live token, minting nothing", async () => {
    const actor = await freshAdmin();
    await expect(
      runAction("rotate_service_token", { name: "baumy-brain" }, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await listServiceTokens(db())).toHaveLength(0);
  });

  it("needs a recent 'Confirm it's you', and a live session", async () => {
    const fresh = await freshAdmin();
    await runAction("create_service_token", {}, ctxFor(fresh));
    const stale = await admin();
    await expect(
      runAction("rotate_service_token", { name: "baumy-brain" }, ctxFor(stale)),
    ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    await t.db().delete(session);
    await expect(
      runAction("rotate_service_token", { name: "baumy-brain" }, ctxFor(fresh)),
    ).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    // Still the one token, still live.
    const list = await listServiceTokens(db());
    expect(list).toHaveLength(1);
    expect(list[0]!.revokedAt).toBeNull();
  });
});

describe("revoke_service_token", () => {
  it("revokes the live token once, after 'Confirm it's you'", async () => {
    const fresh = await freshAdmin();
    const token = await tokenData(
      await runAction("create_service_token", {}, ctxFor(fresh)),
    );
    const stale = await admin();
    await expect(
      runAction("revoke_service_token", { name: "baumy-brain" }, ctxFor(stale)),
    ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
    await expect(findLiveServiceToken(db(), token)).resolves.not.toBeNull();
    await confirm(stale);
    await expect(
      runAction("revoke_service_token", { name: "baumy-brain" }, ctxFor(stale)),
    ).resolves.toEqual({ ok: true, data: { name: "baumy-brain" } });
    await expect(findLiveServiceToken(db(), token)).resolves.toBeNull();
    const audits = await t.db().select().from(auditEvents);
    expect(audits.at(-1)).toMatchObject({
      action: "revoke_service_token",
      entity: "service_token",
      entityId: "baumy-brain",
    });
    await expect(
      runAction("revoke_service_token", { name: "baumy-brain" }, ctxFor(stale)),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses a device that was signed out elsewhere", async () => {
    const actor = await freshAdmin();
    await runAction("create_service_token", {}, ctxFor(actor));
    await t.db().delete(session);
    await expect(
      runAction("revoke_service_token", { name: "baumy-brain" }, ctxFor(actor)),
    ).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect((await listServiceTokens(db()))[0]!.revokedAt).toBeNull();
  });
});

describe("who may manage service tokens", () => {
  const WRITES: [ActionName, Record<string, unknown>][] = [
    ["create_service_token", {}],
    ["rotate_service_token", { name: "baumy-brain" }],
    ["revoke_service_token", { name: "baumy-brain" }],
  ];

  it("is refused to everyone but an admin session", async () => {
    // A live token, so a wrongly allowed rotate or revoke would succeed.
    await runAction("create_service_token", {}, ctxFor(await freshAdmin()));
    const plain = await seedMember(db());
    const someAdmin = await seedMember(db(), { role: "admin" });
    const actors: Actor[] = [
      sessionActor(plain, "member", {
        sessionCreatedAt: FIXED_NOW.toISOString(),
      }),
      sessionActor(undefined),
      kioskActor(someAdmin),
      {
        kind: "mcp",
        memberId: someAdmin,
        scopes: ["baumy:read", "baumy:write"],
      },
      { kind: "service", tokenName: "baumy-brain", memberId: someAdmin },
    ];
    for (const [name, input] of WRITES) {
      for (const actor of actors) {
        await expect(
          runAction(name, input, ctxFor(actor)),
        ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
      }
    }
    const list = await listServiceTokens(db());
    expect(list).toHaveLength(1);
    expect(list[0]!.revokedAt).toBeNull();
  });

  it("is offered on the UI only", async () => {
    const actor = await freshAdmin();
    for (const [name, input] of WRITES) {
      for (const source of ["kiosk", "ai", "mcp", "brain"] as const) {
        await expect(
          runAction(name, input, ctxFor(actor, { source })),
        ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
      }
    }
    expect(await listServiceTokens(db())).toHaveLength(0);
  });
});
