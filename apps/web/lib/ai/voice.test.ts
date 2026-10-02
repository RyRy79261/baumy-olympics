import { describe, expect, it } from "vitest";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import {
  HOLD_MS,
  MAX_RECORDING_MS,
  MIC_OFF,
  PREFERRED_MIME_TYPES,
  SILENCE_LEVEL,
  SILENT_CLIP,
  canRecord,
  clipType,
  heardNothing,
  levelOf,
  micFailure,
  micStep,
  onRelease,
  pickMimeType,
  type MicEffect,
  type MicEvent,
  type MicMachine,
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

describe("pickMimeType's types", () => {
  it("are all ones the transcribe route takes, mp4 for an iPad", () => {
    // What iOS Safari answers: no webm recorder, mp4/AAC.
    const ipad = (t: string) => t === "audio/mp4";
    expect(pickMimeType(ipad)).toBe("audio/mp4");
    const ogg = (t: string) => t.startsWith("audio/ogg");
    expect(pickMimeType(ogg)).toBe("audio/ogg;codecs=opus");
    for (const t of PREFERRED_MIME_TYPES) {
      expect(t.split(";")[0]).toMatch(/^audio\/(webm|mp4|ogg)$/);
    }
  });
});

describe("clipType", () => {
  it("is what the recorder wrote, else what was asked for", () => {
    expect(clipType("audio/mp4", "audio/mp4; codecs=mp4a.40.2")).toBe(
      "audio/mp4; codecs=mp4a.40.2",
    );
    expect(clipType("audio/webm;codecs=opus", "")).toBe(
      "audio/webm;codecs=opus",
    );
    expect(clipType("audio/mp4", undefined)).toBe("audio/mp4");
    expect(clipType("audio/mp4", "  ")).toBe("audio/mp4");
  });
});

describe("micStep", () => {
  const run = (events: MicEvent["type"][], from: MicMachine = MIC_OFF) => {
    let m = from;
    const effects: MicEffect[] = [];
    for (const type of events) {
      const step = micStep(m, { type } as MicEvent);
      m = step.next;
      effects.push(...step.effects);
    }
    return { m, effects };
  };

  it("the cat: a tap opens the microphone, each hold records a clip, it stays open", () => {
    expect(run(["open"])).toEqual({
      m: { phase: "opening", keep: true },
      effects: ["request"],
    });
    expect(run(["open", "granted"]).m).toEqual({ phase: "ready", keep: true });
    expect(run(["open", "granted", "press"])).toEqual({
      m: { phase: "recording", keep: true },
      effects: ["request", "record"],
    });
    // Let go: the clip is sent and the microphone stays open for the next.
    expect(run(["open", "granted", "press", "release"])).toEqual({
      m: { phase: "ready", keep: true },
      effects: ["request", "record", "stop"],
    });
    expect(
      run(["open", "granted", "press", "release", "press", "release"]).effects,
    ).toEqual(["request", "record", "stop", "record", "stop"]);
    // The bubble closes: off, with nothing kept.
    expect(run(["open", "granted", "close"])).toEqual({
      m: MIC_OFF,
      effects: ["request", "shut"],
    });
  });

  it("the cat: a hold before the microphone answers records once it does, unless let go", () => {
    expect(run(["open", "press", "granted"])).toEqual({
      m: { phase: "recording", keep: true },
      effects: ["request", "record"],
    });
    // Let go during the permission prompt: nothing records, it waits.
    expect(run(["open", "press", "release", "granted"])).toEqual({
      m: { phase: "ready", keep: true },
      effects: ["request"],
    });
  });

  it("the sheet: a press opens the microphone and the clip turns it off", () => {
    expect(run(["press"])).toEqual({
      m: { phase: "pressing", keep: false },
      effects: ["request"],
    });
    expect(run(["press", "granted", "release"])).toEqual({
      m: MIC_OFF,
      effects: ["request", "record", "stop", "shut"],
    });
    // Let go during the prompt: it records on (tap-to-send, voice-recorder).
    expect(run(["press", "release", "granted"]).m.phase).toBe("recording");
  });

  it("a refused microphone turns it off from any wait", () => {
    expect(run(["open", "refused"])).toEqual({
      m: MIC_OFF,
      effects: ["request", "shut"],
    });
    expect(run(["open", "press", "refused"]).m).toEqual(MIC_OFF);
    expect(run(["press", "refused"]).m).toEqual(MIC_OFF);
  });

  it("ignores what does not apply", () => {
    for (const type of ["press", "granted", "refused", "release"] as const) {
      expect(run([type], { phase: "recording", keep: true })).toEqual(
        type === "release"
          ? { m: { phase: "ready", keep: true }, effects: ["stop"] }
          : { m: { phase: "recording", keep: true }, effects: [] },
      );
    }
    expect(run(["release", "granted", "refused"])).toEqual({
      m: MIC_OFF,
      effects: [],
    });
    // Closing shuts even from off: the meter's audio may be warm already.
    expect(run(["close"])).toEqual({ m: MIC_OFF, effects: ["shut"] });
    expect(run(["open", "open"]).effects).toEqual(["request"]);
    expect(run(["open", "granted", "open", "granted"]).m.phase).toBe("ready");
  });

  it("holds its rules over every sequence of six events", () => {
    const types: MicEvent["type"][] = [
      "open",
      "press",
      "granted",
      "refused",
      "release",
      "close",
    ];
    let sequences = 0;
    const walk = (m: MicMachine, depth: number) => {
      if (depth === 0) {
        sequences += 1;
        return;
      }
      for (const type of types) {
        const { next, effects } = micStep(m, { type } as MicEvent);
        // Only an off microphone is asked for, and only by open or press.
        if (effects.includes("request")) {
          expect(m.phase).toBe("off");
          expect(["open", "press"]).toContain(type);
        }
        // A recorder starts only on an open microphone, under a finger.
        if (effects.includes("record")) {
          expect(next.phase).toBe("recording");
          expect(m.phase === "ready" || m.phase === "pressing").toBe(true);
        }
        // Only a recording is stopped, and only by letting go.
        if (effects.includes("stop")) {
          expect(m.phase).toBe("recording");
          expect(type).toBe("release");
        }
        // Off means shut: whatever was open is turned off on the way.
        if (next.phase === "off") {
          expect(next.keep).toBe(false);
          if (m.phase !== "off") expect(effects).toContain("shut");
        } else {
          expect(effects).not.toContain("shut");
        }
        // Closing always ends off.
        if (type === "close") expect(next).toEqual(MIC_OFF);
        walk(next, depth - 1);
      }
    };
    walk(MIC_OFF, 6);
    expect(sequences).toBe(6 ** 6);
  });
});

describe("onRelease", () => {
  it("sends after a hold, and keeps recording after a tap", () => {
    expect(onRelease(HOLD_MS - 1)).toBe("keep");
    expect(onRelease(HOLD_MS)).toBe("send");
    expect(onRelease(5_000)).toBe("send");
    // Cut well inside the kiosk's idle minute.
    expect(MAX_RECORDING_MS).toBe(45_000);
    expect(MAX_RECORDING_MS).toBeLessThanOrEqual(KIOSK_IDLE_MS - 15_000);
  });
});

describe("heardNothing", () => {
  it("drops a clip only when a running meter never rose above silence", () => {
    expect(heardNothing(0.001, true)).toBe(true);
    expect(heardNothing(SILENCE_LEVEL - 0.001, true)).toBe(true);
    // Exactly 0 the whole time: a dead meter (some iOS versions report
    // running audio that reads flat), not a silent room. Send it.
    expect(heardNothing(0, true)).toBe(false);
    expect(heardNothing(SILENCE_LEVEL, true)).toBe(false);
    expect(heardNothing(0.4, true)).toBe(false);
    // A meter that never ran (suspended audio on iOS) proves nothing.
    expect(heardNothing(0, false)).toBe(false);
    expect(SILENT_CLIP).toMatch(/hold and speak/);
  });
});
