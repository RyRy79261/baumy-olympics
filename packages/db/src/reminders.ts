import { and, asc, eq, inArray, isNull, lte, notExists } from "drizzle-orm";
import type { Queryable } from "./index";
import { members, reminderAcks, reminders } from "./schema";

// Reminders (ADR 0005 §4, SPEC §5 `reminders`, `reminder_acks`). Every
// function takes the caller's handle (the action's transaction for writes),
// and none writes an audit row: runAction does that (AGENTS.md).
//
// A reminder is ACTIVE (on the kitchen screen) until a member dismisses it
// for everyone, or it is COMPLETED: the acknowledgement that leaves no
// active member waiting sets `completed_at` in the same transaction, so it
// stays closed when someone joins or comes back later. Who must see it is
// worked out when it is read: the members active then who had joined by the
// time it was posted (`mustSee`).

/** An active member as the reminder screen draws them. */
export interface ReminderMember {
  id: string;
  displayName: string;
  color: string;
  /** `members.avatar` as stored: `avatarFor` (packages/types) reads it. */
  avatar: unknown;
  /** When they joined: only reminders posted since then wait for them. */
  createdAt: Date;
}

/**
 * Whether a reminder waits for this member: an active member who had joined
 * by the time it was posted. Someone who joins later never brings back a
 * reminder that was left behind.
 */
export function mustSee(
  member: { createdAt: Date },
  reminder: { createdAt: Date },
): boolean {
  return member.createdAt.getTime() <= reminder.createdAt.getTime();
}

export interface ReminderRow {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  /** Every acknowledgement, the earliest first, by active members or not. */
  acks: { memberId: string; ackedAt: Date }[];
}

/**
 * Whether the reminder is still waiting for any active member who had
 * joined by the time it was posted.
 */
function waitingForAnyone(
  db: Queryable,
  householdId: string,
  reminder: { id: string; createdAt: Date },
) {
  const id = reminder.id;
  return db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.householdId, householdId),
        isNull(members.deactivatedAt),
        lte(members.createdAt, reminder.createdAt),
        notExists(
          db
            .select({ one: reminderAcks.memberId })
            .from(reminderAcks)
            .where(
              and(
                eq(reminderAcks.reminderId, id),
                eq(reminderAcks.memberId, members.id),
              ),
            ),
        ),
      ),
    )
    .limit(1);
}

export interface ActiveReminders {
  /** The active members, in the order they joined. */
  members: ReminderMember[];
  /** The active reminders, the oldest first. */
  reminders: ReminderRow[];
}

