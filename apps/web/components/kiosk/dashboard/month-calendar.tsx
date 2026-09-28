"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { addDaysToDateKey } from "@baumy/core";
import {
  DayEventRow,
  EventChip,
  Housemate,
  MonthDayCell,
  PixelScroll,
  WeekdayRow,
  WhoLine,
  cx,
  kioskArrowClass,
  todayButtonClass,
} from "@baumy/ui";
import {
  GRID_GAP,
  addMonths,
  chipsFor,
  chipsThatFit,
  dayHeading,
  longDay,
  monthTitle,
  plannedLabel,
  sheetTime,
  whoOf,
  type DashboardMember,
  type MonthCellView,
} from "@/lib/kiosk/dashboard";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import { useIdle } from "../use-idle";

// The dashboard's calendar (ADR 0005 §1, issue #65): one full-width month,
// the only home view, with ◀ ▶ and Today. Each day shows the event chips
// that fit, then "+N more"; tapping a day opens its sheet with every event,
// large, stepping day by day with ◀ ▶. Months move by links, so the server
// reads each month's events (list_events); a step into another month does
// the same with the day kept open.

const monthHref = (month: string, day?: string) =>
  `/kiosk?month=${month}${day ? `&day=${day}` : ""}` as Route;

/** How many chip rows fit a cell, measured from the grid's real height. */
function useChipRows(rows: number) {
  const ref = useRef<HTMLDivElement>(null);
  // The same first value on the server and the client; measured after.
  const [fit, setFit] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setFit(chipsThatFit((el.clientHeight - GRID_GAP * (rows - 1)) / rows));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);
  return [ref, fit] as const;
}

function DaySheet({
  cell,
  today,
  members,
  onStep,
  onClose,
}: {
  cell: MonthCellView;
  today: string;
  members: readonly DashboardMember[];
  onStep: (n: -1 | 1) => void;
  onClose: () => void;
}) {
  const { over, title } = dayHeading(cell.day, today);
  const past = cell.past;
  // Over the calendar only (the header stays readable), the month bar dimmed
  // above it: a non-modal dialog, so the idle reset and the auto-refresh
  // still see it open. The idle reset closes it through the DOM (onClose).
  return (
    <dialog
      open
      aria-label={longDay(cell.day)}
      data-sheet={cell.day}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="absolute top-0 right-6 bottom-16 left-6 z-10 m-0 flex h-auto max-h-none w-auto max-w-none flex-col border-0 bg-[rgb(8_4_14/0.7)] px-2 pt-[76px] pb-2 text-bm-text motion-safe:animate-pixel-in"
    >
      <section
        className={cx(
          "pixel-frame flex min-h-0 flex-1 flex-col bg-[#1e1432] [--pf-w:4px]",
          cell.today && "[--pf:var(--color-bm-violet)]",
        )}
      >
        <header className="flex items-center gap-4 px-6 pt-6 pb-4">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => onStep(-1)}
            className={cx(kioskArrowClass, "size-16")}
          >
            ◀
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div
              className={cx(
                "font-label text-[15px] font-bold uppercase",
                cell.today ? "text-bm-violet" : "text-bm-muted",
              )}
            >
              {over}
            </div>
            <h2 className="mt-3 font-display text-[26px] leading-none text-bm-text">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => onStep(1)}
            className={cx(kioskArrowClass, "size-16")}
          >
            ▶
          </button>
        </header>
        <p className="h-[30px] px-6 pb-3 text-center font-label text-[14px] text-bm-dim uppercase">
          {plannedLabel(cell.events.length, past)}
        </p>
        <div className="mx-6 h-[3px] shrink-0 bg-bm-line" />
        <div className="flex min-h-0 flex-1 flex-col pt-2 pr-4 pl-6">
          {cell.events.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-10 text-center">
              <p className="font-display text-[22px] text-bm-muted">
                NOTHING PLANNED
              </p>
              <p className="font-body text-[28px] text-bm-dim">
                A free day. Baumy suggests a nap.
              </p>
            </div>
          ) : (
            <PixelScroll tone="#1e1432">
              {cell.events.map((e) => {
                const who = whoOf(e.addedBy, members);
                const time = sheetTime(e, cell.day);
                return (
                  <DayEventRow
                    key={e.id}
                    start={time.start}
                    end={time.end}
                    colour={who.colour}
                    title={e.title}
                    dim={past}
                    who={
                      <WhoLine
                        name={who.name}
                        colour={who.colour}
                        who={
                          who.member ? (
                            <Housemate
                              avatar={who.member.avatar}
                              memberId={who.member.id}
                              scale={2}
                            />
                          ) : undefined
                        }
                      />
                    }
                  />
                );
              })}
            </PixelScroll>
          )}
        </div>
        <div className="flex shrink-0 justify-center px-6 pt-3 pb-6">
          <button
            type="button"
            data-close-day
            onClick={onClose}
            className="pixel-frame flex h-[72px] w-full items-center justify-center gap-4 bg-bm-raised font-display text-[18px] text-bm-text [--pf-w:4px] [--pf:var(--color-bm-line)]"
          >
            <span className="text-bm-muted">×</span> CLOSE
          </button>
        </div>
      </section>
    </dialog>
  );
}

