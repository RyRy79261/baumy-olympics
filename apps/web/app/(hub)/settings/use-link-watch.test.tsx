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
import { LINK_POLL_MS, useLinkWatch } from "./use-link-watch";

// /settings' re-read while a Telegram link code is live (issue #108): every
// few seconds and on focus, only while a code waits, and never past expiry.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
const refresh = vi.fn();

function Probe({ active, until }: { active: boolean; until: number }) {
  useLinkWatch({ active, until, refresh });
  return null;
}

function mount(active: boolean, until: number) {
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() => root!.render(<Probe active={active} until={until} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

describe("useLinkWatch", () => {
  it("re-reads every few seconds while a code waits, then stops at expiry", () => {
    mount(true, Date.now() + LINK_POLL_MS * 3 + 500);
    act(() => vi.advanceTimersByTime(LINK_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(LINK_POLL_MS * 2));
    expect(refresh).toHaveBeenCalledTimes(3);
    // Past expiry: no more ticks, and focus no longer re-reads either.
    act(() => vi.advanceTimersByTime(LINK_POLL_MS * 10));
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("re-reads at once when the tab comes back", () => {
    mount(true, Date.now() + 60_000);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does nothing with no code waiting, or with an expired one", () => {
    mount(true, Date.now() + 60_000);
    act(() => vi.advanceTimersByTime(LINK_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() =>
      root!.render(<Probe active={false} until={Date.now() + 60_000} />),
    );
    act(() => vi.advanceTimersByTime(LINK_POLL_MS * 5));
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root!.render(<Probe active until={Date.now() - 1} />));
    act(() => vi.advanceTimersByTime(LINK_POLL_MS * 5));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
