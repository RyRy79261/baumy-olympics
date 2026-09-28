import type { GetWeightsData } from "@/lib/actions/weights";
import { appliesLabel, changeLabel } from "@/lib/weights/view";
import { VetoWeightButton } from "./weight-forms";

// The weight changes waiting to apply (SPEC §4.4, §12 decision 5: one member
// schedules, the other has until it applies to veto). Shown on /inbox to
// every member and on /admin/weights.

export function ScheduledChanges({
  changes,
}: {
  changes: GetWeightsData["scheduled"];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {changes.map((c) => (
        <li
          key={c.id}
          data-testid={`scheduled-${c.choreName}`}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="text-sm">
            <span className="font-semibold">{c.choreName}</span>:{" "}
            {changeLabel({
              fromPoints: c.currentPoints,
              toPoints: c.scheduledPoints!,
              fromCooldownMinutes: c.currentCooldownMinutes,
              toCooldownMinutes: c.scheduledCooldownMinutes!,
            })}
            . {appliesLabel(c.appliesAt!)}
          </span>
          {c.canVeto ? (
            <VetoWeightButton suggestionId={c.id} choreName={c.choreName} />
          ) : (
            <span className="text-sm text-bm-muted">You scheduled this.</span>
          )}
        </li>
      ))}
    </ul>
  );
}
