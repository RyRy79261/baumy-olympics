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

/** The height a gallery sprite is sampled to (the issue's ~56px). */
export const AVATAR_HEIGHT_PX = 56;

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
      if ([0, 1, 2].every((c) => Math.abs(p[c]! - (ka[c]! + t * d[c]!)) <= tol)) {
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

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 1 for every pixel of the character: the largest 8-connected shape that is
 * not background, and every other shape that overlaps its box and is not a
 * speck (hair or a prop drawn apart from the body). A watermark in a corner
 * and stray pixels go. Null when nothing is left.
 */
export function subjectMask(
  width: number,
  height: number,
  bg: Uint8Array,
): { mask: Uint8Array; box: Box } | null {
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
  }
  if (shapes.length === 0) return null;
  const main = shapes.reduce((a, b) => (b.n > a.n ? b : a));
  const speck = Math.max(4, main.n * 0.001);
  const keep = shapes.map(
    (s) =>
      s === main ||
      (s.n >= speck &&
        s.x0 <= main.x1 &&
        s.x1 >= main.x0 &&
        s.y0 <= main.y1 &&
        s.y1 >= main.y0),
  );
  const mask = new Uint8Array(size);
  const box = { x0: width, y0: height, x1: -1, y1: -1 };
  shapes.forEach((s, id) => {
    if (!keep[id]) return;
    box.x0 = Math.min(box.x0, s.x0);
    box.y0 = Math.min(box.y0, s.y0);
    box.x1 = Math.max(box.x1, s.x1);
    box.y1 = Math.max(box.y1, s.y1);
  });
  for (let i = 0; i < size; i++) if (keep[label[i]!]) mask[i] = 1;
  return { mask, box };
}

/** The character alone, trimmed to its box, alpha all-or-nothing. */
export function cutOut(img: RgbaImage, mask: Uint8Array, box: Box): RgbaImage {
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
      else (count(n), (n = 1));
    }
    count(n);
  }
  for (let x = 0; x < width; x++) {
    let n = 1;
    for (let y = 1; y < height; y++) {
      if (px[y * width + x] === px[(y - 1) * width + x]) n += 1;
      else (count(n), (n = 1));
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

/**
 * Nearest-neighbour resample to `width` × `height`, each output pixel taken
 * from the centre of the source area it covers (so an exact k× blow-up comes
 * back pixel for pixel).
 */
export function sample(img: RgbaImage, width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const from = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < width; x++) {
      const fx = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
      const s = (from * img.width + fx) * 4;
      const o = (y * width + x) * 4;
      data[o] = img.data[s]!;
      data[o + 1] = img.data[s + 1]!;
      data[o + 2] = img.data[s + 2]!;
      data[o + 3] = img.data[s + 3]!;
    }
  }
  return { data, width, height };
}

/** Snap to the art's own grid, or sample down to `target` rows. */
export function snapToGrid(img: RgbaImage, target: number): RgbaImage {
  const k = gridSize(img);
  let out = k > 1 ? sample(img, img.width / k, img.height / k) : img;
  if (out.height > target) {
    const width = Math.max(1, Math.round((out.width * target) / out.height));
    out = sample(out, width, target);
  }
  return out;
}

/**
 * At most `colours` colours, by median cut over the opaque pixels: the box
 * of colours with the widest spread is split at its median, along its widest
 * channel, until there are enough boxes; each pixel then takes the average
 * of its box. No dithering, so flat areas stay flat. (sharp's palette option
 * only sets a bit depth, so 24 would really mean 256.)
 */
export function limitPalette(img: RgbaImage, colours: number): RgbaImage {
  const counts = new Map<number, number>();
  const n = img.width * img.height;
  const rgb = (i: number) =>
    (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
  for (let i = 0; i < n; i++) {
    if (img.data[i * 4 + 3]) counts.set(rgb(i), (counts.get(rgb(i)) ?? 0) + 1);
  }
  if (counts.size <= colours) return img;

  type ColourBox = { c: number[]; spread: number; channel: number };
  const channel = (c: number, ch: number) => (c >> (16 - 8 * ch)) & 255;
  const measure = (c: number[]): ColourBox => {
    let spread = -1;
    let widest = 0;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255;
      let hi = 0;
      for (const x of c) {
        const v = channel(x, ch);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > spread) {
        spread = hi - lo;
        widest = ch;
      }
    }
    return { c, spread, channel: widest };
  };
  const boxes: ColourBox[] = [measure([...counts.keys()])];
  while (boxes.length < colours) {
    const box = boxes.reduce((a, b) => (b.spread > a.spread ? b : a));
    const sorted = [...box.c].sort(
      (a, b) => channel(a, box.channel) - channel(b, box.channel) || a - b,
    );
    // The median by pixel count, always leaving both halves a colour.
    const total = sorted.reduce((s, c) => s + counts.get(c)!, 0);
    let seen = 0;
    let cut = 1;
    for (; cut < sorted.length - 1; cut++) {
      seen += counts.get(sorted[cut - 1]!)!;
      if (seen >= total / 2) break;
    }
    boxes.splice(
      boxes.indexOf(box),
      1,
      measure(sorted.slice(0, cut)),
      measure(sorted.slice(cut)),
    );
  }

  const mapped = new Map<number, number[]>();
  for (const box of boxes) {
    const sum = [0, 0, 0];
    let weight = 0;
    for (const c of box.c) {
      const w = counts.get(c)!;
      for (let ch = 0; ch < 3; ch++) sum[ch]! += channel(c, ch) * w;
      weight += w;
    }
    const mean = sum.map((v) => Math.round(v / weight));
    for (const c of box.c) mapped.set(c, mean);
  }
  const data = new Uint8Array(img.data);
  for (let i = 0; i < n; i++) {
    if (!data[i * 4 + 3]) continue;
    data.set(mapped.get(rgb(i))!, i * 4);
  }
  return { data, width: img.width, height: img.height };
}

export type CleanResult =
  | { ok: true; png: Buffer; width: number; height: number }
  | { ok: false; reason: "unreadable" | "empty" };

/** Upload bytes in, a small palette PNG with true transparency out. */
export async function cleanAvatar(
  bytes: Uint8Array,
  options: { height?: number; colours?: number } = {},
): Promise<CleanResult> {
  const target = options.height ?? AVATAR_HEIGHT_PX;
  // Loaded here, not at the top: the action registry imports this module on
  // every route, and only an avatar upload needs the native image library.
  const { default: sharp } = await import("sharp");
  let img: RgbaImage;
  try {
    const input = sharp(bytes, {
      limitInputPixels: INPUT_MAX_PIXELS,
      failOn: "error",
    });
    const meta = await input.metadata();
    if (!meta.format || !FORMATS.has(meta.format)) {
      return { ok: false, reason: "unreadable" };
    }
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
    img = {
      data: new Uint8Array(data.buffer, data.byteOffset, data.length),
      width: info.width,
      height: info.height,
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const bg = backgroundMask(img, backgroundKeys(img));
  const subject = subjectMask(img.width, img.height, bg);
  if (!subject) return { ok: false, reason: "empty" };
  const sprite = limitPalette(
    snapToGrid(cutOut(img, subject.mask, subject.box), target),
    options.colours ?? AVATAR_COLOURS,
  );

  // Lossless: the colours are already the sprite's own few.
  const png = await sharp(Buffer.from(sprite.data), {
    raw: { width: sprite.width, height: sprite.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { ok: true, png, width: sprite.width, height: sprite.height };
}
