"use client";

import { useState } from "react";
import { Button, CatButton, PinPad } from "@baumy/ui";
import {
  confirmAllTargets,
  confirmNeedsPin,
  visibleRows,
  type ReviewRow,
} from "@/lib/ai/review";
import { SuggestionCard } from "./suggestion-card";

// Everything Baumy wants to do, as suggestion cards with exactly two main
// buttons: "Confirm all" and "Cancel" (SPEC §3.6, owner ruling 2026-09-29,
// issue #107). The same list sits in the "Ask Baumy" sheet and in the
// kitchen cat's speech bubble.
//
// - Confirm all runs every valid card still waiting (or that failed), in
//   order; the cards show "Done" or the sentence it failed with. On the
//   kiosk, when any of them vouches for someone, it first opens the PinPad
//   once for the acting member, and that PIN goes with those requests.
// - Cancel rejects them all and closes.
// - Once nothing is left to run, one "Done" closes.

export interface SuggestionCardsProps {
  rows: readonly ReviewRow[];
  kiosk: boolean;
  bubble?: boolean;
  /** "Ryan's PIN". */
  pinLabel: string;
  /** While Confirm all runs. */
  busy: boolean;
  onConfirmAll: (pin?: string) => void;
  onCancel: () => void;
  onDone: () => void;
  onDrop: (row: ReviewRow) => void;
  onEdit?: (row: ReviewRow, input: Record<string, unknown>) => Promise<void>;
}

export function SuggestionCards({
  rows,
  kiosk,
  bubble = false,
  pinLabel,
  busy,
  onConfirmAll,
  onCancel,
  onDone,
  onDrop,
  onEdit,
}: SuggestionCardsProps) {
  const [pinOpen, setPinOpen] = useState(false);
  const [pinAttempt, setPinAttempt] = useState(0);
  const shown = visibleRows(rows);
  const targets = confirmAllTargets(rows);
  const anySaved = rows.some((r) => r.state === "saved");
  const size = kiosk ? "kiosk" : "default";

  const confirm = () => {
    if (confirmNeedsPin(rows, kiosk)) setPinOpen(true);
    else onConfirmAll();
  };

  const label = busy ? "Saving…" : "Confirm all";

  const actions =
    targets.length === 0 && anySaved ? (
      bubble ? (
        <CatButton onClick={onDone}>Done</CatButton>
      ) : (
        <Button size={size} onClick={onDone}>
          Done
        </Button>
      )
    ) : bubble ? (
      <>
        <CatButton
          variant="go"
          disabled={busy || targets.length === 0}
          onClick={confirm}
        >
          {label}
        </CatButton>
        <CatButton variant="soft" disabled={busy} onClick={onCancel}>
          Cancel
        </CatButton>
      </>
    ) : (
      <>
        <Button
          size={size}
          disabled={busy || targets.length === 0}
          onClick={confirm}
        >
          {label}
        </Button>
        <Button
          variant="secondary"
          size={size}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </>
    );

  return (
    <section
      aria-label="Baumy's suggestions"
      className={bubble ? "mt-3 flex flex-col gap-3" : "flex flex-col gap-3"}
    >
      <ul className={bubble ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
        {shown.map((row) => (
          <SuggestionCard
            key={row.proposal.proposalId}
            row={row}
            kiosk={kiosk}
            bubble={bubble}
            busy={busy}
            onDrop={() => onDrop(row)}
            {...(onEdit ? { onEdit: (input) => onEdit(row, input) } : {})}
          />
        ))}
      </ul>
      {pinOpen ? (
        <form
          aria-label={pinLabel}
          onSubmit={(e) => {
            e.preventDefault();
            const pin = new FormData(e.currentTarget).get("pin");
            setPinOpen(false);
            setPinAttempt((n) => n + 1);
            onConfirmAll(typeof pin === "string" ? pin : undefined);
          }}
        >
          <PinPad
            key={pinAttempt}
            label={pinLabel}
            submitLabel="Confirm all"
            onCancel={() => setPinOpen(false)}
          />
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">{actions}</div>
      )}
    </section>
  );
}
