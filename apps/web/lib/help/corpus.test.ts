// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PHOTO_RETENTION_DAYS, RULESET_V1 } from "@baumy/core";
import type { AnyActionDef } from "@/lib/actions/define";
import { REGISTRY } from "@/lib/actions/registry";
import { toolSpecs } from "@/lib/actions/tool-specs";
import {
  buildCorpus,
  capabilitiesSection,
  CORPUS_PATH,
  renderCorpus,
  sectionLinks,
} from "./corpus";
import { HELP_CONSTANTS } from "./constants";
import { allLegalSections } from "./legal";
import { MANUAL_DIR, readManualFiles, type ManualFile } from "./manual";

// The help corpus (issue #142) is generated from the manual, the registry
// and the legal pages. The first test fails while the committed
// docs/help-corpus.generated.md differs from what they produce now; `pnpm
// help:corpus` rewrites it. The rest keep the manual true to the code.

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const webRoot = path.join(repoRoot, "apps/web");
const manual = readManualFiles(repoRoot);
const sections = buildCorpus({ manual });

/** Every page route under app/, route groups dropped: `/`, `/kiosk`, … */
function appRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, segments: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        const group = name.startsWith("(") && name.endsWith(")");
        walk(full, group ? segments : [...segments, name]);
      } else if (name === "page.tsx") {
        routes.add(`/${segments.join("/")}`);
      }
    }
  };
  walk(path.join(webRoot, "app"), []);
  return routes;
}

function section(slug: string) {
  const found = sections.find((s) => s.slug === slug);
  expect(found, slug).toBeDefined();
  return found!;
}

function file(name: string, body: string, front?: string): ManualFile {
  const frontmatter =
    front ??
    [
      "slug: sample",
      "title: A sample",
      "audience: member",
      "url: /pot",
      "covers:",
      "  - docs/SPEC.md",
    ].join("\n");
  return { name, content: `---\n${frontmatter}\n---\n${body}\n` };
}

describe("the help corpus", () => {
  it("is up to date with the manual, the registry and the legal pages (run `pnpm help:corpus`)", async () => {
    const doc = renderCorpus(sections);
    expect(doc).toContain("## How Baumy Olympics works");
    await expect(doc).toMatchFileSnapshot(path.join(repoRoot, CORPUS_PATH));
  });

  it("orders the manual, then what Baumy can do, then privacy and terms", () => {
    const sources = sections.map((s) => s.source);
    expect(sources.indexOf("capabilities")).toBe(manual.length);
    expect(sources.slice(0, manual.length).every((s) => s === "manual")).toBe(
      true,
    );
    expect(sources.slice(manual.length + 1).every((s) => s === "legal")).toBe(
      true,
    );
    expect(sections.at(-1)?.url.startsWith("/terms#")).toBe(true);
  });

  it("fills the manual's numbers from the code's constants", () => {
    const scoring = section("bounties-and-points").text;
    expect(scoring).toContain(`${RULESET_V1.streakStepPct}% of the bounty`);
    expect(scoring).toContain(
      `Undo** it within ${RULESET_V1.undoWindowMin} minutes`,
    );
    expect(scoring).toContain(`deleted ${PHOTO_RETENTION_DAYS} days after`);
    expect(section("kitchen-ipad").text).toContain("every night from 23:00");
    expect(sections.map((s) => s.text).join("\n")).not.toMatch(/\{\{|\}\}/);
  });

  it("carries the legal pages' words and their constants", () => {
    const keep = section("privacy-how-long-we-keep-it");
    expect(keep.url).toBe("/privacy#how-long-we-keep-it");
    expect(keep.title).toBe("Privacy: How long we keep it");
    expect(keep.text).toContain(
      `Proof photos are deleted ${PHOTO_RETENTION_DAYS} days`,
    );
    expect(section("privacy-cookies").text).toContain("`baumy_kiosk`");
    expect(section("privacy-contact").text).toContain("[terms](/terms)");
    expect(section("terms-points-and-the-pot").text).toContain("no cash value");
  });
});

