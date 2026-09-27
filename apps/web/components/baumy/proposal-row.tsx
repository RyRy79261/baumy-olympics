"use client";

import { useState } from "react";
import {
  Button,
  Field,
  Input,
  PinPad,
  ProposalItem,
  Select,
  Textarea,
} from "@baumy/ui";
import type { ProposalField } from "@/lib/ai/proposal";
import { canApprove, withField, type ReviewRow } from "@/lib/ai/review";

// One proposal in the Baumy sheet, after intake-tracker's
// `components/voice/parsed-item-row.tsx`: the preview line to approve, its
// tags, Approve and Reject, and an editor built from the tool's own schema
// (a chore or a member is picked from a list). An edited row is checked and
// previewed again on the server before it can be approved, under a new
// proposal id. On the kiosk a row that needs attestation opens the PinPad
// inside its own form, and the PIN goes with that one request.

export interface ProposalRowProps {
  row: ReviewRow;
  kiosk: boolean;
  /** "Ryan's PIN". */
  pinLabel: string;
  onApprove: (pin?: string) => void;
  onReject: () => void;
  /** Re-check the edited input; resolves when the row is replaced. */
  onEdit: (input: Record<string, unknown>) => Promise<void>;
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
        <p id={id} className="text-sm break-all text-neutral-700">
          {text || "(none)"}
        </p>
      );
  }
}

export function ProposalRow({
  row,
  kiosk,
  pinLabel,
  onApprove,
  onReject,
  onEdit,
}: ProposalRowProps) {
  const { proposal, state } = row;
  const [pinOpen, setPinOpen] = useState(false);
  const [pinAttempt, setPinAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposal.input);
  const [checking, setChecking] = useState(false);
  const size = kiosk ? "kiosk" : "default";
  const open = state === "pending" || state === "failed";
  const editable = open && proposal.fields.some((f) => f.kind !== "readonly");
  const askPin = kiosk && row.needsPin;

  const tags = [
    ...(proposal.risk === "destructive" ? ["Deletes something"] : []),
    ...(!proposal.valid ? ["Not valid"] : []),
    ...(askPin ? ["Needs your PIN"] : []),
  ];
  const message =
    row.message ?? (!proposal.valid && open ? proposal.error : undefined);

  return (
    <ProposalItem
      data-testid={`proposal-${proposal.name}`}
      preview={proposal.preview}
      title={proposal.title}
      state={state}
      tags={tags}
      message={message}
    >
      {proposal.issues && proposal.issues.length > 0 && open ? (
        <ul className="list-disc pl-5 text-sm text-red-800">
          {proposal.issues.map((i) => (
            <li key={`${i.path.join(".")}:${i.message}`}>
              {i.path.join(".") || "input"}: {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <form
          className="flex flex-col gap-3"
          aria-label={`Edit: ${proposal.title}`}
          onSubmit={async (e) => {
            e.preventDefault();
            setChecking(true);
            try {
              await onEdit(draft);
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
            <Button type="submit" size={size} disabled={checking}>
              {checking ? "Checking…" : "Check it"}
            </Button>
            <Button
              variant="secondary"
              size={size}
              onClick={() => {
                setDraft(proposal.input);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {pinOpen && askPin && open ? (
        <form
          aria-label={pinLabel}
          onSubmit={(e) => {
            e.preventDefault();
            const pin = new FormData(e.currentTarget).get("pin");
            setPinOpen(false);
            setPinAttempt((n) => n + 1);
            onApprove(typeof pin === "string" ? pin : undefined);
          }}
        >
          <PinPad
            key={pinAttempt}
            label={pinLabel}
            onCancel={() => setPinOpen(false)}
          />
        </form>
      ) : null}

      {!editing && !pinOpen && open ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size={size}
            disabled={!canApprove(row)}
            onClick={() => (askPin ? setPinOpen(true) : onApprove())}
          >
            Approve
          </Button>
          <Button variant="secondary" size={size} onClick={onReject}>
            Reject
          </Button>
          {editable ? (
            <Button
              variant="ghost"
              size={size}
              onClick={() => {
                setDraft(proposal.input);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          ) : null}
        </div>
      ) : null}
    </ProposalItem>
  );
}
