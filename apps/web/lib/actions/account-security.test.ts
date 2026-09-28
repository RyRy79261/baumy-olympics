// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "better-auth/crypto";
import { PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import type { Queryable } from "@baumy/db";
import {
  account,
  actionRequests,
  auditEvents,
  passkey,
  session,
  user,
} from "@baumy/db/schema";
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
import { runAction } from "./registry";

// Settings, Security (issue #79), through the real runAction on PGlite: the
// member's own sessions, passkeys, Google link and first password. Every
// action needs the member's own session, on the UI only, and never reaches
// another account's rows.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const HOUR = 3_600_000;
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

beforeEach(() => {
  __resetMemoryRateLimits();
});

async function seedUser(id: string) {
  await t
    .db()
    .insert(user)
    .values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
}

async function seedSession(id: string, userId: string, ageHours: number) {
  const at = new Date(FIXED_NOW.getTime() - ageHours * HOUR);
  await t
    .db()
    .insert(session)
    .values({
      id,
      token: `tok-${id}`,
      userId,
      userAgent: CHROME_MAC,
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(FIXED_NOW.getTime() + 24 * HOUR),
    });
}

async function seedPasskey(id: string, userId: string, synced = false) {
  await t
    .db()
    .insert(passkey)
    .values({
      id,
      name: `Key ${id}`,
      publicKey: "pk",
      userId,
      credentialID: `cred-${id}`,
      counter: 0,
      deviceType: synced ? "multiDevice" : "singleDevice",
      backedUp: synced,
      createdAt: FIXED_NOW,
    });
}

async function seedAccount(userId: string, providerId: string) {
  await t
    .db()
    .insert(account)
    .values({
      id: `${userId}-${providerId}`,
      accountId: userId,
      providerId,
      userId,
      password: providerId === "credential" ? "salt:hash" : null,
    });
}

/** A member with account `u1`, signed in on session `here`. */
async function arrange(): Promise<MemberActor> {
  const memberId = await seedMember(db(), { authUserId: "u1" });
  await seedUser("u1");
  await seedUser("u2");
  await seedSession("here", "u1", 1);
  return sessionActor(memberId, "member", {
    userId: "u1",
    sessionId: "here",
  });
}

const run = (name: ActionName, input: unknown, actor: Actor) =>
  runAction(name, input as never, ctxFor(actor));

const audits = () => t.db().select().from(auditEvents);

describe("get_account_security", () => {
  it("shows my flags, ways in, passkeys and live sessions, this device first", async () => {
    const me = await arrange();
    await seedSession("phone", "u1", 0.5);
    await seedSession("theirs", "u2", 0);
    await seedAccount("u1", "credential");
    await seedAccount("u1", "google");
    await seedPasskey("pk-a", "u1", true);
    await seedPasskey("pk-theirs", "u2");
    await t
      .db()
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.id, "u1"));

    const res = await run("get_account_security", {}, me);
    expect(res).toEqual({
      ok: true,
      data: {
        emailVerified: true,
        twoFactorEnabled: true,
        hasPassword: true,
        googleLinked: true,
        passkeys: [
          {
            id: "pk-a",
            name: "Key pk-a",
            synced: true,
            createdAt: FIXED_NOW.toISOString(),
          },
        ],
        sessions: [
          expect.objectContaining({
            id: "here",
            label: "Chrome on macOS",
            current: true,
          }),
          expect.objectContaining({
            id: "phone",
            current: false,
            lastActiveAt: new Date(
              FIXED_NOW.getTime() - 0.5 * HOUR,
            ).toISOString(),
          }),
        ],
      },
    });
  });

  it("reads a Google-only account with nothing else set up", async () => {
    const me = await arrange();
    await seedAccount("u1", "google");
    const res = await run("get_account_security", {}, me);
    expect(res).toMatchObject({
      ok: true,
      data: {
        hasPassword: false,
        googleLinked: true,
        twoFactorEnabled: false,
        passkeys: [],
      },
    });
  });
});

