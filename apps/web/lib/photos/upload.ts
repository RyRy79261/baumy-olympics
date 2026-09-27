import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { RequestCtx } from "@/lib/actions/define";
import {
  fail,
  type ActionFailure,
  type ActionResult,
} from "@/lib/actions/result";
import { formDataToInput } from "@/lib/actions/ui";
import { rejectCrossSite } from "@/lib/http/origin";
import { getClientIp, type RateLimiter } from "@/lib/rate-limit";
import type { BlobStore } from "./blob-store";
import {
  PHOTO_MAX_BYTES,
  isPhotoType,
  photoPathname,
  photoProxyUrl,
} from "./paths";

// POST /api/uploads/completion-photo (SPEC §4.3, §6.5), ported from camp-404
// `apps/web/app/api/uploads/avatar/route.ts`. One photo, multipart:
//
//   image         the file (webp, jpeg or png, at most 5 MB; the client has
//                 already downscaled it to 1280px);
//   requestId     the idempotency key of the action it feeds;
//   surface       "kiosk" from the kitchen iPad, else the phone;
//   pin           kiosk only, when the action needs the member's PIN;
//   completionId  attach it to this claim (attach_completion_photo), or
//   choreId, …    log a new claim with it (log_completion, the rest of the
//                 fields are that action's input).
//
// The file is stored FIRST, under a completion id this route picks (for a
// new claim) or names (for an existing one), and the action then runs with
// the stored pathname in `ctx.photo`: a pathname no surface can type in. If
// the action refuses, the file is deleted again. The answer is the action's
// result; it never contains a raw Blob URL, only `/api/blob?pathname=…`.
//
// Cookie-authenticated, so it checks Origin/Sec-Fetch-Site (lib/http/origin)
// and is rate-limited per member and per IP.

/** Uploads per member, and per address, in `UPLOAD_WINDOW_MS`. */
export const UPLOAD_LIMITS = { perMember: 20, perIp: 40 } as const;
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Form fields that belong to the route, not to the action's input. */
const ROUTE_FIELDS = ["image", "surface", "pin", "completionId"];

export interface UploadDeps {
  /** The request context for the surface, or null when not signed in. */
  requestCtx: (
    surface: "ui" | "kiosk",
    requestId: string | undefined,
    pin: string | undefined,
  ) => Promise<RequestCtx | null>;
  runAction: (
    name: "log_completion" | "attach_completion_photo",
    input: unknown,
    ctx: RequestCtx,
  ) => Promise<ActionResult<unknown>>;
  store: BlobStore;
  rateLimiter: RateLimiter;
  newCompletionId?: () => string;
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

export async function handleCompletionPhotoUpload(
  req: Request,
  deps: UploadDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse(400, fail("INVALID_INPUT", "That upload was not a form."));
  }

  const surface = field(form, "surface") === "kiosk" ? "kiosk" : "ui";
  const ctx = await deps.requestCtx(
    surface,
    field(form, "requestId"),
    surface === "kiosk" ? field(form, "pin") : undefined,
  );
  if (!ctx) {
    return refuse(401, fail("UNAUTHENTICATED", "Sign in to add a photo."));
  }
  const memberId = ctx.actor.memberId;
  if (!memberId) {
    return refuse(
      403,
      fail("FORBIDDEN", "Only household members can add photos."),
    );
  }

  // Before reading the file into Blob: per member, then per address.
  const ip = getClientIp(req.headers);
  for (const [key, limit] of [
    [`photo-upload:member:${memberId}`, UPLOAD_LIMITS.perMember],
    [`photo-upload:ip:${ip}`, UPLOAD_LIMITS.perIp],
  ] as const) {
    const rl = await deps.rateLimiter.limit(key, {
      limit,
      windowMs: UPLOAD_WINDOW_MS,
    });
    if (!rl.ok) {
      return new Response(
        JSON.stringify(
          fail(
            "RATE_LIMITED",
            "Too many photos in a short time. Try again later.",
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
    return refuse(400, fail("INVALID_INPUT", "Choose a photo to upload."));
  }
  if (!isPhotoType(file.type)) {
    return refuse(
      415,
      fail("INVALID_INPUT", "The photo must be a WebP, JPEG or PNG image."),
    );
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return refuse(
      413,
      fail("INVALID_INPUT", "That photo is too large (5 MB at most)."),
    );
  }

  const existing = field(form, "completionId");
  if (existing !== undefined && !UUID.test(existing)) {
    return refuse(400, fail("INVALID_INPUT", "That claim was not found."));
  }
  const completionId = (
    existing ?? (deps.newCompletionId ?? randomUUID)()
  ).toLowerCase();
  const pathname = photoPathname(
    completionId,
    file.type,
    (deps.randomName ?? (() => randomBytes(8).toString("hex")))(),
  );

  const stored = await deps.store.put(pathname, file, file.type);
  if (!stored.ok) {
    return stored.reason === "not_configured"
      ? refuse(
          501,
          fail(
            "NOT_CONFIGURED",
            "Photo uploads aren't set up on this deployment yet.",
          ),
        )
      : refuse(
          502,
          fail("UNAVAILABLE", "The photo could not be stored. Try again."),
        );
  }

  const input = formDataToInput(form);
  for (const name of ROUTE_FIELDS) delete input[name];
  const photoCtx: RequestCtx = { ...ctx, photo: { completionId, pathname } };
  const result = existing
    ? await deps.runAction(
        "attach_completion_photo",
        { completionId },
        photoCtx,
      )
    : await deps.runAction("log_completion", input, photoCtx);

  // Refused, or a replay of an earlier request that stored its own file:
  // this file belongs to nothing, so it goes.
  const used =
    result.ok &&
    (existing
      ? (result.data as { photoUrl?: string }).photoUrl ===
        photoProxyUrl(pathname)
      : (result.data as { completionId?: string }).completionId ===
        completionId);
  if (!used) await deps.store.del(pathname);
  return respond(result);
}
