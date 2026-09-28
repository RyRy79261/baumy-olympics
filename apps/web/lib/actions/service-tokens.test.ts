// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
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
import type { Actor, MemberActor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { ActionName } from "./define";
import { FRESH_SESSION_MS } from "./set-kiosk-pin";
import {
  DEFAULT_SERVICE_TOKEN_NAME,
  SERVICE_TOKEN_SCOPES,
} from "./service-tokens";

// /admin/connections (issue #104), through the real runAction on PGlite:
// create, rotate and revoke brain's service token. Admin only, UI only, a
// live session, and a fresh sign-in or the password to hand out a token.

const RIGHT_PASSWORD = "correct horse battery staple";
vi.mock("@/lib/auth/password-check", () => ({
  verifyCurrentPassword: async (pw: string) => pw === RIGHT_PASSWORD,
}));

const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const HOUR = 3_600_000;

beforeEach(() => {
  __resetMemoryRateLimits();
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

  it("needs the password when the sign-in is over 10 minutes old", async () => {
    const actor = await admin(FRESH_SESSION_MS);
    const run = (input: Record<string, unknown>) =>
      runAction("create_service_token", input, ctxFor(actor));
    await expect(run({})).resolves.toMatchObject({
      ok: false,
      code: "REAUTH_REQUIRED",
      message: expect.stringContaining("password"),
    });
    await expect(run({ currentPassword: "wrong" })).resolves.toMatchObject({
      ok: false,
      code: "REAUTH_REQUIRED",
      message: "That password is not right.",
    });
    expect(await listServiceTokens(db())).toHaveLength(0);

    const res = await run({ currentPassword: RIGHT_PASSWORD });
    await tokenData(res);
    expect(await listServiceTokens(db())).toHaveLength(1);
    // The password reaches neither the ledger nor the audit row.
    const rows = [
      ...(await t.db().select().from(actionRequests)),
      ...(await t.db().select().from(auditEvents)),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(RIGHT_PASSWORD);
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

  it("needs a fresh sign-in or the password, and a live session", async () => {
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
  it("revokes the live token once, with no password needed", async () => {
    const fresh = await freshAdmin();
    const token = await tokenData(
      await runAction("create_service_token", {}, ctxFor(fresh)),
    );
    const stale = await admin();
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
