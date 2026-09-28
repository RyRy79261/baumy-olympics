import { handleExchange } from "@/lib/login-approval/flow";
import { loginApprovalDeps } from "@/lib/login-approval/wiring";

// "Sign in with Baumy" (issue #80): trade this browser's approved request for
// a session, once. lib/login-approval/flow.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleExchange(req, loginApprovalDeps());
}
