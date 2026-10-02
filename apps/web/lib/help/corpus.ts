import type { AnyActionDef, Gate } from "@/lib/actions/define";
import { REGISTRY } from "@/lib/actions/registry";
import { toolSpecs, type ToolSpec } from "@/lib/actions/tool-specs";
import { HELP_CONSTANTS } from "./constants";
import { allLegalSections, type LegalHelpSection } from "./legal";
import { parseManualPage, type ManualFile } from "./manual";

// The help corpus (issue #142): everything Baumy may say about how Baumy
// Olympics works, built from three sources, never from the database:
//
// 1. the hand-written manual, docs/manual/*.md, its numbers filled from the
//    code's constants (lib/help/constants.ts);
// 2. "What Baumy can do", generated from the registry's `ai` actions;
// 3. the privacy and terms pages, read from their own element trees.
//
// `pnpm help:corpus` writes it to docs/help-corpus.generated.md, and
// corpus.test.ts fails while that file is out of date (like brain:spec). It
// is for members only: there is no public help (SPEC §12 decision 24).

/** Where the generated corpus lives, from the repo root. */
export const CORPUS_PATH = "docs/help-corpus.generated.md";

export interface HelpSection {
  slug: string;
  title: string;
  /** The in-app page a help answer links to for this section. */
  url: string;
  audience: "member" | "admin";
  source: "manual" | "capabilities" | "legal";
  /** The section's markdown, its own headings starting at `###`. */
  text: string;
}

/** What each gate means for someone asking Baumy, in the app or the kiosk. */
const GATE_NOTES: Record<Gate, string | null> = {
  member: null,
  display: null,
  attested: "On the kitchen screen it asks for the acting member's PIN.",
  admin: "Only a household admin can, in their own name.",
  session: "Only in the app, signed in to your own account.",
  account: "Only in the app, signed in to your own account.",
  service: "Only Baumy in Telegram can.",
};

/** The gate notes of actions whose gate depends on what is asked. */
const INPUT_GATE_NOTES: Readonly<Record<string, string>> = {
  log_completion:
    "On the kitchen screen, logging it for someone else asks for your PIN.",
};

function gateNote(def: AnyActionDef): string | null {
  if (typeof def.requires !== "function") return GATE_NOTES[def.requires];
  const note = INPUT_GATE_NOTES[def.name];
  if (!note) {
    throw new Error(`${def.name}: its gate depends on the input; add a note.`);
  }
  return note;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function capabilityLine(spec: ToolSpec, def: AnyActionDef): string {
  const notes = [
    spec.kind === "read"
      ? "Baumy looks it up and answers."
      : "Baumy suggests it as a card; nothing changes until you tap Confirm all.",
    spec.risk === "destructive"
      ? "The card is marked red: it deletes something."
      : null,
    gateNote(def),
    spec.own_word_only
      ? "Only the member themself can, never for someone else."
      : null,
  ].filter((n): n is string => n !== null);
  return `- **${spec.title}** (\`${spec.name}\`): ${oneLine(spec.description)} _${notes.join(" ")}_`;
}

/** "What Baumy can do", from the actions offered to the in-app AI. */
export function capabilitiesSection(
  registry: Readonly<Record<string, AnyActionDef>> = REGISTRY,
): HelpSection {
  const specs = toolSpecs("ai", registry);
  const line = (s: ToolSpec) => capabilityLine(s, registry[s.name]!);
  const offered = new Set(specs.map((s) => s.name));
  const appOnly = Object.values(registry)
    .filter((d) => d.surfaces.includes("ui") && !offered.has(d.name))
    .map((d) => d.title);
  const text = [
    "Ask Baumy (the cat on the hub and the kitchen screen) in your own words, typed or spoken. Baumy can only do what is listed here, and only as the member asking.",
    "### What Baumy can look up",
    specs
      .filter((s) => s.kind === "read")
      .map(line)
      .join("\n"),
    "### What Baumy can do, once you confirm",
    specs
      .filter((s) => s.kind === "write")
      .map(line)
      .join("\n"),
    "### Only in the app's own pages",
    `Baumy in the app cannot do these; use the app's own pages: ${appOnly.join("; ")}.`,
  ].join("\n\n");
  return {
    slug: "what-baumy-can-do",
    title: "What Baumy can do",
    url: "/",
    audience: "member",
    source: "capabilities",
    text,
  };
}

const LINK = /\]\((\/[^)\s]*)\)/g;

/** Every in-app link a manual page makes: its url and its inline links. */
export function sectionLinks(section: Pick<HelpSection, "url" | "text">) {
  return [section.url, ...[...section.text.matchAll(LINK)].map((m) => m[1]!)];
}

export interface CorpusSources {
  manual: readonly ManualFile[];
  constants?: Readonly<Record<string, string | number>>;
  legal?: readonly LegalHelpSection[];
  registry?: Readonly<Record<string, AnyActionDef>>;
}

/**
 * The corpus's sections in order: the manual, what Baumy can do, then the
 * privacy and terms sections. Throws on an unknown placeholder, a constant no
 * page uses, a repeated slug or a link to a legal anchor that does not exist.
 */
export function buildCorpus({
  manual,
  constants = HELP_CONSTANTS,
  legal = allLegalSections(),
  registry = REGISTRY,
}: CorpusSources): HelpSection[] {
  const used = new Set<string>();
  const pages: HelpSection[] = manual.map((file) => {
    const page = parseManualPage(file, constants, used);
    return {
      slug: page.slug,
      title: page.title,
      url: page.url,
      audience: page.audience,
      source: "manual",
      text: page.text,
    };
  });
  const unused = Object.keys(constants).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new Error(`No manual page uses {{${unused.join("}}, {{")}}}.`);
  }
  const anchors = new Set(legal.map((s) => s.url));
  for (const page of pages) {
    for (const link of sectionLinks(page)) {
      if (link.includes("#") && !anchors.has(link)) {
        throw new Error(`${page.slug}: ${link} is not a section anchor.`);
      }
    }
  }
  const sections: HelpSection[] = [
    ...pages,
    capabilitiesSection(registry),
    ...legal.map((s) => ({
      ...s,
      audience: "member" as const,
      source: "legal" as const,
    })),
  ];
  const seen = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.slug)) throw new Error(`Two sections are "${s.slug}".`);
    seen.add(s.slug);
  }
  return sections;
}

/** `## Heading` inside a page → `### Heading` under the page's title. */
function demote(text: string): string {
  return text.replace(/^(#{2,5}) /gm, "#$1 ");
}

/** The corpus as one markdown document. */
export function renderCorpus(sections: readonly HelpSection[]): string {
  const contents = sections
    .map((s) => `- \`${s.slug}\`: ${s.title} (${s.url})`)
    .join("\n");
  const body = sections.map((s) =>
    [
      `## ${s.title}`,
      `Section \`${s.slug}\` · link \`${s.url}\` · for ${s.audience === "admin" ? "admins" : "members"}`,
      s.source === "manual" ? demote(s.text) : s.text,
    ].join("\n\n"),
  );
  return [
    "<!-- Generated by `pnpm help:corpus` (apps/web/lib/help/corpus.ts) from docs/manual/, the action registry and the privacy and terms pages. Do not edit it: edit those, then run `pnpm help:corpus`. -->",
    "# Baumy Olympics help",
    "Everything Baumy may say about how Baumy Olympics works, for household members. It holds nothing about any household's own data.",
    "## Contents",
    contents,
    ...body,
  ]
    .join("\n\n")
    .concat("\n");
}
