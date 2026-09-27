"use client";

import { useEffect, useState } from "react";
import { ADJUSTMENT_POINTS_MAX } from "@baumy/types";
import { Button, Field, FormMessage, Input, Select } from "@baumy/ui";
import type { PrizeMode } from "@baumy/core";
import { useActionForm } from "@/components/use-action-form";
import { PRIZE_MODES, signedPoints } from "@/lib/scores/view";
import { toast } from "@/lib/ui/toast";
import { adjustPointsAction, setPrizeModeAction } from "./actions";

// /scores' admin forms: propose and approve point adjustments
// (`adjust_points`) and set the prize mode (`set_prize_mode`). Form errors
// show inline; the one-tap approve reports through a toast.

export interface MemberOption {
  id: string;
  displayName: string;
}

function FormError({
  state,
}: {
  state: ReturnType<typeof useActionForm>["state"];
}) {
  if (!state || state.ok || state.code === "INVALID_INPUT") return null;
  return <FormMessage tone="error">{state.message}</FormMessage>;
}

export function AdjustmentForm({ members }: { members: MemberOption[] }) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(adjustPointsAction);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state?.ok) {
      toast.success(
        `Proposed ${signedPoints(state.data.points)}. A second admin has to approve it.`,
      );
      setRound((n) => n + 1);
    }
  }, [state]);
  return (
    <form
      key={round}
      action={formAction}
      className="flex flex-col gap-4"
      aria-label="Propose an adjustment"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="op" value="create" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="adjust-member" label="Member" errors={errors.memberId}>
          {(control) => (
            <Select {...control} name="memberId" required>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id="adjust-points"
          label="Points"
          hint="Negative to take points away."
          errors={errors.points}
        >
          {(control) => (
            <Input
              {...control}
              name="points"
              type="number"
              inputMode="numeric"
              min={-ADJUSTMENT_POINTS_MAX}
              max={ADJUSTMENT_POINTS_MAX}
              required
            />
          )}
        </Field>
        <Field id="adjust-reason" label="Reason" errors={errors.reason}>
          {(control) => <Input {...control} name="reason" required />}
        </Field>
      </div>
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Proposing..." : "Propose adjustment"}
      </Button>
    </form>
  );
}

export function ApproveAdjustmentButton({
  adjustmentId,
  label,
}: {
  adjustmentId: string;
  /** Who and how much, for the accessible name. */
  label: string;
}) {
  const { state, formAction, pending, requestId } =
    useActionForm(adjustPointsAction);
  useEffect(() => {
    if (!state) return;
    if (!state.ok) toast.error(state.message);
    else toast.success("Approved. The points count now.");
  }, [state]);
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="op" value="approve" />
      <input type="hidden" name="adjustmentId" value={adjustmentId} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={`Approve ${label}`}
      >
        Approve
      </Button>
    </form>
  );
}

export function PrizeModeForm({
  season,
  year,
  mode,
}: {
  season: "current" | "next";
  year: number;
  mode: PrizeMode;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(setPrizeModeAction);
  useEffect(() => {
    if (state?.ok) toast.success(`Saved the ${state.data.year} prize mode.`);
  }, [state]);
  const id = `prize-${season}`;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="season" value={season} />
      <div className="min-w-64 flex-1">
        <Field id={id} label={`${year} prize mode`} errors={errors.mode}>
          {(control) => (
            <Select {...control} name="mode" defaultValue={mode}>
              {PRIZE_MODES.map((m) => (
                <option key={m.mode} value={m.mode} disabled={!m.playable}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : `Save ${year}`}
      </Button>
      <div className="basis-full">
        <FormError state={state} />
      </div>
    </form>
  );
}
