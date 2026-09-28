import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../app-shell";
import { BaumyBadge } from "../baumy-badge";
import {
  BADGE_COLOURS,
  BADGE_GRID,
  BADGE_PALETTE,
  BADGE_RIM,
  BADGE_SIZE,
  BADGE_SPARKLES,
  badgeCat,
} from "../pixel/baumy-badge";
import { BAUMY_COLOURS, BAUMY_FRAMES } from "../pixel/baumy-cat";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const CAT = new Set(Object.keys(BAUMY_COLOURS));

// The owner's pick (issue #81, 2026-09-28), as rendered in the approved
// reference (logo/make.mjs, option B). Any change to the badge or the cat
// shows here first; if it was meant, rewrite design/logo/ too
// (`pnpm --filter @baumy/web logo:png`).
const APPROVED = [
  "........................................",
  "..............RRRRRRRRRRRR..............",
  "............RRRRRRRRRRRRRRRR............",
  "..........RRRRRBBBBBBBBBBRRRRR..........",
  "........RRRRBBBBBBBBBBBBBBBBRRRR........",
  ".......RRRRBBBBBBBBBBBBBBBBBBRRRR.......",
  "......RRRBBBBBBBBBBBBBBBBBBBBBBRRR......",
  ".....RRRBBBBBBBBBBBBBBBBBBBBBBBCRRR.....",
  "....RRRYBBBBBBBBBBBBBBBBBBBBBBCCCRRR....",
  "....RRYYYBBBBBBBBBBBBBBBBBBBBBBCBBRR....",
  "...RRRBYBOOBBBBBBBBOOBBBBBBBBBBBBBRRR...",
  "...RRBBBOOOOOBBBBOOOOOBBBBBBBBBBBBBRR...",
  "..RRBBBBOODDOOOOOODDOOBBBBBBBBBBBBBBRR..",
  "..RRBBBBOODDOOOOOODDOOBBBBBBBBBBBBBBRR..",
  ".RRRBBBBOOKKKKKKKKDDOOBBBBBBBBBBBBBBRRR.",
  ".RRBBBBBOOOKKKKKKKDDOOBBBBBBBBBBBBBBBRR.",
  ".RRBBBBBOOOODDDDEEDDOOBBBBBBBBBBBBBBBRR.",
  ".RRBBBBBOOOODDDDEEDDOOBBBBBBBBBBBBBBBRR.",
  ".RRBBBBBOOOKKKKKKKDDOOBBBBBBBBBBBBBBBRR.",
  ".RRBBBBBOOKKKKKKKDDDOOBBBBBBBBBBBBBBBRR.",
  ".RRBBBBBOODDDDDDDDDDOOBBBBBBBBBBBBBBBRR.",
  ".RRBBBBBBOODDDDDDDDDDOOBBBBBBBBBBBBBBRR.",
  ".RRBBBBBBOOOKKKKKDDDDOOBBBBBBBBBBBBBBRR.",
  ".RRBBBBBBBOOKKKKKKDDDDOOBBBBBBBBBBBBBRR.",
  ".RRBBBBBBBOOKKKKKKDDDDOOBBBBBBBBBBBBBRR.",
  ".RRRBBBBBBOOKKKKKKKDDDOOBBBBBBBBBBBBRRR.",
  "..RRBBBBBBOOKKKKKKKDDDOOBBBBBBBBBVBBRR..",
  "..RRBBBBBOOKOKKKKKKKDDDOOBBBBBBBVVVBRR..",
  "...RRBBBBPKKOOKKOOKKDDDOOOOOOBBBBVBRR...",
  "...RRRBBPPPKOOKKOOKKDDDDOOOOOOOBBBRRR...",
  "....RRBBOPKKOOKKOOKKDDDDOODDDDOBBBRR....",
  "....RRRBOOKKOOKKOOOKDDDOOODDDDOOBRRR....",
  ".....RRROOOOOOOOOOOOOOOOOOOOOOOORRR.....",
  "......RRROOOOOOOOOOOOOOOOOOOOOORRR......",
  ".......RRRRBBBBBBBBBBBBBBBBBBRRRR.......",
  "........RRRRBBBBBBBBBBBBBBBBRRRR........",
  "..........RRRRRBBBBBBBBBBRRRRR..........",
  "............RRRRRRRRRRRRRRRR............",
  "..............RRRRRRRRRRRR..............",
  "........................................",
];

