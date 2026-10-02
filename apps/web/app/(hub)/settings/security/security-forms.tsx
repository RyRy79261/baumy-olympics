"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Field, FormMessage, Input } from "@baumy/ui";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import { useStepUp } from "@/components/account/confirm-its-you";
import { useActionForm } from "@/components/use-action-form";
import type { PasskeyView, SessionView } from "@/lib/actions/account-security";
import { authClient } from "@/lib/auth-client";
import type { ActionOutput as Out } from "@/lib/actions/registry";
import { toast } from "@/lib/ui/toast";
import {
  passkeyErrorSentence,
  SOMETHING_WENT_WRONG,
} from "@/app/auth/messages";
import {
  removePasskeyAction,
  renamePasskeyAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  setFirstPasswordAction,
  unlinkGoogleAction,
} from "./actions";
import { StatusTag } from "./status-tag";

// The Security page's cards (issue #79, camp-404
// `apps/web/app/(console)/profile/security/security-panels.tsx` on the pixel
// kit). Changes to the member's own rows are actions; the passkey ceremony,
// linking Google and changing the password are Better Auth's endpoints.

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unknown";

/** "Active now" for a session seen in the last few minutes, else a date. */
function lastActive(iso: string, now: number): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 5) return "Active now";
  return `Last active ${when(iso)}`;
}

const rowClass =
  "flex flex-wrap items-center justify-between gap-3 border-b-2 border-bm-line py-3 last:border-b-0";

/** Resend the confirmation link; passkeys and two-factor wait for it. */
export function ConfirmEmailCard({ email }: { email: string }) {
  const [sent, setSent] = useState<"sent" | "failed" | null>(null);
  return (
    <Card
      title="Confirm your email"
      description="Passkeys and two-factor are for an address you've proven is yours."
    >
      <p className="mb-4 text-base">
        Open the link we sent to {email}, then come back to this page.
      </p>
      {sent === "sent" ? (
        <FormMessage tone="success">
          Sent. Check your inbox for the new link.
        </FormMessage>
      ) : sent === "failed" ? (
        <FormMessage tone="error">
          We couldn&rsquo;t send it. Try again in a minute.
        </FormMessage>
      ) : null}
      <Button
        variant="secondary"
        className="mt-4"
        onClick={async () => {
          const res = await authClient
            .sendVerificationEmail({ email, callbackURL: "/settings/security" })
            .catch(() => null);
          setSent(res && !res.error ? "sent" : "failed");
        }}
      >
        Send the link again
      </Button>
    </Card>
  );
}

/** Change the password (Better Auth), or add a first one (an action). */
export function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  return (
    <Card
      title="Password"
      description={
        hasPassword
          ? "Change the password you sign in with. Every other device is signed out."
          : "You sign in with Google or a passkey. Add a password to sign in with your email too."
      }
    >
      {hasPassword ? <ChangePasswordForm /> : <FirstPasswordForm />}
    </Card>
  );
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setPending(true);
    const res = await authClient
      .changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      .catch(() => null);
    setPending(false);
    if (!res || res.error) {
      setError(
        res?.error?.status === 400
          ? "That isn't your current password."
          : res?.error?.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : SOMETHING_WENT_WRONG,
      );
      return;
    }
    setCurrent("");
    setNext("");
    setDone(true);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field id="password-current" label="Current password">
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={pending}
            required
          />
        )}
      </Field>
      <Field
        id="password-new"
        label="New password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. Passphrases welcome.`}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={pending}
            required
          />
        )}
      </Field>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {done ? (
        <FormMessage tone="success">
          Password changed. Your other devices are signed out.
        </FormMessage>
      ) : null}
      <Button
        type="submit"
        className="self-start"
        disabled={pending || !current || !next}
      >
        {pending ? "Changing..." : "Change password"}
      </Button>
    </form>
  );
}

function FirstPasswordForm() {
  const { state, formAction, pending, requestId, errors } = useActionForm(
    setFirstPasswordAction,
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="requestId" value={requestId} />
      <Field
        id="first-password"
        label="New password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. Passphrases welcome.`}
        errors={errors.password}
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            required
            disabled={pending}
          />
        )}
      </Field>
      {state?.ok ? (
        <FormMessage tone="success">
          Password added. You can sign in with it now.
        </FormMessage>
      ) : state && state.code !== "INVALID_INPUT" ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Adding..." : "Add password"}
      </Button>
    </form>
  );
}

