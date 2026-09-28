// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  LOGIN_REQUEST_TTL_MS,
  insertLoginRequest,
  isLoginLocked,
} from "@baumy/db/login-requests";
import { auditEvents, loginRequests } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { McpActor, ServiceActor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { runAction } from "./registry";

// approve_login and deny_login through the real runAction on PGlite
// (issue #80): the member's own tap on brain's DM, and nothing else.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

beforeEach(() => __resetMemoryRateLimits());

const TG = 5_000_000_801;
const CODE = 47;
const DECOY = 12;

const brain = (memberId?: string): ServiceActor => ({
  kind: "service",
  tokenName: "baumy-brain",
  telegramUserId: TG,
  ...(memberId ? { memberId } : {}),
});

const brainCtx = (
  actor: ServiceActor | ReturnType<typeof sessionActor>,
  now = FIXED_NOW,
) => ctxFor(actor, { source: "brain", now });

async function requestFor(memberId: string | null, secret = "s".repeat(43)) {
  return insertLoginRequest(db(), {
    memberId,
    secret,
    code: CODE,
    choices: [DECOY, CODE, 83],
    device: "Chrome on macOS",
    now: FIXED_NOW,
  });
}

async function row() {
  const [r] = await t.db().select().from(loginRequests);
  return r!;
}

describe("approve_login", () => {
  it("approves with the number on the screen, audited on the member", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    const res = await runAction(
      "approve_login",
      { requestId: id, code: CODE },
      brainCtx(brain(ryan)),
    );
    expect(res).toEqual({
      ok: true,
      data: { outcome: "approved", device: "Chrome on macOS" },
    });
    expect(await row()).toMatchObject({
      status: "approved",
      decidedAt: FIXED_NOW,
    });
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      actorMemberId: ryan,
      source: "brain",
      action: "approve_login",
      entity: "login_request",
      entityId: id,
      payload: { requestId: id, outcome: "approved" },
    });
  });

  it("blocks the sign-in on a decoy, keeps the denial and locks the method", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    const res = await runAction(
      "approve_login",
      { requestId: id, code: DECOY },
      brainCtx(brain(ryan)),
    );
    // A success, so the transaction keeps the denial.
    expect(res).toEqual({
      ok: true,
      data: { outcome: "blocked", device: "Chrome on macOS" },
    });
    expect(await row()).toMatchObject({
      status: "denied",
      denyReason: "wrong_code",
    });
    expect(await isLoginLocked(db(), ryan, FIXED_NOW)).toBe(true);
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit?.payload).toEqual({ requestId: id, outcome: "wrong_code" });

    // The right number afterwards changes nothing.
    await expect(
      runAction(
        "approve_login",
        { requestId: id, code: CODE },
        brainCtx(brain(ryan)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await row()).status).toBe("denied");
  });

  it("refuses another member's request as if it were not there", async () => {
    const ryan = await seedMember(db());
    const sam = await seedMember(db());
    const { id } = await requestFor(ryan);
    await expect(
      runAction(
        "approve_login",
        { requestId: id, code: CODE },
        brainCtx(brain(sam)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    // Nor a request made for nobody (an address with no linked member).
    const nobody = await requestFor(null, "n".repeat(43));
    await expect(
      runAction(
        "approve_login",
        { requestId: nobody.id, code: CODE },
        brainCtx(brain(sam)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await row()).status).toBe("pending");
    expect(await t.db().select().from(auditEvents)).toEqual([]);
  });

  it("refuses an expired request, and a replayed approval", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    const late = new Date(FIXED_NOW.getTime() + LOGIN_REQUEST_TTL_MS);
    const expired = await runAction(
      "approve_login",
      { requestId: id, code: CODE },
      brainCtx(brain(ryan), late),
    );
    expect(expired).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(expired.ok || expired.message).toContain("expired");
    expect((await row()).status).toBe("pending");

    const first = await runAction(
      "approve_login",
      { requestId: id, code: CODE },
      brainCtx(brain(ryan)),
    );
    expect(first.ok).toBe(true);
    // A second tap with a new key: already answered.
    const again = await runAction(
      "approve_login",
      { requestId: id, code: CODE },
      brainCtx(brain(ryan)),
    );
    expect(again).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(again.ok || again.message).toContain("already answered");
    // The same key again: the stored answer, run once.
    const ctx = brainCtx(brain(ryan));
    const other = await requestFor(ryan, "o".repeat(43));
    const once = await runAction(
      "approve_login",
      { requestId: other.id, code: CODE },
      ctx,
    );
    const replay = await runAction(
      "approve_login",
      { requestId: other.id, code: CODE },
      ctx,
    );
    expect(replay).toEqual(once);
    expect(await t.db().select().from(auditEvents)).toHaveLength(2);
  });

  it("is brain's only, and refuses an unlinked Telegram user", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    const input = { requestId: id, code: CODE };
    for (const [actor, source] of [
      [sessionActor(ryan), "ui"],
      [kioskActor(ryan), "kiosk"],
      [
        { kind: "mcp", memberId: ryan, scopes: ["baumy:write"] } as McpActor,
        "mcp",
      ],
    ] as const) {
      await expect(
        runAction("approve_login", input, ctxFor(actor, { source })),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    await expect(
      runAction("approve_login", input, brainCtx(brain())),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // A member actor on the brain surface (never built by the endpoint)
    // still cannot answer: only the member's own Telegram.
    await expect(
      runAction("approve_login", input, brainCtx(sessionActor(ryan))),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await row()).status).toBe("pending");
  });

  it("refuses a number that is not two digits", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    await expect(
      runAction(
        "approve_login",
        { requestId: id, code: 7 },
        brainCtx(brain(ryan)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("is rate limited per member", async () => {
    const ryan = await seedMember(db());
    let last;
    for (let i = 0; i < 11; i++) {
      last = await runAction(
        "approve_login",
        { requestId: "0b0e6c1a-3a7e-4c38-9a53-6f1f3f0d2a11", code: CODE },
        brainCtx(brain(ryan)),
      );
    }
    expect(last).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("deny_login", () => {
  it("denies a pending request, audited, and locks the method", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    const res = await runAction(
      "deny_login",
      { requestId: id },
      brainCtx(brain(ryan)),
    );
    expect(res).toEqual({
      ok: true,
      data: { outcome: "denied", device: "Chrome on macOS" },
    });
    expect(await row()).toMatchObject({
      status: "denied",
      denyReason: "denied",
    });
    expect(await isLoginLocked(db(), ryan, FIXED_NOW)).toBe(true);
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      action: "deny_login",
      entityId: id,
      payload: { requestId: id, outcome: "denied" },
    });
    // Approving after the denial changes nothing.
    await expect(
      runAction(
        "approve_login",
        { requestId: id, code: CODE },
        brainCtx(brain(ryan)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("refuses another member's, an expired and an answered request", async () => {
    const ryan = await seedMember(db());
    const sam = await seedMember(db());
    const { id } = await requestFor(ryan);
    await expect(
      runAction("deny_login", { requestId: id }, brainCtx(brain(sam))),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    const late = new Date(FIXED_NOW.getTime() + LOGIN_REQUEST_TTL_MS);
    await expect(
      runAction("deny_login", { requestId: id }, brainCtx(brain(ryan), late)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
    await runAction("deny_login", { requestId: id }, brainCtx(brain(ryan)));
    await expect(
      runAction("deny_login", { requestId: id }, brainCtx(brain(ryan))),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("is brain's only", async () => {
    const ryan = await seedMember(db());
    const { id } = await requestFor(ryan);
    await expect(
      runAction(
        "deny_login",
        { requestId: id },
        ctxFor(sessionActor(ryan), { source: "ui" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
  });
});
