import type { Metadata } from "next";
import { AuthFrame } from "@baumy/ui";
import { ResetPasswordForm } from "./reset-password-form";

// Better Auth's /api/auth/reset-password/<token> checks the emailed token and
// redirects here with `?token=`, or with `?error=` when it refused the token.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reset password",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <AuthFrame>
      <ResetPasswordForm token={error ? null : token?.trim() || null} />
    </AuthFrame>
  );
}
