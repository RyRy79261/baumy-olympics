"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  BaumyButton,
  Button,
  Dialog,
  Input,
  SpeechBubble,
  type SpriteState,
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
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import { askBaumy, recheckProposal, runProposal } from "./api";
import { ProposalRow } from "./proposal-row";

// The Baumy sheet (SPEC §3.6), after intake-tracker's
// `components/voice/voice-panel.tsx`: type to Baumy, read the answer in its
// speech bubble, and review what it proposes. Nothing is written until a row
// is approved; each approved row runs through POST /api/actions/run with its
// proposal id as the idempotency key, so a partial "Approve all" keeps what
// saved and a retry never saves a row twice. After a save the page re-reads
// itself, so the scoreboard and the widgets show it.
//
// Typing only: holding to speak (Groq Whisper) is issue #22.

export function BaumySheet({
  kiosk = false,
  actingName,
}: {
  kiosk?: boolean;
  /** The kiosk's acting member, for "Ryan's PIN". */
  actingName?: string;
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
  const [mood, setMood] = useState<SpriteState>("idle");
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

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const said = text.trim();
    if (!said || asking) return;
    setAsking(true);
    setMood("think");
    const result = await askBaumy(said, history, surface);
    setAsking(false);
    if (!result.ok) {
      setReply({ text: result.message, error: true });
      setMood("sad");
      return;
    }
    setText("");
    setReply({ text: result.data.reply, error: false });
    setMood(result.data.proposals.length > 0 ? "listen" : "idle");
    setRows(rowsFor(result.data.proposals));
    setHistory((h) => nextHistory(h, said, result.data.reply));
  }

  /** Approve one row; true when it saved. */
  async function approve(row: ReviewRow, pin?: string): Promise<boolean> {
    const id = row.proposal.proposalId;
    update(id, { state: "saving", message: undefined });
    const result = await runProposal(row.proposal, surface, pin);
    if (result.ok) {
      update(id, { state: "saved", message: savedMessage(result.data) });
      setMood("happy");
      router.refresh();
      return true;
    }
    if (kiosk && asksForPin(result, PIN_PROMPT_CODES)) {
      update(id, { state: "pending", needsPin: true, message: result.message });
      return false;
    }
    update(id, { state: "failed", message: result.message });
    setMood("sad");
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

  const targets = approveAllTargets(rows, kiosk);
  const skips = approveAllSkips(rows, kiosk);

  return (
    <>
      <BaumyButton
        state={open ? (asking ? "think" : "listen") : "idle"}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="Ask Baumy">
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
          <SpeechBubble
            state={asking ? "think" : mood}
            tone={reply?.error ? "error" : "normal"}
          >
            {asking
              ? "Hmm, let me think…"
              : (reply?.text ??
                'Tell me what you did ("I took the trash out") or ask me something ("Who\'s winning?").')}
          </SpeechBubble>

          <form onSubmit={ask} className="flex gap-2" aria-label="Ask Baumy">
            <label htmlFor="baumy-text" className="sr-only">
              Message to Baumy
            </label>
            <Input
              id="baumy-text"
              kiosk={kiosk}
              autoComplete="off"
              maxLength={1000}
              placeholder="Type to Baumy"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={asking}
            />
            <Button
              type="submit"
              size={size}
              disabled={asking || text.trim() === ""}
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

          <Button
            variant="secondary"
            size={size}
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </div>
      </Dialog>
    </>
  );
}
