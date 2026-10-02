"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, FormMessage, Input } from "@baumy/ui";
import { PixelQr } from "@/components/account/pixel-qr";
import { useStepUp } from "@/components/account/confirm-its-you";
import { authClient } from "@/lib/auth-client";
import {
  SOMETHING_WENT_WRONG,
  twoFactorErrorSentence,
} from "@/app/auth/messages";
import { StatusTag } from "./status-tag";

// Two-factor (TOTP plus backup codes), ported from camp-404
// `packages/ui/src/components/account-two-factor.tsx` onto the pixel kit
// (issue #79). These are Better Auth's own endpoints, called from the
// browser: turn on, confirm the password, scan the QR code, type a code,
// then see the backup codes ONCE. Regenerating replaces them.

/** The base32 secret in an otpauth:// URI, for typing it in by hand. */
export function secretFromTotpUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Groups of 4, so the key can be typed without losing your place. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

type Stage =
  | { step: "idle" }
  | { step: "password" }
  | { step: "scan"; totpURI: string; backupCodes: string[] }
  | { step: "codes"; backupCodes: string[] }
  | { step: "manage"; what: "disable" | "regenerate" };

function authMessage(err: { message?: string } | null, fallback: string) {
  return err?.message?.trim() ? err.message : fallback;
}

