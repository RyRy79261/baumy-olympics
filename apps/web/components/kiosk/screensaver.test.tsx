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
import { DEFAULT_NIGHT_WINDOW, NIGHT_EVENT } from "@/lib/kiosk/night";
import { NightMode } from "./night-mode";

// Night mode on the kiosk (SPEC §8): asleep inside the window, a tap wakes
// it, a minute untouched puts it back to sleep, the morning wakes it, and the
// home page's refresh never puts a screen someone is using back to sleep.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let div: HTMLDivElement;
const events: boolean[] = [];
const onNight = (e: Event) =>
  events.push((e as CustomEvent<{ asleep: boolean }>).detail.asleep);

beforeEach(() => {
  vi.useFakeTimers();
  events.length = 0;
  window.addEventListener(NIGHT_EVENT, onNight);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  div?.remove();
  window.removeEventListener(NIGHT_EVENT, onNight);
  vi.useRealTimers();
});

// 23:30 Berlin in winter; the device's own clock is an hour off, on purpose:
// the screen follows the server.
const SERVER_NIGHT = "2026-01-14T22:30:00Z";
const SERVER_DAY = "2026-01-14T10:00:00Z";

function mount(serverNow: string, window = DEFAULT_NIGHT_WINDOW) {
  vi.setSystemTime(Date.parse(serverNow) + 60 * 60_000);
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() => root!.render(<NightMode serverNow={serverNow} window={window} />));
}

const screen = () =>
  div.querySelector<HTMLButtonElement>("[data-testid=night-screen]");
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("NightMode", () => {
  it("sleeps at once at night, with the server's time on the clock", () => {
    mount(SERVER_NIGHT);
    expect(screen()).not.toBeNull();
    expect(screen()!.textContent).toContain("23:30");
    expect(events).toEqual([true]);
  });

  it("wakes on a tap and sleeps again after a minute untouched", () => {
    mount(SERVER_NIGHT);
    act(() => screen()!.click());
    expect(screen()).toBeNull();
    expect(events).toEqual([true, false]);
    wait(59_000);
    expect(screen()).toBeNull();
    // A touch on the page starts the minute again.
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    wait(59_000);
    expect(screen()).toBeNull();
    wait(2_000);
    expect(screen()).not.toBeNull();
    expect(events).toEqual([true, false, true]);
  });

  it("wakes for good in the morning", () => {
    mount(SERVER_NIGHT);
    expect(screen()).not.toBeNull();
    // 23:30 + 7h = 06:30.
    wait(7 * 60 * 60_000);
    expect(screen()).toBeNull();
    wait(10 * 60_000);
    expect(screen()).toBeNull();
    expect(events).toEqual([true, false]);
  });

  it("stays awake by day, and falls asleep when the night starts", () => {
    mount(SERVER_DAY); // 11:00 Berlin
    expect(screen()).toBeNull();
    wait(11 * 60 * 60_000 + 59_000); // 22:00:59, the screen untouched
    expect(screen()).toBeNull();
    wait(60 * 60_000); // 23:00:59
    expect(screen()).not.toBeNull();
  });

  it("is never on when night mode is off", () => {
    div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    vi.setSystemTime(Date.parse(SERVER_NIGHT));
    act(() =>
      root!.render(<NightMode serverNow={SERVER_NIGHT} window={null} />),
    );
    wait(5 * 60_000);
    expect(screen()).toBeNull();
    expect(events).toEqual([]);
  });

  it("does not put a woken screen back to sleep when the page refreshes", () => {
    mount(SERVER_NIGHT);
    act(() => screen()!.click());
    wait(30_000);
    // The kiosk home's 60-second refresh renders the shell again.
    const later = new Date(Date.parse(SERVER_NIGHT) + 30_000).toISOString();
    act(() =>
      root!.render(
        <NightMode serverNow={later} window={{ ...DEFAULT_NIGHT_WINDOW }} />,
      ),
    );
    expect(screen()).toBeNull();
    wait(31_000);
    expect(screen()).not.toBeNull();
  });

  it("closes an open dialog when it falls asleep", () => {
    const dialog = document.createElement("dialog");
    dialog.close = vi.fn(() => dialog.removeAttribute("open"));
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    mount(SERVER_NIGHT);
    expect(dialog.close).toHaveBeenCalledOnce();
    dialog.remove();
  });
});
