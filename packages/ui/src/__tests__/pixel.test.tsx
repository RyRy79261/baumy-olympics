import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Glyph, PixelIcon, glyphShadow } from "../pixel/glyph";
import { GLYPHS, GLYPH_NAMES } from "../pixel/glyphs";
import { PIXEL_ICONS, type PixelIconArt } from "../pixel/icons";
import { PixelArt, SpriteStrip, stripTiming } from "../pixel/pixel-art";
import { gridSize, gridToPaths } from "../pixel/pixel-grid";
import { scale2x } from "../pixel/scale2x";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("gridSize", () => {
  it("is the longest row by the number of rows", () => {
    expect(gridSize(["ab", "abcd", "a"])).toEqual({ w: 4, h: 3 });
    expect(gridSize([])).toEqual({ w: 0, h: 0 });
  });
});

describe("gridToPaths", () => {
  it("merges a row's run of one colour into one rectangle", () => {
    expect(gridToPaths(["KKK"], { K: "#000" })).toEqual([
      { fill: "#000", d: "M0 0h3v1h-3z" },
    ]);
  });

  it("gives each colour one path, in the order colours first appear", () => {
    const paths = gridToPaths(["K.E", ".KK"], { K: "#000", E: "#0f0" });
    expect(paths).toEqual([
      { fill: "#000", d: "M0 0h1v1h-1zM1 1h2v1h-2z" },
      { fill: "#0f0", d: "M2 0h1v1h-1z" },
    ]);
  });

  it("leaves characters the palette does not name clear", () => {
    expect(gridToPaths(["..", "xy"], { K: "#000" })).toEqual([]);
  });

  it("shifts a frame right by dx, for a strip", () => {
    expect(gridToPaths(["K"], { K: "#000" }, 34)[0]!.d).toBe("M34 0h1v1h-1z");
  });
});

describe("scale2x", () => {
  it("doubles both sides", () => {
    const out = scale2x(["K.", ".K", "KK"]);
    expect(out).toHaveLength(6);
    expect(out.every((r) => r.length === 4)).toBe(true);
  });

  it("turns a lone pixel into a 2 × 2 block", () => {
    expect(scale2x(["...", ".K.", "..."])).toEqual([
      "......",
      "......",
      "..KK..",
      "..KK..",
      "......",
      "......",
    ]);
  });

  it("rounds a stair-step instead of blowing it up", () => {
    // A diagonal: plain nearest-neighbour would keep the hard steps.
    const out = scale2x(["K.", "KK"]);
    // The inner corner fills in; the outer corners round off.
    expect(out).toEqual(["KK..", "KKK.", "KKKK", ".KKK"]);
    const nearest = ["KK..", "KK..", "KKKK", "KKKK"];
    expect(out).not.toEqual(nearest);
  });

  it("treats outside the frame as clear, and ragged rows as padded", () => {
    expect(scale2x(["K"])).toEqual(["KK", "KK"]);
    // The missing pixel is clear, and its inner corner rounds in.
    expect(scale2x(["KK", "K"])[2]).toBe("KKK.");
    expect(scale2x(["KK", "K"])[3]).toBe("KK..");
  });

  it("only ever writes a pixel's own colour or a neighbour's", () => {
    const src = ["O.KD", "EKDO", ".OKK", "DD.E"];
    const out = scale2x(src);
    for (let y = 0; y < src.length; y++) {
      for (let x = 0; x < 4; x++) {
        const near = new Set(
          [
            src[y]![x],
            src[y - 1]?.[x],
            src[y + 1]?.[x],
            src[y]![x - 1],
            src[y]![x + 1],
          ].map((c) => c ?? "."),
        );
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          expect(near.has(out[y * 2 + dy]![x * 2 + dx]!)).toBe(true);
        }
      }
    }
  });
});

