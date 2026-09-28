// "Sign in with Baumy" (issue #80, ADR 0006): the one piece that lives inside
// Better Auth. The web app decides WHETHER someone may sign in (the member
// tapped the right number in Telegram, and this browser holds the request's
// secret: apps/web/lib/login-approval); this endpoint then makes the session
// exactly as Better Auth's own sign-ins do, with the signed session cookie,
// the cookie cache and the `set-auth-token` header.
//
// The session is a browser session (Better Auth's `dontRememberMe`): the
// cookie has no Max-Age, so it goes when the browser closes, and the server
// ends it after a day at most, instead of the 30 days a password sign-in
// gets. A tap on a shared screen should not leave it signed in for a month.
//
// It is SERVER_ONLY: Better Auth's router does not mount it, so no request
// can reach it over HTTP. Only a server call, `auth.api.signInApproved`,
// runs it, and it refuses any call that carries a request as a second belt.

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

export const APPROVAL_SIGN_IN_PATH = "/sign-in/baumy-approval";

/** A browser session: at most a day, gone when the browser closes. */
const DONT_REMEMBER = true;

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
            DONT_REMEMBER,
          );
          await setSessionCookie(ctx, { session, user: found }, DONT_REMEMBER);
          return ctx.json({ userId: found.id, sessionId: session.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
