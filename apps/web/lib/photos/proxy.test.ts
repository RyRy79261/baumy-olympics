// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth";
import { memoryBlobStore, type BlobStore } from "./blob-store";
import { handleBlobProxy, type ProxyDeps } from "./proxy";

// /api/blob (SPEC §6.5): path validation first (404), then who is asking
// (401), then the household and the stored photo (404).

const HOUSE = "00000000-0000-4000-8000-000000000001";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = `completions/${ID}/a1b2c3d4e5.webp`;
const AVATAR = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SPRITE = `avatars/${AVATAR}/a1b2c3d4e5f60718.png`;

const member: Actor = {
  kind: "member",
  userId: "u1",
  email: "a@example.com",
  name: "A",
  emailVerified: true,
  sessionCreatedAt: "2026-09-27T09:00:00.000Z",
  memberId: "m1",
  role: "member",
};

function deps(over: Partial<ProxyDeps> = {}): ProxyDeps {
  return {
    getActor: async () => member,
    householdId: HOUSE,
    findPhoto: async (h, id) => (h === HOUSE && id === ID ? PATH : undefined),
    findAvatar: async (h, id, p) =>
      h === HOUSE && id === AVATAR && p === SPRITE ? SPRITE : null,
    store: memoryBlobStore(),
    ...over,
  };
}

const req = (pathname: string | null) =>
  new Request(
    `http://localhost/api/blob${pathname === null ? "" : `?pathname=${encodeURIComponent(pathname)}`}`,
  );

// The fake store is process-wide, as it is in the e2e server.
beforeEach(async () => {
  await memoryBlobStore().del(PATH);
  await memoryBlobStore().del(SPRITE);
});

async function withPhoto(type = "image/webp") {
  const store = memoryBlobStore();
  await store.put(PATH, new Blob([new Uint8Array([7, 7])]), type);
  return store;
}

describe("GET /api/blob", () => {
  it("streams the household's photo with nosniff and private, immutable", async () => {
    const res = await handleBlobProxy(
      req(PATH),
      deps({ store: await withPhoto() }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([7, 7]),
    );
  });

  it("serves a paired kiosk too, even with nobody picked", async () => {
    const kiosk: Actor = { kind: "kiosk", deviceId: "d1" };
    const res = await handleBlobProxy(
      req(PATH),
      deps({ getActor: async () => kiosk, store: await withPhoto() }),
    );
    expect(res.status).toBe(200);
  });

  it("answers 401 to nobody, and to an account that is not a member", async () => {
    const store = await withPhoto();
    const none = await handleBlobProxy(
      req(PATH),
      deps({ getActor: async () => null, store }),
    );
    expect(none.status).toBe(401);
    expect(none.headers.get("x-content-type-options")).toBe("nosniff");
    const {
      memberId: _m,
      role: _r,
      ...account
    } = member as Extract<Actor, { kind: "member" }>;
    const outsider = await handleBlobProxy(
      req(PATH),
      deps({ getActor: async () => account, store }),
    );
    expect(outsider.status).toBe(401);
  });

  it("answers 404 to `..`, encoded and off-list paths before asking who is there", async () => {
    const getActor = vi.fn(async () => member);
    for (const bad of [
      `completions/${ID}/../${ID}/a1b2c3d4e5.webp`,
      `completions/${ID}/a1b2c3d4e5%2ewebp`,
      `completions/${ID}%2Fa1b2c3d4e5.webp`,
      `completions//${ID}/a1b2c3d4e5.webp`,
      `completions\\${ID}\\a1b2c3d4e5.webp`,
      `avatars/${ID}/a1b2c3d4e5.webp`,
      `completions/${ID}/a1b2c3d4e5.svg`,
    ]) {
      const res = await handleBlobProxy(req(bad), deps({ getActor }));
      expect(res.status, bad).toBe(404);
    }
    expect(getActor).not.toHaveBeenCalled();
    // Unauthenticated and bad path: still 404, never a hint.
    const res = await handleBlobProxy(
      req(`completions/${ID}/../x.webp`),
      deps({ getActor: async () => null }),
    );
    expect(res.status).toBe(404);
  });

  it("answers 400 without a pathname", async () => {
    expect((await handleBlobProxy(req(null), deps())).status).toBe(400);
  });

  it("answers 404 for another household's completion, or a pathname that is not its photo", async () => {
    const store = await withPhoto();
    const elsewhere = await handleBlobProxy(
      req(PATH),
      deps({ store, householdId: "00000000-0000-4000-8000-000000000999" }),
    );
    expect(elsewhere.status).toBe(404);
    const other = await handleBlobProxy(
      req(`completions/${ID}/ffffffff00.webp`),
      deps({ store }),
    );
    expect(other.status).toBe(404);
    const none = await handleBlobProxy(
      req(PATH),
      deps({ store, findPhoto: async () => null }),
    );
    expect(none.status).toBe(404);
  });

  it("answers 404 when Blob has nothing, fails, or holds another content type", async () => {
    const missing = await handleBlobProxy(req(PATH), deps());
    expect(missing.status).toBe(404);
    const svg = await handleBlobProxy(
      req(PATH),
      deps({ store: await withPhoto("image/svg+xml") }),
    );
    expect(svg.status).toBe(404);
    const down: BlobStore = {
      put: async () => ({ ok: true }),
      get: async () => ({ ok: false, reason: "unavailable" }),
      del: async () => ({ ok: true }),
    };
    expect(
      (await handleBlobProxy(req(PATH), deps({ store: down }))).status,
    ).toBe(404);
  });
});

describe("GET /api/blob for a gallery sprite (issue #111)", () => {
  async function withSprite(type = "image/png") {
    const store = memoryBlobStore();
    await store.put(SPRITE, new Blob([new Uint8Array([1])]), type);
    return store;
  }
  const account: Actor = {
    kind: "member",
    userId: "u2",
    email: "b@example.com",
    name: "B",
    emailVerified: true,
    sessionCreatedAt: "2026-09-27T09:00:00.000Z",
  };

  it("serves the household's sprite to a member, a kiosk and an account joining", async () => {
    for (const actor of [
      member,
      { kind: "kiosk", deviceId: "d" } as Actor,
      account,
    ]) {
      const res = await handleBlobProxy(
        req(SPRITE),
        deps({ getActor: async () => actor, store: await withSprite() }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    }
  });

  it("refuses an account a completion photo, and nobody a sprite", async () => {
    const photo = await handleBlobProxy(
      req(PATH),
      deps({ getActor: async () => account, store: await withPhoto() }),
    );
    expect(photo.status).toBe(401);
    const res = await handleBlobProxy(
      req(SPRITE),
      deps({ getActor: async () => null, store: await withSprite() }),
    );
    expect(res.status).toBe(401);
  });

  it("is 404 for a sprite not in the household, a wrong name or a non-PNG path", async () => {
    const store = await withSprite();
    const other = `avatars/${ID}/a1b2c3d4e5f60718.png`;
    expect((await handleBlobProxy(req(other), deps({ store }))).status).toBe(
      404,
    );
    const renamed = `avatars/${AVATAR}/zzzzzzzzzzzzzzzz.png`;
    expect((await handleBlobProxy(req(renamed), deps({ store }))).status).toBe(
      404,
    );
    const svg = `avatars/${AVATAR}/a1b2c3d4e5f60718.svg`;
    expect((await handleBlobProxy(req(svg), deps({ store }))).status).toBe(404);
  });
});
