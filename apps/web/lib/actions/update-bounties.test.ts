// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { auditEvents, choreRuleVersions, chores } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  BASE_POINTS_MAX,
  BOUNTY_EDITS_MAX,
  EFFORT_FACTOR_MAX,
} from "@baumy/types";
import { ctxFor, seedMember, sessionActor } from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import { runAction } from "./registry";

// update_bounties (issue #175, SPEC §12 decision 31) through the real
// runAction on PGlite: many bounties in one save, all or none; each error
// code; the surfaces (ui and kiosk only) and the admin gate, on the kiosk
// for a picked admin with their PIN.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const TRASH = SEED_CHORES.trash;
const DISHES = SEED_CHORES.dishes;
const BATHROOM = SEED_CHORES.bathroom;
const MISSING = "00000000-0000-4000-8000-00000000beef";

let admin: string;
let member: string;
let trash: string;
let dishes: string;
let bathroom: string;

const PIN = "2580";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

beforeEach(async () => {
  __resetMemoryRateLimits();
  admin = await seedMember(db(), {
    role: "admin",
    displayName: "Admin",
    kioskPinHash: pinHash,
  });
  member = await seedMember(db(), {
    displayName: "Member",
    kioskPinHash: pinHash,
  });
  ({ choreId: trash } = await seedChore(db(), TRASH));
  ({ choreId: dishes } = await seedChore(db(), DISHES));
  ({ choreId: bathroom } = await seedChore(db(), BATHROOM));
});

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

const asAdmin = (over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(admin, "admin"), over);
const atKiosk = (memberId: string, role: "admin" | "member", pin?: string) =>
  ctxFor(
    { kind: "kiosk", deviceId: "d", memberId, role },
    { source: "kiosk", ...(pin ? { pin } : {}) },
  );
const run = (changes: unknown, ctx: RequestCtx = asAdmin()) =>
  runAction("update_bounties", { changes }, ctx);

async function row(id: string) {
  const [r] = await t.db().select().from(chores).where(eq(chores.id, id));
  return r!;
}
async function weights(id: string) {
  return t
    .db()
    .select({
      base: choreRuleVersions.basePoints,
      cooldown: choreRuleVersions.cooldownMinutes,
    })
    .from(choreRuleVersions)
    .where(eq(choreRuleVersions.choreId, id));
}
async function audits() {
  return t
    .db()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "update_bounties"));
}
async function archive(id: string) {
  ok(
    await runAction("manage_chore", { op: "archive", choreId: id }, asAdmin()),
  );
}

/** Nothing about the three bounties changed. */
async function expectUntouched() {
  expect(await row(trash)).toMatchObject({
    name: TRASH.name,
    archivedAt: null,
  });
  expect(await row(dishes)).toMatchObject({ name: DISHES.name });
  expect(await weights(trash)).toHaveLength(1);
  expect(await weights(dishes)).toHaveLength(1);
  expect(await audits()).toHaveLength(0);
}

