"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Button,
  buttonClass,
  Card,
  Field,
  FormMessage,
  Input,
} from "@baumy/ui";
import { PixelQr } from "@/components/account/pixel-qr";
import { useActionForm } from "@/components/use-action-form";
import { telegramLinkDeepLink } from "@/lib/telegram/deep-link";
import {
  createTelegramLinkCodeAction,
  setKioskPinAction,
  telegramLinkStatusAction,
} from "./actions";
import { useLinkWatch, type LinkCheck } from "./use-link-watch";

/** get_telegram_link_status, as the link watch reads it. */
const checkTelegramLink: LinkCheck = async () => {
  const result = await telegramLinkStatusAction();
  return result.ok ? result.data.code : null;
};

/** set_kiosk_pin: a 4 to 6 digit PIN, typed twice. */
export function KioskPinForm({ hasPin }: { hasPin: boolean }) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(setKioskPinAction);
  const [mismatch, setMismatch] = useState(false);

  return (
    <Card
      title="Kiosk PIN"
      description="The kitchen kiosk asks for it before confirming or disputing something as you."
    >
      <form
        action={formAction}
        onSubmit={(e) => {
          const form = e.currentTarget;
          const pin = form.elements.namedItem("pin") as HTMLInputElement;
          const again =
            form.querySelector<HTMLInputElement>("#kiosk-pin-confirm");
          const same = pin.value === again?.value;
          setMismatch(!same);
          if (!same) e.preventDefault();
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <Field
          id="kiosk-pin"
          label={hasPin ? "New PIN" : "PIN"}
          hint="4 to 6 digits."
          errors={errors.pin}
        >
          {(control) => (
            <Input
              {...control}
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              autoComplete="off"
              required
              disabled={pending}
            />
          )}
        </Field>
        <Field
          id="kiosk-pin-confirm"
          label="Type it again"
          errors={mismatch ? ["The PINs do not match."] : undefined}
        >
          {(control) => (
            // No name, so it is never submitted: the action takes one PIN.
            <Input
              {...control}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              disabled={pending}
            />
          )}
        </Field>
        {hasPin ? (
          <Field
            id="kiosk-current-password"
            label="Your account password"
            hint="Not needed within 10 minutes of signing in."
            errors={errors.currentPassword}
          >
            {(control) => (
              <Input
                {...control}
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                disabled={pending}
              />
            )}
          </Field>
        ) : null}
        {state?.ok ? (
          <FormMessage tone="success">
            {state.data.changed ? "PIN changed." : "PIN saved."}
          </FormMessage>
        ) : state && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : hasPin ? "Change PIN" : "Set PIN"}
        </Button>
      </form>
    </Card>
  );
}

/**
 * create_telegram_link_code as one tap (issue #108): the code becomes a
 * Telegram deep link (Open Telegram, or its QR code from a laptop), and the
 * card asks the server until the bot has used the code (issue #118: "Linked"
 * even when the member relinks the account they had) or it has expired.
 * `/link <code>` stays as the fallback.
 */
export function TelegramLinkForm({
  linked,
  botUsername,
}: {
  /** The member has a Telegram id, from get_telegram_link_status. */
  linked: boolean;
  botUsername: string;
}) {
  const router = useRouter();
  const { state, formAction, pending, requestId } = useActionForm(
    createTelegramLinkCodeAction,
  );
  const code = state?.ok ? state.data.code : null;
  const phase = useLinkWatch({
    code,
    secondsLeft: state?.ok ? state.data.expiresInSeconds : 0,
    check: checkTelegramLink,
  });
  const justLinked = phase === "used";
  // Once, so the card's description (and anything else) says linked.
  useEffect(() => {
    if (justLinked) router.refresh();
  }, [justLinked, router]);
  const expiresAt = state?.ok ? Date.parse(state.data.expiresAt) : 0;
  const deepLink =
    code && phase === "waiting"
      ? telegramLinkDeepLink(code, botUsername)
      : null;

  return (
    <Card
      title="Telegram"
      description={
        linked
          ? "Your Telegram account is linked. Link again to switch to a different one."
          : "Link your Telegram account so the Baumy bot knows who you are."
      }
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        {justLinked ? (
          <FormMessage tone="success">
            Linked. @{botUsername} knows who you are now.
          </FormMessage>
        ) : deepLink && code ? (
          <div className="flex flex-col gap-4">
            <p className="text-base">
              Tap <strong>Open Telegram</strong>, then <strong>Start</strong>.
              On a laptop, scan the code with your phone instead.
            </p>
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("primary", "default", "self-start")}
              data-testid="telegram-deep-link"
            >
              Open Telegram
            </a>
            <PixelQr
              value={deepLink}
              label={`QR code that opens @${botUsername} in Telegram`}
            />
            <p className="text-sm text-bm-muted">
              No luck? Send{" "}
              <code data-testid="telegram-link-code" className="select-all">
                /link {code}
              </code>{" "}
              to @{botUsername} instead. The link works once, until{" "}
              {new Date(expiresAt).toLocaleTimeString()}.
            </p>
            <p role="status" className="text-sm text-bm-muted">
              Waiting for Telegram...
            </p>
          </div>
        ) : phase === "expired" ? (
          <FormMessage tone="error">
            That link has expired. Make a new one.
          </FormMessage>
        ) : state?.ok ? (
          <FormMessage tone="error">
            That link was already shown. Make a new one.
          </FormMessage>
        ) : state ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        {justLinked ? null : (
          <Button
            type="submit"
            variant={deepLink ? "secondary" : "primary"}
            className="self-start"
            disabled={pending}
          >
            {pending
              ? "Making a link..."
              : code
                ? "Make a new link"
                : "Link Telegram"}
          </Button>
        )}
      </form>
    </Card>
  );
}
