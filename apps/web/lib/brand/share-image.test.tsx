// @vitest-environment node
import { BAUMY_FRAMES } from "@baumy/ui";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import OpengraphImage, * as og from "@/app/opengraph-image";
import TwitterImage, * as tw from "@/app/twitter-image";
import {
  catBox,
  overlaps,
  renderShareImage,
  SHARE_SIZE,
  swarm,
  TITLE_ZONE,
} from "./share-image";

// Issue #122: the share card is a 1200x630 PNG, the title among a swarm of
// Baumy cats, built from the bundled font and the cat's own frames with
// nothing fetched.

async function bytes(res: Response): Promise<Buffer> {
  expect(res.headers.get("Content-Type")).toBe("image/png");
  return Buffer.from(await res.arrayBuffer());
}

describe("the share card", () => {
  it("is a 1200x630 opaque PNG, small enough for WhatsApp", async () => {
    const png = await bytes(await renderShareImage());
    const meta = await sharp(png).metadata();
    expect(meta).toMatchObject({ format: "png", width: 1200, height: 630 });
    expect(meta.hasAlpha).toBe(false);
    expect(png.length).toBeGreaterThan(10_000);
    expect(png.length).toBeLessThan(600_000);
  });

  it("is the same card on both routes, with the same size and alt", async () => {
    for (const route of [og, tw]) {
      expect(route.size).toEqual(SHARE_SIZE);
      expect(route.contentType).toBe("image/png");
      expect(route.alt).toMatch(/^Baumy Olympics/);
    }
    const [a, b] = await Promise.all([OpengraphImage(), TwitterImage()]);
    expect(Buffer.compare(await bytes(a), await bytes(b))).toBe(0);
  });
});

describe("the swarm", () => {
  const cats = swarm();
  const card = {
    left: 0,
    top: 0,
    right: SHARE_SIZE.width,
    bottom: SHARE_SIZE.height,
  };

  it("is the same every build", () => {
    expect(swarm()).toEqual(cats);
  });

  it("is a lot of cats, in many sizes, in the cat's own frames", () => {
    expect(cats.length).toBeGreaterThanOrEqual(40);
    expect(new Set(cats.map((c) => c.scale)).size).toBeGreaterThanOrEqual(6);
    const frames = Object.values(BAUMY_FRAMES).flat().length;
    for (const c of cats) {
      expect(Number.isInteger(c.frame)).toBe(true);
      expect(c.frame).toBeGreaterThanOrEqual(0);
      expect(c.frame).toBeLessThan(frames);
    }
    expect(new Set(cats.map((c) => c.frame)).size).toBeGreaterThan(5);
  });

  it("keeps clear of the title, so it stays readable", () => {
    expect(overlaps(catBox(cats[0]!), catBox(cats[0]!), 0)).toBe(true);
    for (const c of cats) {
      expect(overlaps(catBox(c), TITLE_ZONE, 0)).toBe(false);
    }
  });

  it("never stacks one cat on another, and every cat shows on the card", () => {
    cats.forEach((a, i) => {
      expect(overlaps(catBox(a), card, 0)).toBe(true);
      for (const b of cats.slice(i + 1)) {
        expect(overlaps(catBox(a), catBox(b), 0)).toBe(false);
      }
    });
  });
});
