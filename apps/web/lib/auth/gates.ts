import type { Surface } from "@baumy/types";
import type { ActionKind, Gate, RequestCtx } from "@/lib/actions/define";
import { fail, type ActionFailure } from "@/lib/actions/result";
import type { PinVerdict, PinVerifier } from "./pin";

// Authorization for actions: ONE function per concern (AGENTS.md
// "Authorization", SPEC §6.2). Only `runAction` calls these, through
// `runGate`; nothing hand-rolls a check at a call site.
//
// Kiosk and MCP actors never pass `requireSession` or `requireAdmin`. Every gate but
// `requireService` also needs an active household member behind the actor.

export type GateResult = { ok: true } | ActionFailure;

/** What a gate may know about the action it guards. */
export interface GatedAction {
  kind: ActionKind;
  surfaces: readonly Surface[];
}

const OK: GateResult = { ok: true };

/** The MCP scope a token needs for each kind of action (SPEC §6.3). */
export const MCP_SCOPE = {
  read: "baumy:read",
  write: "baumy:write",
} as const satisfies Record<ActionKind, string>;

const NOT_A_MEMBER = fail(
  "FORBIDDEN",
  "Only household members can do this. Ask a housemate for an invite code.",
);

/**
 * Any household member: a session, MCP or brain actor linked to a member, or
 * a kiosk actor with a member picked, but the kiosk only for actions offered
 * on the kiosk. MCP tokens also need the scope for the action's kind.
 */
export function requireMember(
  ctx: RequestCtx,
  action: GatedAction,
): GateResult {
  const { actor } = ctx;
  if (!actor.memberId) return NOT_A_MEMBER;
  if (actor.kind === "kiosk" && !action.surfaces.includes("kiosk")) {
    return fail("FORBIDDEN", "This can't be done on the kiosk.");
  }
  if (actor.kind === "mcp" && !actor.scopes.includes(MCP_SCOPE[action.kind])) {
    return fail(
      "FORBIDDEN",
      `This connection was not granted ${MCP_SCOPE[action.kind]}. Reconnect it to allow this.`,
    );
  }
  return OK;
}

/**
 * What the kitchen screen may show while nobody has tapped their avatar
 * (SPEC §3.1, §8): a READ offered on the kiosk, from a paired kiosk with no
 * member picked. Everyone else is held to `requireMember`. It never lets a
 * write through: those need a member to be done by, and runAction keys the
 * ledger and the audit row on one.
 */
export function requireDisplay(
  ctx: RequestCtx,
  action: GatedAction,
): GateResult {
  const { actor } = ctx;
  if (
    actor.kind === "kiosk" &&
    !actor.memberId &&
    action.kind === "read" &&
    action.surfaces.includes("kiosk")
  ) {
    return OK;
  }
  return requireMember(ctx, action);
}

/**
 * A real cookie or bearer session of a household member: never the kiosk, an
 * MCP token or brain.
 */
export function requireSession(ctx: RequestCtx): GateResult {
  const account = requireAccount(ctx);
  if (!account.ok) return account;
  if (!ctx.actor.memberId) return NOT_A_MEMBER;
  return OK;
}

/**
 * A real cookie or bearer session, member row or not: someone who has an
 * account and may be about to join. Only the joining actions use it; they
 * check membership themselves.
 */
export function requireAccount(ctx: RequestCtx): GateResult {
  return ctx.actor.kind === "member"
    ? OK
    : fail(
        "FORBIDDEN",
        "This can only be done signed in on your own phone or computer.",
      );
}

const ADMINS_ONLY = fail("FORBIDDEN", "Only a household admin can do this.");

const SESSION_ONLY = fail(
  "FORBIDDEN",
  "This can only be done signed in on your own phone or computer.",
);

/** Why brain may not make an admin change for someone else (issue #107). */
export const ADMIN_ON_BEHALF =
  "Admin changes can't be made on someone's behalf. Ask an admin to do it themself.";

/**
 * An admin, signed in with a real session; or brain speaking in a linked
 * admin's own name, never on someone's behalf (issue #107). Only the admin
 * actions offered on the brain surface get that far: the surface check runs
 * first. Never an MCP token.
 *
 * The kitchen screen (owner ruling 2026-10-02, issue #147, SPEC §12
 * decision 28): an admin
 * action offered on the `kiosk` surface (adding and editing bounties,
 * changing points) passes for a kiosk whose picked member is an admin AND
 * whose request carries that admin's PIN, checked as `requireAttested`
 * checks it. Every other admin action stays session-only, from the Baumy
 * sheet on the kiosk too.
 */
