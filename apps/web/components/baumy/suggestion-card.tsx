"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  ProposalItem,
  Select,
  Textarea,
  cx,
} from "@baumy/ui";
import type { ProposalField } from "@/lib/ai/proposal";
import { cardTone, isOpen, withField, type ReviewRow } from "@/lib/ai/review";

// One suggestion card (SPEC §3.6, owner ruling 2026-09-29, issue #107):
// what Baumy will do, in plain words (the action's preview), with its tags
// and, once "Confirm all" ran, its result. There is no per-card approve: the
// list's "Confirm all" and "Cancel" (suggestion-cards.tsx) decide for all of
// them. A card's small × drops just that one first. A card that deletes
// something is red; one that is not valid is greyed with the reason and
// never runs. In the sheet a card can be edited from the tool's own schema
// (a chore or a member is picked from a list), and the edit is checked and
// previewed again on the server under a new proposal id. In the cat's
// bubble the cards are compact and have no editor.

export interface SuggestionCardProps {
  row: ReviewRow;
  kiosk: boolean;
  /** The kitchen dashboard's speech bubble: compact, no editor. */
  bubble?: boolean;
  /** Drop this card before confirming. */
  onDrop: () => void;
  /** Re-check the edited input; resolves when the card is replaced. */
  onEdit?: (input: Record<string, unknown>) => Promise<void>;
  /** While "Confirm all" runs, nothing can be dropped or edited. */
  busy: boolean;
  /**
   * Told when the edit form opens or its check starts (true) and when both
   * are over (false): "Confirm all" waits, so an edit never races it.
   */
  onEditing?: (active: boolean) => void;
}

