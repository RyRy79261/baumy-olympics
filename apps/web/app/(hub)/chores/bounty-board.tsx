"use client";

import { useState } from "react";
import { Button, SectionHeading } from "@baumy/ui";
import { ChoreGrid, type GridMember } from "@/components/chores/chore-grid";
import { PointsHistory } from "@/components/chores/points-history";
import type { FormAction } from "@/components/use-action-form";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { PointsHistoryView, SuggestionView } from "@/lib/actions/weights";
import { appliesLabel, changeLabel, hoursField } from "@/lib/weights/view";
import { EditChoreDialog } from "../admin/chores/chore-forms";
import {
  DismissWeightButton,
  SchedulePointsForm,
} from "../admin/weights/weight-forms";

// /chores' board (issue #109). Everyone gets the bounty grid; an admin also
// gets an Edit button on each row (and the page a "New bounty" button),
// which open the same dialogs as /admin/chores. Points never change from
// here directly: the edit dialog's Change points schedules any points the
// admin picks (schedule_points_change, issue #115, SPEC §4.4), which another
// member can veto until it applies, and shows the bounty's points history.
// The actions refuse anyone but an admin session anyway (SPEC §12 decision
// 10).

export interface BountyAdmin {
  /** The open or scheduled weight suggestion per chore, if any. */
  suggestions: SuggestionView[];
  /** Every bounty's points changes, newest first (`get_points_history`). */
  history: PointsHistoryView[];
}

const SCHEDULED_NOTE =
  "New points apply at the first Monday 00:00 (Berlin time) at least 48 hours away, unless another member vetoes them first. Points already scored never change.";

/** The edit dialog's points: what they are, how to change them, their story. */
export function ChangePoints({
  chore,
  suggestion,
  history,
}: {
  chore: ChoreView;
  suggestion: SuggestionView | null;
  history: PointsHistoryView[];
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
            <p className="text-sm" data-testid="open-suggestion">
              Baumy suggests{" "}
              {changeLabel({
                fromPoints: open.currentPoints,
                toPoints: open.suggestedPoints!,
                fromCooldownMinutes: open.currentCooldownMinutes,
                toCooldownMinutes: open.suggestedCooldownMinutes!,
              })}
              , from how often it is really done. Schedule that, or your own
              numbers.
            </p>
          ) : null}
          <SchedulePointsForm
            choreId={chore.id}
            choreName={chore.name}
            points={open?.suggestedPoints ?? chore.basePoints ?? 20}
            cooldownMinutes={
              open?.suggestedCooldownMinutes ?? chore.cooldownMinutes ?? 24 * 60
            }
          />
        </div>
      ) : null}
      <div data-testid="bounty-points-history">
        <SectionHeading>Points history</SectionHeading>
        <PointsHistory changes={history} />
      </div>
    </section>
  );
}

/** An admin's Edit under (phone) or beside (wider) a bounty row, and its dialog. */
function EditBounty({
  chore,
  suggestion,
  history,
}: {
  chore: ChoreView;
  suggestion: SuggestionView | null;
  history: PointsHistoryView[];
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        className="shrink-0 self-end sm:self-auto"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${chore.name}`}
      >
        Edit
      </Button>
      {editing ? (
        <EditChoreDialog
          chore={chore}
          onClose={() => setEditing(false)}
          points={
            <ChangePoints
              chore={chore}
              suggestion={suggestion}
              history={history}
            />
          }
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
  const historyOf = new Map<string, PointsHistoryView[]>();
  for (const e of admin?.history ?? []) {
    historyOf.set(e.choreId, [...(historyOf.get(e.choreId) ?? []), e]);
  }
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
                history={historyOf.get(c.id) ?? []}
              />
            )
          : undefined
      }
    />
  );
}