/** Add a reminder; returns its id. */
export async function insertReminder(
  db: Queryable,
  input: {
    householdId: string;
    createdBy: string;
    title: string;
    body: string;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(reminders)
    .values({
      householdId: input.householdId,
      createdBy: input.createdBy,
      title: input.title,
      body: input.body,
      createdAt: input.now,
    })
    .returning({ id: reminders.id });
  return row!.id;
}

const reminderColumns = {
  id: reminders.id,
  title: reminders.title,
  body: reminders.body,
  createdBy: reminders.createdBy,
  createdByName: members.displayName,
  createdAt: reminders.createdAt,
};

async function withAcks(
  db: Queryable,
  rows: Omit<ReminderRow, "acks">[],
): Promise<ReminderRow[]> {
  if (rows.length === 0) return [];
  const acks = await db
    .select({
      reminderId: reminderAcks.reminderId,
      memberId: reminderAcks.memberId,
      ackedAt: reminderAcks.ackedAt,
    })
    .from(reminderAcks)
    .where(
      inArray(
        reminderAcks.reminderId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(reminderAcks.ackedAt), asc(reminderAcks.memberId));
  return rows.map((r) => ({
    ...r,
    acks: acks
      .filter((a) => a.reminderId === r.id)
      .map(({ memberId, ackedAt }) => ({ memberId, ackedAt })),
  }));
}

/** One reminder of the household that is not dismissed, or null. */
export async function findOpenReminder(
  db: Queryable,
  householdId: string,
  id: string,
): Promise<ReminderRow | null> {
  const rows = await db
    .select(reminderColumns)
    .from(reminders)
    .innerJoin(members, eq(members.id, reminders.createdBy))
    .where(
      and(
        eq(reminders.id, id),
        eq(reminders.householdId, householdId),
        isNull(reminders.dismissedAt),
      ),
    )
    .limit(1);
  const [row] = await withAcks(db, rows);
  return row ?? null;
}

/**
 * What the kitchen screen shows: the active members, and every reminder
 * that is neither dismissed nor completed and that at least one of them who
 * must see it (`mustSee`) has not acknowledged yet.
 */
export async function listActiveReminders(
  db: Queryable,
  householdId: string,
): Promise<ActiveReminders> {
  const people = await db
    .select({
      id: members.id,
      displayName: members.displayName,
      color: members.color,
      avatar: members.avatar,
      createdAt: members.createdAt,
    })
    .from(members)
    .where(
      and(eq(members.householdId, householdId), isNull(members.deactivatedAt)),
    )
    .orderBy(asc(members.createdAt), asc(members.id));
  const open = await withAcks(
    db,
    await db
      .select(reminderColumns)
      .from(reminders)
      .innerJoin(members, eq(members.id, reminders.createdBy))
      .where(
        and(
          eq(reminders.householdId, householdId),
          isNull(reminders.dismissedAt),
          isNull(reminders.completedAt),
        ),
      )
      .orderBy(asc(reminders.createdAt), asc(reminders.id)),
  );
  const active = open.filter((r) => {
    const seen = new Set(r.acks.map((a) => a.memberId));
    return people.some((p) => !seen.has(p.id) && mustSee(p, r));
  });
  return { members: people, reminders: active };
}

/**
 * Record that a member has read a reminder that is not dismissed. A second
 * acknowledgement keeps the first time. When it leaves no active member
 * waiting, the reminder is completed in the same transaction. Returns
 * whether everyone has now seen it, or null when there is no such reminder.
 *
 * The reminder row is locked first, so a dismissal cannot slip in between,
 * and two members acknowledging at once are serialised: the second sees the
 * first's ack and completes the reminder (the Docker Postgres test).
 */
export async function acknowledgeReminder(
  db: Queryable,
  input: {
    householdId: string;
    reminderId: string;
    memberId: string;
    now: Date;
  },
): Promise<{ seenByEveryone: boolean } | null> {
  const [row] = await db
    .select({
      completedAt: reminders.completedAt,
      createdAt: reminders.createdAt,
    })
    .from(reminders)
    .where(
      and(
        eq(reminders.id, input.reminderId),
        eq(reminders.householdId, input.householdId),
        isNull(reminders.dismissedAt),
      ),
    )
    .for("update");
  if (!row) return null;
  await db
    .insert(reminderAcks)
    .values({
      reminderId: input.reminderId,
      memberId: input.memberId,
      ackedAt: input.now,
    })
    .onConflictDoNothing();
  if (row.completedAt) return { seenByEveryone: true };
  const [waiting] = await waitingForAnyone(db, input.householdId, {
    id: input.reminderId,
    createdAt: row.createdAt,
  });
  if (waiting) return { seenByEveryone: false };
  await db
    .update(reminders)
    .set({ completedAt: input.now })
    .where(eq(reminders.id, input.reminderId));
  return { seenByEveryone: true };
}

/**
 * Dismiss a reminder for everyone: compare-and-set on `dismissed_at IS
 * NULL`. Returns its title, or null when there is no such reminder (never
 * there, another household's, or already dismissed).
 */
export async function dismissReminder(
  db: Queryable,
  input: {
    householdId: string;
    reminderId: string;
    memberId: string;
    now: Date;
  },
): Promise<{ title: string } | null> {
  const [row] = await db
    .update(reminders)
    .set({ dismissedAt: input.now, dismissedBy: input.memberId })
    .where(
      and(
        eq(reminders.id, input.reminderId),
        eq(reminders.householdId, input.householdId),
        isNull(reminders.dismissedAt),
      ),
    )
    .returning({ title: reminders.title });
  return row ?? null;
}
