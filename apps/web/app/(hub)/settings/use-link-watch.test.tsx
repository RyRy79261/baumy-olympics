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
import {
  LINK_POLL_MS,
  useLinkWatch,
  type LinkCheck,
  type LinkPhase,
} from "./use-link-watch";

// /settings' watch over a Telegram link code (issues #108, #118): it asks the
// server every few seconds and on focus while the code waits, stops once the
// server says used or expired, and times the expiry on the server's seconds
// left, never on the device clock.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

type Answer = Awaited<ReturnType<LinkCheck>>;
const waiting = (secondsLeft: number): Answer => ({
  state: "waiting",
  secondsLeft,
});
const check = vi.fn<LinkCheck>();

let root: Root | null = null;
let el: HTMLDivElement;

function Probe({
  code,
  secondsLeft,
}: {
  code: string | null;
  secondsLeft: number;
}) {
  const phase: LinkPhase | null = useLinkWatch({ code, secondsLeft, check });
  return <p>{phase ?? "none"}</p>;
}

async function render(code: string | null, secondsLeft: number) {
  if (!root) {
    el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
  }
  await act(async () =>
    root!.render(<Probe code={code} secondsLeft={secondsLeft} />),
  );
}

const phase = () => el.textContent;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  check.mockReset();
  check.mockResolvedValue(waiting(600));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el?.remove();
  vi.useRealTimers();
});

describe("useLinkWatch", () => {
  it("asks every few seconds while the code waits, and stops once it is used", async () => {
    await render("CODE000001", 600);
    expect(phase()).toBe("waiting");
    await advance(LINK_POLL_MS);
    expect(check).toHaveBeenCalledTimes(1);
    await advance(LINK_POLL_MS * 2);
    expect(check).toHaveBeenCalledTimes(3);

    check.mockResolvedValue({ state: "used", secondsLeft: 0 });
    await advance(LINK_POLL_MS);
    expect(check).toHaveBeenCalledTimes(4);
    expect(phase()).toBe("used");
    // Used: no more ticks, and focus no longer asks either.
    await advance(LINK_POLL_MS * 10);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("asks at once when the tab comes back", async () => {
    await render("CODE000001", 600);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("switches to expired when the server says so, and stops", async () => {
    await render("CODE000001", 600);
    check.mockResolvedValue({ state: "expired", secondsLeft: 0 });
    await advance(LINK_POLL_MS);
    expect(phase()).toBe("expired");
    await advance(LINK_POLL_MS * 5);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("times the expiry on the server's seconds, whatever the device clock says", async () => {
    // A device clock a day ahead (and then a day behind) changes nothing.
    vi.setSystemTime(Date.now() + 86_400_000);
    check.mockResolvedValue(null); // every poll fails, so only the timer ends it
    await render("CODE000001", 10);
    await advance(9_000);
    expect(phase()).toBe("waiting");
    expect(check).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() - 2 * 86_400_000);
    await advance(999);
    expect(phase()).toBe("waiting");
    // At the server's expiry it asks once more; with no answer, it is over.
    await advance(1);
    expect(check).toHaveBeenCalledTimes(4);
    expect(phase()).toBe("expired");
    await advance(LINK_POLL_MS * 5);
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("moves the expiry to each answer's seconds left", async () => {
    // The server's latest answer wins over the first estimate: the code has
    // 20s left, not the 5s the page started with.
    check.mockResolvedValue(waiting(20));
    await render("CODE000001", 5);
    await advance(LINK_POLL_MS);
    expect(check).toHaveBeenCalledTimes(1);
    check.mockResolvedValue(null);
    // Past the first estimate: nothing fired, and it still waits.
    await advance(2_000 + 1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("waiting");
    // At the moved expiry (20s after that answer) it asks once more; the
    // failed polls in between never end it early.
    await advance(20_000 - 2_000 - 2);
    expect(phase()).toBe("waiting");
    await advance(1);
    expect(phase()).toBe("expired");
  });

  it("asks at once for a code already out of time", async () => {
    check.mockResolvedValue({ state: "expired", secondsLeft: 0 });
    await render("CODE000001", 0);
    await advance(0);
    expect(check).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("expired");
  });

  it("does nothing with no code, and starts over for a new one", async () => {
    await render(null, 0);
    expect(phase()).toBe("none");
    await advance(LINK_POLL_MS * 5);
    window.dispatchEvent(new Event("focus"));
    expect(check).not.toHaveBeenCalled();

    await render("CODE000001", 600);
    check.mockResolvedValue({ state: "expired", secondsLeft: 0 });
    await advance(LINK_POLL_MS);
    expect(phase()).toBe("expired");
    check.mockResolvedValue(waiting(600));
    await render("CODE000002", 600);
    expect(phase()).toBe("waiting");
    await advance(LINK_POLL_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("stops asking when unmounted", async () => {
    await render("CODE000001", 600);
    await act(async () => root!.unmount());
    root = null;
    await advance(LINK_POLL_MS * 5);
    window.dispatchEvent(new Event("focus"));
    expect(check).not.toHaveBeenCalled();
  });
});
