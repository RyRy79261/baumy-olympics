import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authMayServe, getAuth } from "@baumy/auth";
import { findActiveMemberByAuthUserId } from "@baumy/db/members";

// Who is making this request (ADR 0001, SPEC §6.2). Ported from camp-404
// `apps/web/lib/auth.ts`, reshaped around one `Actor` type.
//
// Only the `member` kind is resolved from a request today: a Better Auth
// session, from the `baumy.session_token` cookie or from `Authorization:
// Bearer <token>` (the bearer plugin turns the header into the same session).
// The kiosk, service and MCP kinds are declared here so the gates
// (lib/auth/gates.ts) already handle them; their credentials arrive with
// their own issues (kiosk devices #10, MCP OAuth #23, brain tokens #27).
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
  /**
   * The active `members` row linked to this account, if there is one. A
   * session without one is only proof of an account, not of a housemate, and
   * every action gate refuses it (joining is issue #9).
   */
  memberId?: string;
  role?: MemberRole;
}

/** A paired kiosk device; `memberId` is the avatar tapped on it, if any. */
export interface KioskActor {
  kind: "kiosk";
  deviceId: string;
  memberId?: string;
}

/** A service token (baumy-brain); `memberId` is the Telegram-linked member. */
export interface ServiceActor {
  kind: "service";
  tokenName: string;
  memberId?: string;
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
 * Returns null without reading anything when auth may not serve on this
 * deployment (`authMayServe`): a Vercel deployment without BETTER_AUTH_SECRET
 * fails closed rather than trust a cookie signed with the public placeholder.
 * The session's user is then matched to its active `members` row. A THROW
 * (the database is down) propagates to the error page rather than
 * quietly showing everyone as signed out.
 *
 * `cache()` scopes the result to one request, so the layout, the page and a
 * route helper share one read, and React discards it when the request ends.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  if (!authMayServe(process.env)) return null;
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });
  if (!session) return null;
  const member = await findActiveMemberByAuthUserId(session.user.id);
  return {
    kind: "member",
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    ...(member ? { memberId: member.id, role: member.role } : {}),
  };
});

/** For pages that need someone signed in: the actor, or off to sign-in. */
export async function getActorOrRedirect(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/auth/sign-in");
  return actor;
}

/** For the sign-in and sign-up pages: someone already signed in goes home. */
export async function redirectIfSignedIn(): Promise<void> {
  if (await getActor()) redirect("/");
}
