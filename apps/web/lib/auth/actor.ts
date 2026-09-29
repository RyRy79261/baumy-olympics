import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authMayServe, getAuth } from "@baumy/auth";
import { createHttpDb, type Queryable } from "@baumy/db";
import {
  findPairedKioskDevice,
  hashKioskToken,
  touchKioskDevice,
} from "@baumy/db/kiosk-devices";
import {
  findActiveMember,
  findActiveMemberByAuthUserId,
} from "@baumy/db/members";
import { now } from "@/lib/clock";
import {
  KIOSK_COOKIE,
  KIOSK_MEMBER_COOKIE,
  KIOSK_TOKEN_MAX_LENGTH,
  isMemberId,
} from "@/lib/kiosk/cookies";

// Who is making this request (ADR 0001, SPEC §6.2). Ported from camp-404
// `apps/web/lib/auth.ts`, reshaped around one `Actor` type.
//
// Two kinds are resolved from a request today:
// - `member`: a Better Auth session, from the `baumy.session_token` cookie or
//   from `Authorization: Bearer <token>` (the bearer plugin turns the header
//   into the same session);
// - `kiosk`: a paired kiosk device, from the `baumy_kiosk` cookie, with the
//   member whose avatar was tapped, if any (getKioskActor).
// A person's own session wins when a browser carries both. The service and
// MCP kinds are built by their own adapters from their own credentials: MCP
// tokens in lib/mcp (issues #23, #24), brain's service token in lib/brain
// (issue #27).
// Deciding what an actor may DO is not this file's job: that is `runAction`
// and its gates.

export type ActorKind = "member" | "kiosk" | "service" | "mcp";

export type MemberRole = "admin" | "member";

/**
 * A person signed in with their own Better Auth session (cookie or bearer).
 * The only kind `requireSession` and `requireAdmin` accept.
 */
export interface MemberActor {
  kind: "member";
  /** Better Auth's `user.id`, which `members.auth_user_id` holds. */
  userId: string;
  email: string;
  name: string;
  /** Whether Better Auth has seen this address confirmed (link or Google). */
  emailVerified: boolean;
  /**
   * When this session signed in, ISO 8601. Changing an existing kiosk PIN
   * without the password needs a session under 10 minutes old (SPEC §6.2).
   */
  sessionCreatedAt: string;
  /**
   * Better Auth's `session.id` for this request, so Settings, Security can
   * mark "this device" and sign out every OTHER one (issue #79). An id, not
   * the token: it signs nobody in.
   */
  sessionId?: string;
  /**
   * The active `members` row linked to this account, if there is one. A
   * session without one is only proof of an account, not of a housemate, and
   * every action gate refuses it (joining is issue #9).
   */
  memberId?: string;
  role?: MemberRole;
  /** The member's display name, with `memberId`. */
  displayName?: string;
  /**
   * The member's 16-bit character (`members.avatar`, null until chosen),
   * with `memberId`: the hub header and Settings draw it.
   */
  avatar?: unknown;
}

/**
 * A paired kiosk device. `memberId` is the member whose avatar was tapped on
 * it, if any (the issue calls it `selectedMemberId`; it is `memberId` here so
 * every gate reads one field for every actor). Tapping an avatar is enough
 * for self-claims; anything attested also needs that member's PIN, sent
 * with the request (`RequestCtx.pin`).
 */
export interface KioskActor {
  kind: "kiosk";
  deviceId: string;
  /** What the admin named the device. */
  deviceName?: string;
  memberId?: string;
  /** The picked member's display name, with `memberId`. */
  displayName?: string;
}

/**
 * A service token (baumy-brain) acting for a Telegram user (issue #27, the
 * `/api/v1/actions` adapter in lib/brain). `memberId` is the member that
 * Telegram user is linked to, if any (an unlinked one may only call
 * `link_telegram`), or the housemate it acts for on their behalf.
 */
