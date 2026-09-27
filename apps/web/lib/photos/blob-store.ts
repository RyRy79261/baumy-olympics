import "server-only";

import { del, get, put } from "@vercel/blob";
import { isTestMode } from "@/lib/test-mode";

// Vercel Blob behind an adapter (SPEC §6.5, §10). The store is PRIVATE and the
// token is passed on every call, as camp-404 does
// (`apps/web/app/api/uploads/avatar/route.ts`, `app/api/avatar/route.ts`).
//
// Like every integration it returns a result union and never throws into a
// route:
// - `not_configured`: no BLOB_READ_WRITE_TOKEN here, so uploads answer 501
//   with a sentence, rather than pretending to store a photo;
// - `unavailable`: Blob failed; the error is logged by status only.
//
// Under E2E_TEST_MODE=1 an in-memory store stands in, so the suite uploads and
// views photos with no Blob account. It lives on globalThis because Next can
// load this module once per route bundle, and the upload route and the proxy
// must see one store (the same reason as lib/clock.ts).

export type BlobFailure = {
  ok: false;
  reason: "not_configured" | "unavailable";
};

export interface StoredBlob {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
}

export interface BlobStore {
  put(
    pathname: string,
    body: Blob,
    contentType: string,
  ): Promise<{ ok: true } | BlobFailure>;
  /** `data` is null when there is no such blob. */
  get(
    pathname: string,
  ): Promise<{ ok: true; data: StoredBlob | null } | BlobFailure>;
  del(pathname: string): Promise<{ ok: true } | BlobFailure>;
}

const NOT_CONFIGURED: BlobFailure = { ok: false, reason: "not_configured" };
const UNAVAILABLE: BlobFailure = { ok: false, reason: "unavailable" };

/** The status of a failed Blob call, never its message (it may echo a URL). */
function logFailure(op: string, err: unknown): void {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? String((err as { status: unknown }).status)
      : "error";
  console.error(`[blob] ${op} failed (${status})`);
}

/** The real store: private Vercel Blob, the token on every call. */
export function vercelBlobStore(token: string): BlobStore {
  return {
    async put(pathname, body, contentType) {
      try {
        await put(pathname, body, {
          access: "private",
          addRandomSuffix: false,
          contentType,
          token,
        });
        return { ok: true };
      } catch (err) {
        logFailure("put", err);
        return UNAVAILABLE;
      }
    },
    async get(pathname) {
      try {
        const result = await get(pathname, { access: "private", token });
        // Null when missing; a 304 has no body. Only a full 200 is served.
        if (!result || result.statusCode !== 200) {
          return { ok: true, data: null };
        }
        return {
          ok: true,
          data: { body: result.stream, contentType: result.blob.contentType },
        };
      } catch (err) {
        logFailure("get", err);
        return UNAVAILABLE;
      }
    },
    async del(pathname) {
      try {
        await del(pathname, { token });
        return { ok: true };
      } catch (err) {
        logFailure("del", err);
        return UNAVAILABLE;
      }
    },
  };
}

/** Every call answers `not_configured`. */
export const unconfiguredBlobStore: BlobStore = {
  put: async () => NOT_CONFIGURED,
  get: async () => NOT_CONFIGURED,
  del: async () => NOT_CONFIGURED,
};

const MEMORY_KEY = Symbol.for("baumy.blob.memory");
type MemoryGlobal = typeof globalThis & {
  [MEMORY_KEY]?: Map<string, { bytes: Uint8Array; contentType: string }>;
};

/** The E2E fake: one process-wide map of pathname to bytes. */
export function memoryBlobStore(): BlobStore {
  const files = ((globalThis as MemoryGlobal)[MEMORY_KEY] ??= new Map());
  return {
    async put(pathname, body, contentType) {
      files.set(pathname, {
        bytes: new Uint8Array(await body.arrayBuffer()),
        contentType,
      });
      return { ok: true };
    },
    async get(pathname) {
      const file = files.get(pathname);
      return {
        ok: true,
        data: file ? { body: file.bytes, contentType: file.contentType } : null,
      };
    },
    async del(pathname) {
      files.delete(pathname);
      return { ok: true };
    },
  };
}

/** The store for this environment: the fake in E2E, else Blob or nothing. */
export function blobStore(
  env: Record<string, string | undefined> = process.env,
): BlobStore {
  if (isTestMode(env)) return memoryBlobStore();
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? vercelBlobStore(token) : unconfiguredBlobStore;
}
