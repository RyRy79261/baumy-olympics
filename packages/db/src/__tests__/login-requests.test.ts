import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  LOGIN_EXCHANGE_GRACE_MS,
  LOGIN_REQUEST_RETENTION_MS,
  LOGIN_REQUEST_TTL_MS,
  LOGIN_DENIAL_LOCK_MS,
  claimApprovedLoginRequest,
  claimApprovedStepUpRequest,
  decideLoginRequest,
  findLoginCandidate,
  findLoginRequestBySecret,
  findStepUpRequest,
  hashLoginSecret,
  insertLoginRequest,
  insertStepUpRequest,
  isLoginLocked,
  lockLoginRequest,
  loginRequestState,
  pruneLoginRequests,
} from "../login-requests";
import { loginRequests, members, session, user } from "../schema";
import { useTestDb } from "./_harness";

// "Sign in with Baumy" (issue #80): every step is one statement whose WHERE is
// the whole test, so replays and races find nothing.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-28T10:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const SECRET = "browser-secret-0123456789abcdefghijklmnop";

async function member(
  opts: {
    email?: string;
    telegramUserId?: number | null;
    deactivated?: boolean;
    account?: boolean;
  } = {},
) {
  const email = opts.email ?? `m-${Math.random().toString(36).slice(2)}@x.io`;
  let authUserId: string | null = null;
  if (opts.account !== false) {
    authUserId = `user-${Math.random().toString(36).slice(2)}`;
    await t.db().insert(user).values({ id: authUserId, name: "M", email });
  }
  const [m] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#112233",
      telegramUserId:
        opts.telegramUserId === undefined
          ? 5_000_000_000 + Math.floor(Math.random() * 1e6)
          : opts.telegramUserId,
      deactivatedAt: opts.deactivated ? NOW : null,
    })
    .returning({ id: members.id });
  return { id: m!.id, email, authUserId };
}

async function request(memberId: string | null, secret = SECRET) {
  return insertLoginRequest(db(), {
    memberId,
    secret,
    code: 47,
    choices: [12, 47, 83],
    device: "Chrome on macOS",
    now: NOW,
  });
}

describe("hashLoginSecret", () => {
  it("is a sha256 hex of the secret", () => {
    expect(hashLoginSecret("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLoginSecret("a")).not.toBe(hashLoginSecret("b"));
  });
});

describe("loginRequestState", () => {
  const expiresAt = at(LOGIN_REQUEST_TTL_MS);
  it("derives expired from the time, with a grace for an approved one", () => {
    expect(loginRequestState({ status: "pending", expiresAt }, NOW)).toBe(
      "pending",
    );
    expect(loginRequestState({ status: "pending", expiresAt }, expiresAt)).toBe(
      "expired",
    );
    expect(
      loginRequestState(
        { status: "approved", expiresAt },
        at(LOGIN_REQUEST_TTL_MS + LOGIN_EXCHANGE_GRACE_MS - 1),
      ),
    ).toBe("approved");
    expect(
      loginRequestState(
        { status: "approved", expiresAt },
        at(LOGIN_REQUEST_TTL_MS + LOGIN_EXCHANGE_GRACE_MS),
      ),
    ).toBe("expired");
    expect(loginRequestState({ status: "denied", expiresAt }, NOW)).toBe(
      "denied",
    );
    expect(loginRequestState({ status: "used", expiresAt }, at(1e9))).toBe(
      "used",
    );
  });
});

describe("findLoginCandidate", () => {
  it("finds an active, linked member by address, whatever the case", async () => {
    const m = await member({ email: "ryan@example.com", telegramUserId: 42 });
    expect(
      await findLoginCandidate(db(), HOUSEHOLD_ID, "  RYAN@Example.com "),
    ).toEqual({ memberId: m.id, authUserId: m.authUserId, telegramUserId: 42 });
  });

  it("finds a member with two-factor on too: the tap is the second factor", async () => {
    // Owner ruling 2026-09-29 (issue #95, ADR 0006).
    const m = await member({ email: "tfa@example.com", telegramUserId: 77 });
    const found = {
      memberId: m.id,
      authUserId: m.authUserId,
      telegramUserId: 77,
    };
    expect(
      await findLoginCandidate(db(), HOUSEHOLD_ID, "tfa@example.com"),
    ).toEqual(found);
    // Better Auth's two-factor plugin (issue #79) turns the flag on.
    const [on] = await t
      .db()
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.id, m.authUserId!))
      .returning({ on: user.twoFactorEnabled });
    expect(on?.on).toBe(true);
    expect(
      await findLoginCandidate(db(), HOUSEHOLD_ID, "tfa@example.com"),
    ).toEqual(found);
  });

  it("finds nobody unlinked, deactivated, unknown or without a member", async () => {
    await member({ email: "unlinked@example.com", telegramUserId: null });
    await member({ email: "gone@example.com", deactivated: true });
    await t
      .db()
      .insert(user)
      .values({ id: "lonely", name: "L", email: "lonely@example.com" });
    for (const email of [
      "unlinked@example.com",
      "gone@example.com",
      "lonely@example.com",
      "nobody@example.com",
    ]) {
      expect(await findLoginCandidate(db(), HOUSEHOLD_ID, email)).toBeNull();
    }
  });
});

