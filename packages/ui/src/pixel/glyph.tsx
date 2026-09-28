import type { CSSProperties } from "react";
import { cx } from "../cx";
import { GLYPHS, type GlyphName } from "./glyphs";
import { PIXEL_ICONS, type PixelIconName } from "./icons";
import { PixelArt } from "./pixel-art";
import { gridSize, gridToPaths } from "./pixel-grid";

/** The hard drop shadow under a glyph: 1px per 20px of size, at least 1. */
export function glyphShadow(size: number): string {
  const o = Math.max(1, Math.round(size / 20));
  return `drop-shadow(${o}px ${o}px 0 #07040c)`;
}

/**
 * A one-colour glyph (glyphs.ts), square and centred, `size` px wide. The
 * ink is `color` (the text colour by default); the accent pixels are
 * `accent`, or the ink at 60% without one. Decorative unless `label`led.
 */
export function Glyph({
  name,
  color = "currentColor",
  accent,
  size = 24,
  shadow = false,
  label,
  className,
  style,
}: {
  name: GlyphName;
  color?: string;
  accent?: string;
  size?: number;
  shadow?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const grid = GLYPHS[name];
  const { w, h } = gridSize(grid);
  const s = Math.max(w, h);
  const ink = gridToPaths(grid, { "#": color });
  const acc = gridToPaths(grid, { "=": accent ?? color });
  return (
    <svg
      data-glyph={name}
      viewBox={`${-(s - w) / 2} ${-(s - h) / 2} ${s} ${s}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cx("inline-block shrink-0", className)}
      style={{ filter: shadow ? glyphShadow(size) : undefined, ...style }}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {ink.map((p) => (
        <path key="ink" fill={p.fill} d={p.d} />
      ))}
      {acc.map((p) => (
        <path
          key="accent"
          fill={p.fill}
          d={p.d}
          opacity={accent ? undefined : 0.6}
        />
      ))}
    </svg>
  );
}

/**
 * A 16×16 multi-colour icon (icons.ts) at `scale`. `dim` is the "nothing
 * here" look of the header icons: faded and grey (ADR 0005 §1).
 */
export function PixelIcon({
  name,
  scale = 4,
  dim = false,
  label,
  className,
}: {
  name: PixelIconName;
  scale?: number;
  dim?: boolean;
  label?: string;
  className?: string;
}) {
  const icon = PIXEL_ICONS[name];
  return (
    <PixelArt
      grid={icon.grid}
      palette={icon.pal}
      scale={scale}
      label={label}
      className={cx("inline-block shrink-0", className)}
      style={dim ? { opacity: 0.28, filter: "grayscale(1)" } : undefined}
    />
  );
}
