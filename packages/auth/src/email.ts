// The auth email seam. Better Auth's hooks (sendResetPassword,
// sendVerificationEmail, onPasswordReset) call through here.
//
// Ported from camp-404 `packages/auth/src/email.ts`. It delivers through Resend
// (RESEND_API_KEY, RESEND_FROM_EMAIL), writes to the e2e capture file under the
// harness, and otherwise LOGS, so a reset can be followed locally. It never
// throws: a Better Auth hook that throws fails the whole request, and every
// caller here announces something that has already happened.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuthEnv } from "./env";
import { isEmailProviderConfigured, resolveAuthEmailCaptureFile } from "./env";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Reset and verification links expire after Better Auth's default, 1 hour. */
const TOKEN_EXPIRY_HOURS = 1;

export type AuthEmailKind =
  "reset" | "verify" | "password-reset-completed" | "password-set";

export interface AuthEmailInput {
  to: string;
  kind: AuthEmailKind;
  /** Required for "reset" and "verify"; ignored otherwise. */
  url?: string | undefined;
}

export interface AuthEmailBody {
  subject: string;
  text: string;
}

/** A captured email: one JSON line in AUTH_EMAIL_CAPTURE_FILE. */
export interface CapturedAuthEmail {
  at: string;
  to: string;
  kind: AuthEmailKind;
  subject: string;
  text: string;
  url: string | null;
}

const SIGN_OFF = "\n\n- Baumy Olympics";

/** Build the subject and text of an auth email. */
export function buildAuthEmail(input: AuthEmailInput): AuthEmailBody {
  switch (input.kind) {
    case "reset":
      return {
        subject: "Reset your Baumy Olympics password",
        text:
          "Someone (hopefully you) asked to reset the password for this " +
          "Baumy Olympics account.\n\n" +
          `Reset it here. The link works once and expires in ${TOKEN_EXPIRY_HOURS} hour:\n` +
          `${input.url ?? ""}\n\n` +
          "If you didn't ask for this, ignore this email. Your password stays " +
          "the same." +
          SIGN_OFF,
      };
    case "verify":
      return {
        subject: "Confirm your Baumy Olympics email",
        text:
          "Confirm this email address for your Baumy Olympics account.\n\n" +
          `Confirm here. The link expires in ${TOKEN_EXPIRY_HOURS} hour:\n` +
          `${input.url ?? ""}\n\n` +
          "If this wasn't you, ignore this email." +
          SIGN_OFF,
      };
    case "password-reset-completed":
      return {
        subject: "Your Baumy Olympics password was changed",
        text:
          "The password for this Baumy Olympics account was just reset, and " +
          "every device that was signed in has been signed out.\n\n" +
          "If this was you, there is nothing to do.\n\n" +
          "If it wasn't, reset your password again straight away from the " +
          "sign-in page." +
          SIGN_OFF,
      };
    case "password-set":
      // A new way into the account (issue #79). If a stolen session added
      // it, this email is how the owner finds out.
      return {
        subject: "A password was added to your Baumy Olympics account",
        text:
          "A password was just added to this Baumy Olympics account, so it " +
          "can now also sign in with this email and that password.\n\n" +
          "If this was you, there is nothing to do.\n\n" +
          "If it wasn't, reset the password from the sign-in page straight " +
          "away, then sign out every other device on Settings, Security." +
          SIGN_OFF,
      };
  }
}

/**
 * E2E only: append the email as one JSON line to the capture file, so a
 * Playwright run can read the link without a real inbox. Never throws.
 */
async function captureAuthEmail(
  file: string,
  input: AuthEmailInput,
  body: AuthEmailBody,
  at: Date,
): Promise<boolean> {
  try {
    await mkdir(dirname(file), { recursive: true });
    const line: CapturedAuthEmail = {
      at: at.toISOString(),
      to: input.to,
      kind: input.kind,
      subject: body.subject,
      text: body.text,
      url: input.url ?? null,
    };
    await appendFile(file, `${JSON.stringify(line)}\n`, "utf8");
    return true;
  } catch (err) {
    console.error(
      `[auth:email:capture] write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Send one auth email to one recipient. Returns whether it was delivered (to
 * Resend, or to the e2e capture file). Never throws.
 *
 * Under the e2e harness, and only there (resolveAuthEmailCaptureFile refuses
 * on any deployment), the email is written to the capture file and nothing is
 * sent. Without a provider it is logged instead; on a deployment the link is
 * withheld from the log, because it is a working key to someone's account.
 *
 * `at` is only the capture line's timestamp. It is a parameter so this
 * package stays free of the app's clock; the web app's clock is the source of
 * "now" for anything that decides behaviour.
 */
export async function sendAuthEmail(
  env: AuthEnv,
  input: AuthEmailInput,
  at: Date = new Date(),
): Promise<boolean> {
  const body = buildAuthEmail(input);
  const { subject, text } = body;
  const captureFile = resolveAuthEmailCaptureFile(env);
  if (captureFile) return captureAuthEmail(captureFile, input, body, at);
  if (!isEmailProviderConfigured(env)) {
    const logged =
      env.VERCEL_ENV && input.url
        ? text.replace(input.url, "[link withheld from deployment logs]")
        : text;
    console.info(
      `[auth:email:console] (email not configured) to ${input.to}\n` +
        `  subject: ${subject}\n  ${logged.replace(/\n/g, "\n  ")}`,
    );
    return false;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim(),
        // One recipient by type: every auth email is for exactly one person.
        to: [input.to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      // The status only: a provider's error body can echo the request.
      console.error(`[auth:email] Resend responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[auth:email] send failed: ${err instanceof Error ? err.name : "unknown error"}`,
    );
    return false;
  }
}
