// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { aiUsage } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { ctxFor, seedMember, sessionActor } from "@/test-utils/actions";
import {
  DEFAULT_DAILY_COMMANDS,
  claimCommand,
  dailyCommandLimit,
  recordCommandTokens,
} from "./usage";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

describe("dailyCommandLimit", () => {
  it("reads AI_DAILY_COMMANDS_PER_MEMBER, with a default", () => {
    expect(dailyCommandLimit({})).toBe(DEFAULT_DAILY_COMMANDS);
    expect(dailyCommandLimit({ AI_DAILY_COMMANDS_PER_MEMBER: "20" })).toBe(20);
    expect(dailyCommandLimit({ AI_DAILY_COMMANDS_PER_MEMBER: " 0 " })).toBe(0);
    for (const bad of ["", "-1", "2.5", "lots", "10000000"]) {
      expect(dailyCommandLimit({ AI_DAILY_COMMANDS_PER_MEMBER: bad })).toBe(
        DEFAULT_DAILY_COMMANDS,
      );
    }
  });
});

describe("claimCommand", () => {
  let ryan: string;
  beforeEach(async () => {
    ryan = await seedMember(db(), { displayName: "Ryan" });
  });

  it("claims today's commands in Berlin days, then records the tokens", async () => {
    // 23:30 Berlin on 27 Sep (21:30 UTC) and 00:30 on the 28th: two days.
    const late = ctxFor(sessionActor(ryan), {
      now: new Date("2026-09-27T21:30:00Z"),
    });
    const early = ctxFor(sessionActor(ryan), {
      now: new Date("2026-09-27T22:30:00Z"),
    });
    const a = await claimCommand(late, "claude-sonnet-5", 1);
    expect(a).toMatchObject({ ok: true, used: 1 });
    expect(await claimCommand(late, "claude-sonnet-5", 1)).toEqual({
      ok: false,
      used: 1,
    });
    expect(await claimCommand(early, "claude-sonnet-5", 1)).toMatchObject({
      ok: true,
    });

    if (!a.ok) throw new Error("expected a claim");
    await recordCommandTokens(a.usageId, { inputTokens: 10, outputTokens: 3 });
    const [row] = await t
      .db()
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, a.usageId));
    expect(row).toMatchObject({
      memberId: ryan,
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 3,
    });
  });
});
