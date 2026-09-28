// "Sign in with Baumy" (issue #80, ADR 0006): the one piece that lives inside
// Better Auth. The web app decides WHETHER someone may sign in (the member
// tapped the right number in Telegram, and this browser holds the request's
// secret: apps/web/lib/login-approval); this endpoint then makes the session
// exactly as Better Auth's own sign-ins do, with the signed session cookie,
// the cookie cache and the `set-auth-token` header.
//
// It is SERVER_ONLY: Better Auth's router does not mount it, so no request
// can reach it over HTTP. Only a server call, `auth.api.signInApproved`,
// runs it, and it refuses any call that carries a request as a second belt.

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

export const APPROVAL_SIGN_IN_PATH = "/sign-in/baumy-approval";

export function approvalSignIn() {
  return {
    id: "baumy-approval-sign-in",
    endpoints: {
      signInApproved: createAuthEndpoint(
        APPROVAL_SIGN_IN_PATH,
        {
          method: "POST",
          body: z.object({ userId: z.string().min(1).max(200) }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          if (ctx.request) throw new APIError("NOT_FOUND");
          const found = await ctx.context.internalAdapter.findUserById(
            ctx.body.userId,
          );
          if (!found) throw new APIError("UNAUTHORIZED");
          const session = await ctx.context.internalAdapter.createSession(
            found.id,
          );
          await setSessionCookie(ctx, { session, user: found });
          return ctx.json({ userId: found.id, sessionId: session.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
