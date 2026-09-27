"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  BaumyButton,
  Button,
  Dialog,
  Input,
  ScorePop,
  SpeechBubble,
} from "@baumy/ui";
import type { HistoryTurn } from "@/lib/ai/command";
import type { Proposal } from "@/lib/ai/proposal";
import {
  approveAllSkips,
  approveAllTargets,
  asksForPin,
  nextHistory,
  rowsFor,
  savedMessage,
  type ReviewRow,
} from "@/lib/ai/review";
import { canRecord } from "@/lib/ai/voice";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import { askBaumy, recheckProposal, runProposal, transcribeClip } from "./api";
import { ProposalRow } from "./proposal-row";
import { useBaumyMood } from "./use-mood";
import { VoiceRecorder } from "./voice-recorder";

// The Baumy sheet (SPEC §3.6), after intake-tracker's
// `components/voice/voice-panel.tsx`: type to Baumy, read the answer in its
// speech bubble, and review what it proposes. Nothing is written until a row
// is approved; each approved row runs through POST /api/actions/run with its
// proposal id as the idempotency key, so a partial "Approve all" keeps what
// saved and a retry never saves a row twice. After a save the page re-reads
// itself, so the scoreboard and the widgets show it.
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

/** How long the "+N" stays after a save that scored. */
const POP_MS = 1_600;

const noSubscribe = () => () => {};

export function BaumySheet({
  kiosk = false,
  actingName,
  voice = false,
}: {
  kiosk?: boolean;
  /** The kiosk's acting member, for "Ryan's PIN". */
  actingName?: string;
  /** This deployment can transcribe speech (GROQ_API_KEY, or the e2e fake). */
  voice?: boolean;
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

  /** Send what was typed or said; true when Baumy answered. */
  async function send(said: string): Promise<boolean> {
    setAsking(true);
    feel({ type: "ask" });
    const result = await askBaumy(said, history, surface);
    setAsking(false);
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

  async function approveAll() {
    setBulk(true);
    try {
      // One at a time, so the rows that saved stay saved if one fails.
      for (const row of approveAllTargets(rowsRef.current, kiosk)) {
        await approve(row);
      }
    } finally {
      setBulk(false);
    }
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

  function close() {
    // A recording in progress is dropped when the recorder unmounts.
    feel({ type: "record_cancel" });
    setMicHint(null);
    setOpen(false);
  }

  const targets = approveAllTargets(rows, kiosk);
  const skips = approveAllSkips(rows, kiosk);

  return (
    <>
      <BaumyButton
        state={mood}
        onClick={() => {
          feel({ type: "wake" });
          setOpen(true);
        }}
      />
      <Dialog open={open} onClose={close} title="Ask Baumy">
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
          {pop ? <ScorePop key={pop.key} points={pop.points} /> : null}
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
            <p className="text-sm text-neutral-700" data-testid="baumy-heard">
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
            <p role="status" className="text-sm text-neutral-700">
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
            <section
              aria-label="Baumy's proposals"
              className="flex flex-col gap-3"
            >
              <ul className="flex flex-col gap-3">
                {rows.map((row) => (
                  <ProposalRow
                    key={row.proposal.proposalId}
                    row={row}
                    kiosk={kiosk}
                    pinLabel={actingName ? `${actingName}'s PIN` : "Your PIN"}
                    onApprove={(pin) => void approve(row, pin)}
                    onReject={() =>
                      update(row.proposal.proposalId, {
                        state: "rejected",
                        message: undefined,
                      })
                    }
                    onEdit={(input) => edit(row, input)}
                  />
                ))}
              </ul>
              {rows.length > 1 && targets.length > 0 ? (
                <Button
                  size={size}
                  disabled={bulk}
                  onClick={() => void approveAll()}
                >
                  {bulk ? "Saving…" : `Approve all (${targets.length})`}
                </Button>
              ) : null}
              {skips ? (
                <p className="text-sm text-neutral-700">{skips}</p>
              ) : null}
            </section>
          ) : null}

          <Button variant="secondary" size={size} onClick={close}>
            Close
          </Button>
        </div>
      </Dialog>
    </>
  );
}
