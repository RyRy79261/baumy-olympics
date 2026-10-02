// "Confirm it's you" with a passkey (issue #135, ADR 0007): the one piece of
// the step-up gate that lives inside Better Auth.
//
// The browser runs the ceremony Better Auth's passkey plugin already serves:
// GET /passkey/generate-authenticate-options (signed in, it lists only this
// account's passkeys, stores the challenge in a `verification` row and puts
// its key in the signed `baumy.passkey_challenge` cookie), then
// navigator.credentials.get(). The plugin's own /passkey/verify-authentication
// would then make a NEW session, a sign-in; a step-up must not. So the
// assertion goes to the web app's `confirm_identity` action instead, which
// calls this endpoint: the same checks as the plugin's verify (the challenge
// consumed once, the origin, the rp id, the signature and the counter, by
// the same @simplewebauthn/server call) plus two of its own, the challenge
// was made for THIS session's user and the passkey is theirs, and no session.
//
// It is SERVER_ONLY, like approvalSignIn: Better Auth's router does not mount
// it, and it refuses any call that carries a request.

import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import * as z from "zod";
import { SECURITY_COOKIES, type PasskeyScope } from "./env";

export const STEP_UP_PASSKEY_PATH = "/step-up/passkey";

/** What every refusal says: which check failed is for the server log only. */
export const PASSKEY_NOT_CONFIRMED =
  "That passkey didn't confirm it's you. Try again, or use another way.";

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

const refuse = () =>
  new APIError("UNAUTHORIZED", {
    code: "STEP_UP_FAILED",
    message: PASSKEY_NOT_CONFIRMED,
  });

/**
 * `scope` is resolvePasskeyScope's answer for this deployment; null means
 * passkeys are off, and then every call is refused.
 */
export function stepUpPasskey(scope: PasskeyScope | null) {
  return {
    id: "baumy-step-up",
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
    },
  } satisfies BetterAuthPlugin;
}
