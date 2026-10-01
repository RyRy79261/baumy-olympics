import { readFile } from "node:fs/promises";
import path from "node:path";
import { BAUMY_COLOURS, BAUMY_FRAMES, gridSize, gridToPaths } from "@baumy/ui";
import { ImageResponse } from "next/og";
import sharp from "sharp";

// The share card (issue #122): what a link to baumy.tech shows in Telegram,
// WhatsApp, iMessage, Slack and on X. Copied from camp-404's pattern
// (apps/web/lib/og-image.tsx, behind app/opengraph-image.tsx and
// app/twitter-image.tsx): one renderer, two thin routes, built once at
// build time by next/og.
//
// Nothing here is drawn (owner ruling: never hand-draw art). The card is
// the title lettering the owner picked (Press Start 2P, bundled in
// assets/fonts with its OFL licence, so the build fetches nothing) over a
// swarm of Baumy, the 16-bit cat from packages/ui (pixel/baumy-cat.ts):
// many copies of the cat's own frames, changed only in scale and position,
// on the lounge colours (app/globals.css). No tagline (owner ruling,
// 2026-10-01).

// The lounge colours, as in app/globals.css (`--color-bm-*`).
const INK = "#0b0712";
const YELLOW = "#ffe46b";
const PINK = "#ff8fc7";
const TEAL = "#4ff5e6";
const VIOLET = "#8f7dff";
/** `--color-bm-muted`: pale enough that the black cat stands out on it. */
const FIELD = "#a898c4";

export const SHARE_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CONTENT_TYPE = "image/png";
export const SHARE_ALT =
  "Baumy Olympics: the title in chunky pixel letters among a swarm of Baumy, the pixel cat, in every size.";

/** The box the title fills, with a margin: no cat goes in it. */
export const TITLE_ZONE = { left: 285, top: 12, right: 915, bottom: 262 };

/** A cat may hang this far (a share of its size) off the card's edge. */
const BLEED = 0.35;

/** Every frame the cat has, each the cat unchanged. */
const FRAMES = Object.values(BAUMY_FRAMES).flat();
const CAT = gridSize(FRAMES[0]!);

