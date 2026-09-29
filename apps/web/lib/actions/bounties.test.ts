// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import {
  auditEvents,
  choreRuleVersions,
  chores,
  completionScores,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { DEFAULT_COOLDOWN_HOURS } from "./bounties";
import type { RequestCtx } from "./define";
import { createProposer } from "./propose";
import { REGISTRY, runAction } from "./registry";

// create_bounty and update_bounty (issue #107) through the real runAction
// and proposer on PGlite: success, each error code, the surfaces (ui, ai,
// brain; never kiosk or MCP) and the admin gate, brain in the admin's own
// name only.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const HOUR = 60 * 60_000;
const at = (hours: number) => new Date(FIXED_NOW.getTime() + hours * HOUR);
const TRASH = SEED_CHORES.trash;

let admin: string;
let member: string;
let trash: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  admin = await seedMember(db(), { role: "admin", displayName: "Admin" });
  member = await seedMember(db(), { displayName: "Member" });
  ({ choreId: trash } = await seedChore(db(), TRASH));
});

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

const brain = (memberId: string, role?: "admin" | "member"): Actor => ({
  kind: "service",
  tokenName: "baumy-brain",
  memberId,
  ...(role ? { role } : {}),
});
const asAdmin = (over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(admin, "admin"), over);

const propose = createProposer(REGISTRY, {
  readDb: () => db(),
  newId: () => "proposal-1",
  logError: () => {},
});
const choices = { members: [], chores: [] };

async function choreRow(id: string) {
  const [row] = await t.db().select().from(chores).where(eq(chores.id, id));
  return row!;
}
async function weights(id: string) {
  return t
    .db()
    .select({
      base: choreRuleVersions.basePoints,
      cooldown: choreRuleVersions.cooldownMinutes,
      source: choreRuleVersions.source,
    })
    .from(choreRuleVersions)
    .where(eq(choreRuleVersions.choreId, id));
}

