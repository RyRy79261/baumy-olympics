import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageMember } from "@/lib/auth";

// Issue #96: `/` is public. Nobody signed in gets the landing page from the
// hub's page, and the hub's frame steps aside for it; a member still gets
// the hub. The frame no longer sends a signed-out visitor to sign-in, so
// every other hub page must run its own gate.

const memberOrVisitorPage = vi.fn<() => Promise<PageMember | null>>();
vi.mock("@/lib/auth", () => ({
  memberOrVisitorPage: () => memberOrVisitorPage(),
  requireMemberPage: vi.fn(),
}));
const loadHub = vi.fn();
vi.mock("@/lib/hub/load", () => ({
  loadHub: (...a: unknown[]) => loadHub(...a),
}));
vi.mock("@/lib/actions/ui", () => ({ uiRequestCtx: async () => ({}) }));
vi.mock("@baumy/db", () => ({ createHttpDb: () => ({}) }));
vi.mock("@baumy/db/members", () => ({
  listActiveMembers: async () => [],
  findKioskPinLockedAt: async () => null,
}));
vi.mock("@/components/hub/hub-home", () => ({
  HubHome: () => <div data-testid="hub-home" />,
}));
vi.mock("@/components/hub/post-reminder-form", () => ({
  PostReminderForm: () => null,
}));
vi.mock("./reminder-actions", () => ({ createReminderAction: vi.fn() }));
vi.mock("./shopping/actions", () => ({
  addShoppingAction: vi.fn(),
  checkOffShoppingAction: vi.fn(),
}));
vi.mock("@/lib/integrations/groq", () => ({ voiceConfigured: () => false }));
vi.mock("@/lib/actions/registry", () => ({ runAction: vi.fn() }));
vi.mock("@/lib/background-work", () => ({ runSweepAfterResponse: vi.fn() }));
vi.mock("@/lib/members/characters", () => ({
  activeRoster: async () => new Map(),
  rosterColours: () => ({}),
}));

const { default: HubPage, metadata } = await import("./page");
const { default: HubLayout } = await import("./layout");

const member = {
  kind: "member",
  userId: "u1",
  email: "a@b.c",
  name: "A",
  emailVerified: true,
  sessionCreatedAt: "2026-09-28T09:00:00.000Z",
  memberId: "m1",
  role: "member",
  displayName: "Ada",
} as PageMember;

beforeEach(() => {
  memberOrVisitorPage.mockReset();
  loadHub.mockReset();
});

describe("/", () => {
  it("shows nobody the landing page, and reads nothing from the hub", async () => {
    memberOrVisitorPage.mockResolvedValue(null);
    const out = renderToStaticMarkup(await HubPage());
    expect(out).toContain(">Baumy Olympics</h1>");
    expect(out).toContain("private household app");
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
    expect(out).not.toContain("hub-home");
    expect(loadHub).not.toHaveBeenCalled();
  });

  it("still shows a member the hub", async () => {
    memberOrVisitorPage.mockResolvedValue(member);
    loadHub.mockResolvedValue({});
    const out = renderToStaticMarkup(await HubPage());
    expect(out).toContain('data-testid="hub-home"');
    expect(out).toContain("Welcome, Ada.");
    expect(out).not.toContain("private household app");
  });

  it("describes the app in its metadata", () => {
    // Issue #122: the title skips the "%s · Baumy Olympics" template, and
    // this is the one indexable page, with its canonical URL.
    expect(metadata.title).toEqual({ absolute: "Baumy Olympics" });
    expect(metadata.description).toContain("private household app");
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates).toEqual({ canonical: "/" });
  });

  it("lets the frame step aside for nobody", async () => {
    memberOrVisitorPage.mockResolvedValue(null);
    const out = renderToStaticMarkup(
      await HubLayout({ children: <p data-testid="child">x</p> }),
    );
    expect(out).toBe('<p data-testid="child">x</p>');
  });
});

describe("every other hub page", () => {
  const root = import.meta.dirname;
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return [full];
    });
  }
  /** The source without comments, so a gate named in a comment is no gate. */
  function code(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const GATE = /await require(Member|Admin)Page\(/;

  it("strips comments before looking for the gate", () => {
    expect("// await requireMemberPage()").toMatch(GATE);
    expect(
      "// await requireMemberPage()\n/* await requireAdminPage() */"
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1"),
    ).not.toMatch(GATE);
  });

  it("runs its own page gate", () => {
    const pages = files(root).filter(
      (f) =>
        path.basename(f) === "page.tsx" && f !== path.join(root, "page.tsx"),
    );
    expect(pages.length).toBeGreaterThan(5);
    for (const file of pages) {
      expect(code(file), path.relative(root, file)).toMatch(GATE);
    }
  });

  it("has no nested layout or route handler that could skip the gate", () => {
    // The frame lets nobody through for the landing page, so a layout or a
    // route under (hub) would render or answer for a signed-out visitor.
    // Add one only with its own gate, and teach this test about it.
    const extra = files(root).filter(
      (f) =>
        /^(layout|route)\.(t|j)sx?$/.test(path.basename(f)) &&
        f !== path.join(root, "layout.tsx"),
    );
    for (const file of extra) {
      expect(code(file), path.relative(root, file)).toMatch(GATE);
    }
    expect(files(root)).toContain(path.join(root, "layout.tsx"));
  });
});
