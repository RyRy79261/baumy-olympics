// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AVATAR_COLOURS,
  AVATAR_HEIGHT_PX,
  backgroundKeys,
  cleanAvatar,
  gridSize,
  type RgbaImage,
} from "./clean";

// The gallery's cleaning pipeline (issue #111), on small fixture images made
// here: a sprite drawn as a character grid, blown up by a whole number and
// set on the backgrounds the owner's generator produces.

type Rgba = [number, number, number, number];

const PALETTE: Record<string, Rgba> = {
  K: [11, 7, 18, 255], // outline, near-black
  h: [59, 42, 26, 255], // hair
  s: [242, 194, 155, 255], // skin
  S: [79, 245, 230, 255], // shirt
  w: [240, 240, 240, 255], // white shoes, a light grey like a checker tile
  ".": [0, 0, 0, 0],
};

// 10 × 14, the legs apart so a background shows between them.
const SPRITE = [
  "...KKKK...",
  "..KhhhhK..",
  ".KhhhhhhK.",
  ".KhsssshK.",
  ".KssKsKsK.",
  ".KssssssK.",
  "..KssssK..",
  ".KSSSSSSK.",
  "KSSSSSSSSK",
  "KsKSSSSKsK",
  ".KKSSSSKK.",
  "..KSKKSK..",
  "..KwK.KwK.",
  "..KKK.KKK.",
];

function grid(rows: string[]): RgbaImage {
  const width = rows[0]!.length;
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => data.set(PALETTE[ch]!, (y * width + x) * 4)),
  );
  return { data, width, height };
}

/** `img` blown up k×, placed at (left, top) on a `bg(x, y)` canvas. */
function compose(
  img: RgbaImage,
  k: number,
  canvas: { width: number; height: number; left: number; top: number },
  bg: (x: number, y: number) => Rgba,
): RgbaImage {
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const sx = Math.floor((x - canvas.left) / k);
      const sy = Math.floor((y - canvas.top) / k);
      const inside =
        x >= canvas.left && y >= canvas.top && sx < img.width && sy < img.height;
      const o = (sy * img.width + sx) * 4;
      const px: Rgba =
        inside && img.data[o + 3]! > 0
          ? [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!, 255]
          : bg(x, y);
      data.set(px, (y * canvas.width + x) * 4);
    }
  }
  return { data, width: canvas.width, height: canvas.height };
}

async function png(img: RgbaImage, format: "png" | "webp" = "png") {
  const s = sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 },
  });
  return new Uint8Array(
    await (format === "png" ? s.png() : s.webp({ lossless: true })).toBuffer(),
  );
}