describe("insertLoginRequest and findLoginRequestBySecret", () => {
  it("stores the hash only, pending for two minutes", async () => {
    const m = await member();
    const { id, expiresAt } = await request(m.id);
    expect(expiresAt).toEqual(at(LOGIN_REQUEST_TTL_MS));
    const rows = await t.db().select().from(loginRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      memberId: m.id,
      secretHash: hashLoginSecret(SECRET),
      code: 47,
      choices: [12, 47, 83],
      status: "pending",
    });
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(await findLoginRequestBySecret(db(), SECRET, NOW)).toEqual({
      id,
      state: "pending",
    });
    expect(
      await findLoginRequestBySecret(db(), SECRET, at(LOGIN_REQUEST_TTL_MS)),
    ).toEqual({ id, state: "expired" });
    expect(await findLoginRequestBySecret(db(), "other", NOW)).toBeNull();
  });

  it("stores a request for nobody too", async () => {
    const { id } = await request(null);
    expect(await findLoginRequestBySecret(db(), SECRET, NOW)).toEqual({
      id,
      state: "pending",
    });
  });
});

describe("lockLoginRequest and decideLoginRequest", () => {
  it("finds a request only for its own member", async () => {
    const m = await member();
    const other = await member();
    const { id } = await request(m.id);
    expect(await lockLoginRequest(db(), id, m.id, NOW)).toEqual({
      id,
      code: 47,
      device: "Chrome on macOS",
      state: "pending",
      purpose: "sign_in",
    });
    expect(await lockLoginRequest(db(), id, other.id, NOW)).toBeNull();
  });

  it("decides once, and never after it expired", async () => {
    const m = await member();
    const { id } = await request(m.id);
    expect(
      await decideLoginRequest(db(), id, {
        status: "approved",
        now: at(LOGIN_REQUEST_TTL_MS),
      }),
    ).toBe(false);
    expect(
      await decideLoginRequest(db(), id, { status: "approved", now: NOW }),
    ).toBe(true);
    expect(
      await decideLoginRequest(db(), id, {
        status: "denied",
        reason: "denied",
        now: NOW,
      }),
    ).toBe(false);
    const [row] = await t.db().select().from(loginRequests);
    expect(row).toMatchObject({
      status: "approved",
      denyReason: null,
      decidedAt: NOW,
    });
  });
});

