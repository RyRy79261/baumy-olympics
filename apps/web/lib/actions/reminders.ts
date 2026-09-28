import {
  acknowledgeReminder as acknowledgeReminderRow,
  dismissReminder as dismissReminderRow,
  findOpenReminder,
  insertReminder,
  listActiveReminders,
  mustSee,
  type ReminderMember,
  type ReminderRow,
} from "@baumy/db/reminders";
import {
  ListRemindersInput,
  NewReminder,
  ReminderRef,
  avatarFor,
  rosterAvatars,
  type MemberAvatar,
} from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// Reminders (ADR 0005 §4): a member posts a title and a short body; the
// kitchen screen shows it full-screen with every active member's character
// and a "Seen" button under each, until everyone has seen it or a member
// dismisses it for everyone.
//
// Every action here is `member`, never `attested`: saying "I read this" or
// posting a reminder needs no PIN. On the kiosk the acting member is the
// face that was tapped (the picked member, lib/auth/actor.ts). None of them
// is offered over MCP (ADR 0005 names the UI, the AI, brain and the kiosk).

const SURFACES = ["ui", "kiosk", "ai", "brain"] as const;

const NOT_THERE = "That reminder is not there any more.";

/** A reminder as every surface sees it. Times are ISO 8601. */
export interface ReminderView {
  id: string;
  title: string;
  body: string;
  createdBy: { id: string; name: string };
  createdAt: string;
  /** The active members who have acknowledged it, the earliest first. */
  seenBy: string[];
  /**
   * The active members who have not acknowledged it yet and must: those who
   * had joined by the time it was posted (`mustSee`).
   */
  waitingFor: string[];
}

/** An active member, as the reminder screen draws them. */
export interface ReminderMemberView {
  id: string;
  displayName: string;
  color: string;
  /** Their chosen character, or the default for their id. */
  avatar: MemberAvatar;
}

function reminderView(r: ReminderRow, people: ReminderMember[]): ReminderView {
  // Only faces the screen can draw: someone who has left is neither.
  const active = new Set(people.map((p) => p.id));
  const seenBy = r.acks.map((a) => a.memberId).filter((id) => active.has(id));
  const seen = new Set(seenBy);
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    createdBy: { id: r.createdBy, name: r.createdByName },
    createdAt: r.createdAt.toISOString(),
    seenBy,
    waitingFor: people
      .filter((p) => !seen.has(p.id) && mustSee(p, r))
      .map((p) => p.id),
  };
}

function memberView(
  m: ReminderMember,
  roster: ReadonlyMap<string, MemberAvatar>,
): ReminderMemberView {
  return {
    id: m.id,
    displayName: m.displayName,
    color: m.color,
    // The same character everywhere: chosen, or the roster's default.
    avatar: roster.get(m.id) ?? avatarFor(m),
  };
}

export interface ListRemindersData {
  /** The active members, in the order they joined. */
  members: ReminderMemberView[];
  /** The reminders on the kitchen screen now, the oldest first. */
  reminders: ReminderView[];
}

export const listReminders = defineAction({
  name: "list_reminders",
  title: "Reminders",
  description:
    "Lists the household's active reminders (posted, and neither dismissed nor seen by every member yet), the oldest first, each with its id, title, body, who posted it, when (ISO 8601, UTC), the member ids who have seen it and those still to see it; and the active members (id, name, colour, character).",
  consent: "Read the household's reminders",
  kind: "read",
  risk: "safe",
  surfaces: SURFACES,
  // The kitchen screen shows the reminder before anyone taps in.
  requires: "display",
  input: ListRemindersInput,
  async execute(ctx) {
    const { members, reminders } = await listActiveReminders(
      ctx.db,
      ctx.householdId,
    );
    // The active members, in join order: one roster for their characters.
    const roster = rosterAvatars(members);
    const data: ListRemindersData = {
      members: members.map((m) => memberView(m, roster)),
      reminders: reminders.map((r) => reminderView(r, members)),
    };
    return { ok: true, data };
  },
});

