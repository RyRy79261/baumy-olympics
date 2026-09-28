import "server-only";

import { cookies } from "next/headers";
import type { TranscribeRequest, TranscribeResult } from "./groq";

// The E2E fake transcriber (SPEC §10), for E2E_TEST_MODE=1. The browser in
// e2e records Chromium's fake microphone (a beep), so there are no words to
// hear: every clip "says" the same question, which the scripted fake Claude
// answers from the standings. The route around it (the limits, the member,
// the ai_usage row) and the sheet's flow are the real ones.
//
// A spec that needs other words (the kitchen cat's "I cleaned the bins")
// sets the cookie `baumy_e2e_transcript` in its own browser: its clips say
// that instead, and other browsers are unaffected.

export const FAKE_TRANSCRIPT = "Who's winning?";

/** The cookie a spec sets to choose what its clips say. */
export const FAKE_TRANSCRIPT_COOKIE = "baumy_e2e_transcript";

/** Seconds billed for a fake clip. */
export const FAKE_AUDIO_SECONDS = 1.5;

async function askedFor(): Promise<string | null> {
  try {
    const said = (await cookies()).get(FAKE_TRANSCRIPT_COOKIE)?.value;
    return said ? decodeURIComponent(said) : null;
  } catch {
    // Outside a request (a unit test): the usual question.
    return null;
  }
}

export async function fakeTranscribe(
  req: TranscribeRequest,
): Promise<TranscribeResult> {
  if (req.audio.size === 0) {
    return { ok: true, text: "", audioSeconds: 0 };
  }
  return {
    ok: true,
    text: (await askedFor()) ?? FAKE_TRANSCRIPT,
    audioSeconds: FAKE_AUDIO_SECONDS,
  };
}
