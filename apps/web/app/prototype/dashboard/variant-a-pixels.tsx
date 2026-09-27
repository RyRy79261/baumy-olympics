// PROTOTYPE (issue #7), throwaway. Variant A's pixel art: chunky SNES-style
// item icons drawn from string grids. Every grid gets an automatic dark
// outline one grid-pixel thick, so at scale 5 the outline reads as a bold
// stroke. Same technique as baumy-sprite.tsx.

import type { CSSProperties } from "react";

export const APAL: Record<string, string> = {
  K: "#0b0712",
  W: "#ffffff",
  Y: "#ffe46b",
  O: "#ffb347",
  o: "#c46a1f",
  R: "#ff4d6d",
  r: "#b3173f",
  P: "#ff8fc7",
  p: "#c24f8c",
  T: "#4ff5e6",
  t: "#1fa89c",
  V: "#8f7dff",
  v: "#5842d8",
  G: "#43f0a0",
  g: "#1f9e66",
  S: "#d9d3e6",
  s: "#8d84a3",
  D: "#4a4060",
  N: "#a0673f",
  n: "#6a3f24",
  C: "#fff0d6",
  c: "#d9b98f",
  F: "#ff6b3d",
  I: "#bfe3ff",
  i: "#6f9fd0",
  M: "#1b1424",
  A: "#9a91aa",
  a: "#5c536d",
  E: "#f2c29b",
  e: "#d6936a",
  L: "#2c2342",
  B: "#7a1f3d",
};

