import { handleStatus } from "@/lib/login-approval/flow";
import { loginApprovalDeps } from "@/lib/login-approval/wiring";

// "Sign in with Baumy" (issue #80): where this browser's request stands, read
// from its own httpOnly cookie. lib/login-approval/flow.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleStatus(req, loginApprovalDeps());
}
