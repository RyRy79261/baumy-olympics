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
import { useIdle } from "./use-idle";

// The kiosk's idle reset (SPEC §8): 60 seconds with no touch forgets who is
// acting; any touch or key starts the wait again.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

let left: number | null = null;

function Probe({ active, onIdle }: { active: boolean; onIdle: () => void }) {
  left = useIdle(active, 60_000, onIdle, 10_000);
  return null;
}

/** Move the timers (and Date) on, inside act so the countdown renders. */
function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function mount(active: boolean, onIdle: () => void) {
  const div = document.createElement("div");
  root = createRoot(div);
  act(() => root!.render(<Probe active={active} onIdle={onIdle} />));
}

describe("useIdle", () => {
  it("fires once after 60 seconds untouched", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    wait(59_999);
    expect(onIdle).not.toHaveBeenCalled();
    wait(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("starts the wait again on every touch or key", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    wait(50_000);
    window.dispatchEvent(new Event("pointerdown"));
    wait(50_000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    wait(59_000);
    expect(onIdle).not.toHaveBeenCalled();
    wait(1_000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("counts down the last ten seconds, and a touch cancels it", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    wait(49_000);
    expect(left).toBeNull();
    wait(1_000);
    expect(left).toBe(10);
    wait(7_000);
    expect(left).toBe(3);
    act(() => window.dispatchEvent(new Event("touchstart")));
    expect(left).toBeNull();
    wait(50_000);
    expect(left).toBe(10);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("counts a scroll inside a panel as a touch", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    const panel = document.createElement("div");
    document.body.append(panel);
    wait(55_000);
    // Scroll events do not bubble; the hook listens in the capture phase.
    act(() => panel.dispatchEvent(new Event("scroll")));
    wait(55_000);
    expect(onIdle).not.toHaveBeenCalled();
    panel.remove();
  });

  it("catches up at once when the page is shown after its timers slept", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    // The iPad's screen was off: time passed but no timer ran.
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("tries again a minute later if the screen is still not home", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    wait(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    wait(59_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    wait(1_000);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it("does nothing while nobody is acting, and stops when unmounted", () => {
    const idle = vi.fn();
    mount(false, idle);
    wait(120_000);
    expect(idle).not.toHaveBeenCalled();
    expect(left).toBeNull();
    const onIdle = vi.fn();
    act(() => root!.render(<Probe active onIdle={onIdle} />));
    act(() => root!.unmount());
    root = null;
    wait(120_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