export const ICONS = {
  star: [
    ".......YY.......",
    "......YWYY......",
    "......YWYY......",
    ".....YYWYYY.....",
    "YYYYYYWYYYYYYYYY",
    ".YYWWYYYYYYYYYO.",
    "..YYYYYYYYYYYO..",
    "...YYYKYYKYYO...",
    "....YYYYYYYO....",
    "....YYYPPYYO....",
    "...YYYYYYYYYO...",
    "...YYYYOOYYYO...",
    "..YYYYO..OYYYO..",
    "..YYYO....OYYO..",
    ".YYOO......OOYO.",
    ".OO..........OO.",
  ],
  siren: [
    "................",
    "......RRRR......",
    "....RRWWRRRR....",
    "...RRWWRRRRRr...",
    "...RWWRRRRRRr...",
    "..RRWRRWWRRRRr..",
    "..RRRRRWWRRRRr..",
    "..RRRRRWWRRRRr..",
    "..RRRRRWWRRRRr..",
    "..RRRRRRRRRRRr..",
    "..RRRRRWWRRRRr..",
    "..rrrrrrrrrrrr..",
    ".SSSSSSSSSSSSSS.",
    ".SWWSSSSSSSSSSs.",
    ".ssssssssssssss.",
    "................",
  ],
  bag: [
    "................",
    ".....TTTTTT.....",
    "....TT....TT....",
    "....T......T....",
    "..TTTTTTTTTTTT..",
    "..TWWTTTTTTTTt..",
    "..TWTTTTTTTTTt..",
    "..TTTTTTTTTTTt..",
    "..TTTTTPPTTTTt..",
    "..TTTTPPPPTTTt..",
    "..TTTPPWPPPTTt..",
    "..TTTTPPPPTTTt..",
    "..TTTTTPPTTTTt..",
    "..TTTTTTTTTTTt..",
    "..tttttttttttt..",
    "................",
  ],
  broom: [
    "..............NN",
    ".............NNn",
    "............NNn.",
    "...........NNn..",
    "..........NNn...",
    ".........NNn....",
    "........NNn.....",
    "......VVVn......",
    ".....VVWVV......",
    "....YYVVVv......",
    "...YYYYYVv......",
    "..YOYYYYYv......",
    ".YOYOYYYO.......",
    "YOYOYOYO........",
    "OYOYOYO.........",
    ".O.O.O..........",
  ],
  crown: [
    ".Y....Y....Y.",
    "YWY..YWY..YYY",
    ".YY..YYY..YY.",
    ".YYYYYYYYYYY.",
    ".YWYYYYYYYYY.",
    ".YPYYYTYYYPY.",
    ".YYYYYYYYYYY.",
    ".OOOOOOOOOOO.",
  ],
  jar: [
    "...nnnnnn...",
    "...NNNNNN...",
    "..IIIIIIII..",
    ".IWIIIIIIIi.",
    ".IWIYYYYIIi.",
    ".IIYYWYYYIi.",
    ".IIYYYYYYIi.",
    ".IIIYYYYIIi.",
    ".IIYYYYYYIi.",
    ".IYYOYYYYYi.",
    "..iiiiiiii..",
  ],
  flame: [
    "....F.....",
    "...FF.....",
    "...FFF..F.",
    "..FFOF.FF.",
    "..FOOFFFF.",
    ".FFOOYOFF.",
    ".FOOYYOOFF",
    ".FOYYWYOOF",
    ".FOYWWYYOF",
    ".FFOYYYOFF",
    "..FFOOOFF.",
    "...FFFFF..",
  ],
  // item icons (12 wide)
  tp: [
    "..WWWWWWW...",
    ".WSSSSSSSW..",
    ".WSDDSSSSW..",
    ".WSDDSSSSW..",
    ".WSSSSSSSWWW",
    ".WSSSSSSSWSW",
    ".WSSSSSSSWSW",
    "..WWWWWWW.SW",
    "..........SW",
    "..........SS",
  ],
  catfood: [
    "..SSSSSSSS..",
    ".SWWWWWWWWS.",
    ".sSSSSSSSSs.",
    ".PPPPPPPPPP.",
    ".PWPPPTPPPP.",
    ".PPPTTTTPTP.",
    ".PPTTKTTTTP.",
    ".PPPTTTTPTP.",
    ".PPPPPTPPPP.",
    ".pppppppppp.",
    ".ssssssssss.",
  ],
  soap: [
    ".....DDD....",
    ".....D.DD...",
    "....SSS.....",
    "....SSS.....",
    "...GGGGG....",
    "..GWGGGGG...",
    "..GWGGGGG...",
    "..GGWWWGG...",
    "..GGWWWGG...",
    "..GGGGGGG...",
    "..ggggggg...",
  ],
  coffee: [
    "...W..W.....",
    "....W..W....",
    "...W..W.....",
    "............",
    ".CCCCCCCC...",
    ".NnnnnnnNCC.",
    ".CCCCCCCCC.C",
    ".CWCCCCCCC.C",
    ".CWCCCCCCCC.",
    "..CCCCCCC...",
    "...ccccc....",
  ],
  bin: [
    ".....DD.....",
    ".SSSSSSSSSS.",
    ".ssssssssss.",
    "..SWSSSSSs..",
    "..SWSsSsSs..",
    "..SWSsSsSs..",
    "..SSSsSsSs..",
    "..SSSsSsSs..",
    "..SSSSSSSs..",
    "...ssssss...",
  ],
  litter: [
    "............",
    ".VVVVVVVVVV.",
    ".VCYCYCYCYV.",
    ".VVVVVVVVVV.",
    ".VWVVVVVVVv.",
    ".VVVKVVKVVv.",
    ".VVKVKKVKVv.",
    ".VVVKKKKVVv.",
    ".VVVKKKKVVv.",
    ".vvvvvvvvvv.",
  ],
  kettle: [
    ".....DD.....",
    "...DDDDDD...",
    "..SSSSSSSS..",
    ".SWSSSSSSSS.S",
    ".SWSSSSSSSSSS",
    ".SSSSSSSSSSS.",
    ".SSSSRSSSSs..",
    ".SSSSSSSSSs..",
    "..sssssssss..",
  ],
  fridge: [
    "..SSSSSSSS..",
    "..SWSSSSSS..",
    "..SWSSSSDS..",
    "..SSSSSSDS..",
    "..ssssssss..",
    "..SWSSSSSS..",
    "..SWSSSSDS..",
    "..SWSSSSDS..",
    "..SSSSSSDS..",
    "..ssssssss..",
    "...D....D...",
  ],
  vacuum: [
    ".........VV.",
    "........VV..",
    ".......VV...",
    "......VV....",
    ".....VV.....",
    "....VV......",
    "...VV.......",
    "..VVV.......",
    ".PPPPPPP....",
    ".PWPPPPPP...",
    ".pppppppp...",
    ".D.....D....",
  ],
  plant: [
    "...G...G....",
    "..GGG.GGG...",
    "..GgGGGgG...",
    "...GGGGG....",
    "....GgG.....",
    ".....G......",
    "...NNNNN....",
    "..NNNNNNN...",
    "...NnnnN....",
    "...NnnnN....",
    "....nnn.....",
  ],
  // nav (10 wide)
  home: [
    "....OO....",
    "...OOOO...",
    "..OOOOOO..",
    ".OOOOOOOO.",
    "OOOOOOOOOO",
    ".CCCCCCCC.",
    ".CTTCCNNC.",
    ".CTTCCNNC.",
    ".CCCCCNNC.",
  ],
  cal: [
    ".D..D..D..",
    "RRRRRRRRRR",
    "WWWWWWWWWW",
    "WSWSWSWSWW",
    "WWWWWWWWWW",
    "WSWSWRWSWW",
    "WWWWWWWWWW",
    "WSWSWSWSWW",
    "WWWWWWWWWW",
  ],
  note: [
    "....RR....",
    "....RR....",
    ".YYYYYYYY.",
    ".YDDDDDYY.",
    ".YYYYYYYY.",
    ".YDDDDYYY.",
    ".YYYYYYYY.",
    ".YDDDYYYY.",
    ".OOOOOOOO.",
  ],
  trophy: [
    ".YYYYYYYY.",
    "YYWYYYYYOY",
    "Y.YWYYYO.Y",
    ".YYYYYYYO.",
    "..YYYYYO..",
    "...YYYO...",
    "....YO....",
    "..OOOOOO..",
    "..oooooo..",
  ],
  mic: [
    "...VVVV...",
    "..VWVVVV..",
    "..VWVVVV..",
    "..VVVVVV..",
    "S.VVVVVV.S",
    "S.vvvvvv.S",
    ".S......S.",
    "..SSSSSS..",
    "....SS....",
    "..SSSSSS..",
  ],
  bubble: [
    "SSSSSSSSSSSS",
    "SWSSSSSSSSSS",
    "SSSSSSSSSSSS",
    "SSDSSDSSDSSS",
    "SSSSSSSSSSSS",
    "ssssssssssss",
    "..sss.......",
    "..ss........",
    "..s.........",
  ],
  check: [
    ".........GG",
    "........GGg",
    ".......GGg.",
    "GG....GGg..",
    "gGG..GGg...",
    ".gGGGGg....",
    "..gGGg.....",
    "...gg......",
  ],
  sock: [
    "..PPPP..",
    "..WWWW..",
    "..PPPP..",
    "..PWPP..",
    "..PPPP..",
    ".PPPPP..",
    "PPPPPP..",
    "PPPPP...",
    ".ppp....",
  ],
  box: [
    "cccccccccccc",
    "cNNNNcNNNNNc",
    "cNNNNcNNNNNc",
    "cccccCcccccc",
    "cNNNNNNNNNNc",
    "cNNnnnnnNNNc",
    "cNNNNNNNNNNc",
    "cNNNNNNNNNNc",
    "cNNNNNNNNNNc",
    "nnnnnnnnnnnn",
  ],
  moon: [
    "...CCCC...",
    ".CCCCC....",
    ".CCCC.....",
    "CCCC......",
    "CCCC......",
    "CCCCc.....",
    ".CCCCc....",
    ".cCCCCCc..",
    "...cccc...",
  ],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

// Housemate: H hair, T shirt are filled per person.
const PERSON = [
  "...HHHHHH...",
  "..HHHHHHHH..",
  ".HHHHHHHHHH.",
  ".HHEEEEEEHH.",
  ".HEEEEEEEEH.",
  ".HEKEEEEKEH.",
  "..EPEEEEPE..",
  "..EEKEEKEE..",
  "...EEKKEE...",
  "..TTTTTTTT..",
  ".TTTTTTTTTT.",
  "ETTTTTTTTTTE",
  "E.TTTTTTTT.E",
  "..LLLLLLLL..",
  "..LLL..LLL..",
  "..DDD..DDD..",
];
const PERSON_CHEER = [
  "E..HHHHHH..E",
  "E.HHHHHHHH.E",
  "EHHHHHHHHHHE",
  "THHEEEEEEHHT",
  "THEEEEEEEEHT",
  "THEKEEEEKEHT",
  "TTEPEEEEPETT",
  ".TEKEEEEKET.",
  ".T.EKKKKE.T.",
  "..TTTTTTTT..",
  ".TTTTTTTTTT.",
  ".TTTTTTTTTT.",
  "..TTTTTTTT..",
  "..LLLLLLLL..",
  "..LLL..LLL..",
  "..DDD..DDD..",
];

// Raccoon facing right, two walk frames.
const COON_A = [
  "............A...A.",
  "...........AaAAAaA",
  "...........AAAAAAA",
  "...........MMMAMMM",
  "a.a........MWMMMWM",
  "aAaA.......AAAWWWWK",
  "aAaAAAAAAAAAAAAWW..",
  ".aAaAAAAAAAAAAAA...",
  "..aAAAAAAAAAAAAA...",
  "...AAAAAAAAAAAAA...",
  "...aa..aa..aa..aa..",
  "...aa...a...a..aa..",
];
const COON_B = [
  "............A...A.",
  "...........AaAAAaA",
  "...........AAAAAAA",
  "...........MMMAMMM",
  ".a.a.......MWMMMWM",
  "AaAa.......AAAWWWWK",
  "AaAaAAAAAAAAAAAWW..",
  ".AaAAAAAAAAAAAAA...",
  "..aAAAAAAAAAAAAA...",
  "...AAAAAAAAAAAAA...",
  "....aa.aa..aa.aa...",
  ".....a..aa..a..aa..",
];

type Run = { x: number; y: number; w: number; c: string };
const cache = new Map<string, { runs: Run[]; w: number; h: number }>();

function build(rows: readonly string[], pal: Record<string, string>, outline: string | null, key: string) {
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = outline ? 1 : 0;
  const h0 = rows.length;
  const w0 = Math.max(...rows.map((r) => r.length));
  const W = w0 + pad * 2;
  const H = h0 + pad * 2;
  const grid: (string | null)[][] = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = pal[ch];
      if (c) grid[y + pad]![x + pad] = c;
    }),
  );
  if (outline) {
    const filled = grid.map((r) => r.map((c) => c !== null));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (filled[y]![x]) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
            if (filled[y + dy]?.[x + dx]) near = true;
          }
        if (near) grid[y]![x] = outline;
      }
  }
  const runs: Run[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const c = row[x];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === c) w++;
      runs.push({ x, y, w, c });
      x += w;
    }
  });
  const out = { runs, w: W, h: H };
  cache.set(key, out);
  return out;
}

