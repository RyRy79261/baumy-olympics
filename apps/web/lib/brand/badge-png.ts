import { crc32, deflateSync } from "node:zlib";
import { BADGE_GRID, BADGE_PALETTE, gridSize, type Palette } from "@baumy/ui";

// The Baumy badge (packages/ui pixel/baumy-badge.ts, issue #81) as a PNG,
// with no image library: every art pixel is scaled up nearest-neighbour
// (output pixel i shows art pixel floor(i × art / size), as sharp's
// `kernel: "nearest"` does, so the PNGs match the owner's approved render
// pixel for pixel) and written as an 8-bit RGBA PNG. Used by the icon
// routes (components/app-icon.ts) and for the committed files in
// design/logo/ (lib/brand/logo-files.test.ts).

export type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];

/** "#rrggbb" as opaque RGBA. */
export function hexToRgba(hex: string): Rgba {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16), 255];
}

export type BadgeRaster = {
  /** Width and height in pixels. */
  size: number;
  /** size × size × 4 bytes, rows top to bottom. */
  rgba: Uint8Array;
};

/**
 * The badge on a `size` px square. `art` is how wide the badge is drawn
 * (default: the whole square), centred; `background` fills the square behind
 * it (default: clear, so the round badge has transparent corners).
 */
export function rasterise(
  size: number,
  {
    art = size,
    background,
    grid = BADGE_GRID,
    palette = BADGE_PALETTE,
  }: {
    art?: number;
    background?: string;
    grid?: readonly string[];
    palette?: Palette;
  } = {},
): BadgeRaster {
  if (!Number.isInteger(size) || size < 1) throw new Error(`bad size ${size}`);
  if (!Number.isInteger(art) || art < 1 || art > size) {
    throw new Error(`bad art size ${art}`);
  }
  const { w, h } = gridSize(grid);
  const back = background ? hexToRgba(background) : CLEAR;
  const colours = new Map<string, Rgba>(
    Object.entries(palette).map(([ch, hex]) => [ch, hexToRgba(hex)]),
  );
  const rgba = new Uint8Array(size * size * 4);
  const off = Math.floor((size - art) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ax = x - off;
      const ay = y - off;
      const inside = ax >= 0 && ay >= 0 && ax < art && ay < art;
      const ch = inside
        ? grid[Math.floor((ay * h) / art)]?.[Math.floor((ax * w) / art)]
        : undefined;
      rgba.set((ch && colours.get(ch)) || back, (y * size + x) * 4);
    }
  }
  return { size, rgba };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A raster as an 8-bit RGBA PNG (every row filter 0). */
export function encodePng({ size, rgba }: BadgeRaster): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // compression, filter and interlace stay 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** The badge as a PNG `size` px square (options as for `rasterise`). */
export function badgePng(
  size: number,
  options?: Parameters<typeof rasterise>[1],
): Buffer {
  return encodePng(rasterise(size, options));
}
