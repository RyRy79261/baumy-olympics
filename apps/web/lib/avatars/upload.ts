import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { RequestCtx } from "@/lib/actions/define";
import {
  fail,
  type ActionFailure,
  type ActionResult,
} from "@/lib/actions/result";
import { rejectCrossSite } from "@/lib/http/origin";
import type { BlobStore } from "@/lib/photos/blob-store";
import { isPhotoType } from "@/lib/photos/paths";
import { getClientIp, type RateLimiter } from "@/lib/rate-limit";
import { PNG_DATA_URL, type PreviewAvatarData } from "@/lib/actions/avatars";
import { AVATAR_UPLOAD_MAX_BYTES, avatarPathname } from "./paths";

// POST /api/uploads/avatar (issue #111): one image for the avatar gallery,
// multipart, from /admin/avatars. Modelled on the proof-photo route
// (lib/photos/upload.ts):
//
//   image      the file (PNG, JPEG or WebP, at most 4 MB, never SVG);
//   mode       "preview" to see it cleaned, "save" to keep it;
//   name       save only: what the character is called;
//   requestId  save only: add_avatar's idempotency key.
//
// Both modes first run `preview_avatar`, the admin gate and then the cleaning
// (lib/avatars/clean.ts), so nobody else makes the server decode an image.
// A preview answers with the cleaned sprite as a data URL and keeps nothing.
// A save stores the cleaned PNG (never the upload) under a fresh id, then
// runs `add_avatar` with it in `ctx.avatarImage`; if that refuses, the file
// is deleted again. The answer never holds a raw Blob URL.
//
// Cookie-authenticated, so it checks Origin/Sec-Fetch-Site, and it is
// rate-limited per member and per IP.

/** Uploads (previews and saves) per member, and per address, an hour. */
export const AVATAR_UPLOAD_LIMITS = { perMember: 60, perIp: 120 } as const;
export const AVATAR_UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/** The file plus the other fields and the multipart framing. */
export const AVATAR_UPLOAD_MAX_REQUEST_BYTES =
  AVATAR_UPLOAD_MAX_BYTES + 64 * 1024;

const TOO_LARGE = fail(
  "INVALID_INPUT",
  "That image is too large (4 MB at most).",
);

export interface AvatarUploadDeps {
  /** The signed-in UI request, or null when nobody is signed in. */
  requestCtx: (requestId: string | undefined) => Promise<RequestCtx | null>;
  runAction: (
    name: "preview_avatar" | "add_avatar",
    input: unknown,
    ctx: RequestCtx,
  ) => Promise<ActionResult<unknown>>;
  store: BlobStore;
  rateLimiter: RateLimiter;
  newAvatarId?: () => string;
  randomName?: () => string;
}

function respond(result: ActionResult<unknown>, status = 200): Response {
  return Response.json(result, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function refuse(status: number, failure: ActionFailure): Response {
  return respond(failure, status);
}

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function handleAvatarUpload(
  req: Request,
  deps: AvatarUploadDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > AVATAR_UPLOAD_MAX_REQUEST_BYTES) {
    return refuse(413, TOO_LARGE);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse(400, fail("INVALID_INPUT", "That upload was not a form."));
  }

  const save = field(form, "mode") === "save";
  const ctx = await deps.requestCtx(field(form, "requestId"));
  if (!ctx) {
    return refuse(401, fail("UNAUTHENTICATED", "Sign in to add characters."));
  }

  // Before decoding anything: per member (or account), then per address.
  const who = ctx.actor.memberId ?? "none";
  const ip = getClientIp(req.headers);
  for (const [key, limit] of [
    [`avatar-upload:member:${who}`, AVATAR_UPLOAD_LIMITS.perMember],
    [`avatar-upload:ip:${ip}`, AVATAR_UPLOAD_LIMITS.perIp],
  ] as const) {
    const rl = await deps.rateLimiter.limit(key, {
      limit,
      windowMs: AVATAR_UPLOAD_WINDOW_MS,
    });
    if (!rl.ok) {
      return new Response(
        JSON.stringify(
          fail(
            "RATE_LIMITED",
            "Too many uploads in a short time. Try again later.",
            { retryAfterSeconds: rl.retryAfterSeconds },
          ),
        ),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "retry-after": String(rl.retryAfterSeconds),
          },
        },
      );
    }
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return refuse(400, fail("INVALID_INPUT", "Choose an image to upload."));
  }
  if (!isPhotoType(file.type)) {
    return refuse(
      415,
      fail("INVALID_INPUT", "The image must be a PNG, JPEG or WebP file."),
    );
  }
  if (file.size > AVATAR_UPLOAD_MAX_BYTES) return refuse(413, TOO_LARGE);

  // The admin gate, then the cleaning, through the registry.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const cleaned = await deps.runAction(
    "preview_avatar",
    {},
    { ...ctx, avatarUpload: { bytes } },
  );
  if (!cleaned.ok || !save) return respond(cleaned);

  const { preview, width, height } = cleaned.data as PreviewAvatarData;
  const avatarId = (deps.newAvatarId ?? randomUUID)().toLowerCase();
  const pathname = avatarPathname(
    avatarId,
    (deps.randomName ?? (() => randomBytes(8).toString("hex")))(),
  );
  const png = Buffer.from(preview.slice(PNG_DATA_URL.length), "base64");
  const stored = await deps.store.put(
    pathname,
    new Blob([png], { type: "image/png" }),
    "image/png",
  );
  if (!stored.ok) {
    return stored.reason === "not_configured"
      ? refuse(
          501,
          fail(
            "NOT_CONFIGURED",
            "Image uploads aren't set up on this deployment yet.",
          ),
        )
      : refuse(
          502,
          fail("UNAVAILABLE", "The image could not be stored. Try again."),
        );
  }

  const result = await deps.runAction(
    "add_avatar",
    { name: field(form, "name") ?? "" },
    { ...ctx, avatarImage: { avatarId, pathname, width, height } },
  );
  // Refused, or a replay of an earlier request that stored its own file:
  // this file belongs to nothing, so it goes.
  const used =
    result.ok && (result.data as { avatarId?: string }).avatarId === avatarId;
  if (!used) await deps.store.del(pathname);
  return respond(result);
}
