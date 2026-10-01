import { handleStatus } from "@/lib/kiosk/pairing";
import { kioskPairingDeps } from "@/lib/kiosk/pairing-wiring";

// Pairing the kitchen iPad (issue #126): where this iPad's request stands,
// read from its own httpOnly cookie. lib/kiosk/pairing.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleStatus(req, kioskPairingDeps());
}
