import Link from "next/link";
import { Suspense, use, type ReactNode } from "react";
import type { Route } from "next";
import {
  AgendaItem,
  BountySummary,
  MarkdownBody,
  StatusTileFace,
  StickyNote,
  Widget,
  WidgetItem,
  WidgetList,
  buttonClass,
  cx,
  statusTileClass,
  type PixelIconName,
  type TabAccent,
} from "@baumy/ui";
import { BaumySheet } from "@/components/baumy/baumy-sheet";
import {
  ShoppingList,
  type ShoppingActions,
} from "@/components/shopping/shopping-list";
import { eventAccent } from "@/lib/calendar/view";
import type { HubData, HubLocal } from "@/lib/hub/load";
import { agendaTime } from "@/lib/hub/view";
import { LiveClock } from "./live-clock";

// The hub home on a phone or a laptop (SPEC §3.1; ADR 0005 Consequences):
// the kitchen screen's calm look in a normal scrolling page. On top, the
// clock and the three status tiles (Urgent, New, Messages), each dim at
// zero and a link to its slice. Then the urgent bounties and today's agenda
// in the wide column, the standings with the pot, the pinned notes (the
// Board) and the shopping list in the narrow one. Each widget keeps its own
// empty and unavailable state (lib/hub/load.ts). The page's own card (Post a
// reminder) stacks under the wide column's, so the short column leaves no
// gap (issue #152). It comes right after Today at every width, so what is
// seen and what is read or tabbed through keep one order.

const TILES: {
  key: "urgent" | "new" | "messages";
  label: string;
  icon: PixelIconName;
  accent: TabAccent;
  href: Route;
}[] = [
  {
    key: "urgent",
    label: "Urgent",
    icon: "siren",
    accent: "red",
    href: "/chores?show=urgent" as Route,
  },
  {
    key: "new",
    label: "New",
    icon: "star",
    accent: "yellow",
    href: "/chores?show=new" as Route,
  },
  {
    key: "messages",
    label: "Messages",
    icon: "envelope",
    accent: "pink",
    href: "/notes",
  },
];

/**
 * What the hub home shows. The calendar and the shopping list come from other
 * services (Google, brain), so the page may hand them over still on their
 * way: they then stream in, each in its own widget (issue #128), and the rest
 * of the page does not wait for them.
 */
export type HubView = HubLocal & {
  events: HubData["events"] | Promise<HubData["events"]>;
  shopping: HubData["shopping"] | Promise<HubData["shopping"]>;
};

/** What a streaming widget says until its read answers. */
export const WIDGET_LOADING = "Loading…";

/** `value` now, or `loading` until its promise settles, then `value`. */
function Deferred<T>({
  value,
  loading,
  children,
}: {
  value: T | Promise<T>;
  loading: ReactNode;
  children: (value: T) => ReactNode;
}) {
  if (!(value instanceof Promise)) return children(value);
  return (
    <Suspense fallback={loading}>
      <Settled promise={value}>{children}</Settled>
    </Suspense>
  );
}

function Settled<T>({
  promise,
  children,
}: {
  promise: Promise<T>;
  children: (value: T) => ReactNode;
}) {
  return children(use(promise));
}

function EventsWidget(
  props:
    | { loading: true }
    | {
        loading?: false;
        events: HubData["events"];
        memberColors: Record<string, string>;
      },
) {
  const events = props.loading ? null : props.events;
  return (
    <Widget
      id="widget-events"
      data-testid="widget-events"
      title="Today"
      status={events ? events.status : "loading"}
      message={
        !events
          ? WIDGET_LOADING
          : events.status === "ready"
            ? undefined
            : events.message
      }
      action={<More href="/calendar" label="Calendar" />}
    >
      {events?.status === "ready" && !props.loading ? (
        <ul className="flex flex-col divide-y-2 divide-bm-line">
          {events.data.map((e) => (
            <AgendaItem
              key={e.id}
              {...agendaTime(e.time)}
              title={e.title}
              secondary={e.location ?? undefined}
              accent={eventAccent(e, props.memberColors)}
            />
          ))}
        </ul>
      ) : null}
    </Widget>
  );
}

function ShoppingWidget(
  props:
    | { loading: true }
    | { loading?: false; list: HubData["shopping"]; actions: ShoppingActions },
) {
  const list = props.loading ? null : props.list;
  return (
    <Widget
      id="widget-shopping"
      data-testid="widget-shopping"
      title="Shopping list"
      status={
        !list
          ? "loading"
          : list.status === "unavailable"
            ? "unavailable"
            : "ready"
      }
      message={
        !list
          ? WIDGET_LOADING
          : list.status === "unavailable"
            ? list.message
            : undefined
      }
      action={<More href="/shopping" label="List" />}
    >
      {!list || props.loading || list.status === "unavailable" ? null : (
        <ShoppingList
          items={list.status === "ready" ? list.data : []}
          canEdit
          actions={props.actions}
          idPrefix="hub-shopping"
        />
      )}
    </Widget>
  );
}

/** How many urgent bounties the hub lists before "N more". */
export const HUB_BOUNTIES = 6;

function More({ href, label }: { href: Route; label: string }) {
  return (
    <Link href={href} className={buttonClass("ghost", "default", "px-2")}>
      {label}
    </Link>
  );
}

