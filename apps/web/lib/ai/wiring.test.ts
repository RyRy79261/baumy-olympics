// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { aiUsage } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { ctxFor, seedMember, sessionActor } from "@/test-utils/actions";

// The real dependencies of the AI routes: the device picks the adapter, the
// household is read for the prompt, and the loop gets the `ai` tools.

const kioskRequestCtx = vi.fn(async () => null);
const uiRequestCtx = vi.fn(async () => null);
vi.mock("@/lib/actions/kiosk", () => ({ kioskRequestCtx }));
vi.mock("@/lib/actions/ui", () => ({ uiRequestCtx }));

const {
  commandRouteDeps,
  proposalRouteDeps,
  runRouteDeps,
  transcribeRouteDeps,
} = await import("./wiring");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

beforeEach(() => {
  kioskRequestCtx.mockClear();
  uiRequestCtx.mockClear();
});

describe("AI route wiring", () => {
  it("reads the context from the kiosk or the session by device", async () => {
    const deps = runRouteDeps();
    await deps.requestCtx("kiosk", "req-1", "1234");
    expect(kioskRequestCtx).toHaveBeenCalledWith("req-1", "1234");
    await deps.requestCtx("ui", "req-2", "1234");
    expect(uiRequestCtx).toHaveBeenCalledWith("req-2");
  });

  it("loads the active members and the chores for the prompt", async () => {
    const ryan = await seedMember(db(), { displayName: "Ryan" });
    const { choreId } = await seedChore(db(), SEED_CHORES.trash);
    const deps = proposalRouteDeps();
    const household = await deps.loadHousehold(ctxFor(sessionActor(ryan)));
    expect(household).toEqual({
      members: [{ id: ryan, displayName: "Ryan" }],
      chores: [{ id: choreId, name: SEED_CHORES.trash.name }],
    });
  });

  it("gives the command the quality model and the ai tools", async () => {
    const deps = commandRouteDeps();
    expect(deps.model).toBe("claude-sonnet-5");
    expect(deps.dailyLimit()).toBeGreaterThanOrEqual(0);
    expect(deps.loop.tools.map((s) => s.name)).toContain("log_completion");
    expect(deps.loop.kindOf("get_standings")).toBe("read");
    expect(deps.loop.kindOf("log_completion")).toBe("write");
    expect(deps.loop.kindOf("nope")).toBeUndefined();
    expect(typeof deps.loop.nowMs()).toBe("number");
    const ran = await deps.loop.runAction(
      "whoami",
      {},
      ctxFor(sessionActor(undefined)),
    );
    expect(ran.ok).toBe(false);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.logError("x", "y");
    expect(err).toHaveBeenCalledWith("x", "y");
    err.mockRestore();
  });

  it("gives the transcriber its adapter, and records a clip's seconds", async () => {
    const ryan = await seedMember(db(), { displayName: "Ryan" });
    const deps = transcribeRouteDeps();
    expect(typeof deps.transcriber().ok).toBe("boolean");
    expect(typeof deps.rateLimiter.limit).toBe("function");
    await deps.recordAudio(
      ctxFor(sessionActor(ryan)),
      "whisper-large-v3-turbo",
      2.5,
    );
    const rows = await t.db().select().from(aiUsage);
    expect(rows).toEqual([
      expect.objectContaining({
        memberId: ryan,
        provider: "groq",
        audioSeconds: 2.5,
      }),
    ]);
  });
});
