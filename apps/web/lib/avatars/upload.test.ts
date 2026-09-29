// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestCtx } from "@/lib/actions/define";
import type { ActionResult } from "@/lib/actions/result";
import { PNG_DATA_URL } from "@/lib/actions/avatars";
import {
  memoryBlobStore,
  unconfiguredBlobStore,
  type BlobStore,
} from "@/lib/photos/blob-store";
import type { RateLimiter } from "@/lib/rate-limit";
import { allowAll, ctxFor, sessionActor } from "@/test-utils/actions";
import { AVATAR_UPLOAD_MAX_BYTES, avatarPathname } from "./paths";
import {
  AVATAR_UPLOAD_MAX_REQUEST_BYTES,
  handleAvatarUpload,
  parsePoses,
  type AvatarUploadDeps,
} from "./upload";

// POST /api/uploads/avatar (issue #111): who may upload, what, how often,
// and that only the cleaned poses are stored, as the admin assigned them,
// and only when add_avatar took them. The actions are faked here;
// lib/actions/avatars.test.ts runs them.

const NEW_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NAME = "a1b2c3d4e5f60718";
const PATH = (n: number) => avatarPathname(NEW_ID, `${NAME}${n}`);
const CLEANED = [0, 1, 2].map((n) => new Uint8Array([137, 80, 78, 71, n]));
const figure = (n: number) => ({
  preview: PNG_DATA_URL + Buffer.from(CLEANED[n]!).toString("base64"),
  width: 20 + n,
  height: 64,
});
const PREVIEW = { height: 64, figures: [figure(0), figure(1), figure(2)] };

let store: BlobStore;
let run: ReturnType<typeof vi.fn<AvatarUploadDeps["runAction"]>>;

beforeEach(async () => {
  store = memoryBlobStore();
  for (const n of [0, 1, 2]) await store.del(PATH(n));
  run = vi.fn<AvatarUploadDeps["runAction"]>(async (name, input, ctx) =>
    name === "preview_avatar"
      ? { ok: true, data: PREVIEW }
      : {
          ok: true,
          data: {
            avatarId: ctx.avatarImage!.avatarId,
            name: (input as { name: string }).name,
          },
        },
  );
});

function deps(over: Partial<AvatarUploadDeps> = {}): AvatarUploadDeps {
  return {
    requestCtx: async (requestId) =>
      ctxFor(sessionActor("m1", "admin"), { requestId }),
    runAction: run,
    store,
    rateLimiter: allowAll,
    newAvatarId: () => NEW_ID,
    randomName: () => NAME,
    ...over,
  };
}

const image = (type = "image/png", size = 16) =>
  new File([new Uint8Array(size)], "c.png", { type });

function upload(
  fields: Record<string, string | File | File[]>,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  }
  return new Request("http://localhost/api/uploads/avatar", {
    method: "POST",
    body: form,
    headers,
  });
}

async function storedBytes(pathname: string) {
  const got = await store.get(pathname);
  return got.ok && got.data ? Array.from(got.data.body as Uint8Array) : null;
}

const ref = (n: number) => ({ pathname: PATH(n), width: 20 + n, height: 64 });

describe("a preview", () => {
  it("runs preview_avatar with every file and the height, and keeps nothing", async () => {
    const res = await handleAvatarUpload(
      upload({
        image: [image(), image("image/jpeg", 8)],
        mode: "preview",
        height: "48",
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: PREVIEW });
    expect(run).toHaveBeenCalledTimes(1);
    const [name, input, ctx] = run.mock.calls[0]!;
    expect([name, input]).toEqual(["preview_avatar", { height: "48" }]);
    expect(
      (ctx as RequestCtx).avatarUpload?.files.map((f) => f.length),
    ).toEqual([16, 8]);
    expect(await storedBytes(PATH(0))).toBeNull();
  });

  it("passes on preview_avatar's refusal (not an admin, unreadable)", async () => {
    run.mockResolvedValueOnce({
      ok: false,
      code: "FORBIDDEN",
      message: "Only admins can do this.",
    });
    const res = await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "Knight" }),
      deps(),
    );
    expect(await res.json()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await storedBytes(PATH(0))).toBeNull();
  });
});