describe("update_bounties", () => {
  it("saves every field of many bounties at once, with one audit row", async () => {
    const data = ok(
      await run([
        {
          choreId: trash,
          name: "Bins",
          kind: "consumable",
          points: BASE_POINTS_MAX,
          cooldownHours: 36,
          proofMode: "required",
          effortFactorPct: EFFORT_FACTOR_MAX,
        },
        { choreId: dishes, proofMode: "optional" },
        { choreId: bathroom, archived: true },
      ]),
    );
    expect(data.changed).toEqual([
      { choreId: trash, name: "Bins", archived: false, weightChanged: true },
      {
        choreId: dishes,
        name: DISHES.name,
        archived: false,
        weightChanged: false,
      },
      {
        choreId: bathroom,
        name: BATHROOM.name,
        archived: true,
        weightChanged: false,
      },
    ]);
    expect(await row(trash)).toMatchObject({
      name: "Bins",
      kind: "consumable",
      proofMode: "required",
      effortFactorPct: EFFORT_FACTOR_MAX,
    });
    expect(await weights(trash)).toContainEqual({
      base: BASE_POINTS_MAX,
      cooldown: 36 * 60,
    });
    expect(await row(dishes)).toMatchObject({ proofMode: "optional" });
    expect(await weights(dishes)).toHaveLength(1);
    expect((await row(bathroom)).archivedAt).not.toBeNull();

    const [audit, ...more] = await audits();
    expect(more).toHaveLength(0);
    expect(audit).toMatchObject({
      entity: "chore",
      entityId: null,
      actorMemberId: admin,
      source: "ui",
      // Only the bounties whose settings changed count as edited.
      payload: { edited: [trash, dishes] },
    });
  });

  it("keeps the other half of a weight given only points or a cooldown", async () => {
    ok(
      await run([
        { choreId: trash, points: 7 },
        { choreId: dishes, cooldownHours: 2 },
      ]),
    );
    expect(await weights(trash)).toContainEqual({
      base: 7,
      cooldown: TRASH.cooldownMinutes,
    });
    expect(await weights(dishes)).toContainEqual({
      base: DISHES.basePoints,
      cooldown: 120,
    });
  });

  it("restores and edits an archived bounty in one change, and archives an edited one", async () => {
    await archive(dishes);
    ok(
      await run([
        { choreId: dishes, archived: false, points: 3 },
        { choreId: trash, name: "Old bins", archived: true },
      ]),
    );
    expect(await row(dishes)).toMatchObject({ archivedAt: null });
    expect(await weights(dishes)).toContainEqual({
      base: 3,
      cooldown: DISHES.cooldownMinutes,
    });
    expect(await row(trash)).toMatchObject({ name: "Old bins" });
    expect((await row(trash)).archivedAt).not.toBeNull();
  });

  it("swaps two names, judged on the end state", async () => {
    ok(
      await run([
        { choreId: trash, name: DISHES.name },
        { choreId: dishes, name: TRASH.name },
      ]),
    );
    expect((await row(trash)).name).toBe(DISHES.name);
    expect((await row(dishes)).name).toBe(TRASH.name);
  });

  it("lets an archived bounty keep a name an active one has", async () => {
    await archive(dishes);
    ok(await run([{ choreId: trash, name: DISHES.name }]));
    expect((await row(trash)).name).toBe(DISHES.name);
  });

  it("refuses two rows given the same name, and rolls back the whole batch", async () => {
    await expect(
      run([
        { choreId: trash, name: "Floors", points: 9 },
        { choreId: dishes, name: "FLOORS" },
      ]),
    ).resolves.toEqual({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: "There is already a chore called Floors. Pick another name.",
    });
    await expectUntouched();
  });

  it("refuses a name another active bounty keeps", async () => {
    await expect(
      run([
        { choreId: dishes, points: 4 },
        { choreId: trash, name: BATHROOM.name.toLowerCase() },
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: `There is already a chore called ${BATHROOM.name.toLowerCase()}. Pick another name.`,
    });
    await expectUntouched();
  });

  it("refuses to restore a bounty whose name an active one has taken", async () => {
    await archive(dishes);
    ok(await run([{ choreId: trash, name: DISHES.name }]));
    await expect(
      run([{ choreId: dishes, archived: false }]),
    ).resolves.toMatchObject({ ok: false, code: "CHORE_NAME_TAKEN" });
    expect((await row(dishes)).archivedAt).not.toBeNull();
  });

  it("refuses an edit to an archived bounty that does not restore it, naming it", async () => {
    await archive(dishes);
    await expect(
      run([
        { choreId: trash, points: 4 },
        { choreId: dishes, points: 9 },
      ]),
    ).resolves.toEqual({
      ok: false,
      code: "ARCHIVED_CHORE",
      message: `${DISHES.name} is archived. Restore it to edit it.`,
    });
    await expect(
      run([{ choreId: dishes, archived: true, name: "Still archived" }]),
    ).resolves.toMatchObject({ ok: false, code: "ARCHIVED_CHORE" });
    expect(await weights(trash)).toHaveLength(1);
    expect((await row(dishes)).name).toBe(DISHES.name);
  });

  it("refuses an unknown bounty, rolling back the rows before it", async () => {
    await expect(
      run([
        { choreId: trash, name: "Bins" },
        { choreId: MISSING, points: 4 },
      ]),
    ).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
      message:
        "One of those bounties was not found. Reload the page and try again.",
    });
    await expectUntouched();
  });

  it("asks for both halves of a weight on a bounty with none, rolling back", async () => {
    const [bare] = await t
      .db()
      .insert(chores)
      .values({
        householdId: (await row(trash)).householdId,
        name: "Bare",
        sprite: "bare",
      })
      .returning({ id: chores.id });
    await expect(
      run([
        { choreId: trash, name: "Bins" },
        { choreId: bare!.id, points: 9 },
      ]),
    ).resolves.toMatchObject({
      ok: false,
      code: "NO_RULE_VERSION",
      message: "Bare has no points yet. Give both its points and its cooldown.",
    });
    await expectUntouched();
  });

  it("refuses an empty, repeated, oversized or blank batch, and bad fields", async () => {
    const tooMany = Array.from({ length: BOUNTY_EDITS_MAX + 1 }, (_, i) => ({
      choreId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      points: 1,
    }));
    for (const bad of [
      [],
      tooMany,
      [
        { choreId: trash, points: 4 },
        { choreId: trash, name: "Again" },
      ],
      [{ choreId: trash }],
      [{ choreId: trash, points: BASE_POINTS_MAX + 1 }],
      [{ choreId: trash, kind: "errand" }],
      [{ choreId: trash, confirmMode: "partner" }],
      [{ choreId: "nope", points: 4 }],
    ]) {
      await expect(run(bad)).resolves.toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    await expect(
      run([
        { choreId: trash, points: 4 },
        { choreId: trash, name: "Again" },
      ]),
    ).resolves.toMatchObject({
      issues: [
        {
          path: ["changes", 1, "choreId"],
          message: "Each bounty may be changed only once per save.",
        },
      ],
    });
    await expectUntouched();
  });

  it("is for an admin on the ui and the kiosk only, never Baumy, MCP or brain", async () => {
    const brain: Actor = {
      kind: "service",
      tokenName: "baumy-brain",
      memberId: admin,
      role: "admin",
    };
    for (const ctx of [
      asAdmin({ source: "ai" }),
      ctxFor(brain, { source: "brain" }),
      ctxFor(
        { kind: "mcp", memberId: admin, scopes: ["baumy:write"] },
        { source: "mcp" },
      ),
    ]) {
      await expect(
        run([{ choreId: trash, points: 4 }], ctx),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    await expect(
      run([{ choreId: trash, points: 4 }], ctxFor(sessionActor(member))),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expectUntouched();
  });

  it("on the kiosk, needs an admin picked and their PIN", async () => {
    const change = [{ choreId: trash, points: 4 }];
    // A member with their right PIN is still not an admin.
    await expect(
      run(change, atKiosk(member, "member", PIN)),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Nobody picked.
    await expect(
      run(
        change,
        ctxFor({ kind: "kiosk", deviceId: "d" }, { source: "kiosk" }),
      ),
    ).resolves.toMatchObject({ ok: false });
    // An admin without a PIN, or with a wrong one.
    await expect(run(change, atKiosk(admin, "admin"))).resolves.toMatchObject({
      ok: false,
      code: "ATTESTATION_REQUIRED",
    });
    await expect(
      run(change, atKiosk(admin, "admin", "1111")),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    await expectUntouched();

    // An admin with their PIN saves, audited as a kiosk write by them.
    ok(await run(change, atKiosk(admin, "admin", PIN)));
    expect(await weights(trash)).toContainEqual({
      base: 4,
      cooldown: TRASH.cooldownMinutes,
    });
    const [audit] = await audits();
    expect(audit).toMatchObject({ source: "kiosk", actorMemberId: admin });
    expect(JSON.stringify(audit!.payload)).not.toContain(PIN);
    const [n] = await t.db().select({ n: count() }).from(auditEvents);
    expect(n!.n).toBeGreaterThan(0);
  });
});
