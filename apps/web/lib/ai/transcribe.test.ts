// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WHISPER_MODEL } from "@baumy/ai-prompts";
import {
  allowAll,
  ctxFor,
  kioskActor,
  sessionActor,
} from "@/test-utils/actions";
import {
  transcriber,
  type TranscribeRequest,
  type Transcriber,
} from "@/lib/integrations/groq";
import type { RateLimiter } from "@/lib/rate-limit";
import {
  TRANSCRIBE_MAX_BYTES,
  TRANSCRIBE_TIMEOUT_MS,
  audioExtension,
  handleTranscribe,
  type TranscribeRouteDeps,
} from "./transcribe";

// POST /api/ai/transcribe with a mocked Groq (the real adapter over a fake
// fetch): who may send a clip, the size and type limits, what Groq is sent,
// how its failures read, and the ai_usage row for each clip it answered.

const RYAN = "00000000-0000-4000-8000-0000000000a1";

let fetchMock: ReturnType<typeof vi.fn>;
let who: "phone" | "kiosk-nobody" | "kiosk-ryan" | "nobody";

function groqAnswers(body: unknown, status = 200) {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

beforeEach(() => {
  who = "phone";
  fetchMock = vi.fn();
  groqAnswers({ text: " I took the trash out ", duration: 2.2 });
});

function deps(over: Partial<TranscribeRouteDeps> = {}): TranscribeRouteDeps {
  return {
    requestCtx: async (surface) => {
      if (who === "nobody") return null;
      if (surface === "kiosk" || who.startsWith("kiosk")) {
        return ctxFor(kioskActor(who === "kiosk-ryan" ? RYAN : undefined));
      }
      return ctxFor(sessionActor(RYAN));
    },
    loadHousehold: async () => ({
      members: [{ id: RYAN, displayName: "Ryan" }],
      chores: [{ id: "c1", name: "Trash" }],
    }),
    transcriber: () =>
      transcriber(
        { GROQ_API_KEY: "gsk_test" },
        fetchMock as unknown as typeof fetch,
      ),
    rateLimiter: allowAll,
    recordAudio: vi.fn(async () => {}),
    logError: vi.fn(),
    ...over,
  };
}

function clip(
  type = "audio/webm;codecs=opus",
  bytes: number | Uint8Array = 2048,
): File {
  const data = typeof bytes === "number" ? new Uint8Array(bytes) : bytes;
  return new File([data as BlobPart], "clip", { type });
}

function post(
  fields: Record<string, string | File> = { audio: clip() },
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/ai/transcribe", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", ...headers },
    body: form,
  });
}

async function read(res: Response) {
  return (await res.json()) as {
    ok: boolean;
    code?: string;
    message?: string;
    data?: { text: string };
  };
}

