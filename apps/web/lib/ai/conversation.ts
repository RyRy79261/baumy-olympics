// A conversation with Baumy (SPEC §3.6, issue #216): what the Ask Baumy
// sheet and the kitchen cat's bubble (components/baumy/baumy-sheet.tsx)
// both show. Pure and client-safe: a reducer over the conversation's state,
// and a small driver that runs its async steps through an injected port
// (components/baumy/api.ts in the app, a fake in tests).
//
//   ask ─────────────────────────────▶ asking ──answered──▶ reply + cards
//   hear ──▶ transcribing ──transcribed──▶ asking   └─failed──▶ error reply
//                └──failed──▶ error reply (NOT_CONFIGURED: the mic goes off)
//   confirmAll: each valid card in order, the PIN only where it is needed
//
// The stale-answer rule (#174, issue #155): at most one question (or clip)
// is in flight, and every result carries its flight's id. Closing the sheet
// or the bubble (its ×, Cancel, Done, a tap outside, a reminder, the
// screensaver, the idle minute) drops the flight, and a new question
// replaces it, so an answer that comes back late shows nowhere: it never
// brings back the last person's cards, and the next opening starts ready,
// not "thinking". Type instead hands the flight from the bubble to the
// sheet, so its answer shows there.

import type { ActionResult } from "@/lib/actions/result";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import type { HistoryTurn } from "./command";
import type { MoodEvent } from "./mood";
import type { Proposal } from "./proposal";
import {
  canApprove,
  cancelAll,
  confirmAllTargets,
  isOpen,
  nextHistory,
  rowsFor,
  savedMessage,
  stopsPin,
  asksForPin,
  type ReviewRow,
} from "./review";

