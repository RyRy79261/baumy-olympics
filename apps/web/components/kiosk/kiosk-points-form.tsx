"use client";

import { useState } from "react";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
  WEIGHT_CHANGE_REASON_MAX,
} from "@baumy/types";
import { Field, FormMessage, Input, Select, Textarea } from "@baumy/ui";
import type { FormAction } from "@/components/use-action-form";
import { fieldErrors, type ActionResult } from "@/lib/actions/result";
import type { WeightDecisionData } from "@/lib/actions/weights";
import { toast } from "@/lib/ui/toast";
import { appliesLabel, hoursField } from "@/lib/weights/view";
import { AttestedForm } from "./attested-form";

// An admin changes a bounty's points on the kitchen screen (issue #147):
// schedule_points_change, which the admin gate lets through for a picked
// admin with their PIN. The PinPad opens inside the form (AttestedForm), and
// its OK sends the same form again with the PIN.

/**
 * The visible controls name no form (no element has this id), so they
 * belong to none (issue #177). React resets a form once its action answers
 * (the first, PIN-less send does), and a reset puts a controlled list back
 * on its first option while the state still holds the pick, so the PIN's
 * send posted the first bounty. The values travel in hidden fields instead,
 * which a reset leaves alone (the mass editor's pattern).
 */
const DETACHED = "kiosk-points-form-fields";

export interface PointsBounty {
  id: string;
  name: string;
  basePoints: number | null;
  cooldownMinutes: number | null;
}

export function KioskPointsForm({
  bounties,
  pinLabel,
  action,
}: {
  bounties: readonly PointsBounty[];
  pinLabel: string;
  action: FormAction<WeightDecisionData>;
}) {
  const first = bounties[0];
  const [choreId, setChoreId] = useState(first?.id ?? "");
  const [points, setPoints] = useState(String(first?.basePoints ?? ""));
  const [hours, setHours] = useState(
    first?.cooldownMinutes != null ? hoursField(first.cooldownMinutes) : "",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The last answer's input issues, per field (the browser's own min/max
  // check is off: the controls are outside the form). Editing a field
  // drops its own.
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const clear = (...names: string[]) =>
    setErrors((all) => {
      const next = { ...all };
      for (const n of names) delete next[n];
      return next;
    });

  const pick = (id: string) => {
    clear("choreId", "basePoints", "cooldownHours");
    setChoreId(id);
    const b = bounties.find((x) => x.id === id);
    setPoints(String(b?.basePoints ?? ""));
    setHours(b?.cooldownMinutes != null ? hoursField(b.cooldownMinutes) : "");
  };

  const onResult = (result: ActionResult<WeightDecisionData>) => {
    if (result.ok) {
      setError(null);
      setErrors({});
      setReason("");
      // The bounty the server changed, not what the screen shows.
      const changed = bounties.find((b) => b.id === result.data.choreId);
      toast.success(
        `${changed?.name ?? "The bounty"}: ${appliesLabel(result.data.appliesAt!)}`,
      );
    } else {
      setError(result.message);
      setErrors(fieldErrors(result));
    }
  };

  if (!first) return <p className="text-base">There are no bounties yet.</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="kiosk-points-form">
      <AttestedForm
        action={action}
        label="Schedule change"
        pinLabel={pinLabel}
        onResult={onResult}
        fields={
          <>
            <input type="hidden" name="choreId" value={choreId} />
            <input type="hidden" name="basePoints" value={points} />
            <input type="hidden" name="cooldownHours" value={hours} />
            <input type="hidden" name="reason" value={reason} />
            <Field
              id="kiosk-points-bounty"
              label="Bounty"
              errors={errors.choreId}
            >
              {(control) => (
                <Select
                  form={DETACHED}
                  {...control}
                  value={choreId}
                  onChange={(e) => pick(e.currentTarget.value)}
                  className="min-h-14 text-xl"
                >
                  {bounties.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <div className="w-40">
                <Field
                  id="kiosk-points-points"
                  label="Points"
                  errors={errors.basePoints}
                >
                  {(control) => (
                    <Input
                      form={DETACHED}
                      {...control}
                      kiosk
                      type="number"
                      inputMode="numeric"
                      min={BASE_POINTS_MIN}
                      max={BASE_POINTS_MAX}
                      value={points}
                      onChange={(e) => {
                        clear("basePoints");
                        setPoints(e.currentTarget.value);
                      }}
                    />
                  )}
                </Field>
              </div>
              <div className="w-48">
                <Field
                  id="kiosk-points-cooldown"
                  label="Cooldown (hours)"
                  errors={errors.cooldownHours}
                >
                  {(control) => (
                    <Input
                      form={DETACHED}
                      {...control}
                      kiosk
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={COOLDOWN_HOURS_MAX}
                      step="any"
                      value={hours}
                      onChange={(e) => {
                        clear("cooldownHours");
                        setHours(e.currentTarget.value);
                      }}
                    />
                  )}
                </Field>
              </div>
            </div>
            <Field
              id="kiosk-points-reason"
              label="Reason (optional)"
              errors={errors.reason}
            >
              {(control) => (
                <Textarea
                  form={DETACHED}
                  {...control}
                  kiosk
                  maxLength={WEIGHT_CHANGE_REASON_MAX}
                  rows={2}
                  value={reason}
                  onChange={(e) => {
                    clear("reason");
                    setReason(e.currentTarget.value);
                  }}
                />
              )}
            </Field>
          </>
        }
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