/** A frame of Baumy as an SVG data URL: crisp square pixels at any size. */
function catSvg(frame: readonly string[]): string {
  const { w, h } = gridSize(frame);
  const paths = gridToPaths(frame, BAUMY_COLOURS)
    .map((p) => `<path fill="${p.fill}" d="${p.d}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${paths}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const FRAME_SVG = FRAMES.map(catSvg);

/** A fixed pseudo-random sequence (mulberry32), so the card is the same every build. */
function sequence(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SwarmCat = {
  /** Top left, in card pixels. */
  x: number;
  y: number;
  /** Screen pixels per art pixel. */
  scale: number;
  /** Which of the cat's frames. */
  frame: number;
};

type Box = { left: number; top: number; right: number; bottom: number };

export function catBox(c: SwarmCat): Box {
  return {
    left: c.x,
    top: c.y,
    right: c.x + CAT.w * c.scale,
    bottom: c.y + CAT.h * c.scale,
  };
}

export function overlaps(a: Box, b: Box, gap: number): boolean {
  return (
    a.left < b.right + gap &&
    b.left < a.right + gap &&
    a.top < b.bottom + gap &&
    b.top < a.bottom + gap
  );
}

/** How many cats of each scale the swarm tries to fit, biggest first. */
const SIZES: [scale: number, count: number][] = [
  [6, 3],
  [5, 4],
  [4, 8],
  [3, 18],
  [2.5, 26],
  [2, 40],
  [1.5, 60],
  [1, 60],
];

/**
 * The swarm: as many cats as fit around the title, biggest placed first so
 * the small ones fill the gaps, none touching another or the title, some
 * hanging off the edges.
 */
export function swarm(): SwarmCat[] {
  const rand = sequence(122);
  const cats: SwarmCat[] = [];
  for (const [scale, count] of SIZES) {
    const w = CAT.w * scale;
    const h = CAT.h * scale;
    let placed = 0;
    for (let tries = 0; placed < count && tries < 2000; tries++) {
      const cat = {
        x: Math.round(
          -w * BLEED + rand() * (SHARE_SIZE.width - w * (1 - 2 * BLEED)),
        ),
        y: Math.round(
          -h * BLEED + rand() * (SHARE_SIZE.height - h * (1 - 2 * BLEED)),
        ),
        scale,
        frame: Math.floor(rand() * FRAMES.length),
      };
      const box = catBox(cat);
      if (overlaps(box, TITLE_ZONE, 0)) continue;
      if (cats.some((c) => overlaps(box, catBox(c), 4))) continue;
      cats.push(cat);
      placed++;
    }
  }
  return cats;
}

/** A hard ink outline and stepped drop shadows behind pixel letters. */
type Extrusion = { colour: string; depth: number };

/**
 * Pixel letters with a hard outline and a stepped drop shadow. Satori draws
 * only one text-shadow, so, like camp-404's stacked glitch layers, every
 * shadow step and outline side is its own copy of the text underneath.
 */
function Chunky({
  text,
  size,
  colour,
  outline = 0,
  extrude = [],
  step = 2,
}: {
  text: string;
  size: number;
  colour: string;
  outline?: number;
  extrude?: Extrusion[];
  step?: number;
}) {
  const glyph = {
    fontFamily: "Press",
    fontSize: size,
    lineHeight: 1,
    display: "flex",
  } as const;
  const copies: { x: number; y: number; colour: string }[] = [];
  // Deepest layer first, so the nearer ones paint over it.
  for (const e of [...extrude].reverse()) {
    for (let d = e.depth; d >= step; d -= step) {
      copies.push({ x: d, y: d, colour: e.colour });
    }
  }
  if (outline) {
    for (const [x, y] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ] as const) {
      copies.push({ x: x * outline, y: y * outline, colour: INK });
    }
  }
  return (
    <div style={{ display: "flex", position: "relative" }}>
      {copies.map((c, i) => (
        <div
          key={i}
          style={{
            ...glyph,
            position: "absolute",
            left: c.x,
            top: c.y,
            color: c.colour,
          }}
        >
          {text}
        </div>
      ))}
      <div style={{ ...glyph, position: "relative", color: colour }}>
        {text}
      </div>
    </div>
  );
}

const SCANLINES =
  "repeating-linear-gradient(0deg, rgba(11,7,18,0.12) 0px, rgba(11,7,18,0.12) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 5px)";

function Card() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: FIELD,
      }}
    >
      {swarm().map((cat, i) => (
        <img
          key={i}
          src={FRAME_SVG[cat.frame]}
          width={CAT.w * cat.scale}
          height={CAT.h * cat.scale}
          alt=""
          style={{ position: "absolute", left: cat.x, top: cat.y }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 26,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Chunky
          text="BAUMY"
          size={118}
          colour={YELLOW}
          outline={5}
          extrude={[
            { colour: PINK, depth: 12 },
            { colour: INK, depth: 20 },
          ]}
        />
        <div style={{ display: "flex", marginTop: 24 }}>
          <Chunky
            text="OLYMPICS"
            size={68}
            colour={TEAL}
            outline={4}
            extrude={[
              { colour: VIOLET, depth: 8 },
              { colour: INK, depth: 14 },
            ]}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundImage: SCANLINES,
        }}
      />
    </div>
  );
}

let font: Promise<Buffer> | undefined;

/**
 * The 1200x630 share card as a PNG. next/og draws it; sharp then re-encodes
 * it as an opaque 256-colour PNG, small enough for WhatsApp's preview
 * (which it drops above about 600KB). The font's path is spelled out in
 * full (from apps/web, where next build and vitest run) so the build
 * traces only that file.
 */
export async function renderShareImage(): Promise<Response> {
  font ??= readFile(
    path.join(process.cwd(), "assets/fonts/PressStart2P-Regular.ttf"),
  );
  const drawn = new ImageResponse(<Card />, {
    ...SHARE_SIZE,
    fonts: [{ name: "Press", data: await font, weight: 400 }],
  });
  const png = await sharp(Buffer.from(await drawn.arrayBuffer()))
    .removeAlpha()
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
    .toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": SHARE_CONTENT_TYPE },
  });
}
