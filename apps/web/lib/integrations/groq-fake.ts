import "server-only";

import type { TranscribeRequest, TranscribeResult } from "./groq";

// The E2E fake transcriber (SPEC §10), for E2E_TEST_MODE=1. The browser in
// e2e records Chromium's fake microphone (a beep), so there are no words to
// hear: every clip "says" the same question, which the scripted fake Claude
// answers from the standings. The route around it (the limits, the member,
// the ai_usage row) and the sheet's flow are the real ones.

export const FAKE_TRANSCRIPT = "Who's winning?";

/** Seconds billed for a fake clip. */
export const FAKE_AUDIO_SECONDS = 1.5;

export async function fakeTranscribe(
  req: TranscribeRequest,
): Promise<TranscribeResult> {
  if (req.audio.size === 0) {
    return { ok: true, text: "", audioSeconds: 0 };
  }
  return { ok: true, text: FAKE_TRANSCRIPT, audioSeconds: FAKE_AUDIO_SECONDS };
}
