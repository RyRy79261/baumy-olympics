"use client";

import { useEffect } from "react";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
} from "@baumy/types";
import { Button, Field, FormMessage, Input } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { toast } from "@/lib/ui/toast";
import { appliesLabel, hoursField } from "@/lib/weights/view";
import {
  dismissWeightAction,
  scheduleWeightAction,
  vetoWeightAction,
} from "./actions";

// The weight decisions (SPEC §4.4): an admin schedules a suggestion, as it
// is or edited, or dismisses it; another member vetoes a scheduled change.
// The form shows its errors inline; the one-tap buttons report by toast.

/** "Schedule" and "Edit & schedule" in one: the fields start at the suggestion. */
export function ScheduleWeightForm({
  suggestionId,
  choreName,
  suggestedPoints,
  suggestedCooldownMinutes,
}: {
  suggestionId: string;
  choreName: string;
  suggestedPoints: number;
  suggestedCooldownMinutes: number;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(scheduleWeightAction);
  useEffect(() => {
    if (state?.ok) toast.success(appliesLabel(state.data.appliesAt!));
  }, [state]);
  const id = `schedule-${suggestionId}`;
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3"
      aria-label={`Schedule ${choreName}`}
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <div className="w-32">
        <Field id={`${id}-points`} label="Points" errors={errors.basePoints}>
          {(control) => (
            <Input
              {...control}
              name="basePoints"
              type="number"
              inputMode="numeric"
              min={BASE_POINTS_MIN}
              max={BASE_POINTS_MAX}
              defaultValue={suggestedPoints}
              required
            />
          )}
        </Field>
      </div>
      <div className="w-40">
        <Field
          id={`${id}-cooldown`}
          label="Cooldown (hours)"
          errors={errors.cooldownHours}
        >
          {(control) => (
            <Input
              {...control}
              name="cooldownHours"
              type="number"
              inputMode="decimal"
              min={0}
              max={COOLDOWN_HOURS_MAX}
              step="any"
              defaultValue={hoursField(suggestedCooldownMinutes)}
              required
            />
          )}
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Scheduling..." : "Schedule"}
      </Button>
      {state && !state.ok && state.code !== "INVALID_INPUT" ? (
        <div className="basis-full">
          <FormMessage tone="error">{state.message}</FormMessage>
        </div>
      ) : null}
    </form>
  );
}

function OneTap({
  action,
  suggestionId,
  label,
  accessibleName,
  done,
  variant = "secondary",
}: {
  action: typeof dismissWeightAction;
  suggestionId: string;
  label: string;
  accessibleName: string;
  done: string;
  variant?: "secondary" | "danger";
}) {
  const { state, formAction, pending, requestId } = useActionForm(action);
  useEffect(() => {
    if (!state) return;
    if (!state.ok) toast.error(state.message);
    else toast.success(done);
  }, [state, done]);
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <Button
        type="submit"
        variant={variant}
        disabled={pending}
        aria-label={accessibleName}
      >
        {label}
      </Button>
    </form>
  );
}

export function DismissWeightButton({
  suggestionId,
  choreName,
  scheduled,
}: {
  suggestionId: string;
  choreName: string;
  /** A scheduled change is cancelled rather than dismissed. */
  scheduled: boolean;
}) {
  const label = scheduled ? "Cancel" : "Dismiss";
  return (
    <OneTap
      action={dismissWeightAction}
      suggestionId={suggestionId}
      label={label}
      accessibleName={`${label} the ${choreName} change`}
      done={scheduled ? "Cancelled. The points stay." : "Dismissed."}
    />
  );
}

export function VetoWeightButton({
  suggestionId,
  choreName,
}: {
  suggestionId: string;
  choreName: string;
}) {
  return (
    <OneTap
      action={vetoWeightAction}
      suggestionId={suggestionId}
      label="Veto"
      accessibleName={`Veto the ${choreName} change`}
      done="Vetoed. The points stay as they are."
      variant="danger"
    />
  );
}