describe("POST /api/ai/transcribe", () => {
  it("sends the clip to Whisper with the household's words and answers the text", async () => {
    const d = deps();
    const res = await handleTranscribe(post(), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await read(res)).toEqual({
      ok: true,
      data: { text: "I took the trash out" },
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const form = init.body as FormData;
    expect(form.get("model")).toBe(WHISPER_MODEL);
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("temperature")).toBe("0");
    const prompt = String(form.get("prompt"));
    expect(prompt).toContain("Ryan, Trash,");
    expect(prompt).toContain("Küche");
    expect((form.get("file") as File).name).toBe("clip.webm");
    expect(d.recordAudio).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ai" }),
      WHISPER_MODEL,
      2.2,
    );
  });

  it("takes Safari's mp4 recording from the kiosk's acting member", async () => {
    who = "kiosk-ryan";
    const res = await handleTranscribe(
      post({ audio: clip("audio/mp4"), surface: "kiosk" }),
      deps(),
    );
    expect(res.status).toBe(200);
    const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    expect((form.get("file") as File).name).toBe("clip.mp4");
  });

  it("refuses a cross-site request before reading anything", async () => {
    const d = deps();
    const res = await handleTranscribe(
      post(undefined, { "sec-fetch-site": "cross-site" }),
      d,
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a signed-in member, and on the kiosk a tapped avatar", async () => {
    who = "nobody";
    let res = await handleTranscribe(post(), deps());
    expect(res.status).toBe(401);
    expect((await read(res)).code).toBe("UNAUTHENTICATED");
    who = "kiosk-nobody";
    res = await handleTranscribe(
      post({ audio: clip(), surface: "kiosk" }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect((await read(res)).message).toBe(
      "Tap your avatar first, then ask Baumy.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 501 without GROQ_API_KEY, and calls nobody", async () => {
    const d = deps({ transcriber: () => transcriber({}) });
    const res = await handleTranscribe(post(), d);
    expect(res.status).toBe(501);
    expect((await read(res)).code).toBe("NOT_CONFIGURED");
    expect(d.recordAudio).not.toHaveBeenCalled();
  });

  it("limits each member's clips", async () => {
    const limiter: RateLimiter = {
      limit: vi.fn(async () => ({ ok: false, retryAfterSeconds: 42 })),
    };
    const res = await handleTranscribe(post(), deps({ rateLimiter: limiter }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await read(res)).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 42,
    });
    expect(limiter.limit).toHaveBeenCalledWith(
      `transcribe:member:${RYAN}`,
      expect.objectContaining({ limit: 30 }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a missing, empty or unreadable upload", async () => {
    for (const fields of [
      {},
      { audio: clip("audio/webm", 0) },
      { audio: "x" },
    ]) {
      const res = await handleTranscribe(post(fields), deps());
      expect(res.status).toBe(400);
      expect((await read(res)).code).toBe("INVALID_INPUT");
    }
    const notForm = new Request("http://localhost/api/ai/transcribe", {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect((await handleTranscribe(notForm, deps())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a clip over 20 MB, by its header or its size", async () => {
    let res = await handleTranscribe(
      post(undefined, { "content-length": String(TRANSCRIBE_MAX_BYTES * 2) }),
      deps(),
    );
    expect(res.status).toBe(413);
    res = await handleTranscribe(
      post({ audio: clip("audio/webm", TRANSCRIBE_MAX_BYTES + 1) }),
      deps(),
    );
    expect(res.status).toBe(413);
    expect((await read(res)).code).toBe("INVALID_INPUT");
    // Exactly 20 MB is allowed.
    res = await handleTranscribe(
      post({ audio: clip("audio/webm", TRANSCRIBE_MAX_BYTES) }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a type outside the audio allow-list", async () => {
    for (const type of ["image/png", "text/plain", "application/ogg", ""]) {
      const res = await handleTranscribe(post({ audio: clip(type) }), deps());
      expect(res.status).toBe(415);
      expect((await read(res)).code).toBe("INVALID_INPUT");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Groq's 401 to INVALID_KEY without passing its body on", async () => {
    groqAnswers({ error: { message: "Invalid API Key gsk_test" } }, 401);
    const d = deps();
    const res = await handleTranscribe(post(), d);
    expect(res.status).toBe(502);
    const b = await read(res);
    expect(b.code).toBe("INVALID_KEY");
    expect(b.message).toContain("GROQ_API_KEY");
    expect(JSON.stringify(b)).not.toContain("gsk_test");
    expect(d.logError).toHaveBeenCalledWith(
      "[ai:transcribe] failed",
      "invalid_key (HTTP 401)",
    );
    expect(d.recordAudio).not.toHaveBeenCalled();
  });

  it("answers 503 when Groq is down and 504 when it runs out of time", async () => {
    groqAnswers({}, 503);
    let res = await handleTranscribe(post(), deps());
    expect(res.status).toBe(503);
    expect((await read(res)).code).toBe("UNAVAILABLE");

    const slow: Transcriber = {
      ok: true,
      kind: "fake",
      model: WHISPER_MODEL,
      transcribe: vi.fn(async (_req: TranscribeRequest) => ({
        ok: false as const,
        reason: "timeout" as const,
      })),
    };
    res = await handleTranscribe(post(), deps({ transcriber: () => slow }));
    expect(res.status).toBe(504);
    expect((await read(res)).code).toBe("AI_TIMEOUT");
    expect(slow.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: TRANSCRIBE_TIMEOUT_MS }),
    );
    expect(TRANSCRIBE_TIMEOUT_MS).toBe(30_000);
  });

  it("records a silent clip's seconds, then says nothing was heard", async () => {
    groqAnswers({ text: "  ", duration: 1.1 });
    const d = deps();
    const res = await handleTranscribe(post(), d);
    expect(res.status).toBe(422);
    expect((await read(res)).code).toBe("NO_SPEECH");
    expect(d.recordAudio).toHaveBeenCalledWith(
      expect.anything(),
      WHISPER_MODEL,
      1.1,
    );
  });

  it("still answers the text when the usage row cannot be written", async () => {
    const d = deps({
      recordAudio: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const res = await handleTranscribe(post(), d);
    expect(res.status).toBe(200);
    expect(d.logError).toHaveBeenCalledWith(
      "[ai:transcribe] could not record usage",
      expect.any(Error),
    );
  });
});

describe("audioExtension", () => {
  it("names the container Groq reads for each allowed type", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("video/webm")).toBe("webm");
    expect(audioExtension("AUDIO/MP4; codecs=mp4a.40.2")).toBe("mp4");
    expect(audioExtension("video/mp4")).toBe("mp4");
    expect(audioExtension("audio/x-m4a")).toBe("m4a");
    expect(audioExtension("audio/mpeg")).toBe("mp3");
    expect(audioExtension("audio/ogg")).toBe("ogg");
    expect(audioExtension("audio/wav")).toBe("wav");
    expect(audioExtension("audio/flac")).toBe("flac");
    expect(audioExtension("audio/aac")).toBeNull();
    expect(audioExtension("")).toBeNull();
  });
});
