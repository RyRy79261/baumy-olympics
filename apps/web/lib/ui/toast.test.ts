import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "@/lib/actions/result";
import {
  TOAST_DURATION_MS,
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  toast,
  toastActionError,
} from "./toast";

beforeEach(() => dismissToast());

describe("toast store", () => {
  it("adds toasts, notifies subscribers and dismisses by id or all", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    const a = toast.info("Saved draft");
    const b = toast.success("Done");
    toast.error("Nope");
    expect(getToasts().map((t) => [t.variant, t.title, t.duration])).toEqual([
      ["info", "Saved draft", TOAST_DURATION_MS],
      ["success", "Done", TOAST_DURATION_MS],
      ["error", "Nope", TOAST_DURATION_MS],
    ]);
    expect(listener).toHaveBeenCalledTimes(3);
    dismissToast(a);
    expect(getToasts().map((t) => t.id)).not.toContain(a);
    expect(getToasts().map((t) => t.id)).toContain(b);
    dismissToast();
    expect(getToasts()).toEqual([]);
    unsubscribe();
    toast.info("unheard");
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("never shows anything on the server", () => {
    toast.info("client only");
    expect(getServerToasts()).toEqual([]);
  });
});

describe("toastActionError", () => {
  it("toasts a failure's message and says so", () => {
    expect(toastActionError(fail("RATE_LIMITED", "Wait 5s."))).toBe(true);
    expect(getToasts()).toMatchObject([
      { variant: "error", title: "Wait 5s." },
    ]);
  });

  it("does nothing for a success", () => {
    expect(toastActionError({ ok: true, data: null })).toBe(false);
    expect(getToasts()).toEqual([]);
  });
});
