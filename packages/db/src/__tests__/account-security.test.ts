import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_PROVIDER,
  countWaysIn,
  deleteOtherUserSessions,
  deleteProviderAccount,
  deleteUserPasskey,
  deleteUserSession,
  insertCredentialAccount,
  listUserPasskeys,
  listUserSessions,
  TRUSTED_DEVICE_PREFIX,
  findAuthUser,
  forgetTrustedDevices,
  isLiveSession,
  lockAuthUser,
  renameUserPasskey,
  signInMethods,
} from "../account-security";
import type { Queryable } from "../index";
import { account, passkey, session, user, verification } from "../schema";
import { useTestDb } from "./_harness";

// Settings → Security's own-account queries (issue #79). Every one is
// scoped to one user, so each test gives a second account the same kind of
// row and checks it is untouched.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-28T10:00:00Z");
const HOUR = 3_600_000;

async function seedUser(
  id: string,
  over: Partial<typeof user.$inferInsert> = {},
) {
  await t
    .db()
    .insert(user)
    .values({ id, name: id, email: `${id}@example.com`, ...over });
}

async function seedSession(
  id: string,
  userId: string,
  updatedAt: Date,
  expiresAt = new Date(NOW.getTime() + 24 * HOUR),
) {
  await t
    .db()
    .insert(session)
    .values({
      id,
      token: `tok-${id}`,
      userId,
      userAgent: `agent ${id}`,
      createdAt: new Date(updatedAt.getTime() - HOUR),
      updatedAt,
      expiresAt,
    });
}

