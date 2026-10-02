import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Talking to Baumy on the kitchen screen (ADR 0005 §1; the approved
// prototype's baumy-cat.tsx, ~/baumy-shots/cat-listen.png and
// cat-heard.png): the speech bubble comes from the cat itself, above it and
// growing leftwards. "Mrrp? I'm listening…" with level bars and "Done
// talking", then what Baumy understood with "Yes, do it" and "No". The
// wiring (recording, asking, approving) is the app's.
//
// Its look is the kit's panel (issue #155): a dark surface in a stepped
// 4px pixel frame, violet like Baumy's plinth, light text, with the pixel
// tail pointing down at the cat and a 56px "×" in its corner.

/** The bubble's tail: the panel's ground, edged in the frame's violet. */
const TAIL =
  "shadow-[4px_0_0_var(--color-bm-violet),-4px_0_0_var(--color-bm-violet),0_4px_0_var(--color-bm-violet)]";

/**
 * The bubble over the cat; `mode` names what it is showing, for tests.
 * With `onClose`, an "×" in its corner closes it.
 */
export function CatBubble({
  mode,
  onClose,
  children,
}: {
  mode: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="cat-bubble"
      data-mode={mode}
      aria-live="polite"
      className="absolute right-0 bottom-[calc(100%+10px)] z-10 w-[440px] max-w-[calc(100vw-28px)] drop-shadow-[0_10px_0_rgb(0_0_0/0.45)] motion-safe:animate-pixel-in"
    >
      <div
        data-bubble
        className="pixel-frame pixel-frame-4 relative bg-bm-surface p-5 font-body text-xl text-bm-text [--pf:var(--color-bm-violet)]"
      >
        {onClose ? (
          <button
            type="button"
            aria-label="Close"
            data-testid="cat-bubble-close"
            onClick={onClose}
            className="pixel-frame absolute top-3 right-3 z-10 grid size-14 place-items-center bg-bm-raised font-display text-[22px] text-bm-text [--pf:var(--color-bm-muted)]"
          >
            {"\u00d7"}
          </button>
        ) : null}
        {/* Only the first line (the first block of the first block: Baumy's
            "Mrrp?" or answer) makes room for the "\u00d7", as tall as it, so the
            cards and buttons below keep the bubble's whole width. */}
        <div
          className={cx(
            onClose &&
              "[&>:first-child>:first-child]:min-h-12 [&>:first-child>:first-child]:pr-16",
          )}
        >
          {children}
        </div>
      </div>
      <span
        aria-hidden
        className={cx(
          "absolute right-[70px] -bottom-2 block h-3 w-5 bg-bm-surface",
          TAIL,
        )}
      />
    </div>
  );
}

/** "Mrrp? I'm listening…" in the display font, beside the level bars. */
export function CatSays({
  children,
  size = "lg",
}: {
  children: ReactNode;
  size?: "lg" | "sm";
}) {
  return (
    <p
      className={cx(
        "font-display leading-snug",
        size === "lg" ? "text-[16px]" : "text-[14px]",
      )}
    >
      {children}
    </p>
  );
}

/** Reading text in the bubble: a hint, Baumy's answer. */
export function CatText({
  children,
  tone = "normal",
}: {
  children: ReactNode;
  tone?: "normal" | "muted" | "error";
}) {
  return (
    <div
      className={cx(
        "mt-3 font-body text-[22px] leading-snug",
        tone === "muted" && "text-bm-muted",
        tone === "error" && "text-bm-red",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Five bars that rise with the microphone's level (0…1), the prototype's
 * red equaliser. Still (a low row) when nothing is heard.
 */
export function LevelBars({
  level,
  tone = "red",
}: {
  level: number;
  /** "light" on a red ground (the held "Hold to talk"). */
  tone?: "red" | "light";
}) {
  const shape = [0.55, 0.9, 1, 0.8, 0.6];
  const l = Math.min(1, Math.max(0, level));
  return (
    <span
      aria-hidden
      data-level={Math.round(l * 100)}
      className="flex h-9 shrink-0 items-end gap-[5px]"
    >
      {shape.map((s, i) => (
        <span
          key={i}
          className={cx(
            "block w-2",
            tone === "light" ? "bg-white" : "bg-[#ff5a7a]",
          )}
          style={{ height: `${Math.round((0.3 + 0.7 * l * s) * 100)}%` }}
        />
      ))}
    </span>
  );
}

// The kit's stepped buttons, on the bubble's dark panel.
const BUTTON = {
  dark: "bg-bm-violet text-bm-ink [--pf:var(--color-bm-violet)]",
  go: "bg-bm-green text-bm-ink [--pf:var(--color-bm-green)]",
  soft: "bg-bm-raised text-bm-text [--pf:var(--color-bm-text)]",
} as const;

/** A 56px bubble button: "Done talking", "Yes, do it", "No". */
export function CatButton({
  variant = "dark",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON;
}) {
  return (
    <button
      type={type}
      className={cx(
        "pixel-frame h-14 flex-1 font-label text-[16px] font-bold uppercase disabled:opacity-50",
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

export type HoldState = "idle" | "opening" | "recording";

const HOLD_LABEL: Record<HoldState, string> = {
  idle: "Hold to talk",
  opening: "Opening the microphone…",
  recording: "Release to send",
};

/**
 * The kitchen cat's "Hold to talk" (issue #132): a big bubble button held
 * while speaking. While it is held it turns red, pulses and shows the level
 * bars, so the kitchen can see Baumy is listening. No text selection, callout
 * or scrolling from a long press, so an iPad hold stays a hold. The pointer
 * wiring is the app's.
 */
export function HoldToTalk({
  state,
  level,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  state: HoldState;
  /** The microphone's level, 0…1, for the bars while recording. */
  level: number;
}) {
  const recording = state === "recording";
  return (
    <button
      type={type}
      aria-pressed={recording}
      aria-busy={state === "opening" || undefined}
      data-state={state}
      data-testid="hold-to-talk"
      className={cx(
        "relative flex h-24 w-full touch-none items-center justify-center gap-4 font-label text-[18px] font-bold uppercase select-none [-webkit-touch-callout:none] [-webkit-user-select:none] disabled:opacity-50",
        recording
          ? "bg-[#b8243a] text-white outline-4 outline-offset-2 outline-[#ff5a7a] motion-safe:animate-pulse"
          : "bg-bm-violet text-bm-ink",
        className,
      )}
      {...props}
    >
      {recording ? <LevelBars level={level} tone="light" /> : null}
      <span>{HOLD_LABEL[state]}</span>
    </button>
  );
}

/** "Type instead": a small link-like button under the bubble's actions. */
export function CatLink({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "mt-3 min-h-14 w-full font-label text-[14px] font-bold text-bm-muted uppercase underline underline-offset-4",
        className,
      )}
      {...props}
    />
  );
}
