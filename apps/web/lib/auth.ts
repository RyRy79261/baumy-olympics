import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authMayServe, getAuth } from "@baumy/auth";

// Who is making this request (ADR 0001, SPEC §6.2). Ported from camp-404
// `apps/web/lib/auth.ts`, reshaped around one `Actor` type.
//
// Only the `member` kind exists today: a Better Auth session, from the
// `baumy.session_token` cookie or from `Authorization: Bearer <token>` (the
// bearer plugin turns the header into the same session). The kiosk, service
// and MCP kinds arrive with their own credentials (kiosk devices, brain service
// tokens, MCP OAuth). Deciding what an actor may DO is not this file's job:
// that is `runAction` and its gates, which land with the action registry.

export type ActorKind = "member" | "kiosk" | "service" | "mcp";

/** A person signed in with their own Better Auth session. */
export interface MemberActor {
  kind: "member";
  /** Better Auth's `user.id`, which `members.auth_user_id` holds. */
  userId: string;
  email: string;
  name: string;
  /**
   * The `members` row, once the membership gate (issue #9) resolves it. Until
   * then a session is only proof of an account, not of a housemate.
   */
  memberId?: string;
}

/** Filled in by the kiosk, brain and MCP issues. */
export interface PendingActor {
  kind: Exclude<ActorKind, "member">;
  memberId?: string;
}

export type Actor = MemberActor | PendingActor;

/**
 * The actor for the current request, or null when nobody is signed in.
 *
 * Returns null without reading anything when auth may not serve on this
 * deployment (`authMayServe`): a Vercel deployment without BETTER_AUTH_SECRET
 * fails closed rather than trust a cookie signed with the public placeholder.
 * A THROW (the database is down) propagates to the error page rather than
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
  return {
    kind: "member",
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
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
