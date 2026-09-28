import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cx } from "./cx";
import { Glyph } from "./pixel/glyph";

// The scoreboard and the pot in the pixel kit (SPEC §3.2, §7; ADR 0005): a
// table with Silkscreen headers, a points figure (yellow, ADR 0005 §8) whose
// provisional part is dimmed, the streak flame counter and a big stat. They
// take plain props and hold no game logic.

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
        className={cx(
          "w-full border-collapse text-left text-lg text-bm-text",
          className,
        )}
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
        "border-b-2 border-bm-line px-2 py-2 font-label text-sm font-bold text-bm-muted uppercase",
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
        "border-b-2 border-bm-line/60 px-2 py-2 text-bm-text",
        numeric && "text-right font-label tabular-nums",
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
    <span className={cx("font-label font-bold text-bm-yellow", className)}>
      <span data-testid="points">{points}</span>
      {provisional !== 0 ? (
        <span data-provisional className="ml-1 text-xs font-normal text-bm-dim">
          ({provisional} pending)
        </span>
      ) : null}
    </span>
  );
}

/**
 * The streak flame counter (SPEC §7 "Juice"): the pixel flame and the
 * length. A run still going burns amber; a broken one is shown out, grey.
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
        "inline-flex min-w-11 items-center justify-center gap-1 px-1 font-display text-xs",
        current ? "text-bm-amber" : "text-bm-dim",
      )}
    >
      <Glyph name="flame" size={16} accent="var(--color-bm-yellow)" />
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
      <span className="font-label text-sm font-bold tracking-wider text-bm-muted uppercase">
        {label}
      </span>
      <span className="font-display text-2xl text-bm-yellow">{value}</span>
      {hint ? <span className="text-base text-bm-muted">{hint}</span> : null}
    </div>
  );
}
