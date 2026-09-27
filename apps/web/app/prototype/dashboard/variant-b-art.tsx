// PROTOTYPE (issue #7), throwaway. Variant B "Lounge": hand-drawn-feeling
// pixel props from the Baumy picture, one character per pixel.

import type { CSSProperties } from "react";

export const LP: Record<string, string> = {
  K: "#0b0712", // outline
  w: "#fff7e6", // paper white
  C: "#f4e4c1", // cream
  Y: "#ffe46b",
  y: "#d9a52b",
  A: "#ffb347", // lantern amber
  a: "#c9642a",
  R: "#ff4d5e",
  r: "#9e1f35",
  T: "#4ff5e6",
  t: "#1f9e96",
  P: "#ff8fc7",
  p: "#b8487f",
  V: "#8f7dff",
  v: "#5842d8",
  L: "#43f0a0",
  l: "#1f9e66",
  N: "#8a5a3b", // wood
  n: "#5e3a24",
  o: "#c08552",
  M: "#c7cbe0", // metal
  g: "#6b6f86",
  d: "#34304a",
  S: "#f2c29b", // skin
  s: "#c98f6b",
  J: "#2b3a67", // jeans
  B: "#241a33", // cat fur
  b: "#3d2d57",
  j: "#1d3a44", // jar glass
  i: "#7ff9ef",
  // Raccoon greys (screensaver)
  x: "#8b8fa3",
  z: "#3a3848",
};

type Run = { x: number; y: number; w: number; c: string };
const cache = new WeakMap<readonly string[], Map<string, Run[]>>();

function runs(rows: readonly string[], pal: Record<string, string>, key: string) {
  let byPal = cache.get(rows);
  if (!byPal) cache.set(rows, (byPal = new Map()));
  const hit = byPal.get(key);
  if (hit) return hit;
  const out: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      const c = pal[ch];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === ch) w++;
      out.push({ x, y, w, c });
      x += w;
    }
  });
  byPal.set(key, out);
  return out;
}

