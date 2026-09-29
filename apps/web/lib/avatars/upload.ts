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
import { AVATAR_POSES, type AvatarPose } from "@baumy/types";
import { PNG_DATA_URL, type PreviewAvatarData } from "@/lib/actions/avatars";
import { SHEET_MAX_FIGURES } from "./clean";
import { AVATAR_UPLOAD_MAX_BYTES, avatarPathname } from "./paths";

// POST /api/uploads/avatar (issue #111): one character SET for the avatar
// gallery, multipart, from /admin/avatars. Modelled on the proof-photo
// route (lib/photos/upload.ts):
//
//   image      one sheet of 1-3 poses side by side, or one file per pose
//              (PNG, JPEG or WebP, 4 MB at most together, never SVG);
//   height     48, 56 or 64: how tall to clean it (64 when unsent);
//   mode       "preview" to see it cleaned, "save" to keep it;
//   poses      save only: which pose each figure is, left to right or file
//              by file ("idle,walk,emote" when unsent; "skip" drops one);
//   name       save only: what the character is called;
//   requestId  save only: add_avatar's idempotency key.
//
// Both modes first run `preview_avatar`, the admin gate and then the cleaning
// (lib/avatars/clean.ts), so nobody else makes the server decode an image.
// A preview answers with the cleaned figures as data URLs and keeps nothing.
// A save stores the cleaned PNGs (never the upload) under a fresh set id,
// then runs `add_avatar` with them in `ctx.avatarImage`; if that refuses,
// the files are deleted again. The answer never holds a raw Blob URL.
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
  "That upload is too large (4 MB at most, every file together).",
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

  const files = form.getAll("image");
  if (
    files.length === 0 ||
    files.some((f) => !(f instanceof File) || f.size === 0)
  ) {
    return refuse(400, fail("INVALID_INPUT", "Choose an image to upload."));
  }
  if (files.length > SHEET_MAX_FIGURES) {
    return refuse(
      400,
      fail(
        "INVALID_INPUT",
        "A set has three poses at most: idle, walk, emote.",
      ),
    );
  }
  const images = files as File[];
  if (images.some((f) => !isPhotoType(f.type))) {
    return refuse(
      415,
      fail("INVALID_INPUT", "Each image must be a PNG, JPEG or WebP file."),
    );
  }
  const total = images.reduce((n, f) => n + f.size, 0);
  if (total > AVATAR_UPLOAD_MAX_BYTES) return refuse(413, TOO_LARGE);

  // The admin gate, then the cleaning, through the registry.
  const cleaned = await deps.runAction(
    "preview_avatar",
    { height: field(form, "height") },
    {
      ...ctx,
      avatarUpload: {
        files: await Promise.all(
          images.map(async (f) => new Uint8Array(await f.arrayBuffer())),
        ),
      },
    },
  );
  if (!cleaned.ok || !save) return respond(cleaned);

  // Which figure is which pose: the admin's choice, or left to right.
  const { figures } = cleaned.data as PreviewAvatarData;
  const assigned = parsePoses(field(form, "poses"), figures.length);
  if (typeof assigned === "string") {
    return refuse(400, fail("INVALID_INPUT", assigned));
  }

  const avatarId = (deps.newAvatarId ?? randomUUID)().toLowerCase();
  const randomName = deps.randomName ?? (() => randomBytes(8).toString("hex"));
  const poses: NonNullable<RequestCtx["avatarImage"]>["poses"] = {};
  const stored: string[] = [];
  const unstore = () =>
    Promise.all(stored.map((pathname) => deps.store.del(pathname)));
  for (const [n, pose] of assigned.entries()) {
    if (pose === "skip") continue;
    const f = figures[n]!;
    const pathname = avatarPathname(avatarId, `${randomName()}${n}`);
    const png = Buffer.from(f.preview.slice(PNG_DATA_URL.length), "base64");
    const put = await deps.store.put(
      pathname,
      new Blob([png], { type: "image/png" }),
      "image/png",
    );
    if (!put.ok) {
      await unstore();
      return put.reason === "not_configured"
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
    stored.push(pathname);
    poses[pose] = { pathname, width: f.width, height: f.height };
  }

  const result = await deps.runAction(
    "add_avatar",
    { name: field(form, "name") ?? "" },
    { ...ctx, avatarImage: { avatarId, poses } },
  );
  // Refused, or a replay of an earlier request that stored its own files:
  // these files belong to nothing, so they go.
  const used =
    result.ok && (result.data as { avatarId?: string }).avatarId === avatarId;
  if (!used) await unstore();
  return respond(result);
}

type Assigned = AvatarPose | "skip";

/**
 * `poses` as sent ("idle,walk,emote", "walk,idle", "idle,skip,emote"): one
 * per figure, exactly one idle, no pose twice. Unsent, the figures are
 * idle, walk and emote in order. A sentence for the admin when it is wrong.
 */
export function parsePoses(
  raw: string | undefined,
  count: number,
): Assigned[] | string {
  const list = raw
    ? raw.split(",").map((p) => p.trim())
    : AVATAR_POSES.slice(0, count);
  if (list.length !== count) {
    return `Say which pose each of the ${count} figures is.`;
  }
  const valid = new Set<string>([...AVATAR_POSES, "skip"]);
  if (list.some((p) => !valid.has(p))) {
    return "A pose is idle, walk or emote (or skip).";
  }
  const kept = list.filter((p) => p !== "skip");
  if (!kept.includes("idle")) return "One figure must be the idle pose.";
  if (new Set(kept).size !== kept.length) {
    return "Each pose can only be one figure.";
  }
  return list as Assigned[];
}
