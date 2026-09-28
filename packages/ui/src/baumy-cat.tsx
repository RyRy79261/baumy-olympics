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
import { gridSize, type Palette } from "./pixel/pixel-grid";

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

/**
 * The colours a state is drawn in. Asleep, the eye pixel takes the coat's
 * colour, so the eye reads as shut: a colour change on the same frame, not
 * new art.
 */
export function baumyPalette(state: SpriteState): Palette {
  return state === "sleeping"
    ? { ...BAUMY_COLOURS, E: BAUMY_COLOURS.K! }
    : BAUMY_COLOURS;
}

/** How tall a mark is, in art pixels. */
export const MARK_ART_PX = 6;

/**
 * Where a state mark goes, in art pixels: centred over the head (the top
 * rows of drawn pixels, mirrored when Baumy faces left), with its top in the
 * empty rows above it (never above the frame).
 */
export function markAnchor(
  frame: readonly string[],
  facing: "left" | "right",
): { top: number; x: number } {
  const { w } = gridSize(frame);
  const top = Math.max(
    0,
    frame.findIndex((row) => /[^.]/.test(row)),
  );
  let lo = w;
  let hi = -1;
  for (const row of frame.slice(top, top + 4)) {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== ".") {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
  }
  const centre = (lo + hi + 1) / 2;
  return {
    top: Math.max(0, top - MARK_ART_PX - 1),
    x: facing === "left" ? w - centre : centre,
  };
}

export function BaumyCat({
  state = "idle",
  scale = 3,
  facing = "left",
  label,
  speech,
  showMark = true,
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
  /**
   * Draw the state's mark (the sleeping "z"). Off where the scene draws its
   * own, like the screensaver's floating z's.
   */
  showMark?: boolean;
  className?: string;
}) {
  const { frameMs } = BAUMY_STATE_FRAMES[state];
  const frames = baumyFrames(state);
  const mark = showMark ? STATE_MARK[state] : null;
  const anchor = mark ? markAnchor(frames[0]!, facing) : null;
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
        frames={frames}
        palette={baumyPalette(state)}
        scale={scale}
        frameMs={frameMs}
        flip={facing === "left"}
        className="block"
      />
      {mark && anchor ? (
        // Above the drawn head, in the empty rows the art leaves there, as
        // violet pixel type (the prototype's sleeping "z"). Inside the art's
        // box, so a plinth or a clip never cuts it off.
        <span
          aria-hidden
          data-mark
          className="absolute -translate-x-1/2 font-display leading-none text-bm-violet [text-shadow:1px_1px_0_var(--color-bm-ink)]"
          style={{
            top: anchor.top * scale,
            left: anchor.x * scale,
            fontSize: Math.max(8, MARK_ART_PX * scale),
          }}
        >
          {mark}
        </span>
      ) : null}
    </span>
  );
}
