import type { PointsHistoryView } from "@/lib/actions/weights";
import {
  historyByLabel,
  historyChangeLabel,
  historyOutcomeLabel,
} from "@/lib/weights/view";

// A bounty's points history (issue #115, SPEC §4.4): every change, newest
// first, with how and by whom it was made, the points and cooldown before
// and after, the reason, and what became of it (in effect, waiting, vetoed or
// cancelled, by whom and when). Rendered from `get_points_history` in the
// Bounties edit dialog, on /admin/weights and on /chores/history. No hooks,
// so it renders on the server and in client components alike.

const OUTCOME_TONE: Record<PointsHistoryView["outcome"], string> = {
  landed: "text-bm-green",
  pending: "text-bm-amber",
  vetoed: "text-bm-red",
  cancelled: "text-bm-muted",
};

export function PointsHistory({
  changes,
  showChore = false,
  empty = "No changes yet.",
}: {
  /** Newest first, as `get_points_history` returns them. */
  changes: PointsHistoryView[];
  /** Name the bounty on each change (a list of several bounties). */
  showChore?: boolean;
  empty?: string;
}) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-bm-muted" data-testid="points-history-empty">
        {empty}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="points-history">
      {changes.map((e) => (
        <li
          key={e.key}
          data-testid="points-change"
          data-outcome={e.outcome}
          className="flex flex-col gap-1 border-l-4 border-bm-line pl-3 text-sm"
        >
          <p className="font-semibold text-bm-text">
            {showChore ? `${e.choreName}: ` : ""}
            {historyChangeLabel(e)}
          </p>
          <p className="text-bm-muted">{historyByLabel(e)}</p>
          {e.reason ? (
            <p className="break-words text-bm-text">
              <span className="text-bm-muted">Reason: </span>
              {e.reason}
            </p>
          ) : null}
          <p className={OUTCOME_TONE[e.outcome]}>{historyOutcomeLabel(e)}</p>
        </li>
      ))}
    </ol>
  );
}
