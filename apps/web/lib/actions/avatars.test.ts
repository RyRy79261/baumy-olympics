// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { avatars, auditEvents, members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { avatarPathname } from "@/lib/avatars/paths";
import { photoProxyUrl } from "@/lib/photos/paths";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { PNG_DATA_URL } from "./avatars";
import { runAction } from "./registry";

// The avatar gallery's actions (issue #111): the admin cleans and adds
// characters, archives and restores them; a member picks one, or one on
// /join.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

let admin: string;
let ryan: string;
beforeEach(async () => {
  __resetMemoryRateLimits();
  admin = await seedMember(db(), { displayName: "Admin", role: "admin" });
  ryan = await seedMember(db(), { displayName: "Ryan" });
});

const adminCtx = (over = {}) => ctxFor(sessionActor(admin, "admin"), over);

/** A green square with a 4×6 sprite in it, blown up 4×. */
async function upload(): Promise<Uint8Array> {
  const sprite = await sharp({
    create: { width: 16, height: 24, channels: 3, background: "#c2416b" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#00ff00" },
    })
      .composite([{ input: sprite, left: 24, top: 20 }])
      .png()
      .toBuffer(),
  );
}

function stored(id = randomUUID()) {
  return {
    avatarId: id,
    pathname: avatarPathname(id, "a1b2c3d4e5f60718"),
    width: 1,
    height: 1,
  };
}

async function addOne(name = "Knight") {
  const image = stored();
  const r = await runAction(
    "add_avatar",
    { name },
    adminCtx({ avatarImage: image }),
  );
  expect(r.ok).toBe(true);
  return image.avatarId;
}

async function wearing(memberId: string) {
  const [row] = await t
    .db()
    .select({ id: members.avatarImageId })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.id ?? null;
}

describe("preview_avatar", () => {
  it("cleans the uploaded image for an admin and keeps nothing", async () => {
    const r = await runAction(
      "preview_avatar",
      {},
      adminCtx({ avatarUpload: { bytes: await upload() } }),
    );
    // One flat colour: the largest grid that fits is 8px, so 2 × 3.
    expect(r).toMatchObject({ ok: true, data: { width: 2, height: 3 } });
    if (!r.ok) return;
    expect(r.data.preview.startsWith(PNG_DATA_URL)).toBe(true);
    expect(await t.db().select().from(avatars)).toEqual([]);
  });

  it("needs an image from the upload route, and a readable one", async () => {
    expect(await runAction("preview_avatar", {}, adminCtx())).toMatchObject({
      ok: false,
      code: "AVATAR_IMAGE_MISSING",
    });
    expect(
      await runAction(
        "preview_avatar",
        {},
        adminCtx({ avatarUpload: { bytes: new Uint8Array([1, 2, 3]) } }),
      ),
    ).toMatchObject({
      ok: false,
      code: "AVATAR_IMAGE_UNREADABLE",
      message: "That file could not be read as a PNG, JPEG or WebP image.",
    });
    const blank = new Uint8Array(
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#000" },
      })
        .png()
        .toBuffer(),
    );
    expect(
      await runAction(
        "preview_avatar",
        {},
        adminCtx({ avatarUpload: { bytes: blank } }),
      ),
    ).toMatchObject({ ok: false, code: "AVATAR_IMAGE_UNREADABLE" });
  });

  it("is for admins on the UI only", async () => {
    const bytes = await upload();
    expect(
      await runAction(
        "preview_avatar",
        {},
        ctxFor(sessionActor(ryan), { avatarUpload: { bytes } }),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await runAction(
        "preview_avatar",
        {},
        adminCtx({ source: "ai", avatarUpload: { bytes } }),
      ),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
  });
});

