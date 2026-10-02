// @vitest-environment node
import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { completions } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { defineAction, type AnyActionDef, type RequestCtx } from "./define";
import { createProposer } from "./propose";
import { proposeAction, runAction } from "./registry";

// Proposals (SPEC §6.3): checked and previewed like runAction would, never
// executed, and flagged when the kiosk must ask for a PIN.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

let ryan: string;
let sam: string;
let trash: string;

beforeEach(async () => {
  ryan = await seedMember(db(), { displayName: "Ryan" });
  sam = await seedMember(db(), { displayName: "Sam" });
  ({ choreId: trash } = await seedChore(db(), SEED_CHORES.trash));
});

const choices = {
  members: [{ value: "m", label: "M" }],
  chores: [{ value: "c", label: "C" }],
};

function ai(ctx: RequestCtx): RequestCtx {
  return { ...ctx, source: "ai", requestId: undefined, now: new Date() };
}

describe("proposeAction", () => {
  it("previews a valid write without running it", async () => {
    const p = await proposeAction(
      "log_completion",
      { choreId: trash },
      ai(ctxFor(sessionActor(ryan))),
      choices,
    );
    expect(p).toMatchObject({
      name: "log_completion",
      title: "Log a chore",
      input: { choreId: trash },
      risk: "confirm",
      valid: true,
      needsPin: false,
    });
    expect(p.preview).toMatch(/^Log Trash for Ryan: \+\d+ \(streak 1\)$/);
    expect(p.fields.find((f) => f.name === "choreId")).toMatchObject({
      kind: "select",
      options: choices.chores,
      required: true,
    });
    const [n] = await t.db().select({ n: count() }).from(completions);
    expect(n!.n).toBe(0);
  });

  it("asks for a PIN on the kiosk only where the action needs attestation", async () => {
    const kiosk = ai(ctxFor(kioskActor(ryan)));
    const self = await proposeAction(
      "log_completion",
      { choreId: trash },
      kiosk,
      choices,
    );
    expect(self.needsPin).toBe(false);
    const forSam = await proposeAction(
      "log_completion",
      { choreId: trash, doneBy: sam },
      kiosk,
      choices,
    );
    // Vouching needs no PIN on the kiosk (issue #145).
    expect(forSam).toMatchObject({ valid: true, needsPin: false });
    expect(forSam.preview).toMatch(/^Log Trash for Sam/);

    // Sam's claim: Ryan disputes it with a PIN; Sam undoes it with none.
    const logged = await runAction(
      "log_completion",
      { choreId: trash },
      ctxFor(sessionActor(sam), { now: new Date() }),
    );
    if (!logged.ok) throw new Error(logged.message);
    const undo = await proposeAction(
      "undo_completion",
      { completionId: logged.data.completionId },
      ai(ctxFor(kioskActor(sam))),
      choices,
    );
    expect(undo).toMatchObject({ valid: true, needsPin: false });
    const dispute = await proposeAction(
      "dispute_completion",
      { completionId: logged.data.completionId, reason: "Still full" },
      kiosk,
      choices,
    );
    expect(dispute).toMatchObject({ valid: true, needsPin: true });
    const phone = await proposeAction(
      "dispute_completion",
      { completionId: logged.data.completionId, reason: "Still full" },
      ai(ctxFor(sessionActor(ryan))),
      choices,
    );
    expect(phone.needsPin).toBe(false);
  });

  it("asks no PIN on the kiosk for a note or an event (issue #145)", async () => {
    const kiosk = ai(ctxFor(kioskActor(ryan)));
    const note = await proposeAction(
      "create_note",
      { title: "Bins out" },
      kiosk,
      choices,
    );
    expect(note).toMatchObject({ valid: true, needsPin: false });
    const event = await proposeAction(
      "create_event",
      {
        title: "Dinner",
        kind: "timed",
        date: "2027-01-15",
        startTime: "19:00",
        endTime: "20:30",
      },
      kiosk,
      choices,
    );
    expect(event).toMatchObject({ valid: true, needsPin: false });
  });

  it("marks input that fails the schema as invalid, with the issues", async () => {
    const p = await proposeAction(
      "log_completion",
      { choreId: "not-a-uuid", extra: 1 },
      ai(ctxFor(sessionActor(ryan))),
      choices,
    );
    expect(p).toMatchObject({ valid: false, needsPin: false });
    expect(p.issues!.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(["choreId"]),
    );
    expect(p.fields.length).toBeGreaterThan(0);
  });

  it("marks unknown actions, reads and actions not offered to the AI as invalid", async () => {
    const ctx = ai(ctxFor(sessionActor(ryan)));
    for (const [name, title] of [
      ["drop_tables", "drop_tables"],
      ["get_standings", "Get the standings"],
      ["manage_chore", "Manage chores"],
    ] as const) {
      const p = await proposeAction(name, "not an object", ctx, choices);
      expect(p, name).toMatchObject({
        name,
        valid: false,
        input: {},
        fields: [],
      });
      expect(p.title, name).toBe(title);
    }
  });
});

describe("createProposer", () => {
  const input = z.strictObject({ id: z.string() });
  const thing = {
    title: "Thing",
    description: "Does a thing.",
    kind: "write" as const,
    risk: "safe" as const,
    surfaces: ["ai"] as const,
    requires: "member" as const,
    input,
    execute: async () => ({ ok: true as const, data: null }),
  };

  it("falls back to the title when there is no preview, or it throws", async () => {
    const logError = vi.fn();
    const plain = defineAction({
      ...thing,
      name: "plain",
      consent: "Do things",
    });
    const broken = defineAction({
      ...thing,
      name: "broken",
      consent: "Do things",
      preview: async () => {
        throw new Error("db down");
      },
    });
    const registry: Record<string, AnyActionDef> = { plain, broken };
    const propose = createProposer(registry, {
      readDb: db,
      newId: () => "proposal-1",
      logError,
    });
    const ctx = ai(ctxFor(sessionActor(ryan)));
    expect(await propose("plain", { id: "x" }, ctx, choices)).toMatchObject({
      proposalId: "proposal-1",
      preview: "Thing",
      valid: true,
    });
    expect(await propose("broken", { id: "x" }, ctx, choices)).toMatchObject({
      preview: "Thing",
      valid: true,
    });
    expect(logError).toHaveBeenCalledOnce();
  });
});
