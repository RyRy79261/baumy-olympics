import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearClientErrors,
  collectDiagnostics,
  installClientErrorCapture,
  onClientError,
  recordClientError,
} from "./client-errors";

// Ported from camp-404 `apps/web/lib/__tests__/client-errors.test.ts`: the
// in-memory error buffer a report can attach is capped, path-only, never in
// the console's way, and tells the reporter when something breaks.

let teardown: () => void = () => {};

afterEach(() => {
  teardown();
  teardown = () => {};
  clearClientErrors();
});

describe("client error capture", () => {
  it("keeps console errors, passes them through, and records the path only", () => {
    const seen: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => seen.push(args);
    try {
      teardown = installClientErrorCapture();
      window.history.pushState({}, "", "/settings?code=secret#frag");
      console.error(new TypeError("x is undefined"), "in Chores", { a: 1 });
      expect(seen).toHaveLength(1);
      expect(collectDiagnostics().errors).toEqual([
        expect.objectContaining({
          source: "console.error",
          message: 'TypeError: x is undefined in Chores {"a":1}',
          route: "/settings",
        }),
      ]);
    } finally {
      teardown();
      teardown = () => {};
      console.error = original;
    }
  });

  it("keeps uncaught errors and rejections, only the newest ten", () => {
    teardown = installClientErrorCapture();
    for (let i = 1; i <= 11; i++) {
      window.dispatchEvent(new ErrorEvent("error", { message: `error ${i}` }));
    }
    const rejection = new Event("unhandledrejection") as Event & {
      reason: unknown;
    };
    rejection.reason = new Error("nope");
    window.dispatchEvent(rejection);
    const errors = collectDiagnostics().errors;
    expect(errors).toHaveLength(10);
    expect(errors[0]!.message).toBe("error 3");
    expect(errors.at(-1)).toMatchObject({
      source: "unhandledrejection",
      message: "Error: nope",
    });
  });

  it("caps a long message, and describes what JSON cannot", () => {
    recordClientError("console.error", "m".repeat(1000));
    const circular: { self?: unknown } = {};
    circular.self = circular;
    recordClientError("console.error", circular);
    recordClientError("console.error", undefined);
    const [long, round, nothing] = collectDiagnostics().errors;
    expect(long!.message).toHaveLength(400);
    expect(round!.message).toBe("[object Object]");
    expect(nothing!.message).toBe("undefined");
  });

  it("tells its listeners, and a listener that throws harms nothing", () => {
    const heard = vi.fn();
    const stop = onClientError(() => {
      throw new Error("listener broke");
    });
    const stop2 = onClientError(heard);
    recordClientError("window.error", "boom");
    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({ source: "window.error", message: "boom" }),
    );
    stop();
    stop2();
    recordClientError("window.error", "again");
    expect(heard).toHaveBeenCalledOnce();
  });

  it("describes the device, never the person", () => {
    const labels = collectDiagnostics().environment.map((f) => f.label);
    expect(labels).toEqual(["Browser", "Language", "Online", "Screen", "Page"]);
  });

  it("installs once, and restores console.error on teardown", () => {
    const original = console.error;
    const stop = installClientErrorCapture();
    expect(console.error).not.toBe(original);
    const again = installClientErrorCapture();
    again();
    expect(console.error).not.toBe(original);
    stop();
    expect(console.error).toBe(original);
  });
});
