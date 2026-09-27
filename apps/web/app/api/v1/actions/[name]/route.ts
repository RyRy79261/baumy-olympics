import { handleBrainAction } from "@/lib/brain/endpoint";
import { brainEndpointDeps } from "@/lib/brain/wiring";

// Run one action for baumy-brain (SPEC §6.3, ADR 0003, issue #27): service
// token, Telegram actor, confirm header and idempotency key are checked in
// lib/brain/endpoint.ts, then it is runAction with source `brain`.
// docs/brain-integration.md is the contract.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/v1/actions/[name]">,
): Promise<Response> {
  const { name } = await ctx.params;
  return handleBrainAction(req, name, brainEndpointDeps());
}
