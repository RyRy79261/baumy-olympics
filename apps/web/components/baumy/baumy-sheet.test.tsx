import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Speaking to Baumy in the sheet (SPEC §3.6, issue #22): the microphone is
// offered only with a transcriber and a browser that can record; a blocked
// microphone hides it and hands over to typing; a clip's transcript goes
// into the command flow, and the sprite follows along.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { BaumySheet } = await import("./baumy-sheet");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has <dialog> without the modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

class FakeRecorder {
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    public opts: { mimeType: string },
  ) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["clip"], { type: this.opts.mimeType }),
    });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();
const fetchMock = vi.fn();

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

let root: Root | null = null;
beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop() {} }] });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function mount(voice: boolean) {
  const div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() => root!.render(<BaumySheet voice={voice} />));
  const open = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Baumy"]',
  )!;
  act(() => open.click());
}

const mic = () =>
  [...document.querySelectorAll("button")].find((b) =>
    /Hold to speak|Tap to send|Release to send/.test(b.textContent ?? ""),
  );
const baumy = () =>
  document
    .querySelector('[data-testid="baumy-says"]')!
    .parentElement!.querySelector("[data-sprite]")!
    .getAttribute("data-state");

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("BaumySheet voice", () => {
  it("offers the microphone with a transcriber and a browser that records", () => {
    mount(true);
    expect(mic()).toBeDefined();
    expect(document.querySelector("#baumy-text")).not.toBeNull();
  });

  it("hides the microphone without a transcriber (no GROQ_API_KEY)", () => {
    mount(false);
    expect(document.querySelector("#baumy-text")).not.toBeNull();
    expect(mic()).toBeUndefined();
  });

  it("hides it where the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    mount(true);
    expect(document.querySelector("#baumy-text")).not.toBeNull();
    expect(mic()).toBeUndefined();
  });

  it("falls back to typing when the microphone is denied", async () => {
    getUserMedia.mockRejectedValue(new DOMException("no", "NotAllowedError"));
    mount(true);
    await act(async () => mic()!.click());
    await settle();
    expect(mic()).toBeUndefined();
    expect(document.body.textContent).toContain(
      "The microphone is blocked, so type to Baumy instead.",
    );
    expect(document.activeElement?.id).toBe("baumy-text");
    expect(baumy()).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the transcript into the command flow", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/ai/transcribe"
        ? json({ ok: true, data: { text: "Who's winning?" } })
        : json({
            ok: true,
            data: {
              reply: "Ryan is winning with 20 points.",
              proposals: [],
              choices: { members: [], chores: [] },
            },
          }),
    );
    mount(true);
    await act(async () => mic()!.click());
    await settle();
    expect(mic()!.textContent).toContain("Tap to send");
    expect(mic()!.getAttribute("aria-pressed")).toBe("true");
    expect(baumy()).toBe("listening");
    await settle(300);
    await act(async () => mic()!.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tUrl, tInit] = fetchMock.mock.calls[0]!;
    expect(tUrl).toBe("/api/ai/transcribe");
    const form = (tInit as RequestInit).body as FormData;
    expect((form.get("audio") as File).type).toBe("audio/webm;codecs=opus");
    expect((form.get("audio") as File).name).toBe("clip.webm");
    expect(form.get("surface")).toBe("ui");
    const [cUrl, cInit] = fetchMock.mock.calls[1]!;
    expect(cUrl).toBe("/api/ai/command");
    expect(JSON.parse(String((cInit as RequestInit).body))).toMatchObject({
      text: "Who's winning?",
      surface: "ui",
    });
    expect(
      document.querySelector('[data-testid="baumy-heard"]')!.textContent,
    ).toContain("Who's winning?");
    expect(
      document.querySelector('[data-testid="baumy-says"]')!.textContent,
    ).toBe("Ryan is winning with 20 points.");
    expect(baumy()).toBe("talking");
  });

  it("turns the microphone off when the sheet closes during the permission prompt", async () => {
    const stop = vi.fn();
    let grant!: (stream: unknown) => void;
    getUserMedia.mockReturnValue(
      new Promise((r) => {
        grant = r;
      }),
    );
    const started = vi.spyOn(FakeRecorder.prototype, "start");
    mount(true);
    await act(async () => mic()!.click());
    const close = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Close",
    )!;
    await act(async () => close.click());
    await act(async () => grant({ getTracks: () => [{ stop }] }));
    await settle(300);
    expect(stop).toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    started.mockRestore();
  });

  it("drops a clip too short to hold words", async () => {
    mount(true);
    await act(async () => mic()!.click());
    await settle();
    await act(async () => mic()!.click());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Hold the button while you speak.",
    );
    expect(baumy()).toBe("idle");
  });

  it("is sad on a failed transcript, and hides the microphone if the key went away", async () => {
    fetchMock.mockResolvedValue(
      json({
        ok: false,
        code: "NOT_CONFIGURED",
        message: "Speaking to Baumy isn't set up on this deployment.",
      }),
    );
    mount(true);
    await act(async () => mic()!.click());
    await settle(300);
    await act(async () => mic()!.click());
    await settle();
    expect(baumy()).toBe("sad");
    expect(
      document.querySelector('[data-testid="baumy-says"]')!.textContent,
    ).toContain("isn't set up");
    expect(mic()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
