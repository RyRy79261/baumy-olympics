// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { actionRequests, auditEvents, notes } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import type { NoteView } from "./notes";
import { REGISTRY, runAction } from "./registry";

// The note actions through the real runAction on PGlite (issue #20):
// list_notes, create_note, update_note, pin_note and delete_note. Success,
// every error code, the surfaces, and the permissions: any member may change
// any note, the kiosk needs the acting member's PIN for every change, and
// delete never reaches MCP or brain.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "2580";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

const MIN = 60_000;
const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * MIN);

let ryan: string;
let partner: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan", kioskPinHash: pinHash });
  partner = await seedMember(db(), { displayName: "Partner" });
});

const as = (member: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(member), over);

function kiosk(memberId: string, pin?: string): RequestCtx {
  const actor: Actor = {
    kind: "kiosk",
    deviceId: "dev-1",
    memberId,
    displayName: "Ryan",
  };
  return ctxFor(actor, { source: "kiosk", ...(pin ? { pin } : {}) });
}
const mcp = (memberId: string, scopes: string[]): RequestCtx =>
  ctxFor({ kind: "mcp", memberId, scopes }, { source: "mcp" });
const brain = (memberId: string): RequestCtx =>
  ctxFor(
    { kind: "service", tokenName: "baumy-brain", memberId },
    { source: "brain" },
  );

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

async function add(
  title: string,
  extra: Record<string, unknown> = {},
  ctx: RequestCtx = as(ryan),
): Promise<NoteView> {
  return ok(await runAction("create_note", { title, ...extra }, ctx)).note;
}

async function audits(noteId: string) {
  return t
    .db()
    .select()
    .from(auditEvents)
    .where(
      and(eq(auditEvents.entity, "note"), eq(auditEvents.entityId, noteId)),
    );
}

