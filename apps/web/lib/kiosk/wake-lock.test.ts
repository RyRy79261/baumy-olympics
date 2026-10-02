import { describe, expect, it } from "vitest";
import {
  keepScreenOn,
  type SentinelLike,
  type WakeLockEnv,
  type WakeLockStatus,
} from "./wake-lock";

// The kiosk's screen wake lock (SPEC §8): asked for on open, asked for again
// when the page comes back into view or the screen is touched, and every
// state that is not "held" is reported so the kiosk can say so.

class FakeSentinel implements SentinelLike {
  released = false;
  private listeners: (() => void)[] = [];
  addEventListener(_: "release", fn: () => void) {
    this.listeners.push(fn);
  }
  async release() {
    if (this.released) return;
    this.released = true;
    for (const fn of this.listeners) fn();
  }
}

function fakeEnv(opts: { supported?: boolean } = {}) {
  const docTarget = new EventTarget();
  const winTarget = new EventTarget();
  const state = {
    visibility: "visible" as DocumentVisibilityState,
    refuse: false,
    requests: 0,
    sentinels: [] as FakeSentinel[],
  };
  const env: WakeLockEnv = {
    navigator:
      opts.supported === false
        ? {}
        : {
            wakeLock: {
              request: async () => {
                state.requests++;
                if (state.refuse) throw new Error("NotAllowedError");
                const s = new FakeSentinel();
                state.sentinels.push(s);
                return s;
              },
            },
          },
    document: {
      get visibilityState() {
        return state.visibility;
      },
      addEventListener: docTarget.addEventListener.bind(docTarget),
      removeEventListener: docTarget.removeEventListener.bind(docTarget),
    },
    window: {
      addEventListener: winTarget.addEventListener.bind(winTarget),
      removeEventListener: winTarget.removeEventListener.bind(winTarget),
    },
  };
  const becomeVisible = async (v: DocumentVisibilityState) => {
    state.visibility = v;
    docTarget.dispatchEvent(new Event("visibilitychange"));
    await flush();
  };
  const touch = async () => {
    winTarget.dispatchEvent(new Event("pointerdown"));
    await flush();
  };
  return { env, state, becomeVisible, touch };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function track() {
  const seen: WakeLockStatus[] = [];
  return {
    seen,
    last: () => seen.at(-1),
    onStatus: (s: WakeLockStatus) => seen.push(s),
  };
}

describe("keepScreenOn", () => {
  it("holds the lock as soon as the kiosk opens", async () => {
    const { env, state } = fakeEnv();
    const t = track();
    keepScreenOn(env, t.onStatus);
    await flush();
    expect(t.seen).toEqual(["pending", "held"]);
    expect(state.requests).toBe(1);
  });

  it("asks again when the page comes back into view after a release", async () => {
    const { env, state, becomeVisible } = fakeEnv();
    const t = track();
    keepScreenOn(env, t.onStatus);
    await flush();
    // The browser drops the lock when the page is hidden.
    state.visibility = "hidden";
    await state.sentinels[0]!.release();
    expect(t.last()).toBe("released");
    // Hidden: nothing to ask for yet.
    await becomeVisible("hidden");
    expect(state.requests).toBe(1);
    await becomeVisible("visible");
    expect(state.requests).toBe(2);
    expect(t.last()).toBe("held");
  });

  it("does not ask twice while it holds the lock", async () => {
    const { env, state, becomeVisible, touch } = fakeEnv();
    keepScreenOn(env, () => {});
    await flush();
    await becomeVisible("visible");
    await touch();
    expect(state.requests).toBe(1);
  });

  it("reports a refusal and tries again on the next touch", async () => {
    const { env, state, touch } = fakeEnv();
    state.refuse = true;
    const t = track();
    keepScreenOn(env, t.onStatus);
    await flush();
    expect(t.last()).toBe("denied");
    state.refuse = false;
    await touch();
    expect(t.last()).toBe("held");
    expect(state.requests).toBe(2);
    // The retry never went back to "pending" (the notice does not flicker).
    expect(t.seen).toEqual(["pending", "denied", "held"]);
  });

  it("does not ask while the page is hidden when it opens", async () => {
    const { env, state, becomeVisible } = fakeEnv();
    state.visibility = "hidden";
    const t = track();
    keepScreenOn(env, t.onStatus);
    await flush();
    expect(state.requests).toBe(0);
    await becomeVisible("visible");
    expect(t.last()).toBe("held");
  });

  it("says unsupported when the browser has no wake lock", () => {
    const { env } = fakeEnv({ supported: false });
    const t = track();
    const stop = keepScreenOn(env, t.onStatus);
    expect(t.seen).toEqual(["unsupported"]);
    stop();
  });

  it("lets the lock go and stops listening when stopped", async () => {
    const { env, state, becomeVisible } = fakeEnv();
    const t = track();
    const stop = keepScreenOn(env, t.onStatus);
    await flush();
    expect(state.sentinels[0]!.released).toBe(false);
    stop();
    expect(state.sentinels[0]!.released).toBe(true);
    const before = t.seen.length;
    await becomeVisible("visible");
    expect(state.requests).toBe(1);
    expect(t.seen.length).toBe(before);
  });

  it("releases a lock that arrives after it was stopped", async () => {
    const { env, state } = fakeEnv();
    const t = track();
    const stop = keepScreenOn(env, t.onStatus);
    stop();
    await flush();
    expect(state.sentinels[0]!.released).toBe(true);
    expect(t.seen).toEqual(["pending"]);
  });

  it("stays quiet about a refusal that arrives after it was stopped", async () => {
    const { env, state } = fakeEnv();
    state.refuse = true;
    const t = track();
    const stop = keepScreenOn(env, t.onStatus);
    stop();
    await flush();
    expect(t.seen).toEqual(["pending"]);
  });
});