describe("create_bounty", () => {
  const recycling = { name: "Recycling (paper)", points: 15 };

  it("adds a bounty with the defaults, a manual weight and one audit row", async () => {
    const data = ok(
      await runAction("create_bounty", recycling, asAdmin({ source: "ai" })),
    );
    expect(data).toEqual({
      choreId: expect.any(String),
      name: "Recycling (paper)",
      archived: false,
      weightChanged: true,
    });
    expect(await choreRow(data.choreId)).toMatchObject({
      kind: "maintenance",
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: 100,
      sprite: "recycling-paper",
    });
    expect(await weights(data.choreId)).toEqual([
      { base: 15, cooldown: DEFAULT_COOLDOWN_HOURS * 60, source: "manual" },
    ]);
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "create_bounty"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entity: "chore",
      entityId: data.choreId,
      source: "ai",
    });
  });

  it("takes every setting", async () => {
    const data = ok(
      await runAction(
        "create_bounty",
        {
          name: "Dish soap",
          kind: "consumable",
          points: 10,
          cooldownHours: 72,
          proofMode: "required",
          confirmMode: "partner",
          effortFactorPct: 150,
        },
        asAdmin(),
      ),
    );
    expect(await choreRow(data.choreId)).toMatchObject({
      kind: "consumable",
      proofMode: "required",
      confirmMode: "partner",
      effortFactorPct: 150,
    });
    expect(await weights(data.choreId)).toEqual([
      { base: 10, cooldown: 72 * 60, source: "manual" },
    ]);
  });

  it("refuses a name another active chore has, and bad input", async () => {
    await expect(
      runAction("create_bounty", { name: "TRASH", points: 5 }, asAdmin()),
    ).resolves.toEqual({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: "There is already a chore called TRASH. Pick another name.",
    });
    for (const bad of [
      { name: "X" },
      { name: "X", points: 0 },
      { name: "X", points: 5, kind: "errand" },
      { name: "X", points: 5, archived: true },
    ]) {
      await expect(
        runAction("create_bounty", bad, asAdmin()),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("is for an admin: a session in the app or the AI, or brain in their own name", async () => {
    ok(await runAction("create_bounty", { name: "A", points: 5 }, asAdmin()));
    ok(
      await runAction(
        "create_bounty",
        { name: "B", points: 5 },
        ctxFor(brain(admin, "admin"), { source: "brain" }),
      ),
    );
    const refusals: [Actor, RequestCtx["source"], string][] = [
      [sessionActor(member), "ai", "FORBIDDEN"],
      [sessionActor(member), "ui", "FORBIDDEN"],
      [brain(member, "member"), "brain", "FORBIDDEN"],
      // On a housemate's behalf, even from an admin asker.
      [
        { ...brain(member, "admin"), initiatorMemberId: admin } as Actor,
        "brain",
        "FORBIDDEN",
      ],
      [
        { kind: "kiosk", deviceId: "d", memberId: admin },
        "kiosk",
        "SURFACE_FORBIDDEN",
      ],
      [
        {
          kind: "mcp",
          memberId: admin,
          scopes: ["baumy:read", "baumy:write"],
        },
        "mcp",
        "SURFACE_FORBIDDEN",
      ],
    ];
    for (const [actor, source, code] of refusals) {
      await expect(
        runAction(
          "create_bounty",
          { name: `C ${source} ${code}`, points: 5 },
          ctxFor(actor, { source }),
        ),
        `${actor.kind} ${source}`,
      ).resolves.toMatchObject({ ok: false, code });
    }
    const [n] = await t.db().select({ n: count() }).from(chores);
    expect(n!.n).toBe(3);
  });

  it("is proposed with a plain preview for an admin, and marked not valid for anyone else", async () => {
    await expect(
      propose("create_bounty", recycling, asAdmin({ source: "ai" }), choices),
    ).resolves.toMatchObject({
      valid: true,
      preview: "New bounty: Recycling (paper) · maintenance · 15 pts",
      risk: "confirm",
    });
    await expect(
      propose(
        "create_bounty",
        { ...recycling, proofMode: "required", cooldownHours: 48 },
        asAdmin({ source: "ai" }),
        choices,
      ),
    ).resolves.toMatchObject({
      preview:
        "New bounty: Recycling (paper) · maintenance · 15 pts · every 48 h · photo required",
    });
    await expect(
      propose(
        "create_bounty",
        recycling,
        ctxFor(sessionActor(member), { source: "ai" }),
        choices,
      ),
    ).resolves.toMatchObject({
      valid: false,
      preview: "New bounty: Recycling (paper) · maintenance · 15 pts",
      error: "Only a household admin can do this.",
    });
    await expect(
      propose(
        "create_bounty",
        recycling,
        ctxFor(
          { kind: "kiosk", deviceId: "d", memberId: admin },
          { source: "ai" },
        ),
        choices,
      ),
    ).resolves.toMatchObject({
      valid: false,
      error: "This can only be done signed in on your own phone or computer.",
    });
    const [n] = await t.db().select({ n: count() }).from(chores);
    expect(n!.n).toBe(1);
  });
});

describe("update_bounty", () => {
  it("changes only the fields given; half a weight keeps the other half", async () => {
    const data = ok(
      await runAction(
        "update_bounty",
        { choreId: trash, points: 30 },
        asAdmin({ source: "ai", now: at(1) }),
      ),
    );
    expect(data).toEqual({
      choreId: trash,
      name: TRASH.name,
      archived: false,
      weightChanged: true,
    });
    expect(await weights(trash)).toContainEqual({
      base: 30,
      cooldown: TRASH.cooldownMinutes,
      source: "manual",
    });
    const before = await choreRow(trash);

    ok(
      await runAction(
        "update_bounty",
        { choreId: trash, cooldownHours: 2, name: "Bins", kind: "consumable" },
        asAdmin({ now: at(2) }),
      ),
    );
    expect(await weights(trash)).toContainEqual({
      base: 30,
      cooldown: 120,
      source: "manual",
    });
    expect(await choreRow(trash)).toMatchObject({
      name: "Bins",
      kind: "consumable",
      proofMode: before.proofMode,
      confirmMode: before.confirmMode,
      effortFactorPct: before.effortFactorPct,
    });

    // Settings only: no new weight.
    await expect(
      runAction(
        "update_bounty",
        { choreId: trash, proofMode: "optional", effortFactorPct: 120 },
        asAdmin({ now: at(3) }),
      ),
    ).resolves.toMatchObject({ ok: true, data: { weightChanged: false } });
    expect(await choreRow(trash)).toMatchObject({
      proofMode: "optional",
      effortFactorPct: 120,
    });
    expect(await weights(trash)).toHaveLength(3);
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update_bounty"));
    expect(audits).toHaveLength(3);
    expect(audits[0]).toMatchObject({ entity: "chore", entityId: trash });
  });

  it("keeps scores already stored", async () => {
    ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(sessionActor(member)),
      ),
    );
    ok(
      await runAction(
        "update_bounty",
        { choreId: trash, points: TRASH.basePoints + 50 },
        asAdmin({ now: at(1) }),
      ),
    );
    const [score] = await t.db().select().from(completionScores);
    expect(score?.totalPts).toBe(TRASH.basePoints);
  });

  it("refuses an unknown or archived bounty, a taken name and an empty change", async () => {
    await expect(
      runAction(
        "update_bounty",
        { choreId: "00000000-0000-4000-8000-00000000beef", points: 5 },
        asAdmin(),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "That bounty was not found.",
    });
    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    await expect(
      runAction(
        "update_bounty",
        { choreId: dishes, name: TRASH.name.toUpperCase() },
        asAdmin(),
      ),
    ).resolves.toMatchObject({ ok: false, code: "CHORE_NAME_TAKEN" });
    await expect(
      runAction("update_bounty", { choreId: trash }, asAdmin()),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ message: "Say what to change about the bounty." }],
    });
    ok(
      await runAction(
        "manage_chore",
        { op: "archive", choreId: dishes },
        asAdmin(),
      ),
    );
    await expect(
      runAction("update_bounty", { choreId: dishes, points: 9 }, asAdmin()),
    ).resolves.toEqual({
      ok: false,
      code: "ARCHIVED_CHORE",
      message: `${SEED_CHORES.dishes.name} is archived. Restore it on the admin page first.`,
    });
  });

  it("asks for both halves of a weight when the bounty has none yet", async () => {
    const [bare] = await t
      .db()
      .insert(chores)
      .values({
        householdId: (await choreRow(trash)).householdId,
        name: "Bare",
        sprite: "bare",
      })
      .returning({ id: chores.id });
    await expect(
      runAction("update_bounty", { choreId: bare!.id, points: 9 }, asAdmin()),
    ).resolves.toMatchObject({ ok: false, code: "NO_RULE_VERSION" });
    ok(
      await runAction(
        "update_bounty",
        { choreId: bare!.id, points: 9, cooldownHours: 1 },
        asAdmin(),
      ),
    );
    expect(await weights(bare!.id)).toEqual([
      { base: 9, cooldown: 60, source: "manual" },
    ]);
  });

  it("is for an admin only, never the kiosk or MCP", async () => {
    await expect(
      runAction(
        "update_bounty",
        { choreId: trash, points: 1 },
        ctxFor(sessionActor(member), { source: "ai" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      runAction(
        "update_bounty",
        { choreId: trash, points: 1 },
        ctxFor(brain(member, "member"), { source: "brain" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      runAction(
        "update_bounty",
        { choreId: trash, points: 1 },
        ctxFor(
          { kind: "mcp", memberId: admin, scopes: ["baumy:write"] },
          {
            source: "mcp",
          },
        ),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    ok(
      await runAction(
        "update_bounty",
        { choreId: trash, points: 1 },
        ctxFor(brain(admin, "admin"), { source: "brain" }),
      ),
    );
  });

  it("previews what changes, by the bounty's name", async () => {
    await expect(
      propose(
        "update_bounty",
        { choreId: trash, points: 30, name: "Bins", proofMode: "required" },
        asAdmin({ source: "ai" }),
        choices,
      ),
    ).resolves.toMatchObject({
      valid: true,
      preview: `Edit bounty: ${TRASH.name} → rename to Bins, 30 pts, photo required`,
    });
  });

  it("is proposed as not valid for a bounty that is gone or archived", async () => {
    const gone = { choreId: "00000000-0000-4000-8000-00000000beef", points: 3 };
    await expect(
      propose("update_bounty", gone, asAdmin({ source: "ai" }), choices),
    ).resolves.toMatchObject({
      valid: false,
      preview: "Edit a bounty",
      error: "That bounty was not found.",
    });
    // Someone who may not edit bounties at all hears that first.
    await expect(
      propose(
        "update_bounty",
        gone,
        ctxFor(sessionActor(member), { source: "ai" }),
        choices,
      ),
    ).resolves.toMatchObject({
      valid: false,
      error: "Only a household admin can do this.",
    });
    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    ok(
      await runAction(
        "manage_chore",
        { op: "archive", choreId: dishes },
        asAdmin(),
      ),
    );
    await expect(
      propose(
        "update_bounty",
        { choreId: dishes, points: 9 },
        asAdmin({ source: "ai" }),
        choices,
      ),
    ).resolves.toMatchObject({
      valid: false,
      error: `${SEED_CHORES.dishes.name} is archived. Restore it on the admin page first.`,
    });
  });
});