describe("revoke_session and revoke_other_sessions", () => {
  it("signs one other device out, with an audit row", async () => {
    const me = await arrange();
    await seedSession("phone", "u1", 2);
    const res = await run("revoke_session", { sessionId: "phone" }, me);
    expect(res).toEqual({ ok: true, data: { sessionId: "phone" } });
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left.map((r) => r.id)).toEqual(["here"]);
    expect(await audits()).toEqual([
      expect.objectContaining({
        action: "revoke_session",
        entity: "session",
        entityId: "phone",
      }),
    ]);
  });

  it("refuses this device and someone else's", async () => {
    const me = await arrange();
    await seedSession("theirs", "u2", 1);
    expect(
      await run("revoke_session", { sessionId: "here" }, me),
    ).toMatchObject({ ok: false, code: "CURRENT_SESSION" });
    expect(
      await run("revoke_session", { sessionId: "theirs" }, me),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await run("revoke_session", { sessionId: "" }, me)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left.map((r) => r.id).sort()).toEqual(["here", "theirs"]);
    expect(await audits()).toEqual([]);
  });

  it("signs every other device of mine out and keeps this one", async () => {
    const me = await arrange();
    await seedSession("phone", "u1", 2);
    await seedSession("laptop", "u1", 3);
    await seedSession("theirs", "u2", 1);
    expect(await run("revoke_other_sessions", {}, me)).toEqual({
      ok: true,
      data: { count: 2 },
    });
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left.map((r) => r.id).sort()).toEqual(["here", "theirs"]);
    const [row] = await audits();
    expect(row).toMatchObject({ entity: "session", payload: { count: 2 } });
  });

  it("will not sign others out without knowing which session is mine", async () => {
    const me = await arrange();
    await seedSession("phone", "u1", 2);
    const { sessionId: _drop, ...noSession } = me;
    expect(
      await run("revoke_other_sessions", {}, noSession as MemberActor),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left).toHaveLength(2);
  });
});

describe("rename_passkey and remove_passkey", () => {
  it("renames my passkey, never someone else's", async () => {
    const me = await arrange();
    await seedPasskey("mine", "u1");
    await seedPasskey("theirs", "u2");
    expect(
      await run("rename_passkey", { passkeyId: "mine", name: " Phone " }, me),
    ).toEqual({ ok: true, data: { passkeyId: "mine", name: "Phone" } });
    expect(
      await run("rename_passkey", { passkeyId: "theirs", name: "Mine" }, me),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await run("rename_passkey", { passkeyId: "mine", name: "  " }, me),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const rows = await t
      .db()
      .select({ id: passkey.id, name: passkey.name })
      .from(passkey);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: "mine", name: "Phone" },
        { id: "theirs", name: "Key theirs" },
      ]),
    );
  });

  it("removes a passkey while another way in is left", async () => {
    const me = await arrange();
    await seedAccount("u1", "credential");
    await seedPasskey("mine", "u1");
    expect(await run("remove_passkey", { passkeyId: "mine" }, me)).toEqual({
      ok: true,
      data: { passkeyId: "mine", name: "Key mine" },
    });
    expect(await t.db().select().from(passkey)).toEqual([]);
    expect(await audits()).toEqual([
      expect.objectContaining({ entity: "passkey", entityId: "mine" }),
    ]);
  });

  it("refuses to remove the only way in, and keeps it", async () => {
    const me = await arrange();
    await seedPasskey("only", "u1");
    await seedPasskey("theirs", "u2");
    expect(
      await run("remove_passkey", { passkeyId: "only" }, me),
    ).toMatchObject({ ok: false, code: "LAST_SIGN_IN_METHOD" });
    expect(
      await run("remove_passkey", { passkeyId: "theirs" }, me),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const left = await t.db().select({ id: passkey.id }).from(passkey);
    expect(left.map((r) => r.id).sort()).toEqual(["only", "theirs"]);
    expect(await audits()).toEqual([]);
  });
});

