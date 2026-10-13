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

// The kitchen screen's freshness (SPEC §8): router.refresh() every 60s and
// when the screen comes back into view, but never while someone is typing or
// has a dialog open, and never while the screen is asleep or hidden (issue
// #210), refreshing once when it wakes.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AutoRefresh, HUB_REFRESH_MS, isBusy } = await import("./auto-refresh");
const { REFRESH_COOKIE } = await import("@/lib/hub/refresh");
const { setKioskAsleep } = await import("@/lib/kiosk/asleep");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setKioskAsleep(false);
  setVisibility("visible");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function mount() {
  const div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() => root!.render(<AutoRefresh />));
}

describe("AutoRefresh", () => {
  it("refreshes every 60 seconds", () => {
    mount();
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("marks each refresh so the server skips the shopping cache", () => {
    document.cookie = `${REFRESH_COOKIE}=; max-age=0; path=/`;
    mount();
    expect(document.cookie).not.toContain(`${REFRESH_COOKIE}=1`);
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    expect(document.cookie).toContain(`${REFRESH_COOKIE}=1`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on focus and when the page is visible again", () => {
    mount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits while a dialog is open", () => {
    mount();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    expect(refresh).not.toHaveBeenCalled();
    dialog.remove();
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the screen is asleep, then once on waking", () => {
    mount();
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => setKioskAsleep(true));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS * 30));
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => setKioskAsleep(false));
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("knows the screen is asleep when it mounts under the screensaver", () => {
    // The idle reset can go home at night: the page mounts asleep.
    setKioskAsleep(true);
    mount();
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS * 5));
    expect(refresh).not.toHaveBeenCalled();
    act(() => setKioskAsleep(false));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the page is hidden", () => {
    mount();
    setVisibility("hidden");
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops when it unmounts", () => {
    mount();
    act(() => root!.unmount());
    root = null;
    act(() => vi.advanceTimersByTime(HUB_REFRESH_MS));
    window.dispatchEvent(new Event("focus"));
    setKioskAsleep(true);
    setKioskAsleep(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("isBusy", () => {
  it("is true while a field has focus", () => {
    expect(isBusy(document)).toBe(false);
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.createElement(tag);
      document.body.append(el);
      el.focus();
      expect(isBusy(document), tag).toBe(true);
      el.remove();
    }
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(isBusy(document)).toBe(false);
  });
});