describe("create_note", () => {
  it("adds a note by the member, audited, and replays a retry", async () => {
    const ctx = as(ryan);
    const input = {
      title: "  Wifi  ",
      bodyMd: "Guest: **baumy-guest**",
      color: "blue",
      pinned: "on",
    };
    const first = ok(await runAction("create_note", input, ctx));
    expect(first.note).toMatchObject({
      title: "Wifi",
      bodyMd: "Guest: **baumy-guest**",
      color: "blue",
      pinned: true,
      authorId: ryan,
      authorName: "Ryan",
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });
    const rows = await audits(first.note.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorMemberId: ryan,
      source: "ui",
      action: "create_note",
    });
    // The same request again: the stored result, and no second note.
    expect(ok(await runAction("create_note", input, ctx))).toEqual(first);
    expect(await t.db().select().from(notes)).toHaveLength(1);
  });

  it("defaults to a plain, unpinned, empty note", async () => {
    expect(await add("Bins")).toMatchObject({
      bodyMd: "",
      color: null,
      pinned: false,
    });
  });

  it("refuses a note with no title", async () => {
    expect(
      await runAction("create_note", { title: "  " }, as(ryan)),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["title"], message: "Give the note a title." }],
    });
    expect(await t.db().select().from(notes)).toHaveLength(0);
  });

  it("needs the acting member's PIN on the kiosk", async () => {
    expect(
      await runAction("create_note", { title: "Hi" }, kiosk(ryan)),
    ).toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    expect(
      await runAction("create_note", { title: "Hi" }, kiosk(ryan, "0000")),
    ).toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    expect(await t.db().select().from(notes)).toHaveLength(0);
    const note = await add("Hi", {}, kiosk(ryan, PIN));
    expect(note.authorId).toBe(ryan);
    const [audit] = await audits(note.id);
    expect(audit).toMatchObject({ source: "kiosk", actorMemberId: ryan });
    // The PIN is request metadata: it never reaches the ledger or the audit.
    expect(JSON.stringify(audit!.payload)).not.toContain(PIN);
  });

  it("works from MCP with the write scope, and from brain", async () => {
    expect(
      await runAction(
        "create_note",
        { title: "Hi" },
        mcp(ryan, ["baumy:read"]),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await add("From Claude", {}, mcp(ryan, ["baumy:read", "baumy:write"]));
    await add("From Telegram", {}, brain(partner));
    const listed = ok(await runAction("list_notes", {}, as(ryan)));
    expect(listed.notes.map((n) => n.authorName).sort()).toEqual([
      "Partner",
      "Ryan",
    ]);
  });

  it("is for household members only", async () => {
    expect(
      await runAction(
        "create_note",
        { title: "Hi" },
        ctxFor(accountActor("u")),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("previews what it will add", async () => {
    const ctx = { ...as(ryan), db: db() };
    expect(await REGISTRY.create_note.preview!(ctx, { title: "Wifi" })).toBe(
      'Add the note "Wifi"',
    );
    expect(
      await REGISTRY.create_note.preview!(ctx, { title: "Wifi", pinned: true }),
    ).toBe('Add the note "Wifi" and pin it');
  });
});

describe("list_notes", () => {
  it("lists pinned first, then the latest change, with authors", async () => {
    const old = await add("Old", {}, as(ryan, { now: at(0) }));
    const fresh = await add("Fresh", {}, as(partner, { now: at(5) }));
    const pinned = await add(
      "Pinned",
      { pinned: true },
      as(ryan, { now: at(-60) }),
    );
    const all = ok(await runAction("list_notes", {}, as(ryan)));
    expect(all.notes.map((n) => n.id)).toEqual([pinned.id, fresh.id, old.id]);
    expect(all.notes[1]).toMatchObject({
      authorId: partner,
      authorName: "Partner",
    });
    const onlyPinned = ok(
      await runAction("list_notes", { pinnedOnly: true }, as(ryan)),
    );
    expect(onlyPinned.notes.map((n) => n.id)).toEqual([pinned.id]);
    const limited = ok(await runAction("list_notes", { limit: 2 }, as(ryan)));
    expect(limited.notes).toHaveLength(2);
  });

  it("is offered on every surface", async () => {
    await add("Wifi");
    for (const ctx of [
      as(ryan),
      kiosk(ryan),
      mcp(ryan, ["baumy:read"]),
      brain(ryan),
      ctxFor(sessionActor(ryan), { source: "ai" }),
    ]) {
      expect(ok(await runAction("list_notes", {}, ctx)).notes).toHaveLength(1);
    }
  });
});

describe("update_note", () => {
  it("lets any member rewrite any note, replacing every field", async () => {
    const note = await add("Plumber", { bodyMd: "Tue", color: "pink" });
    const r = ok(
      await runAction(
        "update_note",
        { noteId: note.id, title: "Plumber Wed" },
        as(partner, { now: at(3) }),
      ),
    );
    expect(r.note).toMatchObject({
      id: note.id,
      title: "Plumber Wed",
      bodyMd: "",
      color: null,
      // The author stays the one who wrote it.
      authorId: ryan,
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: at(3).toISOString(),
    });
    expect((await audits(note.id)).map((a) => a.action)).toEqual([
      "create_note",
      "update_note",
    ]);
  });

  it("does not change the pin", async () => {
    const note = await add("Wifi", { pinned: true });
    const r = ok(
      await runAction(
        "update_note",
        { noteId: note.id, title: "Wifi", color: "green" },
        as(ryan),
      ),
    );
    expect(r.note).toMatchObject({ pinned: true, color: "green" });
  });

  it("says NOT_FOUND for a deleted or unknown note", async () => {
    const note = await add("Gone");
    ok(await runAction("delete_note", { noteId: note.id }, as(ryan)));
    expect(
      await runAction(
        "update_note",
        { noteId: note.id, title: "Back?" },
        as(ryan),
      ),
    ).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "That note is not there any more.",
    });
    expect(
      await runAction(
        "update_note",
        { noteId: "7d6f1c2e-5b4a-4c3d-9e8f-0a1b2c3d4e5f", title: "x" },
        as(ryan),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // A refused write leaves no claim behind: the ledger rolled back.
    const claims = await t
      .db()
      .select()
      .from(actionRequests)
      .where(eq(actionRequests.action, "update_note"));
    expect(claims).toEqual([]);
  });

  it("needs the PIN on the kiosk", async () => {
    const note = await add("Wifi");
    expect(
      await runAction(
        "update_note",
        { noteId: note.id, title: "Wifi 2" },
        kiosk(ryan),
      ),
    ).toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    expect(
      ok(
        await runAction(
          "update_note",
          { noteId: note.id, title: "Wifi 2" },
          kiosk(ryan, PIN),
        ),
      ).note.title,
    ).toBe("Wifi 2");
  });

  it("previews the change", async () => {
    const note = await add("Plumber");
    const ctx = { ...as(ryan), db: db() };
    expect(
      await REGISTRY.update_note.preview!(ctx, {
        noteId: note.id,
        title: "Plumber Wed",
      }),
    ).toBe('Change the note "Plumber" to "Plumber Wed"');
    expect(
      await REGISTRY.update_note.preview!(ctx, {
        noteId: note.id,
        title: "Plumber",
      }),
    ).toBe('Change the note "Plumber"');
  });
});

describe("pin_note", () => {
  it("pins and unpins, and a freshly pinned note comes first", async () => {
    const a = await add("A", { pinned: true }, as(ryan, { now: at(0) }));
    const b = await add("B", {}, as(ryan, { now: at(1) }));
    const pinned = ok(
      await runAction(
        "pin_note",
        { noteId: b.id, pinned: "true" },
        as(partner, { now: at(2) }),
      ),
    );
    expect(pinned.note).toMatchObject({ id: b.id, pinned: true });
    const listed = ok(
      await runAction("list_notes", { pinnedOnly: true }, as(ryan)),
    );
    expect(listed.notes.map((n) => n.id)).toEqual([b.id, a.id]);
    const unpinned = ok(
      await runAction(
        "pin_note",
        { noteId: a.id, pinned: false },
        as(ryan, { now: at(3) }),
      ),
    );
    expect(unpinned.note.pinned).toBe(false);
    expect(
      ok(await runAction("list_notes", { pinnedOnly: true }, as(ryan))).notes,
    ).toHaveLength(1);
  });

  it("says NOT_FOUND for a deleted note", async () => {
    const note = await add("Gone");
    ok(await runAction("delete_note", { noteId: note.id }, as(ryan)));
    expect(
      await runAction("pin_note", { noteId: note.id, pinned: true }, as(ryan)),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("needs the PIN on the kiosk", async () => {
    const note = await add("Wifi");
    expect(
      await runAction(
        "pin_note",
        { noteId: note.id, pinned: true },
        kiosk(ryan),
      ),
    ).toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    expect(
      ok(
        await runAction(
          "pin_note",
          { noteId: note.id, pinned: true },
          kiosk(ryan, PIN),
        ),
      ).note.pinned,
    ).toBe(true);
  });

  it("previews pin and unpin", async () => {
    const note = await add("Wifi");
    const ctx = { ...as(ryan), db: db() };
    expect(
      await REGISTRY.pin_note.preview!(ctx, { noteId: note.id, pinned: true }),
    ).toBe('Pin "Wifi" to the hub');
    expect(
      await REGISTRY.pin_note.preview!(ctx, {
        noteId: "7d6f1c2e-5b4a-4c3d-9e8f-0a1b2c3d4e5f",
        pinned: false,
      }),
    ).toBe("Unpin the note");
  });
});

describe("delete_note", () => {
  it("soft-deletes: the row stays, every read leaves it out", async () => {
    const note = await add("Wifi", { pinned: true });
    const r = ok(
      await runAction(
        "delete_note",
        { noteId: note.id },
        as(partner, { now: at(1) }),
      ),
    );
    expect(r).toEqual({ noteId: note.id, title: "Wifi" });
    const [row] = await t
      .db()
      .select()
      .from(notes)
      .where(eq(notes.id, note.id));
    expect(row!.deletedAt).toEqual(at(1));
    expect(ok(await runAction("list_notes", {}, as(ryan))).notes).toEqual([]);
    const [, audit] = await audits(note.id);
    expect(audit).toMatchObject({
      action: "delete_note",
      actorMemberId: partner,
      payload: { noteId: note.id, title: "Wifi" },
    });
  });

  it("says NOT_FOUND the second time", async () => {
    const note = await add("Wifi");
    ok(await runAction("delete_note", { noteId: note.id }, as(ryan)));
    expect(
      await runAction("delete_note", { noteId: note.id }, as(ryan)),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("is never offered over MCP or to brain", async () => {
    const note = await add("Wifi");
    for (const ctx of [mcp(ryan, ["baumy:read", "baumy:write"]), brain(ryan)]) {
      expect(
        await runAction("delete_note", { noteId: note.id }, ctx),
      ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    expect(ok(await runAction("list_notes", {}, as(ryan))).notes).toHaveLength(
      1,
    );
  });

  it("needs the PIN on the kiosk", async () => {
    const note = await add("Wifi");
    expect(
      await runAction("delete_note", { noteId: note.id }, kiosk(ryan)),
    ).toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    ok(await runAction("delete_note", { noteId: note.id }, kiosk(ryan, PIN)));
  });

  it("previews which note goes", async () => {
    const note = await add("Wifi");
    const ctx = { ...as(ryan), db: db() };
    expect(await REGISTRY.delete_note.preview!(ctx, { noteId: note.id })).toBe(
      'Delete the note "Wifi"',
    );
    ok(await runAction("delete_note", { noteId: note.id }, as(ryan)));
    expect(await REGISTRY.delete_note.preview!(ctx, { noteId: note.id })).toBe(
      "Delete the note (already gone)",
    );
  });

  it("needs a request id like every write", async () => {
    const note = await add("Wifi");
    expect(
      await runAction(
        "delete_note",
        { noteId: note.id },
        { ...as(ryan), requestId: undefined },
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
