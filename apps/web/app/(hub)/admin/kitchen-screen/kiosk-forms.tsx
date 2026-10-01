"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, Field, FormMessage, Input, linkClass } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { toast } from "@/lib/ui/toast";
import {
  approveKioskPairingAction,
  renameKioskAction,
  revokeKioskAction,
} from "./actions";

// /admin/kitchen-screen's forms (issue #126).

/** approve_kiosk_pairing: one tap, with the name prefilled. */
export function ApproveKioskForm({ code }: { code: string }) {
  const { state, formAction, pending, requestId, errors } = useActionForm(
    approveKioskPairingAction,
  );
  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="success">
          Done. {state.data.name} is now the kitchen screen: the iPad switches
          by itself in a moment.
        </FormMessage>
        <Link href="/admin/kitchen-screen" className={linkClass}>
          See the kitchen screens
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="code" value={code} />
      <Field
        id="kiosk-name"
        label="Name"
        hint="What the household calls this screen."
        errors={errors.name}
      >
        {(control) => (
          <Input
            {...control}
            name="name"
            defaultValue="Kitchen"
            maxLength={40}
            autoComplete="off"
          />
        )}
      </Field>
      {errors.code ? (
        <FormMessage tone="error">{errors.code[0]}</FormMessage>
      ) : state && !state.ok && state.code !== "INVALID_INPUT" ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Pairing..." : "Make it the kitchen screen"}
      </Button>
    </form>
  );
}

/** rename_kiosk: the name, inline; the outcome is a toast. */
export function RenameKioskForm({
  deviceId,
  name,
}: {
  deviceId: string;
  name: string;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(renameKioskAction);
  useEffect(() => {
    if (state?.ok) toast.success(`Renamed to ${state.data.name}.`);
    else if (state && state.code !== "INVALID_INPUT")
      toast.error(state.message);
  }, [state]);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <Field id={`kiosk-name-${deviceId}`} label="Name" errors={errors.name}>
        {(control) => (
          <Input
            {...control}
            name="name"
            defaultValue={name}
            maxLength={40}
            autoComplete="off"
          />
        )}
      </Field>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={`Rename ${name}`}
      >
        Rename
      </Button>
    </form>
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
          : `Cancelled the approval for ${state.data.name}.`,
      );
    } else toast.error(state.message);
  }, [state]);
  const label = paired ? "Sign out" : "Cancel";
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
