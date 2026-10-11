"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useId, useState } from "react";
import {
  MemberCharacter,
  KioskModal,
  MarkdownBody,
  MessageRow,
  ModuleEmpty,
  ModulePanel,
  NotificationIcon,
  NotificationIconFace,
  notificationIconClass,
  notificationIconLabel,
} from "@baumy/ui";
import {
  headerClock,
  whoOf,
  type DashboardMember,
  type MessageView,
} from "@/lib/kiosk/dashboard";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import {
  MarkNotesSeen,
  type SeenAction,
} from "@/components/notes/mark-notes-seen";
import { useIdle } from "../use-idle";

// The dashboard's header (ADR 0005 §1, issue #65): the date, a big clock
// in Berlin time and three icons (owner ruling 2026-10-11, SPEC §12
// decision 36, issue #193): the star opens the Bounties tab, the basket
// opens the Shop tab with a badge of the items open on the list, and
// Messages opens its calm module, the notes not every member has seen yet
// (issue #153); opening those with someone picked marks them seen by that
// member only. There is no Urgent (decision 35) and no New.

/** A list, or why it could not be read; `count` overrides its length. */
type Listed<T> =
  { ok: true; rows: T[]; count?: number } | { ok: false; message: string };

function Clock({ serverNow }: { serverNow: string }) {
  // Starts from the server's `now` and keeps its offset from this device's
  // clock, so a drifting iPad (and e2e's moved server clock) shows house time.
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    const id = window.setInterval(
      () => setNow(new Date(Date.now() + offset)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [serverNow]);
  // The clock takes the room the icons leave (issue #127): its text scales
  // with that room (`cqi`), so on a narrower iPad it shrinks instead of
  // running into the icons. At 820px wide both are at full size.
  // "WEDNESDAY 30", the longest line the date wraps to, is about 10.6em of
  // the label font; "00:00" is about 4.9em of the display font.
  const { date, time } = headerClock(now);
  return (
    <div className="@container min-w-0 flex-1">
      <div
        data-testid="clock-date"
        className="font-label text-[min(20px,9cqi)] font-bold tracking-wider text-bm-muted uppercase"
      >
        {date}
      </div>
      <div
        data-testid="clock-time"
        className="mt-3 font-display text-[min(64px,19.5cqi)] leading-none whitespace-nowrap text-bm-text"
      >
        {time}
      </div>
    </div>
  );
}

/**
 * A header icon that is a way into a tab (Bounties, Shopping): a link, so
 * the tab opens as the footer's would, with no pop-up.
 */
function IconLink({
  href,
  icon,
  label,
  tone,
  count,
  testId,
}: {
  href: "/kiosk/chores" | "/kiosk/shopping";
  icon: "star" | "basket";
  label: string;
  tone: "yellow" | "amber";
  count?: number | null;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-icon={testId}
      aria-label={notificationIconLabel(label, count)}
      data-count={count ?? undefined}
      data-status={count === null ? "unavailable" : "ready"}
      className={notificationIconClass}
    >
      <NotificationIconFace
        icon={icon}
        label={label}
        count={count}
        tone={tone}
      />
    </Link>
  );
}

/** The Shopping icon, once brain's count has come in. */
function ShoppingIcon({ count }: { count: Promise<number | null> }) {
  return (
    <IconLink
      href="/kiosk/shopping"
      icon="basket"
      label="Shopping"
      tone="amber"
      count={use(count)}
      testId="shopping"
    />
  );
}

function MessagesModule({
  titleId,
  listed,
  members,
  actingId,
  seeNotes,
  onClose,
}: {
  titleId: string;
  listed: Listed<MessageView>;
  members: readonly DashboardMember[];
  /** The picked member, who has now seen them; null with nobody picked. */
  actingId: string | null;
  seeNotes: SeenAction;
  onClose: () => void;
}) {
  return (
    <ModulePanel
      title="Messages"
      titleId={titleId}
      icon="envelope"
      tone="pink"
      subtitle={
        listed.ok
          ? `${listed.count ?? listed.rows.length} not read by everyone yet`
          : "The notes board"
      }
      onClose={onClose}
    >
      {listed.ok && actingId ? (
        <MarkNotesSeen
          noteIds={listed.rows
            .filter((m) => !m.seenBy.includes(actingId))
            .map((m) => m.id)}
          action={seeNotes}
        />
      ) : null}
      {!listed.ok ? (
        <ModuleEmpty>{listed.message}</ModuleEmpty>
      ) : listed.rows.length === 0 ? (
        <ModuleEmpty>Everyone has read every note.</ModuleEmpty>
      ) : (
        <ul className="flex flex-col">
          {listed.rows.map((m) => {
            const who = whoOf(m.authorId, members);
            return (
              <MessageRow
                key={m.id}
                data-testid={`message-${m.title}`}
                who={
                  <MemberCharacter
                    sprites={who.member?.sprites}
                    name={who.member ? who.name : m.authorName}
                    colour={who.colour}
                    scale={4}
                  />
                }
                name={who.member ? who.name : m.authorName}
                colour={who.colour}
                when={m.when}
                title={m.title}
              >
                {m.bodyMd ? <MarkdownBody>{m.bodyMd}</MarkdownBody> : null}
              </MessageRow>
            );
          })}
        </ul>
      )}
    </ModulePanel>
  );
}

export function DashboardHeader({
  serverNow,
  shopping,
  messages,
  members,
  actingId,
  seeNotes,
}: {
  /** The instant the page was read at, ISO 8601. */
  serverNow: string;
  /**
   * How many items are open on the shopping list, streamed in (brain can be
   * slow); null when it could not be read, which shows no badge.
   */
  shopping: Promise<number | null>;
  messages: Listed<MessageView>;
  members: DashboardMember[];
  /** The member picked on the kiosk, or null. */
  actingId: string | null;
  /** acknowledge_note as the picked member (app/kiosk/note-actions.ts). */
  seeNotes: SeenAction;
}) {
  const [open, setOpen] = useState(false);
  // The Messages box keeps the rows it opened with: reading them marks them
  // seen (issue #153), and the last reader must not see a note vanish while
  // it is open. Closing it refreshes the page, so the count catches up.
  const [opened, setOpened] = useState<Listed<MessageView> | null>(null);
  const router = useRouter();
  const id = useId();
  const close = () => {
    if (open) {
      setOpened(null);
      router.refresh();
    }
    setOpen(false);
  };
  // The module left open closes after a minute untouched.
  useIdle(open, KIOSK_IDLE_MS, close);
  const count = (l: Listed<unknown>) =>
    l.ok ? (l.count ?? l.rows.length) : null;
  const titleId = `${id}-module`;

  return (
    <header className="flex h-[156px] shrink-0 items-center justify-between gap-6 px-6">
      <Clock serverNow={serverNow} />
      <div className="flex shrink-0 gap-6 pt-2 pr-2">
        <IconLink
          href="/kiosk/chores"
          icon="star"
          label="Bounties"
          tone="yellow"
          testId="bounties"
        />
        {/* Until brain answers, the basket shows with no badge. */}
        <Suspense
          fallback={
            <IconLink
              href="/kiosk/shopping"
              icon="basket"
              label="Shopping"
              tone="amber"
              count={null}
              testId="shopping"
            />
          }
        >
          <ShoppingIcon count={shopping} />
        </Suspense>
        <NotificationIcon
          icon="envelope"
          label="Messages"
          tone="pink"
          count={count(messages)}
          data-icon="messages"
          onClick={() => {
            setOpened(messages);
            setOpen(true);
          }}
        />
      </div>
      <KioskModal open={open} onClose={close} labelledBy={titleId}>
        {open ? (
          <MessagesModule
            titleId={titleId}
            listed={opened ?? messages}
            members={members}
            actingId={actingId}
            seeNotes={seeNotes}
            onClose={close}
          />
        ) : null}
      </KioskModal>
    </header>
  );
}
