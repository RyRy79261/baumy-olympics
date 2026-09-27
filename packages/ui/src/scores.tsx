import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cx } from "./cx";

// NEUTRAL PLACEHOLDERS for the scoreboard and the pot (SPEC §3.2, §7; issue
// #7 restyles them here): a plain table, a points figure whose provisional
// part is dimmed, the streak flame counter and a big stat. They take plain
// props and hold no game logic.

/** A table that scrolls sideways on a narrow screen instead of squashing. */
export function Table({
  caption,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLTableElement> & { caption?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cx("w-full border-collapse text-left text-sm", className)}
        {...props}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({
  className,
  numeric = false,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        "border-b border-neutral-300 px-2 py-2 font-medium text-neutral-600",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric = false,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cx(
        "border-b border-neutral-200 px-2 py-2 text-neutral-900",
        numeric && "text-right font-mono",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Points, with the part that can still be disputed dimmed (SPEC §4.1:
 * optimistic pending claims count provisionally). Screen readers hear the
 * provisional part as words, not as a colour.
 */
export function Points({
  points,
  provisional = 0,
  className,
}: {
  points: number;
  /** How much of `points` is still provisional. */
  provisional?: number;
  className?: string;
}) {
  return (
    <span className={cx("font-mono", className)}>
      <span data-testid="points">{points}</span>
      {provisional !== 0 ? (
        <span
          data-provisional
          className="ml-1 text-xs text-neutral-900 opacity-50"
        >
          ({provisional} pending)
        </span>
      ) : null}
    </span>
  );
}

/**
 * The streak flame counter (SPEC §7 "Juice"). PLACEHOLDER: a bordered
 * counter; the pixel flame sprite replaces the box, keeping `length` and
 * `current` (a run still going burns, a broken one is shown out).
 */
export function StreakFlame({
  length,
  current = true,
}: {
  length: number;
  current?: boolean;
}) {
  return (
    <span
      data-streak={length}
      data-state={current ? "burning" : "out"}
      className={cx(
        "inline-flex min-w-11 items-center justify-center gap-1 rounded border px-2 font-mono text-sm",
        current
          ? "border-neutral-900 font-semibold"
          : "border-neutral-300 text-neutral-600",
      )}
    >
      <span aria-hidden>x</span>
      {length}
      <span className="sr-only">
        {current ? " in a row, still going" : " in a row"}
      </span>
    </span>
  );
}

/** A big number with its label, e.g. the pot total. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-neutral-600">
        {label}
      </span>
      <span className="font-mono text-3xl font-semibold text-neutral-900">
        {value}
      </span>
      {hint ? <span className="text-sm text-neutral-600">{hint}</span> : null}
    </div>
  );
}
