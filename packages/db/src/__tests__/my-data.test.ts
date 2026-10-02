import {
  berlinWallTimeToUtc,
  challengeWindowEndsAt,
  PHOTO_RETENTION_DAYS,
  RULESET_V1,
} from "@baumy/core";
import { describe, expect, it } from "vitest";
import { logCompletion } from "../completions";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  countAuditEntriesNaming,
  myAiUsage,
  myCompletions,
  myNoteCounts,
} from "../my-data";
import { insertNote, softDeleteNote } from "../notes";
import { aiUsage, auditEvents } from "../schema";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

// get_my_data's reads (issue #144) on PGlite: every count is keyed on the one
// member, and the other member's rows, seeded alongside, never count.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const tx = <T>(fn: (q: Queryable) => Promise<T>) =>
  t.db().transaction((x) => fn(x as unknown as Queryable));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOW = RULESET_V1.challengeWindowH * HOUR;
/** Mon 21 Sep 2026, 08:00 Berlin. */
const T0 = berlinWallTimeToUtc(2026, 9, 21, 8);
const at = (ms: number) => new Date(T0.getTime() + ms);

let reqSeq = 0;
async function claim(
  choreId: string,
  doneBy: string,
  when: Date,
  opts: { loggedBy?: string; photo?: string } = {},
) {
  reqSeq += 1;
  const r = await tx((q) =>
    logCompletion(q, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy,
      loggedBy: opts.loggedBy ?? doneBy,
      occurredAt: when,
      now: when,
      source: "ui",
      clientRequestId: `my-data-${reqSeq}`,
      photoPathname: opts.photo ?? null,
    }),
  );
  if (!r.ok) throw new Error(`log failed: ${r.code}`);
  return r.completion;
}

describe("myCompletions", () => {
  it("counts only the member's completions by status now, with each photo's deletion day", async () => {
    const me = await seedPlayer(db(), "Me");
    const other = await seedPlayer(db(), "Other");
    const trash = await seedChore(db(), SEED_CHORES.trash);
    const dishes = await seedChore(db(), SEED_CHORES.dishes);
    const bathroom = await seedChore(db(), SEED_CHORES.bathroom);

    // Mine: a settled self-claim with a photo, one logged for me by the
    // other member (verified on creation), and an open one with a photo.
    const settled = await claim(trash.choreId, me, T0, {
      photo: "completions/a/proof.webp",
    });
    await claim(dishes.choreId, me, T0, { loggedBy: other });
    const now = at(WINDOW + 2 * HOUR);
    const open = await claim(bathroom.choreId, me, at(WINDOW + HOUR), {
      photo: "completions/b/proof.webp",
    });
    // Theirs, with a photo too: never counted for me.
    await claim(trash.choreId, other, at(3 * DAY), {
      photo: "completions/c/proof.webp",
    });

    const mine = await myCompletions(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: me,
      now,
    });
    expect(mine.completions).toEqual({
      total: 3,
      byStatus: {
        pending: 1,
        confirmed: 1,
        finalized: 1,
        disputed: 0,
        voided: 0,
      },
    });
    expect(mine.photos).toEqual([
      {
        attachedAt: settled.photoAttachedAt,
        deletesAt: new Date(
          challengeWindowEndsAt(settled).getTime() + PHOTO_RETENTION_DAYS * DAY,
        ),
      },
      { attachedAt: open.photoAttachedAt, deletesAt: null },
    ]);

    const theirs = await myCompletions(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: other,
      now: at(3 * DAY),
    });
    expect(theirs.completions.total).toBe(1);
    expect(theirs.photos).toHaveLength(1);
  });

  it("is empty for a member with none", async () => {
    const me = await seedPlayer(db(), "Me");
    const mine = await myCompletions(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: me,
      now: T0,
    });
    expect(mine.completions.total).toBe(0);
    expect(mine.photos).toEqual([]);
  });
});

