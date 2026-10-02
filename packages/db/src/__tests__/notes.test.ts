import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  countNotesUnseenByAnyone,
  countUnseenNotes,
  findNote,
  insertNote,
  listNotes,
  markNotesSeen,
  setNotePinned,
  softDeleteNote,
  updateNote,
} from "../notes";
import { households, members, noteReads, notes } from "../schema";
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
      editedAt: T0,
      seenBy: [],
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
      // A change, but not an edit: the note is no newer as a message.
      editedAt: T0,
      seenBy: [],
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

describe("seen notes (issue #153)", () => {
  // Sam joined long before Ryan (the author, added at the real now).
  let sam: string;
  beforeEach(async () => {
    sam = await member("Sam", at(-1000));
  });

  async function member(displayName: string, createdAt: Date) {
    const [m] = await t
      .db()
      .insert(members)
      .values({
        householdId: HOUSEHOLD_ID,
        displayName,
        avatarSprite: "cat",
        color: "#445566",
        createdAt,
      })
      .returning({ id: members.id });
    return m!.id;
  }

  const see = (memberId: string, noteIds: string[], now: Date) =>
    markNotesSeen(db(), { householdId: HOUSEHOLD_ID, memberId, noteIds, now });
  const unseen = (memberId: string) =>
    countUnseenNotes(db(), { householdId: HOUSEHOLD_ID, memberId });
  const unseenByAnyone = () => countNotesUnseenByAnyone(db(), HOUSEHOLD_ID);
  const seenBy = async (id: string) =>
    (await findNote(db(), HOUSEHOLD_ID, id))!.seenBy;
  const edit = (id: string, title: string, now: Date) =>
    updateNote(db(), {
      householdId: HOUSEHOLD_ID,
      id,
      title,
      bodyMd: "",
      color: null,
      now,
    });

  it("counts a note as unseen until the member opens it", async () => {
    const a = await add("A", { now: at(0) });
    const b = await add("B", { now: at(1) });
    expect(await unseen(sam)).toBe(2);
    expect(await seenBy(a)).toEqual([]);

    expect(await see(sam, [a], at(2))).toEqual([a]);
    expect(await unseen(sam)).toBe(1);
    expect(await unseen(author)).toBe(2);
    expect(await seenBy(a)).toEqual([sam]);
    expect(await seenBy(b)).toEqual([]);
  });

  it("makes a note unseen again when its words change after the view, never when it is pinned", async () => {
    const a = await add("A", { now: at(0) });
    await see(sam, [a], at(5));
    expect(await unseen(sam)).toBe(0);

    await setNotePinned(db(), {
      householdId: HOUSEHOLD_ID,
      id: a,
      pinned: true,
      now: at(6),
    });
    expect(await unseen(sam)).toBe(0);

    await edit(a, "A, edited", at(7));
    expect(await unseen(sam)).toBe(1);
    expect(await seenBy(a)).toEqual([]);

    await see(sam, [a], at(8));
    expect(await unseen(sam)).toBe(0);
  });

  it("counts a note seen at the very moment its words changed as seen", async () => {
    const a = await add("A", { now: at(0) });
    await see(sam, [a], at(0));
    expect(await unseen(sam)).toBe(0);
  });

  it("dates a note from before edited_at from when it was added", async () => {
    const a = await add("Legacy", { now: at(5) });
    await t.db().update(notes).set({ editedAt: null }).where(eq(notes.id, a));
    await see(sam, [a], at(4));
    expect(await unseen(sam)).toBe(1);
    await see(sam, [a], at(5));
    expect(await unseen(sam)).toBe(0);
  });

  it("never moves seen_at back", async () => {
    const a = await add("A", { now: at(0) });
    await see(sam, [a], at(10));
    await edit(a, "A2", at(9));
    // An older view arriving late does not undo the newer one.
    await see(sam, [a], at(1));
    expect(await unseen(sam)).toBe(0);
    const [row] = await t
      .db()
      .select()
      .from(noteReads)
      .where(and(eq(noteReads.noteId, a), eq(noteReads.memberId, sam)));
    expect(row!.seenAt).toEqual(at(10));
  });

  it("marks only live notes of the household, once each", async () => {
    const a = await add("A");
    const gone = await add("Gone");
    await softDeleteNote(db(), {
      householdId: HOUSEHOLD_ID,
      id: gone,
      now: at(1),
    });
    const nowhere = "00000000-0000-4000-8000-000000000000";
    expect(await see(sam, [a, gone, a, nowhere], at(2))).toEqual([a]);
    expect(await see(sam, [gone], at(3))).toEqual([]);
    expect(await see(sam, [], at(3))).toEqual([]);
    expect(await t.db().select().from(noteReads)).toHaveLength(1);
  });

  it("never counts a deleted note", async () => {
    const a = await add("A");
    expect(await unseen(sam)).toBe(1);
    expect(await unseenByAnyone()).toBe(1);
    await softDeleteNote(db(), { householdId: HOUSEHOLD_ID, id: a, now: at(1) });
    expect(await unseen(sam)).toBe(0);
    expect(await unseenByAnyone()).toBe(0);
  });

  it("counts a note for the kitchen until every active member has seen it", async () => {
    const a = await add("A", { now: at(0) });
    const b = await add("B", { now: at(0) });
    expect(await unseenByAnyone()).toBe(2);
    await see(author, [a, b], at(1));
    expect(await unseenByAnyone()).toBe(2);
    await see(sam, [a], at(1));
    expect(await unseenByAnyone()).toBe(1);
    await see(sam, [b], at(2));
    expect(await unseenByAnyone()).toBe(0);

    // An edit brings it back until everyone has read it again.
    await edit(a, "A2", at(3));
    expect(await unseenByAnyone()).toBe(1);
    await see(author, [a], at(4));
    await see(sam, [a], at(4));
    expect(await unseenByAnyone()).toBe(0);

    // Someone who joins brings both back until they read them too.
    const kim = await member("Kim", at(5));
    expect(await unseenByAnyone()).toBe(2);
    await see(kim, [a, b], at(6));
    expect(await unseenByAnyone()).toBe(0);

    // Someone who has left is not waited for, and is not in seenBy.
    const lee = await member("Lee", at(7));
    await see(lee, [a], at(8));
    expect(await seenBy(a)).toContain(lee);
    expect(await unseenByAnyone()).toBe(1);
    await t
      .db()
      .update(members)
      .set({ deactivatedAt: at(9) })
      .where(eq(members.id, lee));
    expect(await unseenByAnyone()).toBe(0);
    expect(await seenBy(a)).not.toContain(lee);
  });

  it("lists who has seen each note in the order they joined", async () => {
    const a = await add("A", { now: at(0) });
    await see(author, [a], at(1));
    await see(sam, [a], at(2));
    const [row] = await listNotes(db(), {
      householdId: HOUSEHOLD_ID,
      limit: 5,
    });
    expect(row!.seenBy).toEqual([sam, author]);
  });
});