describe("PixelArt", () => {
  it("draws the grid at its scale, crisp and decorative by default", () => {
    const out = html(
      <PixelArt grid={["K.", ".K"]} palette={{ K: "#123456" }} scale={4} />,
    );
    expect(out).toContain('viewBox="0 0 2 2"');
    expect(out).toContain('width="8"');
    expect(out).toContain('shape-rendering="crispEdges"');
    expect(out).toContain('fill="#123456"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("is an image when labelled", () => {
    const out = html(
      <PixelArt grid={["K"]} palette={{ K: "#000" }} label="Ryan" />,
    );
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Ryan"');
    expect(out).not.toContain("aria-hidden");
  });
});

describe("SpriteStrip", () => {
  const frames = [["K."], [".K"], ["KK"]];

  it("times a loop as frames × frameMs in one hard step per frame", () => {
    expect(stripTiming(4, 450)).toEqual({ duration: "1800ms", steps: 4 });
    expect(stripTiming(2, 160)).toEqual({ duration: "320ms", steps: 2 });
  });

  it("lays the frames side by side behind a one-frame window", () => {
    const out = html(
      <SpriteStrip frames={frames} palette={{ K: "#000" }} scale={5} />,
    );
    // The window: one frame, 2 × 1 at scale 5.
    expect(out).toContain("width:10px;height:5px");
    // The strip: three frames wide.
    expect(out).toContain('viewBox="0 0 6 1"');
    expect(out).toContain('width="30"');
    expect(out).toContain('data-frames="3"');
    // Frame 2 starts at x = 2, frame 3 at x = 4.
    expect(out).toContain("M3 0h1v1h-1z");
    expect(out).toContain("M4 0h2v1h-2z");
  });

  it("slides only when motion is allowed, with its timing", () => {
    const out = html(
      <SpriteStrip frames={frames} palette={{ K: "#000" }} frameMs={100} />,
    );
    expect(out).toContain("motion-safe:animate-sprite-strip");
    expect(out.replace("motion-safe:animate-sprite-strip", "")).not.toMatch(
      /animate-/,
    );
    expect(out).toContain("--sprite-duration:300ms");
    expect(out).toContain("--sprite-steps:3");
  });

  it("never animates a single frame, and mirrors when flipped", () => {
    const one = html(<SpriteStrip frames={[["K"]]} palette={{ K: "#000" }} />);
    expect(one).toContain('data-frames="1"');
    expect(one).not.toContain("animate-");
    expect(one).not.toContain("--sprite-steps");
    expect(one).not.toContain("scaleX");
    const flipped = html(
      <SpriteStrip frames={[["K"]]} palette={{ K: "#000" }} flip />,
    );
    expect(flipped).toContain("transform:scaleX(-1)");
  });
});

describe("GLYPHS", () => {
  it("draws only with ink, accent and clear", () => {
    expect(GLYPH_NAMES.length).toBeGreaterThan(20);
    for (const name of GLYPH_NAMES) {
      for (const row of GLYPHS[name]) expect(row).toMatch(/^[#=.]+$/);
    }
  });

  it("has the footer nav and the bounty glyphs", () => {
    for (const name of ["home", "calendar", "board", "msg", "shop", "trophy"])
      expect(GLYPH_NAMES).toContain(name);
    for (const name of ["tp", "catfood", "bin", "litter", "fridge", "plant"])
      expect(GLYPH_NAMES).toContain(name);
  });
});

describe("Glyph", () => {
  it("centres a glyph that is not square in a square", () => {
    // sparkle is 9 wide and 7 tall: 1 row of padding above and below.
    const out = html(<Glyph name="sparkle" size={36} />);
    expect(out).toContain('viewBox="0 -1 9 9"');
    expect(out).toContain('width="36"');
    expect(out).toContain('data-glyph="sparkle"');
    expect(out).toContain('fill="currentColor"');
  });

  it("shades the accent at 60% of the ink, or paints it its own colour", () => {
    const plain = html(<Glyph name="tp" color="#fff" />);
    expect(plain).toContain('opacity="0.6"');
    const accented = html(<Glyph name="flame" color="#f00" accent="#ff0" />);
    expect(accented).toContain('fill="#ff0"');
    expect(accented).not.toContain("opacity");
  });

  it("casts a hard shadow only when asked, 1px per 20px", () => {
    expect(html(<Glyph name="home" />)).not.toContain("drop-shadow");
    expect(html(<Glyph name="home" size={40} shadow />)).toContain(
      "drop-shadow(2px 2px 0 #07040c)",
    );
    expect(glyphShadow(10)).toBe("drop-shadow(1px 1px 0 #07040c)");
  });

  it("is labelled or decorative", () => {
    expect(html(<Glyph name="home" label="Home" />)).toContain(
      'aria-label="Home"',
    );
    expect(html(<Glyph name="home" />)).toContain('aria-hidden="true"');
  });
});

describe("PixelIcon", () => {
  it("has the header's three icons, each 16 × 16 in its own palette", () => {
    expect(Object.keys(PIXEL_ICONS)).toEqual(
      expect.arrayContaining(["siren", "star", "envelope"]),
    );
    for (const icon of Object.values(PIXEL_ICONS) as PixelIconArt[]) {
      expect(gridSize(icon.grid)).toEqual({ w: 16, h: 16 });
      for (const row of icon.grid)
        for (const ch of row) if (ch !== ".") expect(icon.pal[ch]).toBeTruthy();
    }
  });

  it("draws at its scale, and dims to grey when there is nothing", () => {
    const out = html(<PixelIcon name="siren" scale={4} label="Urgent" />);
    expect(out).toContain('width="64"');
    expect(out).toContain('fill="#ff4d5e"');
    expect(out).toContain('aria-label="Urgent"');
    expect(out).not.toContain("grayscale");
    expect(html(<PixelIcon name="siren" dim />)).toContain(
      "opacity:0.28;filter:grayscale(1)",
    );
  });
});
