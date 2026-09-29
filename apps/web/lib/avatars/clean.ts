import "server-only";

// The gallery's cleaning pipeline (issue #111). The owner generates each
// character elsewhere (one shared style prompt, docs/setup.md) and uploads
// it; the app never draws. What arrives is rarely clean: a fake grey
// checkerboard "transparency" painted into the pixels, or a solid black,
// green or white backdrop, a watermark in a corner, and "pixels" that are
// really blocks of a few hundred screen pixels. This turns it into a small,
// true-transparency sprite that sits next to the others:
//
// 1. decode (PNG, JPEG or WebP only; the bytes are sniffed, never trusted
//    from the upload's type) and shrink anything huge;
// 2. find the background's colours from the image's border (one colour for
//    a backdrop, two for a checkerboard) and flood-fill them from the edges,
//    so the character's own dark outline stops the fill;
// 3. for a checkerboard, also clear the enclosed patches (between an arm and
//    the body) that still show both of its colours;
// 4. keep the character: the largest shape, and whatever overlaps it,
//    which drops a watermark in a corner and stray specks;
// 5. trim to it, then snap to a pixel grid: art that is already an exact
//    whole-number blow-up of a sprite goes back to that sprite; anything else
//    is sampled down to `AVATAR_HEIGHT_PX` tall, nearest-neighbour;
// 6. limit the palette to `AVATAR_COLOURS`, no dithering, and keep alpha
//    all-or-nothing.
//
// Ported from the owner-approved experiment (~/baumy-shots/nb/clean2.mjs),
// which hard-coded its crop; here the crop is found. The pixel work is plain
// loops over one RGBA buffer, so it is deterministic: the preview and the
// save of the same file give the same sprite.

/**
 * The height a gallery set is sampled to by default: 64, as these sprites
 * are more detailed than Baumy (owner ruling 2026-09-29; 48 and 56 on offer).
 */
export const AVATAR_HEIGHT_PX = 64;

/** The most colours a gallery sprite keeps. */
export const AVATAR_COLOURS = 24;

/** Bigger images are shrunk to this longest edge before cleaning. */
export const WORK_MAX_EDGE_PX = 2048;

/** Refuse to decode anything with more pixels (a decompression bomb). */
export const INPUT_MAX_PIXELS = 40_000_000;

/**
 * How far (per channel, 0-255) a pixel may be from a background colour, at
 * most. Each colour gets its own: the spread its border pixels show, plus a
 * little, so a noisy painted checkerboard is cleared generously while an
 * exact black backdrop leaves the character's near-black outline alone.
 */
export const KEY_TOLERANCE = 32;
const KEY_TOLERANCE_MIN = 8;

/** What `cleanAvatar` decodes: never SVG, GIF or anything else. */
const FORMATS = new Set(["png", "jpeg", "webp"]);

export interface RgbaImage {
  /** width × height × 4 bytes, row by row. */
  data: Uint8Array;
  width: number;
  height: number;
}

type Rgb = readonly [number, number, number];

/** A background colour and how far from it still counts as it. */
export interface Key {
  c: Rgb;
  tol: number;
}

const opaque = (img: RgbaImage, i: number) => img.data[i * 4 + 3]! >= 128;

/** The largest per-channel difference between pixel `i` and `c`. */
function distance(img: RgbaImage, i: number, c: Rgb): number {
  const o = i * 4;
  return Math.max(
    Math.abs(img.data[o]! - c[0]),
    Math.abs(img.data[o + 1]! - c[1]),
    Math.abs(img.data[o + 2]! - c[2]),
  );
}

/** The index of the key colour `i` is close to, or -1. */
function keyOf(img: RgbaImage, i: number, keys: readonly Key[]): number {
  for (let k = 0; k < keys.length; k++) {
    if (distance(img, i, keys[k]!.c) <= keys[k]!.tol) return k;
  }
  return -1;
}