export function MonthCalendar({
  month,
  today,
  cells,
  members,
  initialDay,
  status,
}: {
  /** "YYYY-MM". */
  month: string;
  today: string;
  cells: MonthCellView[];
  members: DashboardMember[];
  /** The day whose sheet is open on arrival (`?day=`). */
  initialDay: string | null;
  /** Why the events could not be read, if they could not. */
  status: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(initialDay);
  const rows = cells.length / 7;
  const [gridRef, fit] = useChipRows(rows);
  const onThisMonth = month === today.slice(0, 7);
  const cell = cells.find((c) => c.day === open) ?? null;
  // A minute untouched: the sheet closes and the home is back on this month,
  // so the next person finds the screen as it always is.
  useIdle(cell !== null || !onThisMonth, KIOSK_IDLE_MS, () => {
    setOpen(null);
    if (!onThisMonth) router.replace("/kiosk");
  });

  const step = (n: -1 | 1) => {
    if (!open) return;
    const day = addDaysToDateKey(open, n);
    // Another month: its grid and events come from the server.
    if (!day.startsWith(month)) router.replace(monthHref(day.slice(0, 7), day));
    else setOpen(day);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 px-6 pb-16">
      <div className="flex h-16 shrink-0 items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={monthHref(addMonths(month, -1))}
            aria-label="Previous month"
            className={cx(kioskArrowClass, "size-14")}
          >
            ◀
          </Link>
          <h2
            data-testid="month-title"
            className="w-[330px] text-center font-display text-[20px] leading-none text-bm-text"
          >
            {monthTitle(month)}
          </h2>
          <Link
            href={monthHref(addMonths(month, 1))}
            aria-label="Next month"
            className={cx(kioskArrowClass, "size-14")}
          >
            ▶
          </Link>
        </div>
        <Link href="/kiosk" className={todayButtonClass(onThisMonth)}>
          Today
        </Link>
      </div>
      {status ? (
        <p
          role="status"
          data-testid="calendar-status"
          className="shrink-0 font-label text-[14px] text-bm-muted uppercase"
        >
          {status}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <WeekdayRow gap={GRID_GAP} />
        <div
          ref={gridRef}
          data-month={month}
          className="grid min-h-0 flex-1 grid-cols-7"
          style={{
            gap: GRID_GAP,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {cells.map((c) => {
            const { shown, more } = chipsFor(c.events, fit);
            return (
              <MonthDayCell
                key={c.day}
                data-date={c.day}
                aria-label={`${longDay(c.day)}: ${c.events.length === 0 ? "nothing planned" : plannedLabel(c.events.length, false)}`}
                date={c.date}
                inMonth={c.inMonth}
                today={c.today}
                past={c.past}
                weekend={c.weekend}
                more={more}
                onClick={() => setOpen(c.day)}
              >
                {shown.map((e) => (
                  <EventChip
                    key={e.id}
                    title={e.title}
                    colour={whoOf(e.addedBy, members).colour}
                    dim={c.past}
                  />
                ))}
              </MonthDayCell>
            );
          })}
        </div>
      </div>
      {cell ? (
        <DaySheet
          cell={cell}
          today={today}
          members={members}
          onStep={step}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
