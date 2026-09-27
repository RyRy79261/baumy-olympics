// The sentences the auth forms show. Kept apart from the forms so they can be
// tested without a browser.

/**
 * The only thing a refused sign-in ever says, whatever Better Auth answered.
 * It never says which half was wrong, so the form cannot be used to find out
 * whether an account exists (AGENTS.md "Security").
 */
export const SIGN_IN_REFUSED = "Invalid email or password.";

export const TOO_MANY_ATTEMPTS =
  "Too many attempts. Wait a few minutes and try again.";

export const SOMETHING_WENT_WRONG =
  "Something went wrong. Try again in a moment.";

/** The same sentence whether or not an account uses the address. */
export const RESET_LINK_SENT =
  "If an account uses that email, we've sent it a link to reset the password.";

interface AuthError {
  status?: number;
  code?: string;
}

/**
 * What a refused sign-in says: rate limited, a server failure (auth switched
 * off, database down), or the one neutral sentence. A server failure is not an
 * answer about the account, so saying so reveals nothing.
 */
export function signInErrorSentence(error: AuthError): string {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  if (error.status !== undefined && error.status >= 500) {
    return SOMETHING_WENT_WRONG;
  }
  return SIGN_IN_REFUSED;
}

/**
 * Better Auth sends a failed OAuth round trip (Google) back to sign-in with
 * `?error=<code>` (`onAPIError.errorURL`). The code is not shown: it is
 * attacker-controllable text in a URL.
 */
export const OAUTH_FAILED =
  "Signing in with Google didn't finish. Try again, or use your email and password.";

/**
 * What a refused sign-up says. An address that already has an account says so,
 * with the way in. That does tell anyone which addresses are registered: a cost
 * accepted with open sign-up and automatic sign-in, as camp-404 does
 * (`apps/web/app/auth/sign-up-form.tsx`). Sign-in and forgot-password stay
 * neutral.
 */
export function signUpErrorSentence(
  error: AuthError & { message?: string },
): string {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  if (error.code?.startsWith("USER_ALREADY_EXISTS")) {
    return "There's already an account with that email. Sign in instead, or reset your password if you've forgotten it.";
  }
  if (
    error.code === "PASSWORD_TOO_SHORT" ||
    error.code === "PASSWORD_TOO_LONG"
  ) {
    return error.message ?? SOMETHING_WENT_WRONG;
  }
  return SOMETHING_WENT_WRONG;
}

/** What a forgot-password failure says: never whether the account exists. */
export function forgotPasswordErrorSentence(error: AuthError): string {
  return error.status === 429 ? TOO_MANY_ATTEMPTS : SOMETHING_WENT_WRONG;
}
