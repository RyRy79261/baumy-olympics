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
const { KIOSK_IDLE_MS } = await import("@/lib/kiosk/constants");
const { isKioskBusy } = await import("@/lib/kiosk/busy");

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
  /** Every recorder made, the latest last. */
  static made: FakeRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    public opts: { mimeType: string },
  ) {
    FakeRecorder.made.push(this);
  }
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

/** Set a React-controlled input's value, as typing would. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Type to Baumy in the sheet and send it. */
async function typeAndSend(text: string) {
  await typeInto(
    document.querySelector<HTMLInputElement>("#baumy-text")!,
    text,
  );
  const send = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Send",
  )!;
  await act(async () => send.click());
  await settle();
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
  const holdButtons = () =>
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="hold-to-talk"]',
    );
  const hold = () => holdButtons()[0]!;
  // React's onPointerDown/Up read the event's type and button.
  const press = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
  const lift = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
  /** Tap the cat, hold, speak, let go. */
  async function talkToCat() {
    await act(async () => cat().click());
    await settle();
    press(hold());
    await settle(300);
    lift(hold());
    await settle();
  }
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

  it("asks who is talking while nobody is, then holds to talk once someone is", async () => {
    mountCat({ who: <button type="button">Kim</button> });
    act(() => cat().click());
    expect(bubble()!.dataset.mode).toBe("who");
    expect(bubble()!.textContent).toContain("Who's talking?");
    expect(bubble()!.textContent).toContain("Kim");
    // However many housemates, the list scrolls inside the bubble.
    const list = bubble()!.querySelector('[data-testid="who-list"]')!;
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toMatch(/max-h-/);
    expect(getUserMedia).not.toHaveBeenCalled();
    act(() =>
      root!.render(
        <BaumySheet kiosk cat voice actingName="Kim" who={<i>Kim</i>} />,
      ),
    );
    expect(bubble()!.dataset.mode).toBe("talk");
    expect(bubble()!.textContent).toContain("Hi Kim.");
    // Tapped in: the microphone opens, ready for the hold.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await settle();
    expect(hold().textContent).toBe("Hold to talk");
  });

  it("asks for the microphone inside the tap, before the hold (issue #132)", async () => {
    mountCat({ actingName: "Ryan" });
    // iOS Safari only starts audio inside a user gesture: the tap itself
    // asks, synchronously, so the hold never waits on a prompt.
    act(() => cat().click());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(bubble()!.dataset.mode).toBe("talk");
    expect(hold().dataset.state).toBe("opening");
    await settle();
    expect(hold().dataset.state).toBe("idle");
    expect(hold().textContent).toBe("Hold to talk");
    expect(bubble()!.textContent).toContain("Hold the button and talk.");
  });

  it("listens while held, answers on release, does it on Confirm all, and stays", async () => {
    const track = { stop: vi.fn() };
    getUserMedia.mockResolvedValue({ getTracks: () => [track] });
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    press(hold());
    expect(bubble()!.dataset.mode).toBe("listening");
    expect(bubble()!.textContent).toContain("Mrrp? I’m listening");
    expect(hold().getAttribute("aria-pressed")).toBe("true");
    expect(hold().textContent).toBe("Release to send");
    await settle(300);
    lift(hold());
    await settle();
    await settle();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/ai/transcribe",
      "/api/ai/command",
    ]);
    expect(bubble()!.dataset.mode).toBe("answer");
    expect(bubble()!.textContent).toContain("Got it! I'll do this:");
    expect(bubble()!.textContent).toContain("Log Bins for Ryan: +10");
    // Cards wait on Confirm all or Cancel: no talking over them.
    expect(holdButtons()).toHaveLength(0);
    await act(async () => button("Confirm all").click());
    await settle(10);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/actions/run");
    expect(refresh).toHaveBeenCalled();
    // Done and scored: the cat says so, in the bubble, and listens again.
    expect(bubble()!.dataset.mode).toBe("answer");
    expect(bubble()!.textContent).toContain("Purrfect. +10 for Ryan ✦");
    expect(hold().textContent).toBe("Hold to talk");
    // The microphone stayed open between the clips: asked for once.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();

    // A second hold, straight from the answer.
    press(hold());
    expect(bubble()!.dataset.mode).toBe("listening");
    expect(bubble()!.textContent).not.toContain("Purrfect");
    await settle(300);
    // The finger lifts off whatever is under it now.
    await act(async () =>
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
    );
    await settle();
    await settle();
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === "/api/ai/transcribe"),
    ).toHaveLength(2);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // A tap on the cat closes it and turns the microphone off.
    await act(async () => cat().click());
    expect(bubble()).toBeNull();
    expect(track.stop).toHaveBeenCalled();
  });

  it("says to hold for a hold too short to hear, and stays", async () => {
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle();
    press(hold());
    lift(hold());
    await settle();
    expect(bubble()!.dataset.mode).toBe("talk");
    expect(bubble()!.textContent).toContain("Hold the button while you speak.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records nothing for a hold let go before the microphone opened", async () => {
    let grant: (s: unknown) => void = () => undefined;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    act(() => cat().click());
    press(hold());
    lift(hold());
    await act(async () => grant({ getTracks: () => [{ stop() {} }] }));
    await settle();
    expect(bubble()!.dataset.mode).toBe("talk");
    expect(hold().dataset.state).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops listening and closes when a reminder or the screensaver covers the screen", async () => {
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle();
    press(hold());
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
    await talkToCat();
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
    await talkToCat();
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

  it("does nothing on Cancel and listens again; Type instead opens the sheet", async () => {
    heardAndAnswered("Bins it is.", [proposal]);
    mountCat({ actingName: "Ryan" });
    await talkToCat();
    await settle();
    await act(async () => button("Cancel").click());
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain(
      "/api/actions/run",
    );
    // Still on the bubble, ready for the next hold.
    expect(bubble()!.dataset.mode).toBe("talk");
    expect(bubble()!.textContent).not.toContain("Log Bins for Ryan");
    expect(hold().textContent).toBe("Hold to talk");
    // Type instead drops a clip being recorded.
    press(hold());
    expect(bubble()!.dataset.mode).toBe("listening");
    await act(async () => button("Type instead").click());
    expect(bubble()).toBeNull();
    expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
    await settle(300);
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === "/api/ai/transcribe"),
    ).toHaveLength(1);
  });

  it("answers without proposals in the bubble, with Hold to talk again, closed by Done", async () => {
    heardAndAnswered("Ryan is winning.", []);
    mountCat({ actingName: "Ryan" });
    await talkToCat();
    await settle();
    expect(bubble()!.dataset.mode).toBe("answer");
    expect(bubble()!.textContent).toContain("Ryan is winning.");
    expect(hold().textContent).toBe("Hold to talk");
    await act(async () => button("Done").click());
    expect(bubble()).toBeNull();
  });

  it("shows a failed transcription in the bubble, and lets them hold again", async () => {
    fetchMock.mockImplementation(async () =>
      json({
        ok: false,
        code: "UNAVAILABLE",
        message: "Baumy can't listen right now.",
      }),
    );
    mountCat({ actingName: "Ryan" });
    await talkToCat();
    await settle();
    expect(bubble()!.dataset.mode).toBe("answer");
    expect(bubble()!.textContent).toContain("Baumy can't listen right now.");
    expect(hold().textContent).toBe("Hold to talk");
  });

  it("toggles with Enter or Space: a click with no pointer", async () => {
    heardAndAnswered("Ryan is winning.", []);
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle();
    // element.click() has detail 0, as a keyboard's activation does.
    act(() => hold().click());
    expect(bubble()!.dataset.mode).toBe("listening");
    await settle(300);
    act(() => hold().click());
    await settle();
    await settle();
    expect(bubble()!.textContent).toContain("Ryan is winning.");
  });

  it("falls back to the sheet when the microphone is blocked", async () => {
    getUserMedia.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    mountCat({ actingName: "Ryan" });
    await act(async () => cat().click());
    await settle();
    expect(bubble()).toBeNull();
    expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
    expect(document.body.textContent).toContain("The microphone is blocked");
  });

  it("confirms every valid card in order, with the PIN only where needed, never the invalid one (issue #107)", async () => {
    const pinned = {
      ...proposal,
      proposalId: "p2",
      preview: "Log Bins for Sam: +10",
      needsPin: true,
    };
    const invalid = {
      ...proposal,
      proposalId: "p3",
      name: "create_bounty",
      preview: "New bounty: Recycling · maintenance · 15 pts",
      valid: false,
      error: "This can only be done signed in on your own phone or computer.",
    };
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/actions/run"
        ? json({ ok: true, data: { totalPts: 10 } })
        : json({
            ok: true,
            data: {
              reply: "Lined up.",
              proposals: [proposal, pinned, invalid],
              choices: { members: [], chores: [] },
            },
          }),
    );
    mountCat({ actingName: "Ryan", voice: false });
    act(() => cat().click());
    const input = document.querySelector<HTMLInputElement>("#baumy-text")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      set.call(input, "bins for me and Sam, and a bounty");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Send").click());
    await settle();
    expect(document.body.textContent).toContain(invalid.error);
    await act(async () => button("Confirm all").click());
    // One PIN for the acting member, before anything runs.
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain(
      "/api/actions/run",
    );
    for (const d of ["4", "3", "2", "1"]) {
      await act(async () => button(d).click());
    }
    const pad = document.querySelector<HTMLFormElement>(
      'form[aria-label="Ryan\'s PIN"]',
    )!;
    await act(async () => pad.requestSubmit());
    await settle(10);
    const runs = fetchMock.mock.calls
      .filter((c) => c[0] === "/api/actions/run")
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(runs).toEqual([
      expect.objectContaining({ requestId: "p1", surface: "kiosk" }),
      expect.objectContaining({ requestId: "p2", pin: "4321" }),
    ]);
    expect(runs[0]).not.toHaveProperty("pin");
    expect(
      [...document.querySelectorAll("li[data-testid^=suggestion-]")].map((li) =>
        li.getAttribute("data-state"),
      ),
    ).toEqual(["saved", "saved", "pending"]);
    expect(document.body.textContent).toContain("Saved: +10 points.");
  });

  it("sends a wrong PIN once, never to every card that needs it", async () => {
    // Five cards vouch for someone, one does not. A PIN try counts against
    // the member's PIN (5 per 15 minutes): one typo must cost one try.
    const pinned = (n: number) => ({
      ...proposal,
      proposalId: `pin${n}`,
      name: "confirm_completion",
      preview: `Confirm claim ${n}`,
      needsPin: true,
    });
    const free = { ...proposal, proposalId: "free" };
    const cards = [pinned(1), pinned(2), free, pinned(3), pinned(4), pinned(5)];
    fetchMock.mockImplementation(
      async (url: string, init: RequestInit | undefined) => {
        if (url !== "/api/actions/run") {
          return json({
            ok: true,
            data: {
              reply: "Lined up.",
              proposals: cards,
              choices: { members: [], chores: [] },
            },
          });
        }
        const b = JSON.parse(String(init!.body)) as {
          requestId: string;
          pin?: string;
        };
        if (!b.requestId.startsWith("pin") || b.pin === "4321") {
          return json({ ok: true, data: { totalPts: 10 } });
        }
        return json(
          b.pin === undefined
            ? {
                ok: false,
                code: "ATTESTATION_REQUIRED",
                message: "Enter your PIN.",
              }
            : {
                ok: false,
                code: "ATTESTATION_FAILED",
                message: "That PIN is not right.",
              },
        );
      },
    );
    const runs = () =>
      fetchMock.mock.calls
        .filter((c) => c[0] === "/api/actions/run")
        .map(
          (c) =>
            JSON.parse(String((c[1] as RequestInit).body)) as {
              requestId: string;
              pin?: string;
            },
        );
    const states = () =>
      [...document.querySelectorAll("[data-testid^=suggestion-]")].map((li) =>
        li.getAttribute("data-state"),
      );
    async function confirmWithPin(pin: string) {
      await act(async () => button("Confirm all").click());
      for (const d of pin) await act(async () => button(d).click());
      await act(async () =>
        document
          .querySelector<HTMLFormElement>('form[aria-label="Ryan\'s PIN"]')!
          .requestSubmit(),
      );
      await settle(10);
    }

    mountCat({ actingName: "Ryan", voice: false });
    act(() => cat().click());
    await typeAndSend("confirm them all");
    expect(states()).toHaveLength(6);

    await confirmWithPin("1111");
    // One try with the wrong PIN; the card that needs none still saved.
    expect(runs().filter((r) => r.pin !== undefined)).toEqual([
      expect.objectContaining({ requestId: "pin1", pin: "1111" }),
    ]);
    expect(runs().map((r) => r.requestId)).toEqual(["pin1", "free"]);
    expect(states()).toEqual([
      "pending",
      "pending",
      "saved",
      "pending",
      "pending",
      "pending",
    ]);
    expect(document.body.textContent).toContain("That PIN is not right.");
    // Every card that needs the PIN still says so.
    expect(document.body.textContent!.match(/Needs your PIN/g)).toHaveLength(5);

    // The right PIN, typed again, saves the rest: one request each.
    await confirmWithPin("4321");
    expect(
      runs()
        .filter((r) => r.pin === "4321")
        .map((r) => r.requestId),
    ).toEqual(["pin1", "pin2", "pin3", "pin4", "pin5"]);
    expect(states().every((s) => s === "saved")).toBe(true);
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
    await act(async () => button("Confirm all").click());
    await settle();
    expect(refresh).toHaveBeenCalled();
    // Nothing is said while the sheet is open.
    expect(bubble()).toBeNull();
    await act(async () => button("Done").click());
    expect(bubble()!.textContent).toBe("Purrfect. +10 for Ryan ✦");
    // Opening it again clears it.
    act(() => cat().click());
    expect(bubble()).toBeNull();
  });

  // Issue #132 review: the microphone really goes off, the minute is not
  // spent while held or answering, and a hold keeps its element.
  describe("the microphone and the minute", () => {
    let track: { stop: ReturnType<typeof vi.fn> };
    beforeEach(() => {
      track = { stop: vi.fn() };
      getUserMedia.mockResolvedValue({ getTracks: () => [track] });
      FakeRecorder.made = [];
    });
    const latestRecorder = () => FakeRecorder.made.at(-1)!;
    /** Move fake timers on, letting promises settle in between. */
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    it("turns it off when a reminder or the screensaver covers a hold", async () => {
      mountCat({ actingName: "Ryan" });
      await act(async () => cat().click());
      await settle();
      press(hold());
      expect(latestRecorder().state).toBe("recording");
      expect(track.stop).not.toHaveBeenCalled();
      await act(async () => closeOpenDialogs(document));
      expect(track.stop).toHaveBeenCalled();
      expect(latestRecorder().state).toBe("inactive");
      expect(isKioskBusy()).toBe(false);
    });

    it("turns it off when the page goes away mid-hold", async () => {
      mountCat({ actingName: "Ryan" });
      await act(async () => cat().click());
      await settle();
      press(hold());
      expect(latestRecorder().state).toBe("recording");
      expect(isKioskBusy()).toBe(true);
      act(() => root!.unmount());
      root = null;
      expect(track.stop).toHaveBeenCalled();
      expect(latestRecorder().state).toBe("inactive");
      expect(isKioskBusy()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("turns it off after the bubble's idle minute", async () => {
      vi.useFakeTimers();
      heardAndAnswered("Ryan is winning.", []);
      mountCat({ actingName: "Ryan" });
      await act(async () => cat().click());
      await advance(0);
      press(hold());
      await advance(1_000);
      lift(hold());
      await advance(0);
      await advance(0);
      expect(bubble()!.textContent).toContain("Ryan is winning.");
      expect(track.stop).not.toHaveBeenCalled();
      await advance(KIOSK_IDLE_MS + 1_000);
      expect(bubble()).toBeNull();
      expect(track.stop).toHaveBeenCalled();
      expect(latestRecorder().state).toBe("inactive");
    });

    it("keeps the answer after a long hold and a slow reply, and counts the minute from then", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async (url: string) =>
        url === "/api/ai/transcribe"
          ? new Promise<Response>((resolve) =>
              setTimeout(
                () => resolve(json({ ok: true, data: { text: "who?" } })),
                30_000,
              ),
            )
          : json({
              ok: true,
              data: {
                reply: "Ryan is winning.",
                proposals: [],
                choices: { members: [], chores: [] },
              },
            }),
      );
      mountCat({ actingName: "Ryan" });
      await act(async () => cat().click());
      await advance(0);
      // Held for 44 seconds, under the 45-second cut, then 30 seconds of
      // listening back: well past the minute since the tap.
      press(hold());
      await advance(44_000);
      expect(bubble()!.dataset.mode).toBe("listening");
      expect(isKioskBusy()).toBe(true);
      lift(hold());
      await advance(30_000);
      await advance(0);
      expect(bubble()!.dataset.mode).toBe("answer");
      expect(bubble()!.textContent).toContain("Ryan is winning.");
      expect(isKioskBusy()).toBe(false);
      // The minute starts with the answer.
      await advance(KIOSK_IDLE_MS - 2_000);
      expect(bubble()!.textContent).toContain("Ryan is winning.");
      await advance(3_000);
      expect(bubble()).toBeNull();
    });

    it("keeps the same button under the finger when a hold starts on an answer", async () => {
      heardAndAnswered("Ryan is winning.", []);
      mountCat({ actingName: "Ryan" });
      await talkToCat();
      await settle();
      expect(bubble()!.dataset.mode).toBe("answer");
      const before = hold();
      press(before);
      expect(bubble()!.dataset.mode).toBe("listening");
      expect(hold()).toBe(before);
      expect(before.isConnected).toBe(true);
    });

    describe("with a level meter", () => {
      let samples = 128;
      let hiss = false;
      const closed = vi.fn();
      class FakeAudioContext {
        state = "running";
        resume = () => Promise.resolve();
        close = () => {
          closed();
          this.state = "closed";
          return Promise.resolve();
        };
        createMediaStreamSource = () => ({ connect: () => undefined });
        createAnalyser = () => ({
          fftSize: 64,
          getByteTimeDomainData: (buf: Uint8Array) => {
            for (let i = 0; i < buf.length; i++) {
              buf[i] = i % 2 ? samples : 256 - samples;
            }
            // A quiet room: one sample a step off the midline.
            if (hiss) buf[0] = 129;
          },
        });
      }
      beforeEach(() => {
        closed.mockReset();
        vi.stubGlobal("AudioContext", FakeAudioContext);
        vi.stubGlobal(
          "requestAnimationFrame",
          (cb: () => void) => setTimeout(cb, 16) as unknown as number,
        );
        vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
      });

      it("drops a clip it heard only a quiet room in", async () => {
        samples = 128;
        hiss = true;
        heardAndAnswered("Ryan is winning.", []);
        mountCat({ actingName: "Ryan" });
        await talkToCat();
        expect(bubble()!.dataset.mode).toBe("talk");
        expect(bubble()!.textContent).toContain(
          "I didn't hear anything — hold and speak.",
        );
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("sends a clip when the meter read flat zero: a dead meter, not silence", async () => {
        // Some iOS versions report running audio while the source reads
        // nothing at all; the recording itself may still hold words.
        samples = 128;
        hiss = false;
        heardAndAnswered("Ryan is winning.", []);
        mountCat({ actingName: "Ryan" });
        await talkToCat();
        await settle();
        expect(bubble()!.textContent).not.toContain("I didn't hear anything");
        expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
          "/api/ai/transcribe",
        );
        expect(bubble()!.textContent).toContain("Ryan is winning.");
      });

      it("sends a clip with a voice in it, the bars rising", async () => {
        samples = 200;
        hiss = false;
        heardAndAnswered("Ryan is winning.", []);
        mountCat({ actingName: "Ryan" });
        await act(async () => cat().click());
        await settle();
        press(hold());
        await settle(100);
        const bars = hold().querySelector<HTMLElement>("[data-level]")!;
        expect(Number(bars.dataset.level)).toBeGreaterThan(0);
        await settle(200);
        lift(hold());
        await settle();
        await settle();
        expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
          "/api/ai/transcribe",
        );
      });

      it("closes the meter's audio when the bubble closes before any microphone", () => {
        mountCat({ who: <button type="button">Kim</button> });
        act(() => cat().click());
        expect(bubble()!.dataset.mode).toBe("who");
        expect(getUserMedia).not.toHaveBeenCalled();
        act(() => cat().click());
        expect(bubble()).toBeNull();
        expect(closed).toHaveBeenCalled();
      });
    });
  });
});

