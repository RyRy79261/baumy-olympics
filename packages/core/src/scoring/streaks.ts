import { compareCompletions } from "./replay";

// The streak board (SPEC §3.2, §4.1): every run of one member on one chore in
// a season, read back from the stored scores. A run is what the replay counted
// as one streak: it starts at `streak_len = 1` and grows by one per counted
// completion until someone else does the chore. `heaviest_streak` and
// `longest_streak` (SPEC §4.5, reserved for later) would rank these runs.

/** A scored completion: its `completions` row joined to `completion_scores`. */
export interface ScoredRun {
  id: string;
  choreId: string;
  doneBy: string;
  occurredAt: Date;
  loggedAt: Date;
  streakLen: number;
  basePts: number;
}

export interface StreakRun {
  choreId: string;
  memberId: string;
  /** The number of completions in the run. */
  length: number;
  /** The run's weight: the sum of its `base_pts`. */
  basePts: number;
  startedAt: Date;
  lastAt: Date;
  /** True for the run that still holds the chore's streak. */
  current: boolean;
}

/**
 * Every run in the given scored completions, best first: longest, then
 * heaviest, then the one that got there first (then by chore id, so
 * the order is stable). Rows may be for many chores
 * and in any order; they are put in replay order per chore.
 */
export function streakRuns(rows: readonly ScoredRun[]): StreakRun[] {
  const byChore = new Map<string, ScoredRun[]>();
  for (const r of rows) {
    const list = byChore.get(r.choreId) ?? [];
    list.push(r);
    byChore.set(r.choreId, list);
  }

  const runs: StreakRun[] = [];
  for (const [choreId, list] of byChore) {
    list.sort(compareCompletions);
    let run: StreakRun | null = null;
    for (const r of list) {
      if (run && r.streakLen > 1 && r.doneBy === run.memberId) {
        run.length = r.streakLen;
        run.basePts += r.basePts;
        run.lastAt = r.occurredAt;
        continue;
      }
      run = {
        choreId,
        memberId: r.doneBy,
        length: r.streakLen,
        basePts: r.basePts,
        startedAt: r.occurredAt,
        lastAt: r.occurredAt,
        current: false,
      };
      runs.push(run);
    }
    run!.current = true;
  }

  return runs.sort(
    (a, b) =>
      b.length - a.length ||
      b.basePts - a.basePts ||
      a.lastAt.getTime() - b.lastAt.getTime() ||
      // Runs of one chore never end at the same moment, so the chore id
      // settles the rest and the order is stable.
      a.choreId.localeCompare(b.choreId),
  );
}
