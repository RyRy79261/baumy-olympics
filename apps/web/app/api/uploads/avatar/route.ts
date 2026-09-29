import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { handleAvatarUpload } from "@/lib/avatars/upload";
import { blobStore } from "@/lib/photos/blob-store";
import { rateLimiter } from "@/lib/rate-limit";

// Clean an image for the avatar gallery, and keep it (issue #111). The logic,
// and why only the cleaned sprite is stored, is lib/avatars/upload.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleAvatarUpload(req, {
    requestCtx: (requestId) => uiRequestCtx(requestId),
    runAction: (name, input, ctx) => runAction(name, input, ctx),
    store: blobStore(),
    rateLimiter,
  });
}
