import { describe, expect, it } from "vitest";
import { defaultAvatar } from "@baumy/types";
import type { ListRemindersData, ReminderView } from "@/lib/actions/reminders";
import {
  kioskShowsReminders,
  markSeen,
  reminderFaces,
  withoutReminder,
} from "./reminders";

// The reminder overlay's view of list_reminders (ADR 0005 §4).

const member = (id: string, displayName: string) => ({
  id,
  displayName,
  color: "#4ff5e6",
  avatar: defaultAvatar(id),
  image: null,
});

const REMINDER: ReminderView = {
  id: "r1",
  title: "Handyman on Wednesday",
  body: "",
  createdBy: { id: "a", name: "Ana" },
  createdAt: "2026-09-27T10:00:00.000Z",
  seenBy: ["b"],
  waitingFor: ["a"],
};

const DATA: ListRemindersData = {
  // "c" joined after the reminder was posted: not asked.
  members: [member("a", "Ana"), member("b", "Ben"), member("c", "Cy")],
  reminders: [REMINDER, { ...REMINDER, id: "r2", seenBy: [], waitingFor: [] }],
};

describe("reminderFaces", () => {
  it("draws everyone asked, in join order, and who has seen it", () => {
    const face = (id: string, displayName: string, seen: boolean) => ({
      id,
      displayName,
      avatar: defaultAvatar(id),
      image: null,
      seen,
    });
    expect(reminderFaces(DATA, REMINDER)).toEqual([
      face("a", "Ana", false),
      face("b", "Ben", true),
    ]);
  });
});

describe("markSeen", () => {
  it("moves the member from waiting to seen on that reminder only", () => {
    const next = markSeen(DATA, "r1", "a");
    expect(next.reminders[0]).toMatchObject({
      seenBy: ["b", "a"],
      waitingFor: [],
    });
    expect(next.reminders[1]).toBe(DATA.reminders[1]);
    expect(next.members).toBe(DATA.members);
  });

  it("changes nothing for someone who has already seen it", () => {
    expect(markSeen(DATA, "r1", "b").reminders[0]).toBe(REMINDER);
  });
});

describe("kioskShowsReminders", () => {
  it("always shows them, except in e2e without the browser's cookie", () => {
    expect(kioskShowsReminders(undefined, {})).toBe(true);
    expect(kioskShowsReminders(undefined, { E2E_TEST_MODE: "0" })).toBe(true);
    expect(kioskShowsReminders(undefined, { E2E_TEST_MODE: "1" })).toBe(false);
    expect(kioskShowsReminders("off", { E2E_TEST_MODE: "1" })).toBe(false);
    expect(kioskShowsReminders("on", { E2E_TEST_MODE: "1" })).toBe(true);
  });
});

describe("withoutReminder", () => {
  it("drops that reminder and keeps the rest", () => {
    expect(withoutReminder(DATA, "r1").reminders.map((r) => r.id)).toEqual([
      "r2",
    ]);
  });
});
