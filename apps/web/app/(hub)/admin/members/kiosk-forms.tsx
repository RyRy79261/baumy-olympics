"use client";

import { useEffect } from "react";
import { Button, Card, Field, FormMessage, Input } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { formatKioskPairingCode } from "@/lib/kiosk/format";
import { toast } from "@/lib/ui/toast";
import { pairKioskAction, revokeKioskAction } from "./actions";

/** pair_kiosk: name the device; shows the one-time code once. */
export function PairKioskForm() {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(pairKioskAction);
  return (
    <Card
      title="Pair a kiosk"
      description="Creates a code for the kitchen iPad. Open /kiosk/pair on it and type the code within 10 minutes. It works once."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <Field id="kiosk-name" label="Device name" errors={errors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              defaultValue="Kitchen iPad"
              maxLength={40}
            />
          )}
        </Field>
        {state?.ok ? (
          state.data.code ? (
            <FormMessage tone="success">
              Pairing code for {state.data.name}:{" "}
              <code data-testid="pairing-code" className="font-mono">
                {formatKioskPairingCode(state.data.code)}
              </code>{" "}
              (10 minutes, one use)
            </FormMessage>
          ) : (
            <FormMessage tone="success">
              The code was already shown once. Create a new one if you need it.
            </FormMessage>
          )
        ) : state && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create pairing code"}
        </Button>
      </form>
    </Card>
  );
}

/** revoke_kiosk, one tap: the outcome is a toast. */
export function RevokeKioskButton({
  deviceId,
  name,
  paired,
}: {
  deviceId: string;
  name: string;
  paired: boolean;
}) {
  const { state, formAction, pending, requestId } =
    useActionForm(revokeKioskAction);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(
        state.data.wasPaired
          ? `${state.data.name} is signed out.`
          : `Cancelled the code for ${state.data.name}.`,
      );
    } else toast.error(state.message);
  }, [state]);
  const label = paired ? "Revoke" : "Cancel code";
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <Button
        type="submit"
        variant={paired ? "danger" : "secondary"}
        disabled={pending}
        aria-label={`${label}: ${name}`}
      >
        {label}
      </Button>
    </form>
  );
}
