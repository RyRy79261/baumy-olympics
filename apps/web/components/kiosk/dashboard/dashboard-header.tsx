"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  ModuleBountyRow,
  MemberCharacter,
  KioskModal,
  MarkdownBody,
  MessageRow,
  ModuleEmpty,
  ModulePanel,
  NotificationIcon,
  SheetTabs,
  bountyActionClass,
  choreGlyph,
  cx,
  type DashboardTone,
  type PixelIconName,
} from "@baumy/ui";
import {
  bountyTabCounts,
  headerClock,
  inTab,
  whoOf,
  type BountyRowView,
  type BountyTab,
  type DashboardMember,
  type MessageView,
} from "@/lib/kiosk/dashboard";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import { useIdle } from "../use-idle";

// The dashboard's header (ADR 0005 §1, issue #65): the date, a big clock
// in Berlin time and at most three notification icons, Urgent, New and
// Messages. Each opens its calm module: the bounties (All, Consumables,
// Maintenance) with "I'll do it" leading to the log flow, or the notes
// board's last day.

/** A list, or why it could not be read; `count` overrides its length. */
type Listed<T> =
  { ok: true; rows: T[]; count?: number } | { ok: false; message: string };

type ModuleKey = "urgent" | "new" | "messages";

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
  const { date, time } = headerClock(now);
  return (
    <div className="min-w-0">
      <div
        data-testid="clock-date"
        className="font-label text-[20px] font-bold tracking-wider text-bm-muted uppercase"
      >
        {date}
      </div>
      <div
        data-testid="clock-time"
        className="mt-3 font-display text-[64px] leading-none text-bm-text"
      >
        {time}
      </div>
    </div>
  );
}

const TABS: readonly {
  key: BountyTab;
  label: string;
  tone?: DashboardTone;
}[] = [
  { key: "all", label: "All" },
  { key: "consumable", label: "Consumables", tone: "amber" },
  { key: "maintenance", label: "Maintenance", tone: "teal" },
];

function BountyList({ rows }: { rows: BountyRowView[] }) {
  if (rows.length === 0) {
    return <ModuleEmpty>Nothing here. Baumy approves.</ModuleEmpty>;
  }
  return (
    <ul className="flex flex-col">
      {rows.map((b) => (
        <ModuleBountyRow
          key={b.id}
          data-testid={`bounty-${b.name}`}
          glyph={choreGlyph(b.sprite)}
          name={b.name}
          kind={b.kind}
          isNew={b.isNew}
          streak={
            b.streak
              ? {
                  name: b.streak.holderName,
                  length: b.streak.length,
                  colour: b.streak.colour,
                }
              : null
          }
          due={b.due}
          points={b.points}
          action={
            !b.loggable ? (
              <span className={cx(bountyActionClass, "opacity-40")}>
                Not yet
              </span>
            ) : (
              <Link
                href={`/kiosk/chores?chore=${encodeURIComponent(b.id)}`}
                className={bountyActionClass}
                aria-label={`I'll do ${b.name}`}
              >
                I&apos;ll do it
              </Link>
            )
          }
        />
      ))}
    </ul>
  );
}

function BountyModule({
  title,
  titleId,
  icon,
  tone,
  subtitle,
  listed,
  onClose,
}: {
  title: string;
  titleId: string;
  icon: PixelIconName;
  tone: DashboardTone;
  subtitle: string;
  listed: Listed<BountyRowView>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<BountyTab>("all");
  const rows = listed.ok ? listed.rows : [];
  const counts = bountyTabCounts(rows);
  return (
    <ModulePanel
      title={title}
      titleId={titleId}
      icon={icon}
      tone={tone}
      subtitle={subtitle}
      onClose={onClose}
      tabs={
        listed.ok ? (
          <SheetTabs
            value={tab}
            onPick={setTab}
            items={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              count: counts[t.key],
              tone: t.tone ?? tone,
            }))}
          />
        ) : undefined
      }
    >
      {listed.ok ? (
        <BountyList rows={rows.filter((r) => inTab(r, tab))} />
      ) : (
        <ModuleEmpty>{listed.message}</ModuleEmpty>
      )}
    </ModulePanel>
  );
}

function MessagesModule({
  titleId,
  listed,
  members,
  onClose,
}: {
  titleId: string;
  listed: Listed<MessageView>;
  members: readonly DashboardMember[];
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
          ? `${listed.count ?? listed.rows.length} on the board in the last day`
          : "The notes board"
      }
      onClose={onClose}
    >
      {!listed.ok ? (
        <ModuleEmpty>{listed.message}</ModuleEmpty>
      ) : listed.rows.length === 0 ? (
        <ModuleEmpty>No new notes today.</ModuleEmpty>
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
                    avatar={who.member?.avatar}
                    memberId={m.authorId}
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
  urgent,
  fresh,
  messages,
  members,
}: {
  /** The instant the page was read at, ISO 8601. */
  serverNow: string;
  urgent: Listed<BountyRowView>;
  fresh: Listed<BountyRowView>;
  messages: Listed<MessageView>;
  members: DashboardMember[];
}) {
  const [open, setOpen] = useState<ModuleKey | null>(null);
  const id = useId();
  const close = () => setOpen(null);
  // A module left open closes after a minute untouched.
  useIdle(open !== null, KIOSK_IDLE_MS, close);
  const count = (l: Listed<unknown>) =>
    l.ok ? (l.count ?? l.rows.length) : null;
  const titleId = `${id}-module`;

  return (
    <header className="flex h-[156px] shrink-0 items-center justify-between px-6">
      <Clock serverNow={serverNow} />
      <div className="flex gap-6 pt-2 pr-2">
        <NotificationIcon
          icon="siren"
          label="Urgent"
          tone="red"
          count={count(urgent)}
          data-icon="urgent"
          onClick={() => setOpen("urgent")}
        />
        <NotificationIcon
          icon="star"
          label="New"
          tone="yellow"
          count={count(fresh)}
          data-icon="new"
          onClick={() => setOpen("new")}
        />
        <NotificationIcon
          icon="envelope"
          label="Messages"
          tone="pink"
          count={count(messages)}
          data-icon="messages"
          onClick={() => setOpen("messages")}
        />
      </div>
      <KioskModal open={open !== null} onClose={close} labelledBy={titleId}>
        {open === "urgent" ? (
          <BountyModule
            title="Urgent"
            titleId={titleId}
            icon="siren"
            tone="red"
            subtitle="Overdue or due before midnight"
            listed={urgent}
            onClose={close}
          />
        ) : open === "new" ? (
          <BountyModule
            title="New bounties"
            titleId={titleId}
            icon="star"
            tone="yellow"
            subtitle="Added in the last 3 days"
            listed={fresh}
            onClose={close}
          />
        ) : open === "messages" ? (
          <MessagesModule
            titleId={titleId}
            listed={messages}
            members={members}
            onClose={close}
          />
        ) : null}
      </KioskModal>
    </header>
  );
}