describe("add_avatar", () => {
  it("records the stored sprite under its name, audited", async () => {
    const image = stored();
    const r = await runAction(
      "add_avatar",
      { name: " Knight " },
      adminCtx({ avatarImage: { ...image, width: 28, height: 56 } }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        avatarId: image.avatarId,
        name: "Knight",
        image: { src: photoProxyUrl(image.pathname), width: 28, height: 56 },
      },
    });
    const [row] = await t.db().select().from(avatars);
    expect(row).toMatchObject({
      id: image.avatarId,
      name: "Knight",
      pathname: image.pathname,
      createdBy: admin,
      createdAt: FIXED_NOW,
      archivedAt: null,
    });
    const [audit] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "add_avatar"));
    expect(audit).toMatchObject({
      entity: "avatar",
      entityId: image.avatarId,
      actorMemberId: admin,
    });
  });

  it("needs a sprite the upload route stored, at its own pathname", async () => {
    expect(
      await runAction("add_avatar", { name: "Knight" }, adminCtx()),
    ).toMatchObject({ ok: false, code: "AVATAR_IMAGE_MISSING" });
    const image = stored();
    expect(
      await runAction(
        "add_avatar",
        { name: "Knight" },
        adminCtx({ avatarImage: { ...image, avatarId: randomUUID() } }),
      ),
    ).toMatchObject({ ok: false, code: "AVATAR_IMAGE_MISSING" });
    expect(await t.db().select().from(avatars)).toEqual([]);
  });

  it("refuses a sprite id that is already in the gallery", async () => {
    const id = await addOne();
    expect(
      await runAction(
        "add_avatar",
        { name: "Again" },
        adminCtx({ avatarImage: stored(id) }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("wants a name, and is admin-only on the UI", async () => {
    expect(
      await runAction(
        "add_avatar",
        { name: " " },
        adminCtx({ avatarImage: stored() }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await runAction(
        "add_avatar",
        { name: "Knight" },
        ctxFor(sessionActor(ryan), { avatarImage: stored() }),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await runAction(
        "add_avatar",
        { name: "Knight" },
        ctxFor(kioskActor(admin), { source: "kiosk", avatarImage: stored() }),
      ),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
  });
});

describe("archive_avatar and restore_avatar", () => {
  it("takes a character out of the gallery and puts it back, audited", async () => {
    const id = await addOne();
    expect(
      await runAction("archive_avatar", { avatarId: id }, adminCtx()),
    ).toEqual({
      ok: true,
      data: { avatarId: id, name: "Knight", archived: true },
    });
    expect(
      await runAction("archive_avatar", { avatarId: id }, adminCtx()),
    ).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(
      await runAction("restore_avatar", { avatarId: id }, adminCtx()),
    ).toEqual({
      ok: true,
      data: { avatarId: id, name: "Knight", archived: false },
    });
    expect(
      await runAction("restore_avatar", { avatarId: id }, adminCtx()),
    ).toMatchObject({ ok: false, code: "INVALID_STATE" });
    const audits = await t
      .db()
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, id));
    expect(audits.map((a) => a.action)).toEqual([
      "add_avatar",
      "archive_avatar",
      "restore_avatar",
    ]);
  });

  it("is NOT_FOUND for a character not in the gallery, and admin-only", async () => {
    expect(
      await runAction("archive_avatar", { avatarId: randomUUID() }, adminCtx()),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const id = await addOne();
    expect(
      await runAction(
        "archive_avatar",
        { avatarId: id },
        ctxFor(sessionActor(ryan)),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await runAction(
        "restore_avatar",
        { avatarId: id },
        adminCtx({ source: "mcp" }),
      ),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
  });
});

describe("choose_avatar", () => {
  it("puts a gallery character on the member, and takes it off again", async () => {
    const id = await addOne();
    const r = await runAction(
      "choose_avatar",
      { avatarId: id },
      ctxFor(sessionActor(ryan)),
    );
    expect(r).toMatchObject({
      ok: true,
      data: { memberId: ryan, avatarId: id, image: { width: 1, height: 1 } },
    });
    expect(await wearing(ryan)).toBe(id);
    // Two members may wear the same one.
    expect(
      await runAction(
        "choose_avatar",
        { avatarId: id },
        ctxFor(sessionActor(admin, "admin")),
      ),
    ).toMatchObject({ ok: true });
    expect(await wearing(admin)).toBe(id);

    expect(
      await runAction(
        "choose_avatar",
        { avatarId: "" },
        ctxFor(sessionActor(ryan)),
      ),
    ).toEqual({
      ok: true,
      data: { memberId: ryan, avatarId: null, image: null },
    });
    expect(await wearing(ryan)).toBeNull();
    const [audit] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "choose_avatar"));
    expect(audit).toMatchObject({ entity: "member", entityId: ryan });
  });

  it("refuses an archived character or one not in the gallery", async () => {
    const id = await addOne();
    await runAction("archive_avatar", { avatarId: id }, adminCtx());
    expect(
      await runAction(
        "choose_avatar",
        { avatarId: id },
        ctxFor(sessionActor(ryan)),
      ),
    ).toMatchObject({ ok: false, code: "AVATAR_ARCHIVED" });
    expect(
      await runAction(
        "choose_avatar",
        { avatarId: randomUUID() },
        ctxFor(sessionActor(ryan)),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await wearing(ryan)).toBeNull();
  });

  it("is only from the member's own session", async () => {
    const id = await addOne();
    expect(
      await runAction(
        "choose_avatar",
        { avatarId: id },
        ctxFor(kioskActor(ryan), { source: "kiosk" }),
      ),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(
      await runAction(
        "choose_avatar",
        { avatarId: id },
        ctxFor(accountActor("u_nobody")),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("is NOT_FOUND when the member row has gone", async () => {
    const ghost = "6f1c1e8e-3a57-4c1b-9d8e-0f1f2a3b4c5d";
    expect(
      await runAction(
        "choose_avatar",
        { avatarId: null },
        ctxFor(sessionActor(ghost)),
      ),
    ).toMatchObject({ ok: false });
  });
});
