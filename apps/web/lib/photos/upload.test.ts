// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestCtx } from "@/lib/actions/define";
import type { ActionResult } from "@/lib/actions/result";
import type { RateLimiter } from "@/lib/rate-limit";
import { ctxFor, kioskActor, sessionActor } from "@/test-utils/actions";
import { memoryBlobStore, type BlobStore } from "./blob-store";
import { PHOTO_MAX_BYTES, photoProxyUrl } from "./paths";
import { handleCompletionPhotoUpload, type UploadDeps } from "./upload";

// POST /api/uploads/completion-photo (SPEC §6.5): who may upload, what, how
// often, and that the file is kept only when the action took it. The action
// itself is faked here; lib/actions/confirmations.test.ts runs the real ones.

const NEW_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EXISTING = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NAME = "a1b2c3d4e5f60718";
const CHORE = "9b2d7e3a-1f4c-4e8b-a1d2-3c4b5a697881";

const allowAll: RateLimiter = {
  limit: async () => ({ ok: true, retryAfterSeconds: 0 }),
};

let store: BlobStore;
let run: ReturnType<typeof vi.fn<UploadDeps["runAction"]>>;
let seenCtx: { surface: string; requestId?: string; pin?: string } | null;

beforeEach(async () => {
  store = memoryBlobStore();
  for (const id of [NEW_ID, EXISTING]) {
    for (const ext of ["webp", "jpg", "png"]) {
      await store.del(`completions/${id}/${NAME}.${ext}`);
    }
  }
  run = vi.fn<UploadDeps["runAction"]>();
  seenCtx = null;
});

function deps(over: Partial<UploadDeps> = {}): UploadDeps {
  return {
    requestCtx: async (surface, requestId, pin) => {
      seenCtx = { surface, requestId, pin };
      return ctxFor(
        surface === "kiosk" ? kioskActor("m-kiosk") : sessionActor("m1"),
        { source: surface, requestId },
      );
    },
    runAction: run,
    store,
    rateLimiter: allowAll,
    newCompletionId: () => NEW_ID,
    randomName: () => NAME,
    ...over,
  };
}

function image(type = "image/webp", size = 16): File {
  return new File([new Uint8Array(size)], "p", { type });
}

function upload(
  fields: Record<string, string | File>,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://localhost/api/uploads/completion-photo", {
    method: "POST",
    body: form,
    headers,
  });
}

const OK = <T>(data: T): ActionResult<T> => ({ ok: true, data });

async function has(pathname: string) {
  const got = await store.get(pathname);
  return got.ok && got.data !== null;
}