/** Link Google (an OAuth round trip) or unlink it (an action). */
export function GoogleCard({
  linked,
  linkFailed,
}: {
  linked: boolean;
  linkFailed: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(
    linkFailed
      ? "Linking Google didn't finish. It must be the Google account with this email."
      : null,
  );
  const stepUp = useStepUp();
  const unlink = useActionForm<Out<"unlink_google">>(async (prev, form) => {
    const result = await stepUp.guard(unlinkGoogleAction)(prev, form);
    if (result.ok) toast.success("Google is unlinked.");
    else toast.error(result.message);
    setConfirming(false);
    return result;
  });

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Google
          <StatusTag on={linked}>{linked ? "Linked" : "Not linked"}</StatusTag>
        </span>
      }
      description={
        linked
          ? "Continue with Google signs you in. Unlink it and it won't, until you link it here again."
          : "Continue with Google signs in only to an account that has linked it here. Link the Google account with your email."
      }
      data-testid="google-card"
    >
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {linked ? (
        confirming ? (
          <form action={unlink.formAction} className="flex flex-col gap-3">
            <input type="hidden" name="requestId" value={unlink.requestId} />
            <p className="text-base">
              Unlink Google? Continue with Google will stop signing you in.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={unlink.pending}>
                {unlink.pending ? "Unlinking..." : "Yes, unlink Google"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={unlink.pending}
              >
                Keep it linked
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Unlink Google
          </Button>
        )
      ) : (
        <Button
          variant="secondary"
          className="mt-2"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await authClient
              .linkSocial({
                provider: "google",
                callbackURL: "/settings/security",
                errorCallbackURL: "/settings/security?link=failed",
              })
              .catch(() => null);
            if (!res || res.error) {
              setError(SOMETHING_WENT_WRONG);
              setPending(false);
            }
          }}
        >
          {pending ? "Opening Google..." : "Link Google"}
        </Button>
      )}
      {stepUp.dialog}
    </Card>
  );
}

/** One passkey: its name (renamable) and a Remove button. */
function PasskeyRow({ pk }: { pk: PasskeyView }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rename = useActionForm<Out<"rename_passkey">>(async (prev, form) => {
    const result = await renamePasskeyAction(prev, form);
    if (result.ok) setRenaming(false);
    return result;
  });
  const stepUp = useStepUp();
  const remove = useActionForm<Out<"remove_passkey">>(async (prev, form) => {
    const result = await stepUp.guard(removePasskeyAction)(prev, form);
    if (result.ok) toast.success("Passkey removed.");
    else {
      toast.error(result.message);
      setConfirming(false);
    }
    return result;
  });
  const name = pk.name?.trim() || "Passkey";

  return (
    <li className={rowClass} data-testid="passkey-row">
      {renaming ? (
        <form action={rename.formAction} className="flex w-full flex-col gap-3">
          <input type="hidden" name="requestId" value={rename.requestId} />
          <input type="hidden" name="passkeyId" value={pk.id} />
          <Field
            id={`passkey-name-${pk.id}`}
            label="Passkey name"
            errors={rename.errors.name}
          >
            {(control) => (
              <Input
                {...control}
                name="name"
                defaultValue={pk.name ?? ""}
                maxLength={64}
                required
                disabled={rename.pending}
              />
            )}
          </Field>
          {rename.state &&
          !rename.state.ok &&
          rename.state.code !== "INVALID_INPUT" ? (
            <FormMessage tone="error">{rename.state.message}</FormMessage>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={rename.pending}>
              {rename.pending ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRenaming(false)}
              disabled={rename.pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="min-w-0">
            <p className="truncate text-lg">{name}</p>
            <p className="text-base text-bm-muted">
              {pk.synced ? "Synced" : "This device only"} · added{" "}
              {when(pk.createdAt)}
            </p>
          </div>
          {confirming ? (
            <form
              action={remove.formAction}
              className="flex w-full flex-col gap-3"
            >
              <input type="hidden" name="requestId" value={remove.requestId} />
              <input type="hidden" name="passkeyId" value={pk.id} />
              <p className="text-base">
                Remove {name}? It stops signing in on that device.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="danger"
                  disabled={remove.pending}
                >
                  {remove.pending ? "Removing..." : "Yes, remove it"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                  disabled={remove.pending}
                >
                  Keep it
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button
                variant="danger"
                onClick={() => setConfirming(true)}
                aria-label={`Remove ${name}`}
              >
                Remove
              </Button>
            </div>
          )}
        </>
      )}
      {stepUp.dialog}
    </li>
  );
}

/** The member's passkeys, and adding one through the browser's prompt. */
export function PasskeysCard({
  passkeys,
  enabled,
  emailVerified,
}: {
  passkeys: PasskeyView[];
  /** Passkeys have a host to bind to on this deployment. */
  enabled: boolean;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unknown until a real browser has been asked (camp-404's lesson: the
  // server cannot know, and guessing "no" disables the button for everyone).
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await authClient.passkey
      .addPasskey({ name: name.trim() || undefined })
      .catch(() => null);
    setPending(false);
    if (!res || res.error) {
      setError(passkeyErrorSentence(res?.error ?? {}));
      return;
    }
    setName("");
    setAdding(false);
    toast.success("Passkey added.");
    router.refresh();
  }

  const blocked = !enabled || !emailVerified || supported === false;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Passkeys
          <StatusTag on={passkeys.length > 0}>
            {passkeys.length > 0 ? `${passkeys.length} set up` : "None yet"}
          </StatusTag>
        </span>
      }
      description="Sign in with your fingerprint, face or phone PIN instead of typing a password."
      data-testid="passkeys-card"
    >
      {passkeys.length > 0 ? (
        <ul className="mb-4 flex flex-col" aria-label="Your passkeys">
          {passkeys.map((pk) => (
            <PasskeyRow key={pk.id} pk={pk} />
          ))}
        </ul>
      ) : null}
      {adding ? (
        <form onSubmit={add} className="flex flex-col gap-4" noValidate>
          <Field
            id="passkey-new-name"
            label="Name this passkey"
            hint="So you can tell your devices apart, e.g. My phone."
          >
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                disabled={pending}
              />
            )}
          </Field>
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Waiting for your device..." : "Create passkey"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
          <Button
            variant="secondary"
            className="self-start"
            disabled={blocked}
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
          >
            Add a passkey
          </Button>
          {!enabled ? (
            <p className="text-base text-bm-muted">
              Passkeys aren&rsquo;t set up on this site yet.
            </p>
          ) : !emailVerified ? (
            <p className="text-base text-bm-muted">
              Confirm your email first. Passkeys are for an address you&rsquo;ve
              proven is yours.
            </p>
          ) : supported === false ? (
            <p className="text-base text-bm-muted">
              This browser can&rsquo;t make passkeys. Your password still works.
            </p>
          ) : null}
        </div>
      )}
      <p className="mt-4 text-base text-bm-muted">
        A passkey is a faster way in, not your only one: the Security page never
        lets you remove your last way in.
      </p>
    </Card>
  );
}

function RevokeSessionButton({ session }: { session: SessionView }) {
  const { formAction, pending, requestId } = useActionForm<
    Out<"revoke_session">
  >(async (prev, form) => {
    const result = await revokeSessionAction(prev, form);
    if (result.ok) toast.success(`${session.label} is signed out.`);
    else toast.error(result.message);
    return result;
  });
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="sessionId" value={session.id} />
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        aria-label={`Sign out ${session.label}`}
      >
        {pending ? "Signing out..." : "Sign out"}
      </Button>
    </form>
  );
}

