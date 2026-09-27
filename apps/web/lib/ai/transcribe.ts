import "server-only";

import { transcriptionPrompt } from "@baumy/ai-prompts";
import type { RequestCtx } from "@/lib/actions/define";
import { fail } from "@/lib/actions/result";
import { rejectCrossSite } from "@/lib/http/origin";
import type { Transcriber } from "@/lib/integrations/groq";
import type { RateLimiter } from "@/lib/rate-limit";
import { aiCtx, respond, type AiRouteDeps } from "./routes";

// POST /api/ai/transcribe (SPEC §3.6, issue #22), ported from intake-tracker
// `apps/web/src/app/api/ai/voice-transcribe/route.ts`: a held-to-speak clip
// in, the words out, which the sheet then sends to /api/ai/command as if
// typed. Multipart form: `audio` (the clip) and `surface` (`ui` | `kiosk`).
//
// In order: the Origin check, who is asking (a member, as on the command),
// the transcriber (none → 501, and the sheet hides the microphone), a
// per-member rate limit, then the clip: present, at most 20 MB, and one of
// the audio types the browsers record and Groq reads. Groq gets 30 seconds.
// Each clip Groq answered adds a `groq` row to `ai_usage` with its seconds.
//
//   → {ok: true, data: {text}}
//   → {ok: false, code, message}: INVALID_INPUT (400, 413, 415), NO_SPEECH
//     (422), RATE_LIMITED (429), NOT_CONFIGURED (501), INVALID_KEY (502:
//     GROQ_API_KEY was refused), UNAVAILABLE (503), AI_TIMEOUT (504).

export const TRANSCRIBE_MAX_BYTES = 20 * 1024 * 1024;
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** Room in a request for the form around the clip. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
export const TRANSCRIBE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

/**
 * The audio types allowed, and the file extension Groq reads each as. The
 * browsers record webm/opus (Chrome, Firefox) or mp4/AAC (Safari on iPad
 * and iPhone), sometimes labelled as video.
 */
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "video/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

/** The file extension for an allowed audio type, or null. */
export function audioExtension(type: string): string | null {
  const base = type.split(";")[0]!.trim().toLowerCase();
  return AUDIO_TYPES[base] ?? null;
}

export interface TranscribeRouteDeps {
  requestCtx: AiRouteDeps["requestCtx"];
  loadHousehold: AiRouteDeps["loadHousehold"];
  transcriber: () => Transcriber;
  rateLimiter: RateLimiter;
  /** Add the clip's `ai_usage` row. */
  recordAudio: (
    ctx: RequestCtx,
    model: string,
    audioSeconds: number | null,
  ) => Promise<void>;
  logError: (message: string, err: unknown) => void;
}

const TOO_LARGE = fail(
  "INVALID_INPUT",
  "That recording is too long. Keep it under a minute.",
);

export async function handleTranscribe(
  req: Request,
  deps: TranscribeRouteDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const declared = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > TRANSCRIBE_MAX_BYTES + FORM_OVERHEAD_BYTES
  ) {
    return respond(413, TOO_LARGE);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return respond(
      400,
      fail("INVALID_INPUT", "That recording did not arrive. Try again."),
    );
  }

  const surface = form.get("surface") === "kiosk" ? "kiosk" : "ui";
  const ctx = await aiCtx(deps, surface);
  if (ctx instanceof Response) return ctx;

  const t = deps.transcriber();
  if (!t.ok) {
    return respond(
      501,
      fail(
        "NOT_CONFIGURED",
        "Speaking to Baumy isn't set up on this deployment. Type instead.",
      ),
    );
  }

  const rl = await deps.rateLimiter.limit(
    `transcribe:member:${ctx.actor.memberId}`,
    TRANSCRIBE_LIMIT,
  );
  if (!rl.ok) {
    return new Response(
      JSON.stringify(
        fail(
          "RATE_LIMITED",
          "That's a lot of talking. Wait a few minutes, or type instead.",
          { retryAfterSeconds: rl.retryAfterSeconds },
        ),
      ),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "retry-after": String(rl.retryAfterSeconds),
        },
      },
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return respond(
      400,
      fail("INVALID_INPUT", "Baumy got an empty recording. Hold and speak."),
    );
  }
  if (audio.size > TRANSCRIBE_MAX_BYTES) return respond(413, TOO_LARGE);
  const ext = audioExtension(audio.type);
  if (!ext) {
    return respond(
      415,
      fail(
        "INVALID_INPUT",
        "Baumy can't play that kind of recording. Type instead.",
      ),
    );
  }

  const household = await deps.loadHousehold(ctx);
  const result = await t.transcribe({
    audio,
    filename: `clip.${ext}`,
    prompt: transcriptionPrompt({
      members: household.members.map((m) => m.displayName),
      chores: household.chores.map((c) => c.name),
    }),
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
  });

  if (!result.ok) {
    deps.logError(
      "[ai:transcribe] failed",
      `${result.reason}${result.status ? ` (HTTP ${result.status})` : ""}`,
    );
    if (result.reason === "invalid_key") {
      return respond(502, {
        ok: false,
        code: "INVALID_KEY",
        message:
          "Baumy's connection to Groq was refused. An admin needs to check the GROQ_API_KEY setting.",
      });
    }
    if (result.reason === "timeout") {
      return respond(504, {
        ok: false,
        code: "AI_TIMEOUT",
        message: "Baumy took too long to listen. Try again, or type instead.",
      });
    }
    return respond(
      503,
      fail(
        "UNAVAILABLE",
        "Baumy can't listen right now. Try again in a minute, or type instead.",
      ),
    );
  }

  try {
    await deps.recordAudio(ctx, t.model, result.audioSeconds);
  } catch (err) {
    deps.logError("[ai:transcribe] could not record usage", err);
  }

  if (!result.text) {
    return respond(422, {
      ok: false,
      code: "NO_SPEECH",
      message: "Baumy didn't catch any words. Hold the button and speak.",
    });
  }
  return respond(200, { ok: true, data: { text: result.text } });
}
