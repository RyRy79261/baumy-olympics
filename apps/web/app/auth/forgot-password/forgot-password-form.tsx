"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import {
  forgotPasswordErrorSentence,
  RESET_LINK_SENT,
  SOMETHING_WENT_WRONG,
} from "../messages";

// Ported from camp-404 `apps/web/app/auth/forgot-password-form.tsx`.
//
// ENUMERATION-SAFE BY DESIGN: the same sentence shows whether or not an account
// has that email, in place of the form rather than after a redirect, because a
// redirect that only happens on success is itself an answer. Better Auth
// answers success either way too.

export function ForgotPasswordForm({
  emailEnabled,
}: {
  emailEnabled: boolean;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!emailEnabled) {
    return (
      <div>
        <h1>Password reset is off</h1>
        <p>
          Email is not set up here yet, so a reset link has no way to reach you.
          Ask the household admin for help getting back in.
        </p>
        <p>
          <Link href="/auth/sign-in">Back to sign in</Link>
        </p>
      </div>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/auth/reset-password",
      });
      if (result.error) {
        setError(forgotPasswordErrorSentence(result.error));
        return;
      }
      setSent(true);
    } catch {
      setError(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div>
        <h1>Reset link sent</h1>
        <p role="status">{RESET_LINK_SENT}</p>
        <p>The link works once and expires in an hour.</p>
        <p>
          <Link href="/auth/sign-in">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h1>Forgot your password?</h1>
      <p>
        <label htmlFor="forgot-email">Email</label>
        <br />
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Sending..." : "Send reset link"}
        </button>
      </p>
      <p>
        <Link href="/auth/sign-in">Back to sign in</Link>
      </p>
    </form>
  );
}
