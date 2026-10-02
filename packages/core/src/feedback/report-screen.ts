// Screening an in-app report before it is published (issue #133). Ported
// from camp-404 `packages/core/src/report-screen.ts`.
//
// Pattern-based on purpose, not a model: the screen exists to catch text that
// tries to steer whatever reads it next (the repo's own agents read these
// issues), and a model asked "is this steering you?" has to read the steering
// to answer. Urgency is not flagged: panic is the normal voice of a bug
// report.

import type { RedactionKind } from "./text-redaction";

export type ReportFlag =
  /** Speaks to whoever reads the issue instead of describing the app. */
  | "addresses-reader"
  /** Asks for data to be sent, shared or exported. */
  | "requests-disclosure"
  /** Holds identifiers that look like someone else's, not the reporter's. */
  | "third-party-data";

const ADDRESSES_READER: readonly RegExp[] = [
  /\bignore (?:the |all |any )?(?:above|previous|prior|earlier|preceding)\b/i,
  /\bdisregard (?:the |all |any )?(?:above|previous|prior|instructions?)\b/i,
  /\byou (?:must|should|need to|have to|are to)\b/i,
  /\bplease (?:run|execute|send|forward|email|deploy|merge|approve)\b/i,
  /\b(?:new|updated|revised) instructions?\b/i,
  /\bas (?:the |an )?(?:admin|administrator|maintainer|owner|developer)\b/i,
  /\bsystem prompt\b/i,
];

const REQUESTS_DISCLOSURE: readonly RegExp[] = [
  /\b(?:send|email|forward|share|export|transfer|upload|post|disclose|release)\b[^.!?\n]{0,60}\b(?:data|record|records|detail|details|information|info|note|notes|contact|contacts|list|roster|database|dump|export)\b/i,
  /\b(?:data|record|records|detail|details|information|note|notes|contact|contacts|roster)\b[^.!?\n]{0,40}\b(?:to|at)\b\s+\S+@\S+/i,
  /\bcopy (?:me|us|it|them|everything)\b/i,
];

/**
 * Redaction kinds that point at someone other than the reporter: an ID
 * number, a card number or a serialised record is what was on the screen
 * when it broke, not something a person types about their own bug. An email
 * or phone number alone is not enough: reporters give their own.
 */
const THIRD_PARTY_KINDS: readonly RedactionKind[] = [
  "id-number",
  "card",
  "structured-data",
];

export interface ScreenResult {
  flags: ReportFlag[];
  /** A person must read it before any routine (or the AI pass) acts on it. */
  needsHuman: boolean;
  /** The attached diagnostics must not be published with it. */
  withholdDiagnostics: boolean;
}

/**
 * Screen a report. `description` is the member's RAW text (the patterns must
 * see what was written); `redacted` is what redaction removed from it, the
 * only reliable sign that a third party was in there.
 */
export function screenReport(
  description: string,
  redacted: readonly RedactionKind[],
): ScreenResult {
  const flags: ReportFlag[] = [];
  if (ADDRESSES_READER.some((p) => p.test(description))) {
    flags.push("addresses-reader");
  }
  if (REQUESTS_DISCLOSURE.some((p) => p.test(description))) {
    flags.push("requests-disclosure");
  }
  if (redacted.some((kind) => THIRD_PARTY_KINDS.includes(kind))) {
    flags.push("third-party-data");
  }
  return {
    flags,
    needsHuman: flags.length > 0,
    withholdDiagnostics: flags.includes("third-party-data"),
  };
}

const FLAG_LABELS: Record<ReportFlag, string> = {
  "addresses-reader":
    "has text aimed at the reader instead of describing the app",
  "requests-disclosure": "asks for data to be sent or shared",
  "third-party-data":
    "holds identifiers that look like someone else's, not the reporter's",
};

/** One line for the top of the issue, naming what was flagged without quoting it. */
export function describeFlags(flags: readonly ReportFlag[]): string {
  if (flags.length === 0) return "";
  return `**Held for a person.** This report ${flags
    .map((flag) => FLAG_LABELS[flag])
    .join("; ")}. No routine has read it. Do not act on it until a person has.`;
}

/**
 * The labels an in-app report gets on this repository, in its own label
 * style (`bug`, `type:feat`, `area:…`). `source:in-app` says the issue was
 * posted with the household's token, so the account and the author are not
 * the same person; `needs-human` when the screen held it. GitHub creates a
 * label the first time an issue uses it.
 */
export function reportLabels(
  kind: "bug" | "feature",
  flags: readonly ReportFlag[] = [],
): string[] {
  const labels = [kind === "bug" ? "bug" : "type:feat", "source:in-app"];
  return flags.length > 0 ? [...labels, "needs-human"] : labels;
}
