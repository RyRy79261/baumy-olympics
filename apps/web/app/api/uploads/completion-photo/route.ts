import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { blobStore } from "@/lib/photos/blob-store";
import { handleCompletionPhotoUpload } from "@/lib/photos/upload";
import { rateLimiter } from "@/lib/rate-limit";

// Upload a completion photo and attach it, or log a claim with it (SPEC
// §6.5). The logic, and why it stores first, is lib/photos/upload.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleCompletionPhotoUpload(req, {
    requestCtx: (surface, requestId, pin) =>
      surface === "kiosk"
        ? kioskRequestCtx(requestId, pin)
        : uiRequestCtx(requestId),
    runAction: (name, input, ctx) => runAction(name, input, ctx),
    store: blobStore(),
    rateLimiter,
  });
}