export function HubHome({
  hub,
  memberColors,
  shopping,
  voice = false,
  children,
}: {
  hub: HubView;
  /** Member id → colour, for the agenda's bars. */
  memberColors: Record<string, string>;
  shopping: ShoppingActions;
  /** Offer hold-to-speak in the Baumy sheet (a transcriber is configured). */
  voice?: boolean;
  /** A card of the page's own, stacked last in the wide column. */
  children?: ReactNode;
}) {
  const { chores, standings, pot, notes, counts } = hub;
  return (
    // From lg up the page keeps clear of the corner Baumy's button sits in
    // (fixed, bottom right), so it never covers a widget's link or the
    // shopping list's Add; from 2xl the page's own margin is wide enough.
    <div className="lg:pr-32 2xl:pr-0">
      <section
        aria-label="At a glance"
        data-testid="hub-glance"
        className="mb-6 flex flex-wrap items-end justify-between gap-4"
      >
        <LiveClock serverNow={hub.now} />
        <nav aria-label="Needs attention" className="flex gap-3">
          {TILES.map((t) => {
            // Null: the read behind it failed. The tile says so rather
            // than showing a zero that looks real.
            const n = counts[t.key];
            return (
              <Link
                key={t.key}
                href={t.href}
                data-testid={`hub-tile-${t.key}`}
                aria-label={`${t.label}: ${n ?? "unavailable"}`}
                className={statusTileClass(n !== null && n > 0)}
              >
                <StatusTileFace
                  icon={t.icon}
                  label={t.label}
                  count={n}
                  accent={t.accent}
                />
              </Link>
            );
          })}
        </nav>
      </section>

      <div
        data-testid="hub"
        className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Widget
            id="widget-chores"
            data-testid="widget-chores"
            title="Urgent bounties"
            status={chores.status}
            message={chores.status === "ready" ? undefined : chores.message}
            action={<More href="/chores" label="All bounties" />}
          >
            {chores.status === "ready" ? (
              <ul className="flex flex-col divide-y-2 divide-bm-line">
                {chores.data.slice(0, HUB_BOUNTIES).map((c) => (
                  <BountySummary
                    key={c.id}
                    data-testid={`hub-chore-${c.name}`}
                    name={c.name}
                    sprite={c.sprite}
                    kind={c.kind}
                    points={c.points}
                    streak={c.streak}
                    status={c.overdue ? `${c.when} (overdue)` : c.when}
                    urgent={c.overdue}
                    isNew={c.isNew}
                  />
                ))}
                {chores.data.length > HUB_BOUNTIES ? (
                  <li className="pt-3">
                    <Link
                      href={"/chores?show=urgent" as Route}
                      className="font-label text-sm font-bold text-bm-muted uppercase hover:text-bm-text"
                    >
                      +{chores.data.length - HUB_BOUNTIES} more urgent
                    </Link>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </Widget>

          <Deferred value={hub.events} loading={<EventsWidget loading />}>
            {(events) => (
              <EventsWidget events={events} memberColors={memberColors} />
            )}
          </Deferred>

          {children}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Widget
            id="widget-leaderboard"
            data-testid="widget-leaderboard"
            title="Standings"
            status={standings.status}
            message={
              standings.status === "ready" ? undefined : standings.message
            }
            action={<More href="/scores" label="Scores" />}
            footer={
              <p
                data-testid="hub-pot"
                className={cx(
                  "border-t-2 border-bm-line pt-3 font-label text-sm uppercase",
                  pot.ok ? "text-bm-muted" : "text-bm-red",
                )}
              >
                {pot.ok ? (
                  <>
                    Pot: <span className="text-bm-yellow">{pot.total}</span>
                  </>
                ) : (
                  pot.message
                )}
              </p>
            }
          >
            {standings.status === "ready" ? (
              <WidgetList>
                {standings.data.map((s) => (
                  <WidgetItem
                    key={s.memberId}
                    primary={`${s.rank}. ${s.displayName}`}
                    secondary={s.gap}
                    trailing={
                      <span className="font-display text-sm text-bm-yellow">
                        {s.points} pts
                      </span>
                    }
                  />
                ))}
              </WidgetList>
            ) : null}
          </Widget>

          <Widget
            id="widget-notes"
            data-testid="widget-notes"
            title="Board"
            status={notes.status}
            message={notes.status === "ready" ? undefined : notes.message}
            action={<More href="/notes" label="All notes" />}
          >
            {notes.status === "ready" ? (
              <div className="flex flex-col gap-3">
                {notes.data.map((n) => (
                  <StickyNote
                    key={n.id}
                    data-testid={`hub-note-${n.title}`}
                    title={n.title}
                    color={n.color}
                    pinned
                    clamp
                    className="overflow-hidden"
                  >
                    {n.bodyMd ? <MarkdownBody>{n.bodyMd}</MarkdownBody> : null}
                  </StickyNote>
                ))}
              </div>
            ) : null}
          </Widget>

          <Deferred value={hub.shopping} loading={<ShoppingWidget loading />}>
            {(list) => <ShoppingWidget list={list} actions={shopping} />}
          </Deferred>
        </div>
      </div>
      <BaumySheet voice={voice} />
    </div>
  );
}
