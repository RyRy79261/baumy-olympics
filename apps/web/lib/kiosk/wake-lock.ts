// Keep the kitchen screen on (SPEC §8, issue #29): the Screen Wake Lock API,
// asked for when the kiosk opens and asked for again whenever the page comes
// back into view (the browser drops the lock when the page is hidden) or the
// screen is touched while the lock is not held. Best effort: the documented
// fallback is Auto-Lock "Never" plus Guided Access (docs/kiosk-setup.md), and
// the kiosk shows a small notice whenever the lock is not held, so nobody has
// to guess.
//
// Framework-free so it can be tested with a fake navigator and document; the
// React side is components/kiosk/keep-screen-on.tsx.

/** Where the lock stands. */
export type WakeLockStatus =
  /** Asking for it. */
  | "pending"
  /** The screen stays on. */
  | "held"
  /** The browser let it go (page hidden, battery saver); asked again on return. */
  | "released"
  /** The browser refused (not visible, not allowed, low battery). */
  | "denied"
  /** This browser has no Screen Wake Lock API. */
  | "unsupported";

/** The parts of WakeLockSentinel this uses. */
export interface SentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export interface WakeLockEnv {
  navigator: {
    wakeLock?: { request(type: "screen"): Promise<SentinelLike> };
  };
  document: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

/**
 * Hold the screen wake lock until the returned `stop` is called, reporting
 * every change of status to `onStatus`.
 */
export function keepScreenOn(
  env: WakeLockEnv,
  onStatus: (status: WakeLockStatus) => void,
): () => void {
  const api = env.navigator.wakeLock;
  if (!api) {
    onStatus("unsupported");
    return () => {};
  }

  let sentinel: SentinelLike | null = null;
  let asking = false;
  let stopped = false;
  let first = true;

  const acquire = async () => {
    if (stopped || asking || (sentinel && !sentinel.released)) return;
    if (env.document.visibilityState !== "visible") return;
    asking = true;
    // Only the first ask reports "pending": a retry keeps the last status on
    // screen until it is settled, so nothing flickers under a finger.
    if (first) onStatus("pending");
    first = false;
    try {
      const lock = await api.request("screen");
      if (stopped) {
        await lock.release();
        return;
      }
      sentinel = lock;
      lock.addEventListener("release", () => {
        if (sentinel === lock) sentinel = null;
        if (!stopped) onStatus("released");
      });
      onStatus("held");
    } catch {
      if (!stopped) onStatus("denied");
    } finally {
      asking = false;
    }
  };

  const onVisible = () => {
    if (env.document.visibilityState === "visible") void acquire();
  };
  // A touch is a user gesture: Safari may grant then what it refused before.
  const onTouch = () => void acquire();

  env.document.addEventListener("visibilitychange", onVisible);
  env.window.addEventListener("pointerdown", onTouch);
  void acquire();

  return () => {
    stopped = true;
    env.document.removeEventListener("visibilitychange", onVisible);
    env.window.removeEventListener("pointerdown", onTouch);
    const held = sentinel;
    sentinel = null;
    if (held && !held.released) void held.release().catch(() => {});
  };
}

/**
 * The kiosk's corner tag while the lock is not held; null while it is (or
 * while it is being asked for). docs/kiosk-setup.md explains both.
 */
export function wakeLockNotice(status: WakeLockStatus): string | null {
  switch (status) {
    case "held":
    case "pending":
      return null;
    case "unsupported":
      return "Screen cannot stay on";
    case "denied":
    case "released":
      return "Screen may sleep";
  }
}
