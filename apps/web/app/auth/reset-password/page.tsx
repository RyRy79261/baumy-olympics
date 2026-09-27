import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

// Bare on purpose: restyled once the pixel UI kit lands (issue #7).
//
// Better Auth's /api/auth/reset-password/<token> checks the emailed token and
// redirects here with `?token=`, or with `?error=` when it refused the token.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reset password - Baumy Olympics",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <main>
      <ResetPasswordForm token={error ? null : token?.trim() || null} />
    </main>
  );
}
