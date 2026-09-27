// PROTOTYPE (issue #7), throwaway. A 26×29 pixel Baumy drawn from a bitmap:
// black fluffy cat, one green eye and one blue-violet eye, a pastel party
// hat with a star, fairy lights in the fur (design/baumy-reference.png).

import type { CSSProperties } from "react";

export const PAL = {
  K: "#0b0712", // outline
  B: "#241a33", // fur
  b: "#3d2d57", // fur highlight
  p: "#6b2f5c", // inner ear
  G: "#43f0a0", // green eye
  g: "#1f9e66",
  V: "#8f7dff", // blue-violet eye
  v: "#5842d8",
  W: "#ffffff",
  P: "#ff8fc7", // nose / pink light
  H: "#ffb8e0", // hat pink
  h: "#c9a7ff", // hat lavender
  T: "#4ff5e6", // teal light
  Y: "#ffe46b", // star yellow
  M: "#8d7fae", // whiskers
  w: "#07040c", // fairy-light wire
} as const;

const OPEN = [
  "............Y.............",
  "...........YWY............",
  "............Y.............",
  "...........KHK............",
  "..K........KHhK........K..",
  "..KK......KhHTK.......KK..",
  "..KbK.....KHHhHK.....KbK..",
  "..KppK...KHTHHYHK...KppK..",
  "..KpppKKHHhHHHTHHHKKpppK..",
  "..KbpBBBBBBBBBBBBBBBBpbK..",
  ".KbBBBBBBBBBBBBBBBBBBBBbK.",
  ".KBBBBBBBBBBBBBBBBBBBBBBK.",
  ".KBBBGGGGBBBBBBBBVVVVBBBK.",
  "KbBBGGWGGGBBBBBBVVWVVVBBbK",
  ".KBBGgKKgGBBBBBBVvKKvVBBK.",
  "KbBBGgKKgGBBBBBBVvKKvVBBbK",
  ".KBBBGGGGBBBBBBBBVVVVBBBK.",
  "KbBBBBBBBBBBPPBBBBBBBBBBbK",
  ".KBMMMBBBBBBKKBBBBBBMMMBK.",
  "KbBBBBBBBBBKBBKBBBBBBBBBbK",
  ".KMMMBBBBBBBBBBBBBBBBMMMK.",
  "..KbBBBBBBBBBBBBBBBBBBbK..",
  ".KbBBBBBBBBBBBBBBBBBBBBbK.",
  ".KBwwBBBBBBBBBBBBBBBBwwBK.",
  "KbBTBwwBBBBBBBBBBBBwwBPBbK",
  "KBBBBBBPwwwBBBBwwwYBBBBBBK",
  "KBBBBBBBBBBwwwwBBBBBBBBBBK",
  "KBBKKBBBBBBTBBPBBBBBBKKBBK",
  "KKKKKKKKKKKKKKKKKKKKKKKKKK",
];

// Eyes shut: happy "^ ^" lines instead of the open eyes.
const BLINK = [
  "............Y.............",
  "...........YWY............",
  "............Y.............",
  "...........KHK............",
  "..K........KHhK........K..",
  "..KK......KhHTK.......KK..",
  "..KbK.....KHHhHK.....KbK..",
  "..KppK...KHTHHYHK...KppK..",
  "..KpppKKHHhHHHTHHHKKpppK..",
  "..KbpBBBBBBBBBBBBBBBBpbK..",
  ".KbBBBBBBBBBBBBBBBBBBBBbK.",
  ".KBBBBBBBBBBBBBBBBBBBBBBK.",
  ".KBBBBBBBBBBBBBBBBBBBBBBK.",
  "KbBBBBggBBBBBBBBBBvvBBBBbK",
  ".KBBBgBBgBBBBBBBBvBBvBBBK.",
  "KbBBBBBBBBBBBBBBBBBBBBBBbK",
  ".KBBBBBBBBBBBBBBBBBBBBBBK.",
  "KbBBBBBBBBBBPPBBBBBBBBBBbK",
  ".KBMMMBBBBBBKKBBBBBBMMMBK.",
  "KbBBBBBBBBBKBBKBBBBBBBBBbK",
  ".KMMMBBBBBBBBBBBBBBBBMMMK.",
  "..KbBBBBBBBBBBBBBBBBBBbK..",
  ".KbBBBBBBBBBBBBBBBBBBBBbK.",
  ".KBwwBBBBBBBBBBBBBBBBwwBK.",
  "KbBTBwwBBBBBBBBBBBBwwBPBbK",
  "KBBBBBBPwwwBBBBwwwYBBBBBBK",
  "KBBBBBBBBBBwwwwBBBBBBBBBBK",
  "KBBKKBBBBBBTBBPBBBBBBKKBBK",
  "KKKKKKKKKKKKKKKKKKKKKKKKKK",
];

function rects(rows: string[]) {
  const out: { x: number; y: number; c: string }[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = PAL[ch as keyof typeof PAL];
      if (c) out.push({ x, y, c });
    }),
  );
  return out;
}

const OPEN_RECTS = rects(OPEN);
const BLINK_RECTS = rects(BLINK);

export function BaumySprite({
  scale = 6,
  blink = false,
  className,
  style,
}: {
  scale?: number;
  blink?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const r = blink ? BLINK_RECTS : OPEN_RECTS;
  return (
    <svg
      viewBox="0 0 26 29"
      width={26 * scale}
      height={29 * scale}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role="img"
      aria-label="Baumy"
    >
      {r.map(({ x, y, c }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c} />
      ))}
    </svg>
  );
}

/** A blinking Baumy: shuts its eyes for a moment every few seconds. */
export function BlinkingBaumy(props: { scale?: number; className?: string }) {
  return (
    <span className={`relative inline-block ${props.className ?? ""}`}>
      <BaumySprite scale={props.scale} className="proto-blink-open" />
      <BaumySprite
        scale={props.scale}
        blink
        className="proto-blink-shut absolute inset-0"
      />
    </span>
  );
}
