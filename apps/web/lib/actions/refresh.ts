// What a write changes, and which pages show it (issue #215, SPEC §6.3).
//
// Each write action declares the data it changes as `refreshes` tags
// (define.ts). This one map turns a tag into the hub and kiosk pages that
// read that data, so the server-action wrappers stay generic: after a
// successful write they refresh every page for the action's tags on their own
// side (revalidate.ts). A page that reads new data gets its path added here,
// once, and every write that changes that data refreshes it.
//
// Pure: no Next.js import, so the registry test can check the map.

/** The data a write can change, from what the pages read. */
export const REFRESH_TAGS = [
  /** The bounties and their state (`list_chores`). */
  "chores",
  /** The activity log (`get_activity`). */
  "activity",
  /** Standings and streaks (`get_standings`, `get_streaks`). */
  "scores",
  /** The pot and the prize mode (`get_pot`). */
  "pot",
  /** Scheduled points changes and their history (`get_weights`). */
  "weights",
  /** The notes board (`list_notes`). */
  "notes",
  /** Who has seen which notes: the hub's Messages count. */
  "notes_seen",
  /** brain's shopping list (`list_shopping`). */
  "shopping",
  /** The household calendar (`list_events`). */
  "calendar",
  /** The reminders the kitchen screen shows (`list_reminders`). */
  "reminders",
  /** Members and invites (Admin → Members). */
  "members",
  /** A member's own name and character, shown in every layout. */
  "profile",
  /** The character gallery (Admin → Characters, Settings). */
  "avatars",
  /** A member's personal kiosk PIN. */
  "kiosk_pin",
  /** A member's Telegram link (Settings). */
  "telegram",
  /** Sessions, passkeys, sign-in methods (Settings → Security). */
  "security",
  /** A member's MCP connections (Settings → Connections). */
  "mcp_connections",
  /** Service tokens (Admin → Connections). */
  "service_tokens",
  /** Paired kitchen screens and their settings. */
  "kitchen_screens",
] as const;
export type RefreshTag = (typeof REFRESH_TAGS)[number];

/** Which app a server action belongs to: the hub, or the kitchen screen. */
export type RefreshSide = "hub" | "kiosk";

/**
 * One path to revalidate: a page, or with `layout` every page under it
 * (Next's `revalidatePath(path, "layout")`).
 */
export interface RefreshPath {
  path: string;
  layout?: true;
}

const page = (path: string): RefreshPath => ({ path });
const layout = (path: string): RefreshPath => ({ path, layout: true });

/**
 * Tag → the pages that read it, per side.
 *
 * Some entries are declarative only: no refreshing wrapper reaches them
 * today, because those writes run through the plain adapters on purpose.
 * `notes_seen` on the kiosk (app/kiosk/note-actions.ts), `telegram` (the
 * link code; `link_telegram` is brain's) and `reminders` on the kiosk
 * (app/kiosk/reminder-actions.ts). They still say which pages read the data,
 * for the day a wrapper does refresh it.
 */
export const TAG_PATHS: Record<
  RefreshTag,
  Record<RefreshSide, readonly RefreshPath[]>
> = {
  chores: {
    hub: [page("/chores"), page("/admin/chores")],
    kiosk: [page("/kiosk/chores"), page("/kiosk"), page("/kiosk/settings")],
  },
  activity: {
    hub: [page("/activity")],
    kiosk: [page("/kiosk/activity")],
  },
  scores: {
    hub: [page("/scores"), page("/")],
    kiosk: [page("/kiosk/scores")],
  },
  pot: {
    hub: [page("/pot"), page("/")],
    kiosk: [],
  },
  weights: {
    hub: [page("/admin/weights"), page("/chores"), page("/chores/history")],
    kiosk: [page("/kiosk/settings")],
  },
  notes: {
    hub: [page("/notes"), page("/")],
    kiosk: [page("/kiosk/notes"), page("/kiosk")],
  },
  // Only the home's count: re-rendering the Board while it is being read
  // would move notes under the reader (app/kiosk/note-actions.ts).
  notes_seen: {
    hub: [page("/")],
    kiosk: [page("/kiosk")],
  },
  shopping: {
    hub: [page("/shopping"), page("/")],
    kiosk: [page("/kiosk/shopping"), page("/kiosk")],
  },
  calendar: {
    hub: [page("/calendar"), page("/")],
    kiosk: [page("/kiosk/calendar"), page("/kiosk")],
  },
  reminders: {
    hub: [],
    kiosk: [layout("/kiosk")],
  },
  members: {
    hub: [page("/admin/members")],
    kiosk: [],
  },
  profile: {
    hub: [layout("/")],
    kiosk: [layout("/kiosk")],
  },
  avatars: {
    hub: [page("/admin/avatars"), page("/settings")],
    kiosk: [],
  },
  kiosk_pin: {
    hub: [page("/settings"), page("/")],
    kiosk: [],
  },
  telegram: {
    hub: [page("/settings")],
    kiosk: [],
  },
  security: {
    hub: [page("/settings/security")],
    kiosk: [],
  },
  mcp_connections: {
    hub: [page("/settings/connections")],
    kiosk: [],
  },
  service_tokens: {
    hub: [page("/admin/connections")],
    kiosk: [],
  },
  kitchen_screens: {
    hub: [page("/admin/kitchen-screen")],
    kiosk: [layout("/kiosk")],
  },
};

/** A path's identity, for de-duplicating and comparing. */
export function refreshKey(p: RefreshPath): string {
  return p.layout ? `${p.path} (layout)` : p.path;
}

/** Every path `tags` refresh on `side`, each once, in map order. */
export function refreshPaths(
  tags: readonly RefreshTag[],
  side: RefreshSide,
): RefreshPath[] {
  const seen = new Map<string, RefreshPath>();
  for (const tag of tags) {
    for (const p of TAG_PATHS[tag][side]) {
      if (!seen.has(refreshKey(p))) seen.set(refreshKey(p), p);
    }
  }
  return [...seen.values()];
}
