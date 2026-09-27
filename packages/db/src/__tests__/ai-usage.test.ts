import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addAiTokens, claimAiCommand, recordAiAudio } from "../ai-usage";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { aiUsage, members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const DAY = new Date("2026-09-26T22:00:00Z"); // Berlin midnight, 27 Sep
const NOW = new Date("2026-09-27T10:00:00Z");

let ryan: string;
let sam: string;

async function member(name: string) {
  const [m] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName: name,
      avatarSprite: "cat",
      color: "#112233",
    })
    .returning({ id: members.id });
  return m!.id;
}

beforeEach(async () => {
  ryan = await member("Ryan");
  sam = await member("Sam");
});

const claim = (memberId: string, limit: number, now = NOW) =>
  claimAiCommand(db(), {
    householdId: HOUSEHOLD_ID,
    memberId,
    model: "claude-sonnet-5",
    dayStart: DAY,
    limit,
    now,
  });

describe("claimAiCommand", () => {
  it("claims one row per command until the member's daily limit", async () => {
    const first = await claim(ryan, 2);
    expect(first).toMatchObject({ ok: true, used: 1 });
    expect(await claim(ryan, 2)).toMatchObject({ ok: true, used: 2 });
    expect(await claim(ryan, 2)).toEqual({ ok: false, used: 2 });

    const rows = await t.db().select().from(aiUsage);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      memberId: ryan,
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      at: NOW,
    });
  });

  it("counts each member apart", async () => {
    expect((await claim(ryan, 1)).ok).toBe(true);
    expect((await claim(ryan, 1)).ok).toBe(false);
    expect((await claim(sam, 1)).ok).toBe(true);
  });

  it("starts again on the next day", async () => {
    await t
      .db()
      .insert(aiUsage)
      .values({
        householdId: HOUSEHOLD_ID,
        memberId: ryan,
        provider: "anthropic",
        at: new Date(DAY.getTime() - 1),
      });
    expect(await claim(ryan, 1)).toMatchObject({ ok: true, used: 1 });
  });

  it("does not count speech (groq) rows as commands", async () => {
    await t.db().insert(aiUsage).values({
      householdId: HOUSEHOLD_ID,
      memberId: ryan,
      provider: "groq",
      audioSeconds: 3.5,
      at: NOW,
    });
    expect(await claim(ryan, 1)).toMatchObject({ ok: true, used: 1 });
  });

  it("claims nothing with a limit of 0", async () => {
    expect(await claim(ryan, 0)).toEqual({ ok: false, used: 0 });
    expect(await t.db().select().from(aiUsage)).toHaveLength(0);
  });

  it("throws for a member that is not there", async () => {
    await expect(
      claim("00000000-0000-4000-8000-00000000abcd", 5),
    ).rejects.toThrow("no such member");
  });
});

describe("addAiTokens", () => {
  it("adds each call's tokens to the command's row", async () => {
    const c = await claim(ryan, 5);
    if (!c.ok) throw new Error("expected a claim");
    await addAiTokens(db(), c.usageId, { inputTokens: 1200, outputTokens: 80 });
    await addAiTokens(db(), c.usageId, {
      inputTokens: 300,
      outputTokens: 20.4,
    });
    await addAiTokens(db(), c.usageId, { inputTokens: -5, outputTokens: 0 });
    const [row] = await t
      .db()
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, c.usageId));
    expect(row).toMatchObject({ inputTokens: 1500, outputTokens: 100 });
  });
});

describe("recordAiAudio", () => {
  const audio = (audioSeconds: number | null) =>
    recordAiAudio(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: ryan,
      model: "whisper-large-v3-turbo",
      audioSeconds,
      now: NOW,
    });

  it("writes one groq row with the clip's seconds", async () => {
    const id = await audio(3.5);
    const [row] = await t.db().select().from(aiUsage).where(eq(aiUsage.id, id));
    expect(row).toMatchObject({
      memberId: ryan,
      provider: "groq",
      model: "whisper-large-v3-turbo",
      audioSeconds: 3.5,
      inputTokens: 0,
      outputTokens: 0,
      at: NOW,
    });
  });

  it("stores an unknown or impossible length as null", async () => {
    await audio(null);
    await audio(-1);
    await audio(Number.NaN);
    const rows = await t.db().select().from(aiUsage);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.audioSeconds)).toEqual([null, null, null]);
  });

  it("does not count against the command limit", async () => {
    await audio(2);
    expect(await claim(ryan, 1)).toMatchObject({ ok: true, used: 1 });
  });
});
