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
  HoldToTalk,
  Dialog,
  Input,
  ScorePop,
  SpeechBubble,
} from "@baumy/ui";
import { isAsking, isTranscribing } from "@/lib/ai/conversation";
import { confirmAllTargets, isOpen } from "@/lib/ai/review";
import { canRecord } from "@/lib/ai/voice";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import { useIdle } from "@/components/kiosk/use-idle";
import { useActingPin } from "@/components/kiosk/acting-pin";
import { noPinHeadline } from "@/components/kiosk/no-pin-notice";
import { holdScreen, onScreenTaken } from "@/lib/kiosk/screen";
import { announceScore } from "@/lib/ui/scored";
import { SuggestionCards } from "./suggestion-cards";
import { useConversation } from "./use-conversation";
import { useBaumyMood } from "./use-mood";
import { usePublishToBar } from "./bar-relay";
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
// The conversation itself (asking, transcribing, the cards, Confirm all
// with the PIN, and dropping an answer that comes back after a close) is
// lib/ai/conversation.ts, through ./use-conversation.ts: the sheet and the
// cat's bubble below are two views of it.
//
// On the kitchen dashboard (`cat`, ADR 0005 §1, the approved prototype's
// baumy-cat.tsx) the cat itself is the button and the talking happens in
// its speech bubble (issue #132): a tap opens the microphone and shows a big
// "Hold to talk"; while it is held, "Mrrp? I'm listening…" with the level
// bars and a red pulse; letting go transcribes, and what Baumy understood
// shows as "Got it! I'll do this:" with the same suggestion cards, "Confirm
// all" and "Cancel", through the same transcribe, command and run calls as
// the sheet. The bubble stays: once the cards are settled (or after a plain
// answer, or Cancel) "Hold to talk" is there again, until "Done", its "×",
// a tap on the cat or anywhere outside the bubble (never during a hold), a
// minute untouched, or a reminder or the screensaver. "Type
// instead" opens the sheet with the same conversation. With nobody tapped
// in, the bubble first asks who is talking; without a microphone, a tap
// opens the sheet.

type CatMode = "who" | "talk" | "thinking" | "answer";

const VOICE_NOTE_HINT =
  "Say it like a voice note: \u201cI bought cat food and the bins are out.\u201d";

