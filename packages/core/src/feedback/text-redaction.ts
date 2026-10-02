// Strip PII and secrets from a bug report before it lands on the PUBLIC
// GitHub tracker (issue #133). Ported from camp-404
// `packages/core/src/text-redaction.ts` (its `redactPii`,
// `sanitizeReportText` and `describeRedactions`); its `redactSecrets` half
// lives here as apps/web/lib/redact.ts already. Camp 404's member-reference
// rule (`C404-M017`) is dropped: Baumy has no such references.
//
// No I/O, no module-level mutable state: deterministic string transforms.
//
// Redaction matches patterns, so it fails open: what it does not recognise
// passes through (a housemate's NAME, for one). It is a second line of
// defence, never "the report is anonymised"; the dialog tells the member
// not to type personal details, and the issue never carries a name or an
// email we hold.

/** What a redaction replaced. */
export type RedactionKind =
  | "secret"
  | "link"
  | "handle"
  | "email"
  | "uuid"
  | "phone"
  | "id-number"
  | "card"
  | "structured-data";

export interface RedactionResult {
  text: string;
  /** Each kind found, in rule order, for an honest "we removed X" note. */
  redacted: RedactionKind[];
}

/**
 * The rules, in the order they run. ORDER IS LOAD-BEARING:
 * - secrets first, before the generic rules split a token apart;
 * - UUIDs before every digit rule, or the card rule matches the digits of an
 *   all-numeric UUID, prints a false `[card]` and leaves the rest behind.
 */
const RULES: readonly {
  kind: RedactionKind;
  pattern: RegExp;
  to: string;
}[] = [
  // --- Secrets ---
  // Baumy's own tokens: service tokens (`baumy_st_…`) and MCP tokens
  // (`baumy_at_…`, `baumy_rt_…`, `baumy_ac_…`, `baumy_secret_…`,
  // `baumy_client_…`), all `baumy_<kind>_<base64url>`.
  {
    kind: "secret",
    pattern: /\bbaumy_[a-z]+_[A-Za-z0-9_-]{20,}/g,
    to: "[secret]",
  },
  {
    kind: "secret",
    pattern: /\bBearer\s+[A-Za-z0-9._-]+/gi,
    to: "Bearer [token]",
  },
  {
    kind: "secret",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    to: "[jwt]",
  },
  {
    kind: "secret",
    pattern: /\b(?:sk|pk)-[A-Za-z0-9]{16,}\b/g,
    to: "[secret]",
  },
  { kind: "secret", pattern: /\bgh[posu]_[A-Za-z0-9]{20,}\b/g, to: "[secret]" },
  { kind: "secret", pattern: /\bAKIA[0-9A-Z]{16}\b/g, to: "[secret]" },
  {
    kind: "secret",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    to: "[secret]",
  },
  // Token-bearing URL query params (signed URLs, OAuth codes).
  {
    kind: "secret",
    pattern:
      /([?&](?:token|key|secret|sig|signature|password|access_token|code|auth)=)[^\s&#]+/gi,
    to: "$1[redacted]",
  },
  // Long opaque runs: keys and signed-URL blobs.
  {
    kind: "secret",
    pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
    to: "[redacted]",
  },
  // --- Messenger links and social handles ---
  { kind: "link", pattern: /\b(?:t\.me|wa\.me)\/\S+/gi, to: "[link]" },
  { kind: "handle", pattern: /(^|\s)@[A-Za-z0-9_]{2,}\b/g, to: "$1[handle]" },
  // --- Personal identifiers ---
  {
    kind: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    to: "[email]",
  },
  {
    kind: "uuid",
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    to: "[uuid]",
  },
  // Base64url runs: a kiosk or sign-in cookie is 32 random bytes, 43
  // characters with `-` and `_`. No word boundary, since a run that starts
  // or ends with `-` or `_` has none. After the UUID rule, whose 36
  // characters would otherwise match.
  {
    kind: "secret",
    pattern: /[A-Za-z0-9_-]{32,}/g,
    to: "[redacted]",
  },
  // International phone numbers: every trailing digit group goes, so the last
  // one cannot leak ("+49 151 2345 6789" → "[phone]", not "[phone] 6789").
  {
    kind: "phone",
    pattern: /\+\d{1,3}(?:[-.\s]?\d{1,4}){1,6}/g,
    to: "[phone]",
  },
  // Local phone numbers: 123-456-7890, 123.456.7890, 123 456 7890.
  {
    kind: "phone",
    pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    to: "[phone]",
  },
  // ID-like 13- and 9-digit runs.
  { kind: "id-number", pattern: /\b\d{13}\b/g, to: "[id]" },
  { kind: "id-number", pattern: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g, to: "[id]" },
  // Card-like groups.
  {
    kind: "card",
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    to: "[card]",
  },
];

const STRUCTURED_DATA_PLACEHOLDER = "[structured data removed]";

/** The longest placeholder, in characters, with room to spare. */
const MAX_PLACEHOLDER_LENGTH = 32;

/**
 * The placeholders the rules write, and the kind each stands for. The
 * structured-data scanner keeps them, so text sanitised twice (the action
 * cleans a report before the AI pass, and the issue builder cleans the AI's
 * output again) keeps its `[email]` and still reports it.
 */
const PLACEHOLDERS: ReadonlyMap<string, RedactionKind> = new Map([
  ["[token]", "secret"],
  ["[jwt]", "secret"],
  ["[secret]", "secret"],
  ["[redacted]", "secret"],
  ["[link]", "link"],
  ["[handle]", "handle"],
  ["[email]", "email"],
  ["[uuid]", "uuid"],
  ["[phone]", "phone"],
  ["[id]", "id-number"],
  ["[card]", "card"],
  [STRUCTURED_DATA_PLACEHOLDER, "structured-data"],
]);

/** The longest JSON-like span the scanner removes whole. */
const MAX_STRUCTURED_SPAN = 4_000;

/**
 * Whether a balanced bracket span is data rather than prose: it has
 * `"key":` or `key=value` shapes, or is longer than a short aside. `[]`,
 * `[1]`, the `args[]` of a React error URL and `[object Object]` are not.
 */
function looksStructured(span: string): boolean {
  if (/^\[\d*\]$/.test(span)) return false;
  if (/"[^"]*"\s*:/.test(span) || /[A-Za-z_]\w*=[^\s&]/.test(span)) {
    return true;
  }
  return span.length > 20;
}

