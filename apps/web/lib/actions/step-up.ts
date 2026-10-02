import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isGoogleConfigured, resolvePasskeyScope } from "@baumy/auth/env";
import { signInMethods } from "@baumy/db/account-security";
import {
  claimApprovedStepUpRequest,
  findStepUpRequest,
  insertStepUpRequest,
  isLoginLocked,
  type LoginRequestState,
} from "@baumy/db/login-requests";
import { members, session } from "@baumy/db/schema";
import {
  claimTotpStep,
  grantStepUp,
  hasVerifiedTotp,
  type StepUpMethod,
} from "@baumy/db/step-ups";
import { LoginRequestId } from "@baumy/types";
import type { MemberActor } from "@/lib/auth";
import { recentAuthUntil } from "@/lib/auth/recent-auth";
import {
  verifyPasskeyStepUp,
  verifyPasswordStepUp,
  verifyTotpStepUp,
} from "@/lib/auth/step-up-verify";
import { brainClient } from "@/lib/integrations/brain";
import { pickLoginCodes } from "@/lib/login-approval/codes";
import { deviceLabel } from "@/lib/login-approval/device";
import { signInWithBaumyEnabled } from "@/lib/login-approval/flag";
import { liveActor, isFailure } from "./account-security";
import { defineAction, type ActionCtx } from "./define";
import { fail } from "./result";

// "Confirm it's you" (issue #135, ADR 0007), like GitHub's sudo mode. A
// sensitive change answers REAUTH_REQUIRED (`requireRecentAuth`); the page
// then opens one dialog that offers every method this member has, and a
// success opens a 10-minute sudo window for THIS session (`step_ups`), so the
// next sensitive change in it is not asked again.
//
// - get_step_up: the window, and the methods to offer.
// - confirm_identity: one proof (a passkey assertion, a two-factor code, an
//   approved Telegram tap or the password), checked by Better Auth, then the
//   window. The audit row is the step-up itself; the proof never reaches the
//   ledger or the audit (the fingerprint keeps only the method).
// - request_baumy_confirmation / get_baumy_confirmation: "Sign in with Baumy"
//   for a session that is already signed in: brain DMs the member the number
//   on the screen, and the tap (`approve_login`) approves a request bound to
//   this session, which confirm_identity then uses once. No session is made.
//
// All four need the member's own session: never the kiosk, MCP or brain.

/** What the dialog may offer. `google` is a fresh Google sign-in. */
export type StepUpOption = StepUpMethod | "google";

export interface StepUpView {
  /** When this session's window closes, ISO 8601; null when it is shut. */
  until: string | null;
  /** The member's methods, in the order the dialog offers them. */
  methods: StepUpOption[];
}

export interface StepUpGranted {
  method: StepUpMethod;
  /** When the window closes, ISO 8601. */
  until: string;
}

export interface BaumyConfirmation {
  /** The request to poll and then to confirm with. */
  approvalId: string;
  /** The number on the screen; the DM shows it among four decoys. */
  code: number;
  expiresAt: string;
}

const NO_SESSION = fail(
  "FORBIDDEN",
  "Sign in on your own device to confirm it's you.",
);

/** The member's own session; the session gate has checked the kind. */
function sessionOf(
  ctx: ActionCtx,
): (MemberActor & { sessionId: string }) | null {
  const actor = ctx.actor;
  if (actor.kind !== "member" || !actor.sessionId || !actor.memberId) {
    return null;
  }
  return actor as MemberActor & { sessionId: string };
}

async function telegramOf(ctx: ActionCtx, memberId: string) {
  const [row] = await ctx.db
    .select({ telegramUserId: members.telegramUserId })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.telegramUserId ?? null;
}

/** Whether "Sign in with Baumy" can confirm this member now. */
async function baumyAvailable(
  ctx: ActionCtx,
  memberId: string,
): Promise<boolean> {
  if (!signInWithBaumyEnabled(process.env)) return false;
  if ((await telegramOf(ctx, memberId)) === null) return false;
  return !(await isLoginLocked(ctx.db, memberId, ctx.now));
}

