import type { Metadata } from "next";
import { isGoogleConfigured } from "@baumy/auth/env";
import { redirectIfSignedIn } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

// Bare on purpose: restyled once the pixel UI kit lands (issue #7). Sign-up is
// open here; the household membership gate and invite codes are issue #9.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign up - Baumy Olympics" };

export default async function SignUpPage() {
  await redirectIfSignedIn();
  return (
    <main>
      <SignUpForm googleEnabled={isGoogleConfigured(process.env)} />
    </main>
  );
}
