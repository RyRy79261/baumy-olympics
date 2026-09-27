import type { Metadata } from "next";
import { isGoogleConfigured } from "@baumy/auth/env";
import { redirectIfSignedIn } from "@/lib/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { SignInForm } from "./sign-in-form";

// Bare on purpose: restyled once the pixel UI kit lands (issue #7).

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
    <main>
      <SignInForm
        googleEnabled={isGoogleConfigured(process.env)}
        oauthFailed={Boolean(error)}
        callbackURL={next}
      />
    </main>
  );
}