export const getStepUp = defineAction({
  name: "get_step_up",
  title: "See how I can confirm it's me",
  description:
    "Shows whether this session confirmed it is the signed-in member in the last 10 minutes, and the ways they can confirm it: a passkey, a two-factor code, a 'Sign in with Baumy' tap, the password or Google.",
  consent: "See how you can confirm it's you",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    const actor = sessionOf(ctx);
    if (!actor) return NO_SESSION;
    const [until, ways, totp, baumy] = await Promise.all([
      recentAuthUntil(ctx),
      signInMethods(ctx.db, actor.userId),
      hasVerifiedTotp(ctx.db, actor.userId),
      baumyAvailable(ctx, actor.memberId!),
    ]);
    const methods: StepUpOption[] = [];
    if (ways.passkeys > 0 && resolvePasskeyScope(process.env) !== null) {
      methods.push("passkey");
    }
    if (totp) methods.push("totp");
    if (baumy) methods.push("baumy");
    if (ways.password) methods.push("password");
    if (ways.providers.includes("google") && isGoogleConfigured(process.env)) {
      methods.push("google");
    }
    const data: StepUpView = {
      until: until ? until.toISOString() : null,
      methods,
    };
    return { ok: true, data };
  },
});

const Proof = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("passkey"),
    response: z
      .record(z.string(), z.unknown())
      .describe("The browser's WebAuthn assertion."),
  }),
  z.strictObject({
    method: z.literal("totp"),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code from your app."),
  }),
  z.strictObject({
    method: z.literal("baumy"),
    approvalId: LoginRequestId.describe(
      "The request request_baumy_confirmation made, approved in Telegram.",
    ),
  }),
  z.strictObject({
    method: z.literal("password"),
    password: z.string().min(1, "Enter your password.").max(256),
  }),
]);

/** What each refused proof says. */
const REFUSED: Record<StepUpMethod, string> = {
  passkey:
    "That passkey didn't confirm it's you. Try again, or use another way.",
  totp: "That code didn't match, or was already used. Wait for the next one and try again.",
  baumy:
    "That Telegram request wasn't approved, or was already used. Start again.",
  password: "That password is not right.",
};

export const confirmIdentity = defineAction({
  name: "confirm_identity",
  title: "Confirm it's me",
  description:
    "Confirms the signed-in member is at this device with a passkey, a two-factor code, an approved 'Sign in with Baumy' tap or the password. This session may then make sensitive changes for 10 minutes without being asked again.",
  consent: "Confirm it's you",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  // Each attempt checks a secret; Better Auth does not count a signed-in
  // session's two-factor tries, so this budget is the one that does.
  rateLimit: { perMember: 10, perIp: 30, windowMs: 15 * 60_000 },
  // Only the method: never the password, the code or the assertion.
  fingerprint: (input) => ({ method: input.method }),
  input: Proof,
  async execute(ctx, proof) {
    const actor = sessionOf(ctx);
    if (!actor) return NO_SESSION;
    const { sessionId, userId } = actor;

    // ORDER MATTERS: the proof is checked BEFORE `liveActor` share-locks the
    // session row. Better Auth checks a password or a code on its own
    // connection and may refresh the session (an UPDATE of that row), which
    // would wait on our lock forever (service-tokens.ts, PR #105).
    let proven: boolean;
    switch (proof.method) {
      case "password":
        proven = await verifyPasswordStepUp(proof.password);
        break;
      case "totp": {
        // Only a finished enrolment, and each 30-second code once: a code
        // read over the member's shoulder cannot be typed again (issue #135).
        const step = (await hasVerifiedTotp(ctx.db, userId))
          ? await verifyTotpStepUp(proof.code)
          : null;
        proven =
          step !== null &&
          (await claimTotpStep(ctx.db, { userId, step, now: ctx.now }));
        break;
      }
      case "passkey":
        proven = await verifyPasskeyStepUp(proof.response);
        break;
      case "baumy":
        // Bound to this session and this member, used once, in this
        // transaction: a failure below puts it back.
        proven = await claimApprovedStepUpRequest(ctx.db, {
          id: proof.approvalId,
          sessionId,
          memberId: actor.memberId!,
          now: ctx.now,
        });
        break;
    }
    if (!proven) return fail("STEP_UP_FAILED", REFUSED[proof.method]);

    const live = await liveActor(ctx);
    if (isFailure(live)) return live;
    const { expiresAt } = await grantStepUp(ctx.db, {
      sessionId,
      userId,
      method: proof.method,
      now: ctx.now,
    });
    const data: StepUpGranted = {
      method: proof.method,
      until: expiresAt.toISOString(),
    };
    return {
      ok: true,
      data,
      audit: { entity: "session", entityId: sessionId, payload: data },
    };
  },
});

