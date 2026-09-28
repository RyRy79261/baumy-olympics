import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  acknowledgeReminder,
  dismissReminder,
  findOpenReminder,
  insertReminder,
  listActiveReminders,
} from "../reminders";
import { households, members, reminderAcks, reminders } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const T0 = new Date("2026-09-28T08:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

async function member(
  displayName: string,
  over: Partial<typeof members.$inferInsert> = {},
): Promise<string> {
  const [m] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName,
      avatarSprite: "cat",
      color: "#112233",
      ...over,
    })
    .returning({ id: members.id });
  return m!.id;
}

let ryan: string;
let jo: string;

beforeEach(async () => {
  ryan = await member("Ryan", { createdAt: at(-60) });
  jo = await member("Jo", { createdAt: at(-30) });
});

function add(title: string, now = T0, by = ryan) {
  return insertReminder(db(), {
    householdId: HOUSEHOLD_ID,
    createdBy: by,
    title,
    body: `about ${title}`,
    now,
  });
}

const ack = (reminderId: string, memberId: string, now = T0) =>
  acknowledgeReminder(db(), {
    householdId: HOUSEHOLD_ID,
    reminderId,
    memberId,
    now,
  });

describe("insertReminder and findOpenReminder", () => {
  it("stores a reminder and reads it back with its author and no acks", async () => {
    const id = await add("Boiler");
    expect(await findOpenReminder(db(), HOUSEHOLD_ID, id)).toEqual({
      id,
      title: "Boiler",
      body: "about Boiler",
      createdBy: ryan,
      createdByName: "Ryan",
      createdAt: T0,
      acks: [],
    });
  });

  it("does not find one of another household, or a dismissed one", async () => {
    const [other] = await t
      .db()
      .insert(households)
      .values({ name: "Next door" })
      .returning({ id: households.id });
    const id = await add("Boiler");
    expect(await findOpenReminder(db(), HOUSEHOLD_ID, id)).not.toBeNull();
    expect(await findOpenReminder(db(), other!.id, id)).toBeNull();
    await dismissReminder(db(), {
      householdId: HOUSEHOLD_ID,
      reminderId: id,
      memberId: jo,
      now: T0,
    });
    expect(await findOpenReminder(db(), HOUSEHOLD_ID, id)).toBeNull();
  });
});

describe("listActiveReminders", () => {
  it("lists the active members by joining, with their stored avatar", async () => {
    const avatar = {
      hairStyle: "bob",
      hairColor: "black",
      skinTone: "tan",
      shirtColor: "pink",
    };
    await t.db().update(members).set({ avatar }).where(eq(members.id, jo));
    await member("Gone", { deactivatedAt: T0 });
    const { members: people, reminders: none } = await listActiveReminders(
      db(),
      HOUSEHOLD_ID,
    );
    expect(people).toEqual([
      { id: ryan, displayName: "Ryan", color: "#112233", avatar: null },
      { id: jo, displayName: "Jo", color: "#112233", avatar },
    ]);
    expect(none).toEqual([]);
  });

  it("keeps a reminder until every active member has seen it, oldest first", async () => {
    const later = await add("Later", at(5));
    const first = await add("First", at(0));
    expect(await ack(first, ryan, at(10))).toEqual({ seenByEveryone: false });
    let active = (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders;
    expect(active.map((r) => r.id)).toEqual([first, later]);
    expect(active[0]!.acks).toEqual([{ memberId: ryan, ackedAt: at(10) }]);
    expect(active[1]!.acks).toEqual([]);

    expect(await ack(first, jo, at(11))).toEqual({ seenByEveryone: true });
    active = (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders;
    expect(active.map((r) => r.id)).toEqual([later]);
    const [row] = await t
      .db()
      .select({ completedAt: reminders.completedAt })
      .from(reminders)
      .where(eq(reminders.id, first));
    expect(row!.completedAt).toEqual(at(11));
  });

  it("stays closed once everyone has seen it, when someone joins later", async () => {
    const id = await add("Boiler");
    await ack(id, ryan);
    await ack(id, jo);
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders,
    ).toHaveLength(0);
    const sam = await member("Sam");
    // Sam is on the screen, but the finished reminder does not come back.
    const after = await listActiveReminders(db(), HOUSEHOLD_ID);
    expect(after.members.map((m) => m.id)).toContain(sam);
    expect(after.reminders).toEqual([]);
    // A reminder posted now waits for Sam too.
    const next = await add("Bins");
    await ack(next, ryan);
    await ack(next, jo);
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders.map(
        (r) => r.id,
      ),
    ).toEqual([next]);
  });

  it("stays closed once everyone has seen it, when someone comes back", async () => {
    const sam = await member("Sam", { deactivatedAt: at(-5) });
    const id = await add("Boiler");
    await ack(id, ryan);
    await ack(id, jo);
    await t
      .db()
      .update(members)
      .set({ deactivatedAt: null })
      .where(eq(members.id, sam));
    const after = await listActiveReminders(db(), HOUSEHOLD_ID);
    expect(after.members.map((m) => m.id)).toContain(sam);
    expect(after.reminders).toEqual([]);
  });

  it("does not wait for a member who has left", async () => {
    const id = await add("Boiler");
    await ack(id, ryan);
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders,
    ).toHaveLength(1);
    await t
      .db()
      .update(members)
      .set({ deactivatedAt: T0 })
      .where(eq(members.id, jo));
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders,
    ).toHaveLength(0);
  });

  it("leaves out dismissed reminders", async () => {
    const id = await add("Boiler");
    await add("Bins");
    await dismissReminder(db(), {
      householdId: HOUSEHOLD_ID,
      reminderId: id,
      memberId: ryan,
      now: T0,
    });
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).reminders.map(
        (r) => r.title,
      ),
    ).toEqual(["Bins"]);
  });
});

