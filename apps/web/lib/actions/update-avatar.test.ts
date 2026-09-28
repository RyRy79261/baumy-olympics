// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { auditEvents, members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  accountActor,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { runAction } from "./registry";

// update_avatar (ADR 0005 §5, issue #63): a member chooses their own 16-bit
// character from their own session, and nowhere else.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const CHOSEN = {
  hairStyle: "spiky",
  hairColor: "auburn",
  skinTone: "brown",
  shirtColor: "teal",
};

let ryan: string;
beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan" });
});

async function stored(id: string) {
  const [row] = await t
    .db()
    .select({ avatar: members.avatar })
    .from(members)
    .where(eq(members.id, id));
  return row!.avatar;
}

describe("update_avatar", () => {
  it("stores the member's own character, audited", async () => {
    expect(await stored(ryan)).toBeNull();
    const r = await runAction(
      "update_avatar",
      CHOSEN,
      ctxFor(sessionActor(ryan)),
    );
    expect(r).toEqual({ ok: true, data: { memberId: ryan, avatar: CHOSEN } });
    expect(await stored(ryan)).toEqual(CHOSEN);
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      action: "update_avatar",
      entity: "member",
      entityId: ryan,
      actorMemberId: ryan,
    });
  });

  it("refuses an option the art does not have, naming the field", async () => {
    expect(
      await runAction(
        "update_avatar",
        { ...CHOSEN, shirtColor: "plaid" },
        ctxFor(sessionActor(ryan)),
      ),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [
        { path: ["shirtColor"], message: "Pick one of the shirt colours." },
      ],
    });
    expect(await stored(ryan)).toBeNull();
  });

  it("is only from the member's own session: not the kiosk, the AI or an account without a member", async () => {
    expect(
      await runAction(
        "update_avatar",
        CHOSEN,
        ctxFor(kioskActor(ryan), { source: "kiosk" }),
      ),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(
      await runAction(
        "update_avatar",
        CHOSEN,
        ctxFor(sessionActor(ryan), { source: "ai" }),
      ),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(
      await runAction("update_avatar", CHOSEN, ctxFor(accountActor("u"))),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await stored(ryan)).toBeNull();
  });

  it("is NOT_FOUND when the member row has gone", async () => {
    const ghost = "6f1c1e8e-3a57-4c1b-9d8e-0f1f2a3b4c5d";
    expect(
      await runAction("update_avatar", CHOSEN, ctxFor(sessionActor(ghost))),
    ).toMatchObject({ ok: false });
  });
});