describe("attaching to an existing claim", () => {
  it("stores the file under the claim, then runs attach_completion_photo with it", async () => {
    const pathname = `completions/${EXISTING}/${NAME}.webp`;
    run.mockResolvedValue(OK({ photoUrl: photoProxyUrl(pathname) }));
    const res = await handleCompletionPhotoUpload(
      upload({
        image: image(),
        completionId: EXISTING,
        requestId: "req-12345678",
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      data: { photoUrl: photoProxyUrl(pathname) },
    });
    const [name, input, ctx] = run.mock.calls[0]!;
    expect(name).toBe("attach_completion_photo");
    expect(input).toEqual({ completionId: EXISTING });
    expect((ctx as RequestCtx).photo).toEqual({
      completionId: EXISTING,
      pathname,
    });
    expect(seenCtx).toEqual({
      surface: "ui",
      requestId: "req-12345678",
      pin: undefined,
    });
    expect(await has(pathname)).toBe(true);
  });

  it("deletes the file again when the action refuses", async () => {
    run.mockResolvedValue({
      ok: false,
      code: "FORBIDDEN",
      message: "Only the person who did it or logged it can add a photo.",
    });
    const res = await handleCompletionPhotoUpload(
      upload({ image: image("image/png"), completionId: EXISTING }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await has(`completions/${EXISTING}/${NAME}.png`)).toBe(false);
  });

  it("deletes the file of a replayed request, which kept its first photo", async () => {
    run.mockResolvedValue(OK({ photoUrl: "/api/blob?pathname=earlier" }));
    await handleCompletionPhotoUpload(
      upload({ image: image(), completionId: EXISTING }),
      deps(),
    );
    expect(await has(`completions/${EXISTING}/${NAME}.webp`)).toBe(false);
  });

  it("refuses a claim id that is not a uuid", async () => {
    const res = await handleCompletionPhotoUpload(
      upload({ image: image(), completionId: "../../etc" }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("logging a new claim with a photo", () => {
  it("picks the completion id, stores under it and runs log_completion with the rest of the form", async () => {
    run.mockResolvedValue(OK({ completionId: NEW_ID }));
    const res = await handleCompletionPhotoUpload(
      upload({
        image: image("image/jpeg"),
        choreId: CHORE,
        requestId: "req-abcdefgh",
        surface: "kiosk",
        pin: "1234",
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    const [name, input, ctx] = run.mock.calls[0]!;
    expect(name).toBe("log_completion");
    // The PIN goes to the context, never into the input.
    expect(input).toEqual({ choreId: CHORE });
    expect(seenCtx).toEqual({
      surface: "kiosk",
      requestId: "req-abcdefgh",
      pin: "1234",
    });
    expect((ctx as RequestCtx).photo).toEqual({
      completionId: NEW_ID,
      pathname: `completions/${NEW_ID}/${NAME}.jpg`,
    });
    expect(await has(`completions/${NEW_ID}/${NAME}.jpg`)).toBe(true);
  });

  it("ignores a PIN sent from the phone", async () => {
    run.mockResolvedValue(OK({ completionId: NEW_ID }));
    await handleCompletionPhotoUpload(
      upload({ image: image(), choreId: CHORE, pin: "1234" }),
      deps(),
    );
    expect(seenCtx?.pin).toBeUndefined();
  });

  it("deletes the file when the log is refused, or was a replay", async () => {
    run.mockResolvedValueOnce({
      ok: false,
      code: "COOLDOWN",
      message: "Trash was done recently.",
    });
    await handleCompletionPhotoUpload(
      upload({ image: image(), choreId: CHORE }),
      deps(),
    );
    expect(await has(`completions/${NEW_ID}/${NAME}.webp`)).toBe(false);
    run.mockResolvedValueOnce(OK({ completionId: EXISTING }));
    await handleCompletionPhotoUpload(
      upload({ image: image(), choreId: CHORE }),
      deps(),
    );
    expect(await has(`completions/${NEW_ID}/${NAME}.webp`)).toBe(false);
  });

  it("uses a random completion id and name by default", async () => {
    run.mockImplementation(async (_n, _i, ctx) =>
      OK({ completionId: ctx.photo!.completionId }),
    );
    await handleCompletionPhotoUpload(
      upload({ image: image(), choreId: CHORE }),
      deps({ newCompletionId: undefined, randomName: undefined }),
    );
    const photo = (run.mock.calls[0]![2] as RequestCtx).photo!;
    expect(photo.pathname).toMatch(
      new RegExp(`^completions/${photo.completionId}/[0-9a-f]{16}\\.webp$`),
    );
    await store.del(photo.pathname);
  });
});

describe("refusals", () => {
  it("refuses a cross-site request before reading anything", async () => {
    const requestCtx = vi.fn();
    const res = await handleCompletionPhotoUpload(
      upload({ image: image() }, { "sec-fetch-site": "cross-site" }),
      deps({ requestCtx }),
    );
    expect(res.status).toBe(403);
    expect(requestCtx).not.toHaveBeenCalled();
  });

  it("answers 401 to nobody and 403 to an account with no member", async () => {
    const none = await handleCompletionPhotoUpload(
      upload({ image: image() }),
      deps({ requestCtx: async () => null }),
    );
    expect(none.status).toBe(401);
    const account = await handleCompletionPhotoUpload(
      upload({ image: image() }),
      deps({ requestCtx: async () => ctxFor(sessionActor(undefined)) }),
    );
    expect(account.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 400 to a body that is not a form, and to a form without a file", async () => {
    const notForm = await handleCompletionPhotoUpload(
      new Request("http://localhost/x", {
        method: "POST",
        body: "{}",
        headers: {
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
      }),
      deps(),
    );
    expect(notForm.status).toBe(400);
    for (const fields of <Record<string, string | File>[]>[
      {},
      { image: "text" },
      { image: image("image/webp", 0) },
    ]) {
      const res = await handleCompletionPhotoUpload(upload(fields), deps());
      expect(res.status).toBe(400);
    }
  });

  it("answers 415 to SVG and anything off the list, and 413 above 5 MB", async () => {
    for (const type of ["image/svg+xml", "image/gif", "text/html"]) {
      const res = await handleCompletionPhotoUpload(
        upload({ image: image(type) }),
        deps(),
      );
      expect(res.status, type).toBe(415);
    }
    const big = await handleCompletionPhotoUpload(
      upload({ image: image("image/webp", PHOTO_MAX_BYTES + 1) }),
      deps(),
    );
    expect(big.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it("rate-limits per member and per address, with Retry-After", async () => {
    const keys: string[] = [];
    const limiter = (blockKey: string): RateLimiter => ({
      limit: async (key) => {
        keys.push(key);
        return key.startsWith(blockKey)
          ? { ok: false, retryAfterSeconds: 42 }
          : { ok: true, retryAfterSeconds: 0 };
      },
    });
    const byMember = await handleCompletionPhotoUpload(
      upload({ image: image() }),
      deps({ rateLimiter: limiter("photo-upload:member:") }),
    );
    expect(byMember.status).toBe(429);
    expect(byMember.headers.get("retry-after")).toBe("42");
    expect(await byMember.json()).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 42,
    });
    const byIp = await handleCompletionPhotoUpload(
      upload(
        { image: image() },
        { "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.9" },
      ),
      deps({ rateLimiter: limiter("photo-upload:ip:") }),
    );
    expect(byIp.status).toBe(429);
    expect(keys).toContain("photo-upload:member:m1");
    expect(keys).toContain("photo-upload:ip:203.0.113.9");
  });

  it("answers 501 with a sentence when Blob is not configured, and 502 when it fails", async () => {
    const nc: BlobStore = {
      put: async () => ({ ok: false, reason: "not_configured" }),
      get: async () => ({ ok: true, data: null }),
      del: async () => ({ ok: true }),
    };
    const res = await handleCompletionPhotoUpload(
      upload({ image: image(), choreId: CHORE }),
      deps({ store: nc }),
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Photo uploads aren't set up on this deployment yet.",
    });
    const down = await handleCompletionPhotoUpload(
      upload({ image: image(), choreId: CHORE }),
      deps({
        store: {
          ...nc,
          put: async () => ({ ok: false, reason: "unavailable" }),
        },
      }),
    );
    expect(down.status).toBe(502);
    expect(run).not.toHaveBeenCalled();
  });
});