function FieldInput({
  field,
  value,
  onChange,
  kiosk,
  id,
  control,
}: {
  field: ProposalField;
  value: unknown;
  onChange: (v: unknown) => void;
  kiosk: boolean;
  id: string;
  control: Record<string, unknown>;
}) {
  const text = value === undefined || value === null ? "" : String(value);
  switch (field.kind) {
    case "select":
      return (
        <Select
          {...control}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{field.required ? "Pick one" : "(none)"}</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "boolean":
      return (
        <input
          {...control}
          type="checkbox"
          className="size-6"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "number":
      return (
        <Input
          {...control}
          kiosk={kiosk}
          type="number"
          value={text}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
        />
      );
    case "textarea":
      return (
        <Textarea
          {...control}
          kiosk={kiosk}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "text":
      return (
        <Input
          {...control}
          kiosk={kiosk}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "readonly":
      return (
        <p id={id} className="text-sm break-all text-bm-muted">
          {text || "(none)"}
        </p>
      );
  }
}

function tagsOf(row: ReviewRow, kiosk: boolean): string[] {
  const tone = cardTone(row);
  return [
    ...(tone === "destructive" ? ["Deletes something"] : []),
    ...(tone === "invalid" ? ["Can't do this"] : []),
    ...(kiosk && row.needsPin && tone !== "invalid" ? ["Needs your PIN"] : []),
  ];
}

/** Why it cannot run, what running it did, or why it failed. */
function messageOf(row: ReviewRow): string | undefined {
  return (
    row.message ??
    (!row.proposal.valid && isOpen(row) ? row.proposal.error : undefined)
  );
}

function DropButton({
  row,
  onDrop,
  busy,
  kiosk,
  className,
}: {
  row: ReviewRow;
  onDrop: () => void;
  busy: boolean;
  /** Kiosk touch targets are at least 56px. */
  kiosk: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Drop: ${row.proposal.preview}`}
      title="Drop this one"
      disabled={busy}
      onClick={onDrop}
      className={cx(
        "flex shrink-0 items-center justify-center font-label text-xl leading-none disabled:opacity-50",
        kiosk ? "size-14" : "size-11",
        className,
      )}
    >
      {"\u00d7"}
    </button>
  );
}

export function SuggestionCard({
  row,
  kiosk,
  bubble = false,
  onDrop,
  onEdit,
  busy,
  onEditing,
}: SuggestionCardProps) {
  const { proposal, state } = row;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposal.input);
  const [checking, setChecking] = useState(false);
  const size = kiosk ? "kiosk" : "default";
  const open = isOpen(row);
  // The form shows only while the card is open: a card that saved or was
  // dropped has nothing left to edit.
  const formShown = editing && open && onEdit !== undefined;
  const active = formShown || checking;
  const tell = useRef(onEditing);
  tell.current = onEditing;
  useEffect(() => {
    if (!active) return;
    tell.current?.(true);
    return () => tell.current?.(false);
  }, [active]);
  const tone = cardTone(row);
  const editable =
    !bubble &&
    onEdit !== undefined &&
    open &&
    proposal.fields.some((f) => f.kind !== "readonly");
  const tags = tagsOf(row, kiosk);
  const message = messageOf(row);
  const mark =
    state === "saved"
      ? "\u2713"
      : state === "failed"
        ? "!"
        : tone === "destructive"
          ? "\u2716"
          : "\u2022";

  if (bubble) {
    return (
      <li
        data-testid={`suggestion-${proposal.name}`}
        data-state={state}
        data-tone={tone}
        className={cx(
          "flex items-start gap-2 border-2 bg-white/70 px-3 py-2 font-body text-[22px] leading-snug",
          tone === "destructive" && "border-[#b8243a] text-[#b8243a]",
          tone === "invalid" && "border-[#c9bfd9] opacity-60",
          tone === "normal" && "border-[#c9bfd9]",
          state === "saved" && "border-[#1f9e66]",
        )}
      >
        <span aria-hidden className="w-5 shrink-0 text-center">
          {mark}
        </span>
        <span className="flex-1">
          {proposal.preview}
          {tags.length > 0 ? (
            <span className="block font-label text-[12px] uppercase">
              {tags.join(" \u00b7 ")}
            </span>
          ) : null}
          {message ? (
            <span
              role={state === "failed" ? "alert" : "status"}
              className="block text-[16px] text-[#4a3a66]"
            >
              {message}
            </span>
          ) : null}
          <span className="sr-only" data-testid="suggestion-state">
            {state}
          </span>
        </span>
        {open ? (
          <DropButton row={row} onDrop={onDrop} busy={busy} kiosk={kiosk} />
        ) : null}
      </li>
    );
  }

  return (
    <ProposalItem
      data-testid={`suggestion-${proposal.name}`}
      data-tone={tone}
      preview={
        <span className="flex items-start gap-2">
          <span className="flex-1">{proposal.preview}</span>
          {open ? (
            <DropButton
              row={row}
              onDrop={onDrop}
              busy={busy}
              kiosk={kiosk}
              className="-mt-2 -mr-2 text-bm-muted"
            />
          ) : null}
        </span>
      }
      title={proposal.title}
      state={state}
      tags={tags}
      message={message}
      className={cx(
        tone === "destructive" && "text-bm-red [--pf:var(--color-bm-red)]",
        tone === "invalid" && "opacity-60",
      )}
    >
      {proposal.issues && proposal.issues.length > 0 && open ? (
        <ul className="list-disc pl-5 text-sm text-bm-red">
          {proposal.issues.map((i) => (
            <li key={`${i.path.join(".")}:${i.message}`}>
              {i.path.join(".") || "input"}: {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      {formShown ? (
        <form
          className="flex flex-col gap-3"
          aria-label={`Edit: ${proposal.title}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setChecking(true);
            try {
              await onEdit!(draft);
              setEditing(false);
            } finally {
              setChecking(false);
            }
          }}
        >
          {proposal.fields.map((f) => {
            const id = `${proposal.proposalId}-${f.name}`;
            return (
              <Field key={f.name} id={id} label={f.label}>
                {(control) => (
                  <FieldInput
                    field={f}
                    id={id}
                    control={control}
                    kiosk={kiosk}
                    value={draft[f.name]}
                    onChange={(v) => setDraft((d) => withField(d, f.name, v))}
                  />
                )}
              </Field>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size={size} disabled={checking || busy}>
              {checking ? "Checking\u2026" : "Check it"}
            </Button>
            <Button
              variant="secondary"
              size={size}
              onClick={() => {
                setDraft(proposal.input);
                setEditing(false);
              }}
            >
              Back
            </Button>
          </div>
        </form>
      ) : editable ? (
        <div className="flex">
          <Button
            variant="ghost"
            size={size}
            disabled={busy}
            onClick={() => {
              setDraft(proposal.input);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </div>
      ) : null}
    </ProposalItem>
  );
}