/**
 * Whether `i` is a blend of two key colours: close to the straight line
 * between them. A painted checkerboard's tiles meet in seams of in-between
 * greys, which would otherwise be left standing as a grid of lines.
 */
function between(img: RgbaImage, i: number, keys: readonly Key[]): boolean {
  const o = i * 4;
  const p = [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      const ka = keys[a]!.c;
      const kb = keys[b]!.c;
      const tol = Math.max(keys[a]!.tol, keys[b]!.tol);
      const d = [kb[0] - ka[0], kb[1] - ka[1], kb[2] - ka[2]];
      const len = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
      const t = Math.min(
        1,
        Math.max(
          0,
          ((p[0]! - ka[0]) * d[0]! +
            (p[1]! - ka[1]) * d[1]! +
            (p[2]! - ka[2]) * d[2]!) /
            len,
        ),
      );
      if (
        [0, 1, 2].every((c) => Math.abs(p[c]! - (ka[c]! + t * d[c]!)) <= tol)
      ) {
        return true;
      }
    }
  }
  return false;
}

function borderIndices(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x++) {
    out.push(x);
    if (height > 1) out.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    out.push(y * width);
    if (width > 1) out.push(y * width + width - 1);
  }
  return out;
}

/**
 * The background's colours, from the opaque pixels on the image's border:
 * each colour that makes up at least 5% of it, up to four (a checkerboard
 * is two). None when the border is too varied to be a backdrop (a photo, or
 * a character touching every edge): then only real transparency is cleared.
 */
export function backgroundKeys(img: RgbaImage): Key[] {
  const clusters: {
    sum: [number, number, number];
    members: number[];
    c: Rgb;
  }[] = [];
  let total = 0;
  for (const i of borderIndices(img.width, img.height)) {
    if (!opaque(img, i)) continue;
    total += 1;
    let hit = clusters.find((c) => distance(img, i, c.c) <= KEY_TOLERANCE);
    const o = i * 4;
    if (!hit) {
      if (clusters.length >= 64) continue;
      hit = {
        sum: [0, 0, 0],
        members: [],
        c: [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!],
      };
      clusters.push(hit);
    }
    hit.sum[0] += img.data[o]!;
    hit.sum[1] += img.data[o + 1]!;
    hit.sum[2] += img.data[o + 2]!;
    hit.members.push(i);
    const n = hit.members.length;
    hit.c = [
      Math.round(hit.sum[0] / n),
      Math.round(hit.sum[1] / n),
      Math.round(hit.sum[2] / n),
    ];
  }
  const keys = clusters
    .filter((c) => c.members.length >= total * 0.05)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 4);
  const covered = keys.reduce((s, c) => s + c.members.length, 0);
  if (total === 0 || covered < total * 0.6) return [];
  return keys.map((k) => {
    let spread = 0;
    for (const i of k.members) spread = Math.max(spread, distance(img, i, k.c));
    return {
      c: k.c,
      tol: Math.min(KEY_TOLERANCE, Math.max(KEY_TOLERANCE_MIN, spread + 8)),
    };
  });
}

/**
 * 1 for every background pixel: transparent, or a key colour reachable from
 * the border through key colours (4-connected). With two or more keys (a
 * checkerboard), an enclosed patch that shows at least two of them is
 * background too; one enclosed colour is left alone, since it may be the
 * character's own white shirt or black boots.
 */