export function TwoFactorCard({
  enabled,
  hasPassword,
  emailVerified,
}: {
  enabled: boolean;
  /** A password must be confirmed to change two-factor, when there is one. */
  hasPassword: boolean;
  emailVerified: boolean;
}) {
  const router = useRouter();
  // Turning two-factor on or off and new backup codes need "Confirm it's
  // you" (issue #135): Better Auth refuses them without an open window.
  const stepUp = useStepUp();
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  function reset() {
    setStage({ step: "idle" });
    setPassword("");
    setCode("");
    setError(null);
    setPending(false);
    setCopied(false);
  }

  const pw = () => (password ? { password } : {});

  async function begin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    if (!(await stepUp.ensure())) {
      setPending(false);
      return;
    }
    const { data, error: err } = await authClient.twoFactor
      .enable(pw())
      .catch(() => ({ data: null, error: { message: SOMETHING_WENT_WRONG } }));
    setPending(false);
    if (err || !data) {
      setError(
        authMessage(
          err,
          hasPassword ? "That password didn't match." : SOMETHING_WENT_WRONG,
        ),
      );
      return;
    }
    setPassword("");
    setStage({
      step: "scan",
      totpURI: data.totpURI,
      backupCodes: data.backupCodes,
    });
  }

  async function verify(e: FormEvent<HTMLFormElement>, backupCodes: string[]) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error: err } = await authClient.twoFactor
      .verifyTotp({ code })
      .catch(() => ({ error: { status: 500 } }));
    setPending(false);
    if (err) {
      setError(twoFactorErrorSentence(err, "totp"));
      return;
    }
    setCode("");
    setStage({ step: "codes", backupCodes });
    router.refresh();
  }

  async function manage(
    e: FormEvent<HTMLFormElement>,
    what: "disable" | "regenerate",
  ) {
    e.preventDefault();
    setError(null);
    setPending(true);
    if (!(await stepUp.ensure())) {
      setPending(false);
      return;
    }
    if (what === "disable") {
      const { error: err } = await authClient.twoFactor
        .disable(pw())
        .catch(() => ({ error: { message: SOMETHING_WENT_WRONG } }));
      setPending(false);
      if (err) {
        setError(authMessage(err, "Couldn't turn two-factor off. Try again."));
        return;
      }
      reset();
      router.refresh();
      return;
    }
    const { data, error: err } = await authClient.twoFactor
      .generateBackupCodes(pw())
      .catch(() => ({ data: null, error: { message: SOMETHING_WENT_WRONG } }));
    setPending(false);
    if (err || !data) {
      setError(authMessage(err, "Couldn't make new backup codes. Try again."));
      return;
    }
    setPassword("");
    setStage({ step: "codes", backupCodes: data.backupCodes });
  }

  /**
   * Only say "Copied" when they were: a refused clipboard must not look like
   * success on the one screen that shows the codes once (camp-404's lesson).
   */
  async function copy(codes: string[]) {
    setError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setError(
        "Your browser wouldn't copy them. They're still here: download them, or write them down.",
      );
    }
  }

  function download(codes: string[]) {
    const blob = new Blob(
      [
        "Baumy Olympics two-factor backup codes\n",
        "Each code works once. Keep them somewhere safe.\n\n",
        ...codes.map((c) => `${c}\n`),
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "baumy-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const passwordField = (id: string) =>
    hasPassword ? (
      <Field id={id} label="Your password">
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            required
          />
        )}
      </Field>
    ) : null;

  const errorLine = error ? (
    <FormMessage tone="error">{error}</FormMessage>
  ) : null;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Two-factor
          <StatusTag on={enabled}>{enabled ? "On" : "Off"}</StatusTag>
        </span>
      }
      description="A 6-digit code from an authenticator app after your password. Never SMS."
      data-testid="two-factor-card"
    >
      {stage.step === "idle" && !enabled ? (
        <div className="flex flex-col gap-3">
          {emailVerified ? (
            <p className="text-base text-bm-muted">
              You&rsquo;ll scan a QR code with an app such as Google
              Authenticator, Aegis or 1Password, and get backup codes for the
              day your phone goes missing.
            </p>
          ) : (
            <p className="text-base text-bm-muted">
              Confirm your email first. Two-factor is for an address
              you&rsquo;ve proven is yours.
            </p>
          )}
          <Button
            className="self-start"
            disabled={!emailVerified}
            onClick={() => {
              reset();
              setStage({ step: "password" });
            }}
          >
            Turn on two-factor
          </Button>
        </div>
      ) : null}

      {stage.step === "password" ? (
        <form onSubmit={begin} className="flex flex-col gap-4" noValidate>
          {passwordField("two-factor-password") ?? (
            <p className="text-base text-bm-muted">
              We&rsquo;ll make a QR code for your authenticator app.
            </p>
          )}
          {errorLine}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={pending || (hasPassword && !password)}
            >
              {pending ? "Setting up..." : "Continue"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {stage.step === "scan" ? (
        <form
          onSubmit={(e) => verify(e, stage.backupCodes)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <PixelQr
              value={stage.totpURI}
              label="QR code for your authenticator app"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-base">Scan it with your authenticator app.</p>
              <p className="text-base text-bm-muted">
                Can&rsquo;t scan? Type this key in instead:
              </p>
              <code
                className="pixel-frame bg-bm-ink px-3 py-2 font-mono text-sm break-all select-all"
                data-testid="totp-secret"
              >
                {groupSecret(secretFromTotpUri(stage.totpURI) ?? "")}
              </code>
            </div>
          </div>
          <Field
            id="two-factor-verify"
            label="6-digit code"
            hint="From the app. It changes every 30 seconds."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={pending}
                required
              />
            )}
          </Field>
          {errorLine}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending ? "Checking..." : "Verify and turn on"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {stage.step === "codes" ? (
        <div className="flex flex-col gap-3">
          <FormMessage tone="success">
            Save these backup codes now. Each works once, and we can&rsquo;t
            show them again.
          </FormMessage>
          <ul
            className="pixel-frame grid grid-cols-2 gap-2 bg-bm-ink p-4 font-mono text-base"
            aria-label="Backup codes"
          >
            {stage.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {errorLine}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => copy(stage.backupCodes)}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => download(stage.backupCodes)}
            >
              Download
            </Button>
            <Button onClick={reset}>I&rsquo;ve saved them</Button>
          </div>
        </div>
      ) : null}

      {stage.step === "idle" && enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-bm-muted">
            Two-factor is on. A password sign-in on a new device asks for a
            code. Google and passkey sign-ins don&rsquo;t: they are two steps
            already.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setStage({ step: "manage", what: "regenerate" })}
            >
              New backup codes
            </Button>
            <Button
              variant="ghost"
              onClick={() => setStage({ step: "manage", what: "disable" })}
            >
              Turn off
            </Button>
          </div>
        </div>
      ) : null}

      {stage.step === "manage" ? (
        <form
          onSubmit={(e) => manage(e, stage.what)}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="text-base text-bm-muted">
            {stage.what === "disable"
              ? "Turning two-factor off makes your account easier to break into."
              : "New codes replace the old ones, which stop working."}
          </p>
          {passwordField("two-factor-manage-password")}
          {errorLine}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={stage.what === "disable" ? "danger" : "primary"}
              disabled={pending || (hasPassword && !password)}
            >
              {stage.what === "disable"
                ? pending
                  ? "Turning off..."
                  : "Turn off two-factor"
                : pending
                  ? "Making codes..."
                  : "Make new codes"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              {stage.what === "disable" ? "Keep it on" : "Cancel"}
            </Button>
          </div>
        </form>
      ) : null}
      {stepUp.dialog}
    </Card>
  );
}
