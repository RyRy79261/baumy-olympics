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
  OAUTH_FAILED,
  signInErrorSentence,
  SOMETHING_WENT_WRONG,
} from "../messages";
import { BaumyApproval } from "./baumy-approval";

/**
 * Email and password sign-in, plus Google when this deployment has its keys,
 * and "Sign in with Baumy" (a Telegram tap, issue #80) when brain is set up.
 */
export function SignInForm({
  googleEnabled,
  baumyEnabled = false,
  oauthFailed = false,
  callbackURL = "/",
}: {
  googleEnabled: boolean;
  /** Brain can DM an approval here (lib/integrations/brain.ts). */
  baumyEnabled?: boolean;
  /** Landed here from a failed Google round trip (`?error=`). */
  oauthFailed?: boolean;
  /** Where to go once signed in: a path on this site (safeCallbackUrl). */
  callbackURL?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthFailed ? OAUTH_FAILED : null,
  );
  const [pending, setPending] = useState(false);
  const [withBaumy, setWithBaumy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) {
        setError(signInErrorSentence(result.error));
        setPending(false);
        return;
      }
      // A full navigation, so the server renders home with the new cookie.
      window.location.assign(callbackURL);
    } catch {
      setError(SOMETHING_WENT_WRONG);
      setPending(false);
    }
  }

  async function google() {
    setError(null);
    setPending(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL });
    } catch {
      setError(SOMETHING_WENT_WRONG);
      setPending(false);
    }
  }

  if (withBaumy) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading title="Sign in with Baumy" />
        <BaumyApproval
          initialEmail={email}
          callbackURL={callbackURL}
          onCancel={() => setWithBaumy(false)}
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeading title="Sign in" />
      <Field id="signin-email" label="Email">
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
      <Field id="signin-password" label="Password">
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
        )}
      </Field>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
      {googleEnabled ? (
        <Button variant="secondary" onClick={google} disabled={pending}>
          Continue with Google
        </Button>
      ) : null}
      {baumyEnabled ? (
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            setWithBaumy(true);
          }}
          disabled={pending}
        >
          Sign in with Baumy
        </Button>
      ) : null}
      <p>
        <Link href="/auth/forgot-password" className={linkClass}>
          Forgot your password?
        </Link>
      </p>
      <p>
        New here?{" "}
        <Link href="/auth/sign-up" className={linkClass}>
          Create an account
        </Link>
      </p>
    </form>
  );
}
