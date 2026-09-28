import type { ReactNode } from "react";
import { cx } from "./cx";

// The speech bubble Baumy talks in (the approved prototype's Bubble): pale
// lilac, a stepped 4px ink border drawn with box-shadows (square corners
// notched out), and a pixel tail pointing down at the speaker.

const BORDER =
  "shadow-[0_-4px_0_var(--color-bm-bubble-ink),0_4px_0_var(--color-bm-bubble-ink),-4px_0_0_var(--color-bm-bubble-ink),4px_0_0_var(--color-bm-bubble-ink),0_10px_0_rgb(0_0_0/0.35)]";
const TAIL =
  "shadow-[4px_0_0_var(--color-bm-bubble-ink),-4px_0_0_var(--color-bm-bubble-ink),0_4px_0_var(--color-bm-bubble-ink)]";

export function PixelBubble({
  children,
  tail = "right",
  className,
}: {
  children: ReactNode;
  /** Where the tail sits on the bottom edge: over the speaker. */
  tail?: "left" | "right" | "none";
  className?: string;
}) {
  return (
    <div
      data-bubble
      className={cx(
        "relative bg-bm-bubble p-5 font-body text-xl text-bm-bubble-ink",
        BORDER,
        className,
      )}
    >
      {children}
      {tail === "none" ? null : (
        <span
          aria-hidden
          className={cx(
            "absolute -bottom-4 block h-3 w-5 bg-bm-bubble",
            TAIL,
            tail === "right" ? "right-[70px]" : "left-[70px]",
          )}
        />
      )}
    </div>
  );
}