export const requestBaumyConfirmation = defineAction({
  name: "request_baumy_confirmation",
  title: "Confirm it's me in Telegram",
  description:
    "Asks Baumy to DM the signed-in member's linked Telegram account: tap the number shown on this screen to confirm it's you. Approving it signs nobody in; it confirms this session.",
  consent: "Confirm it's you from Telegram",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  // Brain is called: no transaction is held across it.
  transactional: false,
  rateLimit: { perMember: 5, perIp: 20, windowMs: 10 * 60_000 },
  input: z.strictObject({}),
  async execute(ctx) {
    const actor = sessionOf(ctx);
    if (!actor) return NO_SESSION;
    const memberId = actor.memberId!;
    if (!signInWithBaumyEnabled(process.env)) {
      return fail(
        "NOT_CONFIGURED",
        "Sign in with Baumy is switched off here. Use another way.",
      );
    }
    const telegramUserId = await telegramOf(ctx, memberId);
    if (telegramUserId === null) {
      return fail(
        "TELEGRAM_NOT_LINKED",
        "Link your Telegram account in Settings first, or use another way.",
      );
    }
    if (await isLoginLocked(ctx.db, memberId, ctx.now)) {
      return fail(
        "FORBIDDEN",
        "You turned a Baumy request down in the last 15 minutes, so this way is off for now. Use another way.",
      );
    }
    const [row] = await ctx.db
      .select({ userAgent: session.userAgent })
      .from(session)
      .where(
        and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)),
      );
    if (!row) return fail("UNAUTHENTICATED", "This device was signed out.");
    const device = deviceLabel(row.userAgent);
    const { code, choices } = pickLoginCodes((min, max) => randomInt(min, max));
    const request = await insertStepUpRequest(ctx.db, {
      memberId,
      sessionId: actor.sessionId,
      code,
      choices,
      device,
      now: ctx.now,
    });
    const sent = await brainClient().requestLoginApproval({
      requestId: request.id,
      telegramUserId,
      device,
      choices,
      expiresAt: request.expiresAt.toISOString(),
      purpose: "step_up",
    });
    if (!sent.ok || !sent.data.sent) {
      // The request expires by itself in 2 minutes.
      return fail(
        "UNAVAILABLE",
        "Baumy couldn't reach your Telegram just now. Use another way, or try again.",
      );
    }
    const data: BaumyConfirmation = {
      approvalId: request.id,
      code,
      expiresAt: request.expiresAt.toISOString(),
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "login_request",
        entityId: request.id,
        payload: { purpose: "step_up", device },
      },
    };
  },
});

export const getBaumyConfirmation = defineAction({
  name: "get_baumy_confirmation",
  title: "See my Telegram confirmation",
  description:
    "Shows whether the member has tapped the number of a 'Confirm it's you' request this session made: pending, approved, denied, expired or used.",
  consent: "See whether you confirmed it's you in Telegram",
  kind: "read",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: z.strictObject({ approvalId: LoginRequestId }),
  async execute(ctx, { approvalId }) {
    const actor = sessionOf(ctx);
    if (!actor) return NO_SESSION;
    const state = await findStepUpRequest(ctx.db, {
      id: approvalId,
      sessionId: actor.sessionId,
      now: ctx.now,
    });
    // Another session's request reads as gone.
    const data: { status: LoginRequestState } = {
      status: state ?? "expired",
    };
    return { ok: true, data };
  },
});
