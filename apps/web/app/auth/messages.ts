// The sentences the auth forms show. Kept apart from the forms so they can be
// tested without a browser.

import { DEVICE_SIGNED_OUT } from "@baumy/auth/env";

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
 * A Google sign-in for an address that already has an account which has not
 * linked Google (issue #79: Google never links itself on sign-in). Saying so
 * tells whoever holds that Google account that the address has an account,
 * which they could learn from sign-up anyway; they still cannot get in.
 */
export const GOOGLE_NOT_LINKED =
  "That Google account isn't linked yet. Sign in with your email and password, then link Google on Settings, Security.";

/** The sentence for `?error=<code>` on sign-in; null when there is none. */
export function oauthErrorSentence(code: string | undefined): string | null {
  if (!code) return null;
  return code === "account_not_linked" ? GOOGLE_NOT_LINKED : OAUTH_FAILED;
}

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

// Passkeys and two-factor (issue #79).

/** A passkey prompt that did not finish: cancelled, timed out, or refused. */
export const PASSKEY_DIDNT_FINISH =
  "That didn't finish. Your device may have cancelled it. Try again.";

/**
 * What a passkey sign-in or enrolment failure says. A passkey sign-in never
 * names an account, so nothing here can be used to find one out.
 */
export function passkeyErrorSentence(error: AuthError & { message?: string }) {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  if (error.code === "PASSKEYS_NOT_CONFIGURED") {
    return "Passkeys aren't set up on this site yet. Use your password or Google.";
  }
  if (error.code === "EMAIL_NOT_VERIFIED") {
    return "Confirm your email first. Passkeys and two-factor are for an address you've proven is yours.";
  }
  if (error.code === "SESSION_REVOKED") {
    // This device was signed out elsewhere (the email-proof guard in
    // @baumy/auth), so the passkey was not added.
    return DEVICE_SIGNED_OUT;
  }
  if (error.code === "SESSION_NOT_FRESH") {
    return "For your safety, sign out and in again, then add the passkey within a day.";
  }
  if (error.status !== undefined && error.status >= 500) {
    return SOMETHING_WENT_WRONG;
  }
  return PASSKEY_DIDNT_FINISH;
}

/** What a refused two-factor code says, at sign-in or while turning it on. */
export function twoFactorErrorSentence(
  error: AuthError,
  mode: "totp" | "backup",
): string {
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  if (error.code === "SESSION_REVOKED") {
    // Signed out elsewhere while turning two-factor on (the email-proof
    // guard in @baumy/auth): the code was never checked.
    return DEVICE_SIGNED_OUT;
  }
  if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") {
    return "Too many wrong codes. Wait 15 minutes, then try again.";
  }
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
    return "That sign-in took too long. Start again with your email and password.";
  }
  if (error.status !== undefined && error.status >= 500) {
    return SOMETHING_WENT_WRONG;
  }
  return mode === "totp"
    ? "That code didn't match. It changes every 30 seconds, so try the newest one."
    : "That backup code didn't match, or it has been used already.";
}
