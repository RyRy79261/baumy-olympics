import { handleStart } from "@/lib/kiosk/pairing";
import { kioskPairingDeps } from "@/lib/kiosk/pairing-wiring";

// Pairing the kitchen iPad (issue #126): the unpaired iPad asks for a code to
// show as a QR code. lib/kiosk/pairing.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleStart(req, kioskPairingDeps());
}