export interface ServiceActor {
  kind: "service";
  tokenName: string;
  /** From `X-Baumy-Actor: tg:<id>`. */
  telegramUserId?: number;
  memberId?: string;
  /**
   * The linked member's role, read with the Telegram mapping on every call.
   * Only set when brain acts in that member's own name (never on someone's
   * behalf): `requireAdmin` lets a linked admin run the admin actions
   * offered to brain (issue #107).
   */
  role?: MemberRole;
  /**
   * Set only for `X-Baumy-On-Behalf-Of` (issue #70): the linked member who
   * asked, while `memberId` is the housemate the action is done for.
   * `runAction` records it on the audit row as `initiated_by_member_id`.
   */
  initiatorMemberId?: string;
}

/** An MCP access token, issued to one member with the scopes they ticked. */
export interface McpActor {
  kind: "mcp";
  memberId: string;
  scopes: string[];
}

export type Actor = MemberActor | KioskActor | ServiceActor | McpActor;

/**
 * The actor for the current request, or null when nobody is signed in.
 *
 * A Better Auth session comes first. It is read only when auth may serve on
 * this deployment (`authMayServe`): a Vercel deployment without
 * BETTER_AUTH_SECRET fails closed rather than trust a cookie signed with the
 * public placeholder. The session's user is then matched to its active
 * `members` row. Without a session, a paired kiosk cookie makes a kiosk
 * actor. A THROW (the database is down) propagates to the error page rather
 * than quietly showing everyone as signed out.
 *
 * `cache()` scopes the result to one request, so the layout, the page and a
 * route helper share one read, and React discards it when the request ends.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  if (authMayServe(process.env)) {
    const session = await getAuth().api.getSession({
      headers: await headers(),
    });
    if (session) {
      const member = await findActiveMemberByAuthUserId(session.user.id);
      return {
        kind: "member",
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        emailVerified: session.user.emailVerified,
        sessionCreatedAt: new Date(session.session.createdAt).toISOString(),
        sessionId: session.session.id,
        ...(member
          ? {
              memberId: member.id,
              role: member.role,
              displayName: member.displayName,
              avatar: member.avatar,
            }
          : {}),
      };
    }
  }
  return getKioskActor();
});

/**
 * The kiosk device this browser is paired as, or null. The kiosk's own pages
 * and server actions use this, not getActor, so a person signed in on the
 * iPad's browser does not turn the kiosk into their phone.
 *
 * The token is looked up by its sha256; a revoked device is not found. The
 * picked member counts only while they are an active member of the device's
 * household. `last_seen_at` is refreshed at most every 5 minutes, and a
 * failure to write it never fails the request.
 */
export const getKioskActor = cache(async (): Promise<KioskActor | null> => {
  const jar = await cookies();
  const token = jar.get(KIOSK_COOKIE)?.value;
  if (!token || token.length > KIOSK_TOKEN_MAX_LENGTH) return null;
  const device = await findPairedKioskDevice(hashKioskToken(token));
  if (!device) return null;
  try {
    await touchKioskDevice(device, now());
  } catch (err) {
    console.error("[kiosk] could not record last_seen_at", err);
  }
  const picked = jar.get(KIOSK_MEMBER_COOKIE)?.value;
  const member = isMemberId(picked)
    ? await findActiveMember(
        createHttpDb() as unknown as Queryable,
        device.householdId,
        picked,
      )
    : null;
  return {
    kind: "kiosk",
    deviceId: device.id,
    deviceName: device.name,
    ...(member ? { memberId: member.id, displayName: member.displayName } : {}),
  };
});

/** For pages that need someone signed in: the actor, or off to sign-in. */
export async function getActorOrRedirect(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/auth/sign-in");
  return actor;
}

/**
 * For the sign-in and sign-up pages: a person already signed in goes home, or
 * to `to` (a path already checked by `safeCallbackUrl`). A paired kiosk is
 * not a person, so someone may still sign in on its browser.
 */
export async function redirectIfSignedIn(to = "/"): Promise<void> {
  if ((await getActor())?.kind === "member") redirect(to as "/");
}