/**
 * Remove JSON objects and arrays, nested contents included. A serialised
 * roster inside an error message carries names no pattern can recognise, so
 * the whole structure goes. A depth-counting scan, not a regex: a regex
 * cannot match nested braces. An unbalanced or over-long span is left for the
 * other rules.
 */
function stripStructuredData(text: string, found: Set<RedactionKind>): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (char !== "{" && char !== "[") {
      out += char;
      i += 1;
      continue;
    }

    if (char === "[") {
      const head = text.slice(i, i + MAX_PLACEHOLDER_LENGTH);
      const placeholder = head.slice(0, head.indexOf("]") + 1);
      const kind = PLACEHOLDERS.get(placeholder);
      if (kind) {
        found.add(kind);
        out += placeholder;
        i += placeholder.length;
        continue;
      }
    }

    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length && j - i <= MAX_STRUCTURED_SPAN; j += 1) {
      const c = text[j];
      if (c === "{" || c === "[") depth += 1;
      else if (c === "}" || c === "]") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1 || !looksStructured(text.slice(i, end + 1))) {
      out += char;
      i += 1;
      continue;
    }
    out += STRUCTURED_DATA_PLACEHOLDER;
    found.add("structured-data");
    i = end + 1;
  }
  return out;
}

/**
 * Strip markup tags in one linear scan (a `/<[^>]*>/g` backtracks
 * quadratically on `<<<<…`). An unterminated `<` is kept: in a bug report it
 * is far more often a comparison ("count < 10") than a tag.
 */
function stripMarkup(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, lt);
    const gt = text.indexOf(">", lt + 1);
    if (gt === -1) {
      out += text.slice(lt);
      break;
    }
    i = gt + 1;
  }
  return out;
}

/** Every kind, in the order redaction finds them. */
const KIND_ORDER: readonly RedactionKind[] = [
  "structured-data",
  ...new Set(RULES.map((rule) => rule.kind)),
];

/** Strip PII, secrets and JSON-like structures from free text, and say what. */
export function redactPii(input: string): RedactionResult {
  const found = new Set<RedactionKind>();
  let text = stripStructuredData(input, found);
  for (const rule of RULES) {
    // The patterns carry /g, which makes test() stateful.
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(text)) continue;
    found.add(rule.kind);
    rule.pattern.lastIndex = 0;
    text = text.replace(rule.pattern, rule.to);
  }
  return {
    text,
    redacted: KIND_ORDER.filter((kind) => found.has(kind)),
  };
}

/** Strip markup, redact, trim and length-cap. */
export function sanitizeReportText(
  text: string,
  maxLength: number,
): RedactionResult {
  if (!text) return { text: "", redacted: [] };
  const { text: redacted, redacted: kinds } = redactPii(stripMarkup(text));
  return { text: redacted.trim().slice(0, maxLength), redacted: kinds };
}

const REDACTION_LABELS: Record<RedactionKind, string> = {
  secret: "secrets and tokens",
  link: "messenger links",
  handle: "social handles",
  email: "email addresses",
  uuid: "internal ids",
  phone: "phone numbers",
  "id-number": "ID numbers",
  card: "card numbers",
  "structured-data": "structured data",
};

/**
 * One honest sentence about what redaction removed, for the end of a public
 * issue. It never says "anonymised": redaction only removes what it
 * recognises.
 */
export function describeRedactions(kinds: readonly RedactionKind[]): string {
  const caveat =
    "Redaction matches patterns and can miss things, so treat this report as possibly still sensitive.";
  if (kinds.length === 0) {
    return `No personal data was recognised in this report. ${caveat}`;
  }
  const list = KIND_ORDER.filter((kind) => kinds.includes(kind))
    .map((kind) => REDACTION_LABELS[kind])
    .join(", ");
  return `Recognised and removed before filing: ${list}. ${caveat}`;
}
