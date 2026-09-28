"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Button,
  Field,
  FormMessage,
  Input,
  PageHeading,
  linkClass,
} from "@baumy/ui";
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
      <div className="flex flex-col gap-4">
        <PageHeading title="Password reset is off" />
        <p>
          Email is not set up here yet, so a reset link has no way to reach you.
          Ask the household admin for help getting back in.
        </p>
        <p>
          <Link href="/auth/sign-in" className={linkClass}>
            Back to sign in
          </Link>
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
      <div className="flex flex-col gap-4">
        <PageHeading title="Reset link sent" />
        <FormMessage tone="success">{RESET_LINK_SENT}</FormMessage>
        <p>The link works once and expires in an hour.</p>
        <p>
          <Link href="/auth/sign-in" className={linkClass}>
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeading title="Forgot your password?" />
      <Field id="forgot-email" label="Email">
        {(control) => (
          <Input
            {...control}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
        )}
      </Field>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send reset link"}
      </Button>
      <p>
        <Link href="/auth/sign-in" className={linkClass}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
