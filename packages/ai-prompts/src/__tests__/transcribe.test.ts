import { describe, expect, it } from "vitest";
import {
  GERMAN_PLACE_WORDS,
  TRANSCRIPTION_PROMPT_MAX_CHARS,
  WHISPER_MODEL,
  transcriptionPrompt,
} from "../transcribe";

describe("transcriptionPrompt", () => {
  it("pins the Groq Whisper model", () => {
    expect(WHISPER_MODEL).toBe("whisper-large-v3-turbo");
  });

  it("lists members, then chores, then the German place words", () => {
    const p = transcriptionPrompt({
      members: ["Ryan", "Jördis"],
      chores: ["Trash", "Altglas run"],
    });
    expect(
      p.startsWith("Baumy Olympics. Ryan, Jördis, Trash, Altglas run,"),
    ).toBe(true);
    for (const w of GERMAN_PLACE_WORDS) expect(p).toContain(w);
    expect(p.endsWith("Späti.")).toBe(true);
  });

  it("drops duplicates ignoring case, and flattens commas and newlines", () => {
    const p = transcriptionPrompt({
      members: ["Sam", "sam", " "],
      chores: ["Bad", "Mop,\nfloor"],
    });
    expect(p.match(/\bSam\b/gi)).toHaveLength(1);
    expect(p.match(/\bBad\b/g)).toHaveLength(1);
    expect(p).toContain("Mop floor,");
  });

  it("stops at the limit on a whole word", () => {
    const chores = Array.from({ length: 200 }, (_, i) => `Chore number ${i}`);
    const p = transcriptionPrompt({ members: ["Ryan"], chores });
    expect(p.length).toBeLessThanOrEqual(TRANSCRIPTION_PROMPT_MAX_CHARS);
    expect(p).toContain("Ryan, Chore number 0,");
    expect(p).not.toContain("Chore number 199");
    expect(p.endsWith(".")).toBe(true);
    expect(transcriptionPrompt({ members: ["Ryan"], chores: [] }, 16)).toBe(
      "Baumy Olympics.",
    );
    expect(transcriptionPrompt({ members: ["Ryan"], chores: [] }, 22)).toBe(
      "Baumy Olympics. Ryan.",
    );
  });
});