export interface CreateReminderData {
  reminderId: string;
  title: string;
}

export const createReminder = defineAction({
  name: "create_reminder",
  title: "Post a reminder",
  description:
    "Posts a reminder for the whole household: a short title and an optional plain-text body of a sentence or two. The kitchen screen shows it full-screen until every member has tapped Seen, or someone dismisses it. For things everyone must read (a tradesperson coming, the water off), not for chores or notes.",
  consent: "Post reminders for the household",
  kind: "write",
  risk: "safe",
  surfaces: SURFACES,
  requires: "member",
  input: NewReminder,
  async preview(_ctx, i) {
    return `Post the reminder "${i.title}" on the kitchen screen`;
  },
  async execute(ctx, i) {
    const reminderId = await insertReminder(ctx.db, {
      householdId: ctx.householdId,
      createdBy: ctx.actor.memberId!,
      title: i.title,
      body: i.body ?? "",
      now: ctx.now,
    });
    const data: CreateReminderData = { reminderId, title: i.title };
    return {
      ok: true,
      data,
      audit: { entity: "reminder", entityId: reminderId },
    };
  },
});

export interface AcknowledgeReminderData {
  reminderId: string;
  memberId: string;
  /**
   * True when every active member has now seen it: it is completed and
   * leaves the kiosk for good.
   */
  seenByEveryone: boolean;
}

export const acknowledgeReminder = defineAction({
  name: "acknowledge_reminder",
  title: "Mark a reminder seen",
  description:
    "Records that you have read a reminder. Once every member has, it leaves the kitchen screen for good. Seeing it twice changes nothing.",
  consent: "Mark reminders as seen by you",
  kind: "write",
  risk: "safe",
  surfaces: SURFACES,
  requires: "member",
  input: ReminderRef,
  async preview(ctx, i) {
    const r = await findOpenReminder(ctx.db, ctx.householdId, i.reminderId);
    return `Mark ${r ? `"${r.title}"` : "the reminder"} as seen`;
  },
  async execute(ctx, i) {
    const memberId = ctx.actor.memberId!;
    const acked = await acknowledgeReminderRow(ctx.db, {
      householdId: ctx.householdId,
      reminderId: i.reminderId,
      memberId,
      now: ctx.now,
    });
    if (!acked) return fail("NOT_FOUND", NOT_THERE);
    const data: AcknowledgeReminderData = {
      reminderId: i.reminderId,
      memberId,
      seenByEveryone: acked.seenByEveryone,
    };
    return {
      ok: true,
      data,
      audit: { entity: "reminder", entityId: i.reminderId },
    };
  },
});

export interface DismissReminderData {
  reminderId: string;
  title: string;
}

export const dismissReminder = defineAction({
  name: "dismiss_reminder",
  title: "Dismiss a reminder",
  description:
    "Takes a reminder off the kitchen screen for everyone, whether or not everyone has seen it. Ask first.",
  consent: "Dismiss the household's reminders",
  kind: "write",
  risk: "confirm",
  surfaces: SURFACES,
  requires: "member",
  input: ReminderRef,
  async preview(ctx, i) {
    const r = await findOpenReminder(ctx.db, ctx.householdId, i.reminderId);
    return `Dismiss the reminder ${r ? `"${r.title}"` : "(already gone)"} for everyone`;
  },
  async execute(ctx, i) {
    const dismissed = await dismissReminderRow(ctx.db, {
      householdId: ctx.householdId,
      reminderId: i.reminderId,
      memberId: ctx.actor.memberId!,
      now: ctx.now,
    });
    if (!dismissed) {
      return fail(
        "NOT_FOUND",
        "That reminder has already been dismissed, or is not there any more.",
      );
    }
    const data: DismissReminderData = {
      reminderId: i.reminderId,
      title: dismissed.title,
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "reminder",
        entityId: i.reminderId,
        payload: { reminderId: i.reminderId, title: dismissed.title },
      },
    };
  },
});