export function PixelGrid({
  rows,
  pal = APAL,
  scale = 4,
  outline = "#0b0712",
  cacheKey,
  className,
  style,
  label,
}: {
  rows: readonly string[];
  pal?: Record<string, string>;
  scale?: number;
  outline?: string | null;
  cacheKey: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const { runs, w, h } = build(rows, pal, outline, cacheKey);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {runs.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  );
}

export function Icon({ name, scale = 4, className, style }: { name: IconName; scale?: number; className?: string; style?: CSSProperties }) {
  return <PixelGrid rows={ICONS[name]} scale={scale} cacheKey={`i:${name}`} className={className} style={style} />;
}

export function Person({
  hair,
  shirt,
  scale = 6,
  cheer = false,
  className,
}: {
  hair: string;
  shirt: string;
  scale?: number;
  cheer?: boolean;
  className?: string;
}) {
  const pal = { ...APAL, H: hair, T: shirt };
  return (
    <PixelGrid
      rows={cheer ? PERSON_CHEER : PERSON}
      pal={pal}
      scale={scale}
      outline="#000000"
      cacheKey={`p:${hair}:${shirt}:${cheer}`}
      className={className}
    />
  );
}

export function Raccoon({ scale = 5 }: { scale?: number }) {
  return (
    <span className="relative inline-block">
      <PixelGrid rows={COON_A} scale={scale} cacheKey="coonA" outline="#07040c" className="va-frame-a block" />
      <PixelGrid rows={COON_B} scale={scale} cacheKey="coonB" outline="#07040c" className="va-frame-b absolute inset-0" />
    </span>
  );
}
