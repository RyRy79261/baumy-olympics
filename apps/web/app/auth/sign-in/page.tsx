import type { Metadata } from "next";
import { isGoogleConfigured } from "@baumy/auth/env";
import { redirectIfSignedIn } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

// Bare on purpose: restyled once the pixel UI kit lands (issue #7).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in - Baumy Olympics" };

export default async function SignInPage() {
  await redirectIfSignedIn();
  return (
    <main>
      <SignInForm googleEnabled={isGoogleConfigured(process.env)} />
    </main>
  );
}