describe("what Baumy can do", () => {
  const text = capabilitiesSection().text;

  it("covers every action offered to the in-app AI", () => {
    const specs = toolSpecs("ai");
    expect(specs.length).toBeGreaterThan(20);
    for (const spec of specs) {
      expect(text, spec.name).toContain(`**${spec.title}** (\`${spec.name}\`)`);
    }
  });

  it("says how each one runs and who may ask for it", () => {
    const lineOf = (name: string) =>
      text.split("\n").find((l) => l.includes(`(\`${name}\`)`)) ?? "";
    expect(lineOf("get_standings")).toContain("Baumy looks it up and answers.");
    expect(lineOf("create_note")).toContain("tap Confirm all");
    // Issue #145: only a dispute asks the PIN on the kitchen screen.
    expect(lineOf("dispute_completion")).toContain("acting member's PIN");
    expect(lineOf("create_note")).not.toContain("PIN");
    expect(lineOf("delete_note")).toContain("marked red");
    expect(lineOf("create_bounty")).toContain("Only a household admin");
    expect(lineOf("confirm_completion")).toContain("never for someone else");
    expect(lineOf("log_completion")).toContain("`log_completion`");
    expect(lineOf("log_completion")).not.toContain("PIN");
    expect(lineOf("create_reminder")).not.toContain("PIN");
  });

  it("lists the app-only actions by title, never as something Baumy does", () => {
    const appOnly = text.slice(text.indexOf("### Only in the app"));
    expect(appOnly).toContain("Manage members");
    expect(text).toContain("`log_completion`");
    expect(text).not.toContain("`manage_members`");
    expect(text).not.toContain("`link_telegram`");
  });

  it("refuses an action whose gate depends on the input without a note", () => {
    const def = {
      ...REGISTRY.log_completion,
      name: "log_mystery",
      requires: () => "member",
    } as unknown as AnyActionDef;
    expect(() => capabilitiesSection({ log_mystery: def })).toThrow(
      /log_mystery: its gate depends on the input/,
    );
  });
});

describe("the manual", () => {
  it("has the first pages, members only", () => {
    expect(manual.map((f) => f.name)).toEqual([
      "01-how-it-works.md",
      "02-bounties-and-points.md",
      "03-the-pot.md",
      "04-kitchen-ipad.md",
      "05-telegram-and-baumy-brain.md",
      "06-your-data-and-privacy.md",
      "07-getting-help.md",
    ]);
    const pages = sections.filter((s) => s.source === "manual");
    expect(pages.map((s) => s.audience)).toEqual(manual.map(() => "member"));
  });

  it("covers only paths that exist", () => {
    for (const f of manual) {
      const covers = /covers:\n((?:\s+- .+\n)+)/.exec(f.content)?.[1] ?? "";
      const paths = covers.split("\n").filter(Boolean);
      expect(paths.length, f.name).toBeGreaterThan(0);
      for (const p of paths) {
        const rel = p.replace(/^\s+- /, "");
        expect(existsSync(path.join(repoRoot, rel)), `${f.name}: ${rel}`).toBe(
          true,
        );
      }
    }
  });

  it("links only to pages the app has, and to legal anchors that exist", () => {
    const routes = appRoutes();
    expect(routes).toContain("/kiosk");
    expect(routes).toContain("/privacy");
    expect(routes).not.toContain("/(hub)");
    const anchors = new Set(allLegalSections().map((s) => s.url));
    let anchored = 0;
    for (const s of sections.filter((x) => x.source === "manual")) {
      for (const link of sectionLinks(s)) {
        const [route, anchor] = link.split("#");
        expect(routes, `${s.slug}: ${link}`).toContain(route);
        if (anchor !== undefined) {
          anchored += 1;
          expect(anchors, `${s.slug}: ${link}`).toContain(link);
        }
      }
    }
    expect(anchored).toBeGreaterThan(5);
  });

  it("uses every help constant, and nothing else", () => {
    const raw = manual.map((f) => f.content).join("\n");
    for (const name of Object.keys(HELP_CONSTANTS)) {
      expect(raw, name).toContain(`{{${name}}}`);
    }
  });

  it("keeps security internals out", () => {
    const raw = manual.map((f) => f.content).join("\n");
    expect(raw).toContain("PIN");
    expect(raw).not.toMatch(
      /\b(rate.?limit|lock ?out|locked|attempts|tries)\b/i,
    );
  });
});