export function backgroundMask(
  img: RgbaImage,
  keys: readonly Key[],
): Uint8Array {
  const { width, height } = img;
  const size = width * height;
  const isBg = (i: number) =>
    !opaque(img, i) || keyOf(img, i, keys) >= 0 || between(img, i, keys);
  const bg = new Uint8Array(size);
  const stack = new Int32Array(size);
  let top = 0;
  const push = (i: number) => {
    if (bg[i] || !isBg(i)) return;
    bg[i] = 1;
    stack[top++] = i;
  };
  for (const i of borderIndices(width, height)) push(i);
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < size - width) push(i + width);
  }
  if (keys.length < 2) return bg;

  // Enclosed patches of key colours: label each, count its colours.
  const seen = new Uint8Array(size);
  for (let start = 0; start < size; start++) {
    if (bg[start] || seen[start] || !isBg(start)) continue;
    const region: number[] = [];
    const counts = new Array<number>(keys.length).fill(0);
    seen[start] = 1;
    stack[0] = start;
    top = 1;
    while (top > 0) {
      const i = stack[--top]!;
      region.push(i);
      const k = keyOf(img, i, keys);
      if (k >= 0) counts[k]! += 1;
      const x = i % width;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i >= width ? i - width : -1,
        i < size - width ? i + width : -1,
      ]) {
        if (j >= 0 && !seen[j] && !bg[j] && isBg(j)) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    const shown = counts.filter((n) => n >= region.length * 0.15).length;
    if (region.length >= 16 && shown >= 2) for (const i of region) bg[i] = 1;
  }
  return bg;
}

/**
 * The size of one art pixel when the image is an exact whole-number blow-up
 * of a smaller sprite: the largest k (2 to 64) that divides both sides and
 * nine in ten runs of one colour, along the rows and the columns. 1 when
 * there is no such grid (drawn-looking pixel art, a photo, JPEG noise).
 */
