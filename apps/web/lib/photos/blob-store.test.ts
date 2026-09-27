// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => put(...a),
  get: (...a: unknown[]) => get(...a),
  del: (...a: unknown[]) => del(...a),
}));

const { blobStore, memoryBlobStore, unconfiguredBlobStore, vercelBlobStore } =
  await import("./blob-store");

const PATH = "completions/0f8fad5b-d9cb-469f-a165-70867728950e/a1b2c3d4.webp";

beforeEach(() => {
  put.mockReset();
  get.mockReset();
  del.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("vercelBlobStore", () => {
  const store = vercelBlobStore("tok_secret");

  it("puts privately, with the token and our own name, and no random suffix", async () => {
    put.mockResolvedValue({ pathname: PATH });
    const body = new Blob(["x"], { type: "image/webp" });
    await expect(store.put(PATH, body, "image/webp")).resolves.toEqual({
      ok: true,
    });
    expect(put).toHaveBeenCalledWith(PATH, body, {
      access: "private",
      addRandomSuffix: false,
      contentType: "image/webp",
      token: "tok_secret",
    });
  });

  it("gets a full 200 only; a miss or a 304 is no blob", async () => {
    const stream = new ReadableStream();
    get.mockResolvedValueOnce({
      statusCode: 200,
      stream,
      blob: { contentType: "image/png" },
    });
    await expect(store.get(PATH)).resolves.toEqual({
      ok: true,
      data: { body: stream, contentType: "image/png" },
    });
    expect(get).toHaveBeenCalledWith(PATH, {
      access: "private",
      token: "tok_secret",
    });
    get.mockResolvedValueOnce(null);
    await expect(store.get(PATH)).resolves.toEqual({ ok: true, data: null });
    get.mockResolvedValueOnce({ statusCode: 304, stream: null, blob: {} });
    await expect(store.get(PATH)).resolves.toEqual({ ok: true, data: null });
  });

  it("deletes with the token", async () => {
    del.mockResolvedValue(undefined);
    await expect(store.del(PATH)).resolves.toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith(PATH, { token: "tok_secret" });
  });

  it("turns a throw into `unavailable` and logs the status only, never the message", async () => {
    const err = Object.assign(
      new Error("https://x.blob/abc?token=tok_secret"),
      {
        status: 503,
      },
    );
    put.mockRejectedValue(err);
    get.mockRejectedValue(new Error("boom tok_secret"));
    del.mockRejectedValue("weird");
    await expect(
      store.put(PATH, new Blob(["x"]), "image/webp"),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(store.get(PATH)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(store.del(PATH)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("put failed (503)");
    expect(logged).toContain("get failed (error)");
    expect(logged).not.toContain("tok_secret");
  });
});

describe("unconfiguredBlobStore", () => {
  it("answers not_configured to everything", async () => {
    const nc = { ok: false, reason: "not_configured" };
    await expect(
      unconfiguredBlobStore.put(PATH, new Blob(["x"]), "image/webp"),
    ).resolves.toEqual(nc);
    await expect(unconfiguredBlobStore.get(PATH)).resolves.toEqual(nc);
    await expect(unconfiguredBlobStore.del(PATH)).resolves.toEqual(nc);
  });
});

describe("memoryBlobStore", () => {
  it("keeps bytes per pathname across instances, and forgets them on delete", async () => {
    await memoryBlobStore().put(
      PATH,
      new Blob([new Uint8Array([1, 2, 3])]),
      "image/png",
    );
    const again = memoryBlobStore();
    await expect(again.get(PATH)).resolves.toEqual({
      ok: true,
      data: { body: new Uint8Array([1, 2, 3]), contentType: "image/png" },
    });
    await again.del(PATH);
    await expect(again.get(PATH)).resolves.toEqual({ ok: true, data: null });
  });
});

describe("blobStore", () => {
  it("fakes Blob in E2E test mode, uses the token when set, and is unconfigured without one", async () => {
    const memory = blobStore({
      E2E_TEST_MODE: "1",
      BLOB_READ_WRITE_TOKEN: "t",
    });
    await memory.put(PATH, new Blob(["m"]), "image/webp");
    expect(put).not.toHaveBeenCalled();
    await memory.del(PATH);

    put.mockResolvedValue({});
    await blobStore({ BLOB_READ_WRITE_TOKEN: " tok " }).put(
      PATH,
      new Blob(["v"]),
      "image/webp",
    );
    expect(put.mock.calls[0]![2]).toMatchObject({ token: "tok" });

    await expect(
      blobStore({ BLOB_READ_WRITE_TOKEN: "  " }).get(PATH),
    ).resolves.toEqual({ ok: false, reason: "not_configured" });
    await expect(blobStore({}).get(PATH)).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});
