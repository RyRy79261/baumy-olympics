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
  type AvatarUploadDeps,
} from "./upload";

// POST /api/uploads/avatar (issue #111): who may upload, what, how often,
// and that only the cleaned sprite is stored, and only when add_avatar took
// it. The actions are faked here; lib/actions/avatars.test.ts runs them.

const NEW_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NAME = "a1b2c3d4e5f60718";
const PATH = avatarPathname(NEW_ID, NAME);
const CLEANED = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const PREVIEW = {
  preview: PNG_DATA_URL + Buffer.from(CLEANED).toString("base64"),
  width: 28,
  height: 56,
};

let store: BlobStore;
let run: ReturnType<typeof vi.fn<AvatarUploadDeps["runAction"]>>;

beforeEach(async () => {
  store = memoryBlobStore();
  await store.del(PATH);
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
  fields: Record<string, string | File>,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
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

describe("a preview", () => {
  it("runs preview_avatar with the file's bytes and keeps nothing", async () => {
    const res = await handleAvatarUpload(
      upload({ image: image(), mode: "preview" }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: PREVIEW });
    expect(run).toHaveBeenCalledTimes(1);
    const [name, input, ctx] = run.mock.calls[0]!;
    expect([name, input]).toEqual(["preview_avatar", {}]);
    expect((ctx as RequestCtx).avatarUpload?.bytes).toHaveLength(16);
    expect(await storedBytes(PATH)).toBeNull();
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
    expect(await storedBytes(PATH)).toBeNull();
  });
});

describe("a save", () => {
  it("stores the CLEANED sprite, then runs add_avatar with it", async () => {
    const res = await handleAvatarUpload(
      upload({
        image: image(),
        mode: "save",
        name: "Knight",
        requestId: "req-12345678",
      }),
      deps(),
    );
    expect(await res.json()).toEqual({
      ok: true,
      data: { avatarId: NEW_ID, name: "Knight" },
    });
    const [name, input, ctx] = run.mock.calls[1]!;
    expect([name, input]).toEqual(["add_avatar", { name: "Knight" }]);
    expect((ctx as RequestCtx).avatarImage).toEqual({
      avatarId: NEW_ID,
      pathname: PATH,
      width: 28,
      height: 56,
    });
    expect((ctx as RequestCtx).requestId).toBe("req-12345678");
    expect(await storedBytes(PATH)).toEqual(Array.from(CLEANED));
  });

  it("deletes the file again when add_avatar refuses, or answers a replay", async () => {
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
    expect(await storedBytes(PATH)).toBeNull();

    run.mockImplementation(async (name) =>
      name === "preview_avatar"
        ? ({ ok: true, data: PREVIEW } as ActionResult<unknown>)
        : { ok: true, data: { avatarId: "an-earlier-one" } },
    );
    await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "K" }),
      deps(),
    );
    expect(await storedBytes(PATH)).toBeNull();
  });

  it("says so when Blob is not set up, or fails", async () => {
    const res = await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "K" }),
      deps({ store: unconfiguredBlobStore }),
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
    const down: BlobStore = {
      ...unconfiguredBlobStore,
      put: async () => ({ ok: false, reason: "unavailable" }),
    };
    const res2 = await handleAvatarUpload(
      upload({ image: image(), mode: "save", name: "K" }),
      deps({ store: down }),
    );
    expect(res2.status).toBe(502);
    expect(run).toHaveBeenCalledTimes(2); // the two previews only
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
      headers: { "sec-fetch-site": "same-origin", "content-type": "text/plain" },
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
    ] as const) {
      const res = await handleAvatarUpload(upload({ ...fields }), deps());
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
    expect(keys).toEqual(["avatar-upload:member:m1", expect.stringMatching(/^avatar-upload:ip:/)]);
    expect(run).not.toHaveBeenCalled();
  });
});
