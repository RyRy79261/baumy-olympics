import "server-only";

import type { RequestCtx } from "@/lib/actions/define";
import type { NoteView } from "@/lib/actions/notes";
import { runAction } from "@/lib/actions/registry";
import type { ActionResult } from "@/lib/actions/result";
import type { ShoppingEntry } from "@/lib/integrations/brain";
import { formatEuros, gapLabel } from "@/lib/scores/view";
import {
  dueChores,
  recentNoteCount,
  upcomingEvents,
  widgetState,
  type HubChore,
  type HubCounts,
  type HubEvent,
  type WidgetState,
} from "./view";

// The hub's reads (SPEC §3.1, issue #20), shared by `/` and the kiosk home.
// Every widget is one or two actions through runAction, the same reads the
// AI, MCP and brain get, run side by side. A read that fails, or throws,
// becomes that widget's `unavailable` state and nothing else: the calendar
// or brain being down never takes the page with it.

/** How many members the leaderboard lists. */
export const HUB_STANDINGS = 5;
/** How many pinned notes the hub shows. */
export const HUB_NOTES = 4;

export interface HubStanding {
  memberId: string;
  displayName: string;
  rank: number;
  points: number;
  /** "Leader", or "12 behind". */
  gap: string;
}

export interface HubData {
  /** The instant the page was read at, ISO 8601. */
  now: string;
  events: WidgetState<HubEvent[]>;
  chores: WidgetState<HubChore[]>;
  standings: WidgetState<HubStanding[]>;
  /** The pot's total, "€80.50", or why it cannot be shown. */
  pot: { ok: true; total: string } | { ok: false; message: string };
  notes: WidgetState<NoteView[]>;
  /** The Urgent, New and Messages counts (ADR 0005 §1). */
  counts: HubCounts;
  /**
   * brain's shopping list. Ready even when empty: the widget's quick-add
   * field is there either way.
   */
  shopping: WidgetState<ShoppingEntry[]>;
}

const DOWN = "This could not be loaded just now. It will try again.";

/** runAction, with a throw turned into a failure the widget can show. */
async function read<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (err) {
    console.error("[hub] a widget's read failed", err);
    return { ok: false, code: "INTERNAL", message: DOWN };
  }
}

export async function loadHub(ctx: RequestCtx): Promise<HubData> {
  const [events, chores, standings, pot, notes, shopping] = await Promise.all([
    read(() => runAction("list_events", {}, ctx)),
    read(() => runAction("list_chores", {}, ctx)),
    read(() => runAction("get_standings", { recent: 0 }, ctx)),
    read(() => runAction("get_pot", {}, ctx)),
    // Every note (pinned first): the pinned ones for the widget, the
    // recent ones for the Messages count.
    read(() => runAction("list_notes", {}, ctx)),
    read(() => runAction("list_shopping", {}, ctx)),
  ]);
  return {
    now: ctx.now.toISOString(),
    events: widgetState(
      events,
      (d) => upcomingEvents(d.events, ctx.now),
      "Nothing else on the calendar today.",
    ),
    chores: widgetState(
      chores,
      (d) => dueChores(d.chores, ctx.now),
      "Nothing is due. Nice.",
    ),
    standings: widgetState(
      standings,
      (d) =>
        d.standings.slice(0, HUB_STANDINGS).map((s) => ({
          memberId: s.memberId,
          displayName: s.displayName,
          rank: s.rank,
          points: s.points,
          gap: gapLabel(s.gapToLeader),
        })),
      "Nobody has scored this season yet.",
    ),
    pot: pot.ok
      ? { ok: true, total: formatEuros(pot.data.totalCents) }
      : { ok: false, message: pot.message },
    notes: widgetState(
      notes,
      (d) => d.notes.filter((n) => n.pinned).slice(0, HUB_NOTES),
      "Nothing is pinned. Pin a note on the Board.",
    ),
    counts: {
      urgent: chores.ok
        ? chores.data.chores.filter((c) => c.urgent).length
        : null,
      new: chores.ok ? chores.data.chores.filter((c) => c.isNew).length : null,
      messages: notes.ok ? recentNoteCount(notes.data.notes, ctx.now) : null,
    },
    shopping: shopping.ok
      ? { status: "ready", data: shopping.data.items }
      : { status: "unavailable", message: shopping.message },
  };
}