describe("isLoginLocked", () => {
  it("locks for 15 minutes after a Deny or a wrong number, not after an approval", async () => {
    const m = await member();
    const { id } = await request(m.id);
    await decideLoginRequest(db(), id, { status: "approved", now: NOW });
    expect(await isLoginLocked(db(), m.id, at(1000))).toBe(false);

    for (const reason of ["denied", "wrong_code"] as const) {
      const other = await member();
      const r = await request(
        other.id,
        `${reason}-secret-0123456789abcdefghij`,
      );
      await decideLoginRequest(db(), r.id, {
        status: "denied",
        reason,
        now: NOW,
      });
      expect(await isLoginLocked(db(), other.id, at(1000))).toBe(true);
      expect(
        await isLoginLocked(db(), other.id, at(LOGIN_DENIAL_LOCK_MS)),
      ).toBe(false);
    }
    const stranger = await member();
    expect(await isLoginLocked(db(), stranger.id, at(1000))).toBe(false);
  });
});

describe("claimApprovedLoginRequest", () => {
  it("trades an approved request once", async () => {
    const m = await member();
    const { id } = await request(m.id);
    // Not approved yet.
    expect(await claimApprovedLoginRequest(db(), SECRET, NOW)).toBeNull();
    await decideLoginRequest(db(), id, { status: "approved", now: NOW });
    expect(await claimApprovedLoginRequest(db(), "wrong", NOW)).toBeNull();
    expect(await claimApprovedLoginRequest(db(), SECRET, at(1000))).toEqual({
      requestId: id,
      memberId: m.id,
      authUserId: m.authUserId,
    });
    // A replay finds it used.
    expect(await claimApprovedLoginRequest(db(), SECRET, at(2000))).toBeNull();
    const [row] = await t.db().select().from(loginRequests);
    expect(row).toMatchObject({ status: "used", usedAt: at(1000) });
  });

  it("refuses after the grace, and for a denied request", async () => {
    const m = await member();
    const late = await request(m.id);
    await decideLoginRequest(db(), late.id, { status: "approved", now: NOW });
    expect(
      await claimApprovedLoginRequest(
        db(),
        SECRET,
        at(LOGIN_REQUEST_TTL_MS + LOGIN_EXCHANGE_GRACE_MS),
      ),
    ).toBeNull();

    const secret = "denied-secret-0123456789abcdefghijk";
    const denied = await request(m.id, secret);
    await decideLoginRequest(db(), denied.id, {
      status: "denied",
      reason: "denied",
      now: NOW,
    });
    expect(await claimApprovedLoginRequest(db(), secret, NOW)).toBeNull();
  });

  it("gives no session to a member deactivated meanwhile", async () => {
    const m = await member();
    const { id } = await request(m.id);
    await decideLoginRequest(db(), id, { status: "approved", now: NOW });
    await t.db().update(members).set({ deactivatedAt: NOW });
    expect(await claimApprovedLoginRequest(db(), SECRET, NOW)).toBeNull();
  });
});

/** A Better Auth session row for the member's account. */
async function sessionOf(authUserId: string | null, id = `s-${Math.random()}`) {
  await t
    .db()
    .insert(session)
    .values({
      id,
      token: `tok-${id}`,
      userId: authUserId!,
      expiresAt: at(24 * 3_600_000),
    });
  return id;
}

async function stepUp(memberId: string, sessionId: string) {
  return insertStepUpRequest(db(), {
    memberId,
    sessionId,
    code: 47,
    choices: [12, 47, 83],
    device: "Chrome on macOS",
    now: NOW,
  });
}

