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

function Probe({ active, onIdle }: { active: boolean; onIdle: () => void }) {
  useIdle(active, 60_000, onIdle);
  return null;
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
    vi.advanceTimersByTime(59_999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("starts the wait again on every touch or key", () => {
    const onIdle = vi.fn();
    mount(true, onIdle);
    vi.advanceTimersByTime(50_000);
    window.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(50_000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    vi.advanceTimersByTime(59_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("does nothing while nobody is acting, and stops when unmounted", () => {
    const idle = vi.fn();
    mount(false, idle);
    vi.advanceTimersByTime(120_000);
    expect(idle).not.toHaveBeenCalled();
    const onIdle = vi.fn();
    act(() => root!.render(<Probe active onIdle={onIdle} />));
    act(() => root!.unmount());
    root = null;
    vi.advanceTimersByTime(120_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
