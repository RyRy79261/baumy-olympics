import { handleListActions } from "@/lib/brain/endpoint";
import { brainEndpointDeps } from "@/lib/brain/wiring";

// The brain tool list (SPEC §6.3, issue #27): what baumy-brain may call, with
// each action's JSON Schema and `risk`. docs/brain-integration.md.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleListActions(req, brainEndpointDeps());
}
