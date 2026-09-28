// A write Claude proposed, as the review sheet shows it (SPEC §3.6, §6.3).
// Pure and client-safe: the server builds these (lib/actions/propose.ts) and
// the sheet renders and edits them.

import type { ActionRisk } from "@/lib/actions/define";
import type { InputIssue } from "@/lib/actions/result";

export interface Choice {
  value: string;
  label: string;
}

/** One editable field of a proposal's input, read from the tool's schema. */
export type ProposalField =
  | {
      name: string;
      label: string;
      kind: "text" | "textarea" | "number";
      required: boolean;
    }
  | { name: string; label: string; kind: "boolean"; required: boolean }
  | {
      name: string;
      label: string;
      kind: "select";
      required: boolean;
      options: Choice[];
    }
  /** Shown, not edited: an id the sheet has no list for. */
  | { name: string; label: string; kind: "readonly"; required: boolean };

export interface Proposal {
  /** The idempotency key the approval runs with (`requestId`). */
  proposalId: string;
  /** The action (tool) name. */
  name: string;
  title: string;
  /** The input as Claude (or the member, after an edit) gave it. */
  input: Record<string, unknown>;
  /** One line to approve, from the action's `preview`. */
  preview: string;
  risk: ActionRisk;
  /** Whether the input passed the action's schema and surface check. */
  valid: boolean;
  /** Why it is not valid. */
  error?: string;
  issues?: InputIssue[];
  /** On the kiosk: approving it needs the acting member's PIN. */
  needsPin: boolean;
  fields: ProposalField[];
}

/** What the sheet may pick from when editing ids. */
export interface ProposalChoices {
  members: Choice[];
  chores: Choice[];
}

type JsonSchema = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  maxLength?: number;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

const MEMBER_FIELDS = new Set(["doneBy", "memberId", "contributedBy"]);
const LONG_TEXT = 200;

/** "occurredAt" → "Occurred at". */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelFor(name: string): string {
  if (name === "choreId") return "Chore";
  if (name === "doneBy") return "Done by";
  if (name === "memberId") return "Member";
  if (name === "contributedBy") return "Paid by";
  if (name === "bodyMd") return "Text";
  return humanize(name.replace(/Id$/, ""));
}

/**
 * The fields the sheet can edit, from a tool's JSON Schema: a chore or member
 * id becomes a list to pick from, an enum a select, a boolean a checkbox, a
 * number a number box and other strings a text box. Any other id is shown as
 * it is.
 */
export function describeFields(
  schema: Record<string, unknown>,
  choices: ProposalChoices,
): ProposalField[] {
  const s = schema as JsonSchema;
  const required = new Set(s.required ?? []);
  return Object.entries(s.properties ?? {}).map(([name, prop]) => {
    const base = { name, label: labelFor(name), required: required.has(name) };
    if (name === "choreId") {
      return { ...base, kind: "select", options: choices.chores };
    }
    if (MEMBER_FIELDS.has(name)) {
      return { ...base, kind: "select", options: choices.members };
    }
    if (prop.enum) {
      return {
        ...base,
        kind: "select",
        options: prop.enum.map((v) => ({
          value: String(v),
          label: humanize(String(v)),
        })),
      };
    }
    if (prop.type === "boolean") return { ...base, kind: "boolean" };
    if (prop.type === "integer" || prop.type === "number") {
      return { ...base, kind: "number" };
    }
    if (prop.type === "string" && prop.format === "uuid") {
      return { ...base, kind: "readonly" };
    }
    if (prop.type === "string") {
      const long =
        (prop.maxLength ?? 0) > LONG_TEXT ||
        name === "bodyMd" ||
        name === "description";
      return { ...base, kind: long ? "textarea" : "text" };
    }
    return { ...base, kind: "readonly" };
  });
}
