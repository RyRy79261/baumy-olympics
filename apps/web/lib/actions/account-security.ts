import { z } from "zod";
import { hashAccountPassword } from "@baumy/auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import {
  countWaysIn,
  deleteOtherUserSessions,
  deleteProviderAccount,
  deleteUserPasskey,
  deleteUserSession,
  findAuthUser,
  forgetTrustedDevices,
  insertCredentialAccount,
  isLiveSession,
  listUserPasskeys,
  listUserSessions,
  lockAuthUser,
  renameUserPasskey,
  signInMethods,
} from "@baumy/db/account-security";
import type { MemberActor } from "@/lib/auth";
import { sessionLabel } from "@/lib/auth/session-label";
import type { ActionCtx } from "./define";
import { defineAction } from "./define";
import { fail, type ActionFailure } from "./result";

// Settings, Security (issue #79, camp-404 parity): the member's own ways in
// and the devices signed in now. Every one needs the member's OWN session
// (`session`: never the kiosk, MCP or brain) and is offered on the UI only.
//
// What is here is what a member changes on their own rows. The ceremonies
// that must run between the browser and Better Auth (adding a passkey, the
// two-factor enrolment, linking Google, signing in) stay Better Auth
// endpoints, like sign-in itself; @baumy/auth guards them (security.ts).
//
// A change that could leave the account with no way in (removing a passkey,
// unlinking Google) locks the `user` row, makes the change, counts what is
// left and fails, rolling the change back, if nothing is.

export const GOOGLE_PROVIDER = "google";

/** The session gate has checked it is a member's own session. */
function me(ctx: ActionCtx): MemberActor {
  return ctx.actor as MemberActor;
}

export const SIGNED_OUT =
  "This device was signed out. Sign in again to change your security settings.";

/**
 * The actor, if the session this request came in on still exists in the
 * database. Better Auth accepts a signed cookie cache for up to 5 minutes
 * after a session is revoked, so without this a device signed out elsewhere
 * could, in that window, sign the owner out everywhere, unlink Google or add
 * a password. Every write here asks first, share-locking the row.
 */
async function liveActor(ctx: ActionCtx): Promise<MemberActor | ActionFailure> {
  const actor = me(ctx);
  if (
    !actor.sessionId ||
    !(await isLiveSession(ctx.db, {
      userId: actor.userId,
      sessionId: actor.sessionId,
      now: ctx.now,
    }))
  ) {
    return fail("UNAUTHENTICATED", SIGNED_OUT);
  }
  return actor;
}

const isFailure = (x: MemberActor | ActionFailure): x is ActionFailure =>
  "ok" in x;

const NO_WAY_IN =
  "That's your only way in. Add a password, a passkey or Google first.";

export interface PasskeyView {
  id: string;
  name: string | null;
  /** Synced by a password manager or the phone's cloud, vs one device. */
  synced: boolean;
  createdAt: string | null;
}

export interface SessionView {
  id: string;
  /** "Chrome on Windows"; never a place. */
  label: string;
  /** When it last checked in (Better Auth refreshes this at most daily). */
  lastActiveAt: string;
  signedInAt: string;
  current: boolean;
}

export interface AccountSecurityView {
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  passkeys: PasskeyView[];
  /** This device first, then the most recently active. */
  sessions: SessionView[];
}

export const getAccountSecurity = defineAction({
  name: "get_account_security",
  title: "See my sign-in security",
  description:
    "Shows how the signed-in member signs in (password, Google, passkeys, two-factor) and the devices signed in to their account now.",
  consent: "See how you sign in and your signed-in devices",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    const { userId, sessionId } = me(ctx);
    const [flags, methods, passkeys, sessions] = await Promise.all([
      findAuthUser(ctx.db, userId),
      signInMethods(ctx.db, userId),
      listUserPasskeys(ctx.db, userId),
      listUserSessions(ctx.db, userId, ctx.now),
    ]);
    const data: AccountSecurityView = {
      emailVerified: flags?.emailVerified ?? false,
      twoFactorEnabled: flags?.twoFactorEnabled ?? false,
      hasPassword: methods.password,
      googleLinked: methods.providers.includes(GOOGLE_PROVIDER),
      passkeys: passkeys.map((p) => ({
        id: p.id,
        name: p.name,
        synced: p.deviceType === "multiDevice" || p.backedUp,
        createdAt: p.createdAt?.toISOString() ?? null,
      })),
      sessions: sessions
        .map((s) => ({
          id: s.id,
          label: sessionLabel(s.userAgent),
          lastActiveAt: s.updatedAt.toISOString(),
          signedInAt: s.createdAt.toISOString(),
          current: s.id === sessionId,
        }))
        .sort((a, b) => Number(b.current) - Number(a.current)),
    };
    return { ok: true, data };
  },
});

const SessionId = z.string().trim().min(1, "Which device?").max(200);
const PasskeyId = z.string().trim().min(1, "Which passkey?").max(200);

export const revokeSession = defineAction({
  name: "revoke_session",
  title: "Sign out a device",
  description:
    "Signs one other device out of the signed-in member's account. A page it already has open can keep working for up to 5 minutes.",
  consent: "Sign your other devices out",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({ sessionId: SessionId }),
  async execute(ctx, { sessionId }) {
    const actor = await liveActor(ctx);
    if (isFailure(actor)) return actor;
    if (sessionId === actor.sessionId) {
      return fail(
        "CURRENT_SESSION",
        "That's the device you're using. Use Sign out to leave it.",
      );
    }
    const ended = await deleteUserSession(ctx.db, {
      userId: actor.userId,
      sessionId,
    });
    if (!ended) {
      return fail("NOT_FOUND", "That device is already signed out.");
    }
    // The device may have been trusted for two-factor; which trust cookie is
    // its own cannot be told apart, so every device is forgotten and the next
    // password sign-in anywhere asks for the code again.
    const forgotten = await forgetTrustedDevices(ctx.db, actor.userId);
    return {
      ok: true,
      data: { sessionId },
      audit: {
        entity: "session",
        entityId: sessionId,
        payload: { sessionId, trustedDevicesForgotten: forgotten },
      },
    };
  },
});

