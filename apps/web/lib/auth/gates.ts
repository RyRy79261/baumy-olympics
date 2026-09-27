import type { Surface } from "@baumy/types";
import type { ActionKind, Gate, RequestCtx } from "@/lib/actions/define";
import { fail, type ActionFailure } from "@/lib/actions/result";
import type { PinVerifier } from "./pin";

// Authorization for actions: ONE function per concern (AGENTS.md
// "Authorization", SPEC §6.2). Only `runAction` calls these, through
// `runGate`; nothing hand-rolls a check at a call site.
//
// Kiosk actors never pass `requireSession` or `requireAdmin`. Every gate but
// `requireService` also needs an active household member behind the actor.

export type GateResult = { ok: true } | ActionFailure;

/** What a gate may know about the action it guards. */
export interface GatedAction {
  kind: ActionKind;
  surfaces: readonly Surface[];
}

const OK: GateResult = { ok: true };

/** The MCP scope a token needs for each kind of action (SPEC §6.3). */
export const MCP_SCOPE: Record<ActionKind, string> = {
  read: "baumy:read",
  write: "baumy:write",
};

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

/** An admin, signed in with a real session. */
export function requireAdmin(ctx: RequestCtx): GateResult {
  const session = requireSession(ctx);
  if (!session.ok) return session;
  if (ctx.actor.kind !== "member" || ctx.actor.role !== "admin") {
    return fail("FORBIDDEN", "Only a household admin can do this.");
  }
  return OK;
}

/**
 * The member vouches for this request themself. A session, MCP token or brain
 * actor IS that member, so it passes as a member. The kiosk is shared, so it
 * must send the acting member's PIN, which is verified now and never stored.
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
  const ok = await verifyPin({
    deviceId: actor.deviceId,
    // requireMember has checked it is set.
    memberId: actor.memberId!,
    pin: ctx.pin,
    now: ctx.now,
  });
  return ok ? OK : fail("ATTESTATION_FAILED", "That PIN is not right.");
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
    case "session":
      return requireSession(ctx);
    case "account":
      return requireAccount(ctx);
    case "admin":
      return requireAdmin(ctx);
    case "attested":
      return requireAttested(ctx, action, verifyPin);
    case "service":
      return requireService(ctx);
  }
}
