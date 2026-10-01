import { handleExchange } from "@/lib/kiosk/pairing";
import { kioskPairingDeps } from "@/lib/kiosk/pairing-wiring";

// Pairing the kitchen iPad (issue #126): trade this iPad's approved request
// for the device cookie, once. lib/kiosk/pairing.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleExchange(req, kioskPairingDeps());
}
