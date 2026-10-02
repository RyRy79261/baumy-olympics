import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMAND_DEADLINE_MS } from "@/lib/ai/command";
import { TRANSCRIBE_TIMEOUT_MS } from "@/lib/ai/transcribe";
import {
  ACTION_TIMEOUT_MS,
  COMMAND_TIMEOUT_MS,
  TRANSCRIBE_CLIENT_TIMEOUT_MS,
  askBaumy,
  recheckProposal,
  runProposal,
  transcribeClip,
} from "./api";
import type { Proposal } from "@/lib/ai/proposal";

// The sheet's requests give up instead of hanging (issue #132 follow-up):
// a stalled request must not keep the kitchen cat thinking, and the
// kiosk's busy flag held, for ever.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * fetch that never answers until its signal aborts; AbortSignal.timeout
 * hands back a signal the test fires, and records the limit asked for.
 */
function stall() {
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  const fetchMock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(init.signal!.reason),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const fire = () =>
    controller.abort(new DOMException("timed out", "TimeoutError"));
  return { timeout, fetchMock, fire };
}

const proposal = {
  proposalId: "p1",
  name: "log_completion",
  input: { choreId: "c1" },
} as unknown as Proposal;

describe("Baumy's requests", () => {
  it("give up on a stalled request with a sentence, each at its own limit", async () => {
    const calls: [() => Promise<unknown>, string, number][] = [
      [
        () => askBaumy("hi", [], "kiosk"),
        "/api/ai/command",
        COMMAND_TIMEOUT_MS,
      ],
      [
        () => transcribeClip(new Blob(["x"]), "audio/mp4", "kiosk"),
        "/api/ai/transcribe",
        TRANSCRIBE_CLIENT_TIMEOUT_MS,
      ],
      [
        () => runProposal(proposal, "kiosk"),
        "/api/actions/run",
        ACTION_TIMEOUT_MS,
      ],
      [
        () => recheckProposal("log_completion", {}, "kiosk"),
        "/api/ai/proposal",
        ACTION_TIMEOUT_MS,
      ],
    ];
    for (const [call, url, ms] of calls) {
      const { timeout, fetchMock, fire } = stall();
      const pending = call();
      expect(fetchMock.mock.calls[0]![0]).toBe(url);
      expect(timeout).toHaveBeenCalledWith(ms);
      fire();
      await expect(pending).resolves.toEqual({
        ok: false,
        code: "UNAVAILABLE",
        message:
          "Baumy took too long to answer. Check the connection and try again.",
      });
      vi.restoreAllMocks();
    }
  });

  it("wait longer than the server's own deadlines, so no answer is cut off", () => {
    expect(COMMAND_TIMEOUT_MS).toBeGreaterThan(COMMAND_DEADLINE_MS);
    expect(TRANSCRIBE_CLIENT_TIMEOUT_MS).toBeGreaterThan(TRANSCRIBE_TIMEOUT_MS);
  });

  it("say Baumy can't be reached when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Load failed"))),
    );
    await expect(askBaumy("hi", [], "ui")).resolves.toMatchObject({
      ok: false,
      message: "Baumy can't be reached. Check the connection and try again.",
    });
  });

  it("pass the answer through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: { text: "hi" } })),
        ),
      ),
    );
    await expect(
      transcribeClip(new Blob(["x"]), "audio/webm", "ui"),
    ).resolves.toEqual({ ok: true, data: { text: "hi" } });
  });
});