/** This bubble's hold on the screen (lib/kiosk/screen.ts). */
const BUSY_ID = "baumy-cat";

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
  docked = false,
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
  /**
   * The hub home's (issue #152): the corner button shows from 89rem
   * (1424px, where the page's side margin clears it) up only; below that
   * the top bar's button (components/hub/hub-baumy.tsx) opens this
   * sheet through the relay (./bar-relay.ts).
   */
  docked?: boolean;
  /** The kiosk's avatars, while nobody is acting: "Who's asking?". */
  who?: ReactNode;
}) {
  const router = useRouter();
  const surface = kiosk ? "kiosk" : "ui";
  const size = kiosk ? "kiosk" : "default";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mood, feel] = useBaumyMood();
  const [micHint, setMicHint] = useState<string | null>(null);
  const [pop, setPop] = useState<{ key: number; points: number } | null>(null);
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

  // Asking, transcribing, the cards, Confirm all and the stale-answer rule
  // (lib/ai/conversation.ts): the sheet and the bubble are views of it.
  const [chat, conversation] = useConversation({
    surface,
    feel,
    onSaved: (points) => {
      if (points !== null && points > 0) {
        const key = Date.now();
        setPop({ key, points });
        announceScore(points);
        setTimeout(() => setPop((p) => (p?.key === key ? null : p)), POP_MS);
      }
      router.refresh();
    },
  });
  const { reply, heard, rows, micOff } = chat;
  const asking = isAsking(chat);
  const transcribing = isTranscribing(chat);
  const bulk = chat.confirming;
  const showMic = voice && recordable && micOff === null;

  // Whether the acting member has a personal PIN (the kiosk shell's
  // boolean, issue #145), or the gate has just said they have none: then
  // Confirm all runs the cards that need no PIN and leaves the others
  // waiting with "<Name> hasn't set a personal PIN yet", never a PinPad.
  const acting = useActingPin();
  useEffect(
    () => conversation.actingChanged(),
    [conversation, acting.name, acting.hasPin],
  );
  const hasPin = acting.hasPin && !chat.pinMissing;
  const noPinMessage = `${noPinHeadline(acting.name ?? actingName)}.`;
  // The latest, for Confirm all, which reads it again for each card.
  const actingHasPin = useRef(acting.hasPin);
  actingHasPin.current = acting.hasPin;

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const said = text.trim();
    if (!said || asking || transcribing) return;
    const outcome = await conversation.ask(said);
    if (outcome.kind === "answered") setText("");
  }

  function micUnavailable(message: string) {
    feel({ type: "record_cancel" });
    conversation.micOff(message);
    setMicHint(null);
    textRef.current?.focus();
  }

  function confirmAll(pin?: string) {
    return conversation.confirmAll({
      pin,
      kiosk,
      hasPin: () => actingHasPin.current,
      noPinMessage,
    });
  }

  const busy = asking || transcribing;

  /** Once the talking is over: Baumy says what the approvals scored. */
  function sayEarned() {
    const earned = conversation.takeEarned();
    if (earned > 0) {
      setSays(
        `Purrfect. +${earned}${actingName ? ` for ${actingName}` : ""} ✦`,
      );
    }
  }

  function close() {
    // A question or a clip still on its way belongs to this opening (its ×,
    // Cancel, the kiosk going home): its answer is dropped, never bringing
    // back the last person's cards, and the next one starts ready, not
    // "thinking" (#174).
    conversation.close();
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
  usePublishToBar(docked, mood, wake);

  // ---------------------------------------------- the dashboard's cat
  const [bubble, setBubble] = useState<CatMode | null>(null);
  // A recording stopped by closing the bubble is dropped, not sent.
  const dropClip = useRef(false);
  // What a too-short hold or a passing microphone failure says, under the
  // button, without leaving it.
  const [holdHint, setHoldHint] = useState<string | null>(null);
  // "Purrfect. +N for Ryan ✦" in the bubble once Confirm all scored.
  const [praise, setPraise] = useState<string | null>(null);
  const recorder = useRecorder({
    onStart: () => {
      // A new hold: the last answer (all of it settled) makes way.
      feel({ type: "record_start" });
      conversation.clear();
      setPraise(null);
      setHoldHint(null);
      setBubble("talk");
    },
    onClip: (clip, mime) => {
      if (!dropClip.current) void catHeard(clip, mime);
    },
    onCancel: (message) => {
      if (dropClip.current) return;
      feel({ type: "record_cancel" });
      setHoldHint(message ?? "I didn't catch that. Hold the button and talk.");
    },
    onUnavailable: (message) => {
      // No microphone here: type instead, in the sheet.
      feel({ type: "record_cancel" });
      conversation.micOff(message);
      setBubble(null);
      setOpen(true);
    },
  });

  /** "Hold to talk", with the microphone opened by the tap that got here. */
  function talk() {
    dropClip.current = false;
    conversation.clear();
    setPraise(null);
    setHoldHint(null);
    setBubble("talk");
    recorder.open();
  }

  // Tapped in from the bubble: ready to talk (or to type, without a mic).
  const talkLatest = useRef(talk);
  talkLatest.current = talk;
  useEffect(() => {
    if (bubble !== "who" || !actingName) return;
    if (showMic) {
      talkLatest.current();
    } else {
      setBubble(null);
      setOpen(true);
    }
  }, [bubble, actingName, showMic]);

  /** Still thinking in the bubble: show the answer there (not after Type instead). */
  const showAnswer = (b: CatMode | null): CatMode | null =>
    b === "thinking" ? "answer" : b;

  async function catHeard(clip: Blob, mime: string) {
    setBubble("thinking");
    // Dropped when the bubble closed (a tap, a reminder, the screensaver,
    // idle) while it was on its way: it never reopens with the last
    // person's proposals.
    const outcome = await conversation.hear(clip, mime);
    if (outcome.kind === "dropped") return;
    if (
      outcome.kind === "failed" &&
      outcome.step === "transcribing" &&
      outcome.code === "NOT_CONFIGURED"
    ) {
      recorder.close();
    }
    setBubble(showAnswer);
  }

  /** Turn the microphone off; a recording in progress is dropped. */
  function stopListening() {
    dropClip.current = true;
    if (recorder.state === "recording") feel({ type: "record_cancel" });
    recorder.close();
  }

  function hideBubble() {
    conversation.close();
    stopListening();
    setBubble(null);
    setPraise(null);
    setHoldHint(null);
    sayEarned();
  }

  /**
   * Closed from inside the bubble (its "×", Done, Escape): the focus, which
   * was in the bubble now gone, goes back to the cat.
   */
  const catButton = useRef<HTMLButtonElement>(null);
  function dismissBubble() {
    hideBubble();
    catButton.current?.focus();
  }
  const dismissLatest = useRef(dismissBubble);
  dismissLatest.current = dismissBubble;

  function typeInstead() {
    stopListening();
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
    if (kiosk && !actingName) {
      // This tap is the gesture iOS needs to start audio: warm the level
      // meter now, as the next step (tapping an avatar) reloads the page.
      if (showMic) recorder.warm();
      setBubble("who");
    } else if (showMic) talk();
    else setOpen(true);
  }

  // The finger holding the button (null for a hold started by the
  // keyboard): only its lift sends, so a second finger tapping elsewhere
  // and lifting never ends the hold. A cancel, of any pointer, still does.
  const holdPointer = useRef<number | null>(null);
  const isHoldPointer = (id: number) =>
    holdPointer.current === null || id === holdPointer.current;

  // The hold itself: a pointer held on the button, or Enter/Space to toggle.
  function holdDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    holdPointer.current = e.pointerId;
    dropClip.current = false;
    setHoldHint(null);
    // Closed after an error, or by a transcriber that went away: reopen.
    if (recorder.state === "idle") recorder.open();
    recorder.begin();
  }

  function holdUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.type === "pointerup" && !isHoldPointer(e.pointerId)) return;
    recorder.finish();
  }

  // The button keeps its element across the bubble's modes (its keyed
  // slot below), but whichever element the finger lifts from, letting go
  // sends: a release outside the button must never leave it recording.
  const held = recorder.state === "recording" || recorder.state === "starting";
  const finishLatest = useRef(recorder.finish);
  finishLatest.current = recorder.finish;
  const isHoldPointerLatest = useRef(isHoldPointer);
  isHoldPointerLatest.current = isHoldPointer;
  useEffect(() => {
    if (!held) return;
    const up = (e: PointerEvent) => {
      if (e.type === "pointerup" && !isHoldPointerLatest.current(e.pointerId))
        return;
      finishLatest.current();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [held]);

  function holdKey(e: React.MouseEvent<HTMLButtonElement>) {
    if (e.detail !== 0) return;
    if (recorder.state === "recording") {
      recorder.finish();
    } else {
      holdPointer.current = null;
      dropClip.current = false;
      if (recorder.state === "idle") recorder.open();
      recorder.begin();
    }
  }

  async function catConfirmAll(pin?: string) {
    await confirmAll(pin);
    // Everything is done and scored: the cat says so, and stays to listen.
    if (!conversation.getState().rows.some(isOpen)) {
      const earned = conversation.takeEarned();
      if (earned > 0) {
        setPraise(
          `Purrfect. +${earned}${actingName ? ` for ${actingName}` : ""} ✦`,
        );
      }
    }
  }

  function catCancel() {
    // Nothing is done; Baumy listens again.
    talk();
  }

  function sheetCancel() {
    conversation.cancelAll();
    close();
  }

  // A bubble left open closes after a minute untouched; not while a finger
  // holds the button or Baumy is still listening back, thinking or saving
  // (the minute starts again when that ends). The kiosk's idle reset and
  // screensaver wait for the same: it holds the screen (lib/kiosk/screen.ts).
  const catBusy = cat && bubble !== null && (held || busy || bulk);
  useIdle(cat && bubble !== null && !catBusy, KIOSK_IDLE_MS, hideBubble);
  useEffect(() => {
    holdScreen(BUSY_ID, catBusy);
  }, [catBusy]);
  useEffect(() => () => holdScreen(BUSY_ID, false), []);
  // A reminder or the screensaver taking the screen closes it at once, and
  // drops any recording: nothing listens under them.
  const hideLatest = useRef(hideBubble);
  hideLatest.current = hideBubble;
  const bubbleOpen = cat && bubble !== null;
  useEffect(() => {
    if (!bubbleOpen) return;
    return onScreenTaken(window, () => hideLatest.current());
  }, [bubbleOpen]);
  // A tap or click anywhere else closes it, like Done: the microphone off,
  // nothing sent (issue #155). The cat and its bubble are not "anywhere
  // else" (the cat's own tap toggles it), and a finger holding "Hold to
  // talk" is never interrupted by another touch.
  const catRef = useRef<HTMLDivElement>(null);
  const heldRef = useRef(held);
  heldRef.current = held;
  useEffect(() => {
    if (!bubbleOpen) return;
    const onDown = (e: PointerEvent) => {
      if (heldRef.current) return;
      const target = e.target;
      if (target instanceof Node && catRef.current?.contains(target)) return;
      hideLatest.current();
    };
    // Escape closes it too, and gives the focus back to the cat.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || heldRef.current) return;
      dismissLatest.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [bubbleOpen]);

  const pinLabel = actingName ? `${actingName}'s PIN` : "Your PIN";

  const recording = recorder.state === "recording";
  // Talking again is offered once nothing is waiting on Confirm all or
  // Cancel: a new answer would replace cards nobody had decided on.
  const cardsSettled =
    rows.length === 0 ||
    (confirmAllTargets(rows).length === 0 &&
      rows.some((r) => r.state === "saved"));

  const showHold =
    showMic && (bubble === "talk" || (bubble === "answer" && cardsSettled));
  const showDone =
    bubble === "answer" && (Boolean(reply?.error) || rows.length === 0);

  // One button, always in the same place in the bubble (its own keyed
  // slot), so a hold that starts on an answer keeps the element under the
  // finger: iOS sends the rest of a touch to the element it started on.
  const holdButton = (
    <div key="hold" className="mt-4 flex flex-col gap-2">
      <HoldToTalk
        state={
          recording
            ? "recording"
            : recorder.state === "opening" || recorder.state === "starting"
              ? "opening"
              : "idle"
        }
        level={recorder.level}
        onPointerDown={holdDown}
        onPointerUp={holdUp}
        onPointerCancel={holdUp}
        onClick={holdKey}
        onContextMenu={(e) => e.preventDefault()}
      />
      {holdHint ? (
        <p role="status" className="font-body text-[20px] text-bm-red">
          {holdHint}
        </p>
      ) : null}
    </div>
  );

  const answer = reply?.error ? (
    <CatText tone="error">{reply.text}</CatText>
  ) : rows.length > 0 ? (
    <>
      {praise ? (
        <p role="status" className="font-display text-[16px]">
          {praise}
        </p>
      ) : (
        <CatSays size="sm">Got it! I&apos;ll do this:</CatSays>
      )}
      <SuggestionCards
        rows={rows}
        kiosk={kiosk}
        bubble
        pinLabel={pinLabel}
        hasPin={hasPin}
        actingName={acting.name ?? actingName}
        busy={bulk}
        onConfirmAll={(pin) => void catConfirmAll(pin)}
        onCancel={catCancel}
        onDone={dismissBubble}
        onDrop={(row) => conversation.drop(row)}
      />
    </>
  ) : (
    <CatText>{reply?.text ?? ""}</CatText>
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
      <CatBubble
        mode={bubble === "talk" && recording ? "listening" : bubble}
        onClose={dismissBubble}
      >
        <div key="body">
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
          ) : bubble === "talk" ? (
            <>
              <CatSays>
                {recording
                  ? "Mrrp? I’m listening…"
                  : actingName
                    ? `Mrrp? Hi ${actingName}.`
                    : "Mrrp?"}
              </CatSays>
              <CatText tone="muted">
                {recording
                  ? "Let go when you’re done."
                  : `Hold the button and talk. ${VOICE_NOTE_HINT}`}
              </CatText>
            </>
          ) : bubble === "thinking" ? (
            <CatSays>
              {transcribing
                ? "Listening back\u2026"
                : "Hmm, let me think\u2026"}
            </CatSays>
          ) : (
            answer
          )}
        </div>
        {showHold ? holdButton : null}
        {showDone ? (
          <div key="done" className="mt-3 flex gap-3">
            <CatButton variant="soft" onClick={dismissBubble}>
              Done
            </CatButton>
          </div>
        ) : null}
        <CatLink key="type" onClick={typeInstead}>
          Type instead
        </CatLink>
      </CatBubble>
    );

  return (
    <>
      {cat ? (
        <div ref={catRef} className="relative" data-voice-cat>
          {catBubble}
          <button
            ref={catButton}
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
        <BaumyButton
          state={mood}
          onClick={wake}
          className={docked ? "max-[89rem]:hidden" : undefined}
        />
      )}
      {/* Its ×, Escape and a tap outside are its Cancel: any card still
          open is dropped, so the next person never confirms it (#174). */}
      <Dialog open={open} onClose={sheetCancel} busy={bulk} title="Ask Baumy">
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
              onClip={(clip, mime) => void conversation.hear(clip, mime)}
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
              hasPin={hasPin}
              actingName={acting.name ?? actingName}
              busy={bulk}
              onConfirmAll={(pin) => void confirmAll(pin)}
              onCancel={sheetCancel}
              onDone={close}
              onDrop={(row) => conversation.drop(row)}
              onEdit={(row, input) => conversation.edit(row, input)}
            />
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
