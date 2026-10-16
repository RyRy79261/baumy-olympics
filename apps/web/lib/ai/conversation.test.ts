// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import {
  conversation,
  createConversation,
  initialConversation,
  isAsking,
  isTranscribing,
  type ConversationEvent,
  type ConversationPort,
  type ConversationState,
} from "./conversation";
import type { MoodEvent } from "./mood";
import type { Proposal } from "./proposal";

// The conversation the sheet and the cat's bubble show (issue #216): its
// transitions, plain, with no DOM and no recorder, and its driver over a
// fake port.

let n = 0;
function proposal(over: Partial<Proposal> = {}): Proposal {
  n += 1;
  return {
    proposalId: `p-${n}`,
    name: "log_completion",
    title: "Log a chore",
    input: {},
    preview: "Log Trash",
    risk: "confirm",
    valid: true,
    needsPin: false,
    fields: [],
    ...over,
  };
}

const run = (s: ConversationState, ...events: ConversationEvent[]) =>
  events.reduce(conversation, s);

const answered = (id: number, proposals: Proposal[] = []) =>
  ({
    type: "answered",
    id,
    said: "I took the trash out",
    reply: "Nice one.",
    proposals,
  }) as const;

describe("the stale-answer rule", () => {
  it("drops an answer that lands after the sheet closed mid-question (#174)", () => {
    const asked = run(initialConversation, { type: "ask", id: 1 });
    expect(isAsking(asked)).toBe(true);
    const closed = run(asked, { type: "close" });
    const late = run(closed, answered(1, [proposal()]));
    expect(late).toBe(closed);
    expect(late.rows).toEqual([]);
    expect(late.reply).toBeNull();
    expect(late.history).toEqual([]);
  });

  it("opens ready again, not thinking, after closing mid-question", () => {
    const s = run(
      initialConversation,
      { type: "ask", id: 1 },
      { type: "close" },
    );
    expect(isAsking(s)).toBe(false);
    expect(isTranscribing(s)).toBe(false);
  });

  it("lets a new question supersede the old one", () => {
    const p = proposal();
    const s = run(
      initialConversation,
      { type: "ask", id: 1 },
      { type: "close" },
      { type: "ask", id: 2 },
      { type: "ask_failed", id: 1, message: "old" },
      answered(1, [proposal()]),
    );
    // The old question's results change nothing: the new one still thinks.
    expect(isAsking(s)).toBe(true);
    expect(s.reply).toBeNull();
    const done = run(s, answered(2, [p]));
    expect(isAsking(done)).toBe(false);
    expect(done.reply).toEqual({ text: "Nice one.", error: false });
    expect(done.rows.map((r) => r.proposal.proposalId)).toEqual([p.proposalId]);
    expect(done.history).toEqual([
      { role: "user", text: "I took the trash out" },
      { role: "assistant", text: "Nice one." },
    ]);
  });

  it("drops a clip whose bubble closed while it was transcribed", () => {
    const listening = run(initialConversation, { type: "transcribe", id: 1 });
    expect(isTranscribing(listening)).toBe(true);
    const closed = run(listening, { type: "close" });
    expect(isTranscribing(closed)).toBe(false);
    expect(
      run(
        closed,
        { type: "transcribed", id: 1, text: "hi" },
        {
          type: "transcribe_failed",
          id: 1,
          code: "NOT_CONFIGURED",
          message: "gone",
        },
      ),
    ).toBe(closed);
  });

  it("asks with the clip's words, keeping what was heard", () => {
    const s = run(
      initialConversation,
      { type: "transcribe", id: 1 },
      { type: "transcribed", id: 1, text: "Who's winning?" },
    );
    expect(isAsking(s)).toBe(true);
    expect(s.heard).toBe("Who's winning?");
    // A typed question forgets it.
    expect(run(s, { type: "ask", id: 2 }).heard).toBeNull();
  });

  it("turns the microphone off when the transcriber went away, only then", () => {
    const failed = (code: string) =>
      run(
        initialConversation,
        { type: "transcribe", id: 1 },
        { type: "transcribe_failed", id: 1, code, message: "No voice." },
      );
    expect(failed("NOT_CONFIGURED").micOff).toBe("No voice.");
    expect(failed("UNAVAILABLE").micOff).toBeNull();
    expect(failed("UNAVAILABLE").reply).toEqual({
      text: "No voice.",
      error: true,
    });
  });
});

