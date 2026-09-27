"use client";

import { useState } from "react";
import { Button, Card, Field, FormMessage, Input } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { createTelegramLinkCodeAction, setKioskPinAction } from "./actions";

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

/** create_telegram_link_code: a one-time code to send to the Baumy bot. */
export function TelegramLinkForm({ linked }: { linked: boolean }) {
  const { state, formAction, pending, requestId } = useActionForm(
    createTelegramLinkCodeAction,
  );
  return (
    <Card
      title="Telegram"
      description={
        linked
          ? "Your Telegram account is linked. Create a code to link a different one."
          : "Link your Telegram account so the Baumy bot knows who you are."
      }
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        {state?.ok && state.data.code ? (
          <FormMessage tone="success">
            Send{" "}
            <code data-testid="telegram-link-code">
              /link {state.data.code}
            </code>{" "}
            to the Baumy bot before{" "}
            {new Date(state.data.expiresAt).toLocaleTimeString()}. It works
            once.
          </FormMessage>
        ) : state?.ok ? (
          <FormMessage tone="error">
            That code was already shown. Create a new one.
          </FormMessage>
        ) : state ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Creating..." : "Create a link code"}
        </Button>
      </form>
    </Card>
  );
}
