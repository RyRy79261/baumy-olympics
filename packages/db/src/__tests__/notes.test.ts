import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  countNotesEditedSince,
  findNote,
  insertNote,
  listNotes,
  setNotePinned,
  softDeleteNote,
  updateNote,
} from "../notes";
import { households, members, notes } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const T0 = new Date("2026-09-27T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

let author: string;

beforeEach(async () => {
  const [m] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#112233",
    })
    .returning({ id: members.id });
  author = m!.id;
});

function add(title: string, over: { pinned?: boolean; now?: Date } = {}) {
  return insertNote(db(), {
    householdId: HOUSEHOLD_ID,
    authorId: author,
    title,
    bodyMd: `about ${title}`,
    color: null,
    pinned: over.pinned ?? false,
    now: over.now ?? T0,
  });
}

describe("insertNote and findNote", () => {
  it("stores a note and reads it back with its author's name", async () => {
    const id = await insertNote(db(), {
      householdId: HOUSEHOLD_ID,
      authorId: author,
      title: "Wifi",
      bodyMd: "**guest**",
      color: "blue",
      pinned: true,
      now: T0,
    });
    expect(await findNote(db(), HOUSEHOLD_ID, id)).toEqual({
      id,
      title: "Wifi",
      bodyMd: "**guest**",
      color: "blue",
      pinned: true,
      authorId: author,
      authorName: "Ryan",
      createdAt: T0,
      updatedAt: T0,
    });
  });

  it("does not find a note of another household", async () => {
    const [other] = await t
      .db()
      .insert(households)
      .values({ name: "Next door" })
      .returning({ id: households.id });
    const id = await add("Ours");
    expect(await findNote(db(), HOUSEHOLD_ID, id)).not.toBeNull();
    expect(await findNote(db(), other!.id, id)).toBeNull();
  });
});

describe("listNotes", () => {
  it("lists pinned notes first, then the latest change first", async () => {
    const old = await add("Old", { now: at(0) });
    const fresh = await add("Fresh", { now: at(5) });
    const pinned = await add("Pinned", { pinned: true, now: at(-60) });
    const rows = await listNotes(db(), {
      householdId: HOUSEHOLD_ID,
      limit: 10,
    });
    expect(rows.map((r) => r.id)).toEqual([pinned, fresh, old]);
  });

  it("lists only the pinned ones when asked, up to the limit", async () => {
    await add("Loose");
    const a = await add("A", { pinned: true, now: at(1) });
    const b = await add("B", { pinned: true, now: at(2) });
    const pinnedOnly = await listNotes(db(), {
      householdId: HOUSEHOLD_ID,
      pinnedOnly: true,
      limit: 10,
    });
    expect(pinnedOnly.map((r) => r.id)).toEqual([b, a]);
    const one = await listNotes(db(), {
      householdId: HOUSEHOLD_ID,
      limit: 1,
    });
    expect(one.map((r) => r.id)).toEqual([b]);
  });
});

describe("updateNote", () => {
  it("replaces the fields and moves updated_at", async () => {
    const id = await add("Plumber");
    expect(
      await updateNote(db(), {
        householdId: HOUSEHOLD_ID,
        id,
        title: "Plumber Wed",
        bodyMd: "",
        color: "pink",
        now: at(3),
      }),
    ).toBe(true);
    expect(await findNote(db(), HOUSEHOLD_ID, id)).toMatchObject({
      title: "Plumber Wed",
      bodyMd: "",
      color: "pink",
      createdAt: T0,
      updatedAt: at(3),
    });
  });

  it("finds nothing to change for an unknown or deleted note", async () => {
    const id = await add("Gone");
    await softDeleteNote(db(), { householdId: HOUSEHOLD_ID, id, now: at(1) });
    const fields = { title: "x", bodyMd: "", color: null, now: at(2) };
    expect(
      await updateNote(db(), { householdId: HOUSEHOLD_ID, id, ...fields }),
    ).toBe(false);
    expect(
      await updateNote(db(), {
        householdId: HOUSEHOLD_ID,
        id: "7d6f1c2e-5b4a-4c3d-9e8f-0a1b2c3d4e5f",
        ...fields,
      }),
    ).toBe(false);
  });
});

describe("setNotePinned", () => {
  it("pins and unpins, counting it as a change", async () => {
    const id = await add("Bins");
    expect(
      await setNotePinned(db(), {
        householdId: HOUSEHOLD_ID,
        id,
        pinned: true,
        now: at(4),
      }),
    ).toBe(true);
    expect(await findNote(db(), HOUSEHOLD_ID, id)).toMatchObject({
      pinned: true,
      updatedAt: at(4),
    });
    await setNotePinned(db(), {
      householdId: HOUSEHOLD_ID,
      id,
      pinned: false,
      now: at(5),
    });
    expect((await findNote(db(), HOUSEHOLD_ID, id))!.pinned).toBe(false);
  });

  it("finds nothing to pin once the note is deleted", async () => {
    const id = await add("Gone");
    await softDeleteNote(db(), { householdId: HOUSEHOLD_ID, id, now: at(1) });
    expect(
      await setNotePinned(db(), {
        householdId: HOUSEHOLD_ID,
        id,
        pinned: true,
        now: at(2),
      }),
    ).toBe(false);
  });
});

describe("softDeleteNote", () => {
  it("keeps the row but hides it from every read, once", async () => {
    const id = await add("Wifi", { pinned: true });
    expect(
      await softDeleteNote(db(), { householdId: HOUSEHOLD_ID, id, now: at(1) }),
    ).toEqual({ title: "Wifi" });
    const [row] = await t.db().select().from(notes).where(eq(notes.id, id));
    expect(row!.deletedAt).toEqual(at(1));
    expect(await findNote(db(), HOUSEHOLD_ID, id)).toBeNull();
    expect(
      await listNotes(db(), { householdId: HOUSEHOLD_ID, limit: 10 }),
    ).toEqual([]);
    expect(
      await softDeleteNote(db(), { householdId: HOUSEHOLD_ID, id, now: at(2) }),
    ).toBeNull();
  });
});

describe("countNotesEditedSince", () => {
  const since = (min: number) =>
    countNotesEditedSince(db(), { householdId: HOUSEHOLD_ID, since: at(min) });

  it("counts notes added or edited after the moment, not pinned ones", async () => {
    const old = await add("Old", { now: at(-60) });
    const pinnedLater = await add("Pinned later", { now: at(-60) });
    await add("New", { now: at(5) });
    expect(await since(0)).toBe(1);

    // Pinning (or unpinning) is not an edit.
    await setNotePinned(db(), {
      householdId: HOUSEHOLD_ID,
      id: pinnedLater,
      pinned: true,
      now: at(10),
    });
    expect(await since(0)).toBe(1);

    // Editing its words is.
    await updateNote(db(), {
      householdId: HOUSEHOLD_ID,
      id: old,
      title: "Old, edited",
      bodyMd: "",
      color: null,
      now: at(10),
    });
    expect(await since(0)).toBe(2);

    // A deleted note never counts.
    await softDeleteNote(db(), {
      householdId: HOUSEHOLD_ID,
      id: old,
      now: at(11),
    });
    expect(await since(0)).toBe(1);
    expect(await since(-120)).toBe(2);
  });

  it("counts a note from before edited_at from when it was created", async () => {
    const id = await add("Legacy", { now: at(5) });
    await t.db().update(notes).set({ editedAt: null }).where(eq(notes.id, id));
    expect(await since(0)).toBe(1);
    expect(await since(10)).toBe(0);
  });
});
