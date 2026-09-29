// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AVATAR_COLOURS,
  AVATAR_HEIGHT_PX,
  backgroundKeys,
  cleanAvatar,
  cleanAvatarSet,
  gridSize,
  MAX_SHAPES,
  sampleCells,
  sharedPalette,
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
        x >= canvas.left &&
        y >= canvas.top &&
        sx < img.width &&
        sy < img.height;
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
    return light
      ? [196 + n, 196 + n, 196 + n, 255]
      : [60 + n, 60 + n, 60 + n, 255];
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
          edge
            ? [10, 10, 10, 255]
            : [y % 256, (y * 3) % 256, 255 - (y % 256), 255],
          (y * width + x) * 4,
        );
      }
    }
    const input = compose(
      { data, width, height },
      1,
      {
        width: 160,
        height: 340,
        left: 45,
        top: 20,
      },
      () => [0, 200, 0, 255],
    );
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
        (out.data[i * 4]! << 16) |
          (out.data[i * 4 + 1]! << 8) |
          out.data[i * 4 + 2]!,
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
    const big = compose(
      grid(SPRITE),
      200,
      {
        width: 2600,
        height: 3000,
        left: 300,
        top: 100,
      },
      () => [0, 255, 0, 255],
    );
    const r = await cleanAvatar(await png(big));
    expect(r.ok && r.height).toBe(AVATAR_HEIGHT_PX);
  });
});

