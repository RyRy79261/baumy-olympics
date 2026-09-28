import type { AnyActionDef, Gate } from "@/lib/actions/define";
import { REGISTRY } from "@/lib/actions/registry";
import { DEFAULT_RATE_LIMITS } from "@/lib/actions/run";
import { toolSpecs, type ToolSpec } from "@/lib/actions/tool-specs";
import { LINK_ACTION, needsConfirmation, statusFor } from "./endpoint";
import {
  BRAIN_ACTION_NOTES,
  BRAIN_EXCLUDED,
  type BrainActionNotes,
} from "./operations-spec-notes";

// docs/brain-operations-spec.md, generated (issue #70): the hand-written
// template (operations-spec.template.md) with the registry's brain actions
// filled in, each with its notes (operations-spec-notes.ts). `pnpm brain:spec`
// rewrites the doc; operations-spec.test.ts fails while it is out of date.

/** Where the generated doc lives, from the repo root. */
export const SPEC_PATH = "docs/brain-operations-spec.md";

const MARKERS = {
  summary: "<!-- generated:summary -->",
  actions: "<!-- generated:actions -->",
  unavailable: "<!-- generated:unavailable -->",
} as const;

const GATES: Record<Gate, string> = {
  member: "any linked member",
  display: "any linked member",
  attested:
    "the member themself: brain counts as the member (the kiosk would need their PIN)",
  service:
    "the service token alone; the member comes from the code, so an unlinked sender may call it",
  admin: "an admin in the app",
  session: "a real session in the app",
  account: "a real session in the app",
};

/** Why an action behind this gate is not brain's. */
const UNAVAILABLE_BY_GATE: Partial<Record<Gate, string>> = {
  admin: "An admin action: UI only (SPEC §12 decision 10).",
  session: "The member's own account settings: only in the app, signed in.",
  account: "Joining the household: only in the app, signed in.",
};

function gateOf(def: AnyActionDef, notes: BrainActionNotes): string {
  if (typeof def.requires === "function") {
    if (!notes.gate) {
      throw new Error(
        `${def.name}: its gate depends on the input; add a gate note.`,
      );
    }
    return notes.gate;
  }
  return GATES[def.requires as Gate];
}

/** Whether `X-Baumy-On-Behalf-Of` is accepted for this action. */
function behalfAllowed(spec: ToolSpec): boolean {
  return spec.name !== LINK_ACTION && !spec.member_field;
}

function confirmLine(spec: ToolSpec): string {
  if (needsConfirmation(spec, false)) {
    return `\`${spec.risk}\`: always send \`X-Baumy-Confirmed: 1\`, only after the asker tapped the confirm button (428 without it)`;
  }
  if (spec.kind === "read") {
    return "`safe`: runs straight away, on anyone's behalf too";
  }
  return behalfAllowed(spec)
    ? "`safe`: runs straight away for the asker; on a housemate's behalf it needs `X-Baumy-Confirmed: 1`"
    : "`safe`: runs straight away";
}

function tapWhen(spec: ToolSpec): string {
  if (needsConfirmation(spec, false)) return "always";
  return spec.kind === "write" && behalfAllowed(spec)
    ? "on behalf only"
    : "never";
}

function behalfLine(spec: ToolSpec): string {
  if (spec.name === LINK_ACTION) {
    return "no: linking is always for the sender";
  }
  if (spec.member_field) {
    return `no (400): name the housemate in \`${spec.member_field}\` instead`;
  }
  return spec.kind === "write"
    ? "yes, with `X-Baumy-On-Behalf-Of` and the asker's confirm tap"
    : "yes, with `X-Baumy-On-Behalf-Of`";
}

