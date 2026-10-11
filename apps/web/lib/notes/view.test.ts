import { describe, expect, it } from "vitest";
import { NOTE_COLORS } from "@baumy/types";
import {
  NOTE_COLOR_OPTIONS,
  NOTE_NEW_MS,
  isNoteNew,
  noteMeta,
  noteNewSince,
} from "./view";

describe("noteMeta", () => {
  it("says who wrote it and when, in Berlin time", () => {
    expect(
      noteMeta({
        authorName: "Ryan",
        createdAt: "2026-09-27T10:00:00.000Z",
        updatedAt: "2026-09-27T10:00:00.000Z",
      }),
    ).toBe("By Ryan · Sun 27 Sep, 12:00");
  });

  it("says when it was last changed once it was edited", () => {
    expect(
      noteMeta({
        authorName: "Ryan",
        createdAt: "2026-09-27T10:00:00.000Z",
        updatedAt: "2027-01-15T18:00:00.000Z",
      }),
    ).toBe("By Ryan · changed Fri 15 Jan, 19:00");
  });
});

describe("NOTE_COLOR_OPTIONS", () => {
  it("offers plain first, then every colour", () => {
    expect(NOTE_COLOR_OPTIONS.map((o) => o.value)).toEqual([
      "none",
      ...NOTE_COLORS,
    ]);
    expect(NOTE_COLOR_OPTIONS[1]).toEqual({ value: "yellow", label: "Yellow" });
  });
});

describe("isNoteNew (issue #194)", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("is new for 3 days after its words last changed, then never", () => {
    expect(NOTE_NEW_MS).toBe(3 * 24 * 60 * 60_000);
    expect(isNoteNew({ editedAt: ago(0) }, now)).toBe(true);
    expect(isNoteNew({ editedAt: ago(NOTE_NEW_MS - 1) }, now)).toBe(true);
    expect(isNoteNew({ editedAt: ago(NOTE_NEW_MS) }, now)).toBe(false);
    expect(isNoteNew({ editedAt: ago(21 * 24 * 3_600_000) }, now)).toBe(false);
    expect(noteNewSince(now).toISOString()).toBe(ago(NOTE_NEW_MS));
  });
});
