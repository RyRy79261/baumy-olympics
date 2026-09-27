// Speech to text for the Baumy command (SPEC §3.6, issue #22), after
// intake-tracker `apps/web/src/app/api/ai/voice-transcribe/route.ts`.
//
// Whisper's `prompt` is not an instruction: it is text the model treats as
// what came before the clip, which biases it towards those spellings. So it
// is a short run of the household's own words: the members' names, the
// chores' names, and the German words a Berlin flat says about its rooms and
// its rubbish, which an English-first model would otherwise mangle.

/** The Groq Whisper model (SPEC §3.6). */
export const WHISPER_MODEL = "whisper-large-v3-turbo" as const;

/**
 * Groq refuses a prompt over 224 tokens. Names and German words run at
 * about three characters a token, so the prompt stops well short of that.
 */
export const TRANSCRIPTION_PROMPT_MAX_CHARS = 600;

/** Rooms, bins and kitchen words, as a Berlin flat says them. */
export const GERMAN_PLACE_WORDS = [
  "Küche",
  "Bad",
  "Flur",
  "Wohnzimmer",
  "Balkon",
  "Keller",
  "Treppenhaus",
  "Hof",
  "Spülmaschine",
  "Kühlschrank",
  "Müll",
  "Biomüll",
  "Restmüll",
  "Gelber Sack",
  "Altpapier",
  "Altglas",
  "Pfand",
  "Späti",
] as const;

function clean(name: string): string {
  // One line each: a name with a newline or a comma would run into the next.
  return name.replace(/[\s,]+/g, " ").trim();
}

/**
 * The Whisper prompt: "Baumy Olympics", then the member names, the chore
 * names and the German words, each list comma separated and de-duplicated,
 * cut at `maxChars` on a whole word (chores beyond it are left out, since
 * the German words matter less than names only this flat uses).
 */
export function transcriptionPrompt(
  input: { members: readonly string[]; chores: readonly string[] },
  maxChars: number = TRANSCRIPTION_PROMPT_MAX_CHARS,
): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of [
    ...input.members,
    ...input.chores,
    ...GERMAN_PLACE_WORDS,
  ]) {
    const w = clean(raw);
    const key = w.toLowerCase();
    if (!w || seen.has(key)) continue;
    seen.add(key);
    words.push(w);
  }
  let out = "Baumy Olympics.";
  for (const w of words) {
    const next = `${out} ${w},`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out.endsWith(",") ? `${out.slice(0, -1)}.` : out;
}
