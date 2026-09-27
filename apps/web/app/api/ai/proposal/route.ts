import { handleProposal } from "@/lib/ai/routes";
import { proposalRouteDeps } from "@/lib/ai/wiring";

// Re-check and re-preview a proposal the member edited in the Baumy sheet
// (SPEC §3.6). Nothing runs; approving goes through /api/actions/run.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleProposal(req, proposalRouteDeps());
}
