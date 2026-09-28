// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  actionRequests,
  auditEvents,
  choreRuleVersions,
  chores,
  completions,
  households,
  members,
} from "@baumy/db/schema";
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

  it("deletes a note and an event only once the person confirmed it", async () => {
    const ryan = await seedMember(db(), { telegramUserId: TG });
    const actor = { "x-baumy-actor": `tg:${TG}` };
    const note = await call(
      "create_note",
      { title: "Wifi" },
      { ...actor, "idempotency-key": "brain-note-0001" },
    );
    const noteId = ((await note.json()) as { data: { note: { id: string } } })
      .data.note.id;
    const event = await call("create_event", dinner(), {
      ...actor,
      "x-baumy-confirmed": "1",
      "idempotency-key": "brain-event-0002",
    });
    const eventId = (
      (await event.json()) as { data: { event: { id: string } } }
    ).data.event.id;

    for (const [name, input] of [
      ["delete_note", { noteId }],
      ["delete_event", { eventId }],
    ] as const) {
      const headers = { ...actor, "idempotency-key": `brain-${name}-0001` };
      const unconfirmed = await call(name, input, headers);
      expect(unconfirmed.status).toBe(428);
      const res = await call(name, input, {
        ...headers,
        "x-baumy-confirmed": "1",
      });
      expect(res.status).toBe(200);
    }
    const notes = await call("list_notes", {}, actor);
    expect(
      ((await notes.json()) as { data: { notes: unknown[] } }).data.notes,
    ).toEqual([]);
    const audits = await t.db().select().from(auditEvents);
    expect(audits.map((a) => [a.action, a.actorMemberId, a.source])).toEqual(
      expect.arrayContaining([
        ["delete_note", ryan, "brain"],
        ["delete_event", ryan, "brain"],
      ]),
    );
  });

  it("refuses admin actions with SURFACE_FORBIDDEN", async () => {
    await seedMember(db(), { telegramUserId: TG, role: "admin" });
    for (const [name, input] of [
      ["manage_members", { op: "deactivate", memberId: "x" }],
      ["mint_invite", {}],
      ["schedule_weight", { suggestionId: "x" }],
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

  it("acts for a housemate on the asker's behalf, audited with both", async () => {
    const ryan = await seedMember(db(), {
      telegramUserId: TG,
      displayName: "Ryan",
    });
    const jo = await seedMember(db(), { displayName: "Jo" });
    const actor = { "x-baumy-actor": `tg:${TG}` };
    const posted = await call(
      "create_reminder",
      { title: "Plumber Wednesday" },
      { ...actor, "idempotency-key": "brain-rem-0001" },
    );
    const { reminderId } = (
      (await posted.json()) as { data: { reminderId: string } }
    ).data;
    const forJo = {
      ...actor,
      "x-baumy-on-behalf-of": jo,
      "idempotency-key": "brain-ack-0001",
    };

    // Safe for Jo herself, but done for her it needs the asker's tap.
    const unconfirmed = await call(
      "acknowledge_reminder",
      { reminderId },
      forJo,
    );
    expect(unconfirmed.status).toBe(428);
    const res = await call(
      "acknowledge_reminder",
      { reminderId },
      { ...forJo, "x-baumy-confirmed": "1" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { reminderId, memberId: jo },
    });

    const listed = await call("list_reminders", {}, actor);
    const { data } = (await listed.json()) as {
      data: { reminders: { seenBy: string[] }[] };
    };
    expect(data.reminders[0]!.seenBy).toEqual([jo]);

    const audits = await t.db().select().from(auditEvents);
    expect(
      audits.map((a) => ({
        action: a.action,
        actor: a.actorMemberId,
        initiator: a.initiatedByMemberId,
        source: a.source,
      })),
    ).toEqual([
      {
        action: "create_reminder",
        actor: ryan,
        initiator: null,
        source: "brain",
      },
      {
        action: "acknowledge_reminder",
        actor: jo,
        initiator: ryan,
        source: "brain",
      },
    ]);

    // A read on her behalf needs no tap: whoami answers as Jo.
    const who = await call(
      "whoami",
      {},
      { ...actor, "x-baumy-on-behalf-of": jo },
    );
    expect(await who.json()).toMatchObject({ data: { memberId: jo } });
  });

  it("never confirms, disputes, undoes, withdraws or concedes a claim on someone's behalf", async () => {
    const ryan = await seedMember(db(), { telegramUserId: TG });
    const jo = await seedMember(db(), { displayName: "Jo" });
    const [chore] = await t
      .db()
      .insert(chores)
      .values({
        householdId: HOUSEHOLD_ID,
        name: "Partner chore",
        sprite: "partner-chore",
        confirmMode: "partner",
      })
      .returning({ id: chores.id });
    await t
      .db()
      .insert(choreRuleVersions)
      .values({
        choreId: chore!.id,
        basePoints: 10,
        cooldownMinutes: 60,
        effectiveFrom: new Date(now().getTime() - 24 * 60 * 60_000),
        source: "manual",
      });
    const actor = { "x-baumy-actor": `tg:${TG}` };
    const logged = await call(
      "log_completion",
      { choreId: chore!.id },
      {
        ...actor,
        "x-baumy-confirmed": "1",
        "idempotency-key": "brain-log-0001",
      },
    );
    expect(logged.status).toBe(200);
    const { completionId, counted } = (
      (await logged.json()) as {
        data: { completionId: string; counted: boolean };
      }
    ).data;
    expect(counted).toBe(false);

    for (const [name, input] of [
      ["confirm_completion", { completionId }],
      ["dispute_completion", { completionId, reason: "Not done" }],
      ["undo_completion", { completionId }],
      ["withdraw_dispute", { completionId }],
      ["concede_completion", { completionId }],
    ] as const) {
      const res = await call(name, input, {
        ...actor,
        "x-baumy-on-behalf-of": jo,
        "x-baumy-confirmed": "1",
        "idempotency-key": `brain-${name}-behalf`,
      });
      expect(res.status, name).toBe(403);
      expect(await res.json()).toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("Only that housemate"),
      });
    }
    const [row] = await t
      .db()
      .select()
      .from(completions)
      .where(eq(completions.id, completionId));
    expect(row!.status).toBe("pending");
    const audits = await t.db().select().from(auditEvents);
    expect(audits.map((a) => a.action)).toEqual(["log_completion"]);
    expect(audits[0]!.actorMemberId).toBe(ryan);
  });

  it("records the initiator on a non-transactional write done on someone's behalf", async () => {
    const ryan = await seedMember(db(), { telegramUserId: TG });
    const jo = await seedMember(db(), { displayName: "Jo" });
    const actor = { "x-baumy-actor": `tg:${TG}` };
    const event = await call("create_event", dinner(), {
      ...actor,
      "x-baumy-confirmed": "1",
      "idempotency-key": "brain-event-0003",
    });
    const eventId = (
      (await event.json()) as { data: { event: { id: string } } }
    ).data.event.id;
    const res = await call(
      "delete_event",
      { eventId },
      {
        ...actor,
        "x-baumy-on-behalf-of": jo,
        "x-baumy-confirmed": "1",
        "idempotency-key": "brain-delete-behalf-1",
      },
    );
    expect(res.status).toBe(200);
    const [row] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete_event"));
    expect(row).toMatchObject({
      actorMemberId: jo,
      initiatedByMemberId: ryan,
      source: "brain",
      entityId: eventId,
    });
  });

  it("refuses a target who is unknown, deactivated or in another household", async () => {
    await seedMember(db(), { telegramUserId: TG });
    const gone = await seedMember(db(), { deactivatedAt: now() });
    const [other] = await t
      .db()
      .insert(households)
      .values({ name: "Next door" })
      .returning({ id: households.id });
    const neighbour = await seedMember(db(), { householdId: other!.id });
    for (const target of [
      "00000000-0000-4000-8000-000000000000",
      gone,
      neighbour,
    ]) {
      const res = await call(
        "create_note",
        { title: "Hi" },
        {
          "x-baumy-actor": `tg:${TG}`,
          "x-baumy-on-behalf-of": target,
          "x-baumy-confirmed": "1",
          "idempotency-key": `brain-behalf-${target.slice(0, 8)}`,
        },
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await t.db().select().from(auditEvents)).toHaveLength(0);
  });

  it("offers a member's weight reads and veto to brain", async () => {
    await seedMember(db(), { telegramUserId: TG });
    const res = await call(
      "get_weights",
      { scheduledOnly: true },
      { "x-baumy-actor": `tg:${TG}` },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { scheduled: [] } });
    const veto = await call(
      "veto_weight",
      { suggestionId: "00000000-0000-4000-8000-000000000000" },
      {
        "x-baumy-actor": `tg:${TG}`,
        "x-baumy-confirmed": "1",
        "idempotency-key": "brain-veto-0001",
      },
    );
    expect(veto.status).toBe(404);
    expect(await veto.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("stops mapping a member once they are deactivated", async () => {
    await seedMember(db(), { telegramUserId: TG, deactivatedAt: now() });
    const res = await call("whoami", {}, { "x-baumy-actor": `tg:${TG}` });
    expect(res.status).toBe(403);
  });
});