// Editing a card while Confirm all could run (PR #110 review): the edit
// replaces the card under a new proposal id, so running both would save the
// same thing twice (€20 plain, then €20 edited).
describe("BaumySheet editing a card", () => {
  const pot = (id: string, amount: string) => ({
    proposalId: id,
    name: "add_pot_contribution",
    title: "Add to the pot",
    input: { amount },
    preview: `Add €${amount} to the pot`,
    risk: "confirm",
    valid: true,
    needsPin: false,
    fields: [{ name: "amount", label: "Amount", kind: "text", required: true }],
  });
  const buttonNamed = (name: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === name,
    );
  const confirmAll = () => buttonNamed("Confirm all")!;
  const runs = () =>
    fetchMock.mock.calls
      .filter((c) => c[0] === "/api/actions/run")
      .map(
        (c) =>
          (
            JSON.parse(String((c[1] as RequestInit).body)) as {
              requestId: string;
            }
          ).requestId,
      );

  /** Baumy answers with €20; the re-check (held until `recheck`) with €25. */
  function answering() {
    let recheck: () => void = () => undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/ai/proposal") {
        return new Promise<Response>((resolve) => {
          recheck = () => resolve(json({ ok: true, data: pot("p2", "25") }));
        });
      }
      if (url === "/api/actions/run") return json({ ok: true, data: {} });
      return json({
        ok: true,
        data: {
          reply: "Pot it is.",
          proposals: [pot("p1", "20")],
          choices: { members: [], chores: [] },
        },
      });
    });
    return { recheck: () => recheck() };
  }

  async function editTo(amount: string) {
    await act(async () => buttonNamed("Edit")!.click());
    await typeInto(
      document.querySelector<HTMLInputElement>("#p1-amount")!,
      amount,
    );
    await act(async () => buttonNamed("Check it")!.click());
  }

  it("holds Confirm all while a card's edit is open", async () => {
    answering();
    mount(false);
    await typeAndSend("put 20 in the pot");
    expect(confirmAll().disabled).toBe(false);
    await act(async () => buttonNamed("Edit")!.click());
    expect(confirmAll().disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Finish the edit (Check it, or Back) before Confirm all.",
    );
    await act(async () => buttonNamed("Back")!.click());
    expect(confirmAll().disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Finish the edit");
  });

  it("holds it while the edit is checked, then saves only the edited card", async () => {
    const { recheck } = answering();
    mount(false);
    await typeAndSend("put 20 in the pot");
    await editTo("25");
    expect(buttonNamed("Checking…")).toBeDefined();
    expect(confirmAll().disabled).toBe(true);
    await act(async () => confirmAll().click());
    expect(runs()).toEqual([]);

    await act(async () => recheck());
    await settle();
    expect(document.body.textContent).toContain("Add €25 to the pot");
    expect(document.body.textContent).not.toContain("Add €20 to the pot");
    expect(confirmAll().disabled).toBe(false);
    await act(async () => confirmAll().click());
    await settle();
    expect(runs()).toEqual(["p2"]);
  });

  it("never brings back a card dropped while its edit was checked", async () => {
    const { recheck } = answering();
    mount(false);
    await typeAndSend("put 20 in the pot");
    await editTo("25");
    const drop = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Drop: Add €20 to the pot"]',
    )!;
    await act(async () => drop.click());
    expect(document.body.textContent).not.toContain("Add €20 to the pot");

    await act(async () => recheck());
    await settle();
    // The re-check came back, but the card stays dropped.
    expect(document.body.textContent).toContain("Pot it is.");
    expect(document.body.textContent).not.toContain("Add €25 to the pot");
    expect(runs()).toEqual([]);
  });
});
