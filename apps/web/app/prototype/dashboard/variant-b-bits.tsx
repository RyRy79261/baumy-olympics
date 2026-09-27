// PROTOTYPE (issue #7), throwaway. Variant B shared bits: fonts, the
// pixel drape, the dithered wall, deadline wording.

import type { CSSProperties } from "react";
import { HOUSEMATES, type Bounty } from "./data";

export const F = {
  press: "font-[family-name:var(--font-press)]",
  vt: "font-[family-name:var(--font-vt)]",
  silk: "font-[family-name:var(--font-silk)]",
  pix: "font-[family-name:var(--font-pixelify)]",
};

export const HOUSE_COLOR = "#ffb347";

export const mate = (id: string) => HOUSEMATES.find((h) => h.id === id);
export const whoColor = (who: string) => mate(who)?.color ?? HOUSE_COLOR;
export const whoName = (who: string) => mate(who)?.name ?? "House";

export function dueText(b: Bounty) {
  const h = b.dueInHours;
  if (h < 0) return { text: `OVERDUE ${Math.abs(h)}h`, color: "#ff4d5e" };
  if (h <= 12) return { text: `DUE IN ${h}h`, color: "#ffb347" };
  if (h < 48) return { text: `IN ${h}h`, color: "#c9a7ff" };
  return { text: `IN ${Math.round(h / 24)} DAYS`, color: "#8d7fae" };
}

/** A checkerboard dither: two colours at pixel scale. */
export function dither(a: string, px = 4): CSSProperties {
  return {
    backgroundImage: `repeating-conic-gradient(${a} 0 25%, transparent 0 50%)`,
    backgroundSize: `${px}px ${px}px`,
  };
}

/** Pixel-stepped draped fabric swags along the top edge. */
export function Drape({ swags = 5, className }: { swags?: number; className?: string }) {
  const W = 205;
  const period = W / swags;
  const cols: { x: number; h: number }[] = [];
  for (let x = 0; x < W; x++) {
    const t = (x % period) / period;
    cols.push({ x, h: 3 + Math.round(6 * Math.sin(Math.PI * t)) });
  }
  return (
    <svg
      viewBox={`0 0 ${W} 14`}
      width={820}
      height={56}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      {cols.map(({ x, h }) => (
        <g key={x}>
          <rect x={x} y={0} width={1} height={h} fill={x % 6 < 2 ? "#5a1d3c" : "#7a2a4f"} />
          <rect x={x} y={h} width={1} height={1} fill="#c45a8a" />
          <rect x={x} y={h + 1} width={1} height={1} fill="#2a0d1e" />
        </g>
      ))}
      {Array.from({ length: swags + 1 }, (_, i) => {
        const x = Math.min(W - 2, Math.round(i * period) - 1);
        return (
          <g key={`t${i}`}>
            <rect x={x} y={2} width={2} height={3} fill="#ffe46b" />
            <rect x={x} y={5} width={2} height={4} fill="#d9a52b" />
            <rect x={x - 1} y={9} width={4} height={2} fill="#ffe46b" />
          </g>
        );
      })}
    </svg>
  );
}

/** Chunky pixel frame via stacked box-shadows. */
export function pixelFrame(edge: string, inner: string): CSSProperties {
  return {
    boxShadow: `0 0 0 3px ${edge}, 0 0 0 6px #0b0712, inset 0 0 0 3px ${inner}, 0 8px 0 6px rgba(0,0,0,.45)`,
  };
}