describe("acknowledgeReminder", () => {
  it("keeps the first time when a member acknowledges twice", async () => {
    const id = await add("Boiler");
    expect(await ack(id, jo, at(1))).toEqual({ seenByEveryone: false });
    expect(await ack(id, jo, at(2))).toEqual({ seenByEveryone: false });
    const rows = await t.db().select().from(reminderAcks);
    expect(rows).toEqual([{ reminderId: id, memberId: jo, ackedAt: at(1) }]);
  });

  it("records a late ack on a completed reminder, keeping it completed", async () => {
    const id = await add("Boiler");
    await ack(id, ryan, at(1));
    await ack(id, jo, at(2));
    const sam = await member("Sam");
    expect(await ack(id, sam, at(3))).toEqual({ seenByEveryone: true });
    const [row] = await t
      .db()
      .select({ completedAt: reminders.completedAt })
      .from(reminders);
    expect(row!.completedAt).toEqual(at(2));
    expect(await t.db().select().from(reminderAcks)).toHaveLength(3);
  });

  it("is null for another household's reminder, and records nothing", async () => {
    const [other] = await t
      .db()
      .insert(households)
      .values({ name: "Next door" })
      .returning({ id: households.id });
    const id = await add("Boiler");
    expect(
      await acknowledgeReminder(db(), {
        householdId: other!.id,
        reminderId: id,
        memberId: jo,
        now: T0,
      }),
    ).toBeNull();
    expect(await t.db().select().from(reminderAcks)).toEqual([]);
  });

  it("is null for a dismissed reminder or one that is not there", async () => {
    const id = await add("Boiler");
    await dismissReminder(db(), {
      householdId: HOUSEHOLD_ID,
      reminderId: id,
      memberId: ryan,
      now: T0,
    });
    expect(await ack(id, jo)).toBeNull();
    expect(await ack("00000000-0000-4000-8000-00000000dead", jo)).toBeNull();
    expect(await t.db().select().from(reminderAcks)).toEqual([]);
  });
});

describe("dismissReminder", () => {
  it("dismisses once: a second dismissal finds nothing", async () => {
    const id = await add("Boiler");
    const dismiss = (by: string, now: Date) =>
      dismissReminder(db(), {
        householdId: HOUSEHOLD_ID,
        reminderId: id,
        memberId: by,
        now,
      });
    expect(await dismiss(jo, at(3))).toEqual({ title: "Boiler" });
    expect(await dismiss(ryan, at(4))).toBeNull();
    const [row] = await t.db().select().from(reminders);
    expect(row).toMatchObject({ dismissedAt: at(3), dismissedBy: jo });
  });

  it("does not touch another household's reminder", async () => {
    const [other] = await t
      .db()
      .insert(households)
      .values({ name: "Next door" })
      .returning({ id: households.id });
    const id = await add("Boiler");
    expect(
      await dismissReminder(db(), {
        householdId: other!.id,
        reminderId: id,
        memberId: jo,
        now: T0,
      }),
    ).toBeNull();
    const [row] = await t.db().select().from(reminders);
    expect(row).toMatchObject({ dismissedAt: null, dismissedBy: null });
  });

  it("refuses a dismissal time without a dismisser (the check)", async () => {
    const id = await add("Boiler");
    await expect(
      t
        .db()
        .update(reminders)
        .set({ dismissedAt: T0 })
        .where(eq(reminders.id, id)),
    ).rejects.toThrow();
  });
});
