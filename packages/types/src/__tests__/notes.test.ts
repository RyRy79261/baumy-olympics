import { describe, expect, it } from "vitest";
import {
  ListNotesInput,
  NOTE_BODY_MAX,
  NOTE_COLORS,
  NOTE_LIST_MAX,
  NOTE_TITLE_MAX,
  NewNote,
  NoteAcknowledge,
  NoteColorChoice,
  NoteFlag,
  NotePin,
  NoteRef,
  NoteUpdate,
} from "../notes";

const ID = "7d6f1c2e-5b4a-4c3d-9e8f-0a1b2c3d4e5f";

describe("NewNote", () => {
  it("takes a title alone, trimmed", () => {
    expect(NewNote.parse({ title: "  Plumber Tue  " })).toEqual({
      title: "Plumber Tue",
    });
  });

  it("takes every field from a form's strings", () => {
    expect(
      NewNote.parse({
        title: "Wifi",
        bodyMd: "**guest** / hunter2",
        color: "blue",
        pinned: "on",
      }),
    ).toEqual({
      title: "Wifi",
      bodyMd: "**guest** / hunter2",
      color: "blue",
      pinned: true,
    });
  });

  it("refuses an empty or too long title, and too long a body", () => {
    expect(NewNote.safeParse({ title: "   " }).success).toBe(false);
    expect(
      NewNote.safeParse({ title: "x".repeat(NOTE_TITLE_MAX + 1) }).success,
    ).toBe(false);
    expect(
      NewNote.safeParse({ title: "x".repeat(NOTE_TITLE_MAX) }).success,
    ).toBe(true);
    expect(
      NewNote.safeParse({ title: "t", bodyMd: "x".repeat(NOTE_BODY_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("refuses fields it does not know", () => {
    expect(NewNote.safeParse({ title: "t", authorId: ID }).success).toBe(false);
  });
});

describe("NoteColorChoice", () => {
  it("takes each named colour, and none as null", () => {
    for (const c of NOTE_COLORS) expect(NoteColorChoice.parse(c)).toBe(c);
    expect(NoteColorChoice.parse("none")).toBeNull();
    expect(NoteColorChoice.safeParse("#ff0000").success).toBe(false);
  });
});

describe("NoteFlag", () => {
  it("reads JSON booleans and form strings", () => {
    expect(NoteFlag.parse(true)).toBe(true);
    expect(NoteFlag.parse(false)).toBe(false);
    expect(NoteFlag.parse("true")).toBe(true);
    expect(NoteFlag.parse("false")).toBe(false);
    expect(NoteFlag.parse("on")).toBe(true);
    expect(NoteFlag.safeParse("yes").success).toBe(false);
  });
});

describe("NoteUpdate, NotePin, NoteRef", () => {
  it("need a note id", () => {
    expect(NoteUpdate.safeParse({ title: "t" }).success).toBe(false);
    expect(NoteUpdate.safeParse({ noteId: "nope", title: "t" }).success).toBe(
      false,
    );
    expect(NoteUpdate.parse({ noteId: ID, title: "t", color: "none" })).toEqual(
      { noteId: ID, title: "t", color: null },
    );
    expect(NotePin.parse({ noteId: ID, pinned: "false" })).toEqual({
      noteId: ID,
      pinned: false,
    });
    expect(NotePin.safeParse({ noteId: ID }).success).toBe(false);
    expect(NoteRef.parse({ noteId: ID })).toEqual({ noteId: ID });
  });
});

describe("ListNotesInput", () => {
  it("bounds the limit", () => {
    expect(ListNotesInput.parse({})).toEqual({});
    expect(ListNotesInput.parse({ pinnedOnly: true, limit: "5" })).toEqual({
      pinnedOnly: true,
      limit: 5,
    });
    expect(ListNotesInput.safeParse({ limit: 0 }).success).toBe(false);
    expect(ListNotesInput.safeParse({ limit: NOTE_LIST_MAX + 1 }).success).toBe(
      false,
    );
  });
});

describe("NoteAcknowledge", () => {
  const OTHER = "0d6f1c2e-5b4a-4c3d-9e8f-0a1b2c3d4e5f";

  it("takes one id (a form) or a list (JSON, a repeated field)", () => {
    expect(NoteAcknowledge.parse({ noteIds: ID })).toEqual({ noteIds: [ID] });
    expect(NoteAcknowledge.parse({ noteIds: [ID, OTHER] })).toEqual({
      noteIds: [ID, OTHER],
    });
  });

  it("needs at least one real id, and at most a page of them", () => {
    expect(NoteAcknowledge.safeParse({}).success).toBe(false);
    expect(NoteAcknowledge.safeParse({ noteIds: [] }).success).toBe(false);
    expect(NoteAcknowledge.safeParse({ noteIds: "nope" }).success).toBe(false);
    expect(NoteAcknowledge.safeParse({ noteIds: 5 }).success).toBe(false);
    expect(
      NoteAcknowledge.safeParse({
        noteIds: Array.from({ length: NOTE_LIST_MAX + 1 }, () => ID),
      }).success,
    ).toBe(false);
    expect(NoteAcknowledge.safeParse({ noteIds: [ID], extra: 1 }).success).toBe(
      false,
    );
  });
});
