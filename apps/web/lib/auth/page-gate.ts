import "server-only";

import { notFound, redirect } from "next/navigation";
import { signInUrl } from "./callback-url";
import {
  getActor,
  type Actor,
  type MemberActor,
  type MemberRole,
} from "./actor";

// The gate ladder for PAGES (SPEC §6.2). Actions have their own gates
// (gates.ts, run by runAction); a page only decides what the visitor may SEE:
//
//   nobody signed in           → /auth/sign-in (on `/`, the public landing
//                                page instead: issue #96)
//   a paired kiosk             → /kiosk (its own shell), or 404 on admin
//                                pages
//   not a person's own session → 404 (MCP and brain never get the hub's
//                                pages)
//   an account, no member row  → /join (redeem an invite code)
//   a member, on an admin page → 404
//   otherwise                  → the page
//
// `/join` itself runs the ladder the other way: a member there goes home.

export type PageNeed = "member" | "admin" | "joining" | "home";

export type PageVerdict =
  | { kind: "ok" }
  | { kind: "redirect"; to: "/auth/sign-in" | "/join" | "/" | "/kiosk" }
  | { kind: "not_found" }
  | { kind: "public" };

/** Pure: what a page that needs `need` does with this actor. */
export function pageGate(actor: Actor | null, need: PageNeed): PageVerdict {
  if (!actor) {
    // Google's branding check (and anyone else) must read what the app is at
    // `/` without signing in, so home shows the landing page, not a 302.
    return need === "home"
      ? { kind: "public" }
      : { kind: "redirect", to: "/auth/sign-in" };
  }
  if (actor.kind === "kiosk") {
    return need === "admin"
      ? { kind: "not_found" }
      : { kind: "redirect", to: "/kiosk" };
  }
  if (actor.kind !== "member") return { kind: "not_found" };
  if (need === "joining") {
    return actor.memberId ? { kind: "redirect", to: "/" } : { kind: "ok" };
  }
  if (!actor.memberId) return { kind: "redirect", to: "/join" };
  if (need === "admin" && actor.role !== "admin") return { kind: "not_found" };
  return { kind: "ok" };
}

/** A signed-in household member, as a page sees them. */
export type PageMember = MemberActor & {
  memberId: string;
  role: MemberRole;
  displayName: string;
};

async function enforce(
  need: PageNeed,
  returnTo?: string,
): Promise<MemberActor | null> {
  const actor = await getActor();
  const verdict = pageGate(actor, need);
  if (verdict.kind === "public") return null;
  if (verdict.kind === "redirect") {
    // Only sign-in comes back: a page reached from outside (the MCP consent
    // page) returns there once the person has signed in.
    redirect(
      (verdict.to === "/auth/sign-in"
        ? signInUrl(returnTo)
        : verdict.to) as "/auth/sign-in",
    );
  }
  if (verdict.kind === "not_found") notFound();
  return actor as MemberActor;
}

/**
 * For hub pages: the member, or off to sign-in or /join. `returnTo` (a path
 * on this site) is where sign-in sends the person back to.
 */
export async function requireMemberPage(
  opts: { returnTo?: string } = {},
): Promise<PageMember> {
  return (await enforce("member", opts.returnTo)) as PageMember;
}

/**
 * For `/` and the hub's frame: the member, or null when nobody is signed in
 * (the public landing page, issue #96). Everyone else is sent where the
 * member ladder sends them: an account with no member row to /join, a kiosk
 * to /kiosk.
 */
export async function memberOrVisitorPage(): Promise<PageMember | null> {
  return (await enforce("home")) as PageMember | null;
}

/** For /admin/*: an admin; anyone else gets a 404. */
export async function requireAdminPage(): Promise<PageMember> {
  return (await enforce("admin")) as PageMember;
}

/** For /join: a signed-in account with no member row yet. */
export async function requireJoiningPage(): Promise<MemberActor> {
  return (await enforce("joining")) as MemberActor;
}
