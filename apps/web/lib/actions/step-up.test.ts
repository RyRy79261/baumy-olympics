// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  LOGIN_REQUEST_TTL_MS,
  decideLoginRequest,
  insertStepUpRequest,
} from "@baumy/db/login-requests";
import {
  account,
  actionRequests,
  auditEvents,
  loginRequests,
  passkey,
  session,
  stepUps,
  twoFactor,
  user,
} from "@baumy/db/schema";
import { STEP_UP_WINDOW_MS, grantStepUp } from "@baumy/db/step-ups";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor, MemberActor, ServiceActor } from "@/lib/auth";
import {
  FRESH_SESSION_MS,
  recentAuthUntil,
  requireRecentAuth,
} from "@/lib/auth/recent-auth";
import {
  setBrainClientForTests,
  type BrainClient,
  type LoginApprovalMessage,
} from "@/lib/integrations/brain";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { ActionName } from "./define";
import { inputHash } from "./input-hash";

// "Confirm it's you" (issue #135), through the real runAction on PGlite:
// the sudo window (requireRecentAuth), what the dialog offers (get_step_up),
// each proof (confirm_identity) and the Telegram approval for a session
// already signed in (request_baumy_confirmation, get_baumy_confirmation).
// Better Auth's checks are stubbed here; packages/auth tests the passkey one
// against real Better Auth, and the e2e spec runs them all in a browser.

const verify = vi.hoisted(() => ({
  password: vi.fn(async (_: string) => false),
  totp: vi.fn(async (_: string) => false),
  passkey: vi.fn(async (_: Record<string, unknown>) => false),
}));
vi.mock("@/lib/auth/step-up-verify", () => ({
  verifyPasswordStepUp: (p: string) => verify.password(p),
  verifyTotpStepUp: (c: string) => verify.totp(c),
  verifyPasskeyStepUp: (r: Record<string, unknown>) => verify.passkey(r),
}));

const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const MIN = 60_000;
const at = (ms: number) => new Date(FIXED_NOW.getTime() + ms);
const TG = 5_000_000_135;

const dms: LoginApprovalMessage[] = [];
let brainUp = true;
const fakeBrain: BrainClient = {
  listShopping: async () => ({ ok: true, data: [] }),
  addShopping: async () => {
    throw new Error("not here");
  },
  checkOffShopping: async () => {
    throw new Error("not here");
  },
  requestLoginApproval: async (message) => {
    if (!brainUp) return { ok: false, reason: "unavailable", status: 503 };
    dms.push(message);
    return { ok: true, data: { sent: true } };
  },
};

beforeEach(() => {
  __resetMemoryRateLimits();
  for (const fn of Object.values(verify)) {
    fn.mockReset();
    fn.mockResolvedValue(false);
  }
  dms.length = 0;
  brainUp = true;
  setBrainClientForTests(fakeBrain);
  vi.stubEnv("SIGN_IN_WITH_BAUMY", "on");
  vi.stubEnv("GOOGLE_CLIENT_ID", "");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
});

afterEach(() => {
  setBrainClientForTests(null);
  vi.unstubAllEnvs();
});

let seq = 0;

/**
 * A member with an account and a session row, signed in `ageMs` before
 * FIXED_NOW (an hour by default: not fresh).
 */
async function member(
  opts: { ageMs?: number; telegram?: boolean } = {},
): Promise<MemberActor> {
  seq += 1;
  const userId = `stepper-${seq}`;
  const sessionId = `stepper-sess-${seq}`;
  const signedIn = new Date(FIXED_NOW.getTime() - (opts.ageMs ?? 60 * MIN));
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
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      createdAt: signedIn,
      expiresAt: at(24 * 60 * MIN),
    });
  const memberId = await seedMember(db(), {
    authUserId: userId,
    telegramUserId: opts.telegram === false ? null : TG + seq,
  });
  return sessionActor(memberId, "member", {
    userId,
    sessionId,
    sessionCreatedAt: signedIn.toISOString(),
  });
}

/** A second session of the same account. */
async function otherSessionOf(me: MemberActor): Promise<MemberActor> {
  seq += 1;
  const sessionId = `stepper-other-${seq}`;
  await t
    .db()
    .insert(session)
    .values({
      id: sessionId,
      token: `tok-${sessionId}`,
      userId: me.userId,
      createdAt: at(-60 * MIN),
      expiresAt: at(24 * 60 * MIN),
    });
  return { ...me, sessionId };
}

const run = <N extends ActionName>(
  name: N,
  input: unknown,
  actor: Actor,
  now = FIXED_NOW,
) => runAction(name, input as never, ctxFor(actor, { now }));