describe("cleanAvatarSet (a set of poses)", () => {
  /** Several blown-up sprites side by side on one flat canvas. */
  function sheet(
    parts: { img: RgbaImage; left: number; top: number }[],
    k: number,
    bg: Rgba,
  ): RgbaImage {
    const width = 420;
    const height = 200;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(bg, i * 4);
    for (const { img, left, top } of parts) {
      const one = compose(
        img,
        k,
        { width: img.width * k, height: img.height * k, left: 0, top: 0 },
        () => [0, 0, 0, 0],
      );
      for (let y = 0; y < one.height; y++) {
        for (let x = 0; x < one.width; x++) {
          const o = (y * one.width + x) * 4;
          if (one.data[o + 3]) {
            data.set(
              one.data.subarray(o, o + 4),
              ((top + y) * width + left + x) * 4,
            );
          }
        }
      }
    }
    return { data, width, height };
  }

  // Three poses of different heights: a short one, the sprite, a wide one.
  const SHORT = SPRITE.slice(2);
  const WIDE = SPRITE.map((row) => row + "K");

  it("splits a sheet into its figures, left to right, at one scale", async () => {
    // Placed out of order: the right-most is the wide one.
    const input = sheet(
      [
        { img: grid(WIDE), left: 300, top: 20 },
        { img: grid(SPRITE), left: 20, top: 20 },
        { img: grid(SHORT), left: 160, top: 36 },
      ],
      8,
      [0, 0, 0, 255],
    );
    const r = await cleanAvatarSet([await png(input)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Every figure back to its own pixels: one grid, so one scale.
    expect(r.figures.map((f) => [f.width, f.height])).toEqual([
      [10, 14],
      [10, 12],
      [11, 14],
    ]);
    expect(await decode(r.figures[0]!.png)).toEqual(grid(SPRITE));
    expect(await decode(r.figures[1]!.png)).toEqual(grid(SHORT));
  });

  it("samples a set with no exact grid by the tallest figure, keeping proportions", async () => {
    // 5× and a sheet sampled to 7 rows: the short one ends up 6 rows.
    const input = sheet(
      [
        { img: grid(SPRITE), left: 20, top: 20 },
        { img: grid(SHORT), left: 200, top: 30 },
      ],
      5,
      [0, 255, 0, 255],
    );
    const r = await cleanAvatarSet([await png(input)], { height: 7 });
    expect(r.ok && r.figures.map((f) => f.height)).toEqual([7, 6]);
  });

  it("takes one figure from each of several files, in their order", async () => {
    const one = compose(grid(SHORT), 6, CANVAS, () => [0, 255, 0, 255]);
    const two = compose(grid(SPRITE), 6, CANVAS, () => [255, 255, 255, 255]);
    const r = await cleanAvatarSet([await png(one), await png(two)]);
    expect(r.ok && r.figures.map((f) => [f.width, f.height])).toEqual([
      [10, 12],
      [10, 14],
    ]);
  });

  it("refuses a set where any file is unreadable, or holds nothing", async () => {
    const good = await png(
      compose(grid(SPRITE), 4, CANVAS, () => [0, 0, 0, 255]),
    );
    const blank = await png(
      compose(grid(["."]), 1, CANVAS, () => [0, 255, 0, 255]),
    );
    expect(await cleanAvatarSet([good, new Uint8Array([1])])).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await cleanAvatarSet([good, blank])).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("the pieces", () => {
  it("sampleCells does not crash when dark pixels sit among slightly lighter ones", () => {
    // (72,0,0) is dark, (79,0,0) is not, yet both fall in one 4-bit group.
    const data = new Uint8Array([72, 0, 0, 255, 79, 0, 0, 255, 79, 0, 0, 255]);
    const out = sampleCells({ data, width: 3, height: 1 }, 1, 1);
    expect(Array.from(out.data)).toEqual([72, 0, 0, 255]);
  });

  it("sampleCells lets scattered dark pixels on a face lose to the skin", () => {
    // 27 × 27 skin; the middle cell's middle has dark pixels on every other
    // spot, in two darks: no row or column of it is a line.
    const data = new Uint8Array(27 * 27 * 4);
    for (let y = 0; y < 27; y++) {
      for (let x = 0; x < 27; x++) {
        const middle = x >= 9 && x < 18 && y >= 9 && y < 18;
        const speck = middle && (x + y) % 2 === 0;
        data.set(
          speck
            ? x % 4 < 2
              ? [20, 10, 30, 255]
              : [40, 20, 50, 255]
            : [230, 190, 160, 255],
          (y * 27 + x) * 4,
        );
      }
    }
    const out = sampleCells({ data, width: 27, height: 27 }, 3, 3);
    expect(Array.from(out.data.subarray(16, 20))).toEqual([230, 190, 160, 255]);
  });

  it("refuses an image of more separate shapes than a sprite has", async () => {
    // Opaque dots two pixels apart on transparency: 150 × 150 shapes.
    const width = 300;
    const data = new Uint8Array(width * width * 4);
    for (let y = 0; y < width; y += 2) {
      for (let x = 0; x < width; x += 2) {
        // Every dot its own colour, so none of them reads as a backdrop.
        data.set(
          [(x * 37) % 256, (y * 59) % 256, ((x + y) * 11) % 256, 255],
          (y * width + x) * 4,
        );
      }
    }
    expect((width / 2) ** 2).toBeGreaterThan(MAX_SHAPES);
    expect(
      await cleanAvatarSet([await png({ data, width, height: width })]),
    ).toEqual({ ok: false, reason: "noisy" });
  });

  it("sampleCells keeps a thin dark line that plain sampling would lose", () => {
    // A 27 × 27 light square with a 2px dark line down columns 11-12,
    // sampled to 3 × 3 (9px cells): the line is 2 of the 5 middle columns
    // of the middle cell, a minority that still wins.
    const data = new Uint8Array(27 * 27 * 4);
    for (let y = 0; y < 27; y++) {
      for (let x = 0; x < 27; x++) {
        data.set(
          x === 11 || x === 12 ? [20, 10, 30, 255] : [230, 200, 160, 255],
          (y * 27 + x) * 4,
        );
      }
    }
    const out = sampleCells({ data, width: 27, height: 27 }, 3, 3);
    expect(Array.from(out.data.subarray(4, 8))).toEqual([20, 10, 30, 255]);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([230, 200, 160, 255]);
    // Mostly transparent cells stay transparent.
    const clear = sampleCells(
      { data: new Uint8Array(8 * 8 * 4), width: 8, height: 8 },
      2,
      2,
    );
    expect(clear.data.every((v) => v === 0)).toBe(true);
  });

  it("sharedPalette keeps few colours exactly, and cuts many down", () => {
    const few = grid(SPRITE);
    expect(sharedPalette([few], 24).length).toBe(5);
    const data = new Uint8Array(100 * 100 * 4);
    for (let i = 0; i < 10000; i++) {
      data.set([i % 256, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
    }
    expect(sharedPalette([{ data, width: 100, height: 100 }], 24).length).toBe(
      24,
    );
  });

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
    const blown = compose(
      sprite,
      5,
      { width: 50, height: 70, left: 0, top: 0 },
      () => [0, 0, 0, 0],
    );
    expect(gridSize(blown)).toBe(5);
    expect(gridSize(sprite)).toBe(1);
  });
});
