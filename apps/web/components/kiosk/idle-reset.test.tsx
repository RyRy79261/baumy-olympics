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

// The kiosk's idle reset waits while Baumy is mid-hold or mid-reply (issue
// #132), and counts its minute from when that ends.

const clearPickAction = vi.fn(() => Promise.resolve());
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/kiosk",
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));
vi.mock("@/app/kiosk/actions", () => ({ clearPickAction }));

const { IdleReset } = await import("./idle-reset");
const { setKioskBusy } = await import("@/lib/kiosk/busy");
const { KIOSK_IDLE_MS } = await import("@/lib/kiosk/constants");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  clearPickAction.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setKioskBusy("test", false);
  vi.useRealTimers();
});

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("IdleReset", () => {
  it("keeps the pick while Baumy is busy, then waits a full minute", () => {
    root = createRoot(document.createElement("div"));
    act(() => root!.render(<IdleReset memberPicked />));
    wait(30_000);
    act(() => setKioskBusy("test", true));
    // A long hold and a slow reply: well past the minute.
    wait(2 * KIOSK_IDLE_MS);
    expect(clearPickAction).not.toHaveBeenCalled();
    act(() => setKioskBusy("test", false));
    wait(KIOSK_IDLE_MS - 1_000);
    expect(clearPickAction).not.toHaveBeenCalled();
    wait(1_000);
    expect(clearPickAction).toHaveBeenCalledOnce();
  });

  it("forgets the one acting after the screen's own idle minutes (issue #147)", () => {
    root = createRoot(document.createElement("div"));
    act(() => root!.render(<IdleReset memberPicked idleMs={5 * 60_000} />));
    // Past the old minute, and nearly the five.
    wait(5 * 60_000 - 1_000);
    expect(clearPickAction).not.toHaveBeenCalled();
    wait(1_000);
    expect(clearPickAction).toHaveBeenCalledOnce();
  });
});

describe("closeOpenDialogs", () => {
  it("closes even a sheet that is waiting on an answer (#174)", async () => {
    // jsdom has <dialog> without the modal methods: these act as a browser.
    HTMLDialogElement.prototype.showModal ??= function (
      this: HTMLDialogElement,
    ) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    const { Dialog } = await import("@baumy/ui");
    const { closeOpenDialogs } = await import("./idle-reset");
    const onClose = vi.fn();
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    act(() =>
      root!.render(
        <Dialog open busy onClose={onClose} title="Log Bins">
          <p>Sending</p>
        </Dialog>,
      ),
    );
    const sheet = el.querySelector("dialog")!;
    expect(sheet.open).toBe(true);
    // The browser closing it is undone while it waits …
    act(() => sheet.close());
    expect(sheet.open).toBe(true);
    // … but the kiosk taking the screen closes it, and the page hears so.
    act(() => closeOpenDialogs(document));
    expect(sheet.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
