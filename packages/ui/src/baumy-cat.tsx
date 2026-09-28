import type { ReactNode } from "react";
import { SPRITE_MOTION, STATE_MARK, type SpriteState } from "./baumy-states";
import { cx } from "./cx";
import { PixelBubble } from "./pixel-bubble";
import {
  BAUMY_COLOURS,
  BAUMY_FRAMES,
  type BaumyAnimation,
} from "./pixel/baumy-cat";
import { SpriteStrip } from "./pixel/pixel-art";

// Baumy, the house cat (ADR 0005 §1, §7): Camp 404's INKBLOT cat at twice
// the pixels (pixel/baumy-cat.ts). It just sits being a cat, and its state
// comes from lib/ai/mood.ts (never set by hand). Each state plays frames the
// cat already has; the whole sprite bobs or hops on top (SPRITE_MOTION), and
// a small mark says the state without motion. Speech bubbles come from it.

/** One of the cat's own frames: an animation and its index. */
export type BaumyFrameRef = readonly [BaumyAnimation, number];

const IDLE_LOOP: readonly BaumyFrameRef[] = [
  ["idle", 0],
  ["idle", 1],
  ["idle", 2],
  ["idle", 3],
];
const SITTING: readonly BaumyFrameRef[] = [["idle", 0]];

/** Which of the cat's own frames each state plays, and how fast. */
export const BAUMY_STATE_FRAMES: Readonly<
  Record<SpriteState, { frames: readonly BaumyFrameRef[]; frameMs: number }>
> = {
  idle: { frames: IDLE_LOOP, frameMs: 450 },
  listening: { frames: IDLE_LOOP, frameMs: 300 },
  thinking: { frames: SITTING, frameMs: 450 },
  talking: { frames: IDLE_LOOP, frameMs: 300 },
  // A leap: up, then down.
  happy: {
    frames: [
      ["jumpUp", 0],
      ["jumpDown", 0],
    ],
    frameMs: 300,
  },
  sad: { frames: SITTING, frameMs: 450 },
  sleeping: { frames: SITTING, frameMs: 450 },
};

/** The frames a state plays, each a Scale2x'd grid. */
export function baumyFrames(state: SpriteState): string[][] {
  return BAUMY_STATE_FRAMES[state].frames.map(
    ([animation, i]) => BAUMY_FRAMES[animation][i]!,
  );
}

export function BaumyCat({
  state = "idle",
  scale = 3,
  facing = "left",
  label,
  speech,
  className,
}: {
  state?: SpriteState;
  /** Screen pixels per art pixel (the art is 34 × 32). */
  scale?: number;
  /** The art faces right; on the right of a screen Baumy faces left. */
  facing?: "left" | "right";
  /** Accessible name; without it Baumy is decorative. */
  label?: string;
  /** What Baumy says, in a bubble above it. */
  speech?: ReactNode;
  className?: string;
}) {
  const { frameMs } = BAUMY_STATE_FRAMES[state];
  const mark = STATE_MARK[state];
  return (
    <span
      data-sprite="baumy"
      data-state={state}
      data-motion={SPRITE_MOTION[state] ? "animated" : "still"}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={cx(
        "relative inline-block shrink-0 align-bottom",
        SPRITE_MOTION[state],
        state === "sad" && "opacity-70",
        className,
      )}
    >
      {speech ? (
        // The bubble opens away from the edge Baumy sits on: over a cat
        // facing left (on the right of the screen) it grows leftwards.
        <span
          className={cx(
            "absolute bottom-[calc(100%+10px)] z-10 block w-[min(440px,80vw)]",
            facing === "left" ? "right-0" : "left-0",
          )}
        >
          <PixelBubble tail={facing === "left" ? "right" : "left"}>
            {speech}
          </PixelBubble>
        </span>
      ) : null}
      <SpriteStrip
        frames={baumyFrames(state)}
        palette={BAUMY_COLOURS}
        scale={scale}
        frameMs={frameMs}
        flip={facing === "left"}
        className="block"
      />
      {mark ? (
        <span
          aria-hidden
          data-mark
          className="absolute -top-2 -right-2 bg-bm-text px-1 font-display text-[10px] leading-4 text-bm-ink"
        >
          {mark}
        </span>
      ) : null}
    </span>
  );
}
