import type { Metadata } from "next";
import { canDeliverAuthEmail } from "@baumy/auth/env";
import { ForgotPasswordForm } from "./forgot-password-form";

// Bare on purpose: restyled once the pixel UI kit lands (issue #7).

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Forgot password - Baumy Olympics",
};

export default function ForgotPasswordPage() {
  return (
    <main>
      {/* A provider, or the e2e capture file (refused on any deployment). */}
      <ForgotPasswordForm emailEnabled={canDeliverAuthEmail(process.env)} />
    </main>
  );
}