export function gridSize(img: RgbaImage): number {
  const { width, height, data } = img;
  // One number per pixel, so a run compares all four channels at once.
  const px = new Uint32Array(data.slice().buffer, 0, width * height);
  const runs = new Map<number, number>();
  const count = (n: number) => runs.set(n, (runs.get(n) ?? 0) + 1);
  for (let y = 0; y < height; y++) {
    let n = 1;
    for (let x = 1; x < width; x++) {
      if (px[y * width + x] === px[y * width + x - 1]) n += 1;
      else {
        count(n);
        n = 1;
      }
    }
    count(n);
  }
  for (let x = 0; x < width; x++) {
    let n = 1;
    for (let y = 1; y < height; y++) {
      if (px[y * width + x] === px[(y - 1) * width + x]) n += 1;
      else {
        count(n);
        n = 1;
      }
    }
    count(n);
  }
  let total = 0;
  for (const c of runs.values()) total += c;
  for (let k = Math.min(64, width, height); k >= 2; k--) {
    if (width % k !== 0 || height % k !== 0) continue;
    let fit = 0;
    for (const [len, c] of runs) if (len % k === 0) fit += c;
    if (fit >= total * 0.9) return k;
  }
  return 1;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One character found in an image: its pixels (`mask`) and their box. */
export interface Figure {
  mask: Uint8Array;
  box: Box;
}

/**
 * The characters in an image, left to right: at most `max` of them. Every
 * 8-connected shape that is not background is labelled; the largest shapes
 * (each at least 15% of the biggest) are the characters, and every smaller
 * shape that is not a speck and overlaps one of their boxes (hair, a hand
 * drawn apart from the body) joins the first it overlaps. A watermark in a
 * corner, and stray pixels, join nothing and go.
 */
export function findFigures(
  width: number,
  height: number,
  bg: Uint8Array,
  max: number,
): Figure[] | null {
  const size = width * height;
  const label = new Int32Array(size).fill(-1);
  const shapes: (Box & { n: number })[] = [];
  const stack = new Int32Array(size);
  for (let start = 0; start < size; start++) {
    if (bg[start] || label[start]! >= 0) continue;
    const id = shapes.length;
    const shape = { x0: width, y0: height, x1: -1, y1: -1, n: 0 };
    label[start] = id;
    stack[0] = start;
    let top = 1;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % width;
      const y = (i - x) / width;
      shape.n += 1;
      if (x < shape.x0) shape.x0 = x;
      if (x > shape.x1) shape.x1 = x;
      if (y < shape.y0) shape.y0 = y;
      if (y > shape.y1) shape.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (!bg[j] && label[j]! < 0) {
            label[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    shapes.push(shape);
    // Noise, not a sprite: stop before the labels cost more.
    if (shapes.length > MAX_SHAPES) return null;
  }
  if (shapes.length === 0) return [];
  let biggest = 0;
  for (const s of shapes) if (s.n > biggest) biggest = s.n;
  const mains = shapes
    .map((s, id) => ({ s, id }))
    .filter(({ s }) => s.n >= biggest * 0.15)
    .sort((a, b) => b.s.n - a.s.n)
    .slice(0, max)
    .sort((a, b) => a.s.x0 - b.s.x0);
  const figureOf = new Int32Array(shapes.length).fill(-1);
  const boxes = mains.map(({ s, id }) => {
    figureOf[id] = mains.findIndex((m) => m.id === id);
    return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
  });
  const speck = Math.max(4, biggest * 0.001);
  const pad = Math.round(Math.max(width, height) * 0.01);
  shapes.forEach((s, id) => {
    if (figureOf[id]! >= 0 || s.n < speck) return;
    const f = mains.findIndex(
      ({ s: m }) =>
        s.x0 <= m.x1 + pad &&
        s.x1 >= m.x0 - pad &&
        s.y0 <= m.y1 + pad &&
        s.y1 >= m.y0 - pad,
    );
    if (f < 0) return;
    figureOf[id] = f;
    const b = boxes[f]!;
    b.x0 = Math.min(b.x0, s.x0);
    b.y0 = Math.min(b.y0, s.y0);
    b.x1 = Math.max(b.x1, s.x1);
    b.y1 = Math.max(b.y1, s.y1);
  });
  return boxes.map((box, f) => {
    const mask = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (label[i]! >= 0 && figureOf[label[i]!] === f) mask[i] = 1;
    }
    return { mask, box };
  });
}

/**
 * More separate shapes than this (left once the background is gone) is not
 * a sprite but noise, a photo or a busy scene: `findFigures` gives up.
 */
export const MAX_SHAPES = 10_000;

/** One character alone, trimmed to its box, alpha all-or-nothing. */
export function cutOut(img: RgbaImage, figure: Figure): RgbaImage {
  const { box, mask } = figure;
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (box.y0 + y) * img.width + box.x0 + x;
      if (!mask[i]) continue;
      const o = (y * width + x) * 4;
      data[o] = img.data[i * 4]!;
      data[o + 1] = img.data[i * 4 + 1]!;
      data[o + 2] = img.data[i * 4 + 2]!;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** RGB of pixel `i` as one number. */
const rgbAt = (img: RgbaImage, i: number) =>
  (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;

const channel = (c: number, ch: number) => (c >> (16 - 8 * ch)) & 255;

/**
 * At most `colours` colours for all of `imgs` together, by median cut over
 * their opaque pixels: the box of colours with the widest spread is split at
 * its median, along its widest channel, until there are enough; each box's
 * colour is its pixels' average. When the images have few enough colours
 * already, those exact colours. Past a few thousand distinct colours (a
 * photo, JPEG noise) the colours are first grouped 5 bits a channel, so the
 * cut stays quick. (sharp's palette option only sets a bit depth, so 24
 * would really mean 256.)
 */
export function sharedPalette(
  imgs: readonly RgbaImage[],
  colours: number,
): number[] {
  const exact = new Map<number, number>();
  for (const img of imgs) {
    for (let i = 0; i < img.width * img.height; i++) {
      if (img.data[i * 4 + 3]) {
        const c = rgbAt(img, i);
        exact.set(c, (exact.get(c) ?? 0) + 1);
      }
    }
  }
  if (exact.size <= colours) return [...exact.keys()];

  // Bins of similar colours: their count and the sum of their colours.
  type Bin = { n: number; r: number; g: number; b: number; key: number };
  const bins = new Map<number, Bin>();
  const grouped = exact.size > 4096;
  for (const [c, n] of exact) {
    const key = grouped
      ? ((channel(c, 0) >> 3) << 10) |
        ((channel(c, 1) >> 3) << 5) |
        (channel(c, 2) >> 3)
      : c;
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0, key };
    bin.n += n;
    bin.r += channel(c, 0) * n;
    bin.g += channel(c, 1) * n;
    bin.b += channel(c, 2) * n;
    bins.set(key, bin);
  }
  const mean = (b: Bin, ch: number) => [b.r, b.g, b.b][ch]! / b.n;

  type ColourBox = { bins: Bin[]; spread: number; channel: number };
  const measure = (list: Bin[]): ColourBox => {
    let spread = -1;
    let widest = 0;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255;
      let hi = 0;
      for (const b of list) {
        const v = mean(b, ch);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > spread) {
        spread = hi - lo;
        widest = ch;
      }
    }
    return { bins: list, spread, channel: widest };
  };
  const boxes: ColourBox[] = [measure([...bins.values()])];
  while (boxes.length < colours) {
    const box = boxes.reduce((a, b) => (b.spread > a.spread ? b : a));
    if (box.bins.length < 2) break;
    const sorted = [...box.bins].sort(
      (a, b) => mean(a, box.channel) - mean(b, box.channel) || a.key - b.key,
    );
    // The median by pixel count, always leaving both halves a colour.
    const total = sorted.reduce((s, b) => s + b.n, 0);
    let seen = 0;
    let cut = 1;
    for (; cut < sorted.length - 1; cut++) {
      seen += sorted[cut - 1]!.n;
      if (seen >= total / 2) break;
    }
    boxes.splice(
      boxes.indexOf(box),
      1,
      measure(sorted.slice(0, cut)),
      measure(sorted.slice(cut)),
    );
  }
  return boxes.map((box) => {
    const s = [0, 0, 0];
    let n = 0;
    for (const b of box.bins) {
      s[0]! += b.r;
      s[1]! += b.g;
      s[2]! += b.b;
      n += b.n;
    }
    const [r, g, b] = s.map((v) => Math.round(v / n)) as [
      number,
      number,
      number,
    ];
    return (r << 16) | (g << 8) | b;
  });
}

/**
 * Each pixel of `img` as the index of its nearest palette colour, or -1 for
 * a transparent one.
 */
export function toIndices(
  img: RgbaImage,
  palette: readonly number[],
): Int16Array {
  const out = new Int16Array(img.width * img.height);
  const cache = new Map<number, number>();
  for (let i = 0; i < out.length; i++) {
    if (!img.data[i * 4 + 3]) {
      out[i] = -1;
      continue;
    }
    const c = rgbAt(img, i);
    let best = cache.get(c);
    if (best === undefined) {
      let dist = Infinity;
      best = 0;
      for (let p = 0; p < palette.length; p++) {
        const d =
          (channel(c, 0) - channel(palette[p]!, 0)) ** 2 +
          (channel(c, 1) - channel(palette[p]!, 1)) ** 2 +
          (channel(c, 2) - channel(palette[p]!, 2)) ** 2;
        if (d < dist) {
          dist = d;
          best = p;
        }
      }
      cache.set(c, best);
    }
    out[i] = best;
  }
  return out;
}

/** Below this (the brightest channel), a pixel counts as an outline's. */
export const DARK_MAX = 72;

/** How much of a row or column of a cell must be dark to be a line. */
export const LINE_SHARE = 0.7;

/**
 * Sample `img` down to `width` × `height`. Each output pixel looks at the
 * middle half of the source area it covers: opaque when most of it is, and
 * then the commonest colour there (colours grouped 4 bits a channel, the
 * group's average taken), so JPEG noise stays out and flat areas stay flat.
 * If a third of that middle is dark, the commonest DARK colour wins: thin
 * outlines are what makes a small sprite read, and they are the first thing
 * plain sampling loses. An exact k× blow-up comes back pixel for pixel.
 */
export function sampleCells(
  img: RgbaImage,
  width: number,
  height: number,
): RgbaImage {
  const { width: w, height: h } = img;
  const data = new Uint8Array(width * height * 4);
  const sx = w / width;
  const sy = h / height;
  const groups = new Map<number, number[]>();
  for (let y = 0; y < height; y++) {
    const ya = Math.floor(y * sy + sy / 4);
    const yb = Math.min(h, Math.max(ya + 1, Math.ceil((y + 1) * sy - sy / 4)));
    for (let x = 0; x < width; x++) {
      const xa = Math.floor(x * sx + sx / 4);
      const xb = Math.min(
        w,
        Math.max(xa + 1, Math.ceil((x + 1) * sx - sx / 4)),
      );
      groups.clear();
      let clear = 0;
      let dark = 0;
      let all = 0;
      const cols = new Array<number>(xb - xa).fill(0);
      const rowsDark = new Array<number>(yb - ya).fill(0);
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          const i = (yy * w + xx) * 4;
          all += 1;
          if (img.data[i + 3]! < 128) {
            clear += 1;
            continue;
          }
          const r = img.data[i]!;
          const g = img.data[i + 1]!;
          const b = img.data[i + 2]!;
          const isDark = Math.max(r, g, b) <= DARK_MAX;
          if (isDark) {
            dark += 1;
            cols[xx - xa]! += 1;
            rowsDark[yy - ya]! += 1;
          }
          // Dark pixels group apart from lighter ones, so a dark group is
          // there whenever a dark pixel is.
          const key =
            (isDark ? 1 << 12 : 0) |
            ((r >> 4) << 8) |
            ((g >> 4) << 4) |
            (b >> 4);
          const sum = groups.get(key) ?? [0, 0, 0, 0];
          sum[0]! += r;
          sum[1]! += g;
          sum[2]! += b;
          sum[3]! += 1;
          groups.set(key, sum);
        }
      }
      if (clear * 2 > all) continue;
      // Dark wins only as a LINE (an outline crossing the cell: one row or
      // column of its middle mostly dark), so a few dark pixels on a face
      // do not turn into specks.
      const line =
        cols.some((n) => n >= (yb - ya) * LINE_SHARE) ||
        rowsDark.some((n) => n >= (xb - xa) * LINE_SHARE);
      const wantDark = line && dark * 3 >= all - clear;
      let best: number[] | null = null;
      let bestKey = -1;
      for (const [key, sum] of groups) {
        const isDark = key >= 1 << 12;
        if (wantDark && !isDark) continue;
        if (
          !best ||
          sum[3]! > best[3]! ||
          (sum[3] === best[3] && key < bestKey)
        ) {
          best = sum;
          bestKey = key;
        }
      }
      if (!best) {
        // Unreachable with the grouping above; the commonest colour, then.
        for (const sum of groups.values()) {
          if (!best || sum[3]! > best[3]!) best = sum;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = Math.round(best![0]! / best![3]!);
      data[o + 1] = Math.round(best![1]! / best![3]!);
      data[o + 2] = Math.round(best![2]! / best![3]!);
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Indexed pixels back to RGBA through `palette`. */
function fromIndices(
  src: Int16Array,
  width: number,
  height: number,
  palette: readonly number[],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    if (v < 0) continue;
    const c = palette[v]!;
    data[i * 4] = channel(c, 0);
    data[i * 4 + 1] = channel(c, 1);
    data[i * 4 + 2] = channel(c, 2);
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/**
 * The size each character of a set is drawn at, all at ONE scale so their
 * heights stay in proportion: when every one is an exact blow-up by the
 * same k, their own pixels; else the tallest is sampled to `target` rows
 * (or kept, when already no taller) and the rest by the same factor.
 */
export function setSizes(
  cuts: readonly RgbaImage[],
  target: number,
): { width: number; height: number }[] {
  const ks = cuts.map(gridSize);
  const k = ks[0]!;
  const tallest = Math.max(...cuts.map((c) => c.height));
  if (k > 1 && ks.every((x) => x === k) && tallest / k <= target * 1.5) {
    return cuts.map((c) => ({ width: c.width / k, height: c.height / k }));
  }
  const s = Math.min(1, target / tallest);
  return cuts.map((c) => ({
    width: Math.max(1, Math.round(c.width * s)),
    height: Math.max(1, Math.round(c.height * s)),
  }));
}

export interface CleanedFigure {
  png: Buffer;
  width: number;
  height: number;
}

export type CleanSetResult =
  | { ok: true; figures: CleanedFigure[] }
  | { ok: false; reason: "unreadable" | "empty" | "noisy" };

type Sharp = (typeof import("sharp"))["default"];

async function decode(
  sharp: Sharp,
  bytes: Uint8Array,
): Promise<RgbaImage | null> {
  try {
    const input = sharp(bytes, {
      limitInputPixels: INPUT_MAX_PIXELS,
      failOn: "error",
    });
    const meta = await input.metadata();
    if (!meta.format || !FORMATS.has(meta.format)) return null;
    const { data, info } = await input
      .rotate()
      .resize({
        width: WORK_MAX_EDGE_PX,
        height: WORK_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
        kernel: "nearest",
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.length),
      width: info.width,
      height: info.height,
    };
  } catch {
    return null;
  }
}

/** The most characters one sheet may hold: idle, walk, emote. */
export const SHEET_MAX_FIGURES = 3;

/**
 * A character SET in, its poses out, as small PNGs with true transparency.
 * One file is a sheet of one to three characters side by side, returned
 * left to right; several files are one character each, in their order.
 * Every figure is cleaned at one scale, on one palette.
 */
export async function cleanAvatarSet(
  files: readonly Uint8Array[],
  options: { height?: number; colours?: number; maxFigures?: number } = {},
): Promise<CleanSetResult> {
  const target = options.height ?? AVATAR_HEIGHT_PX;
  // Loaded here, not at the top: the action registry imports this module on
  // every route, and only an avatar upload needs the native image library.
  const { default: sharp } = await import("sharp");
  const cuts: RgbaImage[] = [];
  const sheet = files.length === 1;
  for (const bytes of files) {
    const img = await decode(sharp, bytes);
    if (!img) return { ok: false, reason: "unreadable" };
    const bg = backgroundMask(img, backgroundKeys(img));
    const figures = findFigures(
      img.width,
      img.height,
      bg,
      sheet ? (options.maxFigures ?? SHEET_MAX_FIGURES) : 1,
    );
    if (figures === null) return { ok: false, reason: "noisy" };
    if (figures.length === 0) return { ok: false, reason: "empty" };
    for (const f of figures) cuts.push(cutOut(img, f));
  }

  // Sampled first, then the palette is chosen from the small sprites, so a
  // thin dark line counts as much as it will show.
  const sizes = setSizes(cuts, target);
  const smalls = cuts.map((cut, n) =>
    sampleCells(cut, sizes[n]!.width, sizes[n]!.height),
  );
  const palette = sharedPalette(smalls, options.colours ?? AVATAR_COLOURS);
  const figures: CleanedFigure[] = [];
  for (const small of smalls) {
    const { width, height } = small;
    const sprite = fromIndices(
      toIndices(small, palette),
      width,
      height,
      palette,
    );
    // Lossless: the colours are already the set's own few.
    const png = await sharp(Buffer.from(sprite.data), {
      raw: { width, height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    figures.push({ png, width, height });
  }
  return { ok: true, figures };
}

export type CleanResult =
  | ({ ok: true } & CleanedFigure)
  | { ok: false; reason: "unreadable" | "empty" | "noisy" };

/** One image of one character in, one small PNG out. */
export async function cleanAvatar(
  bytes: Uint8Array,
  options: { height?: number; colours?: number } = {},
): Promise<CleanResult> {
  const r = await cleanAvatarSet([bytes], { ...options, maxFigures: 1 });
  return r.ok ? { ok: true, ...r.figures[0]! } : r;
}
