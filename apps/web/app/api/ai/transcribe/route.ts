import { transcribeRouteDeps } from "@/lib/ai/wiring";
import { handleTranscribe } from "@/lib/ai/transcribe";

// Speech to text for the Baumy sheet (SPEC §3.6, issue #22): a held-to-speak
// clip in, its words out, through Groq Whisper. The logic and its limits are
// lib/ai/transcribe.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Groq gets 30 seconds (TRANSCRIBE_TIMEOUT_MS), under this.
export const maxDuration = 45;

export function POST(req: Request): Promise<Response> {
  return handleTranscribe(req, transcribeRouteDeps());
}