describe("the badge grid", () => {
  it("is the approved render, cell for cell", () => {
    expect(BADGE_GRID).toEqual(APPROVED);
  });

  it("is 40 × 40 and uses only its palette", () => {
    expect(BADGE_GRID).toHaveLength(BADGE_SIZE);
    for (const row of BADGE_GRID) {
      expect(row).toHaveLength(BADGE_SIZE);
      for (const ch of row) {
        expect(ch === "." || ch in BADGE_PALETTE, ch).toBe(true);
      }
    }
  });

  it("draws the colours the owner picked", () => {
    expect(BADGE_COLOURS).toEqual({
      R: "#4a3a6a",
      B: "#1a1026",
      Y: "#ffe46b",
      C: "#4ff5e6",
      P: "#ff8fc7",
      V: "#b86bff",
    });
    // The cat keeps Baumy's own colours.
    for (const [ch, colour] of Object.entries(BAUMY_COLOURS)) {
      expect(BADGE_PALETTE[ch]).toBe(colour);
    }
  });

  it("crops Baumy's idle frame 0, facing left, to its 24 × 24 drawn pixels", () => {
    const cat = badgeCat();
    expect(cat).toHaveLength(24);
    for (const row of cat) expect(row).toHaveLength(24);
    // Every drawn edge of the crop touches the art.
    expect(cat[0]).toMatch(/[^.]/);
    expect(cat.at(-1)).toMatch(/[^.]/);
    expect(cat.some((r) => r[0] !== ".")).toBe(true);
    expect(cat.some((r) => r.at(-1) !== ".")).toBe(true);
    // It is the sprite mirrored, not new art: each cropped row is a slice
    // of the frame's row read right to left.
    const frame = BAUMY_FRAMES.idle[0]!;
    const mirrored = frame.map((r) => [...r].reverse().join(""));
    const top = mirrored.findIndex((r) => /[^.]/.test(r));
    const left = Math.min(
      ...mirrored.map((r) => r.search(/[^.]/)).filter((i) => i >= 0),
    );
    cat.forEach((row, y) => {
      expect(mirrored[top + y]!.slice(left, left + 24)).toBe(row);
    });
  });

  it("stamps the cat's pixels unchanged, 8 in and 10 down, under the sparkles", () => {
    // The sparkles go on last: in the approved render the pink one sits on
    // five of the cat's pixels, by its paw.
    const sparkle = new Set(
      BADGE_SPARKLES.flatMap(([x, y]) =>
        [
          [x, y],
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].map(([sx, sy]) => `${sx},${sy}`),
      ),
    );
    const cat = badgeCat();
    let drawn = 0;
    let covered = 0;
    cat.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (!CAT.has(ch)) return;
        if (sparkle.has(`${8 + x},${10 + y}`)) {
          covered++;
          return;
        }
        drawn++;
        expect(BADGE_GRID[10 + y]![8 + x]).toBe(ch);
      }),
    );
    expect(drawn).toBeGreaterThan(300);
    expect(covered).toBe(5);
    // And no cat colour appears anywhere else (the rim is its own "R").
    const inGrid = BADGE_GRID.join("")
      .split("")
      .filter((ch) => CAT.has(ch)).length;
    expect(inGrid).toBe(drawn);
  });

  it("is a round badge: a rim 2 cells wide around the plum inside", () => {
    // Along the middle row, from the left edge in.
    expect(BADGE_GRID[20]!.slice(0, 1 + BADGE_RIM + 1)).toBe(".RRB");
    expect(BADGE_GRID[0]).toBe(".".repeat(BADGE_SIZE));
    // The corners are clear; the top edge is rim.
    for (const [x, y] of [
      [0, 0],
      [39, 0],
      [0, 39],
      [39, 39],
      [3, 3],
    ] as const) {
      expect(BADGE_GRID[y]![x]).toBe(".");
    }
    expect(BADGE_GRID[1]![20]).toBe("R");
    expect(BADGE_GRID[3]![20]).toBe("B");
  });

  it("puts four plus-shaped sparkles where the owner saw them", () => {
    expect(BADGE_SPARKLES.map(([, , ch]) => BADGE_PALETTE[ch])).toEqual([
      "#ffe46b",
      "#4ff5e6",
      "#ff8fc7",
      "#b86bff",
    ]);
    for (const [x, y, ch] of BADGE_SPARKLES) {
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        expect(BADGE_GRID[y + dy]![x + dx]).toBe(ch);
      }
      // A plus, not a square.
      expect(BADGE_GRID[y - 1]![x - 1]).not.toBe(ch);
    }
  });
});

describe("BaumyBadge", () => {
  it("draws the grid as a crisp 40 px SVG by default, decorative", () => {
    const out = html(<BaumyBadge />);
    expect(out).toContain('data-sprite="baumy-badge"');
    expect(out).toContain('viewBox="0 0 40 40"');
    expect(out).toContain('width="40"');
    expect(out).toContain('shape-rendering="crispEdges"');
    expect(out).toContain('fill="#ffe46b"');
    expect(out).toContain('fill="#43f0a0"'); // Baumy's green eye
    expect(out).toContain('aria-hidden="true"');
  });

  it("scales, and names itself when labelled", () => {
    const out = html(<BaumyBadge scale={3} label="Baumy" className="x" />);
    expect(out).toContain('width="120"');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Baumy"');
    expect(out).toContain("x");
  });

  it("is the brand mark in the hub header", () => {
    const out = html(
      <AppShell brand="Baumy" nav={null}>
        x
      </AppShell>,
    );
    const header = out.slice(0, out.indexOf("</header>"));
    expect(header).toContain('data-sprite="baumy-badge"');
    expect(header).not.toContain('data-sprite="baumy"');
  });
});
