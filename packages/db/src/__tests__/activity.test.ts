import { describe, expect, it } from "vitest";
import type { VerificationEvent } from "@baumy/core";
import { listActivity, type ActivityEntry } from "../activity";
import { logCompletion } from "../completions";
import { applyCompletionEvent } from "../confirmations";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { auditEvents, households } from "../schema";
import {
  dismissSuggestion,
  insertAdminChange,
  vetoSuggestion,
} from "../weights";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

// The activity log's read (issue #150): every kind of entry, newest first,
// statuses at `now`, the window and the limit, and one household only.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-28T08:00:00Z");
const HOUR = 60 * 60_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const TRASH = SEED_CHORES.trash;

let reqSeq = 0;

async function claim(
  choreId: string,
  doneBy: string,
  when: Date,
  loggedBy = doneBy,
) {
  reqSeq += 1;
  const r = await logCompletion(db(), {
    householdId: HOUSEHOLD_ID,
    choreId,
    doneBy,
    loggedBy,
    occurredAt: when,
    now: when,
    source: "ui",
    clientRequestId: `activity-${reqSeq}`,
  });
  if (!r.ok) throw new Error(r.code);
  return r.completion;
}

async function apply(id: string, event: VerificationEvent, now: Date) {
  const r = await applyCompletionEvent(db(), {
    householdId: HOUSEHOLD_ID,
    completionId: id,
    event,
    now,
  });
  if (!r.ok) throw new Error(r.code);
}

function read(now: Date, extra: { since?: Date; limit?: number } = {}) {
  return listActivity(db(), {
    householdId: HOUSEHOLD_ID,
    since: extra.since ?? at(-24 * 30),
    now,
    limit: extra.limit ?? 50,
  });
}

/** What an entry is, in one line, for order assertions. */
function label(e: ActivityEntry): string {
  switch (e.kind) {
    case "chore":
      return `chore ${e.choreName} ${e.status}`;
    case "dispute":
      return `dispute ${e.choreName} ${e.resolution ?? "open"}`;
    case "bounty":
      return `bounty ${e.choreName} ${e.change}`;
    case "points":
      return `points ${e.choreName} ${e.event}`;
  }
}