/** The devices signed in now: this one first, each other one revocable. */
export function DevicesCard({
  sessions,
  lagMinutes,
  now,
}: {
  sessions: SessionView[];
  /** The cookie cache: how long a signed-out device may keep working. */
  lagMinutes: number;
  /** The server's clock, so "Active now" does not depend on the phone's. */
  now: number;
}) {
  const others = sessions.filter((s) => !s.current).length;
  const all = useActionForm<Out<"revoke_other_sessions">>(
    async (prev, form) => {
      const result = await revokeOtherSessionsAction(prev, form);
      if (result.ok) {
        toast.success(
          result.data.count === 1
            ? "1 other device is signed out."
            : `${result.data.count} other devices are signed out.`,
        );
      } else toast.error(result.message);
      return result;
    },
  );

  return (
    <Card
      title="Signed-in devices"
      description="Every browser and phone signed in as you. Sign out any you don't recognise."
      data-testid="devices-card"
    >
      <ul className="mb-4 flex flex-col" aria-label="Signed-in devices">
        {sessions.map((s) => (
          <li key={s.id} className={rowClass} data-testid="session-row">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-lg">
                {s.label}
                {s.current ? <StatusTag on>This device</StatusTag> : null}
              </p>
              <p className="text-base text-bm-muted">
                {lastActive(s.lastActiveAt, now)} · signed in{" "}
                {when(s.signedInAt)}
              </p>
            </div>
            {s.current ? null : <RevokeSessionButton session={s} />}
          </li>
        ))}
      </ul>
      <form action={all.formAction} className="flex flex-col gap-3">
        <input type="hidden" name="requestId" value={all.requestId} />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={all.pending || others === 0}
        >
          {all.pending ? "Signing out..." : "Sign out every other device"}
        </Button>
      </form>
      <p className="mt-4 text-base text-bm-muted" data-testid="revocation-lag">
        A device you sign out can keep working for up to {lagMinutes} minutes,
        until it next checks in with Baumy.
      </p>
    </Card>
  );
}
