import { z } from "zod";

// "Sign in with Baumy" (issue #80): what the sign-in page sends, and what the
// Telegram buttons send back through brain (`approve_login`, `deny_login`).

/** The lowest and highest number shown on the screen: always two digits. */
export const LOGIN_CODE_MIN = 10;
export const LOGIN_CODE_MAX = 99;

/** The number on the screen, as the member taps it in Telegram. */
export const LoginCode = z
  .int("Send the number the person tapped.")
  .min(LOGIN_CODE_MIN, "The numbers have two digits.")
  .max(LOGIN_CODE_MAX, "The numbers have two digits.");

/** A login request's id, which brain gets in its DM and sends back. */
export const LoginRequestId = z.uuid("Expected the sign-in request's id.");

/** The sign-in page's "Sign in with Baumy" form. */
export const LoginApprovalStart = z.strictObject({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email.")
    .max(320, "That email is too long.")
    .pipe(z.email("Enter a valid email.")),
});
