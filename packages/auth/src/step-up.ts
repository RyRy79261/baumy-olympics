// "Confirm it's you" (issue #135, ADR 0007): the pieces of the step-up gate
// that live inside Better Auth. The window itself is a `step_ups` row keyed
// by the session (@baumy/db/step-ups); the web app's `requireRecentAuth`
// reads it before its own sensitive actions.
//
// 1. A REAL sign-in opens a window (`grants`, an after-hook): the password
//    (and sign-up), Google's callback, a passkey sign-in, the sign-in code
//    step (only when no session came with it) and "Sign in with Baumy". A
//    session's age never counts: Better Auth makes NEW sessions on paths that
//    prove nothing (turning two-factor on or off swaps in a session with a
//    fresh `createdAt`), so age alone was a bypass (critic, PR #139).
// 2. Better Auth's own security endpoints need an open window (`guards`, a
//    before-hook): registering a passkey, turning two-factor on or off, new
//    backup codes, reading the TOTP secret, and the code checks when a
//    session is present (that is the enrolment step, which swaps the
//    session). Otherwise a stolen session could add its own passkey, or turn
//    two-factor off, without proving anything.
// 3. Two SERVER_ONLY checks for `confirm_identity`, which make no session:
//    - a passkey assertion. The plugin's own /passkey/verify-authentication
//      makes a NEW session (a sign-in); this runs the same checks with the
//      same @simplewebauthn/server call, on the challenge the plugin issued
//      (GET /passkey/generate-authenticate-options, signed in: only this
//      account's passkeys), plus two of its own: the challenge was made for
//      THIS session's user, and the passkey is theirs;
//    - a two-factor code. It returns the time step the code matched, which
//      the action claims once (no replay within the code's window).
//    Better Auth's router does not mount them, and they refuse any call
//    that carries a request, as approvalSignIn does.

import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { timingSafeEqual } from "node:crypto";
import * as z from "zod";
import { createHttpDb, type Queryable } from "@baumy/db";
import {
  findStepUp,
  grantStepUpIfLive,
  type StepUpGrant,
} from "@baumy/db/step-ups";
import { APPROVAL_SIGN_IN_PATH } from "./approval-sign-in";
import { SECURITY_COOKIES, type PasskeyScope } from "./env";

export const STEP_UP_PASSKEY_PATH = "/step-up/passkey";
export const STEP_UP_TOTP_PATH = "/step-up/totp";

/** What a passkey refusal says: which check failed is for the log only. */
export const PASSKEY_NOT_CONFIRMED =
  "That passkey didn't confirm it's you. Try again, or use another way.";

/** What a code refusal says. */
export const CODE_NOT_CONFIRMED =
  "That code didn't match. Check your app and try again.";

/** What a guarded Better Auth endpoint answers without an open window. */
export const STEP_UP_REQUIRED =
  "Confirm it's you first. Then do this within 10 minutes.";

/** The TOTP the twoFactor plugin issues: 6 digits, 30-second steps. */
const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;

/**
 * Sign-ins that open a window, and what to call the proof. A two-factor
 * code step counts only when no session came with the request: with one, it
 * is an enrolment (guarded below), not a sign-in.
 */
export const SIGN_IN_GRANTS: Readonly<Record<string, StepUpGrant>> = {
  "/sign-in/email": "password",
  "/sign-up/email": "password",
  "/callback/:id": "google",
  "/passkey/verify-authentication": "passkey",
  "/two-factor/verify-totp": "totp",
  "/two-factor/verify-backup-code": "backup_code",
  [APPROVAL_SIGN_IN_PATH]: "baumy",
};

const SECOND_STEP = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

/** Better Auth endpoints that need an open window whenever signed in. */
export const STEP_UP_GUARDED_PATHS: ReadonlySet<string> = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  // With a session these are the enrolment step (they swap the session);
  // without one, the sign-in code step, which the guard lets through.
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
]);

interface PasskeyRow {
  id: string;
  userId: string;
  credentialID: string;
  publicKey: string;
  counter: number;
  transports?: string | null;
}

/** What the passkey plugin stores for a challenge it issued. */
const Challenge = z.object({
  type: z.literal("authentication"),
  expectedChallenge: z.string().min(1),
  userData: z.object({ id: z.string() }),
});

const refuse = (message = PASSKEY_NOT_CONFIRMED) =>
  new APIError("UNAUTHORIZED", { code: "STEP_UP_FAILED", message });

/** Where the hooks read and write the windows. */
export interface StepUpStore {
  /** Whether the session's window is open at `now`. */
  isOpen(input: {
    sessionId: string;
    userId: string;
    now: Date;
  }): Promise<boolean>;
  /** Open the session's window, if the session still exists. */
  grantIfLive(input: {
    sessionId: string;
    userId: string;
    method: StepUpGrant;
    now: Date;
  }): Promise<boolean>;
}

/** The real store: `step_ups` in our database (PGlite in the tests). */
export const databaseStepUpStore: StepUpStore = {
  isOpen: async (input) =>
    (await findStepUp(createHttpDb() as unknown as Queryable, input)) !== null,
  grantIfLive: (input) =>
    grantStepUpIfLive(createHttpDb() as unknown as Queryable, input),
};

