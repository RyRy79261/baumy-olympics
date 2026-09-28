import type { CSSProperties } from "react";
import { cx } from "../cx";
import { gridSize, gridToPaths, type Palette, type Sprite } from "./pixel-grid";

// Renderers for pixel grids (pixel-grid.ts). SVG with crisp edges, so the
// art stays sharp at any integer scale. Decorative unless given a `label`.

function a11y(label: string | undefined) {
  return label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);
}

/** One frame through a palette, `scale` screen pixels per art pixel. */
export function PixelArt({
  grid,
  palette,
  scale = 1,
  label,
  className,
  style,
}: {
  grid: Sprite;
  palette: Palette;
  scale?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { w, h } = gridSize(grid);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      {...a11y(label)}
    >
      {gridToPaths(grid, palette).map((p) => (
        <path key={p.fill} fill={p.fill} d={p.d} />
      ))}
    </svg>
  );
}

/**
 * How a strip of `frames` frames plays: the whole loop takes
 * `frames × frameMs`, in `frames` hard steps (no tweening between frames).
 */
export function stripTiming(
  frames: number,
  frameMs: number,
): { duration: string; steps: number } {
  return { duration: `${frames * frameMs}ms`, steps: frames };
}

/**
 * An animated sprite: every frame side by side in one SVG, behind a window
 * one frame wide, and a CSS `steps()` animation slides the strip along
 * (`animate-sprite-strip`, app/globals.css). It is `motion-safe:` only, so
 * under reduced motion the first frame stands still, and a single frame
 * never animates. No timers, so the server and the first client render
 * agree.
 */
export function SpriteStrip({
  frames,
  palette,
  scale = 1,
  frameMs = 450,
  flip = false,
  label,
  className,
}: {
  /** Frames of one size, played in order and looped. */
  frames: readonly Sprite[];
  palette: Palette;
  scale?: number;
  frameMs?: number;
  /** Mirror it (face the other way). */
  flip?: boolean;
  label?: string;
  className?: string;
}) {
  const { w, h } = gridSize(frames[0] ?? []);
  const n = frames.length;
  const timing = stripTiming(n, frameMs);
  return (
    <span
      data-frames={n}
      className={cx("inline-block shrink-0 overflow-hidden", className)}
      style={{
        width: w * scale,
        height: h * scale,
        transform: flip ? "scaleX(-1)" : undefined,
      }}
      {...a11y(label)}
    >
      <svg
        viewBox={`0 0 ${w * n} ${h}`}
        width={w * scale * n}
        height={h * scale}
        shapeRendering="crispEdges"
        aria-hidden
        className={cx("block", n > 1 && "motion-safe:animate-sprite-strip")}
        style={
          n > 1
            ? ({
                "--sprite-duration": timing.duration,
                "--sprite-steps": timing.steps,
              } as CSSProperties)
            : undefined
        }
      >
        {frames.flatMap((frame, i) =>
          gridToPaths(frame, palette, i * w).map((p) => (
            <path key={`${i}-${p.fill}`} fill={p.fill} d={p.d} />
          )),
        )}
      </svg>
    </span>
  );
}