async function withPassword(userId: string) {
  await t
    .db()
    .insert(account)
    .values({
      id: `${userId}-credential`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: "salt:hash",
    });
}

async function withTotp(userId: string, verified = true) {
  await t
    .db()
    .update(user)
    .set({ twoFactorEnabled: verified })
    .where(eq(user.id, userId));
  await t
    .db()
    .insert(twoFactor)
    .values({
      id: `${userId}-2fa`,
      userId,
      secret: "encrypted",
      backupCodes: "encrypted",
      verified,
    });
}

async function withPasskey(userId: string) {
  await t
    .db()
    .insert(passkey)
    .values({
      id: `${userId}-pk`,
      userId,
      publicKey: "pk",
      credentialID: `${userId}-cred`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });
}

/** The ctx `requireRecentAuth` reads, for an actor at `now`. */
const gateCtx = (actor: Actor, now = FIXED_NOW) => ({
  ...ctxFor(actor, { now }),
  db: db(),
});

describe("requireRecentAuth", () => {
  it("counts a sign-in under 10 minutes old, then no longer", async () => {
    const me = await member({ ageMs: 4 * MIN });
    await expect(recentAuthUntil(gateCtx(me))).resolves.toEqual(
      at(FRESH_SESSION_MS - 4 * MIN),
    );
    await expect(requireRecentAuth(gateCtx(me))).resolves.toEqual({
      ok: true,
    });
    await expect(
      requireRecentAuth(gateCtx(me, at(FRESH_SESSION_MS - 4 * MIN))),
    ).resolves.toMatchObject({ ok: false, code: "REAUTH_REQUIRED" });
  });

  it("does not count a sign-in dated in the future", async () => {
    const me = await member({ ageMs: -5 * MIN });
    await expect(recentAuthUntil(gateCtx(me))).resolves.toBeNull();
  });

  it("counts this session's window until it closes, never another session's", async () => {
    const me = await member();
    const other = await otherSessionOf(me);
    await expect(requireRecentAuth(gateCtx(me))).resolves.toMatchObject({
      ok: false,
      code: "REAUTH_REQUIRED",
      message: expect.stringContaining("Confirm it's you"),
    });
    await grantStepUp(db(), {
      sessionId: me.sessionId!,
      userId: me.userId,
      method: "passkey",
      now: FIXED_NOW,
    });
    await expect(recentAuthUntil(gateCtx(me))).resolves.toEqual(
      at(STEP_UP_WINDOW_MS),
    );
    await expect(recentAuthUntil(gateCtx(other))).resolves.toBeNull();
    // Server time moves on: the window closes.
    await expect(
      recentAuthUntil(gateCtx(me, at(STEP_UP_WINDOW_MS))),
    ).resolves.toBeNull();
  });

  it("takes the later of a fresh sign-in and a window", async () => {
    const me = await member({ ageMs: 9 * MIN });
    await grantStepUp(db(), {
      sessionId: me.sessionId!,
      userId: me.userId,
      method: "totp",
      now: FIXED_NOW,
    });
    await expect(recentAuthUntil(gateCtx(me))).resolves.toEqual(
      at(STEP_UP_WINDOW_MS),
    );
    const fresher = await member({ ageMs: 1 * MIN });
    await grantStepUp(db(), {
      sessionId: fresher.sessionId!,
      userId: fresher.userId,
      method: "totp",
      now: at(-5 * MIN),
    });
    await expect(recentAuthUntil(gateCtx(fresher))).resolves.toEqual(
      at(FRESH_SESSION_MS - 1 * MIN),
    );
  });

  it("never lets anyone but a member's own session through", async () => {
    const me = await member({ ageMs: 1 * MIN });
    const others: Actor[] = [
      kioskActor(me.memberId),
      { kind: "mcp", memberId: me.memberId!, scopes: ["baumy:write"] },
      { kind: "service", tokenName: "baumy-brain", memberId: me.memberId },
    ];
    for (const actor of others) {
      await expect(recentAuthUntil(gateCtx(actor))).resolves.toBeNull();
    }
    // A member session without an id is judged by its sign-in time alone.
    const { sessionId: _, ...noId } = me;
    await expect(recentAuthUntil(gateCtx(noId))).resolves.not.toBeNull();
  });
});

