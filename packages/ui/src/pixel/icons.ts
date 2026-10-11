// The 16×16 multi-colour icons from the approved prototype (branch
// proto/kiosk-home-pixel, calm-icons.ts): the header's Bounties star,
// Shopping basket (issue #193) and Messages envelope, and the wrench and
// board. One character per pixel through each icon's own palette ("." is
// clear). Copied as drawn. (The siren, the Urgent icon's, went with Urgent,
// issues #189 and #193.)

import type { Palette, Sprite } from "./pixel-grid";

export interface PixelIconArt {
  grid: Sprite;
  pal: Palette;
}

const INK = "#0b0712";

export const STAR = {
  grid: [
    "................",
    ".......KK.......",
    "......KYYK......",
    "......KYYK......",
    ".....KYWYYK.....",
    "KKKKKKYWYYKKKKKK",
    "KYYYYYYYYYYYYYYK",
    ".KYYYYYYYYYYYYK.",
    "..KYYYYYYYYYYK..",
    "...KYYYYYYYYK...",
    "...KYYYYYYYYK...",
    "..KYYYYyyYYYYK..",
    "..KYYYyKKyYYYK..",
    ".KYYyKK..KKyYYK.",
    ".KyKK......KKyK.",
    ".KK..........KK.",
  ],
  pal: { K: INK, Y: "#ffe46b", y: "#d9a520", W: "#fffbe0" },
} satisfies PixelIconArt;

export const ENVELOPE = {
  grid: [
    "................",
    "................",
    "................",
    "KKKKKKKKKKKKKKKK",
    "KKWWWWWWWWWWWWKK",
    "KWKWWWWWWWWWWKWK",
    "KWWKWWWWWWWWKWWK",
    "KWWWKWWWWWWKWWWK",
    "KWWWWKWWWWKWWWWK",
    "KWWWWWKPPKWWWWWK",
    "KWWWWWWPPWWWWWWK",
    "KwwwwwwwwwwwwwwK",
    "KwwwwwwwwwwwwwwK",
    "KKKKKKKKKKKKKKKK",
    "................",
    "................",
  ],
  pal: { K: INK, W: "#efe6ff", w: "#c3b2e3", P: "#ff8fc7" },
} satisfies PixelIconArt;

export const BASKET = {
  grid: [
    "................",
    "................",
    ".....KKKKKK.....",
    "....K......K....",
    "...K..KGK...K...",
    "...K..KGK...K...",
    "KKKKKKKKKKKKKKKK",
    "KAAAAAAAAAAAAAAK",
    "KaaaaaaaaaaaaaaK",
    ".KAaAaAaAaAaAaK.",
    ".KAaAaAaAaAaAaK.",
    ".KAaAaAaAaAaAaK.",
    "..KAaAaAaAaAaK..",
    "..KAAAAAAAAAAK..",
    "..KKKKKKKKKKKK..",
    "................",
  ],
  pal: { K: INK, A: "#ffb347", a: "#b86a1c", G: "#43f0a0" },
} satisfies PixelIconArt;

export const WRENCH = {
  grid: [
    "....KK....KK....",
    "...KTTK..KTTK...",
    "...KTTK..KTTK...",
    "...KTTTKKTTTK...",
    "...KTTTTTTTTK...",
    "....KTTTTTTK....",
    ".....KTTTTK.....",
    "......KTtK......",
    "......KTtK......",
    "......KTtK......",
    "......KTtK......",
    "......KTtK......",
    ".....KTTTTK.....",
    ".....KTKKTK.....",
    ".....KTTTTK.....",
    "......KKKK......",
  ],
  pal: { K: INK, T: "#4ff5e6", t: "#1f9e95" },
} satisfies PixelIconArt;

export const BOARD = {
  grid: [
    "KKKKKKKKKKKKKKKK",
    "KFFFFFFFFFFFFFFK",
    "KFccccccccccccFK",
    "KFcWrWWccYYrYcFK",
    "KFcWWWWccYYYYcFK",
    "KFcWkkWccYkkYcFK",
    "KFcWWWWccYYYYcFK",
    "KFcWkWWccYkYYcFK",
    "KFcWWWWccYYYYcFK",
    "KFcccccTrTTcccFK",
    "KFcccccTkkTcccFK",
    "KFcccccTTTTcccFK",
    "KFFFFFFFFFFFFFFK",
    "KKKKKKKKKKKKKKKK",
    "..KF........FK..",
    "..KK........KK..",
  ],
  pal: {
    K: INK,
    F: "#8a5a34",
    c: "#5a3a26",
    W: "#f7ecff",
    Y: "#ffe46b",
    T: "#4ff5e6",
    k: "#3a2c5c",
    r: "#ff4d5e",
  },
} satisfies PixelIconArt;

/** The icons by name. */
export const PIXEL_ICONS = {
  star: STAR,
  envelope: ENVELOPE,
  basket: BASKET,
  wrench: WRENCH,
  board: BOARD,
} as const;

export type PixelIconName = keyof typeof PIXEL_ICONS;
