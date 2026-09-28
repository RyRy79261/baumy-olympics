import type { Metadata } from "next";
import { AuthFrame } from "@baumy/ui";
import { isGoogleConfigured } from "@baumy/auth/env";
import { redirectIfSignedIn } from "@/lib/auth";
import { brainConfig } from "@/lib/integrations/brain";
import { isTestMode } from "@/lib/test-mode";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in - Baumy Olympics" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackURL?: string }>;
}) {
  const { error, callbackURL } = await searchParams;
  // Where to go afterwards, e.g. back to the MCP consent page (issue #23).
  const next = safeCallbackUrl(callbackURL);
  await redirectIfSignedIn(next);
  return (
    <AuthFrame>
      <SignInForm
        googleEnabled={isGoogleConfigured(process.env)}
        // Only where brain can send the Telegram DM (issue #80).
        baumyEnabled={isTestMode() || brainConfig(process.env) !== null}
        oauthFailed={Boolean(error)}
        callbackURL={next}
      />
    </AuthFrame>
  );
}
