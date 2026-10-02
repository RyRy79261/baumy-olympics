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
import { KioskPin } from "@baumy/types";
import { useStepUp } from "@/components/account/confirm-its-you";
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

const PIN_RULE = "Use 4 to 6 digits.";

/**
 * What to say under the PIN as it is typed (issue #126): a letter or a 7th
 * digit at once, too few digits once the field is left. Null when it is
 * fine, or too early to say.
 */
export function pinProblem(value: string, left: boolean): string | null {
  if (value === "" || KioskPin.safeParse(value).success) return null;
  if (left || /\D/.test(value) || value.length > 6) return PIN_RULE;
  return null;
}

/**
 * set_kiosk_pin: the member's personal PIN, 4 to 6 digits, typed twice. It
 * is what the kitchen screen asks for before it does something as them; it
 * has nothing to do with pairing the iPad (issue #126).
 */
export function KioskPinForm({ hasPin }: { hasPin: boolean }) {
  // Changing a PIN needs "Confirm it's you" (issue #135): the dialog opens
  // when the action asks for it, then the PIN is sent again.
  const stepUp = useStepUp();
  const { state, formAction, pending, requestId, errors } = useActionForm(
    (prev: Parameters<typeof setKioskPinAction>[0], form: FormData) =>
      stepUp.guard(setKioskPinAction)(prev, form),
  );
  const [mismatch, setMismatch] = useState(false);
  const [pin, setPin] = useState("");
  const [left, setLeft] = useState(false);
  const typedProblem = pinProblem(pin, left);
  useEffect(() => {
    // A saved PIN leaves the field empty, like the form's other fields.
    if (state?.ok) {
      setPin("");
      setLeft(false);
    }
  }, [state]);

  return (
    <Card
      id="pin"
      title="Your personal PIN"
      description="The kitchen screen asks for it only before it disputes a chore as you; everything else there needs none. It is yours alone, and it is not for pairing the iPad."
    >
      <form
        action={formAction}
        onSubmit={(e) => {
          const form = e.currentTarget;
          const again =
            form.querySelector<HTMLInputElement>("#kiosk-pin-confirm");
          const problem = pinProblem(pin, true);
          setLeft(true);
          const same = pin === again?.value;
          setMismatch(!same);
          if (problem || !same) e.preventDefault();
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <Field
          id="kiosk-pin"
          label={hasPin ? "New PIN" : "PIN"}
          hint="4 to 6 digits."
          errors={typedProblem ? [typedProblem] : errors.pin}
        >
          {(control) => (
            <Input
              {...control}
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              disabled={pending}
              value={pin}
              onChange={(e) => setPin(e.currentTarget.value)}
              onBlur={() => setLeft(true)}
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
      {stepUp.dialog}
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
