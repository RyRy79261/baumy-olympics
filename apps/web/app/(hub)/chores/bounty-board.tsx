"use client";

import { useState } from "react";
import { Button } from "@baumy/ui";
import { ChoreGrid, type GridMember } from "@/components/chores/chore-grid";
import type { FormAction } from "@/components/use-action-form";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { SuggestionView } from "@/lib/actions/weights";
import { appliesLabel, changeLabel, hoursField } from "@/lib/weights/view";
import { EditChoreDialog } from "../admin/chores/chore-forms";
import {
  DismissWeightButton,
  ScheduleWeightForm,
} from "../admin/weights/weight-forms";

// /chores' board (issue #109). Everyone gets the bounty grid; an admin also
// gets an Edit button on each row (and the page a "New bounty" button),
// which open the same dialogs as /admin/chores. Points never change from here directly:
// the edit dialog's Change points schedules a weight change (schedule_weight,
// SPEC §4.4), which another member can veto until it applies. The actions
// refuse anyone but an admin session anyway (SPEC §12 decision 10).

export interface BountyAdmin {
  /** The open or scheduled weight suggestion per chore, if any. */
  suggestions: SuggestionView[];
}

const SCHEDULED_NOTE =
  "Points change on a schedule: at the first Monday at least 48 hours away (and 28 days after the last change), unless another member vetoes it first.";

/** The edit dialog's points: what they are, and the way to change them. */
export function ChangePoints({
  chore,
  suggestion,
}: {
  chore: ChoreView;
  suggestion: SuggestionView | null;
}) {
  const [changing, setChanging] = useState(false);
  const cooldown =
    chore.cooldownMinutes !== null
      ? ` · cooldown ${hoursField(chore.cooldownMinutes)}h`
      : "";
  const scheduled = suggestion?.status === "scheduled" ? suggestion : null;
  const open = suggestion?.status === "open" ? suggestion : null;
  return (
    <section
      aria-label="Points"
      data-testid="bounty-points"
      className="mb-4 flex flex-col gap-3 border-b-2 border-bm-line pb-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-display text-bm-yellow">
            {chore.basePoints !== null
              ? `${chore.basePoints} pts`
              : "No points"}
          </span>
          <span className="text-sm text-bm-muted">{cooldown}</span>
        </p>
        {scheduled || changing ? null : (
          <Button variant="secondary" onClick={() => setChanging(true)}>
            Change points
          </Button>
        )}
      </div>
      {scheduled ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Scheduled:{" "}
            {changeLabel({
              fromPoints: scheduled.currentPoints,
              toPoints: scheduled.scheduledPoints!,
              fromCooldownMinutes: scheduled.currentCooldownMinutes,
              toCooldownMinutes: scheduled.scheduledCooldownMinutes!,
            })}
            . {appliesLabel(scheduled.appliesAt!)}
          </p>
          <div>
            <DismissWeightButton
              suggestionId={scheduled.id}
              choreName={chore.name}
              scheduled
            />
          </div>
        </div>
      ) : changing ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-bm-muted">{SCHEDULED_NOTE}</p>
          {open ? (
            <>
              <p className="text-sm">
                Baumy suggests{" "}
                {changeLabel({
                  fromPoints: open.currentPoints,
                  toPoints: open.suggestedPoints,
                  fromCooldownMinutes: open.currentCooldownMinutes,
                  toCooldownMinutes: open.suggestedCooldownMinutes,
                })}
                , from how often it is really done. Schedule that, or your own
                numbers.
              </p>
              <ScheduleWeightForm
                suggestionId={open.id}
                choreName={chore.name}
                suggestedPoints={open.suggestedPoints}
                suggestedCooldownMinutes={open.suggestedCooldownMinutes}
              />
            </>
          ) : (
            <p className="text-sm" data-testid="no-suggestion">
              No change is due yet. Points follow how often a bounty is really
              done: each Monday Baumy suggests a change where they are off, and
              you can schedule it here.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** An admin's Edit beside a bounty row, and its dialog. */
function EditBounty({
  chore,
  suggestion,
}: {
  chore: ChoreView;
  suggestion: SuggestionView | null;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        className="shrink-0"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${chore.name}`}
      >
        Edit
      </Button>
      {editing ? (
        <EditChoreDialog
          chore={chore}
          onClose={() => setEditing(false)}
          points={<ChangePoints chore={chore} suggestion={suggestion} />}
        />
      ) : null}
    </>
  );
}

export function BountyBoard({
  admin,
  chores,
  members,
  actorId,
  action,
}: {
  /** Set for an admin: an Edit button per row. Null for everyone else. */
  admin: BountyAdmin | null;
  chores: ChoreView[];
  members: GridMember[];
  actorId: string;
  action: FormAction<LogCompletionData>;
}) {
  const suggestionOf = new Map(
    (admin?.suggestions ?? []).map((s) => [s.choreId, s]),
  );
  return (
    <ChoreGrid
      chores={chores}
      members={members}
      actorId={actorId}
      action={action}
      rowAction={
        admin
          ? (c) => (
              <EditBounty
                chore={c}
                suggestion={suggestionOf.get(c.id) ?? null}
              />
            )
          : undefined
      }
    />
  );
}
