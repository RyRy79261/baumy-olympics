import { handleRunAction } from "@/lib/ai/routes";
import { runRouteDeps } from "@/lib/ai/wiring";

// Run a proposal the member approved in the Baumy sheet (SPEC §6.3):
// runAction with source `ai`, the proposal id as the idempotency key, and on
// the kiosk the acting member's PIN for that one request.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleRunAction(req, runRouteDeps());
}
