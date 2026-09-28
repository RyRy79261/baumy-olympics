import { describe, expect, it } from "vitest";
import { hexToRgba, rasterise } from "@/lib/brand/badge-png";
import { decodePng } from "@/lib/brand/decode-png";
import {
  APP_BACKGROUND,
  MASKABLE_ART,
  appIconOptions,
  renderAppIcon,
} from "./app-icon";

async function icon(size: number, kind?: "any" | "maskable" | "apple") {
  const res = renderAppIcon(size, kind);
  expect(res.headers.get("content-type")).toBe("image/png");
  return decodePng(new Uint8Array(await res.arrayBuffer()));
}

const at = (img: { size: number; rgba: Uint8Array }, x: number, y: number) => [
  ...img.rgba.subarray((y * img.size + x) * 4, (y * img.size + x) * 4 + 4),
];

describe("renderAppIcon", () => {
  it.each([32, 192, 512])(
    "the %i px icon is the whole badge with clear corners",
    async (size) => {
      const img = await icon(size);
      expect(img.size).toBe(size);
      expect(
        Buffer.from(img.rgba).equals(Buffer.from(rasterise(size).rgba)),
      ).toBe(true);
      expect(at(img, size / 2, size / 2)[3]).toBe(255);
      expect(at(img, 0, 0)).toEqual([0, 0, 0, 0]);
    },
  );

  it("the Apple icon has no transparency (iOS would fill it black)", async () => {
    const img = await icon(180, "apple");
    expect(at(img, 90, 90)[3]).toBe(255);
    expect(at(img, 0, 0)).toEqual(hexToRgba(APP_BACKGROUND));
    for (let i = 3; i < img.rgba.length; i += 4) {
      if (img.rgba[i] !== 255) throw new Error(`clear pixel at ${(i - 3) / 4}`);
    }
  });

  it("the maskable icon keeps the badge inside the safe zone", async () => {
    const img = await icon(512, "maskable");
    const back = hexToRgba(APP_BACKGROUND);
    const centre = (img.size - 1) / 2;
    // The safe zone is the circle 80% of the icon wide.
    const safe = (img.size * 0.8) / 2;
    let badge = 0;
    let furthest = 0;
    for (let y = 0; y < img.size; y++) {
      for (let x = 0; x < img.size; x++) {
        const p = at(img, x, y);
        expect(p[3]).toBe(255); // a launcher shows every pixel
        if (p.every((v, k) => v === back[k])) continue;
        badge++;
        furthest = Math.max(furthest, Math.hypot(x - centre, y - centre));
      }
    }
    // The badge is there, big, and wholly in the safe zone.
    expect(badge).toBeGreaterThan(Math.PI * (safe * 0.9) ** 2);
    expect(furthest).toBeLessThanOrEqual(safe);
  });

  it("fills the safe zone and no more", () => {
    expect(appIconOptions(512, "maskable")).toEqual({
      art: Math.floor(512 * MASKABLE_ART),
      background: APP_BACKGROUND,
    });
    expect(appIconOptions(512, "any")).toEqual({ art: 512 });
    expect(appIconOptions(180, "apple")).toEqual({
      art: 180,
      background: APP_BACKGROUND,
    });
  });
});