/** The TOTP code of `secret` at time step `step`. */
function codeAt(secret: string, step: number): Promise<string> {
  return createOTP(secret, {
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_S,
  }).hotp(step);
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * `scope` is resolvePasskeyScope's answer for this deployment; null means
 * passkeys are off, and then every passkey check is refused.
 */
export function stepUp(
  scope: PasskeyScope | null,
  store: StepUpStore = databaseStepUpStore,
) {
  return {
    id: "baumy-step-up",
    hooks: {
      before: [
        {
          matcher: (ctx) => STEP_UP_GUARDED_PATHS.has(String(ctx.path)),
          handler: createAuthMiddleware(async (ctx) => {
            // No session: the endpoint answers for itself (401, or the
            // sign-in code step, which needs no window).
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const open = await store.isOpen({
              sessionId: session.session.id,
              userId: session.user.id,
              now: new Date(),
            });
            if (open) return;
            throw new APIError("FORBIDDEN", {
              code: "STEP_UP_REQUIRED",
              message: STEP_UP_REQUIRED,
            });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => Object.hasOwn(SIGN_IN_GRANTS, String(ctx.path)),
          handler: createAuthMiddleware(async (ctx) => {
            const made = ctx.context.newSession;
            if (!made) return;
            const path = String(ctx.path);
            if (path === "/callback/:id" && ctx.params?.id !== "google") return;
            if (SECOND_STEP.has(path)) {
              // The sign-in's code step carries the challenge cookie a
              // correct password set; the enrolment step (a session, no
              // challenge) is not a sign-in.
              const challenge = await ctx.getSignedCookie(
                ctx.context.createAuthCookie(
                  SECURITY_COOKIES.twoFactorChallenge,
                ).name,
                ctx.context.secret,
              );
              if (!challenge) return;
            }
            // A password sign-in that two-factor turned into a code step has
            // already deleted the session it made: nothing to open then.
            await store.grantIfLive({
              sessionId: made.session.id,
              userId: made.user.id,
              method: SIGN_IN_GRANTS[path]!,
              now: new Date(),
            });
          }),
        },
      ],
    },
    endpoints: {
      verifyStepUpPasskey: createAuthEndpoint(
        STEP_UP_PASSKEY_PATH,
        {
          method: "POST",
          body: z.object({ response: z.looseObject({ id: z.string() }) }),
          use: [sessionMiddleware],
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          if (ctx.request) throw new APIError("NOT_FOUND");
          if (scope === null) throw refuse();
          const userId = ctx.context.session.user.id;
          const response = ctx.body
            .response as unknown as AuthenticationResponseJSON;

          // The challenge: made for this account, used once whatever happens.
          const cookie = ctx.context.createAuthCookie(
            SECURITY_COOKIES.passkeyChallenge,
          );
          const key = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret,
          );
          if (!key) throw refuse();
          const stored =
            await ctx.context.internalAdapter.consumeVerificationValue(key);
          if (!stored) throw refuse();
          // An authentication challenge, made while THIS account was signed
          // in (a registration challenge, or another account's, is refused).
          const challenge = Challenge.safeParse(
            JSON.parse(stored.value) as unknown,
          );
          if (!challenge.success || challenge.data.userData.id !== userId) {
            throw refuse();
          }

          // The passkey: one of this account's own.
          const passkey = await ctx.context.adapter.findOne<PasskeyRow>({
            model: "passkey",
            where: [
              { field: "credentialID", value: response.id },
              { field: "userId", value: userId },
            ],
          });
          if (!passkey) throw refuse();

          const origin = scope.origin?.length
            ? scope.origin
            : ctx.headers?.get("origin");
          if (!origin) throw refuse();
          // resolvePasskeyScope leaves the rp id out only when there is no
          // base URL, where the passkey plugin uses "localhost" too.
          const rpID = scope.rpID ?? "localhost";
          let verified: Awaited<
            ReturnType<typeof verifyAuthenticationResponse>
          >;
          try {
            verified = await verifyAuthenticationResponse({
              response,
              expectedChallenge: challenge.data.expectedChallenge,
              expectedOrigin: origin,
              expectedRPID: rpID,
              credential: {
                id: passkey.credentialID,
                publicKey: new Uint8Array(
                  Buffer.from(passkey.publicKey, "base64"),
                ),
                counter: passkey.counter,
                transports: passkey.transports?.split(",") as never,
              },
              // As Better Auth's own passkey sign-in: a passkey that signs
              // in may also confirm.
              requireUserVerification: false,
            });
          } catch (err) {
            ctx.context.logger.info("[step-up] passkey refused", err);
            throw refuse();
          }
          if (!verified.verified) throw refuse();
          await ctx.context.adapter.update({
            model: "passkey",
            where: [{ field: "id", value: passkey.id }],
            update: { counter: verified.authenticationInfo.newCounter },
          });
          return ctx.json({ passkeyId: passkey.id });
        },
      ),
      verifyStepUpTotp: createAuthEndpoint(
        STEP_UP_TOTP_PATH,
        {
          method: "POST",
          body: z.object({ code: z.string().regex(/^\d{6}$/) }),
          use: [sessionMiddleware],
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          if (ctx.request) throw new APIError("NOT_FOUND");
          const user = ctx.context.session.user as { id: string } & Record<
            string,
            unknown
          >;
          const row = await ctx.context.adapter.findOne<{
            secret: string;
            verified?: boolean | null;
          }>({
            model: "twoFactor",
            where: [{ field: "userId", value: user.id }],
          });
          // Only a finished enrolment proves anything.
          if (!row || row.verified === false) {
            throw refuse(CODE_NOT_CONFIRMED);
          }
          const secret = await symmetricDecrypt({
            key: ctx.context.secretConfig,
            data: row.secret,
          });
          // The same window as Better Auth's own check: this step and one
          // either side.
          const now = Math.floor(Date.now() / (TOTP_PERIOD_S * 1000));
          for (const step of [now, now - 1, now + 1]) {
            if (sameCode(ctx.body.code, await codeAt(secret, step))) {
              return ctx.json({ step });
            }
          }
          throw refuse(CODE_NOT_CONFIRMED);
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
