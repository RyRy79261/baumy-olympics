// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { WHISPER_MODEL } from "@baumy/ai-prompts";
import {
  groqTranscribe,
  setTranscriberForTests,
  transcriber,
  voiceConfigured,
  type TranscribeRequest,
  type Transcriber,
} from "./groq";
import {
  FAKE_AUDIO_SECONDS,
  FAKE_TRANSCRIPT,
  fakeTranscribe,
} from "./groq-fake";

// The Groq adapter with a mocked fetch (SPEC §10): what it sends, and how
// each answer becomes a result: never a throw, never the provider's body.

afterEach(() => setTranscriberForTests(null));

const clip = (): TranscribeRequest => ({
  audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
  filename: "clip.webm",
  prompt: "Baumy Olympics. Ryan, Trash.",
  timeoutMs: 1_000,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("groqTranscribe", () => {
  it("sends the clip, the model, the prompt, verbose_json and temperature 0", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      json({ text: "  I took the trash out ", duration: 2.4 }),
    );
    const r = await groqTranscribe("gsk_test_key", clip(), fetchImpl);
    expect(r).toEqual({
      ok: true,
      text: "I took the trash out",
      audioSeconds: 2.4,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer gsk_test_key" });
    const form = init.body as FormData;
    expect(form.get("model")).toBe(WHISPER_MODEL);
    expect(form.get("prompt")).toBe("Baumy Olympics. Ryan, Trash.");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("temperature")).toBe("0");
    const file = form.get("file") as File;
    expect(file.name).toBe("clip.webm");
    expect(file.size).toBe(3);
  });

  it("maps a refused key (401, 403) to invalid_key", async () => {
    for (const status of [401, 403]) {
      const r = await groqTranscribe("k", clip(), async () =>
        json({ error: { message: "Invalid API Key gsk_secret" } }, status),
      );
      expect(r).toEqual({ ok: false, reason: "invalid_key", status });
    }
  });

  it("maps 429, 5xx and other failures to unavailable", async () => {
    for (const status of [400, 429, 500, 503]) {
      const r = await groqTranscribe("k", clip(), async () => json({}, status));
      expect(r).toEqual({ ok: false, reason: "unavailable", status });
    }
    expect(
      await groqTranscribe("k", clip(), async () => {
        throw new TypeError("fetch failed");
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await groqTranscribe(
        "k",
        clip(),
        async () => new Response("<html>", { status: 200 }),
      ),
    ).toEqual({ ok: false, reason: "unavailable", status: 200 });
  });

  it("gives up at the timeout", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const r = await groqTranscribe("k", { ...clip(), timeoutMs: 5 }, hang);
    expect(r).toEqual({ ok: false, reason: "timeout" });
  });

  it("reads a missing text as empty and a bad duration as unknown", async () => {
    expect(
      await groqTranscribe("k", clip(), async () => json({ duration: -1 })),
    ).toEqual({ ok: true, text: "", audioSeconds: null });
    expect(
      await groqTranscribe("k", clip(), async () =>
        json({ text: "hi", duration: "3" }),
      ),
    ).toEqual({ ok: true, text: "hi", audioSeconds: null });
  });
});

describe("transcriber", () => {
  it("is not configured without GROQ_API_KEY, so the microphone hides", () => {
    expect(transcriber({})).toEqual({ ok: false, reason: "not_configured" });
    expect(transcriber({ GROQ_API_KEY: "  " }).ok).toBe(false);
    expect(voiceConfigured({})).toBe(false);
  });

  it("uses the fake in E2E test mode, even with a key", () => {
    const t = transcriber({ E2E_TEST_MODE: "1", GROQ_API_KEY: "gsk_x" });
    expect(t).toMatchObject({ ok: true, kind: "fake", model: WHISPER_MODEL });
    expect(voiceConfigured({ E2E_TEST_MODE: "1" })).toBe(true);
  });

  it("calls Groq with the key when one is set", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      json({ text: "hallo", duration: 1 }),
    );
    const t = transcriber({ GROQ_API_KEY: " gsk_live " }, fetchImpl);
    expect(t).toMatchObject({ ok: true, kind: "groq" });
    expect(voiceConfigured({ GROQ_API_KEY: "gsk_live" })).toBe(true);
    if (!t.ok) throw new Error("expected a transcriber");
    expect(await t.transcribe(clip())).toEqual({
      ok: true,
      text: "hallo",
      audioSeconds: 1,
    });
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.headers).toEqual({ authorization: "Bearer gsk_live" });
  });

  it("answers with the test override until it is reset", () => {
    const off: Transcriber = { ok: false, reason: "not_configured" };
    setTranscriberForTests(off);
    expect(transcriber({ E2E_TEST_MODE: "1" })).toBe(off);
    setTranscriberForTests(null);
    expect(transcriber({ E2E_TEST_MODE: "1" }).ok).toBe(true);
  });
});

describe("fakeTranscribe", () => {
  it("hears the same question in every clip, and nothing in an empty one", async () => {
    expect(await fakeTranscribe(clip())).toEqual({
      ok: true,
      text: FAKE_TRANSCRIPT,
      audioSeconds: FAKE_AUDIO_SECONDS,
    });
    expect(await fakeTranscribe({ ...clip(), audio: new Blob([]) })).toEqual({
      ok: true,
      text: "",
      audioSeconds: 0,
    });
  });
});
