// The Baumy badge (issue #81, owner's pick "B" of 2026-09-28): the app icon
// and the brand mark. Baumy's own idle frame 0 (baumy-cat.ts), facing left
// and cropped to its drawn pixels, centred in a round plum badge with a
// violet rim and four plus-shaped sparkles. No lettering. Built from the
// sprite data, never redrawn: change the cat and the badge follows. A pure
// grid, so the icon routes, the header and the committed PNGs in
// design/logo/ all come from this one source.

import { BAUMY_COLOURS, BAUMY_FRAMES } from "./baumy-cat";
import type { Palette, Sprite } from "./pixel-grid";

/** The badge is BADGE_SIZE × BADGE_SIZE art pixels. */
export const BADGE_SIZE = 40;

/** The rim's width, in art pixels. */
export const BADGE_RIM = 2;

/** The badge's own colours; the cat keeps Baumy's (K, D, O, E). */
export const BADGE_COLOURS = {
  R: "#4a3a6a", // the rim
  B: "#1a1026", // inside the badge
  Y: "#ffe46b",
  C: "#4ff5e6",
  P: "#ff8fc7",
  V: "#b86bff",
} as const;

/** Every colour the badge grid uses; "." is clear (outside the circle). */
export const BADGE_PALETTE: Palette = { ...BAUMY_COLOURS, ...BADGE_COLOURS };

/** The four sparkles: their centre cell and colour character. */
export const BADGE_SPARKLES: readonly (readonly [number, number, string])[] = [
  [7, 9, "Y"],
  [31, 8, "C"],
  [9, 29, "P"],
  [33, 27, "V"],
];

/** Baumy's idle frame 0 facing left, cropped to its drawn pixels. */
export function badgeCat(): string[] {
  const cat = BAUMY_FRAMES.idle[0]!.map((r) => [...r].reverse().join(""));
  const drawn = (ch: string | undefined) => ch !== undefined && ch !== ".";
  const rows = cat.flatMap((r, y) => ([...r].some(drawn) ? [y] : []));
  const w = Math.max(...cat.map((r) => r.length));
  const cols = [...Array(w).keys()].filter((x) => cat.some((r) => drawn(r[x])));
  const [x0, x1] = [cols[0]!, cols.at(-1)!];
  return cat
    .slice(rows[0], rows.at(-1)! + 1)
    .map((r) => r.slice(x0, x1 + 1).padEnd(x1 - x0 + 1, "."));
}

/** Fill a rounded square `inset` cells in, corner radius `r` (a circle at half the size). */
function fillRound(c: string[][], ch: string, inset: number, r: number) {
  const g = c.length;
  for (let y = inset; y < g - inset; y++) {
    for (let x = inset; x < g - inset; x++) {
      const dx = Math.max(0, inset + r - x, x - (g - 1 - inset - r));
      const dy = Math.max(0, inset + r - y, y - (g - 1 - inset - r));
      if (dx * dx + dy * dy <= r * r) c[y]![x] = ch;
    }
  }
}

function build(): Sprite {
  const g = BADGE_SIZE;
  const c = Array.from({ length: g }, () => Array<string>(g).fill("."));
  fillRound(c, "R", 0, g / 2);
  fillRound(c, "B", BADGE_RIM, g / 2 - BADGE_RIM);
  const art = badgeCat();
  const ox = Math.round((g - art[0]!.length) / 2);
  const oy = Math.round((g - art.length) / 2) + 2;
  art.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (BAUMY_COLOURS[ch]) c[oy + y]![ox + x] = ch;
    }),
  );
  for (const [x, y, ch] of BADGE_SPARKLES) {
    for (const [px, py] of [
      [x, y],
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      c[py]![px] = ch;
    }
  }
  return c.map((r) => r.join(""));
}

/** The badge: BADGE_SIZE rows of BADGE_SIZE characters, through BADGE_PALETTE. */
export const BADGE_GRID: Sprite = build();
