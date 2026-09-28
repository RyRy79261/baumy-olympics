import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// The house calendar in the pixel kit (SPEC §3.3; ADR 0005, the prototype's
// month grid): a grid of days for the Day, Week and Month views, one day's
// cell, and an event button that opens it. They take plain props and know
// nothing about Google or the actions. Every tap target is at least 44px,
// 56px with `kiosk`.

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The days of a view. `columns` 1 is the day view; 7 lays the days out as a
 * week (Monday first) from the `sm` breakpoint up, one under the other on a
 * phone. `weekdays` adds the Mon…Sun header row (month view).
 */
export function CalendarGrid({
  columns,
  weekdays = false,
  label,
  children,
}: {
  columns: 1 | 7;
  weekdays?: boolean;
  /** What the grid shows, for screen readers ("Week of 11 Jan"). */
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="region" aria-label={label} className="flex flex-col gap-1">
      {weekdays ? (
        <div
          aria-hidden="true"
          className="hidden grid-cols-7 gap-1.5 text-center font-label text-sm font-bold text-bm-muted uppercase sm:grid"
        >
          {WEEKDAY_NAMES.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      ) : null}
      <ol
        className={cx(
          "grid gap-1.5",
          columns === 7 ? "grid-cols-1 sm:grid-cols-7" : "grid-cols-1",
        )}
      >
        {children}
      </ol>
    </div>
  );
}

/** One day in the grid: its label, then its events. */
export function CalendarDayCell({
  label,
  shortLabel,
  today = false,
  muted = false,
  tall = false,
  children,
  ...props
}: {
  /** "Fri 15 Jan" or, in the month view, "15". */
  label: string;
  /**
   * The month view's "15": shown instead of `label` from sm up, where the
   * grid's weekday row says the rest. On a phone the days stack, so the
   * full label shows there.
   */
  shortLabel?: string;
  /** Marks the current day (`aria-current="date"`). */
  today?: boolean;
  /** A day outside the month the month view shows. */
  muted?: boolean;
  /** The day and week views give each day more room. */
  tall?: boolean;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <li
      aria-current={today ? "date" : undefined}
      className={cx(
        // Square pixel cells (no notched corners, which read as rounded at
        // this size): a 2px line frame, today a 4px violet one.
        "relative flex min-w-0 flex-col gap-1 p-1.5",
        tall ? "min-h-40" : "min-h-24 sm:min-h-32",
        today
          ? "border-4 border-bm-violet bg-bm-raised"
          : muted
            ? "border-2 border-bm-line opacity-40"
            : "border-2 border-bm-line bg-bm-surface",
      )}
      {...props}
    >
      <span
        className={cx(
          "w-fit px-1 font-display leading-6",
          shortLabel ? "text-xs sm:text-base" : "text-xs",
          today ? "bg-bm-violet text-bm-ink" : "text-bm-text",
        )}
      >
        {shortLabel ? (
          <>
            <span className="sm:hidden">{label}</span>
            <span className="max-sm:hidden" aria-hidden="true">
              {shortLabel}
            </span>
            <span className="max-sm:hidden sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      {children}
    </li>
  );
}

export interface CalendarEventButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  /** "19:00" or "All day". */
  time: string;
  /**
   * The chip's colour (a CSS colour): whose event it is, as in the
   * prototype's month grid. Violet without one.
   */
  accent?: string;
  kiosk?: boolean;
}

/** An event in a day: tap it to see or change it. */
export function CalendarEventButton({
  title,
  time,
  accent,
  kiosk = false,
  className,
  style,
  type = "button",
  ...props
}: CalendarEventButtonProps) {
  return (
    <button
      type={type}
      style={accent ? { ["--chip" as string]: accent, ...style } : style}
      className={cx(
        "flex w-full min-w-0 flex-col items-start border-l-[5px] border-(--chip) bg-(--chip)/15 px-2 text-left text-bm-text [--chip:var(--color-bm-violet)]",
        kiosk ? "min-h-14 py-2 text-lg" : "min-h-11 py-1 text-base",
        className,
      )}
      {...props}
    >
      <span className="font-label text-xs text-bm-muted uppercase">{time}</span>
      <span className="w-full truncate font-medium">{title}</span>
    </button>
  );
}

/**
 * An event in a kitchen-screen month cell (the prototype's month grid): one
 * line, a bar in its colour, not a button of its own. The day it sits in is
 * the target; it opens that day, where each event is a full button.
 */
export function CalendarChip({
  title,
  accent,
  kiosk = false,
}: {
  title: string;
  /** A CSS colour; violet without one. */
  accent?: string;
  kiosk?: boolean;
}) {
  return (
    <span
      style={accent ? { ["--chip" as string]: accent } : undefined}
      className={cx(
        "block w-full min-w-0 truncate border-l-4 border-(--chip) bg-(--chip)/15 px-1.5 leading-7 text-bm-text [--chip:var(--color-bm-violet)]",
        kiosk ? "text-base" : "text-sm",
      )}
    >
      {title}
    </span>
  );
}

/** "+2 more" under a month cell's chips. */
export function CalendarMore({ count }: { count: number }) {
  return (
    <span className="px-1 font-label text-xs font-bold text-bm-muted uppercase">
      +{count} more
    </span>
  );
}
