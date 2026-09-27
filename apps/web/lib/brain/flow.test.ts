// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { actionRequests, auditEvents, members } from "@baumy/db/schema";
import {
  BRAIN_SCOPE,
  generateServiceToken,
  insertServiceToken,
  revokeServiceToken,
} from "@baumy/db/service-tokens";
import { insertTelegramLinkCode } from "@baumy/db/telegram-link-codes";
import { useTestDb } from "@baumy/db/test-harness";
import { eq } from "drizzle-orm";
import { seedMember } from "@/test-utils/actions";
import { setCalendarClientForTests } from "@/lib/integrations/calendar";
import {
  clearMemoryCalendar,
  memoryCalendar,
} from "@/lib/integrations/calendar-memory";
import { now } from "@/lib/clock";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { handleBrainAction, handleListActions } from "./endpoint";
import { brainEndpointDeps } from "./wiring";

// The brain endpoint against the real registry, real service tokens and
// real members on PGlite, with the in-memory calendar (issue #27's
// acceptance criteria, in-process). apps/web/e2e/specs/brain-api.spec.ts
// does the same over HTTP against Docker Postgres.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const TG = 5_000_000_301;
const STRANGER_TG = 5_000_000_302;

let token: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  clearMemoryCalendar();
  setCalendarClientForTests(memoryCalendar());
  token = generateServiceToken();
  await insertServiceToken(db(), {
    name: "baumy-brain",
    token,
    scopes: [BRAIN_SCOPE],
    now: now(),
  });
});

afterEach(() => setCalendarClientForTests(null));

function call(
  name: string,
  input: unknown,
  headers: Record<string, string> = {},
) {
  return handleBrainAction(
    new Request(`http://localhost:3000/api/v1/actions/${name}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(input),
    }),
    name,
    brainEndpointDeps(),
  );
}

const tomorrow = () =>
  new Date(now().getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10);

const dinner = () => ({
  title: "Brain dinner",
  kind: "timed",
  date: tomorrow(),
  startTime: "19:00",
  endTime: "20:00",
});

describe("the brain endpoint on PGlite", () => {
  it("creates a confirmed calendar event for a linked member, audited as brain, once per key", async () => {
    const ryan = await seedMember(db(), { telegramUserId: TG });
    const headers = {
      "x-baumy-actor": `tg:${TG}`,
      "idempotency-key": "brain-event-0001",
    };

    const unconfirmed = await call("create_event", dinner(), headers);
    expect(unconfirmed.status).toBe(428);
    expect(await unconfirmed.json()).toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    expect(await t.db().select().from(auditEvents)).toHaveLength(0);

    const confirmed = { ...headers, "x-baumy-confirmed": "1" };
    const res = await call("create_event", dinner(), confirmed);
    expect(res.status).toBe(200);
    const first = (await res.json()) as {
      ok: true;
      data: { event: { id: string; title: string } };
    };
    expect(first.data.event.title).toBe("Brain dinner");
    const audits = await t.db().select().from(auditEvents);
    expect(audits).toMatchObject([
      {
        actorMemberId: ryan,
        source: "brain",
        action: "create_event",
        entity: "calendar_event",
      },
    ]);

    // The same Idempotency-Key again: the stored result, no second event.
    const again = await call("create_event", dinner(), confirmed);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(await t.db().select().from(auditEvents)).toHaveLength(1);
    const listed = await call(
      "list_events",
      { from: tomorrow(), to: tomorrow() },
      { "x-baumy-actor": `tg:${TG}` },
    );
    const { data } = (await listed.json()) as {
      data: { events: { title: string }[] };
    };
    expect(data.events.map((e) => e.title)).toEqual(["Brain dinner"]);

    // Another input under the same key is a conflict, not a second run.
    const conflict = await call(
      "create_event",
      { ...dinner(), title: "Other" },
      confirmed,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("links an unlinked Telegram user with a code; before that, nothing else works", async () => {
    const ryan = await seedMember(db(), { displayName: "Ryan" });
    const actor = { "x-baumy-actor": `tg:${STRANGER_TG}` };

    const before = await call("whoami", {}, actor);
    expect(before.status).toBe(403);
    expect(await before.json()).toMatchObject({ code: "TELEGRAM_NOT_LINKED" });

    await insertTelegramLinkCode(db(), {
      code: "LINKME2345",
      memberId: ryan,
      now: now(),
    });
    const wrong = await call(
      "link_telegram",
      { code: "WRONGCODE2" },
      { ...actor, "idempotency-key": "brain-link-0001" },
    );
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ code: "LINK_CODE_INVALID" });

    const linked = await call(
      "link_telegram",
      { code: "linkme2345" },
      { ...actor, "idempotency-key": "brain-link-0002" },
    );
    expect(linked.status).toBe(200);
    expect(await linked.json()).toEqual({
      ok: true,
      data: { memberId: ryan, displayName: "Ryan" },
    });
    const [row] = await t
      .db()
      .select()
      .from(members)
      .where(eq(members.id, ryan));
    expect(row!.telegramUserId).toBe(STRANGER_TG);

    const me = await call("whoami", {}, actor);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      data: { memberId: ryan, actorKind: "service" },
    });

    // The code is spent.
    const reused = await call(
      "link_telegram",
      { code: "LINKME2345" },
      { "x-baumy-actor": "tg:5000000399", "idempotency-key": "brain-link-3" },
    );
    expect(await reused.json()).toMatchObject({ code: "LINK_CODE_INVALID" });
  });

  it("refuses destructive and admin actions with SURFACE_FORBIDDEN", async () => {
    await seedMember(db(), { telegramUserId: TG, role: "admin" });
    for (const [name, input] of [
      ["delete_event", { eventId: "x" }],
      ["delete_note", { noteId: "00000000-0000-4000-8000-000000000000" }],
      ["manage_members", { op: "deactivate", memberId: "x" }],
      ["mint_invite", {}],
    ] as const) {
      const res = await call(name, input, {
        "x-baumy-actor": `tg:${TG}`,
        "x-baumy-confirmed": "1",
        "idempotency-key": `brain-${name}-01`,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "SURFACE_FORBIDDEN" });
    }
    expect(await t.db().select().from(actionRequests)).toHaveLength(0);
  });

  it("gives a revoked token a 401, on the list and on actions", async () => {
    await seedMember(db(), { telegramUserId: TG });
    const list = () =>
      handleListActions(
        new Request("http://localhost:3000/api/v1/actions", {
          headers: { authorization: `Bearer ${token}` },
        }),
        brainEndpointDeps(),
      );
    expect((await list()).status).toBe(200);
    expect(
      (await call("whoami", {}, { "x-baumy-actor": `tg:${TG}` })).status,
    ).toBe(200);

    await revokeServiceToken(db(), { name: "baumy-brain", now: now() });
    expect((await list()).status).toBe(401);
    const res = await call("whoami", {}, { "x-baumy-actor": `tg:${TG}` });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("stops mapping a member once they are deactivated", async () => {
    await seedMember(db(), { telegramUserId: TG, deactivatedAt: now() });
    const res = await call("whoami", {}, { "x-baumy-actor": `tg:${TG}` });
    expect(res.status).toBe(403);
  });
});