describe("a save", () => {
  it("stores the CLEANED figures as idle, walk and emote, then runs add_avatar", async () => {
    const res = await handleAvatarUpload(
      upload({
        image: image(),
        mode: "save",
        name: "Harper",
        requestId: "req-12345678",
      }),
      deps(),
    );
    expect(await res.json()).toEqual({
      ok: true,
      data: { avatarId: NEW_ID, name: "Harper" },
    });
    const [name, input, ctx] = run.mock.calls[1]!;
    expect([name, input]).toEqual(["add_avatar", { name: "Harper" }]);
    expect((ctx as RequestCtx).avatarImage).toEqual({
      avatarId: NEW_ID,
      poses: { idle: ref(0), walk: ref(1), emote: ref(2) },
    });
    expect((ctx as RequestCtx).requestId).toBe("req-12345678");
    for (const n of [0, 1, 2]) {
      expect(await storedBytes(PATH(n))).toEqual(Array.from(CLEANED[n]!));
    }
  });

  it("follows the admin's pose order, and stores nothing for a skipped figure", async () => {
    await handleAvatarUpload(
      upload({
        image: image(),
        mode: "save",
        name: "B",
        poses: "walk,skip,idle",
      }),
      deps(),
    );
    expect((run.mock.calls[1]![2] as RequestCtx).avatarImage).toEqual({
      avatarId: NEW_ID,
      poses: { walk: ref(0), idle: ref(2) },
    });
    expect(await storedBytes(PATH(1))).toBeNull();
  });

  it("refuses a pose order that does not fit, storing nothing", async () => {
    for (const poses of [
      "idle,walk",
      "walk,emote,skip",
      "idle,idle,walk",
      "idle,run,walk",
    ]) {
      const res = await handleAvatarUpload(
        upload({ image: image(), mode: "save", name: "B", poses }),
        deps(),
      );
      expect(res.status).toBe(400);
    }
    expect(run.mock.calls.every(([n]) => n === "preview_avatar")).toBe(true);
    expect(await storedBytes(PATH(0))).toBeNull();
  });

  it("deletes the files again when add_avatar refuses, or answers a replay", async () => {
    run.mockImplementation(async (name) =>
      name === "preview_avatar"
        ? ({ ok: true, data: PREVIEW } as ActionResult<unknown>)
        : { ok: false, code: "INVALID_INPUT", message: "Give it a name." },
    );
    const res = await handleAvatarUpload(
      upload({ image: image(), mode: "save" }),
      deps(),
    );
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(run.mock.calls[1]![1]).toEqual({ name: "" });
    for (const n of [0, 1, 2]) expect(await storedBytes(PATH(n))).toBeNull();

    run.mockImplementation(async (name) =>
      name === "preview_avatar"
        ? ({ ok: true, data: PREVIEW } as ActionResult<unknown>)
        : { ok: true, data: { avatarId: "an-earlier-one" } },
    );
    await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "K" }),
      deps(),
    );
    expect(await storedBytes(PATH(0))).toBeNull();
  });

  it("says so when Blob is not set up, or fails part-way, keeping nothing", async () => {
    const res = await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "K" }),
      deps({ store: unconfiguredBlobStore }),
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
    // The second put fails: the first file goes again.
    let puts = 0;
    const flaky: BlobStore = {
      ...store,
      put: async (p, b, t) =>
        ++puts === 2
          ? { ok: false, reason: "unavailable" }
          : store.put(p, b, t),
    };
    const res2 = await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "K" }),
      deps({ store: flaky }),
    );
    expect(res2.status).toBe(502);
    expect(await storedBytes(PATH(0))).toBeNull();
    expect(run).toHaveBeenCalledTimes(2); // the two previews only
  });
});

describe("parsePoses", () => {
  it("defaults to left to right, and explains a wrong order", () => {
    expect(parsePoses(undefined, 2)).toEqual(["idle", "walk"]);
    expect(parsePoses("emote, idle", 2)).toEqual(["emote", "idle"]);
    expect(parsePoses("idle", 2)).toBe(
      "Say which pose each of the 2 figures is.",
    );
    expect(parsePoses("idle,jump", 2)).toBe(
      "A pose is idle, walk or emote (or skip).",
    );
    expect(parsePoses("walk,skip", 2)).toBe(
      "One figure must be the idle pose.",
    );
    expect(parsePoses("idle,idle", 2)).toBe(
      "Each pose can only be one figure.",
    );
  });
});

describe("what is refused before anything is decoded", () => {
  it("refuses a cross-site request", async () => {
    const res = await handleAvatarUpload(
      upload({ image: image() }, { "sec-fetch-site": "cross-site" }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a body declared too large, and a body that is not a form", async () => {
    const big = new Request("http://localhost/api/uploads/avatar", {
      method: "POST",
      body: "x",
      headers: {
        "sec-fetch-site": "same-origin",
        "content-length": String(AVATAR_UPLOAD_MAX_REQUEST_BYTES + 1),
      },
    });
    expect((await handleAvatarUpload(big, deps())).status).toBe(413);
    const notForm = new Request("http://localhost/api/uploads/avatar", {
      method: "POST",
      body: "x",
      headers: {
        "sec-fetch-site": "same-origin",
        "content-type": "text/plain",
      },
    });
    expect((await handleAvatarUpload(notForm, deps())).status).toBe(400);
  });

  it("refuses nobody signed in", async () => {
    const res = await handleAvatarUpload(
      upload({ image: image() }),
      deps({ requestCtx: async () => null }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses no file, SVG or another type, and a file over 4 MB", async () => {
    for (const [fields, status] of [
      [{}, 400],
      [{ image: image("image/svg+xml") }, 415],
      [{ image: image("image/gif") }, 415],
      [{ image: image("image/png", AVATAR_UPLOAD_MAX_BYTES + 1) }, 413],
      // Four poses, and two files that are too much together.
      [{ image: [image(), image(), image(), image()] }, 400],
      [
        {
          image: [
            image("image/png", AVATAR_UPLOAD_MAX_BYTES / 2 + 1),
            image("image/png", AVATAR_UPLOAD_MAX_BYTES / 2 + 1),
          ],
        },
        413,
      ],
    ] as const) {
      const res = await handleAvatarUpload(
        upload({ ...fields } as Record<string, File | File[]>),
        deps(),
      );
      expect(res.status).toBe(status);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("is rate-limited per member, then per address", async () => {
    const keys: string[] = [];
    const limiter: RateLimiter = {
      limit: async (key) => {
        keys.push(key);
        return key.includes(":ip:")
          ? { ok: false, retryAfterSeconds: 42 }
          : { ok: true, retryAfterSeconds: 0 };
      },
    };
    const res = await handleAvatarUpload(
      upload({ image: image() }),
      deps({ rateLimiter: limiter }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(keys).toEqual([
      "avatar-upload:member:m1",
      expect.stringMatching(/^avatar-upload:ip:/),
    ]);
    expect(run).not.toHaveBeenCalled();
  });
});