async function seedPasskey(id: string, userId: string, createdAt: Date) {
  await t
    .db()
    .insert(passkey)
    .values({
      id,
      name: `key ${id}`,
      publicKey: "pk",
      userId,
      credentialID: `cred-${id}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt,
    });
}

async function seedAccount(userId: string, providerId: string) {
  await t
    .db()
    .insert(account)
    .values({
      id: `${userId}-${providerId}`,
      accountId: providerId === CREDENTIAL_PROVIDER ? userId : "g-123",
      providerId,
      userId,
    });
}

describe("findAuthUser and lockAuthUser", () => {
  it("read the flags, with or without a lock, and null for no such user", async () => {
    await seedUser("u1", { emailVerified: true, twoFactorEnabled: true });
    const flags = { emailVerified: true, twoFactorEnabled: true };
    await expect(findAuthUser(db(), "u1")).resolves.toEqual(flags);
    await expect(lockAuthUser(db(), "u1")).resolves.toEqual(flags);
    await expect(findAuthUser(db(), "nobody")).resolves.toBeNull();
    await expect(lockAuthUser(db(), "nobody")).resolves.toBeNull();
  });
});

describe("signInMethods and countWaysIn", () => {
  it("counts a password, each provider once and every passkey", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await expect(signInMethods(db(), "u1")).resolves.toEqual({
      password: false,
      providers: [],
      passkeys: 0,
    });
    await seedAccount("u1", CREDENTIAL_PROVIDER);
    await seedAccount("u1", "google");
    await seedPasskey("p1", "u1", NOW);
    await seedPasskey("p2", "u1", NOW);
    await seedPasskey("p3", "u2", NOW);
    const methods = await signInMethods(db(), "u1");
    expect(methods).toEqual({
      password: true,
      providers: ["google"],
      passkeys: 2,
    });
    expect(countWaysIn(methods)).toBe(4);
    expect(countWaysIn({ password: false, providers: [], passkeys: 0 })).toBe(
      0,
    );
  });
});

describe("sessions", () => {
  it("lists only my live sessions, most recent first", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedSession("old", "u1", new Date(NOW.getTime() - 5 * HOUR));
    await seedSession("new", "u1", new Date(NOW.getTime() - HOUR));
    await seedSession(
      "expired",
      "u1",
      new Date(NOW.getTime() - 2 * HOUR),
      new Date(NOW.getTime() - 1),
    );
    await seedSession("theirs", "u2", NOW);
    const rows = await listUserSessions(db(), "u1", NOW);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(rows[0]).toMatchObject({ userAgent: "agent new" });
  });

  it("ends one of mine, never someone else's", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedSession("mine", "u1", NOW);
    await seedSession("theirs", "u2", NOW);
    await expect(
      deleteUserSession(db(), { userId: "u1", sessionId: "theirs" }),
    ).resolves.toBe(false);
    await expect(
      deleteUserSession(db(), { userId: "u1", sessionId: "mine" }),
    ).resolves.toBe(true);
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left.map((r) => r.id)).toEqual(["theirs"]);
  });

  it("ends every other session of mine and keeps this one", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedSession("here", "u1", NOW);
    await seedSession("phone", "u1", NOW);
    await seedSession("laptop", "u1", NOW);
    await seedSession("theirs", "u2", NOW);
    await expect(
      deleteOtherUserSessions(db(), { userId: "u1", keepSessionId: "here" }),
    ).resolves.toBe(2);
    const left = await t.db().select({ id: session.id }).from(session);
    expect(left.map((r) => r.id).sort()).toEqual(["here", "theirs"]);
  });
});

describe("passkeys", () => {
  it("lists, renames and removes only my own", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedPasskey("b", "u1", new Date(NOW.getTime() + HOUR));
    await seedPasskey("a", "u1", NOW);
    await seedPasskey("theirs", "u2", NOW);

    const mine = await listUserPasskeys(db(), "u1");
    expect(mine.map((p) => p.id)).toEqual(["a", "b"]);
    expect(mine[0]).toMatchObject({
      name: "key a",
      deviceType: "singleDevice",
      backedUp: false,
    });

    await expect(
      renameUserPasskey(db(), {
        userId: "u1",
        passkeyId: "theirs",
        name: "x",
      }),
    ).resolves.toBe(false);
    await expect(
      renameUserPasskey(db(), { userId: "u1", passkeyId: "a", name: "Phone" }),
    ).resolves.toBe(true);
    const [renamed] = await t
      .db()
      .select({ name: passkey.name })
      .from(passkey)
      .where(eq(passkey.id, "a"));
    expect(renamed!.name).toBe("Phone");

    await expect(
      deleteUserPasskey(db(), { userId: "u1", passkeyId: "theirs" }),
    ).resolves.toBeNull();
    await expect(
      deleteUserPasskey(db(), { userId: "u1", passkeyId: "a" }),
    ).resolves.toEqual({ name: "Phone" });
    const left = await t.db().select({ id: passkey.id }).from(passkey);
    expect(left.map((r) => r.id).sort()).toEqual(["b", "theirs"]);
  });
});

describe("provider accounts and the first password", () => {
  it("unlinks Google from my account only, and never a password", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedAccount("u1", "google");
    await seedAccount("u2", "google");
    await expect(
      deleteProviderAccount(db(), { userId: "u1", providerId: "google" }),
    ).resolves.toBe(true);
    await expect(
      deleteProviderAccount(db(), { userId: "u1", providerId: "google" }),
    ).resolves.toBe(false);
    const left = await t.db().select({ userId: account.userId }).from(account);
    expect(left).toEqual([{ userId: "u2" }]);
    await expect(
      deleteProviderAccount(db(), {
        userId: "u1",
        providerId: CREDENTIAL_PROVIDER,
      }),
    ).rejects.toThrow("not unlinked");
  });

  it("adds a credential account the way Better Auth's setPassword does", async () => {
    await seedUser("u1");
    await insertCredentialAccount(db(), {
      userId: "u1",
      passwordHash: "salt:hash",
      now: NOW,
    });
    const [row] = await t.db().select().from(account);
    expect(row).toMatchObject({
      userId: "u1",
      accountId: "u1",
      providerId: CREDENTIAL_PROVIDER,
      password: "salt:hash",
      createdAt: NOW,
    });
    await expect(signInMethods(db(), "u1")).resolves.toMatchObject({
      password: true,
    });
  });
});

describe("isLiveSession and forgetTrustedDevices", () => {
  it("sees my own unexpired session only, and nothing once it is deleted", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedSession("mine", "u1", NOW);
    await seedSession(
      "old",
      "u1",
      new Date(NOW.getTime() - 2 * HOUR),
      new Date(NOW.getTime() - 1),
    );
    await seedSession("theirs", "u2", NOW);
    const live = (sessionId: string) =>
      isLiveSession(db(), { userId: "u1", sessionId, now: NOW });
    await expect(live("mine")).resolves.toBe(true);
    await expect(live("old")).resolves.toBe(false);
    await expect(live("theirs")).resolves.toBe(false);
    await deleteUserSession(db(), { userId: "u1", sessionId: "mine" });
    await expect(live("mine")).resolves.toBe(false);
  });

  it("forgets my trusted devices and nothing else", async () => {
    const at = new Date(NOW.getTime() + 24 * HOUR);
    await t
      .db()
      .insert(verification)
      .values([
        {
          id: "v1",
          identifier: `${TRUSTED_DEVICE_PREFIX}a`,
          value: "u1",
          expiresAt: at,
        },
        {
          id: "v2",
          identifier: `${TRUSTED_DEVICE_PREFIX}b`,
          value: "u1",
          expiresAt: at,
        },
        {
          id: "v3",
          identifier: `${TRUSTED_DEVICE_PREFIX}c`,
          value: "u2",
          expiresAt: at,
        },
        {
          id: "v4",
          identifier: "reset-password:x",
          value: "u1",
          expiresAt: at,
        },
      ]);
    await expect(forgetTrustedDevices(db(), "u1")).resolves.toBe(2);
    const left = await t
      .db()
      .select({ id: verification.id })
      .from(verification);
    expect(left.map((r) => r.id).sort()).toEqual(["v3", "v4"]);
  });
});
