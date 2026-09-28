import { handleStart } from "@/lib/login-approval/flow";
import { loginApprovalDeps } from "@/lib/login-approval/wiring";

// "Sign in with Baumy" (issue #80): start a request for an address. The same
// answer for every address; lib/login-approval/flow.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleStart(req, loginApprovalDeps());
}
