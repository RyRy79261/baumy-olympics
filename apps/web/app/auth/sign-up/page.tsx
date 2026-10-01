import type { Metadata } from "next";
import { AuthFrame } from "@baumy/ui";
import { isGoogleConfigured } from "@baumy/auth/env";
import { LegalLinks } from "@/components/legal/legal-page";
import { redirectIfSignedIn } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

// Sign-up is open; the household is not: a new account lands on /join
// (issue #9).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage() {
  await redirectIfSignedIn();
  return (
    <AuthFrame>
      <SignUpForm googleEnabled={isGoogleConfigured(process.env)} />
      <LegalLinks />
    </AuthFrame>
  );
}
