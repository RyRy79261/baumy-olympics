// PROTOTYPE (issue #7), throwaway. 16×16 multi-colour pixel icons for the
// calm header, one character per pixel ("." is clear).

export type PixelIcon = { grid: readonly string[]; pal: Record<string, string> };

const INK = "#0b0712";

export const SIREN: PixelIcon = {
  grid: [
    "................",
    "..Y....YY....Y..",
    "...Y........Y...",
    "......KKKK......",
    ".....KRRRRK.....",
    "....KRWWRRRK....",
    "....KRWRRRRK....",
    "....KRWRRRRK....",
    "....KRRRRRRK....",
    "...KRRRRRRRRK...",
    "...KrrrrrrrrK...",
    "..KKKKKKKKKKKK..",
    "..KGGGGGGGGGGK..",
    "..KggggggggggK..",
    "..KKKKKKKKKKKK..",
    "................",
  ],
  pal: { K: INK, R: "#ff4d5e", r: "#b8243a", W: "#ffd0d6", G: "#8d7fae", g: "#4a3d63", Y: "#ffe46b" },
};

export const STAR: PixelIcon = {
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
};

export const ENVELOPE: PixelIcon = {
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
};

export const BASKET: PixelIcon = {
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
};

export const WRENCH: PixelIcon = {
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
};

export const BOARD: PixelIcon = {
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
};
