// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { useTestDb } from "@baumy/db/test-harness";
import { ctxFor, kioskActor, seedMember } from "@/test-utils/actions";
import { setCalendarClientForTests } from "@/lib/integrations/calendar";
import {
  clearMemoryCalendar,
  memoryCalendar,
} from "@/lib/integrations/calendar-memory";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { runAction } from "./registry";

// The kitchen screen before anyone taps their avatar (SPEC §3.1, §8, issue
// #20): the `display` gate lets a paired kiosk with nobody picked READ what
// the hub widgets show, and nothing else. Every write still needs a member.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const idle = () => ctxFor(kioskActor(), { source: "kiosk" });

let choreId: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  clearMemoryCalendar();
  setCalendarClientForTests(memoryCalendar());
  await seedMember(db(), { displayName: "Ryan" });
  ({ choreId } = await seedChore(db(), SEED_CHORES.trash));
});

afterEach(() => {
  setCalendarClientForTests(null);
});

describe("the idle kiosk", () => {
  it("reads the chores, with no score preview since nobody is asking", async () => {
    const r = await runAction("list_chores", {}, idle());
    expect(r).toMatchObject({ ok: true });
    const chores = r.ok ? r.data.chores : [];
    const trash = chores.find((c) => c.id === choreId);
    expect(trash).toMatchObject({ state: "due", basePoints: 20 });
    expect(trash!.next).toBeNull();
    // The same read as a member does preview the score.
    const asMember = await runAction(
      "list_chores",
      {},
      ctxFor(kioskActor(await seedMember(db())), { source: "kiosk" }),
    );
    expect(
      asMember.ok && asMember.data.chores.find((c) => c.id === choreId)!.next,
    ).toMatchObject({ totalPts: 20 });
  });

  it("reads the standings, the pot, today's events and the notes", async () => {
    for (const [name, input] of [
      ["get_standings", { recent: 0 }],
      ["get_pot", {}],
      ["list_events", {}],
      ["list_notes", { pinnedOnly: true }],
    ] as const) {
      const r = await runAction(name, input, idle());
      expect(r, name).toMatchObject({ ok: true });
    }
  });

  it("reads nothing the hub does not show", async () => {
    for (const name of ["get_streaks", "get_pending_confirmations", "whoami"]) {
      expect(await runAction(name, {}, idle()), name).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });

  it("writes nothing", async () => {
    expect(
      await runAction("log_completion", { choreId }, idle()),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await runAction("create_note", { title: "Hi" }, idle()),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
