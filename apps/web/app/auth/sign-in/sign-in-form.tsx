"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
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
  passkeyErrorSentence,
  PASSKEY_DIDNT_FINISH,
  signInErrorSentence,
  SOMETHING_WENT_WRONG,
} from "../messages";
import { BaumyApproval } from "./baumy-approval";
import { TwoFactorChallenge } from "./two-factor-challenge";

/** How this browser last signed in (the `baumy.last_login_method` cookie). */
export type LastLoginMethod = "email" | "google" | "passkey";

/** The "Last used" tag beside the way this browser signed in last time. */
function LastUsed({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="self-start font-label text-xs font-bold tracking-wider text-bm-green uppercase"
        data-testid="last-used"
      >
        Last used
      </span>
      {children}
    </div>
  );
}

/**
 * Email and password sign-in, a passkey, Google when this deployment has its
 * keys (issue #79, as camp-404 `apps/web/app/auth/sign-in-form.tsx`), and
 * "Sign in with Baumy" (a Telegram tap, issue #80) when brain is set up.
 * With two-factor on, a correct password answers with a challenge instead of
 * a session, and the form becomes the code step in place.
 */
export function SignInForm({
  googleEnabled,
  passkeysEnabled = false,
  baumyEnabled = false,
  lastMethod = null,
  oauthError = null,
  callbackURL = "/",
}: {
  googleEnabled: boolean;
  /** Passkeys have a host to bind to on this deployment. */
  passkeysEnabled?: boolean;
  /** Brain can DM an approval here (lib/integrations/brain.ts). */
  baumyEnabled?: boolean;
  lastMethod?: LastLoginMethod | null;
  /** What a failed Google round trip (`?error=`) says (oauthErrorSentence). */
  oauthError?: string | null;
  /** Where to go once signed in: a path on this site (safeCallbackUrl). */
  callbackURL?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(oauthError);
  const [pending, setPending] = useState(false);
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [withBaumy, setWithBaumy] = useState(false);

  /** A full navigation, so the server renders the page with the cookie. */
  function goOnward() {
    window.location.assign(callbackURL);
  }

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
      if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      ) {
        setNeedsTwoFactor(true);
        setPending(false);
        return;
      }
      goOnward();
    } catch {
      setError(SOMETHING_WENT_WRONG);
      setPending(false);
    }
  }

  async function withPasskey() {
    setError(null);
    setPending(true);
    try {
      // The browser asks for a fingerprint, face or device PIN. A passkey is
      // already two factors (the device and the person), so no code follows.
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        setError(passkeyErrorSentence(result.error));
        setPending(false);
        return;
      }
      goOnward();
    } catch {
      setError(PASSKEY_DIDNT_FINISH);
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

  if (needsTwoFactor) return <TwoFactorChallenge onVerified={goOnward} />;
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

  const passkeyButton = passkeysEnabled ? (
    <Button variant="secondary" onClick={withPasskey} disabled={pending}>
      Sign in with a passkey
    </Button>
  ) : null;
  const googleButton = googleEnabled ? (
    <Button variant="secondary" onClick={google} disabled={pending}>
      Continue with Google
    </Button>
  ) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeading title="Sign in" />
      {lastMethod === "email" ? (
        <span
          className="-mt-4 font-label text-xs font-bold tracking-wider text-bm-green uppercase"
          data-testid="last-used"
        >
          Last used: email and password
        </span>
      ) : null}
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
      {passkeyButton ? (
        lastMethod === "passkey" ? (
          <LastUsed>{passkeyButton}</LastUsed>
        ) : (
          passkeyButton
        )
      ) : null}
      {googleButton ? (
        lastMethod === "google" ? (
          <LastUsed>{googleButton}</LastUsed>
        ) : (
          googleButton
        )
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
