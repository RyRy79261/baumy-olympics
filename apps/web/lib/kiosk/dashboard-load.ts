import "server-only";

import { berlinDateKey } from "@baumy/core";
import { rosterAvatars } from "@baumy/types";
import type { Queryable } from "@baumy/db";
import { listActiveMembers } from "@baumy/db/members";
import type { RequestCtx } from "@/lib/actions/define";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { NoteView } from "@/lib/actions/notes";
import { runAction } from "@/lib/actions/registry";
import type { ActionResult } from "@/lib/actions/result";
import type { CalendarEventView } from "@/lib/calendar/view";
import { monthGridDays, type DashboardMember } from "./dashboard";

// The kitchen dashboard's reads (ADR 0005, issue #65): the chores (as
// bounties), the month grid's events and the notes, each through runAction
// as the paired device (the `display` gate), side by side. One read failing
// (Google down, say) is that part's own message; the rest still shows.

export interface DashboardData {
  /** The instant the page was read at, ISO 8601. */
  now: string;
  /** Berlin's today, "YYYY-MM-DD". */
  today: string;
  /** The month the grid shows, "YYYY-MM". */
  month: string;
  members: DashboardMember[];
  chores: { ok: true; data: ChoreView[] } | { ok: false; message: string };
  events:
    { ok: true; data: CalendarEventView[] } | { ok: false; message: string };
  /** The notes, and list_notes' recentCount (the Messages count). */
  notes:
    | { ok: true; data: { notes: NoteView[]; recentCount: number } }
    | { ok: false; message: string };
}

const DOWN = "This could not be loaded just now. It will try again.";

async function read<T, U>(
  run: () => Promise<ActionResult<T>>,
  pick: (data: T) => U,
): Promise<{ ok: true; data: U } | { ok: false; message: string }> {
  try {
    const result = await run();
    return result.ok
      ? { ok: true, data: pick(result.data) }
      : { ok: false, message: result.message };
  } catch (err) {
    console.error("[kiosk] a dashboard read failed", err);
    return { ok: false, message: DOWN };
  }
}

export async function loadDashboard(
  ctx: RequestCtx,
  month: string,
  /** For the members' characters: a read, so the HTTP driver will do. */
  db: Queryable,
): Promise<DashboardData> {
  const days = monthGridDays(month);
  const [chores, events, notes, members] = await Promise.all([
    read(
      () => runAction("list_chores", {}, ctx),
      (d) => d.chores,
    ),
    read(
      () => runAction("list_events", { from: days[0], to: days.at(-1) }, ctx),
      (d) => d.events,
    ),
    read(
      () => runAction("list_notes", {}, ctx),
      (d) => ({ notes: d.notes, recentCount: d.recentCount }),
    ),
    listActiveMembers(db, ctx.householdId),
  ]);
  // Members who have not chosen a character wear shirts nobody else wears.
  const roster = rosterAvatars(members);
  return {
    now: ctx.now.toISOString(),
    today: berlinDateKey(ctx.now),
    month,
    members: members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      avatar: roster.get(m.id),
    })),
    chores,
    events,
    notes,
  };
}
