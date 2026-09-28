import type { Metadata } from "next";
import { AuthFrame } from "@baumy/ui";
import { canDeliverAuthEmail } from "@baumy/auth/env";
import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Forgot password - Baumy Olympics",
};

export default function ForgotPasswordPage() {
  return (
    <AuthFrame>
      {/* A provider, or the e2e capture file (refused on any deployment). */}
      <ForgotPasswordForm emailEnabled={canDeliverAuthEmail(process.env)} />
    </AuthFrame>
  );
}
