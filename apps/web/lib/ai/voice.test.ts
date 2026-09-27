import { describe, expect, it } from "vitest";
import {
  HOLD_MS,
  MAX_RECORDING_MS,
  PREFERRED_MIME_TYPES,
  canRecord,
  levelOf,
  micFailure,
  onRelease,
  pickMimeType,
} from "./voice";

describe("pickMimeType", () => {
  it("prefers webm/opus and falls back to mp4 on Safari", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    const safari = (t: string) => t.startsWith("audio/mp4");
    expect(pickMimeType(safari)).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeNull();
    expect(pickMimeType(undefined)).toBeNull();
    expect(
      pickMimeType((t) => {
        if (t.includes("webm")) throw new Error("unknown type");
        return true;
      }),
    ).toBe("audio/mp4");
    expect(PREFERRED_MIME_TYPES[0]).toBe("audio/webm;codecs=opus");
  });
});

describe("canRecord", () => {
  const mediaDevices = { getUserMedia: () => undefined };
  it("needs MediaRecorder, getUserMedia and a type it can write", () => {
    expect(canRecord(null)).toBe(false);
    expect(canRecord({ navigator: { mediaDevices } })).toBe(false);
    expect(
      canRecord({
        MediaRecorder: { isTypeSupported: () => true },
        navigator: {},
      }),
    ).toBe(false);
    expect(
      canRecord({
        MediaRecorder: { isTypeSupported: () => false },
        navigator: { mediaDevices },
      }),
    ).toBe(false);
    expect(
      canRecord({
        MediaRecorder: { isTypeSupported: () => true },
        navigator: { mediaDevices },
      }),
    ).toBe(true);
  });
});

describe("micFailure", () => {
  it("hides the microphone when it is blocked or missing", () => {
    for (const name of [
      "NotAllowedError",
      "SecurityError",
      "NotFoundError",
      "OverconstrainedError",
    ]) {
      const f = micFailure(new DOMException("x", name));
      expect(f.kind).toBe("unavailable");
      expect(f.message).toMatch(/type to Baumy instead/);
    }
  });

  it("offers a retry for anything else", () => {
    expect(micFailure(new DOMException("x", "AbortError")).kind).toBe("retry");
    expect(micFailure(new Error("boom")).kind).toBe("retry");
    expect(micFailure("weird").kind).toBe("retry");
    expect(micFailure(null).kind).toBe("retry");
  });
});

describe("levelOf", () => {
  it("is 0 for silence and grows with loudness, up to 1", () => {
    expect(levelOf([])).toBe(0);
    expect(levelOf(new Uint8Array(64).fill(128))).toBe(0);
    const quiet = levelOf(
      Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 136 : 120)),
    );
    const loud = levelOf(
      Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 200 : 56)),
    );
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(
      levelOf(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0))),
    ).toBe(1);
  });
});

describe("onRelease", () => {
  it("sends after a hold, and keeps recording after a tap", () => {
    expect(onRelease(HOLD_MS - 1)).toBe("keep");
    expect(onRelease(HOLD_MS)).toBe("send");
    expect(onRelease(5_000)).toBe("send");
    expect(MAX_RECORDING_MS).toBe(60_000);
  });
});
