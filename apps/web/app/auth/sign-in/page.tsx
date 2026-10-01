import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AuthFrame } from "@baumy/ui";
import {
  LAST_LOGIN_METHOD_COOKIE,
  isGoogleConfigured,
  resolvePasskeyScope,
} from "@baumy/auth/env";
import { LegalLinks } from "@/components/legal/legal-page";
import { redirectIfSignedIn } from "@/lib/auth";
import { signInWithBaumyEnabled } from "@/lib/login-approval/flag";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { oauthErrorSentence } from "../messages";
import { SignInForm, type LastLoginMethod } from "./sign-in-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

const METHODS: readonly LastLoginMethod[] = ["email", "google", "passkey"];

/** The browser's last sign-in method, only if it is one this page offers. */
function lastMethod(raw: string | undefined): LastLoginMethod | null {
  return METHODS.find((m) => m === raw) ?? null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackURL?: string }>;
}) {
  const { error, callbackURL } = await searchParams;
  // Where to go afterwards, e.g. back to the MCP consent page (issue #23).
  const next = safeCallbackUrl(callbackURL);
  await redirectIfSignedIn(next);
  const jar = await cookies();
  return (
    <AuthFrame>
      <SignInForm
        googleEnabled={isGoogleConfigured(process.env)}
        passkeysEnabled={resolvePasskeyScope(process.env) !== null}
        lastMethod={lastMethod(jar.get(LAST_LOGIN_METHOD_COOKIE)?.value)}
        oauthError={oauthErrorSentence(error)}
        // Off until the owner turns it on, once brain can send the DM (#80).
        baumyEnabled={signInWithBaumyEnabled(process.env)}
        callbackURL={next}
      />
      <LegalLinks />
    </AuthFrame>
  );
}
