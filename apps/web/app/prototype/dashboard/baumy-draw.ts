// @ts-nocheck -- PROTOTYPE (issue #7), throwaway.
// Baumy, drawn procedurally as 16-bit pixel art after design/baumy-reference.png:
// a fluffy black cat, green and blue eyes, a pastel party hat, fairy lights.
// Returns rows of palette letters ("." is see-through).

export const BAUMY_PAL: Record<string, string> = {
  o: "#07050c", "0": "#120d1a", "1": "#1d1629", "2": "#2c2340", "3": "#43375c", "4": "#5c4d7a",
  i: "#4a2a48", I: "#8c6a92", G: "#4fd6a0", g: "#23845e", B: "#8a94ff", b: "#4b50c4", k: "#05030a", W: "#ffffff",
  n: "#2a1826", N: "#6b4560", w: "#cfc6e0", H: "#ffb8e0", h: "#c9a7ff", Y: "#ffe46b", T: "#4ff5e6", P: "#ff7ac0", U: "#b86bff",
};
export const BAUMY_W = 44, BAUMY_H = 48;
const W = BAUMY_W, H = BAUMY_H;
export function drawBaumy({ blink = false, twinkle = 0, tail = 0, ear = 0, talk = false }: { blink?: boolean; twinkle?: number; tail?: number; ear?: number; talk?: boolean } = {}): string[] {
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill("."));
  const fill = new Set<string>();
  const inEll = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const inTri = (x: number, y: number, [a, b, c]: number[][]) => { const s = (p: number[], q: number[], r: number[]) => (p[0]-r[0])*(q[1]-r[1])-(q[0]-r[0])*(p[1]-r[1]); const pt=[x,y]; const d1=s(pt,a,b),d2=s(pt,b,c),d3=s(pt,c,a); return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0)); };
  const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const earL = [[9 - ear, 2 + ear], [6, 17], [18, 11]];
  const earR = [[34, 2], [38, 17], [26, 11]];
  const tailC = tail ? [41, 33] : [40, 35];
  const body = (x: number, y: number) =>
    inEll(x, y, 22, 36.5, 16.5, 12) || inEll(x, y, 22, 20, 14.5, 11.5) ||
    inEll(x, y, 22, 25, 16, 5) || // cheek fluff
    inTri(x, y, earL) || inTri(x, y, earR) ||
    (inEll(x, y, tailC[0], tailC[1] + 5, 3, 8) && y > 30); // tail
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let on = body(x + 0.5, y + 0.5);
    // fluffy edge: tufts poke out, spaced
    if (!on && y > 9) {
      const n = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => body(x+0.5+dx*1.2, y+0.5+dy*1.2));
      if (n && hash(x, y) % 4 === 0) on = true;
    }
    if (on) fill.add(`${x},${y}`);
  }
  const has = (x: number, y: number) => fill.has(`${x},${y}`);
  // shading: light from upper left, per part
  for (const k of fill) {
    const [x, y] = k.split(",").map(Number);
    let cx = 22, cy = 20, rx = 14.5, ry = 11.5;
    if (y > 29) { cy = 36.5; rx = 16.5; ry = 12; }
    const lx = (x - cx) / rx, ly = (y - cy) / ry;
    let v = -0.55 * lx - 0.75 * ly + 0.1;
    v += ((hash(x, y) % 7) - 3) * 0.05; // fur texture
    // strands: short darker diagonal flicks
    if (hash(x >> 1, y) % 9 === 0 && (x + y) % 3 === 0) v -= 0.35;
    g[y][x] = v > 0.75 ? "3" : v > 0.25 ? "2" : v > -0.35 ? "1" : "0";
    // rim light on the upper-left silhouette
    if (!has(x - 1, y) && !has(x, y - 1) && x < 24) g[y][x] = "4";
  }
  // inner ears
  const inL = [[9.5 - ear, 5 + ear], [8.5, 15], [15.5, 11.5]], inR = [[33.5, 5], [35.5, 15], [28.5, 11.5]];
  for (let y = 0; y < 18; y++) for (let x = 0; x < W; x++) {
    if (inTri(x + 0.5, y + 0.5, inL) || inTri(x + 0.5, y + 0.5, inR)) g[y][x] = inTri(x + 1.5, y + 0.5, inL) && inTri(x - 0.5, y + 0.5, inL) || inTri(x + 1.5, y + 0.5, inR) && inTri(x - 0.5, y + 0.5, inR) ? "i" : "I";
  }
  // muzzle
  for (let y = 22; y < 29; y++) for (let x = 14; x < 30; x++) if (inEll(x + 0.5, y + 0.5, 22, 25.5, 5.5, 2.8) && g[y][x] !== ".") g[y][x] = g[y][x] === "0" ? "1" : "2";
  const put = (x: number, y: number, c: string) => { if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = c; };
  const stamp = (x0: number, y0: number, rows: string[]) => rows.forEach((r, dy) => [...r].forEach((c, dx) => c !== " " && put(x0 + dx, y0 + dy, c)));
  // eyes (almond, slit pupil, highlight); left green, right blue
  if (blink) {
    stamp(14, 20, ["o   o", " ooo "]);
    stamp(25, 20, ["o   o", " ooo "]);
  } else {
    stamp(14, 18, [" ooo ", "ogkWo", "oGkGo", " ooo "]);
    stamp(25, 18, [" ooo ", "obkWo", "oBkBo", " ooo "]);
  }
  // nose and mouth (a small ω)
  stamp(21, 23, ["NN", "nn"]);
  stamp(20, 25, talk ? [" oo ", "oNNo", " oo "] : [" oo ", "o  o"]);
  // whiskers
  stamp(5, 24, ["wwww", "    www"]);
  stamp(6, 27, ["www", "   ww"]);
  stamp(35, 24, ["wwww"]);
  stamp(32, 25, ["www"]);
  stamp(36, 27, ["www"]);
  stamp(34, 28, ["ww"]);
  // party hat, tilted, between the ears
  stamp(25, 0, [
    "   Y   ",
    "  YWY  ",
    "   H   ",
    "  hHo  ",
    "  HhHo ",
    " HHYhHo",
    " hHHHho",
    "HHhHYHHo",
    "ooooooo ",
  ].map((r) => r.replace(/ /g, " ")));
  // fairy lights: two sagging strands across the chest
  const bulbs = ["T", "P", "U", "Y"];
  const strand = (y0: number, sag: number, phase: number) => {
    for (let x = 7; x <= 37; x++) {
      const t = (x - 7) / 30, y = Math.round(y0 + sag * 4 * t * (1 - t));
      if (g[y]?.[x] && g[y][x] !== ".") g[y][x] = "o";
      if ((x - 7) % 4 === 2 && g[y + 1]?.[x] && g[y + 1][x] !== ".") {
        const c = bulbs[((x - 7) / 4 + phase + twinkle) % 4 | 0];
        put(x, y + 1, c); put(x, y + 2, c);
      }
    }
  };
  strand(31, 4, 0);
  strand(38, 3, 2);
  // front paws
  stamp(14, 44, ["o2323o", "o3o3o3"]);
  stamp(24, 44, ["o2323o", "o3o3o3"]);
  // outline
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== ".") continue;
    if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => has(x+dx, y+dy))) g[y][x] = "o";
  }
  return g.map((r) => r.join(""));
}