/** The conversation's requests: /api/ai/command, /api/ai/transcribe, /api/ai/proposal, /api/actions/run. */
export interface ConversationPort {
  ask(
    text: string,
    history: readonly HistoryTurn[],
  ): Promise<ActionResult<{ reply: string; proposals: Proposal[] }>>;
  transcribe(clip: Blob, mime: string): Promise<ActionResult<{ text: string }>>;
  recheck(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ActionResult<Proposal>>;
  run(proposal: Proposal, pin?: string): Promise<ActionResult<unknown>>;
}

export type FlightStep = "transcribing" | "asking";

export interface ConversationState {
  /** The question (or clip) on its way, if any. */
  flight: { id: number; step: FlightStep } | null;
  /** Baumy's last answer, or what failed. */
  reply: { text: string; error: boolean } | null;
  /** What the transcriber heard, for "You said: …". */
  heard: string | null;
  /** The suggestion cards. */
  rows: ReviewRow[];
  /** The turns sent with the next question. */
  history: HistoryTurn[];
  /** Confirm all is running. */
  confirming: boolean;
  /** The gate has just said the acting member has no PIN. */
  pinMissing: boolean;
  /** Why the microphone is off (blocked, or no transcriber): type instead. */
  micOff: string | null;
  /** What approvals scored since it was last said. */
  earned: number;
}

export const initialConversation: ConversationState = {
  flight: null,
  reply: null,
  heard: null,
  rows: [],
  history: [],
  confirming: false,
  pinMissing: false,
  micOff: null,
  earned: 0,
};

export type ConversationEvent =
  /** A typed question was sent. */
  | { type: "ask"; id: number }
  /** A clip was sent to be transcribed. */
  | { type: "transcribe"; id: number }
  /** The clip's words, now asked. */
  | { type: "transcribed"; id: number; text: string }
  | { type: "transcribe_failed"; id: number; code: string; message: string }
  | {
      type: "answered";
      id: number;
      said: string;
      reply: string;
      proposals: readonly Proposal[];
    }
  | { type: "ask_failed"; id: number; message: string }
  /** The sheet or the bubble closed: the flight in progress is dropped. */
  | { type: "close" }
  /** A new hold to talk: the last answer, all of it settled, makes way. */
  | { type: "clear" }
  /** Cancel: every card still open is dropped. */
  | { type: "cancel_all" }
  /** A card's ×. */
  | { type: "drop"; proposalId: string }
  /** An edited card, checked again: it replaces the card if still open. */
  | { type: "edited"; proposalId: string; proposal: Proposal }
  | { type: "edit_failed"; proposalId: string; message: string }
  | { type: "confirm_start" }
  | { type: "confirm_end" }
  | { type: "saving"; proposalId: string }
  | {
      type: "saved";
      proposalId: string;
      message: string;
      points: number | null;
    }
  /** The server asked for the PIN; `none`: the member has never set one. */
  | { type: "needs_pin"; proposalId: string; message: string; none: boolean }
  | { type: "save_failed"; proposalId: string; message: string }
  /** A card that needs a PIN nobody set waits, saying so. */
  | { type: "waits"; proposalId: string; message: string }
  /** The acting member changed: whether they have a PIN is known again. */
  | { type: "pin_known" }
  | { type: "mic_off"; message: string }
  /** The earned points were said. */
  | { type: "earned_said" };

const patchRow = (
  rows: readonly ReviewRow[],
  id: string,
  patch: Partial<ReviewRow>,
): ReviewRow[] =>
  rows.map((r) => (r.proposal.proposalId === id ? { ...r, ...patch } : r));

/** Whether a result belongs to the flight still on screen. */
const current = (s: ConversationState, id: number) => s.flight?.id === id;

export function conversation(
  s: ConversationState,
  e: ConversationEvent,
): ConversationState {
  switch (e.type) {
    case "ask":
      return { ...s, flight: { id: e.id, step: "asking" }, heard: null };
    case "transcribe":
      return { ...s, flight: { id: e.id, step: "transcribing" } };
    case "transcribed":
      if (!current(s, e.id)) return s;
      return { ...s, flight: { id: e.id, step: "asking" }, heard: e.text };
    case "transcribe_failed":
      if (!current(s, e.id)) return s;
      return {
        ...s,
        flight: null,
        reply: { text: e.message, error: true },
        // The transcriber went away (the key was removed): type instead.
        micOff: e.code === "NOT_CONFIGURED" ? e.message : s.micOff,
      };
    case "answered":
      if (!current(s, e.id)) return s;
      return {
        ...s,
        flight: null,
        reply: { text: e.reply, error: false },
        rows: rowsFor(e.proposals),
        history: nextHistory(s.history, e.said, e.reply),
      };
    case "ask_failed":
      if (!current(s, e.id)) return s;
      return { ...s, flight: null, reply: { text: e.message, error: true } };
    case "close":
      return s.flight ? { ...s, flight: null } : s;
    case "clear":
      return { ...s, reply: null, rows: [], heard: null };
    case "cancel_all":
      return { ...s, rows: cancelAll(s.rows) };
    case "drop":
      return {
        ...s,
        rows: patchRow(s.rows, e.proposalId, {
          state: "rejected",
          message: undefined,
        }),
      };
    case "edited":
      // One that saved, or was dropped, while the check ran stays as it is,
      // so nothing is ever saved twice.
      return {
        ...s,
        rows: s.rows.map((r) =>
          r.proposal.proposalId === e.proposalId && isOpen(r)
            ? {
                proposal: e.proposal,
                state: "pending",
                needsPin: e.proposal.needsPin,
              }
            : r,
        ),
      };
    case "edit_failed":
      return {
        ...s,
        rows: s.rows.map((r) =>
          r.proposal.proposalId === e.proposalId && isOpen(r)
            ? { ...r, message: e.message }
            : r,
        ),
      };
    case "confirm_start":
      return { ...s, confirming: true };
    case "confirm_end":
      return { ...s, confirming: false };
    case "saving":
      return {
        ...s,
        rows: patchRow(s.rows, e.proposalId, {
          state: "saving",
          message: undefined,
        }),
      };
    case "saved":
      return {
        ...s,
        rows: patchRow(s.rows, e.proposalId, {
          state: "saved",
          message: e.message,
        }),
        earned:
          e.points !== null && e.points > 0 ? s.earned + e.points : s.earned,
      };
    case "needs_pin":
      return {
        ...s,
        rows: patchRow(s.rows, e.proposalId, {
          state: "pending",
          needsPin: true,
          message: e.message,
        }),
        pinMissing: s.pinMissing || e.none,
      };
    case "save_failed":
      return {
        ...s,
        rows: patchRow(s.rows, e.proposalId, {
          state: "failed",
          message: e.message,
        }),
      };
    case "waits":
      return {
        ...s,
        rows: patchRow(s.rows, e.proposalId, { message: e.message }),
      };
    case "pin_known":
      return s.pinMissing ? { ...s, pinMissing: false } : s;
    case "mic_off":
      return { ...s, micOff: e.message };
    case "earned_said":
      return s.earned === 0 ? s : { ...s, earned: 0 };
  }
}

/** Baumy is thinking about a question. */
export const isAsking = (s: ConversationState) => s.flight?.step === "asking";
/** Baumy is listening back to a clip. */
export const isTranscribing = (s: ConversationState) =>
  s.flight?.step === "transcribing";

/**
 * How an ask (or a clip) ended: answered; failed at a step (shown as an
 * error reply); or dropped, because the sheet or the bubble closed (or a
 * new question replaced it) before it came back.
 */
export type Outcome =
  | { kind: "answered" }
  | { kind: "failed"; step: FlightStep; code: string }
  | { kind: "dropped" };

export interface ConfirmOptions {
  /** The PIN typed for Confirm all, sent with the cards that need it. */
  pin?: string;
  /** The kitchen screen, where a card may ask for the PIN. */
  kiosk: boolean;
  /** Whether the acting member has a personal PIN (the kiosk shell's). */
  hasPin: boolean;
  /** "<Name> hasn't set a personal PIN yet." */
  noPinMessage: string;
}

export interface ConversationDeps {
  port: ConversationPort;
  /** Baumy's sprite (lib/ai/mood.ts). */
  feel(e: MoodEvent): void;
  /** A card saved; `points` it scored, if any. */
  onSaved(points: number | null): void;
}

export type Conversation = ReturnType<typeof createConversation>;

/** The conversation's store and its async steps. */
export function createConversation(deps: ConversationDeps) {
  let state = initialConversation;
  let lastId = 0;
  const listeners = new Set<() => void>();
  const get = () => state;
  const dispatch = (e: ConversationEvent) => {
    const next = conversation(state, e);
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  };

  async function askFor(id: number, said: string): Promise<Outcome> {
    deps.feel({ type: "ask" });
    const result = await deps.port.ask(said, state.history);
    if (!current(state, id)) return { kind: "dropped" };
    if (!result.ok) {
      dispatch({ type: "ask_failed", id, message: result.message });
      deps.feel({ type: "error" });
      return { kind: "failed", step: "asking", code: result.code };
    }
    dispatch({
      type: "answered",
      id,
      said,
      reply: result.data.reply,
      proposals: result.data.proposals,
    });
    deps.feel({ type: "reply" });
    return { kind: "answered" };
  }

  /** Approve one row: null when it saved, else the failure's code. */
  async function approve(
    row: ReviewRow,
    pin: string | undefined,
    opts: ConfirmOptions,
  ): Promise<string | null> {
    const proposalId = row.proposal.proposalId;
    dispatch({ type: "saving", proposalId });
    const result = await deps.port.run(row.proposal, pin);
    if (result.ok) {
      const pts = (result.data as { totalPts?: unknown } | null)?.totalPts;
      const points = typeof pts === "number" ? pts : null;
      dispatch({
        type: "saved",
        proposalId,
        message: savedMessage(result.data),
        points,
      });
      deps.feel({ type: "points", points });
      deps.onSaved(points);
      return null;
    }
    if (opts.kiosk && asksForPin(result, PIN_PROMPT_CODES)) {
      const none = result.code === "PIN_NOT_SET";
      dispatch({
        type: "needs_pin",
        proposalId,
        none,
        message: none ? opts.noPinMessage : result.message,
      });
      return result.code;
    }
    dispatch({ type: "save_failed", proposalId, message: result.message });
    deps.feel({ type: "error" });
    return result.code;
  }

  return {
    getState: get,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,

    /** Send what was typed. */
    ask(said: string): Promise<Outcome> {
      const id = ++lastId;
      dispatch({ type: "ask", id });
      return askFor(id, said);
    },

    /** Transcribe a held-to-speak clip, then ask with its words. */
    async hear(clip: Blob, mime: string): Promise<Outcome> {
      const id = ++lastId;
      deps.feel({ type: "record_stop" });
      dispatch({ type: "transcribe", id });
      const result = await deps.port.transcribe(clip, mime);
      if (!current(state, id)) return { kind: "dropped" };
      if (!result.ok) {
        dispatch({
          type: "transcribe_failed",
          id,
          code: result.code,
          message: result.message,
        });
        deps.feel({ type: "error" });
        return { kind: "failed", step: "transcribing", code: result.code };
      }
      dispatch({ type: "transcribed", id, text: result.data.text });
      return askFor(id, result.data.text);
    },

    /** The sheet or the bubble closed: an answer still on its way is dropped. */
    close() {
      dispatch({ type: "close" });
    },

    /** What approvals scored since last said; said now, so it resets. */
    takeEarned(): number {
      const n = state.earned;
      dispatch({ type: "earned_said" });
      return n;
    },

    /**
     * Check an edited card again. The new proposal replaces the card only if
     * it is still waiting (or failed).
     */
    async edit(row: ReviewRow, input: Record<string, unknown>) {
      const proposalId = row.proposal.proposalId;
      const result = await deps.port.recheck(row.proposal.name, input);
      if (!result.ok) {
        dispatch({ type: "edit_failed", proposalId, message: result.message });
        return;
      }
      dispatch({ type: "edited", proposalId, proposal: result.data });
    },

    /**
     * Run every valid card, in order; the PIN goes with those that need it.
     * Once the PIN is refused (wrong, resting or locked) it is sent no more:
     * each try counts against the member's PIN, so the rest stay waiting for
     * the PIN typed again rather than burning the attempts.
     */
    async confirmAll(opts: ConfirmOptions) {
      dispatch({ type: "confirm_start" });
      const { pin } = opts;
      let pinLeft = pin;
      try {
        // One at a time, so the cards that saved stay saved if one fails.
        for (const target of confirmAllTargets(state.rows)) {
          // Read it again: it may have changed since the list was taken.
          const row = state.rows.find(
            (r) => r.proposal.proposalId === target.proposal.proposalId,
          );
          if (!row || !canApprove(row)) continue;
          // Nobody can type a PIN that was never set: the card waits.
          const hasPin = opts.hasPin && !state.pinMissing;
          if (opts.kiosk && row.needsPin && !hasPin) {
            dispatch({
              type: "waits",
              proposalId: row.proposal.proposalId,
              message: opts.noPinMessage,
            });
            continue;
          }
          if (row.needsPin && pin !== undefined && pinLeft === undefined) {
            continue;
          }
          const sent = row.needsPin ? pinLeft : undefined;
          const code = await approve(row, sent, opts);
          if (sent !== undefined && code !== null && stopsPin(code)) {
            pinLeft = undefined;
          }
        }
      } finally {
        dispatch({ type: "confirm_end" });
      }
    },
  };
}
