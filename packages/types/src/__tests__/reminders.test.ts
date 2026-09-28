import { describe, expect, it } from "vitest";
import {
  ListRemindersInput,
  NewReminder,
  REMINDER_BODY_MAX,
  REMINDER_TITLE_MAX,
  ReminderRef,
} from "../reminders";

describe("NewReminder", () => {
  it("trims the title and body, and the body is optional", () => {
    expect(NewReminder.parse({ title: "  Boiler ", body: " Wed " })).toEqual({
      title: "Boiler",
      body: "Wed",
    });
    expect(NewReminder.parse({ title: "Boiler" })).toEqual({ title: "Boiler" });
  });

  it("refuses a blank title and overlong text", () => {
    expect(
      NewReminder.safeParse({ title: " " }).error?.issues[0],
    ).toMatchObject({ path: ["title"], message: "Give the reminder a title." });
    expect(
      NewReminder.safeParse({ title: "x".repeat(REMINDER_TITLE_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      NewReminder.safeParse({
        title: "x",
        body: "y".repeat(REMINDER_BODY_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      NewReminder.parse({ title: "x", body: "y".repeat(REMINDER_BODY_MAX) })
        .body,
    ).toHaveLength(REMINDER_BODY_MAX);
  });
});

describe("ReminderRef and ListRemindersInput", () => {
  it("take a reminder uuid, and nothing", () => {
    const id = "6f1c1e8e-3a57-4c1b-9d8e-0f1f2a3b4c5d";
    expect(ReminderRef.parse({ reminderId: id })).toEqual({ reminderId: id });
    expect(
      ReminderRef.safeParse({ reminderId: "r1" }).error?.issues[0],
    ).toMatchObject({ message: "Pick a reminder." });
    expect(ListRemindersInput.parse({})).toEqual({});
    expect(ListRemindersInput.safeParse({ all: true }).success).toBe(false);
  });
});
