"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  BaumyButton,
  BaumyCat,
  Button,
  CatBubble,
  CatButton,
  CatLink,
  CatSays,
  CatText,
  LevelBars,
  Dialog,
  Input,
  ScorePop,
  SpeechBubble,
} from "@baumy/ui";
import type { HistoryTurn } from "@/lib/ai/command";
import type { Proposal } from "@/lib/ai/proposal";
import {
  asksForPin,
  cancelAll,
  confirmAllTargets,
  nextHistory,
  rowsFor,
  savedMessage,
  type ReviewRow,
} from "@/lib/ai/review";
import { canRecord } from "@/lib/ai/voice";
import {
  KIOSK_COVER_EVENT,
  KIOSK_IDLE_MS,
  PIN_PROMPT_CODES,
} from "@/lib/kiosk/constants";
import { useIdle } from "@/components/kiosk/use-idle";
import { askBaumy, recheckProposal, runProposal, transcribeClip } from "./api";
import { SuggestionCards } from "./suggestion-cards";
import { useBaumyMood } from "./use-mood";
import { useRecorder } from "./use-recorder";
import { VoiceRecorder } from "./voice-recorder";

// The Baumy sheet (SPEC §3.6), after intake-tracker's
// `components/voice/voice-panel.tsx`: type to Baumy, read the answer in its
// speech bubble, and review what it suggests: one card per write, with
// "Confirm all" and "Cancel" (suggestion-cards.tsx, owner ruling 2026-09-29).
// Nothing is written until Confirm all; each card then runs through POST
// /api/actions/run with its proposal id as the idempotency key, so a partial
// save keeps what saved and a retry never saves a card twice. After a save
// the page re-reads itself, so the scoreboard and the widgets show it.
//
// Or hold to speak (issue #22): the clip is transcribed by Groq Whisper
// (POST /api/ai/transcribe) and the words are sent as if typed. The
// microphone is only offered when the deployment has a transcriber
// (`voice`) and the browser can record; a blocked microphone or a
// transcriber that went away hides it again, and typing carries on.
//
// Baumy's sprite follows lib/ai/mood.ts: listening while held, thinking
// while transcribing and asking, talking with the answer, sad on an error,
// happy (with the "+N" pop) when an approved row scores points.
//
// On the kitchen dashboard (`cat`, ADR 0005 §1, the approved prototype's
// baumy-cat.tsx) the cat itself is the button and the talking happens in
// its speech bubble: a tap starts listening ("Mrrp? I'm listening…", level
// bars, "Done talking"), then what Baumy understood shows as "Got it! I'll
// do this:" with the same suggestion cards, "Confirm all" and "Cancel",
// through the same transcribe, command and run calls as the sheet. "Type instead" opens the sheet
// with the same conversation. With nobody tapped in, the bubble first asks
// who is talking; without a microphone, a tap opens the sheet.

type CatMode = "who" | "ready" | "listening" | "thinking" | "answer";

const VOICE_NOTE_HINT =
  "Say it like a voice note: \u201cI bought cat food and the bins are out.\u201d";

/** How long the "+N" stays after a save that scored. */
const POP_MS = 1_600;

const noSubscribe = () => () => {};

/** How long Baumy's "Purrfect" bubble stays after the sheet closes. */
const SAYS_MS = 4_000;

