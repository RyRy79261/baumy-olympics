import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { cx } from "./cx";
import { Glyph } from "./pixel/glyph";
import { GLYPHS, type GlyphName } from "./pixel/glyphs";
import { RadiosFollowReset } from "./radios-follow-reset";

// The chores game in the pixel kit (SPEC §3.2, §7; ADR 0005): the chore
// tile, the floating "+N", the "STREAK BROKEN" banner and a radio group big
// enough to tap on the kiosk. They take plain props and hold no game logic.
// Points are yellow everywhere (ADR 0005 §8: one accent, one meaning).

/**
 * The glyph a chore's `chores.sprite` shows: the glyph of that name, the
 * nearest one for the starter chores (SPEC §4.7), and the wrench for any
 * other chore until it gets a glyph of its own.
 */
const CHORE_GLYPHS: Readonly<Record<string, GlyphName>> = {
  trash: "bin",
  recycling: "bin",
  dishes: "soap",
  dishwasher: "soap",
  bathroom: "tp",
  plants: "plant",
};

export function choreGlyph(sprite: string): GlyphName {
  if (sprite in GLYPHS) return sprite as GlyphName;
  return CHORE_GLYPHS[sprite] ?? "wrench";
}

export type ChoreTileState = "due" | "cooldown" | "done" | "unavailable";

export interface ChoreTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  /** What `chores.sprite` stores. */
  sprite: string;
  /** Base points, or null while the chore has none. */
  points: number | null;
  /** E.g. "Ryan · streak 3", or "No streak yet". */
  streak: ReactNode;
  /** E.g. "Due", or "Again from Wed 30 Sep, 08:00". */
  status: ReactNode;
  state: ChoreTileState;
  /** 56px targets and larger text on the kiosk. */
  kiosk?: boolean;
}

/** One chore in the grid: tap it to log it. */
export function ChoreTile({
  name,
  sprite,
  points,
  streak,
  status,
  state,
  kiosk = false,
  className,
  type = "button",
  ...props
}: ChoreTileProps) {
  const due = state === "due";
  return (
    <button
      type={type}
      data-state={state}
      className={cx(
        // Calm (ADR 0005 §8): every tile keeps the dim line frame; "due" is
        // said once, by the status line in red.
        "pixel-frame flex w-full items-center gap-3 bg-bm-surface p-3 text-left text-bm-text",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        kiosk ? "min-h-24 gap-4 p-4 text-lg" : "min-h-16 text-base",
        className,
      )}
      {...props}
    >
      <span
        data-sprite={sprite}
        className={cx(
          "pixel-frame grid shrink-0 place-items-center bg-bm-teal/10 text-bm-teal [--pf:rgb(79_245_230/0.35)]",
          kiosk ? "size-16" : "size-12",
        )}
      >
        <Glyph
          name={choreGlyph(sprite)}
          size={kiosk ? 40 : 30}
          accent="var(--color-bm-text)"
        />
      </span>
      {/* w-0 + flex-1: the text never widens the tile (or the grid it sits
          in) past the screen; long names wrap to two lines instead. */}
      <span data-tile-text className="flex w-0 min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-2">
          <span
            data-tile-name
            className={cx(
              "line-clamp-2 leading-tight font-semibold [overflow-wrap:anywhere] text-bm-text",
              kiosk ? "text-2xl" : "text-xl",
            )}
          >
            {name}
          </span>
          {points !== null ? (
            <span
              data-tile-points
              className={cx(
                "shrink-0 font-display text-bm-yellow",
                kiosk ? "pt-1 text-base" : "pt-0.5 text-xs",
              )}
            >
              {points} pts
            </span>
          ) : null}
        </span>
        <span className="truncate font-label text-sm text-bm-muted uppercase">
          {streak}
        </span>
        <span
          data-tile-status
          className={cx("truncate", due ? "text-bm-red" : "text-bm-dim")}
        >
          {status}
        </span>
      </span>
    </button>
  );
}

/**
 * The floating "+N" after a completion is scored (SPEC §7 "Juice"). It is a
 * status message, so screen readers hear it; the float honours
 * prefers-reduced-motion. The caller removes it after a moment.
 *
 * `placement="screen"` floats it a third of the way down the screen;
 * `placement="row"` floats it over the middle of its nearest positioned
 * parent, the bounty row that was logged (issue #181), so it never sits over
 * some other row.
 */
export function ScorePop({
  points,
  placement = "screen",
}: {
  points: number;
  placement?: "screen" | "row";
}) {
  return (
    <p
      role="status"
      data-testid="score-pop"
      data-placement={placement}
      className={cx(
        "pointer-events-none z-50 font-display text-5xl text-bm-yellow [text-shadow:4px_4px_0_var(--color-bm-ink)] motion-safe:animate-pixel-hop",
        placement === "row"
          ? "absolute inset-0 flex items-center justify-center"
          : "fixed inset-x-0 top-1/3 text-center",
      )}
    >
      +{points}
    </p>
  );
}

/** "STREAK BROKEN" with the length that was broken and the bonus it paid. */
export function StreakBrokenBanner({
  holderName,
  length,
  bonus,
}: {
  holderName: string;
  length: number;
  bonus: number;
}) {
  return (
    <div
      role="status"
      data-testid="streak-broken"
      className="pixel-frame pixel-frame-4 flex flex-col items-center gap-2 bg-bm-surface p-4 text-center text-lg [--pf:var(--color-bm-red)]"
    >
      <strong className="font-display text-xl font-normal text-bm-red">
        STREAK BROKEN
      </strong>
      <span>
        {holderName}&apos;s streak of {length} is over: +{bonus} bonus.
      </span>
    </div>
  );
}

export interface ChoiceOption {
  value: string;
  label: ReactNode;
}

/**
 * A radio group whose options are whole tap targets (44px, 56px on the
 * kiosk). Controlled: `value` and `onChange`.
 */
export function ChoiceGroup({
  legend,
  name,
  options,
  value,
  onChange,
  kiosk = false,
  ...inputProps
}: {
  legend: ReactNode;
  name: string;
  options: readonly ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
  kiosk?: boolean;
} & Pick<InputHTMLAttributes<HTMLInputElement>, "disabled">) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-label text-sm font-bold tracking-wide text-bm-text uppercase">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "pixel-frame pixel-frame-within inline-flex cursor-pointer items-center gap-2 px-3 font-label font-bold uppercase",
              o.value === value
                ? "bg-bm-violet/15 text-bm-text [--pf:var(--color-bm-violet)]"
                : "text-bm-muted",
              kiosk
                ? "min-h-14 min-w-14 text-base"
                : "min-h-11 min-w-11 text-sm",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="sr-only"
              {...inputProps}
            />
            {o.label}
          </label>
        ))}
      </div>
      <RadiosFollowReset name={name} value={value} />
    </fieldset>
  );
}