describe("get_step_up", () => {
  it("offers only the methods the member has, in the dialog's order", async () => {
    const bare = await member({ telegram: false });
    await expect(run("get_step_up", {}, bare)).resolves.toEqual({
      ok: true,
      data: { until: null, methods: [] },
    });

    const all = await member();
    await withPasskey(all.userId);
    await withTotp(all.userId);
    await withPassword(all.userId);
    await t
      .db()
      .insert(account)
      .values({
        id: `${all.userId}-google`,
        accountId: "g",
        providerId: "google",
        userId: all.userId,
      });
    // Google is offered only where Google sign-in is configured.
    await expect(run("get_step_up", {}, all)).resolves.toEqual({
      ok: true,
      data: { until: null, methods: ["passkey", "totp", "baumy", "password"] },
    });
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    await expect(run("get_step_up", {}, all)).resolves.toMatchObject({
      data: {
        methods: ["passkey", "totp", "baumy", "password", "google"],
      },
    });
  });

  it("leaves out an unfinished two-factor, and Baumy when off or locked", async () => {
    const me = await member();
    await withTotp(me.userId, false);
    await withPassword(me.userId);
    await expect(run("get_step_up", {}, me)).resolves.toMatchObject({
      data: { methods: ["baumy", "password"] },
    });
    vi.stubEnv("SIGN_IN_WITH_BAUMY", "off");
    await expect(run("get_step_up", {}, me)).resolves.toMatchObject({
      data: { methods: ["password"] },
    });
    vi.stubEnv("SIGN_IN_WITH_BAUMY", "on");
    // A Deny in the last 15 minutes turns Baumy off (push fatigue).
    const { id } = await insertStepUpRequest(db(), {
      memberId: me.memberId!,
      sessionId: me.sessionId!,
      code: 47,
      choices: [12, 47],
      device: "d",
      now: at(-MIN),
    });
    await decideLoginRequest(db(), id, {
      status: "denied",
      reason: "denied",
      now: at(-MIN),
    });
    await expect(run("get_step_up", {}, me)).resolves.toMatchObject({
      data: { methods: ["password"] },
    });
  });

  it("says until when the window is open", async () => {
    const me = await member();
    await grantStepUp(db(), {
      sessionId: me.sessionId!,
      userId: me.userId,
      method: "password",
      now: FIXED_NOW,
    });
    await expect(run("get_step_up", {}, me)).resolves.toMatchObject({
      data: { until: at(STEP_UP_WINDOW_MS).toISOString() },
    });
  });
});

/** The window `confirm_identity` opened for `me`, as the gate sees it. */
const windowOf = (me: MemberActor, now = FIXED_NOW) =>
  recentAuthUntil(gateCtx(me, now));

