import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BADGE_GRID, BADGE_PALETTE, BADGE_SIZE } from "@baumy/ui";
import { badgePng, encodePng, hexToRgba, rasterise } from "./badge-png";
import { decodePng } from "./decode-png";

const px = (rgba: Uint8Array, size: number, x: number, y: number) => [
  ...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
];

describe("hexToRgba", () => {
  it("reads #rrggbb as opaque RGBA", () => {
    expect(hexToRgba("#1a1026")).toEqual([0x1a, 0x10, 0x26, 255]);
    expect(hexToRgba("#FFE46B")).toEqual([0xff, 0xe4, 0x6b, 255]);
  });

  it("refuses anything else", () => {
    expect(() => hexToRgba("#fff")).toThrow(/not a #rrggbb/);
    expect(() => hexToRgba("plum")).toThrow(/not a #rrggbb/);
  });
});

describe("rasterise", () => {
  it("draws each art pixel as a block, output pixel i showing art pixel floor(i × 40 / size)", () => {
    const { size, rgba } = rasterise(120);
    expect(size).toBe(120);
    expect(rgba.length).toBe(120 * 120 * 4);
    for (const [x, y] of [
      [0, 0],
      [60, 60],
      [21, 27], // a sparkle's centre (7, 9) in 3 px blocks
      [119, 119],
      [37, 101],
    ] as const) {
      const ch =
        BADGE_GRID[Math.floor((y * BADGE_SIZE) / 120)]![
          Math.floor((x * BADGE_SIZE) / 120)
        ]!;
      const colour = BADGE_PALETTE[ch];
      expect(px(rgba, 120, x, y), `${x},${y}`).toEqual(
        colour ? hexToRgba(colour) : [0, 0, 0, 0],
      );
    }
    // The yellow sparkle is really there, and the corners really clear.
    expect(px(rgba, 120, 21, 27)).toEqual(hexToRgba("#ffe46b"));
    expect(px(rgba, 120, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("maps sizes that are not a multiple of 40 nearest-neighbour, like sharp", () => {
    // 1024 / 40 = 25.6: art column 0 covers output 0–25, column 1 starts at 26.
    const grid = ["AB", "BA"];
    const palette = { A: "#ff0000", B: "#0000ff" };
    const { rgba } = rasterise(5, { grid, palette });
    // floor(i × 2 / 5): 0,0,0,1,1
    expect(px(rgba, 5, 2, 0)).toEqual(hexToRgba("#ff0000"));
    expect(px(rgba, 5, 3, 0)).toEqual(hexToRgba("#0000ff"));
    expect(px(rgba, 5, 0, 3)).toEqual(hexToRgba("#0000ff"));
  });

  it("centres a smaller badge on the background", () => {
    const { rgba } = rasterise(100, { art: 80, background: "#140c1f" });
    const back = hexToRgba("#140c1f");
    expect(px(rgba, 100, 50, 50)).not.toEqual(back);
    expect(px(rgba, 100, 50, 50)[3]).toBe(255);
    expect(px(rgba, 100, 0, 0)).toEqual(back);
    expect(px(rgba, 100, 9, 50)).toEqual(back); // left of the badge
    // Its rim: art column 1 starts 2 px in (80 px for 40 art pixels).
    expect(px(rgba, 100, 11, 50)).toEqual(back);
    expect(px(rgba, 100, 12, 50)).toEqual(hexToRgba(BADGE_PALETTE.R!));
    // A clear badge pixel shows the background, never a hole.
    expect(px(rgba, 100, 10, 10)).toEqual(back);
  });

  it("refuses sizes it cannot draw", () => {
    expect(() => rasterise(0)).toThrow(/bad size/);
    expect(() => rasterise(1.5)).toThrow(/bad size/);
    expect(() => rasterise(10, { art: 11 })).toThrow(/bad art size/);
    expect(() => rasterise(10, { art: 0 })).toThrow(/bad art size/);
  });
});

describe("encodePng", () => {
  it("round-trips through a PNG decoder to the same pixels", () => {
    const raster = rasterise(64, { art: 50, background: "#140c1f" });
    const png = encodePng(raster);
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c))).toEqual([
      "P",
      "N",
      "G",
    ]);
    const back = decodePng(png);
    expect(back.size).toBe(64);
    expect(Buffer.from(back.rgba).equals(Buffer.from(raster.rgba))).toBe(true);
  });

  it("badgePng is rasterise then encodePng", () => {
    expect(badgePng(40).equals(encodePng(rasterise(40)))).toBe(true);
  });
});

describe("decodePng", () => {
  const good = badgePng(8);

  it("refuses a file that is not a PNG", () => {
    expect(() => decodePng(Buffer.from("GIF89a..."))).toThrow(/not a PNG/);
  });

  it("refuses a chunk whose CRC is wrong", () => {
    const bad = Buffer.from(good);
    bad[20] = bad[20]! ^ 0xff; // inside IHDR's data
    expect(() => decodePng(bad)).toThrow(/bad CRC in IHDR/);
  });

  function png(ihdr: Buffer, raw: Buffer): Buffer {
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    return Buffer.concat([
      good.subarray(0, 8),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
  const header = (w: number, h: number, depth = 8, type = 6) => {
    const b = Buffer.alloc(13);
    b.writeUInt32BE(w, 0);
    b.writeUInt32BE(h, 4);
    b[8] = depth;
    b[9] = type;
    return b;
  };

  it("refuses other formats, non-square images and filtered rows", () => {
    expect(() => decodePng(png(header(1, 1, 8, 2), Buffer.alloc(4)))).toThrow(
      /not 8-bit RGBA/,
    );
    expect(() => decodePng(png(header(2, 1), Buffer.alloc(9)))).toThrow(
      /not square/,
    );
    expect(() =>
      decodePng(png(header(1, 1), Buffer.from([1, 0, 0, 0, 0]))),
    ).toThrow(/filter 1/);
    expect(decodePng(png(header(1, 1), Buffer.from([0, 1, 2, 3, 4])))).toEqual({
      size: 1,
      rgba: new Uint8Array([1, 2, 3, 4]),
    });
  });
});
