// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { auditEvents, members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { SURFACES } from "@baumy/types";
import {
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { runAction } from "./registry";

// The first two real actions, through the real runAction (rate limits counted
// in PGlite): success, each error code, and the surface and permission rules.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const MISSING = "00000000-0000-4000-8000-00000000dead";

beforeEach(() => __resetMemoryRateLimits());

describe("whoami", () => {
  it("returns the acting member", async () => {
    const me = await seedMember(db(), {
      displayName: "Ryan",
      role: "admin",
      color: "#112233",
      avatarSprite: "fox",
    });
    const res = await runAction(
      "whoami",
      {},
      ctxFor(sessionActor(me, "admin")),
    );
    expect(res).toEqual({
      ok: true,
      data: {
        memberId: me,
        displayName: "Ryan",
        role: "admin",
        color: "#112233",
        avatarSprite: "fox",
        actorKind: "member",
      },
    });
  });

  it("works on every surface, for the kiosk's picked member and an MCP token", async () => {
    const me = await seedMember(db());
    for (const source of SURFACES) {
      const res = await runAction(
        "whoami",
        {},
        ctxFor(sessionActor(me), { source }),
      );
      expect(res.ok).toBe(true);
    }
    const kiosk = await runAction(
      "whoami",
      {},
      ctxFor(kioskActor(me), { source: "kiosk" }),
    );
    expect(kiosk).toMatchObject({
      ok: true,
      data: { memberId: me, actorKind: "kiosk" },
    });
    const mcp = await runAction(
      "whoami",
      {},
      ctxFor(
        { kind: "mcp", memberId: me, scopes: ["baumy:read"] },
        { source: "mcp" },
      ),
    );
    expect(mcp).toMatchObject({ ok: true, data: { actorKind: "mcp" } });
  });

  it("is FORBIDDEN without a member, INVALID_INPUT with input, NOT_FOUND for a missing row", async () => {
    await expect(
      runAction("whoami", {}, ctxFor(sessionActor(undefined))),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    const me = await seedMember(db());
    await expect(
      runAction("whoami", { who: "me" }, ctxFor(sessionActor(me))),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(
      runAction("whoami", {}, ctxFor(sessionActor(MISSING))),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("writes no audit row", async () => {
    const me = await seedMember(db());
    await runAction("whoami", {}, ctxFor(sessionActor(me)));
    expect(await t.db().select().from(auditEvents)).toHaveLength(0);
  });
});

describe("update_my_profile", () => {
  async function row(id: string) {
    const [r] = await t.db().select().from(members).where(eq(members.id, id));
    return r!;
  }

  it("changes the name and colour, and audits the change once", async () => {
    const me = await seedMember(db(), { displayName: "Old", color: "#000000" });
    const ctx = ctxFor(sessionActor(me));
    const res = await runAction(
      "update_my_profile",
      { displayName: "  Ryan  ", color: "#AABBCC" },
      ctx,
    );
    expect(res).toEqual({
      ok: true,
      data: { memberId: me, displayName: "Ryan", color: "#aabbcc" },
    });
    expect(await row(me)).toMatchObject({
      displayName: "Ryan",
      color: "#aabbcc",
    });
    const audits = await t.db().select().from(auditEvents);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorMemberId: me,
      source: "ui",
      action: "update_my_profile",
      entity: "member",
      entityId: me,
      payload: { displayName: "Ryan", color: "#aabbcc" },
    });

    // A replay changes nothing more.
    await runAction(
      "update_my_profile",
      { displayName: "Ryan", color: "#aabbcc" },
      ctx,
    );
    expect(await t.db().select().from(auditEvents)).toHaveLength(1);
  });

  it("changes one field and leaves the other", async () => {
    const me = await seedMember(db(), { displayName: "Old", color: "#000000" });
    await runAction(
      "update_my_profile",
      { color: "#123456" },
      ctxFor(sessionActor(me)),
    );
    expect(await row(me)).toMatchObject({
      displayName: "Old",
      color: "#123456",
    });
  });

  it("returns INVALID_INPUT with per-field issues", async () => {
    const me = await seedMember(db(), { displayName: "Old" });
    const cases: [unknown, string][] = [
      [{}, ""],
      [{ displayName: "   " }, "displayName"],
      [{ displayName: "x".repeat(41) }, "displayName"],
      [{ color: "red" }, "color"],
      [{ color: "#123456", memberId: MISSING }, ""],
    ];
    for (const [input, field] of cases) {
      const res = await runAction(
        "update_my_profile",
        input,
        ctxFor(sessionActor(me)),
      );
      expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      if (res.ok) continue;
      expect(res.issues?.map((i) => String(i.path[0] ?? ""))).toContain(field);
    }
    expect((await row(me)).displayName).toBe("Old");
  });

  it("is offered on the ui only", async () => {
    const me = await seedMember(db());
    for (const source of ["kiosk", "ai", "mcp", "brain"] as const) {
      await expect(
        runAction(
          "update_my_profile",
          { displayName: "X" },
          ctxFor(sessionActor(me), { source }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
  });

  it("needs a real session: a kiosk, MCP or brain actor is FORBIDDEN", async () => {
    const me = await seedMember(db(), { displayName: "Old" });
    const actors = [
      kioskActor(me),
      {
        kind: "mcp" as const,
        memberId: me,
        scopes: ["baumy:read", "baumy:write"],
      },
      { kind: "service" as const, tokenName: "baumy-brain", memberId: me },
      sessionActor(undefined),
    ];
    for (const actor of actors) {
      await expect(
        runAction(
          "update_my_profile",
          { displayName: "X" },
          ctxFor(actor, { pin: "1234" }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await row(me)).displayName).toBe("Old");
  });

  it("fails closed, writing nothing, for a member id with no row", async () => {
    // The ledger's foreign key refuses the claim before execute runs, so the
    // caller gets the generic INTERNAL and the log gets the detail.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runAction(
      "update_my_profile",
      { displayName: "X" },
      ctxFor(sessionActor(MISSING)),
    );
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(await t.db().select().from(auditEvents)).toHaveLength(0);
    error.mockRestore();
  });
});