async function decode(bytes: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/** A painted checkerboard: two greys, with in-between seams. */
const checker =
  (tile: number) =>
  (x: number, y: number): Rgba => {
    if (x % tile === 5 || y % tile === 5) return [128, 129, 128, 255];
    const light = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
    // A little noise, as a generator paints it.
    const n = (x * 7 + y * 13) % 9;
    return light ? [196 + n, 196 + n, 196 + n, 255] : [60 + n, 60 + n, 60 + n, 255];
  };

const CANVAS = { width: 200, height: 180, left: 56, top: 40 };

describe("cleanAvatar", () => {
  it("clears a painted checkerboard and snaps back to the sprite's own grid", async () => {
    const input = compose(grid(SPRITE), 8, CANVAS, checker(32));
    const r = await cleanAvatar(await png(input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.width, r.height]).toEqual([10, 14]);
    // Pixel for pixel the sprite, with true transparency around it.
    expect(await decode(r.png)).toEqual(grid(SPRITE));
  });

  it("clears a solid backdrop of any colour, and keeps a near-black outline on exact black", async () => {
    for (const colour of [
      [0, 255, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ] as Rgba[]) {
      const input = compose(grid(SPRITE), 6, CANVAS, () => colour);
      const r = await cleanAvatar(await png(input, "webp"));
      expect(r.ok && (await decode(r.png))).toEqual(grid(SPRITE));
    }
  });

  it("clears a checkerboard patch enclosed by the character, but not one enclosed colour", async () => {
    const ring = [
      "KKKKKKKKKK",
      "KSSSSSSSSK",
      "KS......SK",
      "KS......SK",
      "KS......SK",
      "KS......SK",
      "KSSSSSSSSK",
      "KSSwwwwSSK",
      "KKKKKKKKKK",
    ];
    const r = await cleanAvatar(
      await png(compose(grid(ring), 8, CANVAS, checker(16))),
    );
    // The hole shows both tile greys, so it goes; the white band (one colour
    // that is close to a tile) stays.
    expect(r.ok && (await decode(r.png))).toEqual(grid(ring));
  });

  it("drops a watermark in a corner and stray specks, and trims to the character", async () => {
    const input = compose(grid(SPRITE), 4, CANVAS, () => [0, 0, 0, 0]);
    // A sparkle in the bottom-right corner and a lone speck up top-left.
    for (const [x, y] of [
      [190, 170],
      [191, 170],
      [190, 171],
      [191, 171],
      [192, 172],
      [3, 3],
    ]) {
      input.data.set([255, 255, 255, 255], (y! * input.width + x!) * 4);
    }
    const r = await cleanAvatar(await png(input));
    expect(r.ok && (await decode(r.png))).toEqual(grid(SPRITE));
  });

  it("samples art with no exact grid down to the gallery height, in few colours, alpha all-or-nothing", async () => {
    // A tall gradient body: 70 × 300, every row its own colour.
    const width = 70;
    const height = 300;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edge = x < 2 || x >= width - 2 || y < 2 || y >= height - 2;
        data.set(
          edge ? [10, 10, 10, 255] : [y % 256, (y * 3) % 256, 255 - (y % 256), 255],
          (y * width + x) * 4,
        );
      }
    }
    const input = compose({ data, width, height }, 1, {
      width: 160,
      height: 340,
      left: 45,
      top: 20,
    }, () => [0, 200, 0, 255]);
    const r = await cleanAvatar(await png(input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.height).toBe(AVATAR_HEIGHT_PX);
    expect(r.width).toBe(Math.round((width * AVATAR_HEIGHT_PX) / height));
    const out = await decode(r.png);
    const colours = new Set<number>();
    for (let i = 0; i < out.width * out.height; i++) {
      const a = out.data[i * 4 + 3]!;
      expect([0, 255]).toContain(a);
      colours.add(
        (out.data[i * 4]! << 16) | (out.data[i * 4 + 1]! << 8) | out.data[i * 4 + 2]!,
      );
    }
    expect(colours.size).toBeGreaterThan(4);
    expect(colours.size).toBeLessThanOrEqual(AVATAR_COLOURS);
  });

  it("refuses what is not a PNG, JPEG or WebP image, and an image that is all background", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
    );
    expect(await cleanAvatar(svg)).toEqual({ ok: false, reason: "unreadable" });
    expect(await cleanAvatar(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const gif = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#f00" },
    })
      .gif()
      .toBuffer();
    expect(await cleanAvatar(new Uint8Array(gif))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const blank = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#00ff00" },
    })
      .png()
      .toBuffer();
    expect(await cleanAvatar(new Uint8Array(blank))).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("shrinks a huge upload before cleaning it", async () => {
    const big = compose(grid(SPRITE), 200, {
      width: 2600,
      height: 3000,
      left: 300,
      top: 100,
    }, () => [0, 255, 0, 255]);
    const r = await cleanAvatar(await png(big));
    expect(r.ok && r.height).toBe(AVATAR_HEIGHT_PX);
  });
});

describe("the pieces", () => {
  it("backgroundKeys finds a backdrop's colour, and none on a varied border", () => {
    const solid = compose(grid(SPRITE), 2, CANVAS, () => [0, 255, 0, 255]);
    expect(backgroundKeys(solid).map((k) => k.c)).toEqual([[0, 255, 0]]);
    const noisy = compose(grid(SPRITE), 2, CANVAS, (x, y) => [
      (x * 37) % 256,
      (y * 91) % 256,
      (x * y) % 256,
      255,
    ]);
    expect(backgroundKeys(noisy)).toEqual([]);
    const clear = compose(grid(SPRITE), 2, CANVAS, () => [0, 0, 0, 0]);
    expect(backgroundKeys(clear)).toEqual([]);
  });

  it("gridSize finds the blow-up factor, and 1 when there is none", () => {
    const sprite = grid(SPRITE);
    const blown = compose(sprite, 5, { width: 50, height: 70, left: 0, top: 0 }, () => [0, 0, 0, 0]);
    expect(gridSize(blown)).toBe(5);
    expect(gridSize(sprite)).toBe(1);
  });
});
