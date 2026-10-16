import { afterEach, describe, expect, it, vi } from "vitest";
import {
  holdScreen,
  isScreenHeld,
  onScreenTaken,
  SCREEN_RULES,
  screenHeldFor,
  subscribeScreenHeld,
  takeScreen,
  type Takeover,
} from "./screen";

// The kitchen screen's one way to be taken, and who holds it (issue #213),
// against a fake document: open dialogs (some sending) and a window.

type FakeDialog = { open: boolean; sending: boolean; close: () => void };

function fakeScreen(dialogs: { sending?: boolean }[] = []) {
  const win = new EventTarget();
  const els: FakeDialog[] = dialogs.map(({ sending = false }) => {
    const el: FakeDialog = {
      open: true,
      sending,
      close: vi.fn(() => {
        el.open = false;
      }),
    };
    return el;
  });
  const doc = {
    defaultView: win,
    querySelectorAll: (selector: string) => {
      if (selector !== "dialog[open]") throw new Error(selector);
      return els.filter((e) => e.open);
    },
    querySelector: (selector: string) => {
      if (selector !== "dialog[open][data-sending]") throw new Error(selector);
      return els.find((e) => e.open && e.sending) ?? null;
    },
  } as unknown as Document;
  const covered = vi.fn();
  onScreenTaken(win as Window, covered);
  return { doc, els, covered };
}

afterEach(() => {
  holdScreen("cat", false);
  holdScreen("sheet", false);
});

describe("holding the screen", () => {
  it("is held while any holder is, and tells listeners of each change", () => {
    const heard = vi.fn();
    const stop = subscribeScreenHeld(heard);
    expect(isScreenHeld()).toBe(false);
    holdScreen("cat", true);
    expect(isScreenHeld()).toBe(true);
    holdScreen("cat", true);
    expect(heard).toHaveBeenCalledTimes(1);
    holdScreen("sheet", true);
    holdScreen("cat", false);
    expect(isScreenHeld()).toBe(true);
    holdScreen("sheet", false);
    expect(isScreenHeld()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(4);
    stop();
    holdScreen("cat", true);
    expect(heard).toHaveBeenCalledTimes(4);
  });
});

describe("taking the screen", () => {
  it("closes every open dialog and tells the rest to close", () => {
    const { doc, els, covered } = fakeScreen([{}, {}]);
    expect(els.every((e) => e.open)).toBe(true);
    expect(takeScreen("reminder", doc)).toBe(true);
    expect(els.some((e) => e.open)).toBe(false);
    expect(covered).toHaveBeenCalledOnce();
  });

  it("stops telling a listener once it unsubscribes", () => {
    const { doc } = fakeScreen();
    const late = vi.fn();
    const stop = onScreenTaken(doc.defaultView!, late);
    takeScreen("reminder", doc);
    expect(late).toHaveBeenCalledOnce();
    stop();
    takeScreen("reminder", doc);
    expect(late).toHaveBeenCalledOnce();
  });

  it.each<Takeover>(["idle-reset", "screensaver-idle"])(
    "%s waits while Baumy holds the screen, then takes it",
    (takeover) => {
      const { doc, els, covered } = fakeScreen([{}]);
      holdScreen("cat", true);
      expect(screenHeldFor(takeover, doc)).toBe(true);
      expect(takeScreen(takeover, doc)).toBe(false);
      // Nothing was taken: the sheet is open, Baumy's bubble was not told.
      expect(els[0]!.open).toBe(true);
      expect(covered).not.toHaveBeenCalled();
      holdScreen("cat", false);
      expect(takeScreen(takeover, doc)).toBe(true);
      expect(els[0]!.open).toBe(false);
      expect(covered).toHaveBeenCalledOnce();
    },
  );

  it.each<Takeover>(["nightfall", "reminder"])(
    "%s takes the screen even mid-conversation",
    (takeover) => {
      const { doc, els, covered } = fakeScreen([{}]);
      holdScreen("cat", true);
      expect(isScreenHeld()).toBe(true);
      expect(screenHeldFor(takeover, doc)).toBe(false);
      expect(takeScreen(takeover, doc)).toBe(true);
      expect(els[0]!.open).toBe(false);
      expect(covered).toHaveBeenCalledOnce();
    },
  );

  it("force-closes a sending sheet when going home (open question, #213)", () => {
    // Today's rule: a sending log or note sheet does not hold the screen.
    expect(SCREEN_RULES.sendingSheetDelaysIdle).toBe(false);
    const { doc, els, covered } = fakeScreen([{ sending: true }]);
    expect(doc.querySelector("dialog[open][data-sending]")).not.toBeNull();
    expect(screenHeldFor("idle-reset", doc)).toBe(false);
    expect(takeScreen("idle-reset", doc)).toBe(true);
    expect(els[0]!.open).toBe(false);
    expect(covered).toHaveBeenCalledOnce();
  });

  it("with the rule flipped, a sending sheet delays only the idle reset", () => {
    const rules = { ...SCREEN_RULES, sendingSheetDelaysIdle: true };
    const { doc, els, covered } = fakeScreen([{ sending: true }, {}]);
    expect(takeScreen("idle-reset", doc, rules)).toBe(false);
    expect(els.every((e) => e.open)).toBe(true);
    expect(covered).not.toHaveBeenCalled();
    // The screensaver and a reminder still take it.
    expect(screenHeldFor("screensaver-idle", doc, rules)).toBe(false);
    expect(takeScreen("reminder", doc, rules)).toBe(true);
    expect(els.some((e) => e.open)).toBe(false);
    // With no sheet sending, going home goes ahead.
    const idle = fakeScreen([{}]);
    expect(takeScreen("idle-reset", idle.doc, rules)).toBe(true);
    expect(idle.els[0]!.open).toBe(false);
  });
});
