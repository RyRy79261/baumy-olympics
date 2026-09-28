import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  LOGIN_EXCHANGE_GRACE_MS,
  LOGIN_REQUEST_RETENTION_MS,
  LOGIN_REQUEST_TTL_MS,
  LOGIN_DENIAL_LOCK_MS,
  claimApprovedLoginRequest,
  decideLoginRequest,
  findLoginCandidate,
  findLoginRequestBySecret,
  hashLoginSecret,
  insertLoginRequest,
  isLoginLocked,
  lockLoginRequest,
  loginRequestState,
  pruneLoginRequests,
  userHasTwoFactor,
} from "../login-requests";
import { loginRequests, members, user } from "../schema";
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

  it("finds nobody with two-factor on, and works before that column exists", async () => {
    const m = await member({ email: "tfa@example.com", telegramUserId: 77 });
    expect(await userHasTwoFactor(db(), m.authUserId!)).toBe(false);
    expect(
      await findLoginCandidate(db(), HOUSEHOLD_ID, "tfa@example.com"),
    ).not.toBeNull();
    // What Better Auth's two-factor plugin (issue #79) will add.
    await t
      .client()
      .query(
        'alter table "user" add column two_factor_enabled boolean not null default false',
      );
    expect(
      await findLoginCandidate(db(), HOUSEHOLD_ID, "tfa@example.com"),
    ).not.toBeNull();
    await t
      .client()
      .query('update "user" set two_factor_enabled = true where id = $1', [
        m.authUserId,
      ]);
    expect(await userHasTwoFactor(db(), m.authUserId!)).toBe(true);
    expect(
      await findLoginCandidate(db(), HOUSEHOLD_ID, "tfa@example.com"),
    ).toBeNull();
    await t.client().query('alter table "user" drop column two_factor_enabled');
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