describe("unlink_google", () => {
  it("unlinks Google while a password is left", async () => {
    const me = await arrange();
    await seedAccount("u1", "credential");
    await seedAccount("u1", "google");
    expect(await run("unlink_google", {}, me)).toEqual({
      ok: true,
      data: { provider: "google" },
    });
    const left = await t
      .db()
      .select({ providerId: account.providerId })
      .from(account);
    expect(left).toEqual([{ providerId: "credential" }]);
    expect(await audits()).toEqual([
      expect.objectContaining({ entity: "account" }),
    ]);
  });

  it("refuses when Google is the only way in, and when it is not linked", async () => {
    const me = await arrange();
    await seedAccount("u1", "google");
    await seedAccount("u2", "google");
    expect(await run("unlink_google", {}, me)).toMatchObject({
      ok: false,
      code: "LAST_SIGN_IN_METHOD",
    });
    expect(await t.db().select().from(account)).toHaveLength(2);

    const other = await seedMember(db(), { authUserId: "u3" });
    await seedUser("u3");
    await seedAccount("u3", "credential");
    expect(
      await run(
        "unlink_google",
        {},
        sessionActor(other, "member", { userId: "u3", sessionId: "x" }),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("set_first_password", () => {
  const password = "a-first-passphrase".padEnd(PASSWORD_MIN_LENGTH + 2, "z");

  it("adds a password Better Auth can verify, and keeps it out of the ledger", async () => {
    const me = await arrange();
    await seedAccount("u1", "google");
    expect(await run("set_first_password", { password }, me)).toEqual({
      ok: true,
      data: { added: true },
    });
    const [row] = await t
      .db()
      .select()
      .from(account)
      .where(eq(account.providerId, "credential"));
    expect(row).toMatchObject({ userId: "u1", accountId: "u1" });
    await expect(
      verifyPassword({ hash: row!.password!, password }),
    ).resolves.toBe(true);
    const stored = JSON.stringify([
      await t.db().select().from(actionRequests),
      await audits(),
    ]);
    expect(stored).toContain('"provider":"credential"');
    expect(stored).not.toContain(password);
  });

  it("refuses an account that has one, and a short password", async () => {
    const me = await arrange();
    await seedAccount("u1", "credential");
    expect(await run("set_first_password", { password }, me)).toMatchObject({
      ok: false,
      code: "PASSWORD_ALREADY_SET",
    });
    expect(
      await run(
        "set_first_password",
        { password: "x".repeat(PASSWORD_MIN_LENGTH - 1) },
        me,
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await t.db().select().from(account)).toHaveLength(1);
  });
});

describe("who may", () => {
  const CASES: [ActionName, unknown][] = [
    ["get_account_security", {}],
    ["revoke_session", { sessionId: "phone" }],
    ["revoke_other_sessions", {}],
    ["rename_passkey", { passkeyId: "pk", name: "x" }],
    ["remove_passkey", { passkeyId: "pk" }],
    ["unlink_google", {}],
    ["set_first_password", { password: "p".repeat(PASSWORD_MIN_LENGTH + 1) }],
  ];

  it("only the member's own session, and only on the UI", async () => {
    const me = await arrange();
    const memberId = me.memberId!;
    const others: [Actor, string][] = [
      [kioskActor(memberId), "kiosk"],
      [{ kind: "mcp", memberId, scopes: ["baumy:read", "baumy:write"] }, "mcp"],
      [{ kind: "service", tokenName: "baumy-brain", memberId }, "brain"],
      [sessionActor(undefined, "member", { userId: "u1" }), "no member"],
    ];
    for (const [name, input] of CASES) {
      for (const [actor, label] of others) {
        const res = await run(name, input, actor);
        expect(res.ok, `${name} as ${label}`).toBe(false);
      }
      for (const source of ["mcp", "brain", "kiosk", "ai"] as const) {
        const res = await runAction(
          name,
          input as never,
          ctxFor(me, { source }),
        );
        expect(res, `${name} from ${source}`).toMatchObject({
          ok: false,
          code: "SURFACE_FORBIDDEN",
        });
      }
    }
    // Present before absent: the sessions are all still there.
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left.map((r) => r.id)).toEqual(["here"]);
  });
});
