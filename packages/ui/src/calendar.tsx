import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// NEUTRAL PLACEHOLDERS for the house calendar (SPEC §3.3; issue #7 restyles
// them here): a grid of days for the Day, Week and Month views, one day's
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
          className="hidden grid-cols-7 gap-1 text-center text-xs uppercase tracking-widest text-neutral-600 sm:grid"
        >
          {WEEKDAY_NAMES.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      ) : null}
      <ol
        className={cx(
          "grid gap-1",
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
  today = false,
  muted = false,
  tall = false,
  children,
  ...props
}: {
  /** "Fri 15 Jan" or, in the month view, "15". */
  label: string;
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
        "flex min-w-0 flex-col gap-1 rounded border bg-white p-2",
        tall ? "min-h-40" : "min-h-24",
        today ? "border-neutral-900" : "border-neutral-300",
        muted && "bg-neutral-50 text-neutral-500",
      )}
      {...props}
    >
      <span className={cx("text-sm", today && "font-semibold")}>{label}</span>
      {children}
    </li>
  );
}

export interface CalendarEventButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  /** "19:00" or "All day". */
  time: string;
  kiosk?: boolean;
}

/** An event in a day: tap it to see or change it. */
export function CalendarEventButton({
  title,
  time,
  kiosk = false,
  className,
  type = "button",
  ...props
}: CalendarEventButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "flex w-full min-w-0 flex-col items-start rounded border border-neutral-300 bg-neutral-50 px-2 text-left",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
        kiosk ? "min-h-14 py-2 text-base" : "min-h-11 py-1 text-sm",
        className,
      )}
      {...props}
    >
      <span className="text-xs text-neutral-600">{time}</span>
      <span className="w-full truncate font-medium">{title}</span>
    </button>
  );
}