describe("listActivity", () => {
  it("is empty for a quiet house", async () => {
    await expect(read(NOW)).resolves.toEqual([]);
  });

  it("lists chores, disputes, bounties and points changes, newest first", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const sam = await seedPlayer(db(), "Sam");
    const trash = await seedChore(db(), TRASH);
    const dishes = await seedChore(db(), SEED_CHORES.dishes);
    const bathroom = await seedChore(db(), SEED_CHORES.bathroom);

    // A bounty added through the admin page and edited through Baumy, and an
    // archive, which is not an edit the log shows.
    await t
      .db()
      .insert(auditEvents)
      .values([
        {
          actorMemberId: ryan,
          source: "ui",
          action: "manage_chore",
          entity: "chore",
          entityId: bathroom.choreId,
          payload: { op: "create", name: "Bathroom" },
          at: at(0),
        },
        {
          actorMemberId: ryan,
          source: "ai",
          action: "update_bounty",
          entity: "chore",
          entityId: bathroom.choreId,
          payload: { choreId: bathroom.choreId },
          at: at(1),
        },
        {
          actorMemberId: ryan,
          source: "ui",
          action: "manage_chore",
          entity: "chore",
          entityId: dishes.choreId,
          payload: { op: "archive", choreId: dishes.choreId },
          at: at(1.5),
        },
        {
          actorMemberId: ryan,
          source: "ui",
          action: "log_completion",
          entity: "completion",
          entityId: null,
          at: at(1.6),
        },
      ]);

    // Ryan logs Trash; Sam disputes it; Sam logs Dishes for Ryan.
    const trashClaim = await claim(trash.choreId, ryan, at(2));
    await apply(
      trashClaim.id,
      { type: "dispute", actor: sam, reason: "bins still full" },
      at(3),
    );
    await claim(dishes.choreId, ryan, at(4), sam);

    // Ryan schedules new Trash points for in two days; Sam vetoes a second
    // change to Bathroom; a third, to Dishes, has already landed.
    await insertAdminChange(db(), {
      householdId: HOUSEHOLD_ID,
      choreId: trash.choreId,
      currentPoints: TRASH.basePoints,
      currentCooldownMinutes: TRASH.cooldownMinutes,
      basePoints: 30,
      cooldownMinutes: TRASH.cooldownMinutes,
      reason: "smelly",
      appliesAt: at(48),
      scheduledBy: ryan,
      now: at(5),
    });
    const vetoed = await insertAdminChange(db(), {
      householdId: HOUSEHOLD_ID,
      choreId: bathroom.choreId,
      currentPoints: SEED_CHORES.bathroom.basePoints,
      currentCooldownMinutes: SEED_CHORES.bathroom.cooldownMinutes,
      basePoints: 60,
      cooldownMinutes: SEED_CHORES.bathroom.cooldownMinutes,
      reason: null,
      appliesAt: at(48),
      scheduledBy: ryan,
      now: at(6),
    });
    await vetoSuggestion(db(), {
      suggestionId: vetoed.id,
      vetoedBy: sam,
      now: at(7),
    });
    await insertAdminChange(db(), {
      householdId: HOUSEHOLD_ID,
      choreId: dishes.choreId,
      currentPoints: SEED_CHORES.dishes.basePoints,
      currentCooldownMinutes: SEED_CHORES.dishes.cooldownMinutes,
      basePoints: 12,
      cooldownMinutes: SEED_CHORES.dishes.cooldownMinutes,
      reason: null,
      appliesAt: at(7.5),
      scheduledBy: ryan,
      now: at(-1),
    });

    const entries = await read(at(8));
    expect(entries.map(label)).toEqual([
      "points Dishes applied",
      "points Bathroom vetoed",
      "points Bathroom scheduled",
      "points Trash scheduled",
      "chore Dishes confirmed",
      "dispute Trash open",
      "chore Trash disputed",
      "bounty Bathroom edited",
      "bounty Bathroom added",
      "points Dishes scheduled",
    ]);

    const byLabel = (l: string) => entries.find((e) => label(e) === l)!;
    expect(byLabel("chore Trash disputed")).toMatchObject({
      at: at(2),
      completionId: trashClaim.id,
      doneBy: { memberId: ryan, displayName: "Ryan" },
      loggedBy: { memberId: ryan, displayName: "Ryan" },
      windowEndsAt: at(26),
      dispute: {
        raisedBy: { memberId: sam, displayName: "Sam" },
        reason: "bins still full",
      },
      totalPts: null,
      voidReason: null,
    });
    expect(byLabel("chore Dishes confirmed")).toMatchObject({
      loggedBy: { memberId: sam, displayName: "Sam" },
      totalPts: SEED_CHORES.dishes.basePoints,
      dispute: null,
    });
    expect(byLabel("dispute Trash open")).toMatchObject({
      at: at(3),
      raisedBy: { memberId: sam, displayName: "Sam" },
      doneBy: { memberId: ryan, displayName: "Ryan" },
      reason: "bins still full",
      resolvedAt: null,
    });
    expect(byLabel("bounty Bathroom edited")).toMatchObject({
      choreId: bathroom.choreId,
      by: { memberId: ryan, displayName: "Ryan" },
    });
    expect(byLabel("points Trash scheduled")).toMatchObject({
      by: { memberId: ryan, displayName: "Ryan" },
      scheduledBy: ryan,
      fromPoints: TRASH.basePoints,
      toPoints: 30,
      reason: "smelly",
      appliesAt: at(48),
      vetoable: true,
      outcome: "pending",
    });
    expect(byLabel("points Bathroom vetoed")).toMatchObject({
      by: { memberId: sam, displayName: "Sam" },
      vetoable: false,
      outcome: "vetoed",
    });
    expect(byLabel("points Bathroom scheduled")).toMatchObject({
      outcome: "vetoed",
    });
    expect(byLabel("points Dishes applied")).toMatchObject({
      at: at(7.5),
      by: null,
      vetoable: false,
      outcome: "applied",
    });
  });

  it("lists each bounty a mass edit changed, not the ones it only archived (issue #175)", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const trash = await seedChore(db(), TRASH);
    const dishes = await seedChore(db(), SEED_CHORES.dishes);
    const bathroom = await seedChore(db(), SEED_CHORES.bathroom);
    await t
      .db()
      .insert(auditEvents)
      .values({
        actorMemberId: ryan,
        source: "kiosk",
        action: "update_bounties",
        entity: "chore",
        entityId: null,
        payload: {
          changes: [
            { choreId: trash.choreId, points: 30 },
            { choreId: dishes.choreId, name: "Dishes!" },
            { choreId: bathroom.choreId, archived: true },
          ],
          edited: [trash.choreId, dishes.choreId],
        },
        at: at(1),
      });
    const entries = await read(at(2));
    expect(entries.map(label).sort()).toEqual([
      `bounty ${SEED_CHORES.dishes.name} edited`,
      `bounty ${TRASH.name} edited`,
    ]);
    expect(entries.map(label)).not.toContain(
      `bounty ${SEED_CHORES.bathroom.name} edited`,
    );
    expect(entries[0]).toMatchObject({
      by: { memberId: ryan, displayName: "Ryan" },
    });
  });

  it("judges claims and disputes at now: finalized, timed out, expired", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const sam = await seedPlayer(db(), "Sam");
    const trash = await seedChore(db(), TRASH);
    const dishes = await seedChore(db(), SEED_CHORES.dishes);
    const fine = await claim(trash.choreId, ryan, at(0));
    const doubted = await claim(dishes.choreId, ryan, at(0.5));
    await apply(
      doubted.id,
      { type: "dispute", actor: sam, reason: "no" },
      at(1),
    );

    const entries = await read(at(30));
    expect(entries.map(label)).toEqual([
      "dispute Dishes expired",
      "chore Dishes voided",
      "chore Trash finalized",
    ]);
    expect(entries.find((e) => label(e) === "chore Trash finalized")).toEqual(
      expect.objectContaining({
        completionId: fine.id,
        totalPts: TRASH.basePoints,
      }),
    );
    expect(entries.find((e) => label(e) === "chore Dishes voided")).toEqual(
      expect.objectContaining({
        voidReason: "disputed",
        totalPts: null,
        dispute: null,
      }),
    );
    expect(entries[0]).toMatchObject({ resolvedAt: at(24.5) });

    // Undone: voided with its stored reason; withdrawn disputes say so.
    await apply(fine.id, { type: "dispute", actor: sam, reason: "?" }, at(2));
    await apply(fine.id, { type: "withdraw", actor: sam }, at(3));
    const later = await read(at(4));
    expect(later.map(label)).toContain("dispute Trash withdrawn");
  });

  it("says a cancelled change was cancelled, never that it can be vetoed", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const trash = await seedChore(db(), TRASH);
    const change = await insertAdminChange(db(), {
      householdId: HOUSEHOLD_ID,
      choreId: trash.choreId,
      currentPoints: TRASH.basePoints,
      currentCooldownMinutes: TRASH.cooldownMinutes,
      basePoints: 30,
      cooldownMinutes: TRASH.cooldownMinutes,
      reason: null,
      appliesAt: at(48),
      scheduledBy: ryan,
      now: at(0),
    });
    const before = await read(at(1));
    expect(before).toEqual([
      expect.objectContaining({ event: "scheduled", outcome: "pending" }),
    ]);
    await dismissSuggestion(db(), {
      suggestionId: change.id,
      dismissedBy: ryan,
      now: at(2),
    });
    // Past the day it would have landed: still no applied entry.
    const after = await read(at(50));
    expect(after).toEqual([
      expect.objectContaining({
        event: "scheduled",
        outcome: "cancelled",
        vetoable: false,
      }),
    ]);
  });

  it("keeps to its window, its limit and its household", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const trash = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    await claim(trash.choreId, ryan, at(0));
    await claim(trash.choreId, ryan, at(1));
    await claim(trash.choreId, ryan, at(2));

    expect(await read(at(3), { since: at(0.5) })).toHaveLength(2);
    const two = await read(at(3), { limit: 2 });
    expect(two.map((e) => e.at)).toEqual([at(2), at(1)]);
    // Nothing that happens after `now` is shown yet.
    expect(await read(at(1.5))).toHaveLength(2);

    const other = "00000000-0000-4000-8000-0000000000ff";
    await t
      .db()
      .insert(households)
      .values({ id: other, name: "Next door", tz: "Europe/Berlin" });
    await expect(
      listActivity(db(), {
        householdId: other,
        since: at(-1),
        now: at(3),
        limit: 50,
      }),
    ).resolves.toEqual([]);
  });
});
