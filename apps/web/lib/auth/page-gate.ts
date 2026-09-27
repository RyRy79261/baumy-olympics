import "server-only";

import { notFound, redirect } from "next/navigation";
import {
  getActor,
  type Actor,
  type MemberActor,
  type MemberRole,
} from "./actor";

// The gate ladder for PAGES (SPEC §6.2). Actions have their own gates
// (gates.ts, run by runAction); a page only decides what the visitor may SEE:
//
//   nobody signed in           → /auth/sign-in
//   not a person's own session → 404 (the kiosk, MCP and brain never get the
//                                hub's pages)
//   an account, no member row  → /join (redeem an invite code)
//   a member, on an admin page → 404
//   otherwise                  → the page
//
// `/join` itself runs the ladder the other way: a member there goes home.

export type PageNeed = "member" | "admin" | "joining";

export type PageVerdict =
  | { kind: "ok" }
  | { kind: "redirect"; to: "/auth/sign-in" | "/join" | "/" }
  | { kind: "not_found" };

/** Pure: what a page that needs `need` does with this actor. */
export function pageGate(actor: Actor | null, need: PageNeed): PageVerdict {
  if (!actor) return { kind: "redirect", to: "/auth/sign-in" };
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

async function enforce(need: PageNeed): Promise<MemberActor> {
  const actor = await getActor();
  const verdict = pageGate(actor, need);
  if (verdict.kind === "redirect") redirect(verdict.to);
  if (verdict.kind === "not_found") notFound();
  return actor as MemberActor;
}

/** For hub pages: the member, or off to sign-in or /join. */
export async function requireMemberPage(): Promise<PageMember> {
  return (await enforce("member")) as PageMember;
}

/** For /admin/*: an admin; anyone else gets a 404. */
export async function requireAdminPage(): Promise<PageMember> {
  return (await enforce("admin")) as PageMember;
}

/** For /join: a signed-in account with no member row yet. */
export async function requireJoiningPage(): Promise<MemberActor> {
  return enforce("joining");
}
