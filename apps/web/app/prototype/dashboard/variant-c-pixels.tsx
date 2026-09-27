// PROTOTYPE (issue #7), throwaway. Variant C ("Busy"): pixel art drawn from
// string grids, the Camp 404 "#"-grid technique (one character per pixel),
// in warm lounge colours instead of the glitch copies.

import type { CSSProperties } from "react";

/** Render any character grid through a palette. Unknown chars are clear. */
export function Px({
  grid,
  pal,
  scale,
  className,
  style,
}: {
  grid: readonly string[];
  pal: Record<string, string>;
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const w = Math.max(...grid.map((r) => r.length));
  const h = grid.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={scale ? w * scale : undefined}
      height={scale ? h * scale : undefined}
      shapeRendering="crispEdges"
      aria-hidden
      className={className}
      style={style}
    >
      {grid.flatMap((row, y) =>
        [...row].map((ch, x) => {
          const c = pal[ch];
          return c ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c} /> : null;
        }),
      )}
    </svg>
  );
}

// ---- 10×10-ish one-colour glyphs ("#" = ink, "=" = accent) ----
export const GLYPHS = {
  tp: [
    "..######..",
    ".#......#.",
    "#..####..#",
    "#..#==#..#",
    "#..####..#",
    ".#......##",
    ".#......#.",
    ".#.=.=..#.",
    ".#......#.",
    "..######..",
  ],
  catfood: [
    ".########.",
    "#========#",
    ".########.",
    ".#......#.",
    ".#.###.##.",
    ".##=..###.",
    ".#.###.##.",
    ".#......#.",
    ".########.",
    "..........",
  ],
  soap: [
    "...####...",
    ".....#....",
    "....###...",
    "....#.#...",
    "...#...#.=",
    "..#.....#.",
    "..#.==..#=",
    "..#.==..#.",
    "..#.....#.",
    "...#####..",
  ],
  coffee: [
    "..=..=....",
    "...=..=...",
    "..=..=....",
    "..........",
    "#######...",
    "#.....###.",
    "#.===.#.#.",
    "#.....###.",
    ".#...#....",
    "..###.....",
  ],
  bin: [
    "...####...",
    "##########",
    "..........",
    ".########.",
    ".#.#..#.#.",
    ".#.#..#.#.",
    ".#.#..#.#.",
    ".#.#..#.#.",
    ".#......#.",
    "..######..",
  ],
  litter: [
    "..=....=..",
    ".===..===.",
    "..=.==.=..",
    "....==....",
    "..........",
    "##########",
    "#........#",
    "#.#.#.#.##",
    "#........#",
    ".########.",
  ],
  kettle: [
    "....##......",
    "..######....",
    ".#......#...",
    "#........#.#",
    "#..====..##.",
    "#........#..",
    "#........#..",
    ".#......#...",
    "..######....",
    "############",
  ],
  fridge: [
    ".########.",
    ".#......#.",
    ".#.#..=.#.",
    ".#......#.",
    ".########.",
    ".#......#.",
    ".#.#....#.",
    ".#.#..=.#.",
    ".#......#.",
    ".########.",
  ],
  vacuum: [
    ".....###..",
    ".......#..",
    "......#...",
    "......#...",
    ".....#....",
    "...#####..",
    "..#.....#.",
    "..#.===.#.",
    "..#######.",
    ".##....##.",
  ],
  plant: [
    "....=.....",
    "..=.#.=...",
    "...###....",
    ".=..#..=..",
    "..#.#.#...",
    "...###....",
    "#########.",
    ".#.....#..",
    ".#.....#..",
    "..#####...",
  ],
  cart: [
    "#.........",
    ".#########",
    ".#.......#",
    ".#.=.=.=.#",
    ".#.......#",
    ".########.",
    ".#........",
    ".#########",
    "..##...##.",
    "..##...##.",
  ],
  wrench: [
    "##..##....",
    "##..##....",
    ".####.....",
    "..####....",
    "....###...",
    ".....###..",
    "......###.",
    ".......###",
    "........##",
    "..........",
  ],
  sparkle: [
    "....#....",
    "....#....",
    "...###...",
    "#########",
    "...###...",
    "....#....",
    "....#....",
  ],
  alarm: [
    "##......##",
    "#..####..#",
    ".#......#.",
    "#...#....#",
    "#...#....#",
    "#...###..#",
    "#........#",
    ".#......#.",
    "..######..",
    ".#......#.",
  ],
  hourglass: [
    "##########",
    ".#......#.",
    "..#====#..",
    "...#==#...",
    "....##....",
    "....##....",
    "...#..#...",
    "..#.==.#..",
    ".#.====.#.",
    "##########",
  ],
  coin: [
    "..######..",
    ".#......#.",
    "#..####..#",
    "#..#.....#",
    "#.####...#",
    "#..#.....#",
    "#..####..#",
    "#........#",
    ".#......#.",
    "..######..",
  ],
  flame: [
    "....#.....",
    "...##.....",
    "...###..#.",
    "..####.##.",
    "..#######.",
    ".###=####.",
    ".##===###.",
    ".##===###.",
    "..##=###..",
    "...####...",
  ],
  crown: [
    "....=....",
    "#..###..#",
    "##.###.##",
    "#########",
    "#########",
    "#.=.#.=.#",
    "#########",
  ],
  check: [
    ".........#",
    "........##",
    ".......##.",
    "#.....##..",
    "##...##...",
    ".##.##....",
    "..###.....",
    "...#......",
  ],
  msg: [
    "##########",
    "#........#",
    "#.##.###.#",
    "#........#",
    "#.####.#.#",
    "#........#",
    "##########",
    "..##......",
    ".#........",
    "#.........",
  ],
  home: [
    "....##....",
    "...####...",
    "..######..",
    ".########.",
    "##########",
    ".#......#.",
    ".#.##.=.#.",
    ".#.##...#.",
    ".#.##...#.",
    ".########.",
  ],
  calendar: [
    ".#....#...",
    "##########",
    "#........#",
    "##########",
    "#.#.#.#.##",
    "#........#",
    "#.#.#.#..#",
    "#......###",
    "#.#.#..#.#",
    "##########",
  ],
  board: [
    "##########",
    "#..=.....#",
    "#.###.##.#",
    "#..#.....#",
    "#.....=..#",
    "#.##.###.#",
    "#.....#..#",
    "##########",
    "...#..#...",
    "..#....#..",
  ],
  shop: [
    "...####...",
    "..#....#..",
    "..#....#..",
    "##########",
    "#........#",
    "#.#....#.#",
    "#........#",
    "#...==...#",
    "#........#",
    "##########",
  ],
  trophy: [
    "##########",
    "#.######.#",
    "#.##=###.#",
    ".#.####.#.",
    "...####...",
    "....##....",
    "....##....",
    "...####...",
    "..######..",
    "..######..",
  ],
  mic: [
    "...####...",
    "...#==#...",
    "...#..#...",
    "...#==#...",
    ".#.####.#.",
    ".#......#.",
    "..#....#..",
    "...####...",
    "....##....",
    "..######..",
  ],
  cloud: [
    "...###....",
    "..#...#.=.",
    ".#.....##=",
    "#........#",
    "##########",
    "..........",
    "..=..=..=.",
    ".=..=..=..",
  ],
  bolt: [
    "....###.",
    "...###..",
    "..###...",
    ".######.",
    "...###..",
    "..###...",
    ".##.....",
    ".#......",
  ],
  heart: [
    ".##..##.",
    "########",
    "########",
    ".######.",
    "..####..",
    "...##...",
  ],
  pin: [
    "..####..",
    ".#====#.",
    ".#====#.",
    "..####..",
    "...##...",
    "...##...",
    "...#....",
  ],
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** A one-colour pixel glyph, square and centred, with a hard drop shadow. */
export function Glyph({
  name,
  color = "currentColor",
  accent,
  size = 40,
  shadow = true,
  className,
  style,
}: {
  name: GlyphName;
  color?: string;
  accent?: string;
  size?: number;
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const grid = GLYPHS[name];
  const w = Math.max(...grid.map((r) => r.length));
  const h = grid.length;
  const s = Math.max(w, h);
  return (
    <svg
      viewBox={`${-(s - w) / 2} ${-(s - h) / 2} ${s} ${s}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden
      className={className}
      style={{
        filter: shadow ? `drop-shadow(${Math.max(1, Math.round(size / 20))}px ${Math.max(1, Math.round(size / 20))}px 0 #07040c)` : undefined,
        ...style,
      }}
    >
      {grid.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "#" || c === "=" ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={c === "=" ? (accent ?? color) : color}
              opacity={c === "=" && !accent ? 0.6 : 1}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

// ---- housemates: 12×16 people, hair style per person ----
const BODY = [
  "..KSSSSSSK..",
  ".KSSSSSSSSK.",
  "KsKSSddSSKsK",
  "KsKSSSSSSKsK",
  ".KKppppppKK.",
  "..KppKKppK..",
  "..KooK.KooK.",
];

const HEADS: Record<string, string[]> = {
  ryan: [
    "............",
    "...KKKKKK...",
    "..KhhhhhhK..",
    ".KhhhhhhhhK.",
    ".KhsshhsshK.",
    ".KssssssssK.",
    ".KsKssssKsK.",
    ".KssssssssK.",
    "..KssmmssK..",
  ],
  jo: [
    "...KKKKKK...",
    "..KhhhhhhK..",
    ".KhhhhhhhhK.",
    "KhhhhhhhhhhK",
    "hKhsssssshKh",
    "hKssssssssKh",
    "hKsKssssKsKh",
    "hKssssssssKh",
    "hhKssmmssKhh",
  ],
  sam: [
    ".K.K.KK.K.K.",
    "KhKhKhhKhKhK",
    ".KhhhhhhhhK.",
    ".KhhhhhhhhK.",
    ".KssssssssK.",
    ".KssssssssK.",
    ".KsKssssKsK.",
    ".KssssssssK.",
    "..KssmmssK..",
  ],
  mika: [
    "...KKKKKK...",
    "..KhhhhhhK..",
    ".KhhhhhhhhK.",
    "KhhhhhhhhhhK",
    "KhhhhhhhhhhK",
    "KhKssssssKhK",
    "KhKsKssKsKhK",
    "KhKssssssKhK",
    ".KKssmmssKK.",
  ],
};

const NECK = "...KKssKK...";

const SKIN: Record<string, string> = {
  ryan: "#f2c29b",
  jo: "#f0b894",
  sam: "#a8704a",
  mika: "#f7d8bd",
};

export function Person({
  id,
  hair,
  shirt,
  scale = 3,
  className,
  style,
}: {
  id: string;
  hair: string;
  shirt: string;
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const grid = [...(HEADS[id] ?? HEADS.ryan!), NECK, ...BODY];
  return (
    <Px
      grid={grid}
      scale={scale}
      className={className}
      style={style}
      pal={{
        K: "#0b0712",
        h: hair === "#111111" ? "#2a2238" : hair,
        s: SKIN[id] ?? "#f2c29b",
        m: "#c2416b",
        S: shirt,
        d: "#0b0712",
        p: "#3a2c5c",
        o: "#1a1226",
      }}
    />
  );
}

// ---- raccoons: 18×10, two walk frames, facing right ----
const RACCOON_TOP = [
  "............K..K..",
  "...........KgKKgK.",
  "..........KggggggK",
  "Gt........KMeMMeMK",
  ".tGt....KgggWWWWKK",
  "..tGtKKKggggggggK.",
  "...KgggggggggggK..",
  "...KgggggggggggK..",
];
export const RACCOON_A = [...RACCOON_TOP, "...KGK..KGK.KGK...", "...KK...KK...KK..."];
export const RACCOON_B = [...RACCOON_TOP, "....KGK.KGK..KGK..", ".....KK..KK...KK.."];
export const RACCOON_PAL = {
  K: "#07040c",
  g: "#7d7590",
  G: "#3b3448",
  t: "#1d1726",
  W: "#d9d3e6",
  M: "#15101d",
  e: "#ffe46b",
};

/** A raccoon trotting in place: two frames flipped by steps(). */
export function Raccoon({ scale = 4, flip = false }: { scale?: number; flip?: boolean }) {
  return (
    <span className="relative inline-block" style={{ transform: flip ? "scaleX(-1)" : undefined }}>
      <Px grid={RACCOON_A} pal={RACCOON_PAL} scale={scale} className="vc-frame-a block" />
      <Px grid={RACCOON_B} pal={RACCOON_PAL} scale={scale} className="vc-frame-b absolute inset-0" />
    </span>
  );
}

// ---- coin stacks for the savings pot ----
export function CoinStacks({ heights, scale = 3 }: { heights: number[]; scale?: number }) {
  const max = Math.max(...heights);
  const rows = max * 2 + 2;
  const grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    heights.forEach((h) => {
      const top = rows - (h * 2 + 2);
      const i = r - top;
      let cell = ".........";
      if (i === 0) cell = "..KKKKK..";
      else if (i === 1) cell = ".KYYWYYK.";
      else if (i > 1 && i < h * 2 + 2) cell = i % 2 === 0 ? ".KyyyyyK." : ".KYYYYYK.";
      if (i === h * 2 + 1) cell = "..KKKKK..";
      line += cell;
    });
    grid.push(line);
  }
  return <Px grid={grid} scale={scale} pal={{ K: "#3a1d08", Y: "#ffd24a", y: "#e79a2c", W: "#fff7c2" }} />;
}
