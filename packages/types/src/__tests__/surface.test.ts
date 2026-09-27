import { describe, expect, it } from "vitest";
import { Surface, SURFACES } from "../surface";

describe("Surface", () => {
  it("lists the five surfaces in the pg enum's order", () => {
    expect(SURFACES).toEqual(["ui", "kiosk", "ai", "mcp", "brain"]);
  });

  it("accepts each surface and refuses anything else", () => {
    for (const s of SURFACES) expect(Surface.parse(s)).toBe(s);
    expect(Surface.safeParse("telegram").success).toBe(false);
    expect(Surface.safeParse("UI").success).toBe(false);
  });
});
