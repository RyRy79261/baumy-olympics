import { describe, expect, it } from "vitest";
import { showsGalleryForm } from "./settings-card";

// Settings' "Your character": the gallery form, or only the initial tile.

const LIVE = { id: "a", archivedAt: null };
const GONE = { id: "b", archivedAt: new Date("2026-09-30T10:00:00Z") };

describe("showsGalleryForm", () => {
  it("shows the form when the gallery has a live character", () => {
    expect(showsGalleryForm([LIVE, GONE], null)).toEqual({
      show: true,
      live: [LIVE],
      worn: undefined,
    });
  });

  it("keeps the form for a member who wears an archived character, with nothing live", () => {
    expect(showsGalleryForm([GONE], "b")).toEqual({
      show: true,
      live: [],
      worn: GONE,
    });
  });

  it("shows only the initial tile with nothing live and nothing worn", () => {
    expect(showsGalleryForm([GONE], null).show).toBe(false);
    expect(showsGalleryForm([], undefined).show).toBe(false);
    // A worn id the gallery does not have is nothing worn.
    expect(showsGalleryForm([GONE], "zz").show).toBe(false);
  });
});