describe("step-up requests (issue #135)", () => {
  it("is found, decided and used only by the session that asked", async () => {
    const m = await member();
    const mine = await sessionOf(m.authUserId);
    const other = await sessionOf(m.authUserId);
    const { id, expiresAt } = await stepUp(m.id, mine);
    expect(expiresAt).toEqual(at(LOGIN_REQUEST_TTL_MS));
    expect(
      await findStepUpRequest(db(), { id, sessionId: mine, now: NOW }),
    ).toBe("pending");
    expect(
      await findStepUpRequest(db(), { id, sessionId: other, now: NOW }),
    ).toBeNull();
    // Brain's tap finds it like a sign-in, and says what it is for.
    expect(await lockLoginRequest(db(), id, m.id, NOW)).toMatchObject({
      purpose: "step_up",
      state: "pending",
    });

    const claim = (sessionId: string, now = at(1000)) =>
      claimApprovedStepUpRequest(db(), {
        id,
        sessionId,
        memberId: m.id,
        now,
      });
    // Not approved yet.
    expect(await claim(mine)).toBe(false);
    await decideLoginRequest(db(), id, { status: "approved", now: NOW });
    expect(
      await findStepUpRequest(db(), { id, sessionId: mine, now: NOW }),
    ).toBe("approved");
    // Another session of the same account cannot use it.
    expect(await claim(other)).toBe(false);
    expect(await claim(mine)).toBe(true);
    // Once.
    expect(await claim(mine, at(2000))).toBe(false);
    expect(
      await findStepUpRequest(db(), { id, sessionId: mine, now: NOW }),
    ).toBe("used");
  });

  it("is refused after the grace, and for another member", async () => {
    const m = await member();
    const someoneElse = await member();
    const mine = await sessionOf(m.authUserId);
    const { id } = await stepUp(m.id, mine);
    await decideLoginRequest(db(), id, { status: "approved", now: NOW });
    expect(
      await claimApprovedStepUpRequest(db(), {
        id,
        sessionId: mine,
        memberId: someoneElse.id,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      await claimApprovedStepUpRequest(db(), {
        id,
        sessionId: mine,
        memberId: m.id,
        now: at(LOGIN_REQUEST_TTL_MS + LOGIN_EXCHANGE_GRACE_MS),
      }),
    ).toBe(false);
    expect(
      await claimApprovedStepUpRequest(db(), {
        id,
        sessionId: mine,
        memberId: m.id,
        now: at(LOGIN_REQUEST_TTL_MS + LOGIN_EXCHANGE_GRACE_MS - 1),
      }),
    ).toBe(true);
  });

  it("is never traded for a session, and a sign-in is never a step-up", async () => {
    const m = await member();
    const mine = await sessionOf(m.authUserId);
    const step = await stepUp(m.id, mine);
    await decideLoginRequest(db(), step.id, { status: "approved", now: NOW });
    // The sign-in path looks rows up by their secret; give the step-up row a
    // known one to prove the purpose, not the secret, keeps it out.
    await t
      .db()
      .update(loginRequests)
      .set({ secretHash: hashLoginSecret(SECRET) })
      .where(eq(loginRequests.id, step.id));
    expect(await findLoginRequestBySecret(db(), SECRET, NOW)).toBeNull();
    expect(await claimApprovedLoginRequest(db(), SECRET, NOW)).toBeNull();

    const other = "sign-in-secret-0123456789abcdefghijk";
    const signIn = await request(m.id, other);
    await decideLoginRequest(db(), signIn.id, { status: "approved", now: NOW });
    expect(
      await findStepUpRequest(db(), {
        id: signIn.id,
        sessionId: mine,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      await claimApprovedStepUpRequest(db(), {
        id: signIn.id,
        sessionId: mine,
        memberId: m.id,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("goes with its session, and a step-up needs one", async () => {
    const m = await member();
    const mine = await sessionOf(m.authUserId);
    await stepUp(m.id, mine);
    await t.db().delete(session).where(eq(session.id, mine));
    expect(await t.db().select().from(loginRequests)).toEqual([]);
    await expect(
      t.db().insert(loginRequests).values({
        memberId: m.id,
        purpose: "step_up",
        secretHash: "x",
        code: 47,
        choices: [47],
        device: "d",
        expiresAt: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("pruneLoginRequests", () => {
  it("deletes rows created before the cut-off only", async () => {
    await request(null);
    expect(await pruneLoginRequests(db(), NOW)).toBe(0);
    expect(await pruneLoginRequests(db(), at(LOGIN_REQUEST_RETENTION_MS))).toBe(
      1,
    );
    expect(await t.db().select().from(loginRequests)).toEqual([]);
  });
});