describe("the cards", () => {
  const two = () => {
    const a = proposal();
    const b = proposal();
    return {
      a,
      b,
      s: run(initialConversation, { type: "ask", id: 1 }, answered(1, [a, b])),
    };
  };

  it("drops one, cancels the rest, and clears for a new hold", () => {
    const { a, b, s } = two();
    const dropped = run(s, { type: "drop", proposalId: a.proposalId });
    expect(dropped.rows.map((r) => r.state)).toEqual(["rejected", "pending"]);
    const saved = run(dropped, {
      type: "saved",
      proposalId: b.proposalId,
      message: "Saved.",
      points: null,
    });
    expect(run(saved, { type: "cancel_all" }).rows[1]!.state).toBe("saved");
    expect(run(s, { type: "cancel_all" }).rows.map((r) => r.state)).toEqual([
      "rejected",
      "rejected",
    ]);
    const cleared = run(s, { type: "clear" });
    expect(cleared.rows).toEqual([]);
    expect(cleared.reply).toBeNull();
  });

  it("replaces an edited card only while it is still open", () => {
    const { a, b, s } = two();
    const next = proposal({ preview: "Log Bins" });
    const edited = run(s, {
      type: "edited",
      proposalId: a.proposalId,
      proposal: next,
    });
    expect(edited.rows[0]!.proposal).toBe(next);
    const gone = run(
      s,
      { type: "drop", proposalId: b.proposalId },
      { type: "edited", proposalId: b.proposalId, proposal: next },
      { type: "edit_failed", proposalId: b.proposalId, message: "Nope" },
    );
    expect(gone.rows[1]!.proposal).toBe(b);
    expect(gone.rows[1]!.message).toBeUndefined();
    expect(
      run(s, { type: "edit_failed", proposalId: a.proposalId, message: "No" })
        .rows[0]!.message,
    ).toBe("No");
  });

  it("adds what saves scored, until it is said", () => {
    const { a, b, s } = two();
    const scored = run(
      s,
      { type: "saved", proposalId: a.proposalId, message: "", points: 5 },
      { type: "saved", proposalId: b.proposalId, message: "", points: 0 },
    );
    expect(scored.earned).toBe(5);
    expect(run(scored, { type: "earned_said" }).earned).toBe(0);
  });

  it("remembers the gate saying there is no PIN until the member changes", () => {
    const { a, s } = two();
    const waiting = run(s, {
      type: "needs_pin",
      proposalId: a.proposalId,
      message: "Ryan hasn't set a personal PIN yet.",
      none: true,
    });
    expect(waiting.pinMissing).toBe(true);
    expect(waiting.rows[0]).toMatchObject({ state: "pending", needsPin: true });
    expect(run(waiting, { type: "pin_known" }).pinMissing).toBe(false);
  });
});

/** A promise to settle by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (code: string, message = code) =>
  ({ ok: false, code, message }) as ActionResult<never>;

function driver(port: Partial<ConversationPort> = {}) {
  const feel = vi.fn<(e: MoodEvent) => void>();
  const onSaved = vi.fn<(points: number | null) => void>();
  // Every request is a spy, the given ones included.
  const full: ConversationPort = {
    ask: vi.fn(port.ask ?? (async () => ok({ reply: "Sure.", proposals: [] }))),
    transcribe: vi.fn(port.transcribe ?? (async () => ok({ text: "hi" }))),
    recheck: vi.fn(port.recheck ?? (async () => fail("UNAVAILABLE"))),
    run: vi.fn(port.run ?? (async () => ok({}))),
  };
  const c = createConversation({ port: full, feel, onSaved });
  const moods = () => feel.mock.calls.map(([e]) => e.type);
  return { c, port: full, feel, onSaved, moods };
}

/** A conversation showing these cards. */
async function showing(
  proposals: Proposal[],
  port: Partial<ConversationPort> = {},
) {
  const d = driver({
    ask: async () => ok({ reply: "Got it.", proposals }),
    ...port,
  });
  await d.c.ask("I did things");
  return d;
}

const PIN_OPTS = {
  kiosk: true,
  hasPin: true,
  noPinMessage: "Ryan hasn't set a personal PIN yet.",
};

