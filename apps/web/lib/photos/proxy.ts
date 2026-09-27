import "server-only";

import type { Actor } from "@/lib/auth";
import type { BlobStore } from "./blob-store";
import { isPhotoType, photoPathCompletionId } from "./paths";

// GET /api/blob?pathname=… (SPEC §6.5), ported from camp-404
// `apps/web/app/api/avatar/route.ts`. The Blob store is private, so this is
// the only way to see a completion photo:
//
// - a pathname that is unsafe (camp-404's UNSAFE_PATH: `..`, `//`, `\`, `%`)
//   or not exactly `completions/{id}/{name}.{webp|jpg|png}` is 404, before
//   anyone is asked who they are;
// - nobody signed in, an account with no member row, or no paired kiosk is
//   401 (a revoked kiosk does not resolve to an actor at all);
// - a completion that is not in the caller's household, or whose stored
//   photo is not this pathname, is 404;
// - anything Blob holds under another content type is 404 (never served
//   same-origin as, say, SVG).
//
// A photo is sent with `nosniff` and `private, immutable`: the name is random
// and never reused, and no shared cache may keep a household's photo.

export interface ProxyDeps {
  getActor: () => Promise<Actor | null>;
  householdId: string;
  /** `findCompletionPhoto` (packages/db). */
  findPhoto: (
    householdId: string,
    completionId: string,
  ) => Promise<string | null | undefined>;
  store: BlobStore;
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** A member's session, or a paired kiosk, may look. */
function mayView(actor: Actor | null): boolean {
  if (!actor) return false;
  if (actor.kind === "kiosk") return true;
  return actor.memberId !== undefined;
}

export async function handleBlobProxy(
  req: Request,
  deps: ProxyDeps,
): Promise<Response> {
  const pathname = new URL(req.url).searchParams.get("pathname");
  if (!pathname) return text("Missing pathname", 400);
  const completionId = photoPathCompletionId(pathname);
  if (!completionId) return text("Not found", 404);

  if (!mayView(await deps.getActor())) return text("Unauthorized", 401);

  const photo = await deps.findPhoto(deps.householdId, completionId);
  if (photo !== pathname) return text("Not found", 404);

  const got = await deps.store.get(pathname);
  if (!got.ok || !got.data || !isPhotoType(got.data.contentType)) {
    return text("Not found", 404);
  }
  return new Response(got.data.body as BodyInit, {
    headers: {
      "content-type": got.data.contentType,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
