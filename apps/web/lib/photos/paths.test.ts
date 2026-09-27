import { describe, expect, it } from "vitest";
import {
  UNSAFE_PATH,
  isPhotoType,
  photoPathCompletionId,
  photoPathname,
  photoProxyUrl,
} from "./paths";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("photo pathnames", () => {
  it("builds completions/{id}/{rand}.{ext} and reads the id back", () => {
    const webp = photoPathname(ID, "image/webp", "a1b2c3d4e5");
    expect(webp).toBe(`completions/${ID}/a1b2c3d4e5.webp`);
    expect(photoPathCompletionId(webp)).toBe(ID);
    expect(photoPathname(ID, "image/jpeg", "a1b2c3d4e5")).toMatch(/\.jpg$/);
    expect(photoPathname(ID, "image/png", "a1b2c3d4e5")).toMatch(/\.png$/);
  });

  it("refuses camp-404's UNSAFE_PATH shapes and anything off the allow-list", () => {
    for (const bad of [
      `completions/${ID}/../x1234567.webp`,
      `completions/${ID}/./x1234567.webp`,
      `completions//${ID}/x1234567.webp`,
      `completions\\${ID}\\x1234567.webp`,
      `completions/${ID}/x1234567%2ewebp`,
      `completions/${ID}%2F..%2Fx1234567.webp`,
      `../completions/${ID}/x1234567.webp`,
    ]) {
      expect(photoPathCompletionId(bad), bad).toBeNull();
    }
    expect(UNSAFE_PATH.test(`completions/${ID}/../x.webp`)).toBe(true);
    for (const off of [
      `avatars/${ID}/x1234567.webp`,
      `completions/not-a-uuid/x1234567.webp`,
      `completions/${ID}/x1234567.svg`,
      `completions/${ID}/nested/x1234567.webp`,
      `completions/${ID}/short.webp`,
      `completions/${ID}/`,
      `/completions/${ID}/x1234567.webp`,
      "",
    ]) {
      expect(photoPathCompletionId(off), off).toBeNull();
    }
  });

  it("links only through the proxy", () => {
    expect(photoProxyUrl(`completions/${ID}/a1b2c3d4e5.webp`)).toBe(
      `/api/blob?pathname=completions%2F${ID}%2Fa1b2c3d4e5.webp`,
    );
  });

  it("allows webp, jpeg and png, never svg", () => {
    expect(isPhotoType("image/webp")).toBe(true);
    expect(isPhotoType("image/jpeg")).toBe(true);
    expect(isPhotoType("image/png")).toBe(true);
    expect(isPhotoType("image/svg+xml")).toBe(false);
    expect(isPhotoType("toString")).toBe(false);
  });
});
