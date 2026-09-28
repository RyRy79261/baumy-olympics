import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { badgePng, rasterise } from "./badge-png";
import { decodePng } from "./decode-png";

// The committed logo files (issue #81): design/logo/baumy-badge-<size>.png,
// for places that take a file rather than a URL (Google's OAuth consent
// screen takes the 120 px one; docs/SETUP.md). They must stay the badge
// grid, pixel for pixel. After changing the badge, rewrite them with
// `pnpm --filter @baumy/web logo:png`.

const LOGO_DIR = path.resolve(import.meta.dirname, "../../../../design/logo");
const LOGO_SIZES = [1024, 512, 120] as const;
const file = (size: number) => path.join(LOGO_DIR, `baumy-badge-${size}.png`);

if (process.env.BAUMY_WRITE_LOGO === "1") {
  mkdirSync(LOGO_DIR, { recursive: true });
  for (const size of LOGO_SIZES) writeFileSync(file(size), badgePng(size));
}

describe("design/logo", () => {
  it.each(LOGO_SIZES)(
    "baumy-badge-%i.png is the badge, pixel for pixel",
    (size) => {
      const png = decodePng(readFileSync(file(size)));
      expect(png.size).toBe(size);
      const want = rasterise(size);
      expect(Buffer.from(png.rgba).equals(Buffer.from(want.rgba))).toBe(true);
      // Something is drawn: an opaque pixel in the middle, clear corners.
      const mid = ((size / 2) * size + size / 2) * 4 + 3;
      expect(png.rgba[mid]).toBe(255);
      expect(png.rgba[3]).toBe(0);
    },
  );

  it("keeps the consent-screen logo under Google's 1 MB limit", () => {
    expect(readFileSync(file(120)).length).toBeLessThan(1024 * 1024);
  });
});