export function Pix({
  rows,
  scale = 4,
  pal,
  className,
  style,
  label,
}: {
  rows: readonly string[];
  scale?: number;
  pal?: Record<string, string>;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const p = pal ? { ...LP, ...pal } : LP;
  const key = pal ? JSON.stringify(pal) : "";
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
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
      {runs(rows, p, key).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  );
}

/* ---------- status ornaments (12×12) ---------- */

export const BULB = [
  ".....KK.....",
  "....KMMK....",
  "....KggK....",
  "....KMMK....",
  "....KYYK....",
  "...KYwYYK...",
  "..KYwwYYYK..",
  "..KYwYYYYK..",
  "..KYYYYYyK..",
  "..KYYYYyyK..",
  "...KYyyyK...",
  "....KKKK....",
];

export const BULB_OFF = BULB.map((r) => r.replace(/[Yyw]/g, "d"));

export const LANTERN = [
  ".....KK.....",
  "....KaaK....",
  "...KKKKKK...",
  "..KaAAAAaK..",
  ".KAYARRAYAK.",
  ".KAYRYYRYAK.",
  ".KARYwwYRAK.",
  ".KAYRYYRYAK.",
  ".KAYARRAYAK.",
  "..KaAAAAaK..",
  "...KKKKKK...",
  ".....aa.....",
];

export const CRATE = [
  "..KKK...KK..",
  ".KCCCK.KTTK.",
  ".KCKCK.KwtK.",
  ".KCCCK.KTTK.",
  "KKKKKKKKKKKK",
  "KooooooooooK",
  "KNNNNNNNNNNK",
  "KnKnnnnnnKnK",
  "KooooooooooK",
  "KNNNNNNNNNNK",
  "KnKnnnnnnKnK",
  "KKKKKKKKKKKK",
];

export const TOOLBOX = [
  "....KKKK....",
  "...KMMMMK...",
  "...KM..MK.KK",
  "KKKKKKKKKKMK",
  "KRRRRRRRRRRK",
  "KRwRRRRRRRRK",
  "KrrrrrrrrrrK",
  "KKKKKMMKKKKK",
  "KRRRRMMRRRRK",
  "KRRRRRRRRRRK",
  "KrrrrrrrrrrK",
  "KKKKKKKKKKKK",
];

/* ---------- bounty icons (12×12) ---------- */

export const BOUNTY_ICONS: Record<string, string[]> = {
  tp: [
    "............",
    "..KKKKKKK...",
    ".KCCCCCCCK..",
    "KCCKKKCCCCK.",
    "KCKddKCCCCK.",
    "KCKddKCCCCK.",
    "KCCKKKCCCCK.",
    ".KCCCCCCCCK.",
    "..KKKKKCCCK.",
    "......KCwCK.",
    "......KCCCK.",
    "......KKKKK.",
  ],
  catfood: [
    "............",
    "..KKKKKKKK..",
    ".KMMMMMMMMK.",
    ".KggggggggK.",
    ".KPPPPPPPPK.",
    ".KPwPPPPPPK.",
    ".KPPTTTPPTK.",
    ".KPTTKTTTTK.",
    ".KPPTTTPPTK.",
    ".KPPPPPPPPK.",
    ".KggggggggK.",
    "..KKKKKKKK..",
  ],
  soap: [
    "....KKK.....",
    "....KMKKKK..",
    "...KKMMMMK..",
    "...KMMKKKK..",
    "..KKKKKKK...",
    ".KTTTTTTTK..",
    ".KTwTTTTTK..",
    ".KTwTwwTTK..",
    ".KTTwwwwTK..",
    ".KTTTwwTTK..",
    ".KtttttttK..",
    "..KKKKKKK...",
  ],
  coffee: [
    "..KKKKKKKK..",
    "..KnNnNnNK..",
    "..KKKKKKKK..",
    ".KNNNNNNNNK.",
    ".KNNNNNNNNK.",
    ".KNCCCCCCNK.",
    ".KNCnnnnCNK.",
    ".KNCnCCnCNK.",
    ".KNCCnnCCNK.",
    ".KNCCCCCCNK.",
    ".KNNNNNNNNK.",
    ".KKKKKKKKKK.",
  ],
  bin: [
    "....KKKK....",
    "KKKKKKKKKKKK",
    "KlLLLLLLLLlK",
    "KKKKKKKKKKKK",
    ".KLlLlLlLlK.",
    ".KLlLlLlLlK.",
    ".KLlLlLlLlK.",
    ".KLlLlLlLlK.",
    ".KLlLlLlLlK.",
    ".KLlLlLlLlK.",
    ".KllllllllK.",
    "..KKKKKKKK..",
  ],
  litter: [
    "............",
    "..K......K..",
    "..KK....KK..",
    "..KbKKKKbK..",
    "..KBBBBBBK..",
    "..KBLBBVBK..",
    "KKKKKKKKKKKK",
    "KPPPPPPPPPPK",
    "KPyYyYyYyYPK",
    "KPPPPPPPPPPK",
    ".KppppppppK.",
    "..KKKKKKKK..",
  ],
  kettle: [
    "....KKKK....",
    "...K....K...",
    "..KKKKKKKK..",
    ".KMMMMMMMMK.",
    "KKMwMMMMMMKK",
    "MKMwMMMMMMKM",
    ".KMMMMMMMMKM",
    ".KMMMRRMMMKM",
    ".KMMMMMMMMKK",
    ".KggggggggK.",
    "..KKKKKKKK..",
    "............",
  ],
  fridge: [
    "..KKKKKKKK..",
    "..KwwwwwwK..",
    "..KwwwwwKK..",
    "..KwwwwwKK..",
    "..KKKKKKKK..",
    "..KwwwwwwK..",
    "..KwwwwwKK..",
    "..KwwwwwKK..",
    "..KwwwPwwK..",
    "..KwwwwwwK..",
    "..KKKKKKKK..",
    "...K....K...",
  ],
  vacuum: [
    "........KK..",
    ".......KMK..",
    "......KMK...",
    ".....KMK....",
    "....KMK.....",
    "...KMK......",
    "KKKKKK......",
    "KVVVVVKKK...",
    "KVwVVVVVVK..",
    "KvvvvvvvvK..",
    ".KKKKKKKK...",
    "..KK..KK....",
  ],
  plant: [
    ".....L......",
    "...L.LL.L...",
    "..LLlLlLL...",
    "...LlLLl.L..",
    "....LlL.LL..",
    ".....l......",
    "..KKKKKKKK..",
    "..KaaaaaaK..",
    "...KAAAAK...",
    "...KAAAAK...",
    "...KaaaaK...",
    "....KKKK....",
  ],
};

export const COIN_JAR = [
  "...KKKKKK...",
  "...KnNNnK...",
  "..KKKKKKKK..",
  ".KijjjjjjjK.",
  ".KijjjjjjjK.",
  ".KijjYYjjjK.",
  ".KijYyyYjjK.",
  ".KiYYyYYYjK.",
  ".KYyYYyYyYK.",
  ".KyYYyYYyYK.",
  ".KYyYYYyYYK.",
  "..KKKKKKKK..",
];

export const CROWN = [
  "Y.Y.Y",
  "YYYYY",
  "YyYyY",
];

export const TODAY_LAMP = [
  "....KK....",
  "....KK....",
  "..KKKKKK..",
  ".KaAAAAaK.",
  "KAAYwYYAAK",
  "KKKKKKKKKK",
];

/* ---------- housemates (12×16) ---------- */

const SHORT_HAIR = [
  "...KKKKKK...",
  "..KHHHHHHK..",
  ".KHHHHHHHHK.",
  ".KHSSSSSSHK.",
  ".KSSKSSKSSK.",
  ".KSSSSSSSSK.",
  ".KSSSppSSSK.",
  "..KSSSSSSK..",
  "...KKSSKK...",
  ".KKEEEEEEKK.",
  "KEEEEEEEEEEK",
  "KSKEEEEEEKSK",
  "KSKeeeeeeKSK",
  ".K.KJJJJK.K.",
  "...KJKKJK...",
  "...KKK.KKK..",
];

const LONG_HAIR = [
  "...KKKKKK...",
  "..KHHHHHHK..",
  ".KHHHHHHHHK.",
  ".KHSSSSSSHK.",
  "KHSSKSSKSSHK",
  "KHSSSSSSSSHK",
  "KHSSSppSSSHK",
  "KHHSSSSSSHHK",
  "KHHKKSSKKHHK",
  ".KKEEEEEEKK.",
  "KEEEEEEEEEEK",
  "KSKEEEEEEKSK",
  "KSKeeeeeeKSK",
  ".K.KJJJJK.K.",
  "...KJKKJK...",
  "...KKK.KKK..",
];

const BUN_HAIR = [
  "....KHHK....",
  "..KKHHHHKK..",
  ".KHHHHHHHHK.",
  ".KHSSSSSSHK.",
  ".KSSKSSKSSK.",
  ".KSSSSSSSSK.",
  ".KSSSppSSSK.",
  "..KSSSSSSK..",
  "...KKSSKK...",
  ".KKEEEEEEKK.",
  "KEEEEEEEEEEK",
  "KSKEEEEEEKSK",
  "KSKeeeeeeKSK",
  ".K.KJJJJK.K.",
  "...KJKKJK...",
  "...KKK.KKK..",
];

const CAP_HAIR = [
  "............",
  "..KKKKKKKK..",
  ".KHHHHHHHHKK",
  ".KHHHHHHHHHK",
  ".KSSKSSKSSK.",
  ".KSSSSSSSSK.",
  ".KSSSppSSSK.",
  "..KSSSSSSK..",
  "...KKSSKK...",
  ".KKEEEEEEKK.",
  "KEEEEEEEEEEK",
  "KSKEEEEEEKSK",
  "KSKeeeeeeKSK",
  ".K.KJJJJK.K.",
  "...KJKKJK...",
  "...KKK.KKK..",
];

const HAIR_BY_ID: Record<string, string[]> = {
  ryan: SHORT_HAIR,
  jo: LONG_HAIR,
  sam: CAP_HAIR,
  mika: BUN_HAIR,
};

function darken(hex: string, f = 0.65) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * f);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0")}`;
}

