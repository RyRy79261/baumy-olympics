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
import { RemoveNote } from "@/components/notes/remove-note";
import type { FormAction } from "@/components/use-action-form";
import type { DeleteNoteData } from "@/lib/actions/notes";
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
  loading = false,
  testId,
}: {
  href: "/kiosk/chores" | "/kiosk/shopping";
  icon: "star" | "basket";
  label: string;
  tone: "yellow" | "amber";
  count?: number | null;
  /**
   * Its count is still on its way: dim, no badge, and only its name for a
   * screen reader, never "unavailable" before anything has failed.
   */
  loading?: boolean;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-icon={testId}
      aria-label={loading ? label : notificationIconLabel(label, count)}
      aria-busy={loading || undefined}
      data-count={loading ? undefined : (count ?? undefined)}
      data-status={
        loading ? "loading" : count === null ? "unavailable" : "ready"
      }
      className={notificationIconClass}
    >
      <NotificationIconFace
        icon={icon}
        label={label}
        count={loading ? 0 : count}
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
  removeNote,
  onClose,
}: {
  titleId: string;
  listed: Listed<MessageView>;
  members: readonly DashboardMember[];
  /** The picked member, who has now seen them; null with nobody picked. */
  actingId: string | null;
  seeNotes: SeenAction;
  /** delete_note as the picked member, no PIN (issue #194). */
  removeNote: FormAction<DeleteNoteData>;
  onClose: () => void;
}) {
  // A note removed here leaves the list at once; closing refreshes the rest.
  const [removed, setRemoved] = useState<readonly string[]>([]);
  const rows = listed.ok
    ? listed.rows.filter((m) => !removed.includes(m.id))
    : [];
  // In step with a Remove here: the notes removed were in the count.
  const unread = listed.ok
    ? Math.max(0, (listed.count ?? listed.rows.length) - removed.length)
    : 0;
  const pinLabel = `${actingId ? whoOf(actingId, members).name : "Your"}'s PIN`;
  return (
    <ModulePanel
      title="Messages"
      titleId={titleId}
      icon="envelope"
      tone="pink"
      subtitle={
        listed.ok ? `${unread} not read by everyone yet` : "The notes board"
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
      ) : rows.length === 0 ? (
        <ModuleEmpty>No new notes. Older ones are on the Board.</ModuleEmpty>
      ) : (
        <>
          {actingId ? null : (
            <p
              data-testid="messages-pick-hint"
              className="pb-4 font-body text-[20px] text-bm-muted"
            >
              To remove a note, close this, open Board at the bottom and tap
              your avatar there.
            </p>
          )}
          <ul className="flex flex-col">
            {rows.map((m) => {
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
                  action={
                    actingId ? (
                      <RemoveNote
                        note={m}
                        action={removeNote}
                        pinLabel={pinLabel}
                        onRemoved={(noteId) =>
                          setRemoved((ids) => [...ids, noteId])
                        }
                      />
                    ) : undefined
                  }
                >
                  {m.bodyMd ? <MarkdownBody>{m.bodyMd}</MarkdownBody> : null}
                </MessageRow>
              );
            })}
          </ul>
        </>
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
  removeNote,
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
  /** delete_note as the picked member (app/kiosk/actions.ts). */
  removeNote: FormAction<DeleteNoteData>;
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
        {/* Until brain answers, the basket shows dim, as loading. */}
        <Suspense
          fallback={
            <IconLink
              href="/kiosk/shopping"
              icon="basket"
              label="Shopping"
              tone="amber"
              loading
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
            removeNote={removeNote}
            onClose={close}
          />
        ) : null}
      </KioskModal>
    </header>
  );
}