export async function requireAdmin(
  ctx: RequestCtx,
  action: GatedAction,
  verifyPin: PinVerifier,
): Promise<GateResult> {
  const { actor } = ctx;
  if (actor.kind === "kiosk") {
    if (!action.surfaces.includes("kiosk")) return SESSION_ONLY;
    if (!actor.memberId) return NOT_A_MEMBER;
    if (actor.role !== "admin") return ADMINS_ONLY;
    return requireAttested(ctx, action, verifyPin);
  }
  if (actor.kind === "service") {
    if (!actor.memberId) return NOT_A_MEMBER;
    if (actor.initiatorMemberId) return fail("FORBIDDEN", ADMIN_ON_BEHALF);
    return actor.role === "admin" ? OK : ADMINS_ONLY;
  }
  const session = requireSession(ctx);
  if (!session.ok) return session;
  if (actor.kind !== "member" || actor.role !== "admin") return ADMINS_ONLY;
  return OK;
}

/**
 * The member vouches for this request themself. A session, MCP token or brain
 * actor IS that member, so it passes as a member. The kiosk is shared, so it
 * must send the acting member's PIN, which is verified now and never stored
 * (lib/auth/pin.ts counts the attempt and may lock the PIN).
 */
export async function requireAttested(
  ctx: RequestCtx,
  action: GatedAction,
  verifyPin: PinVerifier,
): Promise<GateResult> {
  const member = requireMember(ctx, action);
  if (!member.ok) return member;
  const { actor } = ctx;
  if (actor.kind !== "kiosk") return OK;
  if (!ctx.pin) {
    return fail("ATTESTATION_REQUIRED", "Enter your PIN to do this.");
  }
  const verdict = await verifyPin({
    householdId: ctx.householdId,
    deviceId: actor.deviceId,
    // requireMember has checked it is set.
    memberId: actor.memberId!,
    pin: ctx.pin,
    now: ctx.now,
  });
  return verdict.ok ? OK : pinFailure(verdict);
}

const SET_A_NEW_PIN = "Set a new one in Settings on your phone.";

/** The sentence for each way a PIN attempt fails. */
function pinFailure(verdict: Exclude<PinVerdict, { ok: true }>): GateResult {
  switch (verdict.reason) {
    case "wrong":
      return fail("ATTESTATION_FAILED", "That PIN is not right.");
    case "no_pin":
      return fail(
        "PIN_NOT_SET",
        "You haven't set a personal PIN yet. Set one in Settings on your phone.",
      );
    case "locked":
      return fail(
        "PIN_LOCKED",
        verdict.justLocked
          ? `That PIN is not right, and after 10 wrong tries your kiosk PIN is now locked. ${SET_A_NEW_PIN}`
          : `Your kiosk PIN is locked after too many wrong tries. ${SET_A_NEW_PIN}`,
      );
    case "rate_limited": {
      const minutes = Math.max(
        1,
        Math.ceil((verdict.retryAfterSeconds ?? 60) / 60),
      );
      return fail(
        "RATE_LIMITED",
        `Too many wrong PINs. Wait ${minutes} min and try again.`,
        { retryAfterSeconds: verdict.retryAfterSeconds ?? 60 },
      );
    }
    case "unavailable":
      return fail(
        "ATTESTATION_FAILED",
        "The PIN could not be checked just now. Try again in a moment.",
      );
  }
}

/** A service token (baumy-brain), whoever it acts for. */
export function requireService(ctx: RequestCtx): GateResult {
  return ctx.actor.kind === "service"
    ? OK
    : fail("FORBIDDEN", "Only a connected service can do this.");
}

/** Run the named gate. The one place a `Gate` becomes a check. */
export async function runGate(
  gate: Gate,
  ctx: RequestCtx,
  action: GatedAction,
  verifyPin: PinVerifier,
): Promise<GateResult> {
  switch (gate) {
    case "member":
      return requireMember(ctx, action);
    case "display":
      return requireDisplay(ctx, action);
    case "session":
      return requireSession(ctx);
    case "account":
      return requireAccount(ctx);
    case "admin":
      return requireAdmin(ctx, action, verifyPin);
    case "attested":
      return requireAttested(ctx, action, verifyPin);
    case "service":
      return requireService(ctx);
  }
}