describe("the driver", () => {
  it("asks, answers and moves the sprite along", async () => {
    const { c, port, moods } = driver();
    const listener = vi.fn();
    c.subscribe(listener);
    expect(await c.ask("Who's winning?")).toEqual({ kind: "answered" });
    expect(port.ask).toHaveBeenCalledWith("Who's winning?", []);
    expect(c.getState().reply).toEqual({ text: "Sure.", error: false });
    expect(moods()).toEqual(["ask", "reply"]);
    expect(listener).toHaveBeenCalled();
  });

  it("sends the history with the next question", async () => {
    const { c, port } = driver();
    await c.ask("one");
    await c.ask("two");
    expect(port.ask).toHaveBeenLastCalledWith("two", [
      { role: "user", text: "one" },
      { role: "assistant", text: "Sure." },
    ]);
  });

  it("drops an answer that lands after a close, and starts ready", async () => {
    const answer =
      deferred<ActionResult<{ reply: string; proposals: Proposal[] }>>();
    const { c, moods } = driver({ ask: () => answer.promise });
    const pending = c.ask("I took the trash out");
    expect(isAsking(c.getState())).toBe(true);
    c.close();
    expect(isAsking(c.getState())).toBe(false);
    answer.resolve(ok({ reply: "Logged.", proposals: [proposal()] }));
    expect(await pending).toEqual({ kind: "dropped" });
    expect(c.getState().rows).toEqual([]);
    expect(c.getState().reply).toBeNull();
    expect(moods()).toEqual(["ask"]);
  });

  it("asks nothing for a clip whose bubble closed while it was transcribed", async () => {
    const words = deferred<ActionResult<{ text: string }>>();
    const { c, port } = driver({ transcribe: () => words.promise });
    const pending = c.hear(new Blob(["clip"]), "audio/webm");
    expect(isTranscribing(c.getState())).toBe(true);
    c.close();
    words.resolve(ok({ text: "I bought cat food" }));
    expect(await pending).toEqual({ kind: "dropped" });
    expect(port.ask).not.toHaveBeenCalled();
    expect(c.getState().heard).toBeNull();
  });

  it("asks with what it heard", async () => {
    const { c, port, moods } = driver();
    expect(await c.hear(new Blob(["clip"]), "audio/webm")).toEqual({
      kind: "answered",
    });
    expect(port.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio/webm",
    );
    expect(port.ask).toHaveBeenCalledWith("hi", []);
    expect(c.getState().heard).toBe("hi");
    expect(moods()).toEqual(["record_stop", "ask", "reply"]);
  });

  it("says which step failed", async () => {
    const deaf = driver({
      transcribe: async () => fail("NOT_CONFIGURED", "No voice here."),
    });
    expect(await deaf.c.hear(new Blob([]), "audio/webm")).toEqual({
      kind: "failed",
      step: "transcribing",
      code: "NOT_CONFIGURED",
    });
    expect(deaf.c.getState().micOff).toBe("No voice here.");
    expect(deaf.moods()).toEqual(["record_stop", "error"]);

    const down = driver({ ask: async () => fail("UNAVAILABLE", "Offline.") });
    expect(await down.c.ask("hi")).toEqual({
      kind: "failed",
      step: "asking",
      code: "UNAVAILABLE",
    });
    expect(down.c.getState().reply).toEqual({ text: "Offline.", error: true });
    expect(down.moods()).toEqual(["ask", "error"]);
  });

  it("confirms every valid card in order, the PIN only where needed", async () => {
    const note = proposal({ name: "create_note" });
    const invalid = proposal({ valid: false });
    const dispute = proposal({ name: "dispute_completion", needsPin: true });
    const { c, port, onSaved, moods } = await showing(
      [note, invalid, dispute],
      {
        run: async () => ok({ totalPts: 3 }),
      },
    );
    const done = c.confirmAll({ ...PIN_OPTS, pin: "1234" });
    expect(c.getState().confirming).toBe(true);
    await done;
    expect(c.getState().confirming).toBe(false);
    expect(vi.mocked(port.run).mock.calls).toEqual([
      [note, undefined],
      [dispute, "1234"],
    ]);
    expect(c.getState().rows.map((r) => r.state)).toEqual([
      "saved",
      "pending",
      "saved",
    ]);
    expect(c.getState().rows[0]!.message).toBe("Saved: +3 points.");
    expect(onSaved).toHaveBeenCalledWith(3);
    expect(moods().filter((m) => m === "points")).toHaveLength(2);
    expect(c.takeEarned()).toBe(6);
    expect(c.takeEarned()).toBe(0);
  });

  it("keeps going past a card that fails, and is sad about it", async () => {
    const a = proposal();
    const b = proposal();
    const { c, port, moods } = await showing([a, b], {
      run: async (p) =>
        p === a ? fail("CONFLICT", "Already logged.") : ok({}),
    });
    await c.confirmAll({ ...PIN_OPTS, kiosk: false });
    expect(port.run).toHaveBeenCalledTimes(2);
    expect(c.getState().rows[0]).toMatchObject({
      state: "failed",
      message: "Already logged.",
    });
    expect(c.getState().rows[1]!.state).toBe("saved");
    expect(moods()).toContain("error");
    expect(c.getState().confirming).toBe(false);
  });

  it("leaves a PIN card waiting for a member with no PIN, saving the rest", async () => {
    const note = proposal();
    const dispute = proposal({ needsPin: true });
    const { c, port } = await showing([dispute, note]);
    await c.confirmAll({ ...PIN_OPTS, hasPin: false });
    expect(vi.mocked(port.run).mock.calls).toEqual([[note, undefined]]);
    expect(c.getState().rows[0]).toMatchObject({
      state: "pending",
      message: PIN_OPTS.noPinMessage,
    });
  });

  it("stops at the gate's PIN_NOT_SET, and sends no PIN card after it", async () => {
    const first = proposal({ needsPin: true });
    const second = proposal({ needsPin: true });
    const { c, port } = await showing([first, second], {
      run: async () => fail("PIN_NOT_SET", "No PIN."),
    });
    await c.confirmAll(PIN_OPTS);
    expect(vi.mocked(port.run).mock.calls).toEqual([[first, undefined]]);
    expect(c.getState().pinMissing).toBe(true);
    expect(c.getState().rows.map((r) => r.message)).toEqual([
      PIN_OPTS.noPinMessage,
      PIN_OPTS.noPinMessage,
    ]);
  });

  it("sends a wrong PIN once, never to every card that needs it", async () => {
    const first = proposal({ needsPin: true });
    const second = proposal({ needsPin: true });
    const note = proposal();
    const { c, port } = await showing([first, second, note], {
      run: async (p, pin) =>
        pin ? fail("ATTESTATION_FAILED", "Wrong PIN.") : ok({}),
    });
    await c.confirmAll({ ...PIN_OPTS, pin: "0000" });
    expect(vi.mocked(port.run).mock.calls).toEqual([
      [first, "0000"],
      [note, undefined],
    ]);
    expect(c.getState().rows[0]).toMatchObject({
      state: "pending",
      needsPin: true,
      message: "Wrong PIN.",
    });
    expect(c.getState().rows[2]!.state).toBe("saved");
  });

  it("asks no PIN off the kiosk: a PIN code is a plain failure there", async () => {
    const a = proposal();
    const { c } = await showing([a], {
      run: async () => fail("ATTESTATION_REQUIRED", "PIN needed."),
    });
    await c.confirmAll({ ...PIN_OPTS, kiosk: false });
    expect(c.getState().rows[0]!.state).toBe("failed");
  });

  it("checks an edited card again, and says why when it cannot", async () => {
    const a = proposal();
    const next = proposal({ preview: "Log Bins" });
    const { c, port } = await showing([a], {
      recheck: async () => ok(next),
    });
    await c.edit(c.getState().rows[0]!, { choreId: "c-2" });
    expect(port.recheck).toHaveBeenCalledWith("log_completion", {
      choreId: "c-2",
    });
    expect(c.getState().rows[0]!.proposal).toBe(next);

    const bad = await showing([proposal()]);
    await bad.c.edit(bad.c.getState().rows[0]!, {});
    expect(bad.c.getState().rows[0]!.message).toBe("UNAVAILABLE");
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const { c } = driver();
    const listener = vi.fn();
    c.subscribe(listener)();
    await c.ask("hi");
    expect(listener).not.toHaveBeenCalled();
    expect(c.getState().reply).toEqual({ text: "Sure.", error: false });
  });
});