export function Housemate({
  id,
  hair,
  shirt,
  scale = 4,
  face = false,
  className,
  style,
}: {
  id: string;
  hair: string;
  shirt: string;
  scale?: number;
  face?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const grid = HAIR_BY_ID[id] ?? SHORT_HAIR;
  return (
    <Pix
      rows={face ? grid.slice(0, 9) : grid}
      scale={scale}
      pal={{ H: hair === "#111111" ? "#2a2233" : hair, E: shirt, e: darken(shirt) }}
      className={className}
      style={style}
      label={id}
    />
  );
}

/* ---------- raccoons & night props ---------- */

export const RACCOON_A = [
  "............K..K..",
  "...........KxK.KxK",
  "...........KxxxxxK",
  "KK.........KKwKwKK",
  "KzK.......KxxxxxwK",
  "KxzK..KKKKKKxxxKK.",
  ".KzxKKxxxxxxxxK...",
  "..KzKxxxxxxxxxK...",
  "...KKzzzzzzzzK....",
  "....KzK....KzK....",
  "...KK.......KK....",
];

export const RACCOON_B = [
  ...RACCOON_A.slice(0, 9),
  ".....KzK.KzK......",
  ".....KK...KK......",
];

export const SOCK = [
  "KKKK..",
  "KPwK..",
  "KPwK..",
  "KPPKKK",
  "KwPPwK",
  "KKKKKK",
];

export const BOX = [
  "KKKKKKKKKK",
  "KooNooNooK",
  "KNNNNNNNNK",
  "KNNKKKKNNK",
  "KNNNNNNNNK",
  "KNNNNNNNNK",
  "KnnnnnnnnK",
  "KKKKKKKKKK",
];

export const BANANA = [
  "....YK",
  "..YYK.",
  ".YyK..",
  "YyK...",
];

export const MOON = [
  "..KKKK..",
  ".KCCwwK.",
  "KCCKKK..",
  "KCK.....",
  "KCK.....",
  "KCCKKK..",
  ".KCCwwK.",
  "..KKKK..",
];

/* ---------- footer nav (10×10) ---------- */

export const NAV_ICONS: Record<string, string[]> = {
  home: [
    "....KK....",
    "...KAAK...",
    "..KAAAAK..",
    ".KAAAAAAK.",
    "KKKKKKKKKK",
    ".KCCCCCCK.",
    ".KCKKCCCK.",
    ".KCKYKCCK.",
    ".KCKYKCCK.",
    ".KKKKKKKK.",
  ],
  bounties: [
    "..KKKKKK..",
    ".KwwwwwwK.",
    "KwwKKwwwwK",
    "KwwKKwwwwK",
    "KwwwwwwwwK",
    "KwRRRRwwwK",
    "KwwwwwwwwK",
    "KwRRRwwwwK",
    "KwwwwwwwwK",
    "KKKKKKKKKK",
  ],
  calendar: [
    ".K.K..K.K.",
    "KKKKKKKKKK",
    "KRRRRRRRRK",
    "KKKKKKKKKK",
    "KwwwwwwwwK",
    "KwKwKwKwwK",
    "KwwwwwwwwK",
    "KwKwAAwKwK",
    "KwwwAAwwwK",
    "KKKKKKKKKK",
  ],
  board: [
    "....RR....",
    "....Rr....",
    "..KKKKKK..",
    ".KYYYYYYK.",
    ".KYnnnnYK.",
    ".KYYYYYYK.",
    ".KYnnnYYK.",
    ".KYYYYYYK.",
    ".KYYYYYyK.",
    "..KKKKKK..",
  ],
  shop: [
    "KKK.......",
    "..K.......",
    "..KKKKKKKK",
    "..KTTTTTTK",
    "..KTtTTtTK",
    "..KTTTTTTK",
    "...KKKKKK.",
    "..........",
    "...KK..KK.",
    "...KK..KK.",
  ],
  scores: [
    "KKKKKKKKKK",
    "KYYYYYYYYK",
    "YKYwYYYYKY",
    "YKYwYYYYKY",
    ".KYYYYYYK.",
    "..KYYYYK..",
    "...KyyK...",
    "....KK....",
    "..KKKKKK..",
    "..KnnnnK..",
  ],
};
