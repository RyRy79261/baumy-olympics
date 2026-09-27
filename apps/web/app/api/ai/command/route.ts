import { handleCommand } from "@/lib/ai/routes";
import { commandRouteDeps } from "@/lib/ai/wiring";

// The Baumy command (SPEC §3.6, §6.3): Claude with the registry's `ai`
// tools. Reads run in the loop; writes come back as proposals to approve.
// The logic is lib/ai/routes.ts and lib/ai/command.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The command's own deadline is 50s (lib/ai/command.ts), under this.
export const maxDuration = 60;

export function POST(req: Request): Promise<Response> {
  return handleCommand(req, commandRouteDeps());
}
