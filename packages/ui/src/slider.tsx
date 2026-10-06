import type {
  ComponentPropsWithRef,
  CSSProperties,
  KeyboardEvent,
} from "react";
import { cx } from "./cx";

// A range slider over a list of stops (issue #179): the track is a native
// range input whose value is the stop's index, so the stops need not be
// evenly spaced (a cooldown steps by the hour, then by 6 hours, then by the
// day). The value it stands at is always written next to it, and read out
// as `aria-valuetext`. Its look is the `pixel-slider` utility in
// apps/web/app/globals.css: a sunk track, filled violet up to the value, and a
// square lavender thumb, 56px on the kiosk.

/** The stops from `min` to `max`, `step` apart: (0, 6, 2) is 0, 2, 4, 6. */
export function stepStops(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; min + i * step <= max; i++) out.push(min + i * step);
  return out;
}

/**
 * `stops` with `value` among them, in order, so a value off the scale (an
 * effort of 123% on a scale of fives) can still be reached again.
 */
export function withStop(
  stops: readonly number[],
  value: number | null,
): readonly number[] {
  if (value === null || stops.includes(value)) return stops;
  return [...stops, value].sort((a, b) => a - b);
}

/** The index of the stop nearest `value` (the first, for no value). */
export function stopIndex(stops: readonly number[], value: number | null) {
  if (value === null) return 0;
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i]! - value) < Math.abs(stops[best]! - value)) best = i;
  }
  return best;
}

/** How many stops Page Up and Page Down move. */
const PAGE = 10;

/** The index a key moves to from `i`, or null for a key it ignores. */
function keyIndex(key: string, i: number, last: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(i + 1, last);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(i - 1, 0);
    case "PageUp":
      return Math.min(i + PAGE, last);
    case "PageDown":
      return Math.max(i - PAGE, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * A slider. `value` null is "not set": the thumb stands hollow at the first
 * stop and the text says `unsetText`, until a tap, a drag or a key sets it
 * (a tap where the thumb stands sets that stop, so every stop is reachable).
 * Arrow keys move one stop, Page Up and Page Down ten, Home and End to the
 * ends. `kiosk` makes it a 56px touch target with a 56px thumb.
 */
export function Slider({
  stops,
  value,
  onValueChange,
  valueText,
  unsetText = "Not set",
  kiosk = false,
  className,
  ...props
}: Omit<
  ComponentPropsWithRef<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"
> & {
  stops: readonly number[];
  value: number | null;
  onValueChange: (value: number) => void;
  /** The value in words, with its unit: "26 pts". */
  valueText: (value: number) => string;
  unsetText?: string;
  kiosk?: boolean;
}) {
  const last = stops.length - 1;
  const index = stopIndex(stops, value);
  const text = value === null ? unsetText : valueText(value);
  const fill = value === null || last === 0 ? 0 : (index / last) * 100;
  // The longest text it can show, so the track never moves as it changes.
  const width = Math.max(
    unsetText.length,
    ...stops.map((s) => valueText(s).length),
  );
  const commit = (i: number) => {
    const next = stops[i]!;
    if (value === null || next !== value) onValueChange(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const i = keyIndex(e.key, index, last);
    if (i === null) return;
    // The browser's own step would move by the index, twice with ours.
    e.preventDefault();
    commit(i);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={index}
        aria-valuetext={text}
        data-unset={value === null ? "" : undefined}
        className={cx(
          "pixel-slider min-w-28 flex-1",
          kiosk ? "pixel-slider-kiosk min-h-14" : "min-h-11",
          className,
        )}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => commit(Number(e.currentTarget.value))}
        // A tap on the thumb where it stands moves nothing, so no change:
        // while not set, that tap sets the stop it stands on.
        onClick={(e) => {
          if (value === null) commit(Number(e.currentTarget.value));
        }}
        onKeyDown={onKeyDown}
        {...props}
      />
      <span
        aria-hidden="true"
        data-slider-value=""
        className={cx(
          "shrink-0 tabular-nums",
          kiosk ? "text-xl" : "text-lg",
          value === null ? "text-bm-muted" : "text-bm-text",
        )}
        style={{ minWidth: `${width}ch` }}
      >
        {text}
      </span>
    </div>
  );
}