describe("myNoteCounts", () => {
  it("counts the member's notes, deleted ones kept included, and no one else's", async () => {
    const me = await seedPlayer(db(), "Me");
    const other = await seedPlayer(db(), "Other");
    const add = (authorId: string, title: string) =>
      insertNote(db(), {
        householdId: HOUSEHOLD_ID,
        authorId,
        title,
        bodyMd: "",
        color: null,
        pinned: false,
        now: T0,
      });
    const a = await add(me, "A");
    await add(me, "B");
    await add(me, "C");
    const theirs = await add(other, "D");
    await softDeleteNote(db(), { householdId: HOUSEHOLD_ID, id: a, now: T0 });
    await softDeleteNote(db(), {
      householdId: HOUSEHOLD_ID,
      id: theirs,
      now: T0,
    });

    expect(
      await myNoteCounts(db(), { householdId: HOUSEHOLD_ID, memberId: me }),
    ).toEqual({ written: 3, deletedKept: 1 });
    expect(
      await myNoteCounts(db(), { householdId: HOUSEHOLD_ID, memberId: other }),
    ).toEqual({ written: 1, deletedKept: 1 });
  });
});

describe("countAuditEntriesNaming", () => {
  it("counts entries where they act, started it, or are the member it is about", async () => {
    const me = await seedPlayer(db(), "Me");
    const other = await seedPlayer(db(), "Other");
    const row = (over: Partial<typeof auditEvents.$inferInsert>) => ({
      source: "ui" as const,
      action: "x",
      entity: "chore",
      ...over,
    });
    await t
      .db()
      .insert(auditEvents)
      .values([
        row({ actorMemberId: me }),
        row({ actorMemberId: me }),
        row({ actorMemberId: other, initiatedByMemberId: me }),
        row({ actorMemberId: other, entity: "member", entityId: me }),
        row({ actorMemberId: null, entity: "member", entityId: me }),
        // Not mine: the other member's, and a chore whose id happens to be mine.
        row({ actorMemberId: other }),
        row({ actorMemberId: other, entity: "member", entityId: other }),
        row({ actorMemberId: other, entity: "chore", entityId: me }),
      ]);
    expect(await countAuditEntriesNaming(db(), me)).toBe(5);
    expect(await countAuditEntriesNaming(db(), other)).toBe(5);
  });
});

describe("myAiUsage", () => {
  it("sums the member's commands, tokens and voice, and no one else's", async () => {
    const me = await seedPlayer(db(), "Me");
    const other = await seedPlayer(db(), "Other");
    const base = { householdId: HOUSEHOLD_ID };
    await t
      .db()
      .insert(aiUsage)
      .values([
        {
          ...base,
          memberId: me,
          provider: "anthropic",
          inputTokens: 100,
          outputTokens: 20,
          at: at(0),
        },
        {
          ...base,
          memberId: me,
          provider: "anthropic",
          inputTokens: 50,
          outputTokens: 5,
          at: at(HOUR),
        },
        {
          ...base,
          memberId: me,
          provider: "groq",
          audioSeconds: 2.5,
          at: at(2 * HOUR),
        },
        {
          ...base,
          memberId: other,
          provider: "anthropic",
          inputTokens: 999,
          outputTokens: 999,
          at: at(3 * HOUR),
        },
      ]);
    expect(
      await myAiUsage(db(), { householdId: HOUSEHOLD_ID, memberId: me }),
    ).toEqual({
      commands: 2,
      inputTokens: 150,
      outputTokens: 25,
      voiceClips: 1,
      voiceSeconds: 2.5,
      lastUsedAt: at(2 * HOUR),
    });
  });

  it("is all zeros for a member who never asked", async () => {
    const me = await seedPlayer(db(), "Me");
    expect(
      await myAiUsage(db(), { householdId: HOUSEHOLD_ID, memberId: me }),
    ).toEqual({
      commands: 0,
      inputTokens: 0,
      outputTokens: 0,
      voiceClips: 0,
      voiceSeconds: 0,
      lastUsedAt: null,
    });
  });
});