describe("confirm_identity", () => {
  const PROOFS = {
    password: { method: "password", password: "correct horse battery" },
    totp: { method: "totp", code: "123456" },
    passkey: {
      method: "passkey",
      response: { id: "cred", type: "public-key" },
    },
  } as const;

  for (const method of ["password", "totp", "passkey"] as const) {
    it(`${method}: opens a 10-minute window for this session only`, async () => {
      const me = await member();
      const other = await otherSessionOf(me);
      if (method === "totp") await withTotp(me.userId);
      verify[method].mockResolvedValue(true);
      const res = await run("confirm_identity", PROOFS[method], me);
      expect(res).toEqual({
        ok: true,
        data: { method, until: at(STEP_UP_WINDOW_MS).toISOString() },
      });
      expect(verify[method]).toHaveBeenCalledTimes(1);
      await expect(windowOf(me)).resolves.toEqual(at(STEP_UP_WINDOW_MS));
      await expect(windowOf(other)).resolves.toBeNull();
      await expect(windowOf(me, at(STEP_UP_WINDOW_MS))).resolves.toBeNull();

      // The step-up itself is audited, and no proof reaches the ledger.
      const audits = await t.db().select().from(auditEvents);
      expect(audits).toEqual([
        expect.objectContaining({
          action: "confirm_identity",
          actorMemberId: me.memberId,
          entity: "session",
          entityId: me.sessionId,
          payload: { method, until: at(STEP_UP_WINDOW_MS).toISOString() },
        }),
      ]);
      const everything = JSON.stringify([
        audits,
        await t.db().select().from(actionRequests),
      ]);
      expect(everything).toContain(method);
      expect(everything).not.toContain("correct horse");
      expect(everything).not.toContain("123456");
      expect(everything).not.toContain("public-key");
      // The ledger's hash sees the method only: an unsalted hash of a
      // 6-digit code would give the code away.
      const [ledger] = await t.db().select().from(actionRequests);
      expect(ledger!.inputHash).toBe(inputHash("confirm_identity", { method }));
    });

    it(`${method}: a refused proof opens nothing`, async () => {
      const me = await member();
      if (method === "totp") await withTotp(me.userId);
      await expect(
        run("confirm_identity", PROOFS[method], me),
      ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
      expect(verify[method]).toHaveBeenCalledTimes(1);
      await expect(windowOf(me)).resolves.toBeNull();
      expect(await t.db().select().from(stepUps)).toEqual([]);
      expect(await t.db().select().from(auditEvents)).toEqual([]);
    });
  }

  it("passes the proof itself to Better Auth's check", async () => {
    const me = await member();
    await withTotp(me.userId);
    for (const fn of Object.values(verify)) fn.mockResolvedValue(true);
    await run("confirm_identity", PROOFS.password, me);
    await run("confirm_identity", PROOFS.totp, me);
    await run("confirm_identity", PROOFS.passkey, me);
    expect(verify.password).toHaveBeenCalledWith("correct horse battery");
    expect(verify.totp).toHaveBeenCalledWith("123456");
    expect(verify.passkey).toHaveBeenCalledWith(PROOFS.passkey.response);
  });

  it("never asks Better Auth about a code without finished two-factor", async () => {
    // verify-totp with a session would FINISH an enrolment, turning it on.
    const me = await member();
    verify.totp.mockResolvedValue(true);
    await expect(
      run("confirm_identity", PROOFS.totp, me),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
    await withTotp(me.userId, false);
    await expect(
      run("confirm_identity", PROOFS.totp, me),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
    expect(verify.totp).not.toHaveBeenCalled();
    await expect(windowOf(me)).resolves.toBeNull();
  });

  it("refuses a malformed proof", async () => {
    const me = await member();
    for (const input of [
      { method: "totp", code: "12345" },
      { method: "password", password: "" },
      { method: "sms", code: "123456" },
      { method: "baumy", approvalId: "not-a-uuid" },
    ]) {
      await expect(run("confirm_identity", input, me)).resolves.toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
  });

  it("refuses a device signed out elsewhere, after the proof", async () => {
    const me = await member();
    verify.password.mockResolvedValue(true);
    await t.db().delete(session).where(eq(session.id, me.sessionId!));
    await expect(
      run("confirm_identity", PROOFS.password, me),
    ).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await t.db().select().from(stepUps)).toEqual([]);
  });

  it("slows guessing: the 11th try in 15 minutes is refused unchecked", async () => {
    const me = await member();
    for (let i = 0; i < 10; i += 1) {
      await expect(
        run("confirm_identity", PROOFS.password, me),
      ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
    }
    verify.password.mockClear();
    verify.password.mockResolvedValue(true);
    await expect(
      run("confirm_identity", PROOFS.password, me),
    ).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(verify.password).not.toHaveBeenCalled();
    await expect(windowOf(me)).resolves.toBeNull();
  });

  it("is only for a member's own session, on the UI", async () => {
    const me = await member();
    for (const fn of Object.values(verify)) fn.mockResolvedValue(true);
    const others: Actor[] = [
      kioskActor(me.memberId),
      { kind: "mcp", memberId: me.memberId!, scopes: ["baumy:write"] },
      { kind: "service", tokenName: "baumy-brain", memberId: me.memberId },
    ];
    for (const name of [
      "get_step_up",
      "confirm_identity",
      "request_baumy_confirmation",
      "get_baumy_confirmation",
    ] as const) {
      const input =
        name === "confirm_identity"
          ? PROOFS.password
          : name === "get_baumy_confirmation"
            ? { approvalId: "00000000-0000-4000-8000-000000000000" }
            : {};
      for (const actor of others) {
        const res = await run(name, input, actor);
        expect(res.ok, `${name} as ${actor.kind}`).toBe(false);
      }
      for (const source of ["kiosk", "ai", "mcp", "brain"] as const) {
        await expect(
          runAction(name, input as never, ctxFor(me, { source })),
        ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
      }
    }
    expect(verify.password).not.toHaveBeenCalled();
    expect(await t.db().select().from(stepUps)).toEqual([]);
  });
});

const brainActor = (me: MemberActor): ServiceActor => ({
  kind: "service",
  tokenName: "baumy-brain",
  telegramUserId: TG,
  memberId: me.memberId,
});

describe("Confirm it's you from Telegram", () => {
  it("DMs the number, the tap approves this session, and it is used once", async () => {
    const me = await member();
    const res = await run("request_baumy_confirmation", {}, me);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { approvalId, code, expiresAt } = res.data;
    expect(expiresAt).toBe(at(LOGIN_REQUEST_TTL_MS).toISOString());
    // Brain is told it is a step-up, from which device, with the number.
    expect(dms).toEqual([
      expect.objectContaining({
        requestId: approvalId,
        purpose: "step_up",
        device: "Chrome on macOS",
      }),
    ]);
    expect(dms[0]!.choices).toContain(code);
    const [stored] = await t.db().select().from(loginRequests);
    expect(stored).toMatchObject({
      purpose: "step_up",
      sessionId: me.sessionId,
      memberId: me.memberId,
    });
    expect(
      (await t.db().select().from(auditEvents)).map((a) => a.action),
    ).toEqual(["request_baumy_confirmation"]);

    const status = () =>
      run("get_baumy_confirmation", { approvalId }, me).then((r) =>
        r.ok ? r.data.status : r.code,
      );
    await expect(status()).resolves.toBe("pending");
    // Not approved yet: nothing to confirm with.
    await expect(
      run("confirm_identity", { method: "baumy", approvalId }, me),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });

    // The member taps the number in Telegram (brain's button).
    const tap = await runAction(
      "approve_login",
      { requestId: approvalId, code },
      ctxFor(brainActor(me), { source: "brain" }),
    );
    expect(tap).toMatchObject({
      ok: true,
      data: { outcome: "approved", purpose: "step_up" },
    });
    await expect(status()).resolves.toBe("approved");

    // Another session of the same account cannot use it.
    const other = await otherSessionOf(me);
    await expect(
      run("get_baumy_confirmation", { approvalId }, other),
    ).resolves.toMatchObject({ data: { status: "expired" } });
    await expect(
      run("confirm_identity", { method: "baumy", approvalId }, other),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });

    await expect(
      run("confirm_identity", { method: "baumy", approvalId }, me),
    ).resolves.toEqual({
      ok: true,
      data: { method: "baumy", until: at(STEP_UP_WINDOW_MS).toISOString() },
    });
    await expect(windowOf(me)).resolves.toEqual(at(STEP_UP_WINDOW_MS));
    await expect(windowOf(other)).resolves.toBeNull();
    await expect(status()).resolves.toBe("used");
    // Once: a second confirmation with it is refused.
    await expect(
      run("confirm_identity", { method: "baumy", approvalId }, me),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
    // No session was made by any of it.
    expect(
      await t.db().select().from(session).where(eq(session.userId, me.userId)),
    ).toHaveLength(2);
  });

  it("a decoy tap denies it, and Baumy is then off for 15 minutes", async () => {
    const me = await member();
    const res = await run("request_baumy_confirmation", {}, me);
    if (!res.ok) throw new Error(res.message);
    const decoy = dms[0]!.choices.find((c) => c !== res.data.code)!;
    await runAction(
      "approve_login",
      { requestId: res.data.approvalId, code: decoy },
      ctxFor(brainActor(me), { source: "brain" }),
    );
    await expect(
      run("get_baumy_confirmation", { approvalId: res.data.approvalId }, me),
    ).resolves.toMatchObject({ data: { status: "denied" } });
    await expect(
      run(
        "confirm_identity",
        { method: "baumy", approvalId: res.data.approvalId },
        me,
      ),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
    await expect(
      run("request_baumy_confirmation", {}, me),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      run("request_baumy_confirmation", {}, me, at(16 * MIN)),
    ).resolves.toMatchObject({ ok: true });
  });

  it("an approval that went stale is refused", async () => {
    const me = await member();
    const res = await run("request_baumy_confirmation", {}, me);
    if (!res.ok) throw new Error(res.message);
    await decideLoginRequest(db(), res.data.approvalId, {
      status: "approved",
      now: FIXED_NOW,
    });
    await expect(
      run(
        "confirm_identity",
        { method: "baumy", approvalId: res.data.approvalId },
        me,
        at(LOGIN_REQUEST_TTL_MS + 60_000),
      ),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_FAILED" });
  });

  it("is refused when off, when not linked, or when brain is down", async () => {
    const me = await member();
    vi.stubEnv("SIGN_IN_WITH_BAUMY", "off");
    await expect(
      run("request_baumy_confirmation", {}, me),
    ).resolves.toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    vi.stubEnv("SIGN_IN_WITH_BAUMY", "on");

    const unlinked = await member({ telegram: false });
    await expect(
      run("request_baumy_confirmation", {}, unlinked),
    ).resolves.toMatchObject({ ok: false, code: "TELEGRAM_NOT_LINKED" });

    brainUp = false;
    await expect(
      run("request_baumy_confirmation", {}, me),
    ).resolves.toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(dms).toEqual([]);
    expect(await t.db().select().from(auditEvents)).toEqual([]);
  });

  it("is refused for a session signed out, with no DM", async () => {
    const me = await member();
    await t.db().delete(session).where(eq(session.id, me.sessionId!));
    await expect(
      run("request_baumy_confirmation", {}, me),
    ).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(dms).toEqual([]);
  });
});