export const revokeOtherSessions = defineAction({
  name: "revoke_other_sessions",
  title: "Sign out every other device",
  description:
    "Signs every device but this one out of the signed-in member's account. Pages they already have open can keep working for up to 5 minutes.",
  consent: "Sign your other devices out",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    const actor = await liveActor(ctx);
    if (isFailure(actor)) return actor;
    const count = await deleteOtherUserSessions(ctx.db, {
      userId: actor.userId,
      keepSessionId: actor.sessionId!,
    });
    // A signed-out device that was trusted for two-factor must not skip the
    // code with just the password (Better Auth 1.6.25 keeps the trust for 30
    // days otherwise).
    const forgotten = await forgetTrustedDevices(ctx.db, actor.userId);
    return {
      ok: true,
      data: { count },
      audit: {
        entity: "session",
        payload: { count, trustedDevicesForgotten: forgotten },
      },
    };
  },
});

export const renamePasskey = defineAction({
  name: "rename_passkey",
  title: "Rename a passkey",
  description:
    "Renames one of the signed-in member's passkeys, so they can tell their devices apart.",
  consent: "Rename your passkeys",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({
    passkeyId: PasskeyId,
    name: z
      .string()
      .trim()
      .min(1, "Give it a name.")
      .max(64, "Use at most 64 characters."),
  }),
  async execute(ctx, { passkeyId, name }) {
    const actor = await liveActor(ctx);
    if (isFailure(actor)) return actor;
    const renamed = await renameUserPasskey(ctx.db, {
      userId: actor.userId,
      passkeyId,
      name,
    });
    if (!renamed) return fail("NOT_FOUND", "That passkey is already gone.");
    return {
      ok: true,
      data: { passkeyId, name },
      audit: { entity: "passkey", entityId: passkeyId, payload: { name } },
    };
  },
});

export const removePasskey = defineAction({
  name: "remove_passkey",
  title: "Remove a passkey",
  description:
    "Removes one of the signed-in member's passkeys. Refused when it is their only way in.",
  consent: "Remove your passkeys",
  kind: "write",
  risk: "destructive",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({ passkeyId: PasskeyId }),
  async execute(ctx, { passkeyId }) {
    const actor = await liveActor(ctx);
    if (isFailure(actor)) return actor;
    const { userId } = actor;
    await lockAuthUser(ctx.db, userId);
    const removed = await deleteUserPasskey(ctx.db, { userId, passkeyId });
    if (!removed) return fail("NOT_FOUND", "That passkey is already gone.");
    if (countWaysIn(await signInMethods(ctx.db, userId)) === 0) {
      return fail("LAST_SIGN_IN_METHOD", NO_WAY_IN);
    }
    return {
      ok: true,
      data: { passkeyId, name: removed.name },
      audit: {
        entity: "passkey",
        entityId: passkeyId,
        payload: { name: removed.name },
      },
    };
  },
});

export const unlinkGoogle = defineAction({
  name: "unlink_google",
  title: "Unlink Google",
  description:
    "Unlinks Google from the signed-in member's account, so Continue with Google no longer signs in to it until they press Link Google again. Refused when Google is their only way in.",
  consent: "Unlink Google from your account",
  kind: "write",
  risk: "destructive",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    const actor = await liveActor(ctx);
    if (isFailure(actor)) return actor;
    const { userId } = actor;
    await lockAuthUser(ctx.db, userId);
    const unlinked = await deleteProviderAccount(ctx.db, {
      userId,
      providerId: GOOGLE_PROVIDER,
    });
    if (!unlinked) {
      return fail("NOT_FOUND", "Google isn't linked to your account.");
    }
    if (countWaysIn(await signInMethods(ctx.db, userId)) === 0) {
      return fail("LAST_SIGN_IN_METHOD", NO_WAY_IN);
    }
    return {
      ok: true,
      data: { provider: GOOGLE_PROVIDER },
      audit: { entity: "account", payload: { provider: GOOGLE_PROVIDER } },
    };
  },
});

export const setFirstPassword = defineAction({
  name: "set_first_password",
  title: "Add a password",
  description:
    "Gives an account that signs in only with Google or a passkey its first password, so it can also sign in with its email.",
  consent: "Add a password to your account",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  // Hashing is deliberately slow; so is guessing.
  rateLimit: { perMember: 5, perIp: 20, windowMs: 15 * 60_000 },
  fingerprint: () => ({ password: "[hidden]" }),
  input: z.strictObject({
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
      )
      .max(
        PASSWORD_MAX_LENGTH,
        `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
      ),
  }),
  async execute(ctx, { password }) {
    const actor = await liveActor(ctx);
    if (isFailure(actor)) return actor;
    const { userId } = actor;
    await lockAuthUser(ctx.db, userId);
    if ((await signInMethods(ctx.db, userId)).password) {
      return fail(
        "PASSWORD_ALREADY_SET",
        "Your account already has a password. Reload the page to see it.",
      );
    }
    await insertCredentialAccount(ctx.db, {
      userId,
      passwordHash: await hashAccountPassword(password),
      now: ctx.now,
    });
    return {
      ok: true,
      data: { added: true },
      audit: { entity: "account", payload: { provider: "credential" } },
    };
  },
});
