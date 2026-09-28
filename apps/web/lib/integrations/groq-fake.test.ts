// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The fake transcriber's per-browser words (e2e only): a spec's cookie
// chooses what its clips say, and without it every clip asks the question.

const jar: { value?: string; throws?: boolean } = {};
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (jar.throws) throw new Error("outside a request");
    return {
      get: (name: string) =>
        name === "baumy_e2e_transcript" && jar.value !== undefined
          ? { name, value: jar.value }
          : undefined,
    };
  },
}));

const { FAKE_TRANSCRIPT, FAKE_TRANSCRIPT_COOKIE, fakeTranscribe } =
  await import("./groq-fake");

const clip = () => ({
  audio: new Blob(["clip"]),
  filename: "clip.webm",
  prompt: "",
  timeoutMs: 1000,
});

beforeEach(() => {
  jar.value = undefined;
  jar.throws = false;
});

describe("fakeTranscribe's cookie", () => {
  it("says what the browser's cookie asks for", async () => {
    expect(FAKE_TRANSCRIPT_COOKIE).toBe("baumy_e2e_transcript");
    jar.value = encodeURIComponent("I cleaned the Bins x1");
    expect(await fakeTranscribe(clip())).toMatchObject({
      ok: true,
      text: "I cleaned the Bins x1",
    });
  });

  it("asks the usual question without it, or outside a request", async () => {
    expect(await fakeTranscribe(clip())).toMatchObject({
      text: FAKE_TRANSCRIPT,
    });
    jar.throws = true;
    jar.value = "ignored";
    expect(await fakeTranscribe(clip())).toMatchObject({
      text: FAKE_TRANSCRIPT,
    });
  });
});
