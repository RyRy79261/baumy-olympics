import Link from "next/link";
import type { Route } from "next";
import {
  HubGrid,
  MarkdownBody,
  StickyNote,
  Widget,
  WidgetItem,
  WidgetList,
  buttonClass,
  cx,
} from "@baumy/ui";
import type { HubData } from "@/lib/hub/load";
import { BaumySheet } from "@/components/baumy/baumy-sheet";
import {
  ShoppingList,
  type ShoppingActions,
} from "@/components/shopping/shopping-list";
import { LiveClock } from "./live-clock";

// The hub (SPEC §3.1, issue #20): one screen with the clock, today's events,
// the chores that are due with their streak holders, the leaderboard and the
// pot, the pinned notes, brain's shopping list and the Baumy button. The
// same widgets on a phone (`/`, stacked) and on the kitchen screen (`/kiosk`,
// three columns by two rows that never scroll: each widget clips what does
// not fit). Each widget shows its own empty or unavailable state.
//
// Layout only: the look is the pixel kit's (packages/ui, issue #64).

export interface HubLinks {
  calendar: Route;
  chores: Route;
  notes: Route;
  shopping: Route;
  /** The scoreboard; the kiosk has none. */
  scores?: Route;
}

function More({
  href,
  label,
  kiosk,
}: {
  href: Route;
  label: string;
  kiosk: boolean;
}) {
  return (
    <Link
      href={href}
      className={buttonClass("ghost", kiosk ? "kiosk" : "default", "px-2")}
    >
      {label}
    </Link>
  );
}

export function HubDashboard({
  hub,
  links,
  kiosk = false,
  actingName,
  voice = false,
  shopping,
}: {
  hub: HubData;
  links: HubLinks;
  /**
   * The shopping widget's writes, and whether they are offered (on the
   * kiosk only once someone has tapped their avatar).
   */
  shopping: { actions: ShoppingActions; canEdit: boolean };
  kiosk?: boolean;
  /** The kiosk's acting member, for the PIN pad of Baumy's proposals. */
  actingName?: string;
  /** Offer hold-to-speak in the Baumy sheet (a transcriber is configured). */
  voice?: boolean;
}) {
  const { events, chores, standings, pot, notes } = hub;
  const list = hub.shopping;
  return (
    <>
      <HubGrid kiosk={kiosk} data-testid="hub">
        <div className="flex min-h-0 flex-col gap-3">
          <section
            aria-label="Clock"
            className="border-2 border-bm-line bg-bm-surface p-3"
          >
            <LiveClock serverNow={hub.now} kiosk={kiosk} />
          </section>
          <Widget
            id="widget-events"
            data-testid="widget-events"
            title="Today"
            className="flex-1"
            status={events.status}
            message={events.status === "ready" ? undefined : events.message}
            action={
              <More href={links.calendar} label="Calendar" kiosk={kiosk} />
            }
          >
            {events.status === "ready" ? (
              <WidgetList>
                {events.data.map((e) => (
                  <WidgetItem
                    key={e.id}
                    primary={e.title}
                    secondary={e.location ?? undefined}
                    trailing={e.time}
                  />
                ))}
              </WidgetList>
            ) : null}
          </Widget>
        </div>

        <Widget
          id="widget-chores"
          data-testid="widget-chores"
          title="Chores due"
          status={chores.status}
          message={chores.status === "ready" ? undefined : chores.message}
          action={<More href={links.chores} label="Chores" kiosk={kiosk} />}
        >
          {chores.status === "ready" ? (
            <WidgetList>
              {chores.data.map((c) => (
                <WidgetItem
                  key={c.id}
                  data-testid={`hub-chore-${c.name}`}
                  primary={c.overdue ? `${c.name} (overdue)` : c.name}
                  secondary={`${c.when} · ${c.streak}`}
                />
              ))}
            </WidgetList>
          ) : null}
        </Widget>

        <Widget
          id="widget-leaderboard"
          data-testid="widget-leaderboard"
          title="Leaderboard"
          status={standings.status}
          message={standings.status === "ready" ? undefined : standings.message}
          footer={
            <p
              data-testid="hub-pot"
              className={cx(
                "text-sm",
                pot.ok ? "font-medium text-bm-text" : "text-bm-red",
              )}
            >
              {pot.ok ? `Pot: ${pot.total}` : pot.message}
            </p>
          }
          action={
            links.scores ? (
              <More href={links.scores} label="Scores" kiosk={kiosk} />
            ) : undefined
          }
        >
          {standings.status === "ready" ? (
            <WidgetList>
              {standings.data.map((s) => (
                <WidgetItem
                  key={s.memberId}
                  primary={`${s.rank}. ${s.displayName}`}
                  secondary={s.gap}
                  trailing={`${s.points} pts`}
                />
              ))}
            </WidgetList>
          ) : null}
        </Widget>

        <Widget
          id="widget-notes"
          data-testid="widget-notes"
          title="Pinned notes"
          className={kiosk ? "col-span-2" : "md:col-span-2"}
          status={notes.status}
          message={notes.status === "ready" ? undefined : notes.message}
          action={<More href={links.notes} label="All notes" kiosk={kiosk} />}
        >
          {notes.status === "ready" ? (
            <div
              className={cx(
                "grid gap-3",
                kiosk ? "h-full grid-cols-2" : "grid-cols-1 sm:grid-cols-2",
              )}
            >
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

        <Widget
          id="widget-shopping"
          data-testid="widget-shopping"
          title="Shopping list"
          status={list.status === "unavailable" ? "unavailable" : "ready"}
          message={list.status === "unavailable" ? list.message : undefined}
          action={<More href={links.shopping} label="List" kiosk={kiosk} />}
        >
          {list.status === "unavailable" ? null : (
            <ShoppingList
              items={list.status === "ready" ? list.data : []}
              kiosk={kiosk}
              canEdit={shopping.canEdit}
              actions={shopping.actions}
              idPrefix="hub-shopping"
            />
          )}
        </Widget>
      </HubGrid>
      <BaumySheet kiosk={kiosk} actingName={actingName} voice={voice} />
    </>
  );
}