function rateLine(def: AnyActionDef): string {
  const r = def.rateLimit ?? DEFAULT_RATE_LIMITS[def.kind];
  const per =
    r.windowMs === 60_000
      ? "a minute"
      : `${Math.round(r.windowMs / 60_000)} minutes`;
  return `${r.perMember} per Telegram user and ${r.perIp} per IP in ${per}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function actionSection(spec: ToolSpec): string {
  const def = REGISTRY[spec.name as keyof typeof REGISTRY] as AnyActionDef;
  const notes = BRAIN_ACTION_NOTES[spec.name];
  if (!notes) {
    throw new Error(
      `${spec.name} is offered to brain but has no notes in operations-spec-notes.ts.`,
    );
  }
  const { $schema: _drop, ...schema } = spec.input_schema;
  const errors = notes.errors.length
    ? notes.errors.map((c) => `\`${c}\` (${statusFor(c)})`).join(", ")
    : "none of its own";
  const rows: [string, string][] = [
    ["Kind", `\`${spec.kind}\``],
    ["Risk", confirmLine(spec)],
    ["Who may", gateOf(def, notes)],
    ["On a housemate's behalf", behalfLine(spec)],
    [
      "`Idempotency-Key`",
      spec.kind === "write"
        ? "required; the same key again replays"
        : "not needed",
    ],
    ["Rate limit", rateLine(def)],
  ];
  if (def.transactional === false) {
    rows.push([
      "Calls out",
      "yes (Google or brain): may answer 503 `NOT_CONFIGURED` or `UNAVAILABLE`",
    ]);
  }
  return [
    `### \`${spec.name}\`: ${spec.title}`,
    "",
    oneLine(notes.purpose),
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    `**When to use it.** ${oneLine(notes.when)}`,
    "",
    `**Tool description** (the registry's, verbatim): ${oneLine(spec.description)}`,
    "",
    "**Examples.**",
    "",
    ...notes.examples.map((e) => `- "${e.say}" → \`${e.call}\``),
    "",
    "**Input** (JSON Schema of the body):",
    "",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    "",
    `**Returns** (\`data\`): ${oneLine(notes.returns)}`,
    "",
    `**Its errors:** ${errors}. Every call can also get the endpoint's codes (above).`,
    "",
    `**Say back:** ${oneLine(notes.reply)}`,
  ].join("\n");
}

function summaryTable(specs: ToolSpec[]): string {
  return [
    "| Action | Kind | Risk | Confirm tap | On behalf |",
    "| --- | --- | --- | --- | --- |",
    ...specs.map((s) => {
      const behalf = behalfAllowed(s)
        ? "yes"
        : s.member_field
          ? `no, use \`${s.member_field}\``
          : "no";
      return `| [\`${s.name}\`](#${s.name}-${anchorOf(s.title)}) | ${s.kind} | ${s.risk} | ${tapWhen(s)} | ${behalf} |`;
    }),
  ].join("\n");
}

/** GitHub's heading anchor for "`name`: Title", after the name part. */
function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function unavailableList(): string {
  const brain = new Set(toolSpecs("brain").map((s) => s.name));
  const lines: string[] = [];
  for (const def of Object.values(REGISTRY) as AnyActionDef[]) {
    if (brain.has(def.name)) continue;
    const reason =
      BRAIN_EXCLUDED[def.name as keyof typeof BRAIN_EXCLUDED] ??
      UNAVAILABLE_BY_GATE[def.requires as Gate];
    if (!reason) {
      throw new Error(`${def.name} is not brain's; say why in BRAIN_EXCLUDED.`);
    }
    lines.push(`- \`${def.name}\`: ${reason}`);
  }
  return lines.join("\n");
}

/** The whole doc: the template with the generated parts filled in. */
export function renderOperationsSpec(template: string): string {
  const specs = toolSpecs("brain");
  const known = new Set(specs.map((s) => s.name));
  const stale = Object.keys(BRAIN_ACTION_NOTES).filter((n) => !known.has(n));
  if (stale.length > 0) {
    throw new Error(
      `Notes for actions brain does not have: ${stale.join(", ")}.`,
    );
  }
  for (const marker of Object.values(MARKERS)) {
    if (!template.includes(marker)) {
      throw new Error(`The template is missing ${marker}.`);
    }
  }
  const body = template
    .replace(MARKERS.summary, summaryTable(specs))
    .replace(MARKERS.actions, specs.map(actionSection).join("\n\n"))
    .replace(MARKERS.unavailable, unavailableList());
  return body.endsWith("\n") ? body : `${body}\n`;
}
