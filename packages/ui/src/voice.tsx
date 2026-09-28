import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

// Speaking to Baumy in the pixel kit (SPEC §3.6, issue #22; ADR 0005): the hold-to-speak button and the microphone's level
// meter. The recording itself is the app's (components/baumy).

export type MicState = "idle" | "starting" | "recording" | "sending";

const MIC_LABEL: Record<MicState, string> = {
  idle: "Hold to speak",
  starting: "Opening the microphone…",
  recording: "Release to send",
  sending: "Listening back…",
};

/**
 * Hold to speak. A press is a pointer held down, or Enter/Space for a
 * keyboard, which toggles instead. `label` overrides the state's words (for
 * "Tap to send" after a short tap). No text selection or callout on a long
 * press, and no scrolling from it, so an iPad hold stays a hold.
 */
export function MicButton({
  state,
  kiosk = false,
  label,
  className,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  state: MicState;
  kiosk?: boolean;
  label?: string;
}) {
  const recording = state === "recording";
  return (
    <button
      type={type}
      aria-pressed={recording}
      aria-busy={state === "starting" || undefined}
      data-state={state}
      // Not disabled while the microphone opens: the finger lifting during
      // the permission prompt must still reach the button (a disabled
      // control gets no pointer events in some browsers).
      disabled={state === "sending" || disabled}
      className={cx(
        "pixel-frame inline-flex shrink-0 touch-none items-center justify-center gap-2 px-4 font-label font-bold uppercase select-none [-webkit-touch-callout:none]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        kiosk ? "min-h-14 min-w-14 text-base" : "min-h-11 min-w-11 text-sm",
        recording
          ? "bg-bm-red text-bm-ink [--pf:var(--color-bm-ink)]"
          : "bg-bm-raised text-bm-text [--pf:var(--color-bm-text)]",
        className,
      )}
      {...props}
    >
      {recording ? <span aria-hidden>●</span> : null}
      <span>{label ?? MIC_LABEL[state]}</span>
    </button>
  );
}

/**
 * How loud the microphone is, 0 to 1, as a bar. A meter for assistive tech;
 * it follows the voice, so it is not decorative motion and keeps moving
 * under reduced motion (with no transition to smooth it).
 */
export function LevelMeter({
  level,
  className,
}: {
  level: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      data-testid="mic-level"
      className={cx(
        "pixel-frame h-4 w-full overflow-hidden bg-bm-ink p-[3px]",
        className,
      )}
    >
      <div className="h-full bg-bm-green" style={{ width: `${pct}%` }} />
    </div>
  );
}
