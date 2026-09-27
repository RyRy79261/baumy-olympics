import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { cx } from "./cx";
import { Sprite } from "./sprite";

// NEUTRAL PLACEHOLDERS for the chores game (SPEC §3.2, §7; issue #7 restyles
// them here): the chore tile, the floating "+N", the "STREAK BROKEN" banner
// and a radio group big enough to tap on the kiosk. They take plain props
// and hold no game logic.

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
  return (
    <button
      type={type}
      data-state={state}
      className={cx(
        "flex w-full items-center gap-3 rounded border bg-white p-3 text-left",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        state === "due" ? "border-neutral-900" : "border-neutral-300",
        kiosk ? "min-h-20 text-base" : "min-h-16 text-sm",
        className,
      )}
      {...props}
    >
      <Sprite name={sprite} size={kiosk ? 3 : 2} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{name}</span>
          {points !== null ? (
            <span className="shrink-0 font-mono">{points} pts</span>
          ) : null}
        </span>
        <span className="truncate text-neutral-700">{streak}</span>
        <span
          className={cx(
            "truncate",
            state === "due" ? "font-semibold" : "text-neutral-600",
          )}
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
 */
export function ScorePop({ points }: { points: number }) {
  return (
    <p
      role="status"
      data-testid="score-pop"
      className="pointer-events-none fixed inset-x-0 top-1/3 z-50 text-center text-5xl font-bold text-neutral-900 motion-safe:animate-bounce"
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
      className="flex flex-col items-center gap-1 rounded border-2 border-neutral-900 bg-white p-4 text-center"
    >
      <strong className="text-2xl tracking-widest">STREAK BROKEN</strong>
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
      <legend className="mb-1 text-sm font-medium text-neutral-900">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "inline-flex cursor-pointer items-center gap-2 rounded border px-3",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-neutral-900",
              o.value === value
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-400 bg-white text-neutral-900",
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
    </fieldset>
  );
}