export function BaumySheet({
  kiosk = false,
  actingName,
  voice = false,
  cat = false,
  who,
}: {
  kiosk?: boolean;
  /** The kiosk's acting member, for "Ryan's PIN". */
  actingName?: string;
  /** This deployment can transcribe speech (GROQ_API_KEY, or the e2e fake). */
  voice?: boolean;
  /**
   * The kitchen dashboard's Baumy (ADR 0005 §1): the cat itself, standing
   * over the footer's end, and its speech bubble says what an approval
   * scored once the sheet closes. Otherwise the button on its plinth.
   */
  cat?: boolean;
  /** The kiosk's avatars, while nobody is acting: "Who's asking?". */
  who?: ReactNode;
}) {
  const router = useRouter();
  const surface = kiosk ? "kiosk" : "ui";
  const size = kiosk ? "kiosk" : "default";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [mood, feel] = useBaumyMood();
  const [heard, setHeard] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [micOff, setMicOff] = useState<string | null>(null);
  const [micHint, setMicHint] = useState<string | null>(null);
  const [pop, setPop] = useState<{ key: number; points: number } | null>(null);
  // What approvals scored while the sheet was open, and the bubble saying it.
  const earned = useRef(0);
  const [says, setSays] = useState<string | null>(null);
  useEffect(() => {
    if (!says) return;
    const timer = setTimeout(() => setSays(null), SAYS_MS);
    return () => clearTimeout(timer);
  }, [says]);
  const textRef = useRef<HTMLInputElement>(null);
  // Whether this browser can record; false while rendering on the server.
  const recordable = useSyncExternalStore(
    noSubscribe,
    () => canRecord(window as unknown as Parameters<typeof canRecord>[0]),
    () => false,
  );
  const showMic = voice && recordable && micOff === null;
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  const [bulk, setBulk] = useState(false);
  // The latest rows, for approvals that run one after another.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const update = (id: string, patch: Partial<ReviewRow>) =>
    setRows((rs) =>
      rs.map((r) => (r.proposal.proposalId === id ? { ...r, ...patch } : r)),
    );

  /**
   * Send what was typed or said; true when Baumy answered. `current` says
   * whether the conversation that asked is still on screen: an answer that
   * comes back after it was closed shows nowhere.
   */
  async function send(
    said: string,
    current: () => boolean = () => true,
  ): Promise<boolean> {
    setAsking(true);
    feel({ type: "ask" });
    const result = await askBaumy(said, history, surface);
    setAsking(false);
    if (!current()) return false;
    if (!result.ok) {
      setReply({ text: result.message, error: true });
      feel({ type: "error" });
      return false;
    }
    setReply({ text: result.data.reply, error: false });
    feel({ type: "reply" });
    setRows(rowsFor(result.data.proposals));
    setHistory((h) => nextHistory(h, said, result.data.reply));
    return true;
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const said = text.trim();
    if (!said || asking || transcribing) return;
    setHeard(null);
    if (await send(said)) setText("");
  }

  function micUnavailable(message: string) {
    feel({ type: "record_cancel" });
    setMicOff(message);
    setMicHint(null);
    textRef.current?.focus();
  }

  async function heardClip(clip: Blob, mime: string) {
    feel({ type: "record_stop" });
    setTranscribing(true);
    const result = await transcribeClip(clip, mime, surface);
    setTranscribing(false);
    if (!result.ok) {
      setReply({ text: result.message, error: true });
      feel({ type: "error" });
      // The transcriber went away (the key was removed): type instead.
      if (result.code === "NOT_CONFIGURED") setMicOff(result.message);
      return;
    }
    setHeard(result.data.text);
    await send(result.data.text);
  }

  /** Approve one row; true when it saved. */
  async function approve(row: ReviewRow, pin?: string): Promise<boolean> {
    const id = row.proposal.proposalId;
    update(id, { state: "saving", message: undefined });
    const result = await runProposal(row.proposal, surface, pin);
    if (result.ok) {
      update(id, { state: "saved", message: savedMessage(result.data) });
      const pts = (result.data as { totalPts?: unknown } | null)?.totalPts;
      const points = typeof pts === "number" ? pts : null;
      feel({ type: "points", points });
      if (points !== null && points > 0) {
        earned.current += points;
        const key = Date.now();
        setPop({ key, points });
        setTimeout(() => setPop((p) => (p?.key === key ? null : p)), POP_MS);
      }
      router.refresh();
      return true;
    }
    if (kiosk && asksForPin(result, PIN_PROMPT_CODES)) {
      update(id, { state: "pending", needsPin: true, message: result.message });
      return false;
    }
    update(id, { state: "failed", message: result.message });
    feel({ type: "error" });
    return false;
  }

  /** Run every valid card, in order; the PIN goes with those that need it. */
  async function confirmAll(pin?: string) {
    setBulk(true);
    try {
      // One at a time, so the cards that saved stay saved if one fails.
      for (const row of confirmAllTargets(rowsRef.current)) {
        await approve(row, row.needsPin ? pin : undefined);
      }
    } finally {
      setBulk(false);
    }
  }

  function drop(row: ReviewRow) {
    update(row.proposal.proposalId, { state: "rejected", message: undefined });
  }

  async function edit(row: ReviewRow, input: Record<string, unknown>) {
    const result = await recheckProposal(row.proposal.name, input, surface);
    if (!result.ok) {
      update(row.proposal.proposalId, { message: result.message });
      return;
    }
    const next: Proposal = result.data;
    setRows((rs) =>
      rs.map((r) =>
        r.proposal.proposalId === row.proposal.proposalId
          ? { proposal: next, state: "pending", needsPin: next.needsPin }
          : r,
      ),
    );
  }

  const busy = asking || transcribing;

  /** Once the talking is over: Baumy says what the approvals scored. */
  function sayEarned() {
    if (earned.current > 0) {
      setSays(
        `Purrfect. +${earned.current}${actingName ? ` for ${actingName}` : ""} ✦`,
      );
    }
    earned.current = 0;
  }

  function close() {
    // A recording in progress is dropped when the recorder unmounts.
    feel({ type: "record_cancel" });
    setMicHint(null);
    setOpen(false);
    sayEarned();
  }

  function wake() {
    feel({ type: "wake" });
    setSays(null);
    setOpen(true);
  }

  // ---------------------------------------------- the dashboard's cat
  const [bubble, setBubble] = useState<CatMode | null>(null);
  // A recording stopped by closing the bubble is dropped, not sent.
  const dropClip = useRef(false);
  // Which bubble a transcribe or an answer in flight belongs to: closing it
  // (a tap, a reminder, the screensaver, idle) moves on, so a late answer
  // never reopens it with the last person's proposals.
  const generation = useRef(0);
  const recorder = useRecorder({
    onStart: () => feel({ type: "record_start" }),
    onClip: (clip, mime) => {
      if (!dropClip.current) void catHeard(clip, mime);
    },
    onCancel: (message) => {
      if (dropClip.current) return;
      feel({ type: "record_cancel" });
      setReply({
        text: message ?? "I didn't catch that. Tap me and try again?",
        error: true,
      });
      setBubble("answer");
    },
    onUnavailable: (message) => {
      // No microphone here: type instead, in the sheet.
      feel({ type: "record_cancel" });
      setMicOff(message);
      setBubble(null);
      setOpen(true);
    },
  });

  // Tapped in from the bubble: ready to talk.
  useEffect(() => {
    if (bubble === "who" && actingName) setBubble("ready");
  }, [bubble, actingName]);

  function listen() {
    dropClip.current = false;
    setReply(null);
    setRows([]);
    setHeard(null);
    setBubble("listening");
    void recorder.begin();
  }

  /** Still thinking in the bubble: show the answer there (not after Type instead). */
  const showAnswer = (b: CatMode | null): CatMode | null =>
    b === "thinking" ? "answer" : b;

  async function catHeard(clip: Blob, mime: string) {
    const mine = generation.current;
    const current = () => generation.current === mine;
    setBubble("thinking");
    feel({ type: "record_stop" });
    setTranscribing(true);
    const result = await transcribeClip(clip, mime, surface);
    setTranscribing(false);
    if (!current()) return;
    if (!result.ok) {
      setReply({ text: result.message, error: true });
      feel({ type: "error" });
      if (result.code === "NOT_CONFIGURED") setMicOff(result.message);
      setBubble(showAnswer);
      return;
    }
    setHeard(result.data.text);
    await send(result.data.text, current);
    if (!current()) return;
    setBubble(showAnswer);
  }

  function hideBubble() {
    generation.current += 1;
    dropClip.current = true;
    if (recorder.state !== "idle") {
      recorder.finish();
      feel({ type: "record_cancel" });
    }
    setBubble(null);
    sayEarned();
  }

  function typeInstead() {
    dropClip.current = true;
    if (recorder.state !== "idle") {
      recorder.finish();
      feel({ type: "record_cancel" });
    }
    setBubble(null);
    setOpen(true);
  }

  function tapCat() {
    if (bubble !== null) {
      hideBubble();
      return;
    }
    feel({ type: "wake" });
    setSays(null);
    if (kiosk && !actingName) setBubble("who");
    else if (showMic) listen();
    else setOpen(true);
  }

  async function catConfirmAll(pin?: string) {
    await confirmAll(pin);
    // Let the cards' last states render before reading them.
    await new Promise((r) => setTimeout(r, 0));
    // Everything is done and scored: the cat says so instead.
    const unsettled = rowsRef.current.some(
      (r) => r.state === "pending" || r.state === "failed",
    );
    if (!unsettled && earned.current > 0) hideBubble();
  }

  function catCancel() {
    setRows(cancelAll);
    hideBubble();
  }

  function sheetCancel() {
    setRows(cancelAll);
    close();
  }

  // A bubble left open closes after a minute untouched.
  useIdle(cat && bubble !== null, KIOSK_IDLE_MS, hideBubble);
  // A reminder or the screensaver taking the screen closes it at once, and
  // drops any recording: nothing listens under them.
  const hideLatest = useRef(hideBubble);
  hideLatest.current = hideBubble;
  const bubbleOpen = cat && bubble !== null;
  useEffect(() => {
    if (!bubbleOpen) return;
    const onCover = () => hideLatest.current();
    window.addEventListener(KIOSK_COVER_EVENT, onCover);
    return () => window.removeEventListener(KIOSK_COVER_EVENT, onCover);
  }, [bubbleOpen]);

  const pinLabel = actingName ? `${actingName}'s PIN` : "Your PIN";

  const answer = reply?.error ? (
    <>
      <CatText tone="error">{reply.text}</CatText>
      <div className="mt-4 flex gap-3">
        <CatButton onClick={hideBubble}>OK</CatButton>
      </div>
    </>
  ) : rows.length > 0 ? (
    <>
      <CatSays size="sm">Got it! I&apos;ll do this:</CatSays>
      <SuggestionCards
        rows={rows}
        kiosk={kiosk}
        bubble
        pinLabel={pinLabel}
        busy={bulk}
        onConfirmAll={(pin) => void catConfirmAll(pin)}
        onCancel={catCancel}
        onDone={hideBubble}
        onDrop={drop}
      />
    </>
  ) : (
    <>
      <CatText>{reply?.text ?? ""}</CatText>
      <div className="mt-4 flex gap-3">
        <CatButton onClick={hideBubble}>OK</CatButton>
      </div>
    </>
  );

  const catBubble =
    bubble === null ? (
      says ? (
        <CatBubble mode="says">
          <span role="status" className="font-display text-[16px]">
            {says}
          </span>
        </CatBubble>
      ) : null
    ) : (
      <CatBubble mode={bubble}>
        {bubble === "who" ? (
          <>
            <CatSays>Mrrp? Who&apos;s talking?</CatSays>
            <CatText tone="muted">Tap yourself first.</CatText>
            {/* The bubble grows up from the cat, so a long list scrolls
                inside it rather than running off the top of the screen. */}
            <div
              className="mt-3 flex max-h-[45vh] flex-wrap gap-2 overflow-y-auto"
              data-testid="who-list"
            >
              {who}
            </div>
          </>
        ) : bubble === "ready" ? (
          <>
            <CatSays>Mrrp? Hi {actingName}.</CatSays>
            {showMic ? (
              <>
                <CatText tone="muted">{VOICE_NOTE_HINT}</CatText>
                <div className="mt-4 flex">
                  <CatButton onClick={listen}>Start talking</CatButton>
                </div>
              </>
            ) : null}
          </>
        ) : bubble === "listening" ? (
          <>
            <div className="flex items-center gap-4">
              <LevelBars level={recorder.level} />
              <CatSays>Mrrp? I&apos;m listening&hellip;</CatSays>
            </div>
            <CatText tone="muted">{VOICE_NOTE_HINT}</CatText>
            <div className="mt-4 flex">
              <CatButton
                onClick={recorder.finish}
                disabled={recorder.state !== "recording"}
              >
                Done talking
              </CatButton>
            </div>
          </>
        ) : bubble === "thinking" ? (
          <CatSays>
            {transcribing ? "Listening back\u2026" : "Hmm, let me think\u2026"}
          </CatSays>
        ) : (
          answer
        )}
        <CatLink onClick={typeInstead}>Type instead</CatLink>
      </CatBubble>
    );

  return (
    <>
      {cat ? (
        <div className="relative" data-voice-cat>
          {catBubble}
          <button
            type="button"
            aria-label="Ask Baumy"
            aria-expanded={bubble !== null}
            onClick={tapCat}
            className="block touch-manipulation"
          >
            <BaumyCat state={mood} scale={4} />
          </button>
        </div>
      ) : (
        <BaumyButton state={mood} onClick={wake} />
      )}
      <Dialog open={open} onClose={close} title="Ask Baumy">
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
          {pop ? <ScorePop key={pop.key} points={pop.points} /> : null}
          {who ? (
            <section aria-label="Who's asking?" className="flex flex-col gap-2">
              <p className="font-label text-sm font-bold text-bm-muted uppercase">
                Who&apos;s asking? Tap yourself.
              </p>
              <div className="flex flex-wrap gap-2">{who}</div>
            </section>
          ) : null}
          <SpeechBubble
            state={mood}
            tone={reply?.error && !busy ? "error" : "normal"}
          >
            {transcribing
              ? "Listening back…"
              : asking
                ? "Hmm, let me think…"
                : mood === "listening"
                  ? "I'm listening…"
                  : (reply?.text ??
                    `Tell me what you did ("I took the trash out") or ask me something ("Who's winning?").${showMic ? " Hold the button to speak, or type." : ""}`)}
          </SpeechBubble>

          {heard ? (
            <p className="text-sm text-bm-muted" data-testid="baumy-heard">
              You said: “{heard}”
            </p>
          ) : null}

          {open && showMic ? (
            <VoiceRecorder
              kiosk={kiosk}
              sending={busy}
              onStart={() => {
                setMicHint(null);
                feel({ type: "record_start" });
              }}
              onClip={(clip, mime) => void heardClip(clip, mime)}
              onCancel={(message) => {
                feel({ type: "record_cancel" });
                setMicHint(message);
              }}
              onUnavailable={micUnavailable}
            />
          ) : null}
          {micHint || (voice && micOff) ? (
            <p role="status" className="text-sm text-bm-muted">
              {micHint ?? micOff}
            </p>
          ) : null}

          <form onSubmit={ask} className="flex gap-2" aria-label="Ask Baumy">
            <label htmlFor="baumy-text" className="sr-only">
              Message to Baumy
            </label>
            <Input
              ref={textRef}
              id="baumy-text"
              kiosk={kiosk}
              autoComplete="off"
              maxLength={1000}
              placeholder="Type to Baumy"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
            <Button
              type="submit"
              size={size}
              disabled={busy || text.trim() === ""}
            >
              Send
            </Button>
          </form>

          {rows.length > 0 ? (
            <SuggestionCards
              rows={rows}
              kiosk={kiosk}
              pinLabel={pinLabel}
              busy={bulk}
              onConfirmAll={(pin) => void confirmAll(pin)}
              onCancel={sheetCancel}
              onDone={close}
              onDrop={drop}
              onEdit={edit}
            />
          ) : (
            <Button variant="secondary" size={size} onClick={close}>
              Close
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
