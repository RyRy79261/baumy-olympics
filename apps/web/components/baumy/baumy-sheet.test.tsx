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
vi.mock("@/app/kiosk/actions", () => ({ clearPickAction: vi.fn() }));

const { BaumySheet } = await import("./baumy-sheet");
const { MIN_CLIP_MS } = await import("@/lib/ai/voice");
const NOW = Date.parse("2026-09-28T10:00:00.000Z");
const { closeOpenDialogs } = await import("@/components/kiosk/idle-reset");

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
  vi.useRealTimers();
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
    // Only Date is faked (the timers stay real for settle): the clip lasts
    // exactly as long as we say, however slow the machine is.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mount(true);
    await act(async () => mic()!.click());
    await settle();
    vi.setSystemTime(NOW + MIN_CLIP_MS - 1);
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

// The kitchen dashboard's Baumy (ADR 0005 §1, issue #65; the approved
// prototype's baumy-cat.tsx): the cat is the button and the talking happens
// in its speech bubble, through the same transcribe, command and approve
// calls as the sheet; "Type instead" opens the sheet.
describe("BaumySheet on the kitchen dashboard", () => {
  const proposal = {
    proposalId: "p1",
    name: "log_completion",
    title: "Log a chore",
    input: { choreId: "c1" },
    preview: "Log Bins for Ryan: +10",
    risk: "safe",
    valid: true,
    needsPin: false,
    fields: [],
  };

  let div: HTMLDivElement;
  function mountCat(
    props: { actingName?: string; voice?: boolean; who?: React.ReactNode } = {},
  ) {
    div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    act(() =>
      root!.render(
        <BaumySheet
          kiosk
          cat
          voice={props.voice ?? true}
          actingName={props.actingName}
          who={props.who}
        />,
      ),
    );
  }
  const cat = () =>
    div.querySelector<HTMLButtonElement>('button[aria-label="Ask Baumy"]')!;
  const bubble = () =>
    document.querySelector<HTMLElement>('[data-testid="cat-bubble"]');
  const button = (name: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === name,
    )!;
  const heardAndAnswered = (reply: string, proposals: unknown[]) =>
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/ai/transcribe"
        ? json({ ok: true, data: { text: "I did the bins" } })
        : url === "/api/actions/run"
          ? json({ ok: true, data: { totalPts: 10 } })
          : json({
              ok: true,
              data: {
                reply,
                proposals,
                choices: { members: [], chores: [] },
              },
            }),
    );

  it("is the cat itself, with no plinth", () => {
    mountCat({ actingName: "Ryan" });
    expect(div.querySelectorAll('button[aria-label="Ask Baumy"]')).toHaveLength(
      1,
    );
    expect(cat().querySelector('[data-sprite="baumy"]')).not.toBeNull();
    expect(bubble()).toBeNull();
  });

  it("asks who is talking while nobody is, then is ready once someone is", () => {
    mountCat({ who: <button type="button">Kim</button> });
    act(() => cat().click());
    expect(bubble()!.dataset.mode).toBe("who");
    expect(bubble()!.textContent).toContain("Who's talking?");
    expect(bubble()!.textContent).toContain("Kim");
    act(() =>
      root!.render(
        <BaumySheet kiosk cat voice actingName="Kim" who={<i>Kim</i>} />,
      ),
    );
    expect(bubble()!.dataset.mode).toBe("ready");
    expect(bubble()!.textContent).toContain("Hi Kim.");
    expect(button("Start talking")).toBeDefined();
  });

  it("listens, shows what it understood, and does it on Yes", async () => {
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle();
    expect(bubble()!.dataset.mode).toBe("listening");
    expect(bubble()!.textContent).toContain("Mrrp? I'm listening");
    expect(getUserMedia).toHaveBeenCalled();
    await settle(300);
    await act(async () => button("Done talking").click());
    await settle();
    await settle();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/ai/transcribe",
      "/api/ai/command",
    ]);
    expect(bubble()!.dataset.mode).toBe("answer");
    expect(bubble()!.textContent).toContain("Got it! I'll do this:");
    expect(bubble()!.textContent).toContain("Log Bins for Ryan: +10");
    await act(async () => button("Yes, do it").click());
    await settle(10);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/actions/run");
    expect(refresh).toHaveBeenCalled();
    // Done and scored: the cat says so instead.
    expect(bubble()!.dataset.mode).toBe("says");
    expect(bubble()!.textContent).toBe("Purrfect. +10 for Ryan ✦");
  });

  it("stops listening and closes when a reminder or the screensaver covers the screen", async () => {
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle(300);
    expect(bubble()!.dataset.mode).toBe("listening");
    // What the reminder and the screensaver do when they come up.
    await act(async () => closeOpenDialogs(document));
    expect(bubble()).toBeNull();
    await settle(300);
    // The recording was dropped, not sent.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never reopens with a late answer after a reminder closed it mid-flight", async () => {
    // Baumy answers slowly: the reminder comes up while it is thinking.
    let answer: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/ai/transcribe"
        ? json({ ok: true, data: { text: "I did the bins" } })
        : new Promise<Response>((resolve) => {
            answer = resolve;
          }),
    );
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle(300);
    await act(async () => button("Done talking").click());
    await settle();
    expect(bubble()!.dataset.mode).toBe("thinking");
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/api/ai/command");
    await act(async () => closeOpenDialogs(document));
    expect(bubble()).toBeNull();
    // The answer, with the last person's proposal, lands after that.
    await act(async () =>
      answer(
        json({
          ok: true,
          data: {
            reply: "Bins it is.",
            proposals: [proposal],
            choices: { members: [], chores: [] },
          },
        }),
      ),
    );
    await settle();
    await settle();
    expect(bubble()).toBeNull();
    expect(document.body.textContent).not.toContain("Log Bins for Ryan");
  });

  it("asks Claude nothing when a reminder closed it while it was transcribing", async () => {
    // The transcriber is slow: the reminder comes up before the words do.
    let heard: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/ai/transcribe"
        ? new Promise<Response>((resolve) => {
            heard = resolve;
          })
        : json({
            ok: true,
            data: {
              reply: "Bins it is.",
              proposals: [proposal],
              choices: { members: [], chores: [] },
            },
          }),
    );
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle(300);
    await act(async () => button("Done talking").click());
    await settle();
    expect(bubble()!.dataset.mode).toBe("thinking");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/ai/transcribe",
    ]);
    await act(async () => closeOpenDialogs(document));
    expect(bubble()).toBeNull();
    // The transcript lands after that: nobody is asking any more.
    await act(async () =>
      heard(json({ ok: true, data: { text: "I did the bins" } })),
    );
    await settle();
    await settle();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/ai/transcribe",
    ]);
    expect(bubble()).toBeNull();
    expect(document.body.textContent).not.toContain("I did the bins");
  });

  it("does nothing on No, and Type instead opens the sheet", async () => {
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle(300);
    await act(async () => button("Done talking").click());
    await settle();
    await settle();
    await act(async () => button("No").click());
    expect(bubble()).toBeNull();
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain(
      "/api/actions/run",
    );
    // Tapping again listens again; Type instead drops the clip.
    await act(async () => cat().click());
    await settle();
    expect(bubble()!.dataset.mode).toBe("listening");
    await act(async () => button("Type instead").click());
    expect(bubble()).toBeNull();
    expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
    await settle(300);
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === "/api/ai/transcribe"),
    ).toHaveLength(1);
  });

  it("answers without proposals in the bubble, closed by OK", async () => {
    heardAndAnswered("Ryan is winning.", []);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle(300);
    await act(async () => button("Done talking").click());
    await settle();
    await settle();
    expect(bubble()!.textContent).toContain("Ryan is winning.");
    await act(async () => button("OK").click());
    expect(bubble()).toBeNull();
  });

  it("opens the sheet at once without a microphone, and always asks who", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/actions/run"
        ? json({ ok: true, data: { totalPts: 10 } })
        : json({
            ok: true,
            data: {
              reply: "Bins it is.",
              proposals: [proposal],
              choices: { members: [], chores: [] },
            },
          }),
    );
    mountCat({
      actingName: "Ryan",
      voice: false,
      who: <button type="button">Ryan (picked)</button>,
    });
    act(() => cat().click());
    expect(bubble()).toBeNull();
    // Who is talking stays in the sheet, with the one acting picked.
    const who = document.querySelector('[aria-label="Who\'s asking?"]')!;
    expect(who.textContent).toContain("Ryan (picked)");
    const input = document.querySelector<HTMLInputElement>("#baumy-text")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      set.call(input, "I did the bins");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Send").click());
    await settle();
    await act(async () => button("Approve").click());
    await settle();
    expect(refresh).toHaveBeenCalled();
    // Nothing is said while the sheet is open.
    expect(bubble()).toBeNull();
    await act(async () => button("Close").click());
    expect(bubble()!.textContent).toBe("Purrfect. +10 for Ryan ✦");
    // Opening it again clears it.
    act(() => cat().click());
    expect(bubble()).toBeNull();
  });
});
