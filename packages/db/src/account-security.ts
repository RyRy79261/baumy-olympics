import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, like, ne, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { account, passkey, session, user, verification } from "./schema";

// Settings → Security (issue #79): the member's own ways in and the devices
// signed in now, read and changed in OUR transaction, so each change is an
// action with its audit row (ADR 0002). Better Auth owns these tables and
// writes them on its own endpoints (sign-in, the passkey and two-factor
// ceremonies); what is here is only what a member does to their own rows
// from the Security page. Every query is scoped to one `user.id`, so none
// can reach another account's rows.
//
// A change that could remove the last way in (a passkey, Google) first locks
// the `user` row (`lockAuthUser`), so two removals racing each other cannot
// both see "there is another way in" and leave none.

/** The provider id Better Auth gives a password. */
export const CREDENTIAL_PROVIDER = "credential";

/**
 * Whether the session a request came in on still exists, belongs to `userId`
 * and has not expired, read from the database (not Better Auth's 5-minute
 * cookie cache) and share-locked for the rest of the transaction, so a device
 * signed out elsewhere cannot change the account's security in that window.
 */
export async function isLiveSession(
  db: Queryable,
  { userId, sessionId, now }: { userId: string; sessionId: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.userId, userId),
        gt(session.expiresAt, now),
      ),
    )
    .for("share");
  return rows.length > 0;
}

/**
 * The prefix of the `verification` rows the twoFactor plugin keeps for a
 * trusted device (Better Auth 1.6.25 `plugins/two-factor`: identifier
 * `trust-device-<random>`, value = the user id). A browser whose trust cookie
 * names a live row skips the code after a password.
 */
export const TRUSTED_DEVICE_PREFIX = "trust-device-";

/** Forget every device the account trusted for two-factor; returns how many. */
export async function forgetTrustedDevices(
  db: Queryable,
  userId: string,
): Promise<number> {
  const rows = await db
    .delete(verification)
    .where(
      and(
        eq(verification.value, userId),
        like(verification.identifier, `${TRUSTED_DEVICE_PREFIX}%`),
      ),
    )
    .returning({ id: verification.id });
  return rows.length;
}

export interface AuthUserFlags {
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

function selectAuthUser(db: Queryable, userId: string) {
  return db
    .select({
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, userId));
}

/** The account's flags as the database has them now; null if it is gone. */
export async function findAuthUser(
  db: Queryable,
  userId: string,
): Promise<AuthUserFlags | null> {
  const [row] = await selectAuthUser(db, userId);
  return row ?? null;
}

/** Lock the account's `user` row for this transaction; null if it is gone. */
export async function lockAuthUser(
  db: Queryable,
  userId: string,
): Promise<AuthUserFlags | null> {
  const [row] = await selectAuthUser(db, userId).for("update");
  return row ?? null;
}

/** The ways into one account: a password, linked providers, passkeys. */
export interface SignInMethods {
  password: boolean;
  /** Linked providers other than the password, e.g. `["google"]`. */
  providers: string[];
  passkeys: number;
}

export async function signInMethods(
  db: Queryable,
  userId: string,
): Promise<SignInMethods> {
  const accounts = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));
  const [keys] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(passkey)
    .where(eq(passkey.userId, userId));
  const ids = accounts.map((a) => a.providerId);
  return {
    password: ids.includes(CREDENTIAL_PROVIDER),
    providers: [...new Set(ids.filter((p) => p !== CREDENTIAL_PROVIDER))],
    passkeys: keys?.n ?? 0,
  };
}

/** How many ways in there are; the Security page never lets it reach 0. */
export function countWaysIn(methods: SignInMethods): number {
  return Number(methods.password) + methods.providers.length + methods.passkeys;
}

export interface PasskeyListing {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date | null;
}

export async function listUserPasskeys(
  db: Queryable,
  userId: string,
): Promise<PasskeyListing[]> {
  return db
    .select({
      id: passkey.id,
      name: passkey.name,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
    })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(asc(passkey.createdAt), asc(passkey.id));
}

export interface SessionListing {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  /** Better Auth refreshes it at most once a day (`updateAge`). */
  updatedAt: Date;
}

/**
 * The account's live sessions, most recently active first. No IP address:
 * the page names devices, not places (issue #79).
 */
export async function listUserSessions(
  db: Queryable,
  userId: string,
  now: Date,
): Promise<SessionListing[]> {
  return db
    .select({
      id: session.id,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.updatedAt), desc(session.id));
}

/** Sign one of the account's sessions out. False if it is not theirs. */
export async function deleteUserSession(
  db: Queryable,
  { userId, sessionId }: { userId: string; sessionId: string },
): Promise<boolean> {
  const rows = await db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  return rows.length > 0;
}

/** Sign every session but `keepSessionId` out; returns how many ended. */
export async function deleteOtherUserSessions(
  db: Queryable,
  { userId, keepSessionId }: { userId: string; keepSessionId: string },
): Promise<number> {
  const rows = await db
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, keepSessionId)))
    .returning({ id: session.id });
  return rows.length;
}

/** Rename one of the account's passkeys. False if it is not theirs. */
export async function renameUserPasskey(
  db: Queryable,
  {
    userId,
    passkeyId,
    name,
  }: { userId: string; passkeyId: string; name: string },
): Promise<boolean> {
  const rows = await db
    .update(passkey)
    .set({ name })
    .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)))
    .returning({ id: passkey.id });
  return rows.length > 0;
}

/** Remove one of the account's passkeys; its name, or null if not theirs. */
export async function deleteUserPasskey(
  db: Queryable,
  { userId, passkeyId }: { userId: string; passkeyId: string },
): Promise<{ name: string | null } | null> {
  const [row] = await db
    .delete(passkey)
    .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)))
    .returning({ name: passkey.name });
  return row ?? null;
}

/** Unlink a provider (Google) from the account; false if it was not linked. */
export async function deleteProviderAccount(
  db: Queryable,
  { userId, providerId }: { userId: string; providerId: string },
): Promise<boolean> {
  if (providerId === CREDENTIAL_PROVIDER) {
    throw new Error("A password is not unlinked here.");
  }
  const rows = await db
    .delete(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .returning({ id: account.id });
  return rows.length > 0;
}

/**
 * Give an account with no password its first one: the `credential` row Better
 * Auth's own setPassword would write (`accountId` is the user id). The hash
 * is made by the caller with Better Auth's hasher. The caller has checked,
 * under `lockAuthUser`, that there is no password yet.
 */
export async function insertCredentialAccount(
  db: Queryable,
  {
    userId,
    passwordHash,
    now,
  }: { userId: string; passwordHash: string; now: Date },
): Promise<void> {
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: CREDENTIAL_PROVIDER,
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
}
