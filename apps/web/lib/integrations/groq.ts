import "server-only";

import { WHISPER_MODEL } from "@baumy/ai-prompts";
import { isTestMode } from "@/lib/test-mode";
import { fakeTranscribe } from "./groq-fake";

// Speech to text through Groq Whisper (SPEC §3.6, issue #22), after
// intake-tracker `apps/web/src/app/api/ai/voice-transcribe/route.ts`. Which
// transcriber this environment gets: the fake under E2E_TEST_MODE=1, Groq
// when GROQ_API_KEY is set, and otherwise `not_configured`, so the sheet
// hides the microphone and Baumy is typed to instead.
//
// Like every integration it never throws: a refused key, a timeout and an
// outage are results, and what is kept of a failure is its HTTP status,
// never the provider's body (it can echo the request).

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

export interface TranscribeRequest {
  audio: Blob;
  /** Groq sniffs the container from the file name's extension. */
  filename: string;
  /** Whisper's vocabulary hint (`transcriptionPrompt`). */
  prompt: string;
  timeoutMs: number;
}

export type TranscribeResult =
  | {
      ok: true;
      text: string;
      /** The clip's length as Groq measured it; null when it said nothing. */
      audioSeconds: number | null;
    }
  | {
      ok: false;
      reason: "invalid_key" | "timeout" | "unavailable";
      status?: number;
    };

export type Transcriber =
  | {
      ok: true;
      kind: "groq" | "fake";
      model: string;
      transcribe: (req: TranscribeRequest) => Promise<TranscribeResult>;
    }
  | { ok: false; reason: "not_configured" };

type EnvBag = Readonly<Record<string, string | undefined>>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** One call to Groq's OpenAI-compatible transcription endpoint. */
export async function groqTranscribe(
  key: string,
  req: TranscribeRequest,
  fetchImpl: FetchLike = fetch,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", req.audio, req.filename);
  form.append("model", WHISPER_MODEL);
  form.append("prompt", req.prompt);
  // verbose_json carries `duration`, the seconds Groq bills.
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(GROQ_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
  } catch {
    return controller.signal.aborted
      ? { ok: false, reason: "timeout" }
      : { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "invalid_key", status: res.status };
  }
  if (!res.ok) return { ok: false, reason: "unavailable", status: res.status };

  let body: { text?: unknown; duration?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, reason: "unavailable", status: res.status };
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const audioSeconds =
    typeof body?.duration === "number" &&
    Number.isFinite(body.duration) &&
    body.duration >= 0
      ? body.duration
      : null;
  return { ok: true, text, audioSeconds };
}

let override: Transcriber | null = null;

/** Unit tests only: answer with this transcriber until reset with null. */
export function setTranscriberForTests(t: Transcriber | null): void {
  override = t;
}

export function transcriber(
  env: EnvBag = process.env,
  fetchImpl: FetchLike = fetch,
): Transcriber {
  if (override) return override;
  if (isTestMode(env)) {
    return {
      ok: true,
      kind: "fake",
      model: WHISPER_MODEL,
      transcribe: fakeTranscribe,
    };
  }
  const key = env.GROQ_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };
  return {
    ok: true,
    kind: "groq",
    model: WHISPER_MODEL,
    transcribe: (req) => groqTranscribe(key, req, fetchImpl),
  };
}

/** Whether the sheet may offer the microphone on this deployment. */
export function voiceConfigured(env: EnvBag = process.env): boolean {
  return transcriber(env).ok;
}