describe("building the corpus", () => {
  const legal = allLegalSections();
  const one = (body: string, front?: string) =>
    buildCorpus({
      manual: [file("01-sample.md", body, front)],
      constants: { DAYS: 7 },
      legal,
    });

  it("fills a placeholder and demotes the page's headings", () => {
    const [page] = one("## Part\n\nKept {{ DAYS }} days.");
    expect(page?.text).toBe("## Part\n\nKept 7 days.");
    expect(renderCorpus([page!])).toContain("### Part\n\nKept 7 days.");
  });

  it("fails on an unknown or malformed placeholder", () => {
    expect(() => one("{{DAYS}} and {{WEEKS}}")).toThrow(
      "docs/manual/01-sample.md: unknown placeholder {{WEEKS}}.",
    );
    expect(() => one("{{DAYS}} and {{ two words }}")).toThrow(
      /a placeholder that is not \{\{NAME\}\}/,
    );
  });

  it("fails on a constant no page uses", () => {
    expect(() =>
      buildCorpus({
        manual: [file("01-sample.md", "{{DAYS}}")],
        constants: { DAYS: 7, WEEKS: 1 },
        legal,
      }),
    ).toThrow("No manual page uses {{WEEKS}}.");
  });

  it("fails on a link to a legal anchor that does not exist", () => {
    expect(one("{{DAYS}} [ok](/privacy#cookies)")).toHaveLength(
      1 + 1 + legal.length,
    );
    expect(() => one("{{DAYS}} [gone](/privacy#gone)")).toThrow(
      "sample: /privacy#gone is not a section anchor.",
    );
  });

  it("fails on two sections with one slug", () => {
    expect(() =>
      buildCorpus({
        manual: [
          file("01-sample.md", "{{DAYS}}"),
          file("02-sample.md", "again"),
        ],
        constants: { DAYS: 7 },
        legal,
      }),
    ).toThrow('Two sections are "sample".');
  });

  it("checks each file's name, frontmatter and title", () => {
    expect(() =>
      one(
        "x",
        "slug: other\ntitle: T\naudience: member\nurl: /\ncovers:\n  - a",
      ),
    ).toThrow('its slug is not "sample"');
    expect(() =>
      buildCorpus({ manual: [file("sample.md", "x")], constants: {}, legal }),
    ).toThrow("docs/manual/sample.md: name it NN-<slug>.md.");
    expect(() =>
      buildCorpus({
        manual: [{ name: "01-sample.md", content: "# No frontmatter" }],
        constants: {},
        legal,
      }),
    ).toThrow("it has no frontmatter block");
    expect(() => one("# Title\n\n{{DAYS}}")).toThrow(/start at ##/);
    expect(() => one("x", "slug: sample\n  - stray")).toThrow(
      "a list item outside a list",
    );
    expect(() => one("x", "slug: sample\nNot YAML")).toThrow(
      'cannot read "Not YAML"',
    );
    expect(() =>
      one(
        "x",
        "slug: sample\ntitle: T\naudience: public\nurl: /\ncovers:\n  - a",
      ),
    ).toThrow(/audience/);
    expect(() =>
      one("x", "slug: sample\ntitle: T\naudience: member\nurl: /\ncovers:"),
    ).toThrow(/covers/);
  });
});

describe("the corpus reads nothing from the database", () => {
  it("imports only constants from @baumy/db", () => {
    const dir = path.join(webRoot, "lib/help");
    const sources = readdirSync(dir).filter(
      (n) => n.endsWith(".ts") && !n.endsWith(".test.ts"),
    );
    expect(sources).toContain("corpus.ts");
    let dbImports = 0;
    for (const name of sources) {
      const src = readFileSync(path.join(dir, name), "utf8");
      expect(src, name).not.toMatch(/@\/lib\/db|withTransaction|createHttpDb/);
      for (const m of src.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*"@baumy\/db[^"]*"/g,
      )) {
        dbImports += 1;
        for (const id of m[1]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)) {
          expect(id, `${name}: ${id}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
      }
      expect(src, name).not.toMatch(
        /import\s+\*\s+as\s+\w+\s+from\s+"@baumy\/db/,
      );
    }
    expect(dbImports).toBeGreaterThan(0);
  });

  it("reads the manual from docs/manual", () => {
    expect(MANUAL_DIR).toBe("docs/manual");
    expect(existsSync(path.join(repoRoot, MANUAL_DIR))).toBe(true);
  });
});
