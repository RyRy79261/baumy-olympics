import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// The hand-written manual (docs/manual/*.md, issue #142): one page per file,
// named `NN-<slug>.md` so the number orders them, each opening with a small
// frontmatter block:
//
//   ---
//   slug: the-pot
//   title: The pot
//   audience: member
//   url: /pot
//   covers:
//     - apps/web/app/(hub)/pot/page.tsx
//   ---
//
// `covers` lists the code the page explains, so a change there knows which
// page to reread. Numbers are `{{NAME}}` placeholders (lib/help/constants.ts).

/** Where the manual lives, from the repo root. */
export const MANUAL_DIR = "docs/manual";

const FILE_NAME = /^(\d{2})-([a-z0-9-]+)\.md$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const Frontmatter = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  // Members only: there is no public help (SPEC §12 decision 24). An admin
  // page is one only an admin can act on.
  audience: z.enum(["member", "admin"]),
  /** The in-app page the topic lives on, e.g. `/pot` or `/privacy#cookies`. */
  url: z.string().regex(/^\/[^\s]*$/),
  covers: z.array(z.string().min(1)).min(1),
});

export type ManualFrontmatter = z.infer<typeof Frontmatter>;

export interface ManualPage extends ManualFrontmatter {
  /** The file it came from, `docs/manual/03-the-pot.md`. */
  file: string;
  /** The page's markdown with every placeholder filled in. */
  text: string;
}

export interface ManualFile {
  name: string;
  content: string;
}

/** Every `.md` file in the manual folder, in name order. */
export function readManualFiles(repoRoot: string): ManualFile[] {
  const dir = path.join(repoRoot, MANUAL_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      name,
      content: readFileSync(path.join(dir, name), "utf8"),
    }));
}

/**
 * The frontmatter's tiny YAML: `key: value` lines, and `key:` followed by
 * `  - item` lines for a list. Nothing else is needed, so nothing else is
 * accepted.
 */
function parseFrontmatter(block: string, file: string): unknown {
  const out: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const raw of block.split("\n")) {
    if (raw.trim() === "") continue;
    const item = /^\s+-\s+(.+)$/.exec(raw);
    if (item) {
      if (!list) throw new Error(`${file}: a list item outside a list.`);
      list.push(item[1]!.trim());
      continue;
    }
    const pair = /^([a-z]+):(?:\s+(.*))?$/.exec(raw);
    if (!pair) throw new Error(`${file}: cannot read "${raw}".`);
    const [, key, value] = pair as unknown as [string, string, string?];
    if (value === undefined) {
      list = [];
      out[key] = list;
    } else {
      list = null;
      out[key] = value.trim();
    }
  }
  return out;
}

/** `{{NAME}}` → the constant's value; an unknown name throws. */
export function fillPlaceholders(
  text: string,
  constants: Readonly<Record<string, string | number>>,
  file: string,
  used?: Set<string>,
): string {
  const filled = text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = constants[name];
    if (value === undefined) {
      throw new Error(`${file}: unknown placeholder {{${name}}}.`);
    }
    used?.add(name);
    return String(value);
  });
  if (filled.includes("{{") || filled.includes("}}")) {
    throw new Error(`${file}: a placeholder that is not {{NAME}}.`);
  }
  return filled;
}

/** One manual file, checked and filled in. */
export function parseManualPage(
  file: ManualFile,
  constants: Readonly<Record<string, string | number>>,
  used?: Set<string>,
): ManualPage {
  const where = `${MANUAL_DIR}/${file.name}`;
  const name = FILE_NAME.exec(file.name);
  if (!name) throw new Error(`${where}: name it NN-<slug>.md.`);
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(file.content);
  if (!match) throw new Error(`${where}: it has no frontmatter block.`);
  const parsed = Frontmatter.safeParse(parseFrontmatter(match[1]!, where));
  if (!parsed.success) {
    throw new Error(`${where}: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.slug !== name[2]) {
    throw new Error(`${where}: its slug is not "${name[2]}".`);
  }
  const body = match[2]!.trim();
  if (/^# /m.test(body)) {
    throw new Error(`${where}: the title is the frontmatter's; start at ##.`);
  }
  return {
    ...parsed.data,
    file: where,
    text: fillPlaceholders(body, constants, where, used),
  };
}
